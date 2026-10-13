// Plain-node tests of the outer islands' quest givers (data, progress, hand-in, the save, where they
// stand), developer mode (the code, keeping its letters from the game) and the mouse-look spike filter.
// src/game/Quests.js, src/game/GameState.js, src/core/DevMode.js, src/core/Input.js (filterLook).
import { GIVERS, GIVER_IDS, questsFromJSON, currentQuest, questProgress, questReady, completeQuest, beachSpot } from '../src/game/Quests.js';
import { FISH } from '../src/game/FishTable.js';
import { LEGENDS } from '../src/game/Legends.js';
import { GameState } from '../src/game/GameState.js';
import { OUTER_ISLANDS, islandById } from '../src/world/islands/index.js';
import { OuterIsland } from '../src/world/terrain/OuterIsland.js';
import { DEV, DEV_CODE } from '../src/core/DevMode.js';
import { filterLook, newLookState } from '../src/core/Input.js';
import { ZH_CN } from '../src/i18n/zh-CN.js';

let fails = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else console.log( 'ok  ', msg );

};

// ---- the data
ok( OUTER_ISLANDS.every( ( d ) => GIVER_IDS.some( ( id ) => GIVERS[ id ].island === d.id ) ), 'every outer island has a quest giver' );
const jobs = GIVER_IDS.flatMap( ( id ) => GIVERS[ id ].quests.map( ( q ) => ( { g: GIVERS[ id ], q } ) ) );
ok( jobs.every( ( { g, q } ) => ( q.legend ? LEGENDS[ q.legend ] && islandById( g.island ).legends.includes( q.legend ) : q.needs.length && q.needs.every( ( n ) => FISH[ n.species ] && islandById( g.island ).species.includes( n.species ) ) ) ), "every job asks for fish (or a legend) that live round the giver's island" );
ok( jobs.every( ( { q } ) => ! q.needs || q.needs.every( ( n ) => n.count >= 1 && n.minKg < FISH[ n.species ].kg[ 0 ] + ( FISH[ n.species ].kg[ 1 ] - FISH[ n.species ].kg[ 0 ] ) * 0.7 ) ), 'no job asks for fish near the top of the species range' );
ok( jobs.every( ( { q } ) => q.reward > 0 ) && GIVER_IDS.every( ( id ) => GIVERS[ id ].quests.every( ( q, i, a ) => i === 0 || q.reward >= a[ i - 1 ].reward ) ), 'rewards are positive and grow along each chain' );
ok( GIVER_IDS.every( ( id ) => new Set( GIVERS[ id ].quests.map( ( q ) => q.id ) ).size === GIVERS[ id ].quests.length ), 'job ids are unique per giver' );
const texts = GIVER_IDS.flatMap( ( id ) => { const g = GIVERS[ id ]; return [ g.name, g.greeting, g.done, ...g.quests.flatMap( ( q ) => [ q.title, q.text ] ) ]; } );
ok( texts.every( ( s ) => ZH_CN[ s ] ), 'every quest text has a Chinese translation' );

// ---- progress
const p0 = questsFromJSON( null );
ok( GIVER_IDS.every( ( id ) => p0[ id ] === 0 ), 'a new save starts at the first job' );
ok( questsFromJSON( { nalu: 99, tama: - 3, bogus: 2 } ).nalu === GIVERS.nalu.quests.length && questsFromJSON( { tama: - 3 } ).tama === 0 && ! ( 'bogus' in questsFromJSON( { bogus: 2 } ) ), 'progress from a save is clamped and unknown givers dropped' );
let nextId = 1;
const fish = ( species, kg ) => ( { id: nextId ++, species, kg, value: Math.round( kg * 10 ) } );
const q0 = currentQuest( 'nalu', p0 );
ok( q0 === GIVERS.nalu.quests[ 0 ], 'the current job is the first' );
const inv = [ fish( 'tang', 0.3 ), fish( 'tang', 0.1 ), fish( 'chromis', 0.05 ), fish( 'grunt', 1 ) ];
let pr = questProgress( q0, inv );
ok( ! pr.ready && pr.rows[ 0 ].have === 1 && pr.rows[ 1 ].have === 1, 'an undersized tang does not count' );
ok( completeQuest( 'nalu', p0, inv, {} ) === null && p0.nalu === 0, 'an unfinished job cannot be handed in' );
inv.push( fish( 'tang', 0.45 ), fish( 'chromis', 0.08 ), fish( 'tang', 0.5 ) );
pr = questProgress( q0, inv );
ok( pr.ready && pr.fish.length === 4 && ! pr.fish.some( ( f ) => f.kg === 0.5 ), 'ready: hands over exactly the fish asked for, the cheaper ones first' );
const r = completeQuest( 'nalu', p0, inv, {} );
ok( r && r.reward === q0.reward && p0.nalu === 1 && ! r.last, 'handing in moves to the next job' );
// the legend job at the end
const pL = { nalu: GIVERS.nalu.quests.length - 1, tama: 0 };
const qL = currentQuest( 'nalu', pL );
ok( qL.legend && ! questReady( qL, [], {} ) && questReady( qL, [], { [ qL.legend ]: { count: 1, bestKg: 25 } } ), 'a legend job is ready once the legend is on the trophy wall' );
const rL = completeQuest( 'nalu', pL, [], { [ qL.legend ]: { count: 1, bestKg: 25 } } );
ok( rL && rL.last && rL.fish.length === 0 && currentQuest( 'nalu', pL ) === null, 'the last job finishes the chain and takes no fish' );

