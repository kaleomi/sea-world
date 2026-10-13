// Plain-node tests of the archipelago (no GPU, no DOM): the island data, the generated outer
// islands (shape, seams with the open sea, reef queries) and which fish bite in whose water.
// src/world/islands/, src/world/terrain/OuterIsland.js, src/game/Bites.js, src/game/Game.js (islandAt).
import { ISLANDS, HOME_ISLAND, OUTER_ISLANDS, OPEN_SEA, islandById } from '../src/world/islands/index.js';
import { OuterIsland } from '../src/world/terrain/OuterIsland.js';
import { FISH, FISH_IDS } from '../src/game/FishTable.js';
import { LEGENDS, LEGEND_IDS, rollLegend } from '../src/game/Legends.js';
import { habitatAt, pickSpecies } from '../src/game/Bites.js';
import { Game } from '../src/game/Game.js';
import { scatterIsland } from '../src/world/vegetation/IslandScatter.js';
import { beachSpot } from '../src/game/Quests.js';

let fails = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else console.log( 'ok  ', msg );

};

function seeded( s ) {

	return () => ( ( s = ( s * 1664525 + 1013904223 ) >>> 0 ) / 4294967296 );

}

const HOME_HALF = 1024; // the home island's grid (TerrainData: 2048 m round the origin)
const all = Object.values( ISLANDS );

// ---- the data
ok( islandById( HOME_ISLAND ).id === HOME_ISLAND && islandById( 'nowhere' ).id === HOME_ISLAND, 'unknown ids fall back to the home island' );
ok( OUTER_ISLANDS.length >= 2 && OUTER_ISLANDS.every( ( d ) => d.position && d.terrain && d.name ), 'at least two outer islands, each placed and with a terrain recipe' );
ok( [ ...all, OPEN_SEA ].every( ( d ) => ( d.species || [] ).every( ( id ) => FISH[ id ] ) && ( d.legends || [] ).every( ( id ) => LEGENDS[ id ] ) ), 'species and legend ids are real' );
const caught = new Set( [ ...all, OPEN_SEA ].flatMap( ( d ) => d.species || FISH_IDS ) );
ok( FISH_IDS.every( ( id ) => caught.has( id ) ), 'every species bites somewhere' );
const homes = ( id ) => all.filter( ( d ) => ( d.legends || LEGEND_IDS ).includes( id ) );
ok( LEGEND_IDS.every( ( id ) => homes( id ).length === 1 ), 'every legend hunts round exactly one island' );
ok( LEGEND_IDS.every( ( id ) => homes( id ).every( ( d ) => ! d.species || d.species.includes( LEGENDS[ id ].species ) ) ), "a legend's species lives at its island" );
ok( OUTER_ISLANDS.some( ( d ) => d.legends.length ) && OUTER_ISLANDS.some( ( d ) => d.species.some( ( s ) => ! islandById( HOME_ISLAND ).species.includes( s ) ) ) || OPEN_SEA.species.some( ( s ) => ! islandById( HOME_ISLAND ).species.includes( s ) ), 'the trip out pays: fish and legends the home island lacks' );

// grids: clear of the home grid and of each other, one resolution (they share a GPU texture array)
const rect = ( d ) => ( { x0: d.position.x - d.size / 2, z0: d.position.z - d.size / 2, x1: d.position.x + d.size / 2, z1: d.position.z + d.size / 2 } );
const overlap = ( a, b ) => a.x0 < b.x1 && b.x0 < a.x1 && a.z0 < b.z1 && b.z0 < a.z1;
const home = { x0: - HOME_HALF, z0: - HOME_HALF, x1: HOME_HALF, z1: HOME_HALF };
ok( OUTER_ISLANDS.every( ( d ) => ! overlap( rect( d ), home ) ), 'outer grids are clear of the home grid' );
ok( OUTER_ISLANDS.every( ( a, i ) => OUTER_ISLANDS.every( ( b, j ) => i === j || ! overlap( rect( a ), rect( b ) ) ) ), 'outer grids are clear of each other' );
ok( new Set( OUTER_ISLANDS.map( ( d ) => d.res ) ).size === 1, 'outer islands share one resolution' );
ok( OUTER_ISLANDS.every( ( d ) => Math.hypot( d.position.x, d.position.z ) < 4000 ), 'every island is in reach of a 40 L tank (and back)' );

