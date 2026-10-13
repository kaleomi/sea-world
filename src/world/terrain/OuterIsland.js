import { Noise2D, mulberry32, smoothstep, clamp, lerp } from '../../util/Noise.js';

// The other islands of the archipelago: smaller heightmaps of their own, placed out in the same sea
// as the home island (TerrainData). Each is generated from its island definition (world/islands/)
// by a compact procedural recipe instead of the home island's hand-tuned one:
//
//   kind 'atoll'     a ring of reef flat with sandy motus (islets) round a shallow lagoon
//   kind 'volcanic'  a steep cone with a crater, a beach ring and a fringing reef
//   kind 'crescent'  a horseshoe ridge round a sheltered bay that opens toward `opening` (rad)
//   kind 'cluster'   a scatter of small hilly islets on one shallow bank, reefs round each
//   kind 'mesa'      a flat-topped plateau ringed by sea cliffs, sea stacks offshore, a beach cove
//   kind 'bar'       a long, low, curving sand cay with dunes and wide seagrass flats on its lee
//
// It exposes the same fields TerrainData does (heights, rock, sand, path, gully, seagrass, rubble,
// scarp over a res x res grid) so the terrain bake, the shore field and the GPU terrain module
// treat it the same way. Grids are in island-local coordinates (origin -size / 2 .. size / 2);
// cx, cz place the island's centre in the world. heightAt / normalAt / boundsFor take world xz.
const WARP_N = 1024; // the coast warp's table, by bearing
const REEF_HALF = 6; // reefDist on a reef patch (m below 0: like standing on the home reef's edge)

// the grids generate() fills (and the browser cache keeps); the rest is derived from them
export const OUTER_FIELDS = [
	[ 'heights', Float32Array ], [ 'rock', Float32Array ], [ 'sand', Uint8Array ], [ 'seagrass', Uint8Array ], [ 'rubble', Uint8Array ],
];

export function outerSnapshot( o ) {

	const snap = { res: o.res };
	for ( const [ name ] of OUTER_FIELDS ) snap[ name ] = o[ name ].slice();
	return snap;

}

export function validOuterSnapshot( snap, res ) {

	if ( ! snap || snap.res !== res ) return false;
	for ( const [ name, Type ] of OUTER_FIELDS ) if ( ! ( snap[ name ] instanceof Type ) || snap[ name ].length !== res * res ) return false;
	return true;

}

// the signed difference of two bearings, in -PI .. PI
function angDiff( a, b ) {

	return Math.atan2( Math.sin( a - b ), Math.cos( a - b ) );

}

