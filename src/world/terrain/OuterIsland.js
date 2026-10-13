import { Noise2D, smoothstep, clamp, lerp } from '../../util/Noise.js';

// The other islands of the archipelago: smaller heightmaps of their own, placed out in the same sea
// as the home island (TerrainData). Each is generated from its island definition (world/islands/)
// by a compact procedural recipe instead of the home island's hand-tuned one:
//
//   kind 'atoll'     a ring of reef flat with sandy motus (islets) round a shallow lagoon
//   kind 'volcanic'  a steep cone with a crater, a beach ring and a fringing reef
//
// It exposes the same fields TerrainData does (heights, rock, sand, path, gully, seagrass, rubble,
// scarp over a res x res grid) so the terrain bake, the shore field and the GPU terrain module
// treat it the same way. Grids are in island-local coordinates (origin -size / 2 .. size / 2);
// cx, cz place the island's centre in the world. heightAt / normalAt / boundsFor take world xz.
export class OuterIsland {

	// def: an island definition with { id, seed, position: { x, z }, size, res, terrain: { kind, ... } }
	constructor( def ) {

		this.def = def;
		this.id = def.id;
		this.size = def.size || 1024;
		this.res = def.res || 1024;
		this.texel = this.size / this.res;
		this.origin = - this.size / 2; // local
		this.cx = def.position.x;
		this.cz = def.position.z;
		// world-space domain
		this.x0 = this.cx + this.origin;
		this.z0 = this.cz + this.origin;
		const n = this.res * this.res;
		this.heights = new Float32Array( n );
		this.rock = new Float32Array( n );
		this.sand = new Uint8Array( n );
		this.path = new Uint8Array( n );
		this.gully = new Uint8Array( n );
		this.seagrass = new Uint8Array( n );
		this.rubble = new Uint8Array( n );
		this.scarp = new Uint8Array( n );
		this.pads = [];
		this.noise = new Noise2D( def.seed || 1 );
		this.noise2 = new Noise2D( ( def.seed || 1 ) * 31 + 5 );
		const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
		this.generate();
		this.buildMinMax();
		this.ms = ( typeof performance !== 'undefined' ? performance.now() : 0 ) - t0;

	}

	// is world (x, z) inside this island's grid?
	contains( x, z ) {

		return x >= this.x0 && z >= this.z0 && x < this.x0 + this.size && z < this.z0 + this.size;

	}

	// ------------------------------------------------------------------ generation

	// distance from the island's centre at local (x, z), warped so the coast isn't a circle
	radial( x, z, ang = Math.atan2( z, x ) ) {

		const warp = this.noise.fbm( Math.cos( ang ) * 1.6 + 7.1, Math.sin( ang ) * 1.6 - 3.3, 4 ) * ( this.def.terrain.warp ?? 0.18 );
		return Math.hypot( x, z ) / ( 1 + warp );

	}