// ---- the generated islands
const isl = Object.fromEntries( OUTER_ISLANDS.map( ( d ) => [ d.id, new OuterIsland( d ) ] ) );
console.log( '     generated', OUTER_ISLANDS.map( ( d ) => `${ d.id } ${ isl[ d.id ].ms.toFixed( 0 ) } ms` ).join( ', ' ) );
for ( const o of Object.values( isl ) ) {

	const { cx, cz, size } = o;
	let edge = - Infinity;
	for ( let t = - 0.5; t <= 0.5; t += 1 / 64 ) for ( const [ x, z ] of [ [ t, - 0.5 ], [ t, 0.5 ], [ - 0.5, t ], [ 0.5, t ] ] ) edge = Math.max( edge, o.heightAt( cx + x * ( size - 4 ), cz + z * ( size - 4 ) ) );
	ok( edge < - 60, `${ o.id }: the grid's rim is deep sea (highest ${ edge.toFixed( 1 ) } m), no step to the open sea floor` );
	ok( o.contains( cx, cz ) && ! o.contains( cx + size, cz ), `${ o.id }: contains() is its grid` );

}

{

	const o = isl.coral, T = o.def.terrain;
	const lagoon = o.heightAt( o.cx, o.cz );
	ok( lagoon < - 3 && lagoon > - 12, `atoll: the lagoon is shallow water (${ lagoon.toFixed( 1 ) } m)` );
	let land = 0, ringDepth = Infinity;
	for ( let a = 0; a < 360; a += 2 ) {

		const r = a * Math.PI / 180;
		let top = - Infinity;
		for ( let d = T.radius * 0.7; d < T.radius * 1.4; d += 4 ) top = Math.max( top, o.heightAt( o.cx + Math.cos( r ) * d, o.cz + Math.sin( r ) * d ) );
		if ( top > 0.5 ) land ++;
		ringDepth = Math.min( ringDepth, top );

	}

	ok( land > 10 && land < 170, `atoll: sandy islets on part of the ring (${ land } of 180 bearings)` );
	ok( ringDepth > - 3, `atoll: the reef flat is shallow all the way round (deepest crest ${ ringDepth.toFixed( 1 ) } m)` );
	const out = o.heightAt( o.cx + T.radius + 220, o.cz );
	ok( out < - 40, `atoll: the outer wall drops to deep water (${ out.toFixed( 0 ) } m)` );
	let onRing = 0, n = 0;
	for ( let a = 0; a < 360; a += 10 ) {

		const r = a * Math.PI / 180;
		let best = Infinity;
		for ( let d = T.radius * 0.8; d < T.radius * 1.25; d += 2 ) best = Math.min( best, o.reefDist( o.cx + Math.cos( r ) * d, o.cz + Math.sin( r ) * d ) );
		if ( best < 0 ) onRing ++;
		n ++;

	}

	ok( onRing === n, 'atoll: reefDist is negative on the ring at every bearing' );
	ok( o.reefDist( o.cx, o.cz ) > 100 && o.reefDist( o.cx + 480, o.cz ) > 60, 'atoll: and well positive in mid-lagoon and far outside' );

}

