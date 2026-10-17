// Ocean zones (src/game/Zones.js) and the open-ocean fish: which zone a spot is in, the depth the fish
// finder reads, what bites where, and that each zone's fish are worth more than the last's.
import { ZONES, zoneAt, openZoneWeights, trenchWeight, chartDepth, zoneHabitat, TRENCH, COASTAL_R, DEEP_R } from '../src/game/Zones.js';
import { habitatAt, pickSpecies } from '../src/game/Bites.js';
import { FISH, FISH_IDS, ZONE_FISH, fishValue } from '../src/game/FishTable.js';
import { SPECIES, SKIN, PATTERN } from '../src/world/fish/FishSpecies.js';
import { OPEN_SEA, ISLANDS } from '../src/world/islands/index.js';
import { whereToFind } from '../src/game/Collection.js';

let fails = 0;
const check = ( ok, msg ) => {

	console.log( ( ok ? 'ok   ' : 'FAIL ' ) + msg );
	if ( ! ok ) fails ++;

};

// a fixed sequence, so the bite counts below are the same on every run
function seeded( s ) {

	return () => ( ( s = ( s * 1664525 + 1013904223 ) >>> 0 ) / 4294967296 );

}

const TC = { x: Math.cos( TRENCH.angle ) * ( TRENCH.r0 + TRENCH.r1 ) / 2, z: Math.sin( TRENCH.angle ) * ( TRENCH.r0 + TRENCH.r1 ) / 2 };

// ---- which zone
check( zoneAt( 50, - 300, 2 ) === 'shallows', 'a 2 m spot is the shallows' );
check( zoneAt( 2900, 0, 20 ) === 'coastal', 'a 20 m shelf is coastal, even among the outer islands' );
check( zoneAt( 1500, 0, 90 ) === 'coastal', 'open water 1.5 km from home is coastal' );
check( zoneAt( 3000, 0, 90 ) === 'offshore', 'open water 3 km out is offshore' );
check( zoneAt( 4600, 1000, 90 ) === 'deep', 'open water 4.7 km out is the deep sea' );
check( zoneAt( TC.x, TC.z, 90 ) === 'trench', `the trench centre (${ Math.round( TC.x ) }, ${ Math.round( TC.z ) }) is the trench` );
check( TC.x > 0 && TC.z < 0, 'the trench lies north-east of home (-z is north)' );
check( zoneAt( - TC.x, - TC.z, 90 ) === 'deep', 'the same distance the other way is only the deep sea' );
check( zoneAt( TC.x * 1.3, TC.z * 1.3, 90 ) === 'deep', 'beyond the trench is the deep sea again' );
check( ZONES.map( ( z ) => z.id ).join() === 'shallows,coastal,offshore,deep,trench', 'five zones, near to far' );

// the island ring sits in the offshore zone, clear of the deep sea
for ( const d of Object.values( ISLANDS ) ) if ( d.position ) {

	const r = Math.hypot( d.position.x, d.position.z );
	check( r > COASTAL_R + 300 && r < DEEP_R - 300, `${ d.name } (${ Math.round( r ) } m out) is in the offshore ring` );

}

// weights: always a partition of 1, never negative
let worst = 0, neg = false;
for ( let i = 0; i < 4000; i ++ ) {

	const x = ( Math.random() - 0.5 ) * 14000, z = ( Math.random() - 0.5 ) * 14000;
	const w = openZoneWeights( x, z );
	worst = Math.max( worst, Math.abs( w.coastal + w.offshore + w.deep + w.trench - 1 ) );
	if ( Object.values( w ).some( ( v ) => v < - 1e-9 ) ) neg = true;

}

check( worst < 1e-9 && ! neg, 'open-water weights sum to 1 and are never negative' );
check( trenchWeight( 0, 0 ) === 0 && trenchWeight( TC.x, TC.z ) === 1, 'trench weight: 0 at home, 1 in the middle of it' );

// ---- chart depth
const d = ( x, z ) => chartDepth( x, z, 90 );
check( chartDepth( 10, 10, 12 ) === 12, 'on the shelf the chart reads the real depth' );
check( Math.abs( d( 1200, 0 ) - 90 ) < 1, `near home the open sea is 90 m (${ d( 1200, 0 ).toFixed( 0 ) })` );
check( d( 3000, 0 ) > 150 && d( 3000, 0 ) < 400, `among the outer islands a few hundred metres (${ d( 3000, 0 ).toFixed( 0 ) })` );
check( d( 5000, 0 ) > 1000, `the deep sea is over a kilometre (${ d( 5000, 0 ).toFixed( 0 ) })` );
check( d( TC.x, TC.z ) > 7000, `the trench is about 8 km deep (${ d( TC.x, TC.z ).toFixed( 0 ) })` );
let jump = 0;
for ( let r = 0; r < 7000; r += 10 ) jump = Math.max( jump, Math.abs( d( r * 0.6, - r * 0.8 ) - d( ( r + 10 ) * 0.6, - ( r + 10 ) * 0.8 ) ) );
check( jump < 400, `no cliffs in the chart along a line out through the trench (biggest 10 m step ${ jump.toFixed( 0 ) } m)` );

