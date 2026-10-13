// Plain-node tests of the fish log as a collection (no GPU, no DOM): medals, milestones that pay once,
// the hints for species not caught yet, and the collection through GameState and its save.
// src/game/Collection.js, src/game/GameState.js.
import { FISH, FISH_IDS } from '../src/game/FishTable.js';
import { rollWeight } from '../src/game/Bites.js';
import { medalFor, medalKg, MILESTONES, collectionStats, newMilestones, nextMilestones, whereToFind } from '../src/game/Collection.js';
import { GameState } from '../src/game/GameState.js';

let fails = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else console.log( 'ok  ', msg );

};

// ---- medals
const g = FISH.grunt.kg;
ok( medalFor( 'grunt', g[ 0 ] ) === 1 && medalFor( 'grunt', medalKg( 'grunt', 2 ) ) === 2 && medalFor( 'grunt', g[ 1 ] ) === 3, 'smallest: bronze, at the silver weight: silver, the biggest: gold' );
ok( medalFor( 'grunt', medalKg( 'grunt', 3 ) - 0.01 ) === 2 && medalFor( 'grunt', 0 ) === 0 && medalFor( 'kraken', 5 ) === 0, 'just under gold is silver; nothing caught or unknown: no medal' );
{

	// how often a medal comes from a random fish (sizes are skewed small)
	let silver = 0, gold = 0;
	const N = 20000;
	let x = 9;
	const rng = () => ( ( x = ( x * 1664525 + 1013904223 ) >>> 0 ) / 4294967296 );
	for ( let i = 0; i < N; i ++ ) {

		const m = medalFor( 'jack', rollWeight( 'jack', rng ) );
		if ( m >= 2 ) silver ++;
		if ( m === 3 ) gold ++;

	}

	ok( silver / N > 0.25 && silver / N < 0.45 && gold / N > 0.08 && gold / N < 0.18, `silver or better ${ ( silver / N * 100 ).toFixed( 0 ) }%, gold ${ ( gold / N * 100 ).toFixed( 0 ) }% of catches` );

}

// ---- milestones
const logOf = ( ids, frac = 0 ) => Object.fromEntries( ids.map( ( id ) => [ id, { count: 1, bestKg: FISH[ id ].kg[ 0 ] + ( FISH[ id ].kg[ 1 ] - FISH[ id ].kg[ 0 ] ) * frac } ] ) );
ok( collectionStats( {} ).species === 0 && newMilestones( {}, [] ).length === 0, 'an empty log: nothing' );
const five = logOf( FISH_IDS.slice( 0, 5 ) );
ok( newMilestones( five, [] ).map( ( m ) => m.id ).join() === 'species5', 'five species: the first milestone' );
ok( newMilestones( five, [ 'species5' ] ).length === 0, 'a milestone pays once' );
const all = logOf( FISH_IDS, 1 );
ok( newMilestones( all, [] ).length === MILESTONES.length && collectionStats( all ).gold === FISH_IDS.length, 'every species at gold reaches every milestone' );
ok( nextMilestones( five, [ 'species5' ] ).map( ( m ) => `${ m.id }:${ m.have }` ).join() === 'species10:5,gold3:0', 'next goals: the next species and gold milestones with progress' );
ok( MILESTONES.every( ( m, i ) => i === 0 || MILESTONES[ i - 1 ].kind !== m.kind || ( m.n > MILESTONES[ i - 1 ].n && m.reward > MILESTONES[ i - 1 ].reward ) ), 'later milestones need more and pay more' );

// ---- hints
ok( FISH_IDS.every( ( id ) => whereToFind( id ).waters.length > 0 ), 'every species has somewhere to look' );
ok( whereToFind( 'tuna' ).waters.join() === 'deep' && whereToFind( 'tarpon' ).time === 'night', 'tuna in deep water, tarpon at night' );

// ---- through GameState
{

	const m = new Map();
	const store = { getItem: ( k ) => m.get( k ) ?? null, setItem: ( k, v ) => m.set( k, v ) };
	const st = new GameState( store );
	for ( const id of FISH_IDS.slice( 0, 4 ) ) st.addFish( id, FISH[ id ].kg[ 0 ] );
	ok( st.money === 0 && st.lastCatch.milestones.length === 0, 'four species: no bonus yet' );
	st.addFish( FISH_IDS[ 4 ], FISH[ FISH_IDS[ 4 ] ].kg[ 0 ] );
	ok( st.money === 40 && st.lastCatch.milestones[ 0 ].id === 'species5' && st.claimed.join() === 'species5', 'the fifth species pays $40 on the catch' );
	st.addFish( FISH_IDS[ 0 ], FISH[ FISH_IDS[ 0 ] ].kg[ 0 ] );
	ok( st.money === 40 && st.lastCatch.medal === 1 && ! st.lastCatch.medalUp, 'another small one: no new medal, no second payout' );
	st.addFish( 'jack', FISH.jack.kg[ 1 ] );
	ok( st.lastCatch.medal === 3 && st.lastCatch.medalUp, 'a big one of a new species: straight to gold' );
	st.addFish( 'grunt', medalKg( 'grunt', 2 ) + 0.01 );
	ok( st.lastCatch.medalUp && st.lastCatch.medal === 2, 'a bigger grunt upgrades its medal' );
	const back = new GameState( store );
	ok( back.load() && back.claimed.join() === 'species5', 'paid milestones survive a save' );
	const old = new GameState( { getItem: () => JSON.stringify( { v: 1, money: 0, inventory: [], log: logOf( FISH_IDS.slice( 0, 6 ) ), upgrades: {}, fuel: null, nextId: 1 } ), setItem: () => {} } );
	old.load();
	old.addFish( 'tuna', 4 );
	ok( old.money === 40 && old.claimed.join() === 'species5', 'a save from before the collection gets its milestone with the next catch' );

}

console.log( fails ? `${ fails } FAILED` : 'all passed' );
process.exit( fails ? 1 : 0 );
