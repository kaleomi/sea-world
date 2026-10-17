// Outer islands render test: the home TerrainData plus the generated islands of the archipelago
// (world/islands/, world/terrain/OuterIsland.js) through TerrainGPU and a Terrain mesh each,
// rendered headless from a few cameras round them.
//   node test/world-islands.mjs [outDir] [--view=name] [--veg] [--village]
//   (--veg: with their vegetation; --village: with the village and the quest givers' homes, plus a view of each;
//   --posts: the trading post on each island's beach, with a view of each, post_<giver>)
import { worldHarness, done } from './world-harness.mjs';
import { TerrainData } from '../src/world/TerrainData.js';
import { TerrainGPU } from '../src/world/TerrainGPU.js';
import { Terrain } from '../src/world/Terrain.js';
import { computeShoreField } from '../src/world/ShoreField.js';
import { WORLD } from '../src/world/WorldLayout.js';
import { OUTER_ISLANDS, ISLANDS } from '../src/world/islands/index.js';
import { OuterIsland } from '../src/world/terrain/OuterIsland.js';

const out = process.argv[ 2 ] && ! process.argv[ 2 ].startsWith( '--' ) ? process.argv[ 2 ] : '/tmp';
const H = await worldHarness( { sun: [ 0.5, 0.42, 0.45 ] } );
const data = new TerrainData();
let t = performance.now();
data.outer = OUTER_ISLANDS.map( ( d ) => new OuterIsland( d ) );
console.log( 'outer islands', ( performance.now() - t ).toFixed( 0 ), 'ms' );
const swell = [ WORLD.swellDir.x, WORLD.swellDir.y ];
const gpu = new TerrainGPU( data, computeShoreField( data, { res: 512, swellDir: swell } ) );
gpu.setOuterShoreFields( data.outer.map( ( o ) => computeShoreField( o.localView(), { res: 256, swellDir: swell } ) ) );
const terrains = [ new Terrain( { scene: H.scene, terrainData: data, terrainGPU: gpu } ), ...data.outer.map( ( o ) => new Terrain( { scene: H.scene, terrainData: o, terrainGPU: gpu } ) ) ];
for ( const tr of terrains ) tr.material.appliesHillShadow = true;
H.before.push( ( cam ) => { for ( const tr of terrains ) tr.update( cam ); } );
let village = null;
if ( process.argv.includes( '--village' ) ) {

	const { Village } = await import( '../src/world/Village.js' );
	const { Colliders } = await import( '../src/world/Colliders.js' );
	village = new Village( { scene: H.scene, terrain: data, colliders: new Colliders() } );
	console.log( 'outposts', village.outposts.map( ( p ) => p.id ).join( ' ' ) );

}

if ( process.argv.includes( '--veg' ) ) {

	const { Vegetation } = await import( '../src/world/Vegetation.js' );
	t = performance.now();
	const veg = new Vegetation( { scene: H.scene, terrain: data, village } );
	console.log( 'vegetation', ( performance.now() - t ).toFixed( 0 ), 'ms', veg.records.palms.length, 'palms', veg.records.trees.length, 'trees' );
	H.before.push( ( cam ) => veg.update( 1 / 60, cam ) );

}