// ---- what bites
const bites = ( x, z, depth, ids, n = 3000 ) => {

	const h = zoneHabitat( habitatAt( { depth, reefDist: 999, pierDist: 999 } ), x, z, depth );
	const got = {}, rng = seeded( 7 );
	for ( let i = 0; i < n; i ++ ) {

		const s = pickSpecies( h, 7, rng, ids );
		got[ s ] = ( got[ s ] || 0 ) + 1;

	}

	return got;

};
const seaIds = OPEN_SEA.species.concat( ZONE_FISH );
const zoneOf = ( got ) => {

	const out = {};
	for ( const k in got ) {

		const z = k === 'null' ? 'none' : FISH[ k ].zone || 'coastal';
		out[ z ] = ( out[ z ] || 0 ) + got[ k ];

	}

	return out;

};
const near = zoneOf( bites( 1500, 0, 90, seaIds ) );
check( ! near.offshore && ! near.deep && ! near.trench, `1.5 km out only coastal fish bite (${ JSON.stringify( near ) })` );
const off = zoneOf( bites( 3000, 0, 90, seaIds ) );
check( off.offshore > 1500 && ! off.trench, `3 km out mostly offshore fish (${ JSON.stringify( off ) })` );
const deep = zoneOf( bites( 4600, 1000, 90, seaIds ) );
check( deep.deep > 1800 && ( deep.coastal || 0 ) < 400, `in the deep sea mostly deep fish (${ JSON.stringify( deep ) })` );
const tr = zoneOf( bites( TC.x, TC.z, 90, seaIds ) );
check( tr.trench > 2400 && ! tr.coastal, `in the trench mostly trench fish, no coastal ones (${ JSON.stringify( tr ) })` );
// an outer island's own list plus the zone fish: the island's shelf keeps its own fish
const cor = ISLANDS.coral;
const shelf = zoneOf( bites( cor.position.x, cor.position.z, 15, cor.species.concat( ZONE_FISH ) ) );
check( ! shelf.offshore && ! shelf.deep && ! shelf.trench, `on Coral Atoll's 15 m shelf only the island's fish (${ JSON.stringify( shelf ) })` );

// ---- the fish themselves
const typical = ( id ) => fishValue( id, FISH[ id ].kg[ 0 ] + ( FISH[ id ].kg[ 1 ] - FISH[ id ].kg[ 0 ] ) * 0.31 );
const mean = ( ids ) => ids.reduce( ( a, id ) => a + typical( id ), 0 ) / ids.length;
const coastalIds = [ 'redSnapper', 'grouper', 'tuna', 'mahi', 'barracuda', 'jack' ];
const by = ( z ) => ZONE_FISH.filter( ( id ) => FISH[ id ].zone === z );
const m = { coastal: mean( coastalIds ), offshore: mean( by( 'offshore' ) ), deep: mean( by( 'deep' ) ), trench: mean( by( 'trench' ) ) };
check( by( 'offshore' ).length === 4 && by( 'deep' ).length === 4 && by( 'trench' ).length === 4, 'four new fish in each of the three far zones' );
check( m.offshore > m.coastal * 1.5 && m.deep > m.offshore * 1.5 && m.trench > m.deep * 1.5,
	`each zone's typical fish is worth well over the last's: $${ m.coastal.toFixed( 0 ) } → $${ m.offshore.toFixed( 0 ) } → $${ m.deep.toFixed( 0 ) } → $${ m.trench.toFixed( 0 ) }` );
const pats = new Set();
for ( const id of ZONE_FISH ) {

	const f = FISH[ id ], S = SPECIES[ f.model ];
	check( !! S && !! SKIN[ f.model ] && S.pattern === PATTERN[ f.model ] && ! pats.has( S.pattern ), `${ id }: own model, skin and pattern (${ S && S.pattern })` );
	pats.add( S.pattern );
	check( f.kg[ 1 ] <= 60, `${ id }: no heavier than the strongest line can hope for (${ f.kg[ 1 ] } kg)` );
	const w = whereToFind( id );
	check( w.waters.length > 0 && w.isles.length === 0, `${ id }: the fish log hints at its zone (${ w.waters.join() })` );

}

check( FISH_IDS.length === 30, `30 species in the fish log (${ FISH_IDS.length })` );

console.log( fails ? `\n${ fails } FAILED` : '\nall ok' );
process.exit( fails ? 1 : 0 );