// The recipes beyond the atoll and the volcano: each fills s ({ h, rock, sand, grass, rubble }) for
// island-local (x, z). d: the warped distance from the centre, ang its bearing, fine: small noise,
// deep: the open sea floor. Called with `this` the OuterIsland.
const KINDS = {

	// a horseshoe ridge round a bay: high at the back, tapering to two low horns either side of the
	// bay's mouth (toward T.opening); a fringing reef off the back, seagrass in the bay
	crescent( x, z, d, ang, fine, deep, s ) {

		const T = this.def.terrain, N = this.noise;
		const R = T.radius, P = T.peak;
		const da = Math.abs( angDiff( ang, T.opening ?? 0 ) ), gap = T.gap ?? 0.7;
		const arc = smoothstep( gap, gap + 0.9, da ); // 0 at the mouth, 1 round the back
		const amp = smoothstep( gap * 0.75, gap + 0.25, da ); // the ridge stops short of the mouth
		const w = T.width * ( 0.4 + 0.6 * arc );
		const t = ( d - R ) / w;
		const ridge = Math.max( 0, 1 - t * t ) * ( 0.88 + N.ridged( x * 0.008 + 5, z * 0.008 - 2, 4 ) * 0.22 );
		// a low coastal terrace (palms, the beach) before the ridge climbs
		const land = ridge > 0 ? ( P * Math.pow( arc, 1.2 ) * Math.pow( ridge, 2.2 ) + 3.8 * smoothstep( 0, 0.3, ridge ) - 1.5 ) * amp - ( 1 - amp ) * 6 : - 1e3;
		let sea;
		if ( d < R ) {

			// the bay: sand shoaling to the beach, deepest in the middle; the mouth stays navigable
			sea = lerp( - 1, - ( T.bayDepth ?? 7 ) + fine * 1.2, smoothstep( 0, 110, R - w * 0.9 - d ) );
			sea = Math.min( sea, lerp( - 5, sea, amp ) );

		} else {

			const o = d - R - w;
			sea = Math.max( deep, - 1 - Math.max( 0, o ) * 0.3 - Math.max( 0, o - 50 ) * 0.6 );
			sea = Math.min( sea, lerp( - 5, sea, amp ) );

		}

		let h = Math.max( sea, land ) + fine * 0.5;
		// a fringing reef off the back of the ridge
		const reef = ( 1 - smoothstep( 8, 24, Math.abs( d - R - w - 45 ) ) ) * arc;
		h = lerp( h, Math.max( h, - 1.3 + fine * 0.5 ), reef );
		s.h = h;
		s.rubble = reef > 0.3 && h < 0 ? 1 : 0;
		s.sand = h < 3.5 ? 1 : 0;
		s.grass = d < R - w * 0.6 && h < - 1.6 && h > - 8 ? smoothstep( 0, 0.3, this.noise2.fbm( x * 0.012 + 9, z * 0.012, 3 ) ) : 0;
		s.rock = smoothstep( P * 0.45, P * 0.85, land );

	},

	// small hilly islets on one shallow bank, each with its own beach and a broken reef round it
	cluster( x, z, d, ang, fine, deep, s ) {

		const T = this.def.terrain, N = this.noise;
		const bank = T.bankDepth ?? 6, spread = T.spread ?? 300;
		// the bank: shallow over the group, dropping away beyond it
		const o = d - spread - 60;
		let h = o < 0 ? - bank + fine * 1.6 : Math.max( deep, - bank - o * 0.45 - Math.max( 0, o - 40 ) * 0.4 );
		let reef = 0, top = 0;
		for ( const I of this.islets ) {

			const dx = x - I.x, dz = z - I.z, raw = Math.hypot( dx, dz ) / I.r;
			if ( raw > 2.3 ) continue; // too far to shape the bank or carry its reef
			const a = Math.atan2( dz, dx );
			const q = Math.hypot( dx, dz ) / ( I.r * ( 1 + 0.22 * N.fbm( Math.cos( a ) * 1.3 + I.seed, Math.sin( a ) * 1.3 - I.seed, 3 ) ) );
			const hill = q < 1 ? ( I.peak + 2.4 ) * Math.pow( 1 - q, 1.4 ) * ( 0.85 + N.ridged( x * 0.012 + I.seed, z * 0.012, 3 ) * 0.25 ) - 2 : - 2 - ( q - 1 ) * I.r * 0.14;
			h = Math.max( h, hill );
			if ( q < 1 ) top = Math.max( top, ( 1 - q ) * I.peak );
			reef = Math.max( reef, 1 - smoothstep( 0.12, 0.3, Math.abs( q - 1.4 ) ) );

		}

		reef *= smoothstep( - 0.15, 0.15, N.fbm( x * 0.02 + 3, z * 0.02 - 6, 3 ) ); // broken, not a ring
		h = lerp( h, Math.max( h, - 1.2 + fine * 0.4 ), reef * ( h < - 1 ? 1 : 0 ) );
		s.h = h;
		s.rubble = reef > 0.35 && h < 0 ? 1 : 0;
		s.sand = h < 3 ? 1 : 0;
		s.grass = h < - 2 && h > - 9 && reef < 0.2 ? smoothstep( 0.05, 0.3, this.noise2.fbm( x * 0.01 - 4, z * 0.01 + 1, 3 ) ) : 0;
		s.rock = smoothstep( 14, 26, top ) * 0.6;

	},

	// a plateau ringed by cliffs: a narrow beach apron under parts of them, a cove that cuts back
	// toward T.cove with a beach and a slope up to the top, sea stacks offshore, deep water close in
	mesa( x, z, d, ang, fine, deep, s ) {

		const T = this.def.terrain, N = this.noise;
		const H = T.height;
		// the plateau minus a round bite (the cove) on the side toward T.cove: signed distance, > 0 outside
		const R = T.radius, cr = T.coveRadius ?? 105;
		const c = Math.hypot( x - Math.cos( T.cove ?? 0 ) * R * 1.02, z - Math.sin( T.cove ?? 0 ) * R * 1.02 );
		const sdf = Math.max( d - R, cr - c );
		const cove = smoothstep( cr * 1.6, cr * 0.9, c );
		// the cliff: a 20 m wall, a long slope at the back of the cove
		const band = lerp( 18, 120, cove );
		const up = smoothstep( 4, - band, sdf );
		const top = up > 0 ? H + N.fbm( x * 0.01 + 2, z * 0.01, 4 ) * 6 + N.ridged( x * 0.004, z * 0.004 + 9, 3 ) * 6 : 0;
		const apron = cove > 0.5 ? 1 : smoothstep( - 0.05, 0.3, N.fbm( Math.cos( ang ) * 2.4 + 1, Math.sin( ang ) * 2.4 - 4, 3 ) );
		const beachW = lerp( 18, 40, cove );
		const o = sdf; // > 0 off the foot of the cliff
		let foot;
		if ( o < beachW * apron ) foot = lerp( - 4, 1.4 - Math.max( 0, o ) * 0.02, apron );
		else foot = - 1.5 - ( o - beachW * apron ) * lerp( 0.25, 0.1, cove ) - Math.max( 0, o - beachW * apron - 25 ) * lerp( 0.5, 0.12, cove );
		let h = Math.max( deep, lerp( foot, top, Math.pow( up, cove > 0.5 ? 1.6 : 0.6 ) ) ) + fine * 0.4;
		let stack = 0;
		for ( const S of this.stacks ) {

			const q = Math.hypot( x - S.x, z - S.z ) / S.r;
			if ( q < 1.6 ) {

				const v = S.h * smoothstep( 1.15, 0.85, q ) * ( q < 1.15 ? 0.9 + N.fbm( x * 0.1, z * 0.1, 2 ) * 0.2 : 1 );
				h = Math.max( h, v, - 3 + ( 1.6 - q ) * 2 );
				stack = Math.max( stack, smoothstep( 1.6, 1, q ) );

			}

		}

		// rubble round the cliff foot and the stacks
		const reef = Math.max( stack, ( 1 - smoothstep( 6, 18, Math.abs( o - 55 ) ) ) * ( 1 - cove ) ) * ( h < 0 ? 1 : 0 );
		s.h = h;
		s.rubble = reef > 0.4 ? 1 : 0;
		s.sand = h < 3 ? 1 : 0;
		s.grass = 0;
		s.rock = Math.max( stack, smoothstep( 0.2, 0.8, up ) * smoothstep( 0.8, 0.3, up ) * ( 1 - cove ) );

	},

	// a long low cay, curved, along T.axis: dunes down its spine, steep on the windward side, wide
	// shallow seagrass flats on the lee (T.lee: +1 or -1) and patch reefs off the windward shore
	bar( x, z, d, ang, fine, deep, s ) {

		const T = this.def.terrain, N = this.noise;
		const ca = Math.cos( T.axis ?? 0 ), sa = Math.sin( T.axis ?? 0 );
		const u = x * ca + z * sa;
		const v = - x * sa + z * ca - ( T.bend ?? 0 ) * u * u;
		const L = T.length / 2;
		const uc = Math.min( Math.abs( u ), L * 0.985 );
		const w = T.width * Math.sqrt( 1 - ( uc / L ) ** 2 ) * ( 0.75 + 0.5 * ( N.fbm( u * 0.006 + 3, 1.7, 3 ) + 0.5 ) );
		const across = Math.abs( v ) / Math.max( w, 1 );
		const out = Math.hypot( Math.max( 0, Math.abs( u ) - L ), Math.max( 0, Math.abs( v ) - w ) ); // m off the cay
		const dune = ( T.dune ?? 9 ) * ( 0.6 + 0.4 * ( N.fbm( u * 0.012, v * 0.02 + 4, 3 ) + 0.5 ) );
		const land = across < 1 ? ( dune + 1.5 ) * Math.pow( 1 - across, 1.3 ) - 1.5 : - 1e3;
		// the flats are widest off the middle of the cay and narrow toward its ends
		const lee = v * ( T.lee ?? 1 ) > 0, flats = ( T.flats ?? 220 ) * ( 0.35 + 0.65 * Math.sqrt( Math.max( 0, 1 - ( u / ( L + 60 ) ) ** 2 ) ) );
		const sea = lee
			? ( out < flats ? lerp( - 0.8, - 2.6, smoothstep( 0, flats, out ) ) + fine * 0.5 : - 2.6 - ( out - flats ) * 0.3 )
			: - 1 - out * 0.12 - Math.max( 0, out - 40 ) * 0.45;
		let h = Math.max( deep, Math.max( sea, land ) ) + fine * 0.3;
		const reef = lee ? 0 : ( 1 - smoothstep( 6, 20, Math.abs( out - 70 ) ) ) * smoothstep( - 0.1, 0.2, N.fbm( u * 0.015 + 8, 2, 3 ) );
		h = lerp( h, Math.max( h, - 1.2 + fine * 0.4 ), reef );
		s.h = h;
		s.rubble = reef > 0.3 && h < 0 ? 1 : 0;
		s.sand = 1;
		s.grass = lee && h < - 0.6 && h > - 4 ? smoothstep( - 0.2, 0.25, this.noise2.fbm( x * 0.015, z * 0.015 + 3, 3 ) ) : 0;
		s.rock = 0;

	},

};

