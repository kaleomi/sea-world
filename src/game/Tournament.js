import { FISH } from './FishTable.js';
import { TIER_SPECIES } from './Orders.js';

// Fishing tournaments, entered at Joe's stand: pay the fee, then fish against the clock and three
// local rivals. Three kinds: the heaviest single fish, the heaviest bag (total weight landed) and the
// heaviest of one named species. Every fish counts at the moment it is landed, even one you let go
// for want of room, and the legends count too. Finish in the top three for a share of the purse;
// a win moves you up to the next league (bigger fees, purses and rivals).
// Plain data and pure functions (no DOM, no GPU) so node can test them; GameState keeps the league
// in the save, Game runs the clock and GameHUD shows the board.

export const KINDS = [ 'heaviest', 'bag', 'species' ];
export const DURATION = 300; // s of play (the clock runs while you fish, not while the game is closed)

// par: what a good rival manages: kg for heaviest and bag, the fraction of the species' weight
// range for species
export const LEAGUES = [
	{ name: 'Harbour Cup', fee: 20, purse: [ 120, 60, 20 ], par: { heaviest: 2.5, bag: 6, species: 0.5 }, pools: [ 0, 1 ] },
	{ name: 'Island Derby', fee: 80, purse: [ 450, 200, 80 ], par: { heaviest: 7, bag: 18, species: 0.6 }, pools: [ 1, 2 ] },
	{ name: 'Tidewater Open', fee: 250, purse: [ 1400, 600, 250 ], par: { heaviest: 14, bag: 40, species: 0.7 }, pools: [ 2, 3 ] },
];

// the rivals: how well each one tends to do against par
export const RIVALS = [
	{ name: 'Old Tom', skill: 0.75 },
	{ name: 'Marisol', skill: 0.95 },
	{ name: 'Kai', skill: 1.12 },
];

// a fresh record: no tournament running, the Harbour Cup on offer
export function newCircuit() {

	return { league: 0, entered: 0, wins: 0, offer: null, active: null, last: null };

}

// a circuit from a save: anything broken is dropped
export function circuitFromJSON( d ) {

	const c = newCircuit();
	if ( ! d || typeof d !== 'object' ) return c;
	c.league = Math.min( LEAGUES.length - 1, Math.max( 0, d.league | 0 ) );
	c.entered = Math.max( 0, d.entered | 0 );
	c.wins = Math.max( 0, d.wins | 0 );
	if ( validEvent( d.offer ) ) c.offer = d.offer;
	if ( validEvent( d.active ) && Number.isFinite( d.active.left ) && Number.isFinite( d.active.score ) && Array.isArray( d.active.rivals ) ) c.active = d.active;
	if ( d.last && typeof d.last === 'object' && Number.isFinite( d.last.place ) ) c.last = d.last;
	return c;

}

function validEvent( e ) {

	return !! e && KINDS.includes( e.kind ) && LEAGUES[ e.league ] && ( e.kind !== 'species' || !! FISH[ e.species ] );

}

// the next tournament on offer at the circuit's league: { kind, species, league }
export function makeOffer( circuit, rng = Math.random ) {

	const league = circuit.league;
	const kind = KINDS[ Math.floor( rng() * KINDS.length ) ];
	let species = null;
	if ( kind === 'species' ) {

		const pool = LEAGUES[ league ].pools.flatMap( ( i ) => TIER_SPECIES[ i ] ).filter( ( id ) => FISH[ id ].kg[ 1 ] >= 0.3 );
		species = pool[ Math.floor( rng() * pool.length ) ];

	}

	return { kind, species, league };

}

// what par means for an event, in the event's score units (kg)
export function parScore( ev ) {

	const L = LEAGUES[ ev.league ];
	if ( ev.kind !== 'species' ) return L.par[ ev.kind ];
	const f = FISH[ ev.species ];
	return f.kg[ 0 ] + ( f.kg[ 1 ] - f.kg[ 0 ] ) * L.par.species;

}

