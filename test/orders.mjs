// Plain-node tests of Joe's orders (no GPU, no DOM): the board, what an order asks for and pays,
// filling and turning one down, reputation tiers and the sale bonus, and orders in the save.
// src/game/Orders.js, src/game/GameState.js.
import { FISH, fishValue } from '../src/game/FishTable.js';
import { BOARD_SIZE, TIERS, TIER_SPECIES, tierOf, newBoard, boardFromJSON, makeOrder, fillBoard, matchingFish, ordersFor, fillOrder, dropOrder } from '../src/game/Orders.js';
import { GameState } from '../src/game/GameState.js';

let fails = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else console.log( 'ok  ', msg );

};

// a seeded generator so every run sees the same orders
function seeded( s ) {

	return () => ( ( s = ( s * 1664525 + 1013904223 ) >>> 0 ) / 4294967296 );

}

const memStore = () => {

	const m = new Map();
	return { m, getItem: ( k ) => m.get( k ) ?? null, setItem: ( k, v ) => m.set( k, v ) };

};

// ---- tiers
ok( tierOf( 0 ) === 0 && tierOf( TIERS[ 1 ].rep - 1 ) === 0 && tierOf( TIERS[ 1 ].rep ) === 1 && tierOf( 1e6 ) === TIERS.length - 1, 'reputation maps to tiers at the thresholds' );
ok( TIERS.every( ( x, i ) => i === 0 || ( x.rep > TIERS[ i - 1 ].rep && x.bonus > TIERS[ i - 1 ].bonus ) ), 'each tier needs more reputation and pays a bigger bonus' );
ok( TIER_SPECIES.flat().every( ( id ) => FISH[ id ] ) && new Set( TIER_SPECIES.flat() ).size === Object.keys( FISH ).filter( ( id ) => ! FISH[ id ].zone ).length, 'every coastal species appears in exactly one tier (the open-ocean ones are not ordered)' );

// ---- the board
{

	const rng = seeded( 1 );
	const b = newBoard();
	ok( fillBoard( b, rng ) && b.list.length === BOARD_SIZE, 'a new board fills up' );
	ok( new Set( b.list.map( ( o ) => o.species ) ).size === BOARD_SIZE, 'no species twice on the board' );
	ok( b.list.every( ( o ) => TIER_SPECIES[ 0 ].includes( o.species ) ), 'a newcomer only gets pier and shallows orders' );
	ok( fillBoard( b, rng ) === false, 'a full board stays as it is' );

	// many orders: sane sizes, counts and pay
	let sane = true;
	for ( let i = 0; i < 400; i ++ ) {

		const bb = newBoard();
		bb.rep = [ 0, 4, 12, 24 ][ i % 4 ];
		const o = makeOrder( bb, rng );
		const f = FISH[ o.species ];
		const fair = o.count * fishValue( o.species, o.minKg );
		if ( ! ( o.count >= 1 && o.count <= 4 && o.minKg >= f.kg[ 0 ] && o.minKg < f.kg[ 1 ] && o.reward >= fair && o.reward % 5 === 0 && o.rep >= 1 ) ) sane = false;
		if ( f.kg[ 1 ] >= 3 && o.count !== 1 ) sane = false;

	}

	ok( sane, '400 orders: weights inside the species range, big fish one at a time, pay above the stand' );
	const top = newBoard();
	top.rep = 24;
	const seen = new Set();
	for ( let i = 0; i < 200; i ++ ) seen.add( makeOrder( top, rng ).species );
	ok( TIER_SPECIES[ 3 ].every( ( id ) => seen.has( id ) ) && TIER_SPECIES[ 0 ].some( ( id ) => seen.has( id ) ), 'a partner gets the trophy fish, and sometimes easy ones' );

}