{

	const o = isl.ember, T = o.def.terrain;
	let peak = - Infinity;
	for ( let d = 0; d < T.radius; d += 6 ) for ( let a = 0; a < 6.28; a += 0.4 ) peak = Math.max( peak, o.heightAt( o.cx + Math.cos( a ) * d, o.cz + Math.sin( a ) * d ) );
	ok( peak > T.peak * 0.6, `volcano: a real mountain (${ peak.toFixed( 0 ) } m)` );
	ok( o.heightAt( o.cx, o.cz ) < peak - 20, 'volcano: a crater at the top' );
	let beach = 0;
	for ( let a = 0; a < 6.28; a += 0.2 ) {

		let wet = false, dry = false;
		for ( let d = T.radius * 0.6; d < T.radius * 1.6; d += 3 ) {

			const h = o.heightAt( o.cx + Math.cos( a ) * d, o.cz + Math.sin( a ) * d );
			if ( h > 0 && h < 2.5 ) dry = true;
			if ( h < 0 && h > - 2 ) wet = true;

		}

		if ( wet && dry ) beach ++;

	}

	ok( beach > 25, `volcano: a beach round most of the coast (${ beach } of 32 bearings)` );
	ok( o.heightAt( o.cx + T.radius + 300, o.cz ) < - 40, 'volcano: deep water off the shelf' );

}

// ---- the four newer recipes: crescent, cluster, mesa, bar
const ring = ( o, r, fn ) => {

	let n = 0;
	for ( let a = - Math.PI; a < Math.PI; a += Math.PI / 90 ) if ( fn( o.cx + Math.cos( a ) * r, o.cz + Math.sin( a ) * r, a ) ) n ++;
	return n;

};
const wrap = ( a ) => Math.atan2( Math.sin( a ), Math.cos( a ) );
{

	const o = isl.crescent, T = o.def.terrain;
	const mouth = o.heightAt( o.cx + Math.cos( T.opening ) * T.radius, o.cz + Math.sin( T.opening ) * T.radius );
	const back = o.heightAt( o.cx - Math.cos( T.opening ) * T.radius, o.cz - Math.sin( T.opening ) * T.radius );
	ok( mouth < - 3 && back > T.peak * 0.6, `crescent: open water at the mouth (${ mouth.toFixed( 1 ) } m), a ridge at the back (${ back.toFixed( 0 ) } m)` );
	const bay = o.heightAt( o.cx, o.cz );
	ok( bay < - 3 && bay > - 12, `crescent: a sheltered bay of sailing depth inside (${ bay.toFixed( 1 ) } m)` );
	ok( ring( o, T.radius, ( x, z, a ) => o.heightAt( x, z ) > 0 ) > 100 && ring( o, T.radius, ( x, z, a ) => Math.abs( wrap( a - T.opening ) ) < 0.4 && o.heightAt( x, z ) > 0 ) === 0, 'crescent: land round most of the ring, none in the mouth' );

}

{

	const o = isl.skerries;
	ok( o.islets.length >= 5, `cluster: ${ o.islets.length } islets` );
	ok( o.islets.every( ( I ) => o.heightAt( o.cx + I.x, o.cz + I.z ) > 2 ), 'cluster: every islet is dry land in the middle' );
	let wet = 0;
	for ( let i = 0; i < o.islets.length; i ++ ) for ( let j = i + 1; j < o.islets.length; j ++ ) {

		const A = o.islets[ i ], B = o.islets[ j ];
		if ( o.heightAt( o.cx + ( A.x + B.x ) / 2, o.cz + ( A.z + B.z ) / 2 ) < - 1 ) wet ++;

	}

	ok( wet > o.islets.length, `cluster: channels of water between the islets (${ wet } pairs)` );
	let reef = 0;
	for ( let i = 0; i < 4000; i ++ ) {

		const x = o.cx + ( ( i % 64 ) / 64 - 0.5 ) * 700, z = o.cz + ( Math.floor( i / 64 ) / 64 - 0.5 ) * 700;
		if ( o.reefDist( x, z ) < 0 && o.heightAt( x, z ) < 0 ) reef ++;

	}

	ok( reef > 60, `cluster: reef patches round the islets (${ reef } of 4000 samples)` );

}

