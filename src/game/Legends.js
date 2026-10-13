import { FISH } from './FishTable.js';
import { t } from '../i18n/index.js';

// Legendary fish: a handful of named giants of species that already swim here. Each one only feeds
// in its own conditions (the right water, and a time of day, rain or a high tide), and even then it
// is a rare bite. Landing one is a fight that wants upgraded line; it pays Joe's bounty the first
// time, a smaller one after, and goes on the trophy wall in the fish log, not in the cooler.
// Plain data and pure functions (no DOM, no GPU) so node can test them; Game rolls the bite,
// GameState keeps the trophies in the save, GameHUD shows them.
//
//   species   the species it is a giant of (its model, habitat and fight)
//   kg        [ min, max ]: well beyond the species' normal range
//   waters    water types it hunts; the bobber's habitat weights in them must add up to WATER_MIN
//   time      'day' | 'dawnDusk' | 'night' | null (any time)
//   rain      0..1 the least rain it comes out in (0: any weather)
//   tide      'high': only in the upper part of the tide (always met when the tide is turned off)
//   bounty    $ for the first one; later ones pay REPEAT_BOUNTY of it
//   stamina, power   how much longer and harder it fights than its weight alone (CatchMinigame):
//             tuned so 30 lb braid lands most of them and the Silver King needs 60 lb
//   rumour    what the locals say: the hint before you've caught it
export const LEGENDS = {
	ironjaw: { name: 'Old Ironjaw', species: 'grouper', kg: [ 22, 30 ], waters: [ 'reef', 'deep' ], time: null, rain: 0.4, tide: null, bounty: 900, stamina: 1.6, power: 1.15,
		rumour: 'A grouper as big as a dinghy feeds on the reef when it rains.' },
	silverKing: { name: 'The Silver King', species: 'tarpon', kg: [ 46, 56 ], waters: [ 'pier', 'bay' ], time: 'night', rain: 0, tide: 'high', bounty: 1500, stamina: 1.8, power: 0.9,
		rumour: 'On a high tide at night, something huge rolls under the pier.' },
	bigRed: { name: 'Big Red', species: 'redSnapper', kg: [ 14, 18 ], waters: [ 'deep' ], time: 'dawnDusk', rain: 0, tide: null, bounty: 700, stamina: 1.6, power: 1.5,
		rumour: 'Off Ember Island, at first and last light, a red snapper the size of a door comes up from the deep.' },
	reefGhost: { name: 'The Reef Ghost', species: 'barracuda', kg: [ 24, 30 ], waters: [ 'reef' ], time: 'night', rain: 0, tide: null, bounty: 800, stamina: 1.5, power: 1,
		rumour: 'A pale barracuda hunts the reef of Coral Atoll after dark. Nobody has kept a line on it.' },
	thunderJack: { name: 'Thunder Jack', species: 'jack', kg: [ 16, 22 ], waters: [ 'shallows', 'pier', 'bay' ], time: null, rain: 0.8, tide: null, bounty: 600, stamina: 1.5, power: 1.15,
		rumour: 'In a thunderstorm the jacks go wild, and the biggest of them all comes inshore.' },
};

export const LEGEND_IDS = Object.keys( LEGENDS );

export const WATER_MIN = 0.4; // habitat weight the bobber needs in a legend's waters
export const FIRST_CHANCE = 0.05; // chance a bite is the legend, in its conditions, until you've landed it
export const REPEAT_CHANCE = 0.015; // after that
export const REPEAT_BOUNTY = 0.25;

// is it the time of day a legend feeds? hour 0..24
export function inTime( time, hour ) {

	if ( ! time ) return true;
	if ( time === 'night' ) return hour < 5.5 || hour > 19.5;
	if ( time === 'dawnDusk' ) return Math.abs( hour - 6.5 ) <= 1.5 || Math.abs( hour - 18.5 ) <= 1.5;
	return hour >= 7 && hour <= 18;

}

// high water: the upper part of the tide, or no tide at all. tide: { level, amplitude } (world/Tides.js)
export function highTide( tide ) {

	if ( ! tide || ! ( tide.amplitude > 0.05 ) ) return true;
	return tide.level >= 0.4 * tide.amplitude;

}

// the conditions a legend feeds in, each true / false: { water, time, rain, tide, all }
// where: { habitat, hour, rain (0..1), tide: { level, amplitude } }
export function conditions( id, { habitat, hour, rain = 0, tide = null } ) {

	const L = LEGENDS[ id ];
	let w = 0;
	for ( const k of L.waters ) w += habitat[ k ] || 0;
	const c = { water: w >= WATER_MIN, time: inTime( L.time, hour ), rain: rain >= L.rain - 1e-9, tide: L.tide !== 'high' || highTide( tide ) };
	c.all = c.water && c.time && c.rain && c.tide;
	return c;

}

// which legend (if any) takes the bait on this bite: an id or null. caught: { id: { count } };
// ids: the legends of this island (WORLD.island.legends), all by default
export function rollLegend( where, caught = {}, rng = Math.random, ids = LEGEND_IDS ) {

	for ( const id of ids ) {

		if ( ! conditions( id, where ).all ) continue;
		const p = caught[ id ] && caught[ id ].count > 0 ? REPEAT_CHANCE : FIRST_CHANCE;
		if ( rng() < p ) return id;

	}

	return null;

}

// its weight, skewed small like every fish
export function legendWeight( id, rng = Math.random ) {

	const [ a, b ] = LEGENDS[ id ].kg;
	return a + ( b - a ) * Math.pow( rng(), 1.6 );

}

// the bounty for landing one: the full one the first time
export function legendBounty( id, firstTime ) {

	const b = LEGENDS[ id ].bounty;
	return firstTime ? b : Math.round( b * REPEAT_BOUNTY / 5 ) * 5;

}

// a trophy wall from a save: unknown ids and broken entries dropped
export function legendsFromJSON( d ) {

	const out = {};
	if ( ! d || typeof d !== 'object' ) return out;
	for ( const id of LEGEND_IDS ) {

		const e = d[ id ];
		if ( e && e.count > 0 && Number.isFinite( e.bestKg ) ) out[ id ] = { count: e.count | 0, bestKg: e.bestKg };

	}

	return out;

}

// the legend's name with its species, for the toast and the card
export function legendTitle( id ) {

	const L = LEGENDS[ id ];
	return t( '{legend} ({species})', { legend: t( L.name ), species: t( FISH[ L.species ].name ) } );

}
