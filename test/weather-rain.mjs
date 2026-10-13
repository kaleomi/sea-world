// Headless WebGPU: the weather system. Compiles the rain particles and the wetness hook, and checks
// that wetness actually changes what a lit surface looks like (it is a uniform, not a define, so
// turning rain up must not rebuild any pipeline).
import { writePNG } from './headless.mjs';
import { GPU } from '../src/engine/gpu/GPU.js';
import { RenderTarget } from '../src/engine/gpu/Texture.js';
import { readTexture } from '../src/engine/gpu/Readback.js';
import { G, setFrameCamera } from '../src/engine/render/Frame.js';
import { Material } from '../src/engine/render/Material.js';
import { MeshRenderer } from '../src/engine/render/MeshRenderer.js';
import { SunShadows } from '../src/engine/render/Shadows.js';
import { FullscreenPass } from '../src/engine/render/FullscreenPass.js';
import { SceneLighting } from '../src/materials/SceneLighting.js';
import * as E from '../src/engine/index.js';
import { Weather } from '../src/weather/Weather.js';

let fails = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else console.log( 'ok  ', msg );

};

await GPU.init( { headless: true } );
const W = 480, H = 270;

const scene = new E.Scene();
const ground = new E.Mesh( new E.PlaneGeometry( 80, 80 ).rotateX( - Math.PI / 2 ),
	new Material( { name: 'ground', color: 0x8a7a60, roughness: 0.9 } ) );
ground.castShadow = true;
const post = new E.Mesh( new E.CylinderGeometry( 0.35, 0.35, 4, 16 ),
	new Material( { name: 'post', color: 0x6b5844, roughness: 0.75 } ) );
post.position.set( 3, 2, - 2 ); post.castShadow = true;
scene.add( ground, post );

const camera = new E.PerspectiveCamera( 55, W / H, 0.1, 1000 );
camera.position.set( 6, 4, 9 ); camera.lookAt( 0, 1, 0 );
G.sunDir.value.set( 0.4, 0.8, 0.3 ).normalize();
G.sunColor.value.setRGB( 3, 2.9, 2.7 );
G.skyIrradiance.value.setRGB( 0.3, 0.38, 0.5 );

// Weather installs the `surface` hook (wetness); the rain mesh joins the scene here
const weather = new Weather( { scene, terrain: null, preset: 'Storm' } );
ok( scene.children.includes( weather.rain.mesh ), 'the rain mesh is in the scene' );
ok( SceneLighting.hooks.surface !== undefined, 'the wetness surface hook is installed' );

const rt = new RenderTarget( W, H, { colors: [ 'rgba16float', 'rgba16float', 'rgba8unorm' ], depth: 'depth32float', label: 'scene' } );
const ldr = new RenderTarget( W, H, { colors: [ 'rgba8unorm' ], label: 'ldr' } );
const mr = new MeshRenderer();
const shadows = new SunShadows();
const tonemap = new FullscreenPass( { label: 'tonemap', colorFormats: [ 'rgba8unorm' ], bindings: { hdr: { texture: () => rt.texture } },
	code: `fn fragment( in: FSIn ) -> vec4f {
		let c = textureLoad( hdr, vec2i( in.pos.xy ), 0 ).rgb;
		let a = c * 0.8; let t = ( a * ( 2.51 * a + 0.03 ) ) / ( a * ( 2.43 * a + 0.59 ) + 0.14 );
		return vec4f( linearToSrgb( sat3( t ) ), 1.0 ); }` } );

const pipelinesAfterBuild = () => mr.stats.pipelines;

function draw( rain, wetness ) {

	G.weather.value.set( rain, wetness, 0, 0 );
	// let the rain system place its particles for this camera (it also mirrors the level into its block)
	weather.rain.update( 1 / 60, camera, rain, - 100 );
	GPU.beginFrame();
	setFrameCamera( camera, W, H );
	shadows.render( scene, mr, shadows.update( camera, G.sunDir.value ) );
	mr.render( scene, { camera, kind: 'main', colorViews: rt.textures.map( ( t ) => t.view() ), colorFormats: rt.formats,
		clearColors: [ [ 0.35, 0.45, 0.62, 1 ], [ 0, 0, 0, 0 ], [ 0, 0, 0, 0 ] ], depthView: rt.depthTexture.view(), depthFormat: 'depth32float', clearDepth: 0 } );
	tonemap.render( { colorViews: [ ldr.texture ] } );
	GPU.submit();
	return readTexture( ldr.texture );

}

// warm up: build every pipeline (dry, then raining)
const dry = await draw( 0, 0 );
const built = pipelinesAfterBuild();
const wet = await draw( 0, 1 );
ok( pipelinesAfterBuild() === built, 'wetness costs no extra pipelines (it is a uniform, not a define)' );

// rain on: the rain material compiles and draws
const raining = await draw( 1, 1 );
ok( weather.rain.mesh.visible, 'the rain draws while it is raining' );
ok( pipelinesAfterBuild() > built, `rain adds its pipeline (${ built } -> ${ pipelinesAfterBuild() })` );

const px = ( img ) => new Uint8Array( img.data );
const diff = ( a, b ) => {

	const x = px( a ), y = px( b );
	let sum = 0, n = 0;
	for ( let i = 0; i < x.length; i += 4 ) {

		const d = Math.abs( x[ i ] - y[ i ] ) + Math.abs( x[ i + 1 ] - y[ i + 1 ] ) + Math.abs( x[ i + 2 ] - y[ i + 2 ] );
		if ( d > 6 ) n ++;
		sum += d;

	}

	return { mean: sum / ( x.length / 4 ), changed: n / ( x.length / 4 ) };

};

const dWet = diff( dry, wet );
ok( dWet.changed > 0.05, `wet surfaces look different (${ ( 100 * dWet.changed ).toFixed( 1 ) }% of pixels, mean ${ dWet.mean.toFixed( 1 ) })` );

// wetter means darker and glossier: compare the mean luminance of the ground
const luma = ( img ) => {

	const x = px( img );
	let s = 0;
	for ( let i = 0; i < x.length; i += 4 ) s += 0.2126 * x[ i ] + 0.7152 * x[ i + 1 ] + 0.0722 * x[ i + 2 ];
	return s / ( x.length / 4 );

};

ok( luma( wet ) < luma( dry ), `wet ground is darker (${ luma( dry ).toFixed( 1 ) } -> ${ luma( wet ).toFixed( 1 ) })` );

const dRain = diff( wet, raining );
ok( dRain.changed > 0.001, `rain is visible in front of the camera (${ ( 100 * dRain.changed ).toFixed( 2 ) }% of pixels)` );
// wetness is the same in both frames, so the ground luma should match (the rain drops sit on top)
ok( Math.abs( luma( wet ) - luma( raining ) ) < 8, `wetness is uniform across the frames (${ luma( wet ).toFixed( 1 ) } vs ${ luma( raining ).toFixed( 1 ) })` );

if ( process.argv[ 2 ] ) {

	writePNG( process.argv[ 2 ] + '-dry.png', W, H, px( dry ) );
	writePNG( process.argv[ 2 ] + '-wet.png', W, H, px( wet ) );
	writePNG( process.argv[ 2 ] + '-rain.png', W, H, px( raining ) );

}

console.log( 'stats', mr.stats );
console.log( fails ? `\n${ fails } FAILED` : '\nall passed' );
await new Promise( ( r ) => setTimeout( r, 200 ) );
process.exit( fails ? 1 : 0 );