export class OuterIsland {

	// def: an island definition with { id, seed, position: { x, z }, size, res, terrain: { kind, ... } }
	constructor( def, snapshot = null ) {

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
		this._warpTable();
		this._layout();
		const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
		// a snapshot from the browser cache (world/TerrainCache.js) skips the generation
		if ( snapshot && validOuterSnapshot( snapshot, this.res ) ) {

			for ( const [ name ] of OUTER_FIELDS ) this[ name ].set( snapshot[ name ] );
			this.fromCache = true;

		} else {

			this.generate();
			this.fromCache = false;

		}

		this._reefField();
		this.buildMinMax();
		this.ms = ( typeof performance !== 'undefined' ? performance.now() : 0 ) - t0;

	}

	// is world (x, z) inside this island's grid?
	contains( x, z ) {

		return x >= this.x0 && z >= this.z0 && x < this.x0 + this.size && z < this.z0 + this.size;

	}

	// ------------------------------------------------------------------ generation

	// the coast's warp by bearing, tabulated once (it only depends on the angle)
	_warpTable() {

		const n = WARP_N, w = this.def.terrain.warp ?? 0.18;
		this._warp = new Float32Array( n + 1 );
		for ( let i = 0; i <= n; i ++ ) {

			const ang = - Math.PI + ( i / n ) * 2 * Math.PI;
			this._warp[ i ] = this.noise.fbm( Math.cos( ang ) * 1.6 + 7.1, Math.sin( ang ) * 1.6 - 3.3, 4 ) * w;

		}

	}