	// height and masks at island-local (x, z): { h, rock, sand, grass, rubble }
	sample( x, z, out ) {

		const T = this.def.terrain;
		const N = this.noise, N2 = this.noise2;
		const ang = Math.atan2( z, x );
		const d = this.radial( x, z, ang );
		const fine = N2.fbm( x * 0.02, z * 0.02, 4 );
		let h, rock = 0, sand = 0, grass = 0, rubble = 0;
		const deep = - 90;

		if ( T.kind === 'atoll' ) {

			const R = T.radius, W = T.ringWidth;
			const ring = Math.abs( d - R ); // distance from the ring's crest line
			// motus: islets where a slow noise along the ring is high
			const motu = smoothstep( - 0.08, 0.22, N.fbm( Math.cos( ang ) * 2.2 + 11, Math.sin( ang ) * 2.2 + 2, 3 ) + ( T.motu ?? 0 ) );
			const flat = 1 - smoothstep( W * 0.5, W * 0.5 + 18, ring ); // the reef flat
			const islet = motu * ( 1 - smoothstep( W * 0.1, W * 0.5, ring ) );
			if ( d < R ) {

				// lagoon floor, shoaling up to the reef flat
				const lag = - ( T.lagoonDepth ?? 8 ) + fine * 1.6;
				h = lerp( lag, - 0.7, flat );
				grass = d < R - W * 0.6 && h < - 1.5 ? smoothstep( 0.0, 0.25, N2.fbm( x * 0.012 + 4, z * 0.012, 3 ) ) : 0;

			} else {

				// outer reef slope: a steep drop to the deep
				const out0 = d - R - W * 0.5;
				h = lerp( - 0.7, Math.max( deep, - 2 - Math.max( 0, out0 ) * 0.55 - Math.max( 0, out0 - 60 ) * 0.4 ), 1 - flat );

			}

			h = lerp( h, 1.2 + islet * ( 1.4 + fine * 1.2 ), islet );
			rubble = h < 0.2 && ring < W * 0.5 + 10 ? 1 - smoothstep( - 4, - 0.5, - h ) * 0.3 : 0;
			sand = h > - 0.5 || d < R ? 1 : 0.6;

		} else {

			// volcanic: a cone, a crater at the top, a beach ring and a fringing reef
			const R = T.radius, P = T.peak;
			const cone = Math.max( 0, 1 - d / R );
			const crater = T.crater ? smoothstep( T.crater * 1.15, T.crater * 0.7, d ) * P * 0.5 : 0;
			const ridges = N.ridged( x * 0.006 + 3, z * 0.006 - 8, 4 ) * 0.22;
			const land = P * Math.pow( cone, 1.6 ) * ( 0.85 + ridges ) - crater;
			// the shelf round the island and the drop beyond it
			const shelf = d - R;
			const sea = Math.max( deep, 0.6 - Math.max( 0, shelf + 5 ) * 0.09 - Math.max( 0, shelf - 100 ) * 0.7 );
			h = ( shelf < 0 ? Math.max( land + 0.6, sea ) : sea ) + fine * 0.8;
			// fringing reef a little offshore
			const reef = 1 - smoothstep( 8, 26, Math.abs( shelf - ( T.reefOffset ?? 70 ) ) );
			h = lerp( h, Math.max( h, - 1.2 + fine * 0.5 ), reef * smoothstep( 0, 20, shelf ) );
			rubble = reef * ( h < 0 ? 1 : 0 );
			sand = h < 3.5 ? 1 : 0;
			grass = shelf > 0 && h < - 2 && h > - 12 ? smoothstep( 0.05, 0.3, N2.fbm( x * 0.01 - 2, z * 0.01 + 5, 3 ) ) : 0;
			rock = smoothstep( P * 0.35, P * 0.7, land ) + crater / Math.max( P, 1 );

		}

		// whatever the recipe, the grid's rim is the open sea floor (TerrainData.outerHeightAt beyond
		// it): no wall where the grid ends
		const half = this.size / 2, rim = Math.min( half - Math.abs( x ), half - Math.abs( z ) );
		h = lerp( deep, h, smoothstep( 8, 90, rim ) );

		out.h = h;
		out.rock = clamp( rock, 0, 1 );
		out.sand = clamp( sand, 0, 1 );
		out.grass = clamp( grass, 0, 1 );
		out.rubble = clamp( rubble, 0, 1 );
		return out;

	}

	generate() {

		const { res, texel, origin } = this;
		const s = { h: 0, rock: 0, sand: 0, grass: 0, rubble: 0 };
		for ( let j = 0; j < res; j ++ ) {

			const z = origin + ( j + 0.5 ) * texel;
			for ( let i = 0; i < res; i ++ ) {

				const x = origin + ( i + 0.5 ) * texel;
				this.sample( x, z, s );
				const k = j * res + i;
				this.heights[ k ] = s.h;
				this.rock[ k ] = s.rock;
				this.sand[ k ] = Math.round( s.sand * 255 );
				this.seagrass[ k ] = Math.round( s.grass * 255 );
				this.rubble[ k ] = Math.round( s.rubble * 255 );

			}

		}

		// steep land is bare rock
		const H = this.heights;
		for ( let j = 1; j < res - 1; j ++ ) for ( let i = 1; i < res - 1; i ++ ) {

			const k = j * res + i;
			if ( H[ k ] < 1 ) continue;
			const g = Math.hypot( H[ k + 1 ] - H[ k - 1 ], H[ k + res ] - H[ k - res ] ) / ( 2 * texel );
			this.rock[ k ] = Math.max( this.rock[ k ], smoothstep( 0.6, 1.1, g ) );
			if ( g > 0.5 ) this.sand[ k ] = 0;

		}

	}

	// ------------------------------------------------------------------ queries (world xz)

	// horizontal distance to the reef edge (m, < 0 on it): the atoll's ring, the volcanic island's
	// fringing reef. Game.habitatAtPoint reads it as the home island's distance to its reef circle.
	reefDist( x, z ) {

		const T = this.def.terrain;
		const d = this.radial( x - this.cx, z - this.cz );
		if ( T.kind === 'atoll' ) return Math.abs( d - T.radius ) - T.ringWidth * 0.5;
		return Math.abs( d - T.radius - ( T.reefOffset ?? 70 ) ) - 18;

	}

