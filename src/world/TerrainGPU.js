import { Vector3 } from '../engine/math/index.js';
import { Texture } from '../engine/gpu/Texture.js';
import { generateMipmaps } from '../engine/gpu/Mipmaps.js';
import { ShaderModule, UniformBlock } from '../engine/gpu/Shader.js';
import { ComputeKernel } from '../engine/gpu/Compute.js';
import { commonModule } from '../engine/render/wgsl/common.js';
import { G } from '../engine/render/Frame.js';
import { bakeTerrainMaps, buildShadowHeights } from './terrain/TerrainBake.js';
import { getDetailTexture } from './terrain/DetailTextures.js';
import { detailBinding } from './terrain/TerrainShading.js';

// GPU-side terrain data shared by every shader that needs ground height:
// ocean (depth attenuation / hiding under land), shore waves, terrain mesh,
// particles, water queries.
//
// Textures (all over the terrain domain unless noted):
//   heightTexture  R32F   exact heights, bilinear filtering done manually (heightAt)
//   normalTexture  RGBA8  macro normal xz (encoded), rock mask, baked ambient occlusion (mipmapped)
//   splatTexture   RGBA8  loose sand, worn ground / paths, gullies (land) or seagrass (seabed),
//                         seabed rubble / the eroded beach scarp face on land (mipmapped)
//   detailTexture  RGBA8  512^2 tileable detail heights (rock, soil, sand, fbm), see DetailTextures
//   shadowHeightTexture R16F 512^2 (4 m) heights with max-mips (input of the sun shadow bake)
//   sunShadowTexture    RGBA16F storage 512^2: 'shadow top' height and occluder distance toward the
//                       key light, re-baked on the GPU when G.sunDir moves (updateSunShadow)
//
// WGSL module (`terrainGPU.module`, prefix `terrain`), usable from any stage unless noted:
//   terrainUvOf( xz: vec2f ) -> vec2f                   domain uv (0..1) of a world xz
//   terrainHeightAt( xz: vec2f ) -> f32                 exact bilinear height (-90 outside the domain)
//   terrainNormalRock( xz: vec2f ) -> vec4f             macro normal xz (-1..1), rock mask, AO — fragment only
//                                                       (implicit derivatives); terrainNormalRockLevel( xz, level )
//   terrainNormalAt( xz: vec2f ) -> vec3f               unit macro normal (mip 0, any stage)
//   terrainSplat( xz: vec2f ) -> vec4f                  sand, paths, gullies / seagrass, rubble — fragment only;
//                                                       terrainSplatLevel( xz, level )
//   terrainShoreSample( xz: vec2f ) -> vec4f            shore field (T, dirX, dirZ, exposure), bilinear
//   terrainSunShadowAt( P: vec3f ) -> f32               heightfield sun shadow: 0 in the hills' shadow .. 1 lit
//                                                       (home island only; the outer islands are lit)
//   terrainOuterIndex( xz: vec2f ) -> i32               which outer island's grid holds xz (-1: none)
//
// The outer islands (OuterIsland, `terrain.outer`): the same maps for each, as layers of 2d-array
// textures (terrainOuterHeightTex, terrainOuterNormalTex, terrainOuterSplatTex, terrainOuterShoreTex)
// with their world rects in terrainOuterRects (x0, z0, size, res per texel). Outside the home grid
// terrainHeightAt, terrainNormalRock*, terrainNormalAt, terrainSplat* and terrainShoreSample read
// the outer island there, so every shader that asks for the ground sees the whole archipelago.
// Bindings: terrainParams (TerrainParams: origin, size, res, shoreRes, sunBake, sunBaked, outerCount, outerShoreRes), terrainHeightTex,
// terrainNormalTex, terrainSplatTex, terrainDetailTex (tileable: sample with smpLinearRepeat / smpAnisoRepeat),
// terrainShoreTex, terrainSunShadowTex.
const SUN_N = 512;
const SUN_T0 = 24; // m: nearer occluders are left to the shadow map / N.L
const SUN_DT0 = 6;
const SUN_GROWTH = 1.22;
const SUN_STEPS = 24; // reaches ~3 km

function dataTexture( data, width, height, format, label, mips = false ) {

	const tex = new Texture( { label, width, height, format, mips, usage: [ 'sample', 'copyDst' ], data } );
	tex.getGPU();
	if ( mips === true ) generateMipmaps( tex );
	return tex;

}