	// distance from the island's centre at local (x, z), warped so the coast isn't a circle
	radial( x, z, ang = Math.atan2( z, x ) ) {

		const f = ( ang + Math.PI ) / ( 2 * Math.PI ) * WARP_N, i = Math.min( WARP_N - 1, Math.max( 0, Math.floor( f ) ) ), t = f - i;
		const warp = this._warp[ i ] * ( 1 - t ) + this._warp[ i + 1 ] * t;
		return Math.hypot( x, z ) / ( 1 + warp );

	}

	// the parts a recipe places once: the cluster's islets, the mesa's sea stacks (local metres)
	_layout() {

		const T = this.def.terrain, rand = mulberry32( ( this.def.seed || 1 ) * 7919 + 3 );
		this.islets = [];
		this.stacks = [];
		if ( T.kind === 'cluster' ) {

			// the biggest in the middle, the rest round it, kept a little apart
			const n = T.count ?? 7;
			for ( let k = 0; k < 400 && this.islets.length < n; k ++ ) {

				const first = this.islets.length === 0;
				const a = rand() * Math.PI * 2, d = first ? rand() * 40 : 110 + rand() * ( ( T.spread ?? 300 ) - 110 );
				const r = first ? 105 + rand() * 25 : 38 + rand() * 62;
				const x = Math.cos( a ) * d, z = Math.sin( a ) * d;
				if ( this.islets.some( ( o ) => Math.hypot( o.x - x, o.z - z ) < ( o.r + r ) * 0.8 ) ) continue;
				const peak = first ? T.peak ?? 30 : 5 + rand() * ( ( T.peak ?? 30 ) * 0.7 - 5 );
				this.islets.push( { x, z, r, peak, seed: rand() * 100 } );

			}

		} else if ( T.kind === 'mesa' ) {

			const n = T.stacks ?? 5;
			for ( let k = 0; k < 200 && this.stacks.length < n; k ++ ) {

				const a = rand() * Math.PI * 2;
				if ( Math.abs( angDiff( a, T.cove ?? 0 ) ) < ( T.coveWidth ?? 0.5 ) + 0.4 ) continue; // the cove stays open
				const d = T.radius + 45 + rand() * 75, r = 7 + rand() * 8;
				const x = Math.cos( a ) * d, z = Math.sin( a ) * d;
				if ( this.stacks.some( ( o ) => Math.hypot( o.x - x, o.z - z ) < o.r + r + 25 ) ) continue;
				this.stacks.push( { x, z, r, h: 16 + rand() * 26 } );

			}

		}

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

		} else if ( T.kind === 'volcanic' ) {

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

		} else {

			// the other recipes (below): one method each, filling _s
			const s = this._s;
			s.rock = s.sand = s.grass = s.rubble = 0;
			KINDS[ T.kind ].call( this, x, z, d, ang, fine, deep, s );
			h = s.h; rock = s.rock; sand = s.sand; grass = s.grass; rubble = s.rubble;

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

		this._s = { h: 0, rock: 0, sand: 0, grass: 0, rubble: 0 };
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
	// fringing reef, and for the other recipes the distance to their reef patches (the rubble mask,
	// _reefField). Game.habitatAtPoint reads it as the home island's distance to its reef circle.
	reefDist( x, z ) {

		const T = this.def.terrain;
		if ( T.kind === 'atoll' || T.kind === 'volcanic' ) {

			const d = this.radial( x - this.cx, z - this.cz );
			if ( T.kind === 'atoll' ) return Math.abs( d - T.radius ) - T.ringWidth * 0.5;
			return Math.abs( d - T.radius - ( T.reefOffset ?? 70 ) ) - 18;

		}

		const F = this.reefField, n = this.reefRes, c = this.size / n;
		const i = Math.floor( ( x - this.x0 ) / c ), j = Math.floor( ( z - this.z0 ) / c );
		if ( ! F || i < 0 || j < 0 || i >= n || j >= n ) return 999;
		return F[ j * n + i ] - REEF_HALF;

	}

	// distance (m) from every 4 m cell to the nearest reef cell (rubble), by a two-pass chamfer
	// transform: the recipes without a closed-form reef line use it for reefDist
	_reefField() {

		const T = this.def.terrain;
		if ( T.kind === 'atoll' || T.kind === 'volcanic' ) return;
		const n = this.reefRes = Math.max( 1, Math.round( this.size / 4 ) ), c = this.size / n, step = this.res / n;
		const F = this.reefField = new Float32Array( n * n );
		for ( let j = 0; j < n; j ++ ) for ( let i = 0; i < n; i ++ ) {

			const k = Math.floor( ( j + 0.5 ) * step ) * this.res + Math.floor( ( i + 0.5 ) * step );
			F[ j * n + i ] = this.rubble[ k ] > 128 && this.heights[ k ] < 0 ? 0 : 1e9;

		}

		const D = c * Math.SQRT2;
		for ( let j = 0; j < n; j ++ ) for ( let i = 0; i < n; i ++ ) {

			const k = j * n + i;
			let v = F[ k ];
			if ( i > 0 ) v = Math.min( v, F[ k - 1 ] + c );
			if ( j > 0 ) v = Math.min( v, F[ k - n ] + c );
			if ( i > 0 && j > 0 ) v = Math.min( v, F[ k - n - 1 ] + D );
			if ( i < n - 1 && j > 0 ) v = Math.min( v, F[ k - n + 1 ] + D );
			F[ k ] = v;

		}

		for ( let j = n - 1; j >= 0; j -- ) for ( let i = n - 1; i >= 0; i -- ) {

			const k = j * n + i;
			let v = F[ k ];
			if ( i < n - 1 ) v = Math.min( v, F[ k + 1 ] + c );
			if ( j < n - 1 ) v = Math.min( v, F[ k + n ] + c );
			if ( i < n - 1 && j < n - 1 ) v = Math.min( v, F[ k + n + 1 ] + D );
			if ( i > 0 && j < n - 1 ) v = Math.min( v, F[ k + n - 1 ] + D );
			F[ k ] = v;

		}

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
