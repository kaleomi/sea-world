// Plain-node tests of the fishing tournaments (no GPU, no DOM): offers, entering, weighing in, the
// rivals and the clock, prizes and moving up a league, and the circuit in the save.
// src/game/Tournament.js, src/game/GameState.js.
import { FISH } from '../src/game/FishTable.js';
import { KINDS, DURATION, LEAGUES, RIVALS, newCircuit, circuitFromJSON, makeOffer, parScore, rivalScore, enter, weighIn, standings, place, tick, withdraw } from '../src/game/Tournament.js';
import { GameState } from '../src/game/GameState.js';

let fails = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else console.log( 'ok  ', msg );

};

function seeded( s ) {

	return () => ( ( s = ( s * 1664525 + 1013904223 ) >>> 0 ) / 4294967296 );

}

const memStore = () => {

	const m = new Map();
	return { getItem: ( k ) => m.get( k ) ?? null, setItem: ( k, v ) => m.set( k, v ) };

};

// ---- leagues and offers
ok( LEAGUES.every( ( L, i ) => i === 0 || ( L.fee > LEAGUES[ i - 1 ].fee && L.purse[ 0 ] > LEAGUES[ i - 1 ].purse[ 0 ] ) ), 'each league costs more and pays more' );
ok( LEAGUES.every( ( L ) => L.purse[ 0 ] > L.purse[ 1 ] && L.purse[ 1 ] > L.purse[ 2 ] && L.purse[ 2 ] >= L.fee ), 'the purse: first > second > third, and third gets the fee back' );
{

	const rng = seeded( 2 );
	const kinds = new Set();
	let sane = true;
	for ( let i = 0; i < 300; i ++ ) {

		const c = newCircuit();
		c.league = i % LEAGUES.length;
		const o = makeOffer( c, rng );
		kinds.add( o.kind );
		if ( o.league !== c.league || ( o.kind === 'species' ) !== !! o.species || ( o.species && ! FISH[ o.species ] ) ) sane = false;
		if ( ! ( parScore( o ) > 0 ) ) sane = false;

	}

	ok( sane && KINDS.every( ( k ) => kinds.has( k ) ), 'offers of every kind, at the circuit\'s league, a real species when one is named' );

}

// ---- one tournament, by hand
{

	const rng = seeded( 7 );
	const c = newCircuit();
	c.offer = { kind: 'heaviest', species: null, league: 0 };
	const a = enter( c, rng );
	ok( a && a.left === DURATION && a.score === 0 && a.rivals.length === RIVALS.length && ! c.offer && c.entered === 1, 'entering starts the clock against the rivals' );
	ok( enter( c, rng ) === null, 'one tournament at a time' );
	ok( a.rivals.every( ( r ) => r.steps.every( ( s, i ) => i === 0 || s.score >= r.steps[ i - 1 ].score ) ), 'rivals\' scores never go down' );
	ok( a.rivals.every( ( r ) => rivalScore( r, 0 ) === 0 && rivalScore( r, 1 ) === r.steps[ r.steps.length - 1 ].score ), 'rivals start at zero and end at their final score' );
	ok( weighIn( c, 'grunt', 0.8 ) && a.score === 0.8 && ! weighIn( c, 'grunt', 0.5 ) && a.score === 0.8, 'heaviest fish: a smaller one doesn\'t change the score' );
	ok( standings( c ).length === 4 && standings( c )[ 0 ].you, 'at the start you lead with any fish' );
	ok( tick( c, DURATION / 2 ) === null && a.left === DURATION / 2, 'half the clock gone: still running' );
	weighIn( c, 'jack', 40 );
	const r = tick( c, DURATION );
	ok( r && r.place === 1 && r.prize === LEAGUES[ 0 ].purse[ 0 ] && r.promoted && c.league === 1 && c.wins === 1 && ! c.active && c.last.place === 1, 'a monster wins: first prize and up to the next league' );
	ok( tick( c, 1 ) === null, 'the result comes once' );

}
{

	// a bag: everything adds up; a species event: only that species counts
	const c = newCircuit();
	c.offer = { kind: 'bag', species: null, league: 0 };
	enter( c, seeded( 1 ) );
	weighIn( c, 'grunt', 0.5 );
	weighIn( c, 'mullet', 1.25 );
	ok( c.active.score === 1.75, 'a bag adds every fish' );
	const d = newCircuit();
	d.offer = { kind: 'species', species: 'mullet', league: 0 };
	enter( d, seeded( 1 ) );
	ok( ! weighIn( d, 'grunt', 1 ) && weighIn( d, 'mullet', 0.9 ) && d.active.score === 0.9, 'a species event counts only that species' );
	// no fish at all: last, nothing paid, no promotion
	const e = newCircuit();
	e.offer = { kind: 'heaviest', species: null, league: 0 };
	enter( e, seeded( 3 ) );
	const res = tick( e, DURATION + 1 );
	ok( res.place === 4 && res.prize === 0 && ! res.promoted && e.league === 0, 'no fish: last place, no prize' );
	ok( weighIn( e, 'jack', 9 ) === false, 'nothing counts after the clock' );
	const f = newCircuit();
	f.offer = { kind: 'bag', species: null, league: 0 };
	enter( f, seeded( 4 ) );
	ok( withdraw( f ) && ! f.active && ! withdraw( f ), 'withdrawing ends it' );

}

