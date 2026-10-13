import { G } from '../core/Globals.js';

// The tide. The game is called Tidewater and the terrain is carved with tide pools, but until now
// `frame.seaLevel` was pinned at 0 and the coast never breathed. This is the one place that turns
// the clock and a couple of user knobs into a single sea-level offset (metres) that every
// water-aware module already reads through `frame.seaLevel`:
//
//   - the ocean surface (WaterQuery, the FFT sea, the refraction pass) rides it;
//   - the player, the boat, the birds and the reef fish all measure their heights from it;
//   - the beach widens and narrows as the swash line climbs and falls.
//
// It is a *semidiurnal* tide: two highs and two lows, one full sine period = one high + one low.
// Real tides are driven by the moon and so run on their own clock, independent of the sun: the
// period is therefore a plain number of seconds, not tied to the 24 h day, and it keeps moving even
// when the sun clock is paused.
//
//   level       signed height of the surface relative to mean sea level (m). + = high water.
//   rate        d(level)/dt (m/s), for the rising / falling read-out.
//
// Pure: computeTide() is a plain function over numbers and so is testable in node
// (test/tide-logic.mjs). The TIDE singleton at the bottom samples the live settings once per frame
// and is what App._frame writes into G.seaLevel.

const TWO_PI = Math.PI * 2;

const clamp = ( x, a, b ) => ( x < a ? a : x > b ? b : x );

export const TIDE_MIN_AMPLITUDE = 0;    // m: flat calm (no tide)
export const TIDE_MAX_AMPLITUDE = 1.2;  // m: the strongest spring tide we expose
export const TIDE_MIN_PERIOD = 180;     // s: one high + one low
export const TIDE_MAX_PERIOD = 1800;

// One high + one low. 900 s (15 min) reads as a slow, believable creep of the waterline while
// still showing the full rise and fall inside a short session.
export const TIDE_PERIOD = 900;

export function computeTide( r, src ) {

	const t = src.time ?? 0;                        // seconds since start (frame.time)
	const period = clamp( src.period ?? TIDE_PERIOD, TIDE_MIN_PERIOD, TIDE_MAX_PERIOD );
	const amp = clamp( src.amplitude ?? 0.65, TIDE_MIN_AMPLITUDE, TIDE_MAX_AMPLITUDE );
	const phase = src.phase ?? 0;                   // 0..1 fraction of the cycle

	const w = TWO_PI / period;
	const a = w * ( t + phase * period );

	r.amplitude = amp;
	r.period = period;
	r.level = amp * Math.sin( a );
	r.rate = amp * w * Math.cos( a );

	return r;

}

// 'rising' | 'falling' | 'slack' — for the read-out. Slack when the water is barely moving, or
// when there is no tide at all.
export function tideStage( r ) {

	if ( r.amplitude <= 1e-4 ) return 'slack';
	// the rate scales with amplitude / period, so the "barely moving" band must too
	const maxRate = r.amplitude * ( TWO_PI / r.period );
	if ( Math.abs( r.rate ) < maxRate * 0.02 ) return 'slack';
	return r.rate > 0 ? 'rising' : 'falling';

}

export class Tides {

	constructor() {

		this.level = 0;
		this.rate = 0;
		this.amplitude = 0.65;
		this.period = TIDE_PERIOD;
		this.stamp = null;
		computeTide( this, { time: 0, amplitude: 0.65, period: TIDE_PERIOD, phase: 0 } );

	}

	// Called once per frame from App._frame, before the water sim and the CPU game update, so
	// every consumer in the frame sees the same sea level. Writes frame.seaLevel.
	update( time, amplitude, period, phase ) {

		const key = `${ time }|${ amplitude }|${ period }|${ phase }`;
		if ( key !== this.stamp ) {

			this.stamp = key;
			computeTide( this, { time, amplitude, period, phase } );
			G.seaLevel.value = this.level;

		}

		return this;

	}

}

export const TIDE = new Tides();