export class TerrainGPU {

	constructor( terrain, shoreField ) {

		this.terrain = terrain;
		const res = terrain.res;
		const t0 = performance.now();

		// heights: R32F, loaded with manual bilinear filtering (no sampler / float filtering needed)
		this.heightTexture = dataTexture( terrain.heights, res, res, 'r32float', 'terrainHeights' );

		const maps = bakeTerrainMaps( terrain );
		// trilinear, clamp to edge (smpLinearClamp), linear data (no colour space)
		this.normalTexture = dataTexture( maps.normal, res, res, 'rgba8unorm', 'terrainNormalRockAO', true );
		this.splatTexture = dataTexture( maps.splat, res, res, 'rgba8unorm', 'terrainSplat', true );
		this.detailTexture = getDetailTexture();

		// coarse heights for the sun shadow march (half float is filterable everywhere)
		const sh = buildShadowHeights( terrain, 4 );
		const st = new Texture( { label: 'terrainShadowHeights', width: sh.levels[ 0 ].width, height: sh.levels[ 0 ].height, format: 'r16float', mips: sh.levels.length, usage: [ 'sample', 'copyDst' ] } );
		st.getGPU();
		sh.levels.forEach( ( l, i ) => st.upload( l.data, { mip: i, width: l.width, height: l.height } ) );
		this.shadowHeightTexture = st;
		this.shadowTexel = sh.texel;
		this.maxHeight = sh.maxHeight;

		this.size = terrain.size;
		this.origin = terrain.origin;
		this.res = res;
		this._initOuter( terrain.outer || [] );

		this.uniforms = new UniformBlock( 'TerrainParams', {
			origin: [ 'f32', terrain.origin ],
			size: [ 'f32', terrain.size ],
			res: [ 'f32', res ],
			shoreRes: [ 'f32', 1 ],
			sunBake: [ 'vec3f', new Vector3( 0, 1, 0 ) ],
			sunBaked: [ 'f32', 0 ], // 0 until the first bake: everything lit
			outerCount: [ 'f32', this.outerCount ],
			outerShoreRes: [ 'f32', this.outerShoreRes ],
		}, { label: 'terrainParams' } );
		// three-style handles (terOrigin / terSize / terSunBake / terSunBaked)
		this.uOrigin = this.uniforms.fields.origin;
		this.uSize = this.uniforms.fields.size;

		// placeholder until the shore field is set (1 texel, no waves)
		this.shoreTexture = dataTexture( new Float32Array( [ 1e4, 0, 0, 0 ] ), 1, 1, 'rgba32float', 'terrainShoreField' );
		if ( shoreField ) this.setShoreField( shoreField );
		this._initSunShadow();

		this.module = new ShaderModule( {
			name: 'terrain',
			deps: [ commonModule ],
			uniforms: this.uniforms,
			bindings: {
				terrainHeightTex: { texture: this.heightTexture, sampleType: 'unfilterable-float' },
				terrainNormalTex: { texture: this.normalTexture },
				terrainSplatTex: { texture: this.splatTexture },
				terrainDetailTex: detailBinding(),
				terrainShoreTex: { texture: () => this.shoreTexture, sampleType: 'unfilterable-float' },
				terrainSunShadowTex: { texture: this.sunShadowTexture },
				terrainOuterRects: { texture: this.outerRects, sampleType: 'unfilterable-float' },
				terrainOuterHeightTex: { texture: this.outerHeightTexture, sampleType: 'unfilterable-float', viewDimension: '2d-array' },
				terrainOuterNormalTex: { texture: this.outerNormalTexture, viewDimension: '2d-array' },
				terrainOuterSplatTex: { texture: this.outerSplatTexture, viewDimension: '2d-array' },
				terrainOuterShoreTex: { texture: () => this.outerShoreTexture, sampleType: 'unfilterable-float', viewDimension: '2d-array' },
			},
			code: TERRAIN_WGSL,
		} );

		// the former TerrainLightingModel: multiplies the key light by the heightfield sun shadow.
		// Materials add it to `modules` and set the define MATERIAL_SUN_MODULATION: 1.
		this.sunModulationModule = new ShaderModule( {
			name: 'terrainSunModulation',
			deps: [ this.module ],
			code: 'fn materialSunModulation( P: vec3f, N: vec3f ) -> vec3f { return vec3f( terrainSunShadowAt( P ) ); }',
		} );

		this.timings = { ...maps.ms, detail: this.detailTexture.userData.ms, total: performance.now() - t0 };

	}

