// Plain-node tests of the legendary fish (no GPU, no DOM): when each one feeds, how rare the bite is,
// that it wants upgraded line, the bounty and the trophy wall in the save.
// src/game/Legends.js, src/game/CatchMinigame.js, src/game/GameState.js.
import { FISH } from '../src/game/FishTable.js';
import { LEGENDS, LEGEND_IDS, FIRST_CHANCE, inTime, highTide, conditions, rollLegend, legendWeight, legendBounty, legendsFromJSON } from '../src/game/Legends.js';
import { CatchMinigame } from '../src/game/CatchMinigame.js';
import { UPGRADES } from '../src/game/Gear.js';
import { GameState } from '../src/game/GameState.js';

let fails = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else console.log( 'ok  ', msg );

};

function seeded( s ) {

	return () => ( ( s = ( s * 1664525 + 1013904223 ) >>> 0 ) / 4294967296 );

}

const water = ( k, w = 1 ) => ( { shallows: 0, reef: 0, pier: 0, bay: 0, deep: 0, [ k ]: w } );
const HIGH = { level: 0.6, amplitude: 0.65 }, LOW = { level: - 0.5, amplitude: 0.65 };

// ---- the data
ok( LEGEND_IDS.every( ( id ) => { const L = LEGENDS[ id ], f = FISH[ L.species ]; return f && L.kg[ 0 ] > f.kg[ 1 ] && L.kg[ 1 ] > L.kg[ 0 ] && L.bounty > 0 && L.rumour; } ), 'every legend is a giant of a real species, bigger than any normal one, with a bounty and a rumour' );
ok( LEGEND_IDS.every( ( id ) => LEGENDS[ id ].waters.some( ( k ) => ( FISH[ LEGENDS[ id ].species ].habitat[ k ] || 0 ) > 0 ) ), 'each legend hunts water its species lives in' );
ok( new Set( LEGEND_IDS.map( ( id ) => LEGENDS[ id ].species ) ).size === LEGEND_IDS.length, 'no two legends of one species' );

// ---- when they feed
ok( inTime( 'night', 23 ) && inTime( 'night', 3 ) && ! inTime( 'night', 12 ) && inTime( 'dawnDusk', 6 ) && inTime( 'dawnDusk', 19.5 ) && ! inTime( 'dawnDusk', 13 ) && inTime( null, 13 ), 'time of day windows' );
ok( highTide( HIGH ) && ! highTide( LOW ) && highTide( { level: 0, amplitude: 0 } ) && highTide( null ), 'high water; with the tide turned off it always counts' );
ok( conditions( 'ironjaw', { habitat: water( 'reef' ), hour: 12, rain: 0.6 } ).all && ! conditions( 'ironjaw', { habitat: water( 'reef' ), hour: 12, rain: 0 } ).all, 'Old Ironjaw only in the rain' );
ok( conditions( 'silverKing', { habitat: water( 'pier' ), hour: 23, tide: HIGH } ).all && ! conditions( 'silverKing', { habitat: water( 'pier' ), hour: 23, tide: LOW } ).all && ! conditions( 'silverKing', { habitat: water( 'pier' ), hour: 12, tide: HIGH } ).all, 'the Silver King: night and high tide, both' );
ok( ! conditions( 'bigRed', { habitat: water( 'reef' ), hour: 6.5 } ).water && conditions( 'bigRed', { habitat: water( 'deep' ), hour: 6.5 } ).all, 'Big Red only in deep water' );
ok( conditions( 'thunderJack', { habitat: water( 'bay' ), hour: 12, rain: 1 } ).all && ! conditions( 'thunderJack', { habitat: water( 'bay' ), hour: 12, rain: 0.5 } ).all, 'Thunder Jack wants a real storm' );
{

	// in a clear midday sea none of them bite
	const rng = seeded( 3 );
	let any = 0;
	for ( const k of [ 'shallows', 'reef', 'pier', 'bay', 'deep' ] ) for ( let i = 0; i < 2000; i ++ ) if ( rollLegend( { habitat: water( k ), hour: 12, rain: 0, tide: LOW }, {}, rng ) ) any ++;
	ok( any === 0, 'clear weather at midday on a low tide: no legends anywhere' );

}