{

	const o = isl.mesa, T = o.def.terrain;
	ok( o.heightAt( o.cx, o.cz ) > T.height * 0.8, `mesa: a high plateau (${ o.heightAt( o.cx, o.cz ).toFixed( 0 ) } m)` );
	// the cliff: from the top to the sea in a few tens of metres, away from the cove
	let cliffs = 0;
	for ( let a = - Math.PI; a < Math.PI; a += 0.2 ) {

		if ( Math.abs( wrap( a - T.cove ) ) < 1 ) continue;
		let topR = 0, seaR = 0;
		for ( let r = 0; r < T.radius * 1.6; r += 2 ) {

			const h = o.heightAt( o.cx + Math.cos( a ) * r, o.cz + Math.sin( a ) * r );
			if ( h > T.height * 0.7 ) topR = r;
			if ( h < 0 && ! seaR ) seaR = r;

		}

		if ( seaR - topR < 60 ) cliffs ++;

	}

	ok( cliffs > 12, `mesa: sea cliffs round it (${ cliffs } bearings drop to the sea within 60 m)` );
	ok( o.stacks.length >= 3 && o.stacks.every( ( S ) => o.heightAt( o.cx + S.x, o.cz + S.z ) > 12 ), `mesa: ${ o.stacks.length } sea stacks standing out of the water` );
	const s = beachSpot( o, 0, 0 );
	ok( s && Math.abs( wrap( Math.atan2( s.z - o.cz, s.x - o.cx ) - T.cove ) ) < 0.6, 'mesa: the landing beach is in the cove' );

}

{

	const o = isl.longcay, T = o.def.terrain;
	let land = 0, xs = [];
	for ( let u = - T.length / 2; u <= T.length / 2; u += 10 ) {

		const x = o.cx + Math.cos( T.axis ) * u, z = o.cz + Math.sin( T.axis ) * u;
		let top = - Infinity;
		for ( let v = - 120; v <= 120; v += 2 ) top = Math.max( top, o.heightAt( x - Math.sin( T.axis ) * v, z + Math.cos( T.axis ) * v ) );
		if ( top > 0.5 ) land ++;
		xs.push( top );

	}

	ok( land > xs.length * 0.75 && Math.max( ...xs ) < T.dune + 4, `bar: a long low cay (${ land } of ${ xs.length } sections dry, highest ${ Math.max( ...xs ).toFixed( 1 ) } m)` );
	const side = ( sign ) => {

		let s = 0, n = 0;
		for ( let u = - 200; u <= 200; u += 20 ) for ( let v = 100; v <= 180; v += 20 ) {

			const vv = v * sign;
			s += o.heightAt( o.cx + Math.cos( T.axis ) * u - Math.sin( T.axis ) * vv, o.cz + Math.sin( T.axis ) * u + Math.cos( T.axis ) * vv );
			n ++;

		}

		return s / n;

	};
	const lee = side( T.lee ), wind = side( - T.lee );
	ok( lee > - 3 && lee < - 0.3 && wind < lee - 4, `bar: wide shallow flats on the lee (${ lee.toFixed( 1 ) } m), deeper water to windward (${ wind.toFixed( 1 ) } m)` );

}

// ---- vegetation (world/vegetation/IslandScatter.js)
for ( const o of Object.values( isl ) ) {

	const v = scatterIsland( o );
	const all = Object.values( v ).flat();
	// (the mesa is cliffs all round: palms only in its cove and on the odd beach under the cliffs)
	ok( v.palms.length > ( o.def.terrain.kind === 'mesa' ? 20 : 100 ), `${ o.id }: palm groves (${ v.palms.length } palms)` );
	ok( all.every( ( r ) => o.heightAt( r.x, r.z ) > 1.5 && Math.abs( r.y - o.heightAt( r.x, r.z ) ) < 1.5 ), `${ o.id }: every plant (${ all.length }) stands on dry land, on the ground` );
	const seaward = v.palms.filter( ( r ) => {

		const out = Math.atan2( r.z - o.cz, r.x - o.cx );
		return Math.cos( r.la - out ) > 0;

	} ).length;
	// (on the atoll's islets the water is on both sides: the lagoon's and the ocean's)
	if ( o.def.terrain.kind === 'volcanic' ) ok( seaward > v.palms.length * 0.7, `${ o.id }: palms lean out to sea (${ seaward } of ${ v.palms.length })` );
	ok( JSON.stringify( scatterIsland( o ) ) === JSON.stringify( v ), `${ o.id }: the same island grows the same plants every time` );

}

