// The surf on the outer islands' beaches: the real terrain (home island + outer islands, TerrainGPU,
// a Terrain mesh each) with the ocean stream on top (FFT, shore waves, ShoreSim tracking the camera,
// SurfFoam, Breakers with the outer island pool, Spray). For each island a view from its most exposed
// beach and one from the water; checks that the island's stations find breaking crests there.
//   node test/ocean-islands.mjs [outDir] [--island=coral]
import { makeOceanScene, skyStub } from './ocean-scene.mjs';
import { readBuffer } from '../src/engine/webgpu.js';
import { Vector2 } from '../src/engine/index.js';
import { TerrainData } from '../src/world/TerrainData.js';
import { TerrainGPU } from '../src/world/TerrainGPU.js';
import { Terrain } from '../src/world/Terrain.js';
import { computeShoreField } from '../src/world/ShoreField.js';
import { WORLD } from '../src/world/WorldLayout.js';
import { OUTER_ISLANDS } from '../src/world/islands/index.js';
import { OuterIsland } from '../src/world/terrain/OuterIsland.js';
import { ShoreWaves } from '../src/ocean/ShoreWaves.js';
import { ShoreSim } from '../src/ocean/ShoreSim.js';
import { SurfFoam } from '../src/ocean/SurfFoam.js';
import { SeaDetail } from '../src/ocean/SeaDetail.js';
import { Breakers, islandStations } from '../src/ocean/Breakers.js';
import { Spray } from '../src/fx/Spray.js';
import { WaterQuery } from '../src/ocean/WaterQuery.js';

const out = process.argv[ 2 ] && ! process.argv[ 2 ].startsWith( '--' ) ? process.argv[ 2 ] : '/tmp';
const only = ( process.argv.find( ( a ) => a.startsWith( '--island=' ) ) || '' ).slice( 9 );
let errors = 0, failed = 0;
const origErr = console.error;
console.error = ( ...a ) => { errors ++; origErr( ...a ); };
const ok = ( c, m ) => { console.log( ( c ? 'ok   ' : 'FAIL ' ) + m ); if ( ! c ) failed ++; };

const data = new TerrainData();
data.outer = OUTER_ISLANDS.map( ( d ) => new OuterIsland( d ) );
const swell = [ WORLD.swellDir.x, WORLD.swellDir.y ];
let gpu = null, terrains = [], sys = null;

const terrain = () => {

	gpu = new TerrainGPU( data, computeShoreField( data, { res: 512, swellDir: swell } ) );
	gpu.setOuterShoreFields( data.outer.map( ( o ) => computeShoreField( o.localView(), { res: 256, swellDir: swell } ) ) );
	return gpu;

};
const s = await makeOceanScene( { W: 1600, H: 900, floor: false, sky: skyStub, terrain, extra: async ( ctx ) => {

	const { surface } = ctx;
	const shore = new ShoreWaves( gpu );
	const detail = new SeaDetail();
	const shoreSim = new ShoreSim( null, { terrainGPU: gpu, shore } );
	const surfFoam = new SurfFoam( { shoreSim } );
	surface.shore = shore;
	surface.detail = detail;
	surface.shoreSim = shoreSim;
	surface.foamShading = surfFoam;
	const query = new WaterQuery( null, surface );
	terrains = [ new Terrain( { scene: ctx.scene, terrainData: data, terrainGPU: gpu } ), ...data.outer.map( ( o ) => new Terrain( { scene: ctx.scene, terrainData: o, terrainGPU: gpu } ) ) ];
	const wetness = { modules: [ shoreSim.module ], code: /* wgsl */`
fn terrainWetness( xz: vec2f, h: f32 ) -> vec2f {
	let s = shoreSimSample( xz );
	let inside = shoreSimInside( shoreSimUvOf( xz ) );
	let band = smoothstep( 0.45, 0.0, h );
	return vec2f( max( s.y, band * ( 1.0 - inside ) ), shoreSimSandFoam( xz, s, h ) );
}` };
	for ( const t of terrains ) {

		t.wetness = wetness;
		t.finalizeMaterial();

	}

	sys = { shore, detail, shoreSim, query };
	ctx.onMaterial = ( mat, sr ) => {

		const spray = sys.spray = new Spray( null, { query, terrain: gpu, sceneCopy: sr.opaqueCopy } );
		sys.breakers = new Breakers( null, { surface, shore, terrainData: data, sky: skyStub, spray } );
		ctx.scene.add( sys.breakers.mesh );
		ctx.scene.add( spray.mesh );

	};

} } );
const { shore, detail, shoreSim, query, spray, breakers } = sys;
ok( breakers.cap > 0 && breakers.NS === breakers.NH + breakers.cap, `a pool of ${ breakers.cap } stations after the main beach's ${ breakers.NH }` );
ok( data.outer.every( ( o ) => breakers.islandStations.get( o.id ) && breakers.islandStations.get( o.id ).length / 4 <= breakers.cap ), 'every island traced at load, each fits the pool' );
s.before.push( ( dt ) => {

	detail.update( dt );
	shoreSim.track( s.camera.position.x, s.camera.position.z );
	shoreSim.update();
	query.setCamera( s.camera.position.x, s.camera.position.z );
	query.update();
	breakers.update( s.camera );
	spray.update();
	for ( const t of terrains ) t.update( s.camera );

} );

