// The whale's surfacing behaviour, headless: how often it comes up, how often it breaches and how
// deep it rides, at midday, after dark and in a storm. Drives WhaleBrain through many surfacing
// windows and counts what it actually decides to do. No pictures, no rendering.
//   node test/life-eco-whale.mjs
import { readFileSync } from 'node:fs';
import { setupLife } from './life-harness.mjs';
import { G } from '../src/core/Globals.js';

let fails = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else console.log( 'ok  ', msg );

};

// local files through fetch (the browser path of Whale.load). On Windows the URL pathname comes
// out with a leading slash (/E:/...); readFileSync would turn that into E:\E:\...
const ROOT = new URL( '../public', import.meta.url ).pathname.replace( /^\/([A-Za-z]:)/, '$1' );
globalThis.fetch = async ( url ) => {

	const buf = readFileSync( ROOT + url );
	return { json: async () => JSON.parse( buf.toString() ), arrayBuffer: async () => buf.buffer.slice( buf.byteOffset, buf.byteOffset + buf.byteLength ) };

};

const L = await setupLife( { W: 64, H: 64, water: true } );
const { Whale } = await import( '../src/world/marine/Whale.js' );
const spray = { emit() {}, emitAlongPoints() {} };
const whale = new Whale( { scene: L.scene, terrain: L.terrain, spray } );
await whale.load();
const b = whale.brain;

// SURFACE_AT in WhaleBrain.js: the route fraction where the surfacing window opens (and it is
// 0.05 wide). The test walks the whale in and out of that window by hand.
const AT = 0.25;

const setSky = ( s ) => {

	G.night.value = s.night;
	G.sunDir.value.set( 0, s.sunY, Math.sqrt( Math.max( 0, 1 - s.sunY * s.sunY ) ) ).normalize();
	G.weather.value.set( s.rain, s.rain, 0, s.gust );

};

// Walk the whale past the surfacing window `n` times and count: how many times it decides to come
// up, how many of those sequences contain a breach, and how deep the deep keys end up.
const sample = ( n, sky ) => {

	setSky( sky );
	G.time.value += 1 / 30;
	whale.update( 1 / 30, null ); // Whale pushes the hour / weather biases into the brain
	let up = 0, breach = 0, deep = 0;
	for ( let i = 0; i < n; i ++ ) {

		// out of the window (clears lastWrap), then straight into it
		b.state = 'cruise';
		b.seq = null;
		b.u = b.length * ( AT - 0.2 );
		b.lastWrap = false;
		b.update( 1 / 30 );
		b.u = b.length * ( AT + 0.02 );
		b.update( 1 / 30 );
		if ( ! b.seq ) continue;
		up ++;
		if ( b.seq.keys.some( ( k ) => k.breach ) ) breach ++;
		deep += Math.max( ...b.seq.keys.map( ( k ) => k.depth ) );

	}

	return { up: up / n, breach: up ? breach / up : 0, deep: up ? deep / up : 0 };

};

const N = 2000;
const mid = sample( N, { night: 0, sunY: 1, rain: 0, gust: 0 } );
const night = sample( N, { night: 1, sunY: - 0.9, rain: 0, gust: 0 } );
const storm = sample( N, { night: 0, sunY: 0.6, rain: 1, gust: 1 } );
const pct = ( x ) => ( x * 100 ).toFixed( 1 ) + '%';
console.log( '  midday ', `up ${ pct( mid.up ) }, breach ${ pct( mid.breach ) }, deepest ${ mid.deep.toFixed( 1 ) } m` );
console.log( '  night  ', `up ${ pct( night.up ) }, breach ${ pct( night.breach ) }, deepest ${ night.deep.toFixed( 1 ) } m` );
console.log( '  storm  ', `up ${ pct( storm.up ) }, breach ${ pct( storm.breach ) }, deepest ${ storm.deep.toFixed( 1 ) } m` );

ok( Math.abs( mid.up - 0.70 ) < 0.04, `a clear day: it comes up on 70% of its passes (${ pct( mid.up ) })` );
ok( night.up > mid.up + 0.1, `after dark it comes up more (${ pct( mid.up ) } -> ${ pct( night.up ) })` );
ok( storm.up < mid.up - 0.2, `a rough sea keeps it down (${ pct( mid.up ) } -> ${ pct( storm.up ) })` );
ok( Math.abs( mid.breach - 0.25 ) < 0.04, `the old one-in-four breach chance, untouched by day (${ pct( mid.breach ) })` );
ok( night.breach > mid.breach, `more launching after dark (${ pct( mid.breach ) } -> ${ pct( night.breach ) })` );
ok( storm.breach < 0.05, `almost no launching in a storm (${ pct( storm.breach ) })` );
ok( storm.deep > mid.deep + 2, `and it sounds deeper (${ mid.deep.toFixed( 1 ) } -> ${ storm.deep.toFixed( 1 ) } m)` );
ok( Number.isFinite( b.position.x ) && Number.isFinite( b.position.y ), 'the brain stays finite' );

// and it still gets through a real stretch of the route without anything jamming
{
	setSky( { night: 0, sunY: 1, rain: 0, gust: 0 } );
	let deep = 0;
	for ( let i = 0; i < 60 * 60 * 10; i ++ ) {

		G.time.value += 1 / 30;
		whale.update( 1 / 30, null );
		deep = Math.min( deep, b.position.y );

	}

	ok( deep < - 5, `ten minutes of real cruising: it still sounds (deepest ${ deep.toFixed( 1 ) } m)` );
	ok( b.seq !== null || b.state === 'cruise', 'and is left in a sane state' );
}

console.log( fails === 0 ? '\nall good' : `\n${ fails } FAILED` );
process.exit( fails === 0 ? 0 : 1 );
