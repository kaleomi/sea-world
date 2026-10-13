// The shared world clock and weather schedule (src/core/WorldClock.js) and the driver that applies
// them (src/weather/WorldWeather.js), with a stub app.
import { worldHour, worldDay, msUntilHour, cycleOfHour, CYCLE, DAWN, DUSK, weatherAt, weatherOf, seaOf, forecast, clockText, WEATHER_BLOCK, WEATHER_KINDS } from '../src/core/WorldClock.js';
import { WorldWeather } from '../src/weather/WorldWeather.js';

let fails = 0;
const check = ( ok, msg ) => {

	console.log( ( ok ? 'ok   ' : 'FAIL ' ) + msg );
	if ( ! ok ) fails ++;

};

// ---- the clock
const T0 = Date.UTC( 2026, 9, 13, 12, 0, 0 );
let step = 0, inRange = true, day = 0, night = 0, wraps = 0;
let prev = worldHour( T0 );
for ( let t = T0; t < T0 + CYCLE * 3000; t += 1000 ) {

	const h = worldHour( t );
	if ( ! ( h >= 0 && h < 24 ) ) inRange = false;
	let d = h - prev;
	if ( d < - 12 ) { d += 24; wraps ++; }
	step = Math.max( step, Math.abs( d ) );
	if ( h >= DAWN && h < DUSK ) day ++; else night ++;
	prev = h;

}

check( inRange, 'the hour stays in 0..24' );
check( step < 0.05, `it moves smoothly (largest step per real second ${ step.toFixed( 3 ) } h)` );
check( wraps === 3, `three game days in ${ ( CYCLE * 3 / 60 ).toFixed( 1 ) } real minutes (${ wraps } midnights)` );
check( CYCLE > 15 * 60 && CYCLE < 25 * 60, `a day lasts ${ ( CYCLE / 60 ).toFixed( 1 ) } real minutes` );
check( day / ( day + night ) > 0.65, `most of the real time is daylight (${ Math.round( day / ( day + night ) * 100 ) }%)` );
check( worldDay( T0 + CYCLE * 1000 ) === worldDay( T0 ) + 1, 'a cycle later is the next day' );
const toDawn = msUntilHour( DAWN, T0 );
check( toDawn > 0 && toDawn <= CYCLE * 1000 && Math.abs( worldHour( T0 + toDawn ) - DAWN ) < 0.02, `msUntilHour finds the next dawn (${ Math.round( toDawn / 1000 ) } s)` );
check( cycleOfHour( DAWN ) === 0 && Math.abs( cycleOfHour( 12 ) - 6 * 60 ) < 1e-9, 'cycleOfHour: dawn starts the cycle, noon is six real minutes in' );
check( clockText( 6.5 ) === '06:30' && clockText( 23.999 ) === '23:59' && clockText( 24 ) === '00:00', 'clock text' );

// ---- the weather
const counts = {};
let changes = 0, last = null, stormStreak = 0, longest = 0;
for ( let n = 0; n < 30000; n ++ ) {

	const w = weatherOf( n );
	counts[ w ] = ( counts[ w ] || 0 ) + 1;
	if ( w !== last ) changes ++;
	stormStreak = w === 'Storm' ? stormStreak + 1 : 0;
	longest = Math.max( longest, stormStreak );
	last = w;

}

const pct = ( k ) => ( counts[ k ] || 0 ) / 300;
check( WEATHER_KINDS.every( ( k ) => counts[ k ] > 0 ), `every kind of weather happens (${ WEATHER_KINDS.map( ( k ) => `${ k } ${ pct( k ).toFixed( 0 ) }%` ).join( ', ' ) })` );
check( pct( 'Clear' ) > 45 && pct( 'Storm' ) < 10, 'mostly fair, storms are rare' );
check( longest <= 6, `no endless storms (longest run ${ longest } spells, ${ longest * WEATHER_BLOCK / 60 } min)` );
check( changes / 30000 > 0.3 && changes / 30000 < 0.7, `the weather changes every few spells (${ ( changes / 300 ).toFixed( 0 ) }% of spells)` );
check( weatherOf( 1234 ) === weatherOf( 1234 ), 'the same spell is the same weather for everyone' );
check( seaOf( 5, 'Storm' ) === 'Storm' && seaOf( 5, 'Rain' ) === 'Choppy' && [ 'Calm', 'Breezy' ].includes( seaOf( 5, 'Clear' ) ), 'the sea follows the weather' );
const fc = forecast( T0, 6 );
check( fc.length === 6 && fc[ 0 ].weather === weatherAt( T0 ).weather && fc.every( ( f, i ) => i === 0 || f.start === fc[ i - 1 ].end ), 'the forecast is the schedule: now, then back-to-back spells' );
check( fc[ 0 ].start <= T0 && T0 < fc[ 0 ].end, 'the first spell is the one on now' );

// ---- WorldWeather on a stub app
let now = T0;
const calls = { preset: [], sea: [] };
const app = {
	settings: { timeOfDay: 9, timeSpeed: 0 },
	weather: { setPreset: ( id ) => calls.preset.push( id ) },
	ui: { seaToward: ( name, k ) => calls.sea.push( [ name, k ] ) },
};
const ww = new WorldWeather( app, { now: () => now } );
const changed = [];
ww.onChange = ( w, sea, first ) => changed.push( { w, sea, first } );
ww.update( 0.016 );
check( Math.abs( app.settings.timeOfDay - worldHour( T0 ) ) < 1e-9, 'the hour follows the world clock' );
check( calls.preset[ 0 ] === weatherAt( T0 ).weather && calls.sea[ 0 ] && calls.sea[ 0 ][ 1 ] === 1 && changed[ 0 ].first, 'the opening weather and sea are set at once' );
// run on until the weather turns
let turned = false;
for ( let i = 0; i < 400 && ! turned; i ++ ) {

	now += 60000;
	ww.update( 1.01 );
	turned = changed.length > 1;

}

check( turned && ! changed[ 1 ].first && calls.preset.length >= 2, `a change in the schedule is applied and announced (${ changed[ 1 ] && changed[ 1 ].w })` );
check( calls.sea.some( ( [ , k ] ) => k > 0 && k < 1 ), 'the sea eases toward the new state in small steps' );
// a developer moves the time: the clock lets go
app.settings.timeOfDay = 3;
ww.update( 0.016 );
check( ! ww.clock && app.settings.timeOfDay === 3, 'moving the hour by hand switches the world clock off' );
now += 120000;
ww.update( 0.016 );
check( app.settings.timeOfDay === 3, 'and it stays where it was put' );
ww.setClock( true );
check( ww.clock && Math.abs( app.settings.timeOfDay - worldHour( now ) ) < 1e-9, 'switching it back on jumps to the world hour' );
const before = calls.preset.length;
ww.setWeather( false );
for ( let i = 0; i < 50; i ++ ) {

	now += 60000;
	ww.update( 1.01 );

}

check( calls.preset.length === before, 'with the forecast off nothing changes the weather' );

console.log( fails ? `\n${ fails } FAILED` : '\nall ok' );
process.exit( fails ? 1 : 0 );