// ---- through GameState and its save
{

	const m = new Map();
	const store = { getItem: ( k ) => m.get( k ) ?? null, setItem: ( k, v ) => m.set( k, v ) };
	const st = new GameState( store );
	ok( st.quests.nalu === 0 && st.quests.tama === 0, 'a new game has every giver at the first job' );
	for ( let i = 0; i < 3; i ++ ) st.addFish( 'mullet', 1.2 );
	const before = st.money, n = st.inventory.length;
	const done = st.completeQuest( 'tama' );
	ok( done && st.money === before + GIVERS.tama.quests[ 0 ].reward && st.inventory.length === n - 3 && st.quests.tama === 1, 'handing in pays the reward and takes the fish from the cooler' );
	ok( st.completeQuest( 'tama' ) === null, 'the next job is not ready yet' );
	const back = new GameState( store );
	ok( back.load() && back.quests.tama === 1, 'quest progress survives a save' );
	const old = new GameState( { getItem: () => JSON.stringify( { v: 1, money: 5, inventory: [], log: {}, upgrades: {}, fuel: null, nextId: 1 } ), setItem: () => {} } );
	ok( old.load() && old.quests.tama === 0 && old.quests.nalu === 0, 'a save from before the quests starts at the first jobs' );

}

// ---- where they stand
for ( const d of OUTER_ISLANDS ) {

	const isl = new OuterIsland( d );
	const s = beachSpot( isl, 0, 0 );
	ok( s && s.y > 0.8 && isl.heightAt( s.x, s.z ) > 0.8, `${ d.id }: the giver stands on dry ground` );
	if ( ! s ) continue;
	const toHome = Math.atan2( - isl.cz, - isl.cx ), at = Math.atan2( s.z - isl.cz, s.x - isl.cx );
	const dA = Math.abs( Math.atan2( Math.sin( at - toHome ), Math.cos( at - toHome ) ) );
	ok( dA < 1.2, `${ d.id }: on the side facing the home island` );
	// open water within 40 m out to sea, so the boat can come in close
	const fx = Math.sin( s.yaw ), fz = Math.cos( s.yaw );
	let wet = false;
	for ( let r = 2; r < 40 && ! wet; r += 1 ) wet = isl.heightAt( s.x + fx * r, s.z + fz * r ) < - 1;
	ok( wet, `${ d.id }: water deeper than 1 m within 40 m in front of them` );

}

// ---- developer mode
{

	DEV.on = false;
	let flips = 0;
	DEV.onChange( () => flips ++ );
	for ( const c of 'xxadmintes' ) DEV.type( c );
	ok( ! DEV.on, 'not on before the last letter' );
	ok( DEV.type( 't' ) && DEV.on && flips === 1, `typing "${ DEV_CODE }" turns developer mode on` );
	for ( const c of DEV_CODE.toUpperCase() ) DEV.type( c );
	ok( ! DEV.on && flips === 2, 'typing it again (any case) turns it off' );
	// consume: which presses the game must not see
	let t = 1000;
	const swallowed = [ ...DEV_CODE ].map( ( c ) => DEV.consume( c, t += 120 ) );
	ok( swallowed.slice( 0, 2 ).every( ( s ) => ! s ) && swallowed.slice( 2 ).every( ( s ) => s ) && DEV.on, 'from the third letter on, the code is kept from the game (no map, no cooler, no mute)' );
	DEV.set( false );
	ok( ! DEV.consume( 'm', t += 5000 ), 'a lone M still reaches the game' );
	DEV.consume( 'a', t += 3000 );
	DEV.consume( 'd', t += 100 );
	ok( ! DEV.consume( 'm', t += 2000 ), 'A, D and then M a while later: the M reaches the game' );
	DEV.consume( 'a', t += 3000 );
	DEV.consume( 'd', t += 100 );
	ok( ! DEV.consume( 'w', t += 100 ), 'a key that breaks the code reaches the game' );
	ok( ! DEV.on, 'still off' );

}

// ---- mouse look
{

	const st = newLookState();
	let t = 0;
	const moves = [];
	for ( let i = 0; i < 20; i ++ ) moves.push( filterLook( st, 12, 3, t += 8 ) );
	ok( moves.every( ( m ) => m && m.x === 12 ), 'ordinary moves pass unchanged' );
	ok( filterLook( st, 900, - 20, t += 8 ) === null, 'a sudden 900 px jump is dropped (no spin round to the back)' );
	ok( filterLook( st, 15, 2, t += 8 ) !== null, 'the next ordinary move passes' );
	let flick = true;
	for ( const dx of [ 30, 60, 100, 150, 190, 220, 240 ] ) flick = flick && filterLook( st, dx, 0, t += 8 ) !== null;
	ok( flick, 'a fast flick that builds up over several events passes' );
	st.since = t;
	ok( filterLook( st, 20, 0, t + 50 ) === null && filterLook( st, 20, 0, t + 200 ) !== null, 'moves just after the pointer lock changes are dropped' );
	ok( filterLook( st, NaN, 0, t + 300 ) === null, 'a broken event is dropped' );

}

console.log( fails ? `\n${ fails } FAILED` : '\nall passed' );
process.exit( fails ? 1 : 0 );
