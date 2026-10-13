import { FISH, fishValue } from './FishTable.js';

// Joe's orders: "bring me n of this species, at least this heavy". Plain data and pure functions (no
// DOM, no GPU) so node can test them; GameState keeps the board in the save and Game / GameHUD show it.
//
// The board holds BOARD_SIZE open orders. Filling one hands over the matching fish from the cooler,
// pays more than the stand would and earns reputation with Joe. Reputation unlocks harder orders
// (reef, then bay and deep water, then the trophy fish) and a better price for everything you sell.
// Turning an order down replaces it; there is no timer, so nothing is lost by fishing elsewhere.

export const BOARD_SIZE = 3;

// reputation tiers: the rep needed, Joe's name for you, the sale bonus at the stand
export const TIERS = [
	{ rep: 0, name: 'Newcomer', bonus: 0 },
	{ rep: 4, name: 'Regular', bonus: 0.05 },
	{ rep: 12, name: 'Trusted supplier', bonus: 0.1 },
	{ rep: 24, name: 'Partner', bonus: 0.15 },
];

// which species each tier adds to the orders: the pier and shallows, the reef, the bay and deep
// water, then the hard fighters that need upgraded line
export const TIER_SPECIES = [
	[ 'mullet', 'sergeant', 'grunt', 'needlefish', 'silverside' ],
	[ 'yellowtail', 'tang', 'parrot', 'angel', 'chromis' ],
	[ 'wrasse', 'jack', 'barracuda', 'redSnapper' ],
	[ 'grouper', 'tuna', 'mahi', 'tarpon' ],
];

const SPECIES_TIER = {};
TIER_SPECIES.forEach( ( list, i ) => list.forEach( ( id ) => ( SPECIES_TIER[ id ] = i ) ) );

export function tierOf( rep ) {

	let i = 0;
	while ( i + 1 < TIERS.length && rep >= TIERS[ i + 1 ].rep ) i ++;
	return i;

}

// a fresh board: { list: [], rep: 0, filled: 0, nextId: 1 }
export function newBoard() {

	return { list: [], rep: 0, filled: 0, nextId: 1 };

}

// a board read from a save: anything missing or unknown is dropped, the rest kept
export function boardFromJSON( d ) {

	const b = newBoard();
	if ( ! d || typeof d !== 'object' ) return b;
	b.rep = Math.max( 0, d.rep | 0 );
	b.filled = Math.max( 0, d.filled | 0 );
	if ( Array.isArray( d.list ) ) b.list = d.list.filter( ( o ) => o && FISH[ o.species ] && o.count >= 1 && Number.isFinite( o.minKg ) && Number.isFinite( o.reward ) ).slice( 0, BOARD_SIZE );
	b.nextId = Math.max( d.nextId | 0, ...b.list.map( ( o ) => o.id + 1 ), 1 );
	return b;

}

// one new order for a board at `rep`, not repeating a species already on the board
export function makeOrder( board, rng = Math.random ) {

	const tier = tierOf( board.rep );
	const taken = new Set( board.list.map( ( o ) => o.species ) );
	// mostly the newest unlocked tier, sometimes an easier one
	let pool = [];
	for ( let i = 0; i <= tier; i ++ ) for ( const id of TIER_SPECIES[ i ] ) if ( ! taken.has( id ) ) pool.push( { id, w: i === tier ? 3 : 1 } );
	if ( ! pool.length ) pool = TIER_SPECIES[ 0 ].map( ( id ) => ( { id, w: 1 } ) );
	let sum = 0;
	for ( const p of pool ) sum += p.w;
	let r = rng() * sum, species = pool[ pool.length - 1 ].id;
	for ( const p of pool ) if ( ( r -= p.w ) <= 0 ) {

		species = p.id;
		break;

	}

	const f = FISH[ species ];
	// small fish come by the bucket, big ones one at a time
	const count = f.kg[ 1 ] < 0.5 ? 2 + Math.floor( rng() * 3 ) : f.kg[ 1 ] < 3 ? 1 + Math.floor( rng() * 2 ) : 1;
	// the size asked for: from "any keeper" to the upper half of what the species reaches
	const q = 0.1 + rng() * ( 0.25 + 0.1 * tier );
	const minKg = Math.round( ( f.kg[ 0 ] + ( f.kg[ 1 ] - f.kg[ 0 ] ) * q ) * 100 ) / 100;
	// pays well over the stand: the more you've proved, the better Joe pays
	const reward = Math.max( 10, Math.round( count * fishValue( species, minKg ) * ( 1.8 + 0.25 * tier ) / 5 ) * 5 );
	const rep = 1 + ( SPECIES_TIER[ species ] ?? 0 );
	return { id: board.nextId ++, species, count, minKg, reward, rep };

}

// top the board up to BOARD_SIZE orders; true when something was added
export function fillBoard( board, rng = Math.random ) {

	let added = false;
	while ( board.list.length < BOARD_SIZE ) {

		board.list.push( makeOrder( board, rng ) );
		added = true;

	}

	return added;

}

// the fish in `inventory` that would go to an order, cheapest first (the best ones stay to sell)
export function matchingFish( order, inventory ) {

	return inventory.filter( ( f ) => f.species === order.species && f.kg >= order.minKg - 1e-6 ).sort( ( a, b ) => a.value - b.value );

}

// the open orders a just-caught fish would count towards
export function ordersFor( board, species, kg ) {

	return board.list.filter( ( o ) => o.species === species && kg >= o.minKg - 1e-6 );

}

// fill order `id` from `inventory`: { order, fish (handed over), reward, rep, tierUp } or null when
// it can't be filled yet. Mutates the board (the order goes, rep and the count go up); the caller
// takes the fish out of the inventory and pays the reward.
export function fillOrder( board, id, inventory ) {

	const i = board.list.findIndex( ( o ) => o.id === id );
	if ( i < 0 ) return null;
	const order = board.list[ i ];
	const fish = matchingFish( order, inventory ).slice( 0, order.count );
	if ( fish.length < order.count ) return null;
	const before = tierOf( board.rep );
	board.list.splice( i, 1 );
	board.rep += order.rep;
	board.filled ++;
	return { order, fish, reward: order.reward, rep: order.rep, tierUp: tierOf( board.rep ) > before };

}

// turn order `id` down (it is replaced by the next fillBoard); false when there is no such order
export function dropOrder( board, id ) {

	const i = board.list.findIndex( ( o ) => o.id === id );
	if ( i < 0 ) return false;
	board.list.splice( i, 1 );
	return true;

}