{

	const v = scatterIsland( isl.ember );
	ok( v.trees.length > 1000 && v.ferns.length > 1000, `volcano: a forest (${ v.trees.length } trees, ${ v.ferns.length } ferns under them)` );
	ok( v.trees.every( ( r ) => r.y < isl.ember.def.terrain.peak * 0.75 ), 'volcano: the top stays bare' );
	ok( scatterIsland( isl.coral ).trees.length === 0, 'atoll: palms and scrub only, no forest on the islets' );
	ok( scatterIsland( isl.mesa ).trees.filter( ( r ) => r.y > isl.mesa.def.terrain.height * 0.8 ).length > 500, 'mesa: a forest on the plateau top (its treeline is above it)' );

}

// ---- who bites where
const rng = seeded( 5 );
const draws = ( hab, ids, n = 400 ) => {

	const s = new Set();
	for ( let i = 0; i < n; i ++ ) s.add( pickSpecies( hab, 12, rng, ids ) );
	return s;

};
const coral = islandById( 'coral' ), ember = islandById( 'ember' );
const reefWater = habitatAt( { depth: 4, reefDist: - 5, pierDist: Infinity } );
ok( [ ...draws( reefWater, coral.species ) ].every( ( s ) => s === null || coral.species.includes( s ) ), 'on the atoll reef only atoll species bite' );
ok( ! [ ...draws( habitatAt( { depth: 3, reefDist: 50, pierDist: 1 } ), islandById( HOME_ISLAND ).species ) ].some( ( s ) => s === 'tuna' || s === 'mahi' ), 'no pelagics off the home pier' );
ok( draws( habitatAt( { depth: 60, reefDist: 999, pierDist: Infinity } ), OPEN_SEA.species ).has( 'tuna' ), 'tuna out in the open sea' );
const night = { habitat: reefWater, hour: 23, rain: 0, tide: { level: 0, amplitude: 0.6 } };
let ghostHome = 0, ghostCoral = 0;
for ( let i = 0; i < 4000; i ++ ) {

	if ( rollLegend( night, {}, rng, islandById( HOME_ISLAND ).legends ) === 'reefGhost' ) ghostHome ++;
	if ( rollLegend( night, {}, rng, coral.legends ) === 'reefGhost' ) ghostCoral ++;

}

ok( ghostHome === 0 && ghostCoral > 0, `the Reef Ghost hunts the atoll at night, not the home reef (${ ghostCoral } / 4000)` );
ok( ember.legends.includes( 'bigRed' ) && ! islandById( HOME_ISLAND ).legends.includes( 'bigRed' ), 'Big Red lives off Ember Island' );

// Game.islandAt: whose water a point is in
const fakeGame = { app: { terrainData: { size: 2 * HOME_HALF, outerAt: ( x, z ) => Object.values( isl ).find( ( o ) => o.contains( x, z ) ) || null } } };
const at = ( x, z ) => Game.prototype.islandAt.call( fakeGame, x, z ).id;
ok( at( 0, 0 ) === HOME_ISLAND && at( 900, - 900 ) === HOME_ISLAND, 'islandAt: the home grid is the home island' );
ok( at( coral.position.x, coral.position.z ) === 'coral' && at( ember.position.x + 100, ember.position.z ) === 'ember', 'islandAt: an outer grid is that island' );
ok( at( 1500, 0 ) === OPEN_SEA.id, 'islandAt: between them is the open sea' );

console.log( fails ? `\n${ fails } failed` : '\nall passed' );
process.exit( fails ? 1 : 0 );