	// ------------------------------------------------------------ outer islands

	// one layer per outer island (all the same res); a 1-layer placeholder when there are none
	_initOuter( outer ) {

		const L = Math.max( 1, outer.length );
		const res = outer.length ? outer[ 0 ].res : 1;
		for ( const o of outer ) if ( o.res !== res ) throw new Error( 'outer islands need one res' );
		const arr = ( format, label, Ctor, comps, mips ) => {

			const t = new Texture( { label, width: res, height: res, depth: L, dimension: '2d-array', format, mips, usage: mips ? [ 'sample', 'copyDst', 'render' ] : [ 'sample', 'copyDst' ] } );
			t.getGPU();
			if ( ! outer.length ) t.upload( new Ctor( comps ) );
			return t;

		};

		this.outer = outer;
		this.outerCount = outer.length;
		this.outerHeightTexture = arr( 'r32float', 'terrainOuterHeights', Float32Array, 1, false );
		this.outerNormalTexture = arr( 'rgba8unorm', 'terrainOuterNormalRockAO', Uint8Array, 4, outer.length ? true : false );
		this.outerSplatTexture = arr( 'rgba8unorm', 'terrainOuterSplat', Uint8Array, 4, outer.length ? true : false );
		const rects = new Float32Array( 4 * L );
		outer.forEach( ( o, i ) => {

			this.outerHeightTexture.upload( o.heights, { layer: i, layers: 1 } );
			const maps = bakeTerrainMaps( o );
			this.outerNormalTexture.upload( maps.normal, { layer: i, layers: 1 } );
			this.outerSplatTexture.upload( maps.splat, { layer: i, layers: 1 } );
			rects.set( [ o.x0, o.z0, o.size, o.res ], 4 * i );

		} );
		if ( outer.length ) {

			generateMipmaps( this.outerNormalTexture );
			generateMipmaps( this.outerSplatTexture );

		}

		this.outerRects = dataTexture( rects, L, 1, 'rgba32float', 'terrainOuterRects' );
		// shore fields: set by setOuterShoreFields (placeholder: no waves)
		this.outerShoreRes = 1;
		this.outerShoreTexture = new Texture( { label: 'terrainOuterShoreField', width: 1, height: 1, depth: L, dimension: '2d-array', format: 'rgba32float', usage: [ 'sample', 'copyDst' ] } );
		this.outerShoreTexture.getGPU();
		const ph = new Float32Array( 4 * L );
		for ( let i = 0; i < L; i ++ ) ph[ 4 * i ] = 1e4;
		this.outerShoreTexture.upload( ph );

	}

	// the outer islands' shore fields (computeShoreField over each island's local view), one per island
	setOuterShoreFields( fields ) {

		if ( ! fields.length ) return;
		const res = fields[ 0 ].res;
		this.outerShoreTexture.destroy();
		this.outerShoreTexture = new Texture( { label: 'terrainOuterShoreField', width: res, height: res, depth: fields.length, dimension: '2d-array', format: 'rgba32float', usage: [ 'sample', 'copyDst' ] } );
		this.outerShoreTexture.getGPU();
		fields.forEach( ( f, i ) => this.outerShoreTexture.upload( f.data, { layer: i, layers: 1 } ) );
		this.outerShoreRes = res;
		this.uniforms.fields.outerShoreRes.value = res;

	}

	// ------------------------------------------------------------ heightfield sun shadow

