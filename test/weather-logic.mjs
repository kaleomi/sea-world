// Plain-node tests of the weather state (no GPU): rain easing, wetting / drying, lightning timing.
import { WEATHER, WEATHER_IDS, createWeatherState, stepWeather, cloudCover } from '../src/weather/WeatherState.js';
import { biteDelay, rainBiteRate, habitatAt } from '../src/game/Bites.js';

let fails = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else console.log( 'ok  ', msg );

};

// deterministic rng (same LCG as test/game-logic.mjs)
const seeded = ( seed ) => () => ( ( seed = ( seed * 1664525 + 1013904223 ) >>> 0 ) / 4294967296 );

const run = ( s, seconds, env = {}, rng = Math.random, dt = 1 / 30 ) => {

	for ( let t = 0; t < seconds; t += dt ) stepWeather( s, dt, env, rng );
	return s;

};

// ---- presets
ok( WEATHER_IDS.length === 4, 'four weather presets' );
ok( WEATHER.Clear.rain === 0 && WEATHER.Storm.rain === 1, 'clear to storm spans the rain range' );
ok( WEATHER_IDS.every( ( k, i ) => i === 0 || WEATHER[ k ].rain >= WEATHER[ WEATHER_IDS[ i - 1 ] ].rain ), 'rain increases down the list' );
ok( WEATHER.Drizzle.lightning === 0 && WEATHER.Storm.lightning === 1, 'drizzle has no lightning, a storm does' );

// ---- rain eases toward the target instead of jumping
{
	const s = createWeatherState( 'Storm' );
	stepWeather( s, 1, {}, Math.random );
	ok( s.rain > 0 && s.rain < 0.1, `rain eases in (1 s in: ${ s.rain.toFixed( 3 ) })` );
	run( s, 240 );
	ok( s.rain > 0.9, `rain reaches the target (${ s.rain.toFixed( 3 ) })` );

	// and back out again
	s.target = 0;
	run( s, 240 );
	ok( s.rain < 0.05, `rain clears (${ s.rain.toFixed( 3 ) })` );

}

// ---- wetness: quick to wet up, slow to dry off, and slower at night
{
	const s = createWeatherState( 'Rain' );
	run( s, 60 );
	ok( s.wetness > 0.5, `a minute of rain wets things up (${ s.wetness.toFixed( 3 ) })` );
	// the rain keeps soaking things until it has actually stopped easing out
	s.target = 0;
	run( s, 120, { night: 0, windSpeed: 2 } );
	const soaked = s.wetness;
	ok( soaked > 0.6, `they are soaked by the time it stops (${ soaked.toFixed( 3 ) })` );
	run( s, 600, { night: 0, windSpeed: 2 } );
	ok( s.wetness < soaked && s.wetness > 0.02, `and dry off slowly afterwards (${ soaked.toFixed( 3 ) } -> ${ s.wetness.toFixed( 3 ) })` );

	const day = createWeatherState( 'Rain' );
	run( day, 120 ); day.target = 0;
	run( day, 300, { night: 0, windSpeed: 2 } );
	const night = createWeatherState( 'Rain' );
	run( night, 120 ); night.target = 0;
	run( night, 300, { night: 1, windSpeed: 2 } );
	ok( day.wetness < night.wetness, `things dry faster by day than at night (${ day.wetness.toFixed( 3 ) } < ${ night.wetness.toFixed( 3 ) })` );

	const still = createWeatherState( 'Rain' );
	run( still, 120 ); still.target = 0;
	run( still, 300, { night: 0, windSpeed: 0 } );
	const breezy = createWeatherState( 'Rain' );
	run( breezy, 120 ); breezy.target = 0;
	run( breezy, 300, { night: 0, windSpeed: 20 } );
	ok( breezy.wetness < still.wetness, 'wind dries things faster than still air' );

}

// ---- wetness is bounded, and never appears without rain
{
	const s = createWeatherState( 'Clear' );
	run( s, 600, { night: 0 } );
	ok( s.wetness === 0 && s.rain === 0, 'no rain: nothing gets wet' );

	const t = createWeatherState( 'Storm' );
	run( t, 1800 );
	ok( t.wetness <= 1 && t.rain <= 1 && t.wetness >= 0, 'state stays in range over half an hour' );

}