// ---- filling an order
{

	const b = newBoard();
	b.list.push( { id: 7, species: 'grunt', count: 2, minKg: 0.5, reward: 40, rep: 1 } );
	const inv = [
		{ id: 1, species: 'grunt', kg: 0.4, value: 3 },
		{ id: 2, species: 'grunt', kg: 0.9, value: 6 },
		{ id: 3, species: 'grunt', kg: 0.6, value: 4 },
		{ id: 4, species: 'jack', kg: 3, value: 18 },
	];
	ok( matchingFish( b.list[ 0 ], inv ).map( ( f ) => f.id ).join() === '3,2', 'matching fish: right species, heavy enough, cheapest first' );
	ok( ordersFor( b, 'grunt', 0.7 ).length === 1 && ordersFor( b, 'grunt', 0.3 ).length === 0 && ordersFor( b, 'jack', 9 ).length === 0, 'ordersFor finds the order a catch counts towards' );
	ok( fillOrder( b, 7, inv.slice( 0, 2 ) ) === null && b.list.length === 1, 'not enough fish: nothing happens' );
	const r = fillOrder( b, 7, inv );
	ok( r && r.fish.map( ( f ) => f.id ).join() === '3,2' && r.reward === 40 && b.list.length === 0 && b.rep === 1 && b.filled === 1, 'filled: the fish go, reputation and the count go up' );
	ok( fillOrder( b, 7, inv ) === null && dropOrder( b, 7 ) === false, 'an order can only be used once' );
	b.rep = TIERS[ 1 ].rep - 1;
	b.list.push( { id: 8, species: 'jack', count: 1, minKg: 2, reward: 60, rep: 3 } );
	ok( fillOrder( b, 8, inv ).tierUp, 'crossing a threshold reports the new tier' );

}

// ---- through GameState: money, cooler, bonus, save
{

	const store = memStore();
	const st = new GameState( store );
	st.rng = seeded( 5 );
	st.orders = newBoard();
	st.orders.list.push( { id: 1, species: 'grunt', count: 2, minKg: 0.5, reward: 40, rep: 2 } );
	st.addFish( 'grunt', 0.8 );
	st.addFish( 'grunt', 0.55 );
	st.addFish( 'grunt', 1.1 );
	const fillBefore = st.inventory.length;
	const r = st.fillOrder( 1 );
	ok( r && st.money === 40 && st.inventory.length === fillBefore - 2 && st.inventory[ 0 ].kg === 1.1, 'filling pays the reward and keeps the best fish' );
	ok( st.orders.list.length === BOARD_SIZE, 'Joe offers a new order straight away' );
	const old = st.orders.list[ 0 ].id;
	ok( st.dropOrder( old ) && ! st.orders.list.some( ( o ) => o.id === old ) && st.orders.list.length === BOARD_SIZE, 'turning one down replaces it' );

	st.orders.rep = TIERS[ 2 ].rep;
	const f = st.inventory[ 0 ];
	ok( st.saleValue( f ) === Math.round( f.value * 1.1 ) && st.saleTotal === st.saleValue( f ), 'a trusted supplier gets 10% more at the stand' );
	const money = st.money;
	st.sell();
	ok( st.money === money + Math.round( f.value * 1.1 ), 'the bonus is paid on a sale' );

	const back = new GameState( store );
	ok( back.load() && back.orders.rep === TIERS[ 2 ].rep && back.orders.filled === 1 && JSON.stringify( back.orders.list ) === JSON.stringify( st.orders.list ), 'the board and reputation survive a save' );

	// a save from before the orders: a fresh board
	const pre = { v: 1, money: 5, inventory: [], log: {}, upgrades: {}, fuel: null, nextId: 1 };
	const st2 = new GameState( { getItem: () => JSON.stringify( pre ), setItem: () => {} } );
	ok( st2.load() && st2.orders.rep === 0 && st2.orders.list.length === BOARD_SIZE, 'older saves start with a fresh board' );
	// damaged entries are dropped, the rest kept
	const bad = boardFromJSON( { rep: 3, list: [ { id: 2, species: 'grunt', count: 1, minKg: 0.4, reward: 15, rep: 1 }, { id: 3, species: 'kraken', count: 1, minKg: 1, reward: 1, rep: 1 }, null ] } );
	ok( bad.rep === 3 && bad.list.length === 1 && bad.nextId === 3, 'unknown species and broken entries are dropped from a loaded board' );

}

console.log( fails ? `${ fails } FAILED` : 'all passed' );
process.exit( fails ? 1 : 0 );
