// Getting a stranded boat off the sand: the nearest water deep enough to float and steer in, all round
// the boat's spot, pointing away from the shore it ran onto. Game moves the boat there (B, aboard).
//   const spot = deepWaterNear( ( x, z ) => terrain.heightAt( x, z ), x, z, seaLevel )  → { x, z, heading, dist } | null
//   aground( depth, throttle, speed )  → is the boat stuck (driving, but not moving, in water too shallow)
export const MIN_DEPTH = 4; // m of water at the new spot
const CLEAR = 9; // m: and at least CLEAR_DEPTH everywhere this far round it (room for the hull to turn)
const CLEAR_DEPTH = 2.5;

export function deepWaterNear( heightAt, x, z, seaLevel = 0, { maxR = 800, step = 6 } = {} ) {

	const depth = ( px, pz ) => seaLevel - heightAt( px, pz );
	for ( let r = step; r <= maxR; r += step ) {

		const n = Math.max( 12, Math.ceil( r * 2 * Math.PI / step ) );
		let best = null;
		for ( let i = 0; i < n; i ++ ) {

			const a = i / n * Math.PI * 2;
			const px = x + Math.cos( a ) * r, pz = z + Math.sin( a ) * r;
			const d = depth( px, pz );
			if ( d < MIN_DEPTH ) continue;
			let ok = true;
			for ( let k = 0; k < 8 && ok; k ++ ) {

				const b = k / 8 * Math.PI * 2;
				if ( depth( px + Math.cos( b ) * CLEAR, pz + Math.sin( b ) * CLEAR ) < CLEAR_DEPTH ) ok = false;

			}

			if ( ok && ( ! best || d > best.d ) ) best = { x: px, z: pz, d, a };

		}

		// bow pointing on, away from where it was stuck (heading: yaw with +z ahead, as the boat's)
		if ( best ) return { x: best.x, z: best.z, heading: Math.atan2( Math.cos( best.a ), Math.sin( best.a ) ), dist: r };

	}

	return null;

}

export function aground( depth, throttle, speed ) {

	return depth < 1.2 && Math.abs( throttle ) > 0.3 && speed < 0.6;

}
