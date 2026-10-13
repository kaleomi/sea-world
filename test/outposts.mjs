// The quest givers' homes on the outer islands (src/world/village/Outposts.js): everyone gets one near where
// they stand, none blocks the giver or the way down to the boat, and Eagle Rock has its lighthouse up on
// the cliff. CPU only: the buildings go into a GeoBuilder, nothing is uploaded.
import { TerrainData } from '../src/world/TerrainData.js';
import { OUTER_ISLANDS } from '../src/world/islands/index.js';
import { OuterIsland } from '../src/world/terrain/OuterIsland.js';
import { Builder } from '../src/world/village/GeoBuilder.js';
import { InstancedProps, Rand } from '../src/world/Props.js';
import { Colliders } from '../src/world/Colliders.js';
import { mulberry32 } from '../src/util/Noise.js';
import { buildOutposts } from '../src/world/village/Outposts.js';
import { GIVERS, beachSpot } from '../src/game/Quests.js';

let fails = 0;
const check = ( ok, msg ) => {

	console.log( ( ok ? 'ok   ' : 'FAIL ' ) + msg );
	if ( ! ok ) fails ++;

};

const data = new TerrainData();
data.outer = OUTER_ISLANDS.map( ( d ) => new OuterIsland( d ) );
const B = new Builder();
const lights = [], footprints = [];
const ctx = { B, terrain: data, colliders: new Colliders(), rand: new Rand( mulberry32( 5 ) ), lights, inst: new InstancedProps( B ), checks: [] };
const posts = buildOutposts( ctx, data.outer, footprints );

for ( const g of Object.values( GIVERS ) ) {

	const p = posts.find( ( q ) => q.id === g.id );
	check( !! p, `${ g.id }: has a home on ${ g.island }` );
	if ( ! p ) continue;
	const o = data.outer.find( ( q ) => q.id === g.island );
	const s = beachSpot( o, 0, 0 );
	const d = Math.hypot( p.x - s.x, p.z - s.z );
	check( d > 7 && d < 40, `${ g.id }: home ${ d.toFixed( 1 ) } m from where they stand (close, not on top of them)` );
	const f = footprints.find( ( q ) => q.x === p.x && q.z === p.z );
	check( f && Math.hypot( s.x - f.x, s.z - f.z ) > f.r, `${ g.id }: the giver's spot is outside the house` );
	// the way from the giver straight out to sea is clear of every building
	const dx = Math.sin( s.yaw ), dz = Math.cos( s.yaw );
	let clear = true;
	for ( let t = 0; t < 14; t += 1 ) for ( const q of footprints ) if ( q.kind === 'building' && Math.hypot( s.x + dx * t - q.x, s.z + dz * t - q.z ) < q.r - 0.5 ) clear = false;
	check( clear, `${ g.id }: nothing built between them and the water` );
	check( p.floorY > data.heightAt( p.x, p.z ) - 0.5 && p.floorY > 1.8, `${ g.id }: floor at ${ p.floorY.toFixed( 1 ) } m, above the ground and the tide` );

}

const lh = posts.find( ( q ) => q.kind === 'lighthouse' );
check( lh && lh.island === 'mesa', 'a lighthouse on Eagle Rock' );
if ( lh ) {

	check( lh.floorY > 50, `it stands on the cliff top (${ lh.floorY.toFixed( 0 ) } m)` );
	check( lights.some( ( l ) => l.kind === 'beacon' && Math.abs( l.position.y - lh.top ) < 0.01 ), 'its lamp is a light source' );

}

check( B.triangles > 0 && B.triangles < 400000, `geometry: ${ B.triangles } triangles` );
console.log( fails ? `\n${ fails } failed` : '\nall passed' );
process.exit( fails ? 1 : 0 );