	// World-space shadow map of the terrain for the key light: for every 4 m cell the lowest height
	// that still sees the light past the terrain (max over the march of h(q) - t * tan(elevation))
	// and the distance to that occluder (penumbra width). One texture fetch gives soft, long hill
	// shadows for any point - terrain, rocks, buildings, plants - far beyond the shadow map range.
	_initSunShadow() {

		// nearest + textureLoad (manual bilinear in terrainSunShadowAt): no sampler needed, every lit
		// material includes this lookup
		this.sunShadowTexture = new Texture( { label: 'terrainSunShadow', width: SUN_N, height: SUN_N, format: 'rgba16float', usage: [ 'sample', 'storage' ] } );
		this.uSunBake = this.uniforms.fields.sunBake;
		this.uSunBaked = this.uniforms.fields.sunBaked;
		this._sunBaked = false;

		const invTexel = 1 / this.shadowTexel;
		this.sunShadowKernel = new ComputeKernel( {
			label: 'Terrain Sun Shadow',
			modules: [ commonModule ],
			bindings: {
				terrainParams: { uniform: this.uniforms },
				terrainShadowHeights: { texture: this.shadowHeightTexture },
				terrainSunShadowOut: { storageTexture: this.sunShadowTexture, access: 'write' },
			},
			workgroupSize: [ 8, 8, 1 ],
			code: /* wgsl */`
@compute @workgroup_size( WG_X, WG_Y, WG_Z )
fn main( @builtin( global_invocation_id ) gid: vec3u ) {
	if ( gid.x >= ${ SUN_N }u || gid.y >= ${ SUN_N }u ) { return; }
	let ij = vec2f( gid.xy );
	let xz = ( ij + 0.5 ) / ${ SUN_N }.0 * terrainParams.size + terrainParams.origin;
	let L = terrainParams.sunBake;
	let lxz = max( length( L.xz ), 1e-4 );
	let dir = L.xz / lxz;
	let tanEl = L.y / lxz;
	var top = -1e4;
	var occ = 0.0;
	var t = f32( ${ SUN_T0 } );
	var dt = f32( ${ SUN_DT0 } );
	for ( var i = 0; i < ${ SUN_STEPS }; i++ ) {
		let q = xz + dir * t;
		let uv = ( q - terrainParams.origin ) / terrainParams.size;
		let hq = textureSampleLevel( terrainShadowHeights, smpLinearClamp, uv, log2( max( dt * ${ invTexel.toFixed( 8 ) }, 1.0 ) ) ).x;
		let v = hq - t * tanEl;
		if ( v > top ) {
			top = v;
			occ = t;
		}
		dt *= ${ SUN_GROWTH };
		t += dt;
	}
	textureStore( terrainSunShadowOut, vec2u( gid.xy ), vec4f( top, occ, 0.0, 1.0 ) );
}
`,
		} );

	}

	// Re-bake the sun shadow map when the key light moved (cheap: ~6 M texture fetches).
	// `renderer` is unused (kept for the call sites); the dispatch records into the frame encoder.
	updateSunShadow( renderer, force = false ) {

		const L = G.sunDir.value;
		if ( ! force && this._sunBaked && L.angleTo( this.uSunBake.value ) < 0.0015 ) return false;
		this.uSunBake.value.copy( L );
		this.sunShadowKernel.dispatch( [ SUN_N / 8, SUN_N / 8, 1 ] );
		this._sunBaked = true;
		this.uSunBaked.value = 1;
		return true;

	}

	setShoreField( f ) {

		this.shoreRes = f.res;
		if ( this.shoreTexture.width !== f.res ) {

			this.shoreTexture.destroy();
			this.shoreTexture = dataTexture( f.data, f.res, f.res, 'rgba32float', 'terrainShoreField' );

		} else {

			this.shoreTexture.upload( f.data );

		}

		this.uniforms.fields.shoreRes.value = f.res;

	}

}