	heightAt( x, z ) {

		const { res, texel, heights } = this;
		const fx = ( x - this.x0 ) / texel - 0.5, fz = ( z - this.z0 ) / texel - 0.5;
		if ( fx < 0 || fz < 0 || fx >= res - 1 || fz >= res - 1 ) return - 90;
		const i = Math.floor( fx ), j = Math.floor( fz );
		const tx = fx - i, tz = fz - j;
		const k = j * res + i;
		return ( heights[ k ] * ( 1 - tx ) + heights[ k + 1 ] * tx ) * ( 1 - tz ) + ( heights[ k + res ] * ( 1 - tx ) + heights[ k + res + 1 ] * tx ) * tz;

	}

	normalAt( x, z, out ) {

		const e = this.texel;
		const hx = this.heightAt( x + e, z ) - this.heightAt( x - e, z );
		const hz = this.heightAt( x, z + e ) - this.heightAt( x, z - e );
		out.set( - hx, 2 * e, - hz ).normalize();
		return out;

	}

	// min/max pyramid for CDLOD culling (as TerrainData)
	buildMinMax() {

		const tile = 8, res = this.res, H = this.heights;
		let n = res / tile;
		let mn = new Float32Array( n * n ), mx = new Float32Array( n * n );
		for ( let tj = 0; tj < n; tj ++ ) for ( let ti = 0; ti < n; ti ++ ) {

			let a = Infinity, b = - Infinity;
			for ( let j = tj * tile; j <= Math.min( res - 1, ( tj + 1 ) * tile ); j ++ ) for ( let i = ti * tile; i <= Math.min( res - 1, ( ti + 1 ) * tile ); i ++ ) {

				const h = H[ j * res + i ];
				if ( h < a ) a = h;
				if ( h > b ) b = h;

			}

			mn[ tj * n + ti ] = a;
			mx[ tj * n + ti ] = b;

		}

		this.mmTile = tile;
		this.mmLevels = [ { n, min: mn, max: mx } ];
		while ( n > 1 ) {

			const m = n >> 1, mn2 = new Float32Array( m * m ), mx2 = new Float32Array( m * m );
			for ( let j = 0; j < m; j ++ ) for ( let i = 0; i < m; i ++ ) {

				const a = 2 * j * n + 2 * i, b = a + n;
				mn2[ j * m + i ] = Math.min( mn[ a ], mn[ a + 1 ], mn[ b ], mn[ b + 1 ] );
				mx2[ j * m + i ] = Math.max( mx[ a ], mx[ a + 1 ], mx[ b ], mx[ b + 1 ] );

			}

			n = m;
			mn = mn2;
			mx = mx2;
			this.mmLevels.push( { n, min: mn, max: mx } );

		}

	}

	boundsFor( x0, z0, x1, z1 ) {

		const { texel, mmTile } = this;
		const span = Math.max( x1 - x0, z1 - z0 ) / ( texel * mmTile );
		const l = Math.max( 0, Math.min( this.mmLevels.length - 1, Math.ceil( Math.log2( Math.max( 1, span / 2 ) ) ) ) );
		const L = this.mmLevels[ l ];
		const ts = texel * mmTile * ( 1 << l );
		const i0 = Math.floor( ( x0 - this.x0 ) / ts ), i1 = Math.floor( ( x1 - this.x0 ) / ts );
		const j0 = Math.floor( ( z0 - this.z0 ) / ts ), j1 = Math.floor( ( z1 - this.z0 ) / ts );
		let mn = Infinity, mx = - Infinity, outside = false;
		for ( let j = j0; j <= j1; j ++ ) for ( let i = i0; i <= i1; i ++ ) {

			if ( i < 0 || j < 0 || i >= L.n || j >= L.n ) {

				outside = true;
				continue;

			}

			const k = j * L.n + i;
			if ( L.min[ k ] < mn ) mn = L.min[ k ];
			if ( L.max[ k ] > mx ) mx = L.max[ k ];

		}

		if ( outside ) {

			mn = Math.min( mn, - 90 );
			mx = Math.max( mx, - 90 );

		}

		return [ mn - 1, mx + 2 ];

	}

	// the grid as seen from island-local coordinates, for the shore field (computeShoreField samples
	// heightAt over origin .. origin + size)
	localView() {

		return { size: this.size, origin: this.origin, res: this.res, texel: this.texel, heightAt: ( x, z ) => this.heightAt( x + this.cx, z + this.cz ) };

	}

}
