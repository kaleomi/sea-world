import { G } from '../core/Globals.js';

// Day / night and weather drive how alive the island feels: what is out, what is hunting, what is
// sitting still. This is the one place that turns the shared globals (frame.night, frame.weather,
// the sun direction) into named activity levels; the animal modules ask it for the levels they
// care about instead of reading the globals themselves, so the whole ecosystem shares one
// interpretation of "it is getting dark" or "it is blowing hard".
//
//   air          how much the diurnal birds are on the wing (daylight, killed by rain)
//   forage       appetite for plunge-diving (light, a steady air column, and a calm sea)
//   roost        the urge to sit tight (night, or heavy rain)
//   soar         quality of the soaring (daylight, better with gusts, spoilt by rain)
//   shore        shorebirds roosting up the beach (night, or rain)
//   crab         how many ghost crabs are out of their burrows
//   whaleSurface / whaleBreach / whaleDeep   how often the whale comes up, how often it launches,
//                                            how deep it rides
//
// Pure: computeRhythm() is a plain function over numbers and so is testable in node
// (test/eco-rhythm.mjs). The RHYTHM singleton at the bottom samples the live globals once per
// frame and is what the world modules read.

export const clamp = ( x, a, b ) => ( x < a ? a : x > b ? b : x );
const smooth = ( a, b, x ) => {

	const t = clamp( ( x - a ) / ( b - a ), 0, 1 );
	return t * t * ( 3 - 2 * t );

};

// the ones that hunt after dark: the lurkers and the roamers. Everyone else in the table is a
// daylight fish that tucks into the reef at night.
const NOCTURNAL = new Set( [ 'grouper', 'barracuda', 'tarpon', 'jack', 'eagleRay', 'stingray' ] );

export function computeRhythm( r, src ) {

	const night = clamp( src.night ?? 0, 0, 1 );
	const sunY = src.sunY ?? 0;
	const rain = clamp( src.rain ?? 0, 0, 1 );
	const wet = clamp( src.wet ?? 0, 0, 1 );
	const gust = clamp( src.gust ?? 0, 0, 1 );

	const day = 1 - night;
	// the sun sitting on the horizon: dawn and dusk. Everything feeds hardest in this window.
	const dusk = smooth( 0.25, - 0.05, sunY ) * ( 1 - smooth( - 0.05, - 0.25, sunY ) );
	// how bad the sea is: rain and gust together
	const storm = clamp( 0.62 * rain + 0.38 * gust, 0, 1 );

	r.night = night;
	r.day = day;
	r.sunY = sunY;
	r.rain = rain;
	r.wet = wet;
	r.gust = gust;
	r.dusk = dusk;
	r.storm = storm;

	// ---- birds
	r.air = smooth( 0.10, 0.55, day ) * ( 1 - 0.85 * rain );
	r.forage = clamp( r.air * ( 1 - 0.45 * gust ) * ( 1 + 0.35 * dusk ), 0, 1 );
	r.roost = clamp( Math.max( 1 - r.air, rain * 0.9 ), 0, 1 );
	r.soar = clamp( smooth( 0.20, 0.70, day ) * ( 0.45 + 0.80 * gust ) * ( 1 - 0.70 * rain ), 0, 1 );

	// ---- the beach
	r.shore = clamp( Math.max( night, rain * 1.15 ), 0, 1 );
	r.crab = clamp( ( 0.45 + 0.5 * Math.max( night, smooth( 0.35, 0.05, sunY ) ) ) * ( 1 - 0.75 * rain ), 0, 0.95 );

	// ---- the whale: up more at dawn and after dark, quiet and deep once the sea gets up
	r.whaleSurface = clamp( 0.70 + 0.30 * dusk + 0.20 * night - 0.40 * storm, 0.15, 1 );
	r.whaleBreach = clamp( 0.50 + 0.45 * dusk + 0.25 * night - 0.45 * storm, 0, 1 );
	r.whaleDeep = storm;

	// ---- bioluminescence: an artistic night-time visibility envelope, not a biological model.
	// Rain reduces the readable contrast to 55% at full downpour; it never boosts the glow.
	r.glow = smooth( 0.25, 0.90, night ) * ( 1 - 0.45 * rain );

	return r;

}

export function createRhythm() {

	return computeRhythm( {}, {} );

}

// Where in the water column a school wants to be, as a shift of the species' preferred fraction
// (0 = on the bottom, 1 = at the ceiling). Negative is deeper.
export function fishDepthShift( name, r ) {

	if ( NOCTURNAL.has( name ) ) return 0.16 * r.night - 0.08 * r.day - 0.06 * r.rain;
	return - 0.28 * r.night - 0.14 * r.rain;

}

// How eagerly a school moves about: the diurnal reef dozes at night, the night hunters wake up,
// and rain slows everyone down a little.
export function fishPace( name, r ) {

	if ( NOCTURNAL.has( name ) ) return clamp( 0.75 + 0.45 * r.night - 0.20 * r.rain, 0.30, 1.20 );
	return clamp( 0.35 + 0.65 * r.day - 0.15 * r.rain, 0.25, 1.00 );

}

// The live sampler. Everything in the world reads the same object; it recomputes when the frame
// clock moves, so it costs one read of a handful of uniforms per frame no matter how many animals
// ask.
export class EcoRhythm {

	constructor() {

		// a neutral start: midday, clear. The first sample() replaces it.
		computeRhythm( this, { sunY: 1 } );
		this.stamp = - 1;

	}

	sample() {

		const t = G.time.value;
		if ( t !== this.stamp ) {

			this.stamp = t;
			computeRhythm( this, {
				night: G.night.value,
				sunY: G.sunDir.value.y,
				rain: G.weather.value.x,
				wet: G.weather.value.y,
				gust: G.weather.value.w,
			} );

		}

		return this;

	}

}

export const RHYTHM = new EcoRhythm();
