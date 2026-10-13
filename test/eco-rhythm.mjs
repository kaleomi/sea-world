// Plain-node tests of the day/night + weather ecology (no GPU): the activity levels, the fish
// depth shift and pace, and that nothing escapes its range.
import { computeRhythm, createRhythm, fishDepthShift, fishPace, clamp } from '../src/world/EcoRhythm.js';

let fails = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else console.log( 'ok  ', msg );

};

const at = ( src ) => computeRhythm( createRhythm(), src );

// four reference skies / hours
const MIDDAY = { night: 0, sunY: 1.0, rain: 0, gust: 0 };
const DUSK = { night: 0.35, sunY: - 0.05, rain: 0, gust: 0 };
const NIGHT = { night: 1, sunY: - 0.9, rain: 0, gust: 0 };
const STORM = { night: 0, sunY: 0.6, rain: 1, gust: 1 };

const mid = at( MIDDAY ), dusk = at( DUSK ), night = at( NIGHT ), storm = at( STORM );

// ---- every level stays in 0..1
{
	const LEVELS = [ 'day', 'night', 'dusk', 'storm', 'air', 'forage', 'roost', 'soar', 'shore', 'crab', 'whaleSurface', 'whaleBreach', 'whaleDeep', 'glow' ];
	const skies = [ MIDDAY, DUSK, NIGHT, STORM ];
	let bad = null;
	for ( let n = 0; n <= 10; n ++ ) for ( let r = 0; r <= 10; r ++ ) for ( let g = 0; g <= 5; g ++ ) for ( const y of [ - 1, - 0.3, 0, 0.5, 1 ] ) {

		const s = at( { night: n / 10, rain: r / 10, gust: g / 5, sunY: y } );
		for ( const k of LEVELS ) {

			const v = s[ k ];
			if ( ! Number.isFinite( v ) || v < 0 || v > 1 ) bad = bad ?? `${ k }=${ v } at night=${ n / 10 } rain=${ r / 10 } gust=${ g / 5 } sunY=${ y }`;

		}

	}

	ok( bad === null, bad ?? 'every level stays inside 0..1 over the whole input space' );
}

// ---- out-of-range inputs are clamped, not broken
{
	const s = at( { night: 4, rain: - 2, gust: 9, sunY: 12 } );
	ok( s.night === 1 && s.rain === 0 && s.gust === 1, 'out-of-range inputs are clamped' );
	ok( Number.isFinite( s.air ) && Number.isFinite( s.crab ), 'no NaN from nonsense input' );
	ok( computeRhythm( createRhythm(), {} ).air === 1, 'an empty reading behaves like clear midday' );
}

// ---- birds
ok( mid.air > 0.99, `clear midday: everything is on the wing (${ mid.air.toFixed( 2 ) })` );
ok( night.air === 0, 'full night: nothing is on the wing' );
ok( night.roost > 0.99, 'full night: the birds roost' );
ok( storm.air < 0.2 && storm.roost > 0.8, `a storm grounds them (air ${ storm.air.toFixed( 2 ) }, roost ${ storm.roost.toFixed( 2 ) })` );
ok( storm.forage < mid.forage, 'no plunge-diving in a storm' );
ok( mid.forage > 0.99, 'a clear calm day: full foraging' );
ok( at( { ...MIDDAY, gust: 1 } ).forage < mid.forage, 'gusts make hovering and diving harder' );
ok( night.soar === 0, 'nothing soars in the dark' );
ok( at( { ...MIDDAY, gust: 1 } ).soar > mid.soar, `gusts lift the soaring (${ mid.soar.toFixed( 2 ) } -> ${ at( { ...MIDDAY, gust: 1 } ).soar.toFixed( 2 ) })` );
ok( storm.soar < mid.soar, 'rain spoils the soaring even with the wind up' );

// ---- rain is monotonic: more rain never wakes anything up
{
	let prevAir = 2, prevCrab = 2, prevWhale = 2, prevGlow = 2, mono = true;
	for ( let r = 0; r <= 10; r ++ ) {

		const s = at( { night: 1, sunY: - 0.9, rain: r / 10, gust: 0 } );
		if ( s.air > prevAir + 1e-9 || s.crab > prevCrab + 1e-9 || s.whaleSurface > prevWhale + 1e-9 || s.glow > prevGlow + 1e-9 ) mono = false;
		prevAir = s.air; prevCrab = s.crab; prevWhale = s.whaleSurface; prevGlow = s.glow;

	}

	ok( mono, 'more rain never makes the birds, crabs, whale or the glow stronger' );
}