// the most exposed beach of each island: the station with the most swell 30 m out in front, low
// sand behind it (not a cliff top) and open water in the view (see below)
const sh = [ 0, 0, 0, 0 ];
const bestStation = ( isle ) => {

	const st = islandStations( isle, { shoreAt: ( x, z, o ) => gpu.shoreAt( x, z, o ) } );
	let best = null, be = - 1;
	for ( let k = 0; k < st.length; k += 4 ) {

		const nx = st[ k + 2 ], nz = st[ k + 3 ];
		if ( ! nx && ! nz ) continue;
		if ( isle.heightAt( st[ k ] - nx * 7, st[ k + 1 ] - nz * 7 ) > 2.5 ) continue;
		// (no land in a 70 degree fan round the view direction, 8-80 m out)
		const lx = nx * 45 + nz * 25, lz = nz * 45 - nx * 25, ll = Math.hypot( lx, lz );
		let blocked = false;
		for ( let a = - 0.6; a <= 0.6 && ! blocked; a += 0.1 ) for ( let r = 8; r <= 80 && ! blocked; r += 4 ) {

			const dx = ( lx * Math.cos( a ) - lz * Math.sin( a ) ) / ll, dz = ( lx * Math.sin( a ) + lz * Math.cos( a ) ) / ll;
			blocked = isle.heightAt( st[ k ] - nx * 7 + dx * r, st[ k + 1 ] - nz * 7 + dz * r ) > 0.5;

		}

		if ( blocked ) continue;
		gpu.shoreAt( st[ k ] + nx * 30, st[ k + 1 ] + nz * 30, sh );
		const e = Math.hypot( sh[ 1 ], sh[ 2 ] );
		if ( e > be ) { be = e; best = { x: st[ k ], z: st[ k + 1 ], nx, nz, e }; }

	}

	return best;

};

// the main beach first, as the reference (its own stations, the region over it)
if ( ! only || only === 'home' ) {

	const d = breakers.stationData, k = Math.floor( d.length / 8 ) * 4;
	const b = { x: d[ k ], z: d[ k + 1 ], nx: d[ k + 2 ], nz: d[ k + 3 ] };
	s.camera.position.set( b.x - b.nx * 7, Math.max( data.heightAt( b.x - b.nx * 7, b.z - b.nz * 7 ), 0 ) + 1.8, b.z - b.nz * 7 );
	s.camera.lookAt( b.x + b.nx * 45 + b.nz * 25, 0, b.z + b.nz * 45 - b.nx * 25 );
	for ( let i = 0; i < 300; i ++ ) s.frame( 1 / 30 );
	ok( shoreSim.cell.x === 0 && shoreSim.cell.y === 0 && breakers.uniforms.fields.count.value === breakers.NH, 'home: the main beach region and stations' );
	await s.save( `${ out }/islands-surf-home-beach.png` );

}

for ( const isle of data.outer ) {

	if ( only && isle.id !== only ) continue;
	const b = bestStation( isle );
	const beach = [ b.x - b.nx * 7, Math.max( isle.heightAt( b.x - b.nx * 7, b.z - b.nz * 7 ), 0 ) + 1.8, b.z - b.nz * 7 ];
	// along the beach a little, so the breakers run across the view
	const look = [ b.x + b.nx * 45 + b.nz * 25, 0, b.z + b.nz * 45 - b.nx * 25 ];
	s.camera.position.set( ...beach );
	s.camera.lookAt( ...look );
	// let the waves come in and the foam build up
	for ( let i = 0; i < 300; i ++ ) s.frame( 1 / 30 );
	ok( shoreSim.cell.x !== 0 || shoreSim.cell.y !== 0, `${ isle.id }: the shore simulation moved to the beach` );
	ok( breakers.pool.island === isle && breakers.pool.n > 10, `${ isle.id }: ${ breakers.pool.n } stations in the pool (exposure ${ b.e.toFixed( 2 ) })` );
	const n = breakers.pool.n;
	const c = new Float32Array( await readBuffer( breakers.crest.getGPU(), breakers.NS * 6 * 16 ) );
	let crests = 0, breaking = 0;
	for ( let i = breakers.NH; i < breakers.NH + n; i ++ ) for ( let slot = 0; slot < 2; slot ++ ) {

		const k = ( i * 6 + slot * 3 ) * 4;
		if ( c[ k + 11 ] > 0.5 ) {

			crests ++;
			if ( c[ k + 3 ] > 0.3 && c[ k + 3 ] < 1.25 ) breaking ++;

		}

	}

	// (Eagle Rock is mostly cliff over deep water: a few crests, often none plunging at that moment)
	ok( crests > 5 && ( breaking > 0 || isle.id === 'mesa' ), `${ isle.id }: ${ crests } crests, ${ breaking } plunging` );
	await s.save( `${ out }/islands-surf-${ isle.id }-beach.png` );
	s.camera.position.set( b.x + b.nx * 70 - b.nz * 30, 9, b.z + b.nz * 70 + b.nx * 30 );
	s.camera.lookAt( b.x, 0, b.z );
	for ( let i = 0; i < 6; i ++ ) s.frame( 1 / 30 );
	await s.save( `${ out }/islands-surf-${ isle.id }-sea.png` );

}

// back to the main beach: the region and the stations go home
s.camera.position.set( 10, 3, 20 );
s.camera.lookAt( 10, 0, 60 );
s.frame( 1 / 30 );
ok( shoreSim.cell.x === 0 && shoreSim.cell.y === 0 && breakers.uniforms.fields.first.value === 0, 'back home: the main beach region and stations' );
console.log( 'errors', errors );
console.log( failed || errors ? `${ failed } FAILED` : 'all passed' );
process.exit( failed || errors ? 1 : 0 );
