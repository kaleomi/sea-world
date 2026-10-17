import { GRAVITY } from '../engine/render/Frame.js';

// Offline wave-propagation field for shoreline waves.
//
// Solves the Eikonal equation |grad T| = 1 / c(x) with the Fast Marching Method, where
// c = sqrt(g * depth) is the shallow-water wave speed (capped offshore). Sources are the
// domain borders initialized with a plane wave travelling along `swellDir`, so wave fronts
// refract naturally around headlands and align with the depth contours near the beach.
//
// Output texture (RGBA float, res x res over the terrain domain):
//   r = arrival time T (s), g,b = propagation direction * exposure (length = exposure 0..1),
//   a = arrival time at the nearest shoreline (extended onto land for swash timing)

class MinHeap {

	constructor( cap ) {

		this.keys = new Float64Array( cap );
		this.vals = new Int32Array( cap );
		this.size = 0;

	}

	push( k, v ) {

		let i = this.size ++;
		const keys = this.keys, vals = this.vals;
		while ( i > 0 ) {

			const p = ( i - 1 ) >> 1;
			if ( keys[ p ] <= k ) break;
			keys[ i ] = keys[ p ]; vals[ i ] = vals[ p ];
			i = p;

		}

		keys[ i ] = k; vals[ i ] = v;

	}

	pop() {

		const keys = this.keys, vals = this.vals;
		const top = vals[ 0 ];
		const k = keys[ -- this.size ], v = vals[ this.size ];
		let i = 0;
		const n = this.size;
		while ( true ) {

			let c = 2 * i + 1;
			if ( c >= n ) break;
			if ( c + 1 < n && keys[ c + 1 ] < keys[ c ] ) c ++;
			if ( keys[ c ] >= k ) break;
			keys[ i ] = keys[ c ]; vals[ i ] = vals[ c ];
			i = c;

		}

		keys[ i ] = k; vals[ i ] = v;
		return top;

	}

}

