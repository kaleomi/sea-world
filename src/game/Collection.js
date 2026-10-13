import { FISH, FISH_IDS } from './FishTable.js';
import { t } from '../i18n/index.js';
import { ISLANDS, HOME_ISLAND, OPEN_SEA, islandById } from '../world/islands/index.js';

// The fish log as a collection: a medal per species for the biggest one you've landed, and
// milestones (so many species, so many gold medals) that pay out once. Everything is derived from
// GameState.log ({ species: { count, bestKg } }) plus the list of milestones already paid, so it
// needs no other state and old saves get their medals at once. Plain data, no DOM: node tests it.

// medals by where the best fish sits in the species' weight range (sizes are skewed small: about a
// third of catches reach silver, one in eight gold)
export const MEDALS = [ null, 'Bronze', 'Silver', 'Gold' ];
const SILVER_T = 0.4, GOLD_T = 0.75;

// 0 none, 1 bronze (caught one), 2 silver, 3 gold
export function medalFor( species, kg ) {

	const f = FISH[ species ];
	if ( ! f || ! ( kg > 0 ) ) return 0;
	const t = ( kg - f.kg[ 0 ] ) / ( f.kg[ 1 ] - f.kg[ 0 ] );
	return t >= GOLD_T - 1e-9 ? 3 : t >= SILVER_T - 1e-9 ? 2 : 1;

}

// the weight a medal needs (kg, rounded up to the 10 g the catch is weighed to), for the hint
export function medalKg( species, medal ) {

	const f = FISH[ species ];
	const t = medal >= 3 ? GOLD_T : medal === 2 ? SILVER_T : 0;
	return Math.ceil( ( f.kg[ 0 ] + ( f.kg[ 1 ] - f.kg[ 0 ] ) * t ) * 100 - 1e-6 ) / 100;

}

// each milestone pays once: `kind` counts species caught or gold medals
export const MILESTONES = [
	{ id: 'species5', kind: 'species', n: 5, reward: 40 },
	{ id: 'species10', kind: 'species', n: 10, reward: 120 },
	{ id: 'species15', kind: 'species', n: 15, reward: 300 },
	{ id: 'speciesAll', kind: 'species', n: FISH_IDS.length, reward: 800 },
	{ id: 'gold3', kind: 'gold', n: 3, reward: 150 },
	{ id: 'gold9', kind: 'gold', n: 9, reward: 500 },
	{ id: 'goldAll', kind: 'gold', n: FISH_IDS.length, reward: 1500 },
];

// { species, gold, medals: { id: 0..3 } } from a fish log
export function collectionStats( log ) {

	const medals = {};
	let species = 0, gold = 0;
	for ( const id of FISH_IDS ) {

		const e = log[ id ];
		const m = e && e.count > 0 ? medalFor( id, e.bestKg ) : 0;
		medals[ id ] = m;
		if ( m > 0 ) species ++;
		if ( m === 3 ) gold ++;

	}

	return { species, gold, medals };

}

// milestones reached but not yet in `claimed` (an array of ids)
export function newMilestones( log, claimed ) {

	const s = collectionStats( log );
	const have = new Set( claimed );
	return MILESTONES.filter( ( m ) => ! have.has( m.id ) && s[ m.kind ] >= m.n );

}

// the next milestone of each kind still to reach: [ { ...milestone, have } ]
export function nextMilestones( log, claimed ) {

	const s = collectionStats( log );
	const have = new Set( claimed );
	const out = [];
	for ( const kind of [ 'species', 'gold' ] ) {

		const m = MILESTONES.find( ( x ) => x.kind === kind && ! have.has( x.id ) && s[ kind ] < x.n );
		if ( m ) out.push( { ...m, have: s[ kind ] } );

	}

	return out;

}

// where and when a species bites, for the hint on a species not caught yet: { waters: [], time,
// isles: [] } (waters ordered by how much the species likes them, the weak ones left out; isles: the
// names of the other islands' waters it lives in when the home island has none)
export function whereToFind( species ) {

	const f = FISH[ species ];
	const waters = Object.entries( f.habitat ).filter( ( [ , w ] ) => w >= 0.3 ).sort( ( a, b ) => b[ 1 ] - a[ 1 ] ).map( ( [ k ] ) => k );
	const lives = ( d ) => ! d.species || d.species.includes( species );
	const isles = lives( islandById( HOME_ISLAND ) ) ? [] : [ ...Object.values( ISLANDS ), OPEN_SEA ].filter( lives ).map( ( d ) => d.name );
	return { waters, time: f.time, isles };

}

// a milestone just reached, for the toast and the catch card
export function milestoneText( m ) {

	return t( m.kind === 'gold' ? 'Fish log: {n} gold medals · ${v} bonus' : 'Fish log: {n} species · ${v} bonus', { n: m.n, v: m.reward } );

}