// a rival's day: the times (0..1 of the clock) they weigh in and their score after each, ending at
// their final score. Heaviest-fish kinds jump at each better fish; a bag grows catch by catch.
function rivalDay( ev, rival, rng ) {

	const par = parScore( ev );
	const final = Math.round( par * rival.skill * ( 0.85 + rng() * 0.3 ) * 100 ) / 100;
	const n = ev.kind === 'bag' ? 5 + Math.floor( rng() * 4 ) : 2 + Math.floor( rng() * 3 );
	const at = [];
	for ( let i = 0; i < n; i ++ ) at.push( 0.05 + rng() * 0.9 );
	at.sort( ( a, b ) => a - b );
	const steps = at.map( ( a, i ) => ( { at: Math.round( a * 1000 ) / 1000, score: i === n - 1 ? final : Math.round( final * ( ev.kind === 'bag' ? ( i + 1 ) / n * ( 0.9 + rng() * 0.1 ) : 0.45 + 0.5 * ( i + 1 ) / n * rng() ) * 100 ) / 100 } ) );
	// never going down
	for ( let i = 1; i < steps.length; i ++ ) steps[ i ].score = Math.max( steps[ i ].score, steps[ i - 1 ].score );
	return { name: rival.name, steps };

}

// a rival's score with `progress` (0..1) of the clock gone
export function rivalScore( r, progress ) {

	let s = 0;
	for ( const st of r.steps ) if ( st.at <= progress ) s = st.score;
	return s;

}

// enter the tournament on offer: { ...offer, left, score, rivals } or null when there is none
export function enter( circuit, rng = Math.random ) {

	if ( circuit.active || ! circuit.offer ) return null;
	const ev = circuit.offer;
	circuit.active = { ...ev, left: DURATION, score: 0, rivals: RIVALS.map( ( r ) => rivalDay( ev, r, rng ) ) };
	circuit.offer = null;
	circuit.entered ++;
	return circuit.active;

}

// a fish landed during the tournament: does it count, and the new score
export function weighIn( circuit, species, kg ) {

	const a = circuit.active;
	if ( ! a || a.left <= 0 ) return false;
	if ( a.kind === 'species' && species !== a.species ) return false;
	const before = a.score;
	a.score = Math.round( ( a.kind === 'bag' ? a.score + kg : Math.max( a.score, kg ) ) * 100 ) / 100;
	return a.score > before;

}

// the standings now: [ { name, score, you } ] best first (you win ties)
export function standings( circuit ) {

	const a = circuit.active;
	if ( ! a ) return [];
	const p = 1 - a.left / DURATION;
	const rows = a.rivals.map( ( r ) => ( { name: r.name, score: rivalScore( r, p ), you: false } ) );
	rows.push( { name: null, score: a.score, you: true } );
	return rows.sort( ( x, y ) => y.score - x.score || ( y.you ? 1 : 0 ) - ( x.you ? 1 : 0 ) );

}

// your place now, 1-based
export function place( circuit ) {

	return standings( circuit ).findIndex( ( r ) => r.you ) + 1;

}

// run the clock; when it runs out the tournament ends: returns the result
// { place, prize, league, promoted, kind, species, score } once, else null
export function tick( circuit, dt ) {

	const a = circuit.active;
	if ( ! a ) return null;
	a.left = Math.max( 0, a.left - dt );
	if ( a.left > 0 ) return null;
	const pl = place( circuit );
	const prize = LEAGUES[ a.league ].purse[ pl - 1 ] || 0;
	let promoted = false;
	if ( pl === 1 ) {

		circuit.wins ++;
		if ( a.league === circuit.league && circuit.league < LEAGUES.length - 1 ) {

			circuit.league ++;
			promoted = true;

		}

	}

	const result = { place: pl, prize, league: a.league, promoted, kind: a.kind, species: a.species, score: a.score };
	circuit.last = result;
	circuit.active = null;
	return result;

}

// give up the tournament running (the fee is not returned)
export function withdraw( circuit ) {

	if ( ! circuit.active ) return false;
	circuit.active = null;
	return true;

}