// ---- the beach
ok( night.shore > 0.6, 'the shorebirds roost up the beach at night' );
ok( at( { ...MIDDAY, rain: 0.6 } ).shore > 0.6, 'and in steady rain' );
ok( mid.shore === 0, 'a clear day: they work the swash' );
{
	// the crab curve is the one Crabs.js used, with the rain term added; with no rain it matches
	const old = ( night, sunY ) => clamp( 0.45 + 0.5 * Math.max( night, ( ( x, a, b ) => {

		const t = clamp( ( x - a ) / ( b - a ), 0, 1 );
		return t * t * ( 3 - 2 * t );

	} )( sunY, 0.35, 0.05 ) ), 0, 0.95 );
	let worst = 0;
	for ( let n = 0; n <= 10; n ++ ) for ( const y of [ - 1, - 0.4, 0, 0.2, 1 ] ) {

		const s = at( { night: n / 10, sunY: y, rain: 0, gust: 0 } );
		worst = Math.max( worst, Math.abs( s.crab - old( n / 10, y ) ) );

	}

	ok( worst < 1e-9, `no rain: the crab curve is unchanged (max drift ${ worst.toExponential( 1 ) })` );
	ok( storm.crab < mid.crab, `rain keeps the crabs in their burrows (${ mid.crab.toFixed( 2 ) } -> ${ storm.crab.toFixed( 2 ) })` );
	ok( night.crab > mid.crab, 'and night brings them out' );
}

// ---- the whale
ok( mid.whaleSurface > 0.6 && mid.whaleSurface < 0.8, `midday: it comes up most passes (${ mid.whaleSurface.toFixed( 2 ) })` );
ok( dusk.whaleSurface > mid.whaleSurface, 'dawn and dusk: it comes up more' );
ok( night.whaleSurface > mid.whaleSurface, 'and more again at night' );
ok( storm.whaleSurface < mid.whaleSurface, 'a rough sea keeps it down' );
ok( storm.whaleBreach < 0.1, `no breaching in a storm (${ storm.whaleBreach.toFixed( 2 ) })` );
ok( Math.abs( mid.whaleBreach - 0.5 ) < 1e-9, 'clear midday: the old 50% breach chance, untouched' );
ok( dusk.whaleBreach > mid.whaleBreach && night.whaleBreach > mid.whaleBreach, 'it launches more at dawn, dusk and night' );
ok( storm.whaleDeep > 0.9 && mid.whaleDeep === 0, 'it rides deeper only once the sea is up' );

// ---- bioluminescence
ok( mid.glow === 0, 'a clear day: no glow' );
ok( night.glow > 0.95, `full night: the sea lights up (${ night.glow.toFixed( 2 ) })` );
ok( dusk.glow > 0 && dusk.glow < 0.3, `dusk: it is only just starting to show (${ dusk.glow.toFixed( 2 ) })` );
ok( at( { ...NIGHT, rain: 1 } ).glow < night.glow * 0.6, `a downpour washes it out (${ night.glow.toFixed( 2 ) } -> ${ at( { ...NIGHT, rain: 1 } ).glow.toFixed( 2 ) })` );

// ---- the reef
ok( fishDepthShift( 'chromis', night ) < - 0.2, 'a diurnal reef fish sinks into the reef at night' );
ok( Math.abs( fishDepthShift( 'chromis', mid ) ) < 1e-9, 'and sits at its usual height by day' );
ok( fishDepthShift( 'grouper', night ) > 0.1, 'a night hunter rises after dark' );
ok( fishDepthShift( 'grouper', mid ) < 0, 'and lies lower by day' );
ok( fishDepthShift( 'chromis', at( { ...MIDDAY, rain: 1 } ) ) < 0, 'rain pushes the reef down off the surface' );
ok( fishDepthShift( 'grouper', night ) > fishDepthShift( 'chromis', night ), 'at night the hunters sit above the reef fish' );
ok( fishPace( 'chromis', night ) < fishPace( 'chromis', mid ), 'the reef dozes after dark' );
ok( fishPace( 'grouper', night ) > fishPace( 'grouper', mid ), 'the hunters wake up' );
ok( fishPace( 'chromis', night ) < fishPace( 'grouper', night ), 'so the night belongs to the hunters' );
ok( Math.abs( fishPace( 'chromis', mid ) - 1 ) < 1e-9, 'clear midday: the reef moves at its usual pace' );
{
	let bad = null;
	for ( const name of [ 'chromis', 'grouper', 'tang', 'jack', 'wrasse', 'unknownSpecies' ] ) {

		for ( const s of [ mid, dusk, night, storm ] ) {

			const d = fishDepthShift( name, s ), p = fishPace( name, s );
			if ( d < - 0.5 || d > 0.5 ) bad = bad ?? `depth shift out of range: ${ name } ${ d }`;
			if ( ! ( p >= 0.2 && p <= 1.3 ) ) bad = bad ?? `pace out of range: ${ name } ${ p }`;

		}

	}

	ok( bad === null, bad ?? 'the fish shifts and paces stay in a sane band for every species' );
}

console.log( fails === 0 ? '\nall good' : `\n${ fails } FAILED` );
process.exit( fails === 0 ? 0 : 1 );
