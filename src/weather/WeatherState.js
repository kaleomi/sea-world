// Weather state: pure numbers, no engine imports, so it can be unit-tested in plain node
// (see test/weather-logic.mjs). Weather.js owns the GPU side: it copies these onto `frame.weather`,
// installs the wetness hook and drives the rain particles and the rain / thunder beds.
//
//   rain       0..1   how hard it is raining right now (eases toward the preset's target)
//   wetness    0..1   how wet exposed surfaces are: fast to wet up, slow to dry off
//   lightning  0..1   the current flash (0 between strikes)
//   gust       0..1   slow swell in the wind (squalls), on top of the sea state's wind speed

export const WEATHER = {
	Clear: { rain: 0, lightning: 0, gust: 0, label: 'Clear' },
	Drizzle: { rain: 0.15, lightning: 0, gust: 0.08, label: 'Drizzle' },
	Rain: { rain: 0.5, lightning: 0.3, gust: 0.35, label: 'Rain' },
	// 'Thunderstorm' rather than 'Storm' so its label does not collide with the sea
	// state preset of the same name (both are dictionary keys; see src/i18n/)
	Storm: { rain: 1, lightning: 1, gust: 1, label: 'Thunderstorm' },
};

export const WEATHER_IDS = Object.keys( WEATHER );

const clamp = ( x, a, b ) => ( x < a ? a : x > b ? b : x );
const lerp = ( a, b, t ) => a + ( b - a ) * t;

// How much of the sky is cloud for a given rain (0..1). A tropical island always carries some
// fair-weather cumulus, and it takes a solid overcast before it really rains, so this never goes to
// nothing and never quite to a sealed lid either. Weather.js sets `clouds.coverage` from it.
export function cloudCover( rain ) {

	return 0.35 + 0.6 * Math.min( 1, Math.max( 0, rain ) );

}

// a squall arrives / clears over about this long (s)
const RAIN_TAU = 30;
// how fast surfaces wet up under full rain (s), and how long they take to dry (s)
const WET_TAU = 22;
const DRY_TAU_DAY = 210;
const DRY_TAU_NIGHT = 480;
// rain has to be at least this before a storm will throw lightning
const LIGHTNING_RAIN = 0.15;

export function createWeatherState( preset = 'Clear' ) {

	const p = WEATHER[ preset ] || WEATHER.Clear;
	return {
		preset: WEATHER[ preset ] ? preset : 'Clear',
		target: p.rain, // where `rain` is heading
		rain: 0,
		wetness: 0,
		lightning: 0,
		gust: 0,
		lightningRate: p.lightning,
		gustAmount: p.gust,
		time: 0,
		strikes: [], // live sub-flashes: { t0, amp, rise, fall }
		nextStrike: Infinity,
		flashCount: 0,
	};

}

// seconds until the next strike: a distant storm every minute or two, a cell overhead every few
// seconds (a real thunderstorm manages a few strikes a minute, and none of them are evenly spaced)
function strikeInterval( rate, rng ) {

	return lerp( 80, 8, rate ) * ( 0.5 + rng() );

}

// a strike is 1..3 sub-flashes: the channel flickers (a real flash is rarely a single pulse)
function addStrike( s, rate, rng ) {

	const n = 1 + Math.floor( rng() * ( 1 + rate * 2.5 ) );
	const amp = clamp( 0.55 + 0.65 * rate, 0, 1.2 ) * ( 0.7 + 0.3 * rng() );
	for ( let i = 0; i < n; i ++ ) {

		s.strikes.push( {
			t0: s.time + i * ( 0.05 + rng() * 0.16 ),
			amp: amp * ( i === 0 ? 1 : 0.35 + 0.4 * rng() ),
			rise: 0.012 + rng() * 0.03, // fast attack
			fall: 0.09 + rng() * 0.16, // exponential decay
		} );

	}

	s.flashCount ++;

}

// env: { night 0..1, windSpeed m/s }. Returns the same state object.
export function stepWeather( s, dt, env = {}, rng = Math.random ) {

	const night = clamp( env.night ?? 0, 0, 1 );
	const wind = Math.max( 0, env.windSpeed ?? 7 );

	s.time += dt;

	// rain eases toward the preset's target
	s.rain += ( s.target - s.rain ) * ( 1 - Math.exp( - dt / RAIN_TAU ) );
	s.rain = clamp( s.rain, 0, 1 );

	// wetness: quick to wet up, slow to dry off (quicker in sun and wind)
	if ( s.rain > 0.01 ) {

		s.wetness += ( 1 - s.wetness ) * ( s.rain * dt / WET_TAU );

	} else {

		const tau = lerp( DRY_TAU_DAY, DRY_TAU_NIGHT, night ) / ( 1 + wind * 0.03 );
		s.wetness -= s.wetness * ( dt / tau );

	}

	s.wetness = clamp( s.wetness, 0, 1 );

	// gusts: two slow swells, so the wind breathes instead of sitting at one value
	const t = s.time;
	s.gust = clamp( 0.5 + 0.3 * Math.sin( t * 0.19 ) + 0.2 * Math.sin( t * 0.53 + 1.7 ), 0, 1 )
		* ( s.gustAmount ?? 0 );

	// ---- lightning
	const rate = clamp( ( s.lightningRate ?? 0 ) * clamp( ( s.rain - LIGHTNING_RAIN ) / 0.5, 0, 1 ), 0, 1 );
	if ( rate <= 0 ) {

		s.nextStrike = Infinity;

	} else {

		if ( s.nextStrike === Infinity ) s.nextStrike = strikeInterval( rate, rng );
		s.nextStrike -= dt;
		if ( s.nextStrike <= 0 ) {

			addStrike( s, rate, rng );
			s.nextStrike = strikeInterval( rate, rng );

		}

	}

	// sum the live sub-flashes (and drop the dead ones)
	let L = 0;
	const keep = [];
	for ( const f of s.strikes ) {

		const age = s.time - f.t0;
		if ( age < 0 ) { keep.push( f ); continue; }
		if ( age > f.rise + f.fall * 6 ) continue; // spent
		L += f.amp * ( age < f.rise ? age / f.rise : Math.exp( - ( age - f.rise ) / f.fall ) );
		keep.push( f );

	}

	s.strikes = keep;
	s.lightning = Math.min( L, 1.5 );
	return s;

}