const C = ISLANDS.coral.position, E = ISLANDS.ember.position;
const aerial = ( id, h = 360, back = 640 ) => {

	const p = ISLANDS[ id ].position, l = Math.hypot( p.x, p.z );
	// from the home island's side, looking out at it
	return { pos: [ p.x - p.x / l * back, h, p.z - p.z / l * back ], target: [ p.x, 10, p.z ] };

};
const views = {
	crescentAerial: aerial( 'crescent' ),
	skerriesAerial: aerial( 'skerries' ),
	mesaAerial: aerial( 'mesa', 260, 560 ),
	longcayAerial: aerial( 'longcay', 300, 600 ),
	coralAerial: { pos: [ C.x, 420, C.z + 620 ], target: [ C.x, 0, C.z ] },
	coralMotu: { pos: [ C.x - 120, 6, C.z + 360 ], target: [ C.x - 200, 1, C.z + 230 ] },
	emberAerial: { pos: [ E.x + 300, 380, E.z + 700 ], target: [ E.x, 40, E.z ] },
	emberShore: { pos: [ E.x, 12, E.z + 470 ], target: [ E.x, 60, E.z ] },
	emberBeach: { pos: [ E.x + 40, 4, E.z + 395 ], target: [ E.x - 40, 8, E.z + 330 ] },
	coralIslet: { pos: [ C.x + 40, 5, C.z + 420 ], target: [ C.x - 20, 2, C.z + 300 ] },
};
// each home seen from the water in front of it, the lighthouse from further out
for ( const p of village ? village.outposts : [] ) {

	const far = p.kind === 'lighthouse' ? 150 : 24, up = p.kind === 'lighthouse' ? 40 : 7;
	const y = p.kind === 'lighthouse' ? p.floorY + 8 : p.floorY;
	const dx = Math.sin( p.yaw ), dz = Math.cos( p.yaw );
	views[ `home_${ p.id }` ] = { pos: [ p.x + dx * far + dz * far * 0.35, y + up, p.z + dz * far - dx * far * 0.35 ], target: [ p.x, y + 1.5, p.z ] };
	if ( p.kind === 'lighthouse' ) views.home_lighthouseNear = { pos: [ p.x + dx * 30 + dz * 12, p.floorY + 9, p.z + dz * 30 - dx * 12 ], target: [ p.x, p.floorY + 11, p.z ] };

}

// the trading posts (game/IslandPost.js) where each quest giver stands
if ( process.argv.includes( '--posts' ) ) {

	// the stall kit's files from public/, its images decoded with ImageMagick (Node has no decoder)
	const fs = await import( 'node:fs' ), { execFileSync } = await import( 'node:child_process' );
	const pub = new URL( '../public', import.meta.url ).pathname;
	globalThis.__assetFile = async ( url ) => {

		const b = fs.readFileSync( pub + url.replace( /^.*?\/models\//, '/models/' ) );
		return b.buffer.slice( b.byteOffset, b.byteOffset + b.byteLength );

	};
	globalThis.__assetImage = async ( bytes ) => {

		const [ w, h ] = execFileSync( 'identify', [ '-format', '%w %h', '-' ], { input: bytes } ).toString().split( ' ' ).map( Number );
		const raw = execFileSync( 'convert', [ '-', '-depth', '8', 'RGBA:-' ], { input: bytes, maxBuffer: 1 << 28 } );
		return { data: new Uint8Array( raw.buffer, raw.byteOffset, raw.byteLength ), width: w, height: h };

	};
	const { buildIslandPost } = await import( '../src/game/IslandPost.js' );
	const { GIVERS, beachSpot } = await import( '../src/game/Quests.js' );
	for ( const g of Object.values( GIVERS ) ) {

		const o = data.outer.find( ( q ) => q.id === g.island ), s = o && beachSpot( o, 0, 0 );
		if ( ! s ) continue;
		const post = buildIslandPost( { scene: H.scene, terrain: data, spot: s, giver: g.id } );
		await post.ready;
		const dx = Math.sin( s.yaw ), dz = Math.cos( s.yaw );
		views[ `post_${ g.id }` ] = { pos: [ post.x + dx * 7 + dz * 2.5, post.y + 2.2, post.z + dz * 7 - dx * 2.5 ], target: [ post.x, post.y + 1.1, post.z ] };

	}

}

const only = process.argv.find( ( a ) => a.startsWith( '--view=' ) );
for ( const [ k, v ] of Object.entries( views ) ) {

	if ( only && ! k.startsWith( only.slice( 7 ) ) ) continue; // a prefix picks several
	await H.shot( `${ out }/claude-islands-${ k }.png`, v );

}

// CPU and GPU agree on the outer island heights (the CPU heightAt falls through to them)
const o = data.outer[ 0 ];
console.log( 'heightAt check', data.heightAt( o.cx, o.cz ).toFixed( 2 ), o.heightAt( o.cx, o.cz ).toFixed( 2 ), data.heightAt( o.cx + 300, o.cz ).toFixed( 2 ) );
await done();