const TERRAIN_WGSL = /* wgsl */`
fn terrainUvOf( xz: vec2f ) -> vec2f {
	return ( xz - terrainParams.origin ) / terrainParams.size;
}

// ---- outer islands: which grid holds xz, and its uv there
fn terrainOuterIndex( xz: vec2f ) -> i32 {
	var idx = -1;
	let n = i32( terrainParams.outerCount );
	for ( var k = 0; k < n; k++ ) {
		let r = textureLoad( terrainOuterRects, vec2i( k, 0 ), 0 );
		let f = ( xz - r.xy ) / r.z;
		if ( f.x >= 0.0 && f.y >= 0.0 && f.x < 1.0 && f.y < 1.0 ) { idx = k; }
	}
	return idx;
}
fn terrainOuterUv( xz: vec2f, idx: i32 ) -> vec2f {
	let r = textureLoad( terrainOuterRects, vec2i( max( idx, 0 ), 0 ), 0 );
	return ( xz - r.xy ) / r.z;
}
fn terrainInHome( xz: vec2f ) -> bool {
	let uv = terrainUvOf( xz );
	return uv.x >= 0.0 && uv.y >= 0.0 && uv.x <= 1.0 && uv.y <= 1.0;
}
// exact bilinear height on outer island idx (-90 outside its grid)
fn terrainOuterHeightAt( xz: vec2f, idx: i32 ) -> f32 {
	let res = f32( textureDimensions( terrainOuterHeightTex ).x );
	let f = terrainOuterUv( xz, idx ) * res - 0.5;
	let fc = clamp( f, vec2f( 0.0 ), vec2f( res - 1.001 ) );
	let ii = vec2i( floor( fc ) );
	let t = fract( fc );
	let a = textureLoad( terrainOuterHeightTex, ii, idx, 0 ).x;
	let b = textureLoad( terrainOuterHeightTex, ii + vec2i( 1, 0 ), idx, 0 ).x;
	let c = textureLoad( terrainOuterHeightTex, ii + vec2i( 0, 1 ), idx, 0 ).x;
	let d = textureLoad( terrainOuterHeightTex, ii + vec2i( 1, 1 ), idx, 0 ).x;
	let h = mix( mix( a, b, t.x ), mix( c, d, t.x ), t.y );
	let outside = f.x < 0.0 || f.y < 0.0 || f.x > res - 1.0 || f.y > res - 1.0;
	return select( h, -90.0, outside );
}

// exact bilinear height at world xz (matches TerrainData.heightAt)
fn terrainHeightAt( xz: vec2f ) -> f32 {
	let res = terrainParams.res;
	let f = ( xz - terrainParams.origin ) / terrainParams.size * res - 0.5;
	let fc = clamp( f, vec2f( 0.0 ), vec2f( res - 1.001 ) );
	let i = floor( fc );
	let t = fract( fc );
	let ii = vec2i( i );
	let a = textureLoad( terrainHeightTex, ii, 0 ).x;
	let b = textureLoad( terrainHeightTex, ii + vec2i( 1, 0 ), 0 ).x;
	let c = textureLoad( terrainHeightTex, ii + vec2i( 0, 1 ), 0 ).x;
	let d = textureLoad( terrainHeightTex, ii + vec2i( 1, 1 ), 0 ).x;
	let h = mix( mix( a, b, t.x ), mix( c, d, t.x ), t.y );
	// outside the domain: an outer island there, else the deep ocean floor
	let outside = f.x < 0.0 || f.y < 0.0 || f.x > res - 1.0 || f.y > res - 1.0;
	if ( !outside ) { return h; }
	let oi = terrainOuterIndex( xz );
	if ( oi < 0 ) { return -90.0; }
	return terrainOuterHeightAt( xz, oi );
}

// filtered normal (xz components), rock mask, ambient occlusion. Both grids are always sampled and
// the right one selected, so the implicit-derivative sample stays in uniform control flow.
fn terrainNormalRock( xz: vec2f ) -> vec4f {
	let home = textureSample( terrainNormalTex, smpLinearClamp, terrainUvOf( xz ) );
	let oi = terrainOuterIndex( xz );
	let o = textureSample( terrainOuterNormalTex, smpLinearClamp, terrainOuterUv( xz, oi ), max( oi, 0 ) );
	let s = select( home, o, oi >= 0 && !terrainInHome( xz ) );
	return vec4f( s.xy * 2.0 - 1.0, s.z, s.w );
}
// explicit mip (e.g. in the vertex stage)
fn terrainNormalRockLevel( xz: vec2f, level: f32 ) -> vec4f {
	var s = textureSampleLevel( terrainNormalTex, smpLinearClamp, terrainUvOf( xz ), level );
	if ( !terrainInHome( xz ) ) {
		let oi = terrainOuterIndex( xz );
		if ( oi >= 0 ) { s = textureSampleLevel( terrainOuterNormalTex, smpLinearClamp, terrainOuterUv( xz, oi ), oi, level ); }
	}
	return vec4f( s.xy * 2.0 - 1.0, s.z, s.w );
}
fn terrainNormalAt( xz: vec2f ) -> vec3f {
	let nr = terrainNormalRockLevel( xz, 0.0 );
	return normalize( vec3f( nr.x, sqrt( max( 1.0 - nr.x * nr.x - nr.y * nr.y, 0.0025 ) ), nr.y ) );
}

// loose sand, worn ground / paths, gullies (land) or seagrass (seabed), seabed rubble (the
// eroded beach scarp face on land)
fn terrainSplat( xz: vec2f ) -> vec4f {
	let home = textureSample( terrainSplatTex, smpLinearClamp, terrainUvOf( xz ) );
	let oi = terrainOuterIndex( xz );
	let o = textureSample( terrainOuterSplatTex, smpLinearClamp, terrainOuterUv( xz, oi ), max( oi, 0 ) );
	return select( home, o, oi >= 0 && !terrainInHome( xz ) );
}
fn terrainSplatLevel( xz: vec2f, level: f32 ) -> vec4f {
	var s = textureSampleLevel( terrainSplatTex, smpLinearClamp, terrainUvOf( xz ), level );
	if ( !terrainInHome( xz ) ) {
		let oi = terrainOuterIndex( xz );
		if ( oi >= 0 ) { s = textureSampleLevel( terrainOuterSplatTex, smpLinearClamp, terrainOuterUv( xz, oi ), oi, level ); }
	}
	return s;
}

// shore field: (T, dirX, dirZ, exposure), bilinear via loads (float32 data)
fn terrainShoreSample( xz: vec2f ) -> vec4f {
	if ( !terrainInHome( xz ) ) {
		let oi = terrainOuterIndex( xz );
		if ( oi >= 0 ) { return terrainOuterShoreSample( xz, oi ); }
	}
	let res = terrainParams.shoreRes;
	let f = ( xz - terrainParams.origin ) / terrainParams.size * res - 0.5;
	let fc = clamp( f, vec2f( 0.0 ), vec2f( max( res - 1.001, 0.0 ) ) );
	let i = floor( fc );
	let t = fract( fc );
	let ii = vec2i( i );
	let mx = vec2i( max( i32( res ) - 1, 0 ) );
	let a = textureLoad( terrainShoreTex, ii, 0 );
	let b = textureLoad( terrainShoreTex, min( ii + vec2i( 1, 0 ), mx ), 0 );
	let c = textureLoad( terrainShoreTex, min( ii + vec2i( 0, 1 ), mx ), 0 );
	let d = textureLoad( terrainShoreTex, min( ii + vec2i( 1, 1 ), mx ), 0 );
	return mix( mix( a, b, t.x ), mix( c, d, t.x ), t.y );
}

fn terrainOuterShoreSample( xz: vec2f, idx: i32 ) -> vec4f {
	let res = terrainParams.outerShoreRes;
	let f = terrainOuterUv( xz, idx ) * res - 0.5;
	let fc = clamp( f, vec2f( 0.0 ), vec2f( max( res - 1.001, 0.0 ) ) );
	let i = floor( fc );
	let t = fract( fc );
	let ii = vec2i( i );
	let mx = vec2i( max( i32( res ) - 1, 0 ) );
	let a = textureLoad( terrainOuterShoreTex, ii, idx, 0 );
	let b = textureLoad( terrainOuterShoreTex, min( ii + vec2i( 1, 0 ), mx ), idx, 0 );
	let c = textureLoad( terrainOuterShoreTex, min( ii + vec2i( 0, 1 ), mx ), idx, 0 );
	let d = textureLoad( terrainOuterShoreTex, min( ii + vec2i( 1, 1 ), mx ), idx, 0 );
	return mix( mix( a, b, t.x ), mix( c, d, t.x ), t.y );
}

// 0 (in the terrain's shadow) .. 1 (lit) for a world position, soft penumbra that widens with the
// occluder distance
fn terrainSunShadowAt( P: vec3f ) -> f32 {
	let N = f32( textureDimensions( terrainSunShadowTex ).x );
	let st = clamp( terrainUvOf( P.xz ) * N - 0.5, vec2f( 0.0 ), vec2f( N - 1.001 ) );
	let i = vec2i( floor( st ) );
	let t = fract( st );
	let s = mix(
		mix( textureLoad( terrainSunShadowTex, i, 0 ), textureLoad( terrainSunShadowTex, i + vec2i( 1, 0 ), 0 ), t.x ),
		mix( textureLoad( terrainSunShadowTex, i + vec2i( 0, 1 ), 0 ), textureLoad( terrainSunShadowTex, i + vec2i( 1, 1 ), 0 ), t.x ),
		t.y
	);
	let w = s.y * 0.012 + 0.35;
	return mix( 1.0, smoothstep( -w, w, P.y - s.x ), terrainParams.sunBaked );
}
`;