// ---- the rivals are beatable but not pushovers: their finals sit around par
{

	const rng = seeded( 9 );
	let lo = Infinity, hi = 0;
	for ( let i = 0; i < 200; i ++ ) {

		const c = newCircuit();
		c.league = i % 3;
		c.offer = makeOffer( c, rng );
		const ev = c.offer;
		const a = enter( c, rng );
		const best = Math.max( ...a.rivals.map( ( r ) => rivalScore( r, 1 ) ) ) / parScore( ev );
		lo = Math.min( lo, best );
		hi = Math.max( hi, best );

	}

	ok( lo > 0.85 && hi < 1.35, `the winning rival lands ${ lo.toFixed( 2 ) }–${ hi.toFixed( 2 ) } × par` );

}

// ---- through GameState: fee, weigh-in on the catch, prize, save
{

	const store = memStore();
	const st = new GameState( store );
	st.rng = seeded( 5 );
	st.circuit.offer = { kind: 'heaviest', species: null, league: 0 };
	ok( st.enterTournament() === null, 'not enough money for the fee: no entry' );
	st.money = 50;
	ok( st.enterTournament() && st.money === 50 - LEAGUES[ 0 ].fee, 'entering pays the fee' );
	st.addFish( 'jack', 8.5, 12 );
	ok( st.lastCatch.tourney && st.lastCatch.tourney.counted && st.circuit.active.score === 8.5, 'a catch is weighed in and the card knows it' );
	st.addFish( 'tarpon', 40, 22 ); // no room in the cooler: still weighed in
	ok( ! st.lastCatch.kept && st.circuit.active.score === 40, 'a fish you let go still counts' );
	st.tickTournament( 10 );
	const back = new GameState( store );
	ok( back.load() && back.circuit.active && Math.abs( back.circuit.active.left - ( DURATION - 10 ) ) < 1e-6 && back.circuit.active.score === 40, 'a tournament in progress survives a reload' );
	const money = st.money;
	const r = st.tickTournament( DURATION );
	ok( r && r.place === 1 && st.money === money + LEAGUES[ 0 ].purse[ 0 ] && st.circuit.offer && st.circuit.offer.league === 1, 'the prize is paid and the next league\'s tournament goes on offer' );
	st.addFish( 'grunt', 0.5, 12 );
	ok( st.lastCatch.tourney === null, 'no tournament running: the card says nothing about one' );
	const old = new GameState( { getItem: () => JSON.stringify( { v: 1, money: 0, inventory: [], log: {}, upgrades: {}, fuel: null, nextId: 1 } ), setItem: () => {} } );
	ok( old.load() && old.circuit.league === 0 && old.circuit.offer && ! old.circuit.active, 'older saves start on the Harbour Cup with one on offer' );
	ok( circuitFromJSON( { league: 9, offer: { kind: 'species', species: 'kraken', league: 0 } } ).league === LEAGUES.length - 1 && circuitFromJSON( { offer: { kind: 'species', species: 'kraken', league: 0 } } ).offer === null, 'a broken circuit is repaired on load' );

}

console.log( fails ? `${ fails } FAILED` : 'all passed' );
process.exit( fails ? 1 : 0 );