// ---- how rare
{

	const rng = seeded( 11 );
	const N = 40000;
	let n = 0, after = 0;
	const where = { habitat: water( 'reef' ), hour: 12, rain: 0.6 };
	for ( let i = 0; i < N; i ++ ) if ( rollLegend( where, {}, rng ) === 'ironjaw' ) n ++;
	for ( let i = 0; i < N; i ++ ) if ( rollLegend( where, { ironjaw: { count: 1 } }, rng ) === 'ironjaw' ) after ++;
	ok( Math.abs( n / N - FIRST_CHANCE ) < 0.006, `in its conditions about 1 bite in ${ Math.round( 1 / FIRST_CHANCE ) } is the legend (${ ( n / N * 100 ).toFixed( 1 ) }%)` );
	ok( after < n / 2, 'rarer once you have landed it' );
	let inRange = true;
	for ( let i = 0; i < 500; i ++ ) for ( const id of LEGEND_IDS ) { const kg = legendWeight( id, rng ); if ( kg < LEGENDS[ id ].kg[ 0 ] || kg > LEGENDS[ id ].kg[ 1 ] ) inRange = false; }
	ok( inRange, 'weights inside each legend\'s range' );

}

// ---- the fight: hopeless on the starting line, fair on the best (a simple player: reel while the
// tension is comfortable, ease off when it climbs)
function landRate( id, lineLevel, reelLevel, runs = 60 ) {

	const L = LEGENDS[ id ];
	const line = UPGRADES.line.levels[ lineLevel ].lineKg, reel = UPGRADES.reel.levels[ reelLevel ].reelSpeed;
	let landed = 0;
	for ( let r = 0; r < runs; r ++ ) {

		const rng = seeded( 100 + r );
		const g = new CatchMinigame( { species: L.species, kg: ( L.kg[ 0 ] + L.kg[ 1 ] ) / 2, lineKg: line, reelSpeed: reel, distance: 20, rng, staminaMul: L.stamina, powerMul: L.power } );
		let reeling = false, st = 'fighting';
		for ( let i = 0; i < 20 * 600 && st === 'fighting'; i ++ ) {

			if ( g.tension > 0.8 ) reeling = false;
			else if ( g.tension < 0.5 ) reeling = true;
			st = g.update( 0.05, reeling );

		}

		if ( st === 'caught' ) landed ++;

	}

	return landed / runs;

}

for ( const id of LEGEND_IDS ) {

	const weak = landRate( id, 0, 0 ), strong = landRate( id, UPGRADES.line.levels.length - 1, UPGRADES.reel.levels.length - 1 );
	ok( weak < 0.2 && strong > 0.5, `${ id }: landed ${ ( weak * 100 ).toFixed( 0 ) }% on 8 lb mono, ${ ( strong * 100 ).toFixed( 0 ) }% on 60 lb braid` );

}

ok( landRate( 'silverKing', 2, 2 ) < 0.2 && LEGEND_IDS.filter( ( id ) => id !== 'silverKing' ).every( ( id ) => landRate( id, 2, 2 ) > 0.5 ), 'on 30 lb braid the Silver King still breaks you; the others can be landed' );

// ---- bounty and the trophy wall
ok( legendBounty( 'silverKing', true ) === 1500 && legendBounty( 'silverKing', false ) < 1500 && legendBounty( 'silverKing', false ) % 5 === 0, 'the full bounty the first time, a smaller one after' );
{

	const m = new Map();
	const store = { getItem: ( k ) => m.get( k ) ?? null, setItem: ( k, v ) => m.set( k, v ) };
	const st = new GameState( store );
	const info = st.addLegend( 'ironjaw', 25.3 );
	ok( st.money === 900 && info.legend === 'ironjaw' && info.firstLegend && st.inventory.length === 0 && ! st.log.grouper, 'Old Ironjaw: $900, on the trophy wall, not in the cooler or the species log' );
	const again = st.addLegend( 'ironjaw', 27 );
	ok( ! again.firstLegend && again.record && st.money === 900 + legendBounty( 'ironjaw', false ) && st.legends.ironjaw.count === 2 && st.legends.ironjaw.bestKg === 27, 'again: the smaller bounty, the count and the record go up' );
	const back = new GameState( store );
	ok( back.load() && back.legends.ironjaw.count === 2 && back.legends.ironjaw.bestKg === 27, 'the trophy wall survives a save' );
	ok( JSON.stringify( legendsFromJSON( { ironjaw: { count: 1, bestKg: 23 }, kraken: { count: 1, bestKg: 900 }, bigRed: null } ) ) === '{"ironjaw":{"count":1,"bestKg":23}}', 'unknown and broken entries are dropped from a loaded wall' );
	const old = new GameState( { getItem: () => JSON.stringify( { v: 1, money: 0, inventory: [], log: {}, upgrades: {}, fuel: null, nextId: 1 } ), setItem: () => {} } );
	ok( old.load() && Object.keys( old.legends ).length === 0, 'older saves start with an empty wall' );
	ok( st.addLegend( 'kraken', 100 ) === null, 'no such legend: nothing' );

}

console.log( fails ? `${ fails } FAILED` : 'all passed' );
process.exit( fails ? 1 : 0 );
