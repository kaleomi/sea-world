import { ShaderModule } from '../engine/gpu/Shader.js';
import { commonModule } from '../engine/render/wgsl/common.js';

// Rain striking a water surface: the rings a drop leaves as it goes in.
//
// One drop per cell of a jittered grid, landing at a hashed moment of a short cycle and sending out a
// train of rings that spread and fade. The grid moves with the world (not the camera), so the pattern
// does not slide around under you, and it costs nothing to keep up: no simulation, no storage.
//
// The rings are only a metre or so across, so past a few tens of metres they are smaller than a pixel
// and stop being worth computing: the caller (WaterMaterial) switches to unresolved roughness there
// instead, which is what the surface actually looks like at that distance.
//
// WGSL (prefix `rainRipple`; deps: commonModule for hash22):
//   struct RainRipple { slope: vec2f, foam: f32, cover: f32 }
//   fn rainRipples( xz: vec2f, t: f32 ) -> RainRipple
//     slope: the surface slope dH/d(xz) of the rings (add it to the surface's own)
//     foam:  the crown of bubbles where a drop has just struck
//     cover: how much of the surface is disturbed (for fading the whole effect)
export const rainRippleModule = new ShaderModule( {
	name: 'rainRipples', deps: [ commonModule ], code: /* wgsl */`
struct RainRipple { slope: vec2f, foam: f32, cover: f32 };

// t: simulation time (s). Returns the rings' slope (dH/dx, dH/dz), their foam and their coverage.
fn rainRipples( xz: vec2f, t: f32 ) -> RainRipple {

	var acc = RainRipple( vec2f( 0.0 ), 0.0, 0.0 );
	// drops about 2-3 per square metre in a downpour (the cell is a little over half a metre)
	let cell = 0.62;
	let base = floor( xz / cell );
	for ( var j = - 1; j <= 1; j ++ ) {
		for ( var i = - 1; i <= 1; i ++ ) {
			let c = base + vec2f( f32( i ), f32( j ) );
			let h = hash22( c );
			let h2 = hash22( c + vec2f( 17.3, 5.1 ) );
			let centre = ( c + 0.15 + h * 0.7 ) * cell;
			// when in the cycle this drop lands (neighbours never land together)
			let period = 1.25;
			let age = fract( ( t - h2.x * period ) / period ) * period;
			// the ring front runs outwards at the shallow-water speed of a capillary-gravity wave
			// train; the whole thing dies out as it spreads and as the drop's energy is spent
			let r = age * 0.9;
			let d = xz - centre;
			let dist = length( d ) + 1e-5;
			let w = dist - r;
			let amp = exp( - r * 2.4 ) * exp( - age * 1.6 ) * ( 1.0 - smoothstep( 0.3, 0.55, r ) );
			// a couple of oscillations behind the front, and nothing ahead of it
			let wave = sin( w * 38.0 ) * exp( - abs( w ) * 7.0 );
			acc.slope += ( d / dist ) * ( amp * wave * 0.85 );
			// the crown: a ring of bubbles right where the drop went in, gone in a fraction of a second
			acc.foam = max( acc.foam, amp * smoothstep( 0.07, 0.0, abs( w ) ) * smoothstep( 0.18, 0.04, age ) );
			acc.cover = max( acc.cover, amp );
		}
	}
	return acc;

}
`,
} );