export function computeShoreField( terrain, { res = 512, swellDir = [ 0, - 1 ], seaLevel = 0, maxDepth = 25, minDepth = 0.25 } = {} ) {

	const size = terrain.size;
	const origin = terrain.origin;
	const h = size / res;
	const N = res * res;

	const depth = new Float32Array( N );
	const speed = new Float32Array( N );
	for ( let j = 0; j < res; j ++ ) {

		const z = origin + ( j + 0.5 ) * h;
		for ( let i = 0; i < res; i ++ ) {

			const x = origin + ( i + 0.5 ) * h;
			const d = seaLevel - terrain.heightAt( x, z );
			depth[ j * res + i ] = d;
			speed[ j * res + i ] = d > 0 ? Math.sqrt( GRAVITY * Math.min( Math.max( d, minDepth ), maxDepth ) ) : 0;

		}

	}

	const T = new Float32Array( N ).fill( Infinity );
	const state = new Uint8Array( N ); // 0 far, 1 trial, 2 known
	const heap = new MinHeap( N * 4 );
	const [ sdx, sdz ] = swellDir;
	const c0 = Math.sqrt( GRAVITY * maxDepth );

	// plane-wave initial condition on the border water cells
	for ( let j = 0; j < res; j ++ ) for ( let i = 0; i < res; i ++ ) {

		if ( i !== 0 && j !== 0 && i !== res - 1 && j !== res - 1 ) continue;
		const k = j * res + i;
		if ( speed[ k ] <= 0 ) continue;
		const x = origin + ( i + 0.5 ) * h, z = origin + ( j + 0.5 ) * h;
		T[ k ] = ( x * sdx + z * sdz ) / c0 + size; // offset keeps T positive
		state[ k ] = 1;
		heap.push( T[ k ], k );

	}

	const solve = ( i, j ) => {

		const k = j * res + i;
		const c = speed[ k ];
		if ( c <= 0 ) return Infinity;
		const f = h / c;
		const tx = Math.min(
			i > 0 && state[ k - 1 ] === 2 ? T[ k - 1 ] : Infinity,
			i < res - 1 && state[ k + 1 ] === 2 ? T[ k + 1 ] : Infinity );
		const tz = Math.min(
			j > 0 && state[ k - res ] === 2 ? T[ k - res ] : Infinity,
			j < res - 1 && state[ k + res ] === 2 ? T[ k + res ] : Infinity );
		const a = Math.min( tx, tz ), b = Math.max( tx, tz );
		if ( ! isFinite( b ) || b - a >= f ) return a + f;
		return 0.5 * ( a + b + Math.sqrt( 2 * f * f - ( a - b ) * ( a - b ) ) );

	};

	while ( heap.size > 0 ) {

		const k = heap.pop();
		if ( state[ k ] === 2 ) continue;
		state[ k ] = 2;
		const i = k % res, j = ( k / res ) | 0;
		const nb = [ [ i - 1, j ], [ i + 1, j ], [ i, j - 1 ], [ i, j + 1 ] ];
		for ( const [ ni, nj ] of nb ) {

			if ( ni < 0 || nj < 0 || ni >= res || nj >= res ) continue;
			const nk = nj * res + ni;
			if ( state[ nk ] === 2 || speed[ nk ] <= 0 ) continue;
			const t = solve( ni, nj );
			if ( t < T[ nk ] ) {

				T[ nk ] = t;
				state[ nk ] = 1;
				heap.push( t, nk );

			}

		}

	}

	// Extend a field onto land one ring of cells per pass (average of the known neighbours + inc).
	// Each pass reads the previous pass only: filling in place while scanning would let values from
	// far away (e.g. the other side of the island) sweep across the land in a single pass.
	const extend = ( F, passes, inc ) => {

		const prev = new Float32Array( N );
		for ( let pass = 0; pass < passes; pass ++ ) {

			prev.set( F );
			let changed = false;
			for ( let j = 0; j < res; j ++ ) for ( let i = 0; i < res; i ++ ) {

				const k = j * res + i;
				if ( isFinite( prev[ k ] ) ) continue;
				let s = 0, n = 0;
				if ( i > 0 && isFinite( prev[ k - 1 ] ) ) { s += prev[ k - 1 ]; n ++; }
				if ( i < res - 1 && isFinite( prev[ k + 1 ] ) ) { s += prev[ k + 1 ]; n ++; }
				if ( j > 0 && isFinite( prev[ k - res ] ) ) { s += prev[ k - res ]; n ++; }
				if ( j < res - 1 && isFinite( prev[ k + res ] ) ) { s += prev[ k + res ]; n ++; }
				if ( n > 0 ) { F[ k ] = s / n + inc; changed = true; }

			}

			if ( ! changed ) break;

		}

	};

	// arrival time at the nearest shoreline, extended unchanged onto land (swash timing)
	const Tshore = new Float32Array( T );
	extend( Tshore, 40, 0 );

	// extend T onto land (so the swash zone has a continuous phase), continuing slowly up the beach
	const Tfilled = new Float32Array( T );
	extend( Tfilled, 24, h / 1.5 );

	// smooth to remove first-order FMM kinks (keeps phase monotonic)
	let Ts = Tfilled;
	for ( let it = 0; it < 3; it ++ ) {

		const out = new Float32Array( N );
		for ( let j = 0; j < res; j ++ ) for ( let i = 0; i < res; i ++ ) {

			const k = j * res + i;
			if ( ! isFinite( Ts[ k ] ) ) { out[ k ] = Ts[ k ]; continue; }
			let s = Ts[ k ] * 4, w = 4;
			for ( const [ di, dj ] of [ [ - 1, 0 ], [ 1, 0 ], [ 0, - 1 ], [ 0, 1 ] ] ) {

				const ni = i + di, nj = j + dj;
				if ( ni < 0 || nj < 0 || ni >= res || nj >= res ) continue;
				const v = Ts[ nj * res + ni ];
				if ( isFinite( v ) ) { s += v; w ++; }

			}

			out[ k ] = s / w;

		}

		Ts = out;

	}

	// directions + exposure
	const data = new Float32Array( N * 4 );
	const sl = Math.hypot( sdx, sdz );
	for ( let j = 0; j < res; j ++ ) for ( let i = 0; i < res; i ++ ) {

		const k = j * res + i;
		const t = Ts[ k ];
		const g = ( a, b ) => ( isFinite( a ) && isFinite( b ) ) ? ( a - b ) : 0;
		const tl = i > 0 ? Ts[ k - 1 ] : t, tr = i < res - 1 ? Ts[ k + 1 ] : t;
		const td = j > 0 ? Ts[ k - res ] : t, tu = j < res - 1 ? Ts[ k + res ] : t;
		let gx = g( tr, tl ), gz = g( tu, td );
		if ( gx === 0 && isFinite( tr ) && isFinite( t ) ) gx = tr - t;
		if ( gz === 0 && isFinite( tu ) && isFinite( t ) ) gz = tu - t;
		const len = Math.hypot( gx, gz ) || 1;
		const dx = gx / len, dz = gz / len;
		// exposure: how directly the local wave direction faces the incoming swell
		const align = ( dx * sdx + dz * sdz ) / sl;
		const exposure = Math.min( 1, Math.max( 0.02, align * 1.4 + 0.1 ) );
		// direction scaled by exposure (length = exposure), alpha = shoreline arrival time
		data[ k * 4 ] = isFinite( t ) ? t : 1e5;
		data[ k * 4 + 1 ] = dx * exposure;
		data[ k * 4 + 2 ] = dz * exposure;
		data[ k * 4 + 3 ] = isFinite( Tshore[ k ] ) ? Tshore[ k ] : ( isFinite( t ) ? t : 1e5 );

	}

	// On land the direction above is the gradient of the extended T, which grows one ring of cells per
	// pass and so steps along any shoreline that does not run along the grid. The along-crest
	// coordinate and the swash built on it broke into teeth on such beaches (the round islets of the
	// outer islands). Land takes the wave direction and exposure of the nearest water instead
	// (extended ring by ring, then smoothed), and the shoreline arrival time is smoothed on land too.
	// Water cells keep their values.
	const land = new Uint8Array( N );
	for ( let k = 0; k < N; k ++ ) land[ k ] = isFinite( T[ k ] ) ? 0 : 1;
	const V = new Float32Array( N * 3 ).fill( NaN ); // ( dir.x * exposure, dir.z * exposure, Tshore )
	for ( let k = 0; k < N; k ++ ) {

		if ( ! land[ k ] ) {

			V[ k * 3 ] = data[ k * 4 + 1 ];
			V[ k * 3 + 1 ] = data[ k * 4 + 2 ];

		}

		V[ k * 3 + 2 ] = data[ k * 4 + 3 ];

	}

	const prev = new Float32Array( N * 3 );
	const nb = new Int32Array( 4 );
	// the neighbours of cell (i, j) inside the grid, as index offsets into nb; returns how many
	const nbs = ( i, j ) => {

		let n = 0;
		if ( i > 0 ) nb[ n ++ ] = - 1;
		if ( i < res - 1 ) nb[ n ++ ] = 1;
		if ( j > 0 ) nb[ n ++ ] = - res;
		if ( j < res - 1 ) nb[ n ++ ] = res;
		return n;

	};
	// the directions: rings of land cells from the shoreline inward (average of the known neighbours),
	// as far up the beach as the swash can reach (the band; further inland stays as it was)
	const BAND = 12;
	const inBand = [];
	const queued = new Uint8Array( N );
	let ring = [];
	for ( let j = 0; j < res; j ++ ) for ( let i = 0; i < res; i ++ ) {

		const k = j * res + i;
		if ( ! land[ k ] ) continue;
		for ( let q = nbs( i, j ) - 1; q >= 0; q -- ) if ( ! land[ k + nb[ q ] ] ) {

			ring.push( k );
			queued[ k ] = 1;
			break;

		}

	}

	for ( let pass = 0; pass < BAND && ring.length; pass ++ ) {

		const next = [];
		for ( const k of ring ) {

			const i = k % res, j = ( k / res ) | 0;
			let sx = 0, sz = 0, n = 0;
			for ( let q = nbs( i, j ) - 1; q >= 0; q -- ) {

				const o = k + nb[ q ];
				if ( ! Number.isNaN( V[ o * 3 ] ) && ! queued[ o ] ) {

					sx += V[ o * 3 ];
					sz += V[ o * 3 + 1 ];
					n ++;

				} else if ( land[ o ] && ! queued[ o ] ) {

					queued[ o ] = 1;
					next.push( o );

				}

			}

			if ( n ) {

				V[ k * 3 ] = sx / n;
				V[ k * 3 + 1 ] = sz / n;

			}

			inBand.push( k );

		}

		// (the cells of this ring take part in the next one's averages)
		for ( const k of ring ) queued[ k ] = 0;
		for ( const k of next ) queued[ k ] = 1;
		ring = next;

	}

	// smooth all three in the band (the water around stays as it is)
	for ( let pass = 0; pass < 8; pass ++ ) {

		prev.set( V );
		for ( const k of inBand ) {

			const i = k % res, j = ( k / res ) | 0;
			const m = nbs( i, j );
			for ( let c = 0; c < 3; c ++ ) {

				let s = prev[ k * 3 + c ] * 2, w = 2;
				for ( let q = 0; q < m; q ++ ) {

					const v = prev[ ( k + nb[ q ] ) * 3 + c ];
					if ( ! Number.isNaN( v ) && v < 1e4 ) {

						s += v;
						w ++;

					}

				}

				if ( ! Number.isNaN( s ) && prev[ k * 3 + c ] < 1e4 ) V[ k * 3 + c ] = s / w;

			}

		}

	}

	for ( const k of inBand ) {

		data[ k * 4 + 1 ] = V[ k * 3 ];
		data[ k * 4 + 2 ] = V[ k * 3 + 1 ];
		data[ k * 4 + 3 ] = V[ k * 3 + 2 ];

	}

	return { data, res, cellSize: h, origin, size, depth, swellDir: [ sdx, sdz ] };

}
