// Plain-node tests of the tide (no GPU): the shape of the curve, its range, its period, the
// phase, the clamps and the rising / falling read-out. src/world/Tides.js.
import { computeTide, tideStage, TIDE_MIN_AMPLITUDE, TIDE_MAX_AMPLITUDE, TIDE_MIN_PERIOD, TIDE_MAX_PERIOD } from '../src/world/Tides.js';

let fails = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else console.log( 'ok  ', msg );

};

const near = ( a, b, eps = 1e-9 ) => Math.abs( a - b ) <= eps;
const at = ( src ) => computeTide( {}, src );

const PERIOD = 900;
const AMP = 0.65;
const base = { time: 0, amplitude: AMP, period: PERIOD, phase: 0 };

// ---- the curve is a clean sine of the requested amplitude
{
	const q = at( { ...base, time: PERIOD / 4 } );       // a quarter period in: high water
	const h = at( { ...base, time: 3 * PERIOD / 4 } );   // three quarters: low water
	ok( near( q.level, AMP ), `a quarter period in: high water at +amplitude (${ q.level.toFixed( 4 ) })` );
	ok( near( h.level, - AMP ), `three quarters in: low water at -amplitude (${ h.level.toFixed( 4 ) })` );
	ok( near( at( base ).level, 0 ), 'starting on the mean: level 0 at t = 0' );
	ok( at( base ).rate > 0, 'and rising there (rate > 0)' );
	ok( near( at( { ...base, time: PERIOD / 2 } ).level, 0 ), 'half a period in: back to the mean' );
	ok( at( { ...base, time: PERIOD / 2 } ).rate < 0, 'and falling there (rate < 0)' );
}

// ---- the period is exactly the period
{
	let worst = 0;
	for ( const f of [ 0, 0.13, 0.5, 0.77 ] ) {

		const t = f * PERIOD;
		worst = Math.max( worst, Math.abs( at( { ...base, time: t } ).level - at( { ...base, time: t + PERIOD } ).level ) );
		worst = Math.max( worst, Math.abs( at( { ...base, time: t } ).level - at( { ...base, time: t + 3 * PERIOD } ).level ) );

	}

	ok( worst < 1e-9, `the curve repeats every period (max drift ${ worst.toExponential( 1 ) })` );
}

// ---- phase shifts the whole curve
{
	ok( near( at( { ...base, phase: 0.25 } ).level, AMP ), 'phase 0.25 starts on the high water' );
	ok( near( at( { ...base, phase: 0.75 } ).level, - AMP ), 'phase 0.75 starts on the low water' );
	const a = at( { ...base, time: 137 } ).level, b = at( { ...base, time: 137, phase: 0.4 } ).level;
	ok( ! near( a, b ), 'phase moves the reading at a fixed time' );
}

// ---- the level never leaves ± amplitude, over the whole input space
{
	let bad = null;
	for ( const amp of [ 0, 0.3, 0.65, 1.2 ] ) for ( const period of [ 180, 600, 900, 1800 ] ) for ( let i = 0; i <= 24; i ++ ) {

		const r = at( { time: i * period / 12, amplitude: amp, period, phase: i / 7 } );
		if ( ! Number.isFinite( r.level ) || Math.abs( r.level ) > amp + 1e-9 ) bad = bad ?? `|${ r.level }| > ${ amp } at period ${ period }, i ${ i }`;
		if ( ! Number.isFinite( r.rate ) ) bad = bad ?? `rate NaN at period ${ period }, i ${ i }`;

	}

	ok( bad === null, bad ?? 'the level stays inside ± amplitude everywhere' );
}

// ---- amplitude 0 is dead flat
{
	ok( at( { ...base, amplitude: 0, time: 123 } ).level === 0, 'no amplitude: the sea is flat' );
	ok( tideStage( at( { ...base, amplitude: 0, time: 123 } ) ) === 'slack', 'and reads as slack' );
}

// ---- inputs are clamped, not broken
{
	ok( at( { ...base, amplitude: 99 } ).amplitude === TIDE_MAX_AMPLITUDE, 'a huge amplitude clamps to the maximum' );
	ok( at( { ...base, amplitude: - 5 } ).amplitude === TIDE_MIN_AMPLITUDE, 'a negative amplitude clamps to 0' );
	ok( at( { ...base, period: 1 } ).period === TIDE_MIN_PERIOD, 'a tiny period clamps to the minimum' );
	ok( at( { ...base, period: 1e9 } ).period === TIDE_MAX_PERIOD, 'a huge period clamps to the maximum' );
	ok( Number.isFinite( at( {} ).level ), 'an empty reading is finite (all defaults)' );
}

// ---- the rising / falling read-out tracks the slope
{
	ok( tideStage( at( { ...base, time: 0.1 * PERIOD } ) ) === 'rising', 'just after the low-ish start it reads rising' );
	ok( tideStage( at( { ...base, time: 0.6 * PERIOD } ) ) === 'falling', 'past the high it reads falling' );
	// around the crest the slope vanishes: slack at the very top and bottom
	ok( tideStage( at( { ...base, time: PERIOD / 4 } ) ) === 'slack', 'at the top of the tide it reads slack' );
	ok( tideStage( at( { ...base, time: 3 * PERIOD / 4 } ) ) === 'slack', 'and at the bottom too' );
}

// ---- the stage agrees with the sign of the rate everywhere else
{
	let bad = null;
	for ( let i = 0; i <= 96; i ++ ) {

		const r = at( { ...base, time: i * PERIOD / 96 } );
		const s = tideStage( r );
		const maxRate = r.amplitude * ( 2 * Math.PI / r.period );
		if ( Math.abs( r.rate ) > maxRate * 0.02 ) {

			const want = r.rate > 0 ? 'rising' : 'falling';
			if ( s !== want ) bad = bad ?? `stage ${ s } but rate ${ r.rate } at i ${ i }`;

		}

	}

	ok( bad === null, bad ?? 'rising / falling always matches the slope' );
}

console.log( fails === 0 ? '\nall good' : `\n${ fails } FAILED` );
process.exit( fails === 0 ? 0 : 1 );