// ---- lightning
{
	const clear = createWeatherState( 'Clear' );
	run( clear, 3600, {}, seeded( 7 ) );
	ok( clear.flashCount === 0 && clear.lightning === 0, 'clear skies never strike' );

	const storm = createWeatherState( 'Storm' );
	run( storm, 600, {}, seeded( 11 ) );
	ok( storm.flashCount > 5 && storm.flashCount < 200, `a storm strikes every few seconds, not constantly (${ storm.flashCount } in 10 minutes)` );

	// a strike is brief: most of the time there is no flash at all
	let lit = 0, frames = 0, peak = 0;
	const s = createWeatherState( 'Storm' );
	run( s, 120, {}, seeded( 3 ) );
	for ( let t = 0; t < 600; t += 1 / 60 ) {

		stepWeather( s, 1 / 60, {}, seeded( 3 + t ) );
		frames ++;
		if ( s.lightning > 1e-3 ) lit ++;
		peak = Math.max( peak, s.lightning );

	}

	ok( peak > 0.3, `a strike is bright (peak ${ peak.toFixed( 2 ) })` );
	ok( lit / frames < 0.4, `flashes are brief, not continuous (lit ${ ( 100 * lit / frames ).toFixed( 1 ) }% of frames)` );

	// the drizzle preset has no lightning even though it rains
	const drizzle = createWeatherState( 'Drizzle' );
	run( drizzle, 1800, {}, seeded( 5 ) );
	ok( drizzle.rain > 0.1 && drizzle.flashCount === 0, 'drizzle: rain but no lightning' );

}

// ---- the sky has to match: it does not rain out of a clear blue sky
{
	ok( cloudCover( 0 ) > 0.2, `even dry there is fair-weather cumulus (${ cloudCover( 0 ).toFixed( 2 ) })` );
	ok( cloudCover( 1 ) > 0.9, `a downpour is overcast (${ cloudCover( 1 ).toFixed( 2 ) })` );
	ok( cloudCover( 0.5 ) > cloudCover( 0 ) && cloudCover( 1 ) > cloudCover( 0.5 ), 'more rain, more cloud' );
	ok( WEATHER_IDS.every( ( k, i ) => i === 0 || cloudCover( WEATHER[ k ].rain ) >= cloudCover( WEATHER[ WEATHER_IDS[ i - 1 ] ].rain ) ), 'the presets carry the cloud up with the rain' );
	ok( cloudCover( 1 ) <= 1 && cloudCover( - 5 ) === cloudCover( 0 ), 'cloud cover stays in range' );

}

// ---- gusts
{
	const s = createWeatherState( 'Storm' );
	let lo = 1, hi = 0;
	for ( let t = 0; t < 600; t += 1 / 30 ) {

		stepWeather( s, 1 / 30, {}, Math.random );
		lo = Math.min( lo, s.gust ); hi = Math.max( hi, s.gust );

	}

	ok( lo < 0.3 && hi > 0.7, `gusts swell and drop (${ lo.toFixed( 2 ) } .. ${ hi.toFixed( 2 ) })` );
	const calm = createWeatherState( 'Clear' );
	run( calm, 300 );
	ok( calm.gust === 0, 'no rain, no squalls' );

}

// ---- fishing: rain brings them on
{
	ok( rainBiteRate( 0 ) === 1, 'no rain: the normal rate' );
	ok( rainBiteRate( 1 ) > 1.5 && rainBiteRate( 1 ) < 2, `a downpour is about twice the bites (${ rainBiteRate( 1 ).toFixed( 2 ) })` );
	const h = habitatAt( { depth: 6, reefDist: 40, pierDist: 200 } );
	const mean = ( rain ) => {

		let t = 0;
		const r = seeded( 99 );
		for ( let i = 0; i < 4000; i ++ ) t += biteDelay( h, 12, r, rain );
		return t / 4000;

	};

	const dry = mean( 0 ), wet = mean( 1 );
	ok( wet < dry, `bites come sooner in the rain (${ wet.toFixed( 1 ) } s vs ${ dry.toFixed( 1 ) } s)` );
	ok( biteDelay( habitatAt( { depth: 0, reefDist: 0, pierDist: 0 } ), 12, seeded( 1 ), 1 ) === Infinity, 'the sand still has no fish, rain or not' );

}

console.log( fails ? `\n${ fails } FAILED` : '\nall passed' );
process.exit( fails ? 1 : 0 );
