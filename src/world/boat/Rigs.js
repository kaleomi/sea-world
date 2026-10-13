import { Vector3 } from '../../engine/index.js';
import { slab, box, roundedBox, cylinder, rod, sphere, gridSurface, prepare, mat4, mergePrepared } from './GeoKit.js';
import { foredeckY, PALETTE } from './HullBuilder.js';
import { HOUSE } from './Wheelhouse.js';
import { lerp } from './HullLines.js';

// What makes each boat type its own on the shared hull (game/Boats.js): the sailboat's mast, rigging,
// tiller and sails, the speedboat's open console, windscreen, arch and twin outboards, the trawler's
// gantry, net drum and outriggers. Boat frame as in BoatModel: +Z forward, +Y up, +X port, y = 0 the
// design waterline.

const V = ( x, y, z ) => new Vector3( x, y, z );
const STAINLESS = { color: PALETTE.stainless, rough: 0.22, metal: 1 };
const SPAR = { color: 0xc4c8cc, rough: 0.35, metal: 1 }; // anodised aluminium
const WIRE = { color: 0x9da2a6, rough: 0.3, metal: 1 };
const TEAK = { color: 0x8a5a33, rough: 0.55, metal: 0, pattern: 0 };
const CUSHION = { color: 0x1f3b5a, rough: 0.7, metal: 0 };
const BLACK = { color: 0x16171a, rough: 0.45, metal: 0 };
const ORANGE = { color: 0xd8641e, rough: 0.5, metal: 0.25 };
const NET = { color: 0x2f5a3e, rough: 0.9, metal: 0 };

// ------------------------------------------------------------------ the open boats' forward bulkhead

// Without a wheelhouse the foredeck needs a face down to the cockpit sole.
export function buildBulkhead( kit, L ) {

	const z = L.houseFront, tF = L.tAtSheerZ( z ), yS = L.sheerY( tF );
	const inner = ( y ) => L.halfBreadth( tF, Math.min( y, yS ) ) - L.shell;
	const out = [];
	const N = 8, M = 14;
	for ( let k = 0; k <= N; k ++ ) {

		const y = lerp( L.deckY, yS - 0.012, k / N );
		out.push( [ inner( y ), y ] );

	}

	const xe = inner( yS - 0.012 );
	for ( let i = 1; i < M; i ++ ) {

		const x = lerp( xe, - xe, i / M );
		out.push( [ x, foredeckY( L, tF, x ) - 0.012 ] );

	}

	for ( let k = N; k >= 0; k -- ) {

		const y = lerp( L.deckY, yS - 0.012, k / N );
		out.push( [ - inner( y ), y ] );

	}

	const g = slab( out, [], ( u, v, side ) => V( u, v, z - side * 0.04 ) );
	kit.add( 'gelcoat', g, { color: PALETTE.gelcoat, rough: 0.35 } );

}

// ------------------------------------------------------------------ sailboat

// Sloop rig: mast stepped on the foredeck, boom over the cockpit (the helmsman sits aft at the tiller)
export const SLOOP = {
	mastZ: 2.0, mastTop: 9.4,
	gooseneckY: 2.35, // boom height (boat frame)
	boomLength: 4.9,
	stemHead: V( 0, 1.67, 4.2 ), stayTop: V( 0, 8.95, 2.04 ),
	spreaderY: 5.6, spreader: 0.62,
	helm: { x: - 1.02, z: - 2.75 }, // seat on the starboard cockpit bench
	benchY: 0.82, benchZ: [ - 3.55, - 0.55 ],
};

export function buildSloop( kit, L ) {

	const R = SLOOP;
	const deckAt = ( z ) => foredeckY( L, L.tAtSheerZ( z ), 0 );
	const yBase = deckAt( R.mastZ );

	// mast (tapered), step, spreaders
	kit.add( 'fittings', rod( V( 0, yBase - 0.02, R.mastZ ), V( 0, R.mastTop, R.mastZ ), 0.075, 14, 0.05 ), SPAR );
	const step = cylinder( 0.13, 0.15, 0.06, 16 );
	step.translate( 0, yBase + 0.02, R.mastZ );
	kit.add( 'fittings', step, STAINLESS );
	kit.add( 'fittings', rod( V( - R.spreader, R.spreaderY, R.mastZ - 0.05 ), V( R.spreader, R.spreaderY, R.mastZ - 0.05 ), 0.022, 8 ), SPAR );
	const cap = cylinder( 0.06, 0.06, 0.08, 12 );
	cap.translate( 0, R.mastTop + 0.02, R.mastZ );
	kit.add( 'fittings', cap, STAINLESS );
	// masthead light and windex
	const mh = cylinder( 0.028, 0.028, 0.06, 10 );
	mh.translate( 0, R.mastTop + 0.1, R.mastZ );
	kit.add( 'glow', mh, { color: 0xfff3dc, rough: 0.2, pattern: 0 } );
	kit.add( 'fittings', rod( V( 0, R.mastTop + 0.06, R.mastZ ), V( 0, R.mastTop + 0.45, R.mastZ - 0.1 ), 0.006, 5 ), BLACK );

	// standing rigging: shrouds over the spreaders to the chainplates, forestay, backstay
	const top = V( 0, R.mastTop - 0.15, R.mastZ );
	const zc = R.mastZ - 0.25, tc = L.tAtSheerZ( zc );
	for ( const s of [ 1, - 1 ] ) {

		const tip = V( s * R.spreader, R.spreaderY, R.mastZ - 0.05 );
		const chain = V( s * ( L.sheerX( tc ) - 0.03 ), L.sheerY( tc ) + 0.03, zc );
		kit.add( 'fittings', rod( top, tip, 0.006, 5 ), WIRE );
		kit.add( 'fittings', rod( tip, chain, 0.006, 5 ), WIRE );
		// lower shroud, straight from below the spreaders
		kit.add( 'fittings', rod( V( 0, R.spreaderY - 0.25, R.mastZ ), V( s * ( L.sheerX( tc ) - 0.03 ), L.sheerY( tc ) + 0.03, zc - 0.3 ), 0.006, 5 ), WIRE );

	}

	kit.add( 'fittings', rod( R.stemHead, R.stayTop, 0.007, 5 ), WIRE );
	const transomTop = V( 0, L.sheerY( 0 ) + 0.08, L.zAft + 0.08 );
	kit.add( 'fittings', rod( transomTop, V( 0, R.mastTop - 0.05, R.mastZ - 0.06 ), 0.006, 5 ), WIRE );

	// bow pulpit with the side lights
	const tp = L.tAtSheerZ( 3.4 );
	const pY = L.sheerY( tp ) + 0.55;
	const rail = [];
	for ( let i = 0; i <= 8; i ++ ) {

		const a = - Math.PI / 2 + Math.PI * i / 8;
		rail.push( V( Math.sin( a ) * ( L.sheerX( tp ) - 0.06 ), pY, 3.4 + Math.cos( a ) * 0.75 ) );

	}

	for ( let i = 0; i < rail.length - 1; i ++ ) kit.add( 'fittings', rod( rail[ i ], rail[ i + 1 ], 0.014, 6 ), STAINLESS );
	for ( const i of [ 0, 4, 8 ] ) {

		const p = rail[ i ], t = L.tAtSheerZ( p.z );
		kit.add( 'fittings', rod( V( p.x, foredeckY( L, t, p.x * 0.98 ), p.z ), p, 0.014, 6 ), STAINLESS );

	}

	for ( const s of [ 1, - 1 ] ) {

		const p = rail[ s > 0 ? 2 : 6 ];
		const lens = box( 0.05, 0.05, 0.09 );
		lens.translate( p.x + s * 0.02, p.y + 0.02, p.z );
		kit.add( 'glow', lens, { color: s > 0 ? 0xff1a0e : 0x14ff5a, rough: 0.2, pattern: 0 } );

	}

	// cockpit benches along both sides (teak tops), cushion at the helm
	const [ z0, z1 ] = R.benchZ;
	for ( const s of [ 1, - 1 ] ) {

		const zm = ( z0 + z1 ) / 2;
		const xo = L.halfBreadth( L.tAtSheerZ( zm ), R.benchY ) - L.shell - 0.01;
		const w = 0.42;
		const body = box( w, R.benchY - L.deckY, z1 - z0 );
		body.translate( s * ( xo - w / 2 ), ( R.benchY + L.deckY ) / 2, zm );
		kit.add( 'gelcoat', body, { color: PALETTE.lining, rough: 0.4 } );
		for ( let k = 0; k < 6; k ++ ) {

			const slat = box( 0.06, 0.025, z1 - z0 - 0.04 );
			slat.translate( s * ( xo - 0.04 - k * 0.07 ), R.benchY + 0.012, zm );
			kit.add( 'wood', slat, TEAK );

		}

	}

	const cushion = roundedBox( 0.4, 0.07, 0.62, 0.03, 1 );
	cushion.translate( R.helm.x, R.benchY + 0.06, R.helm.z );
	kit.add( 'fittings', cushion, CUSHION );

	// mainsheet traveller across the cockpit and the block on it
	const zt = - 3.3;
	kit.add( 'fittings', rod( V( - 0.9, R.benchY + 0.03, zt ), V( 0.9, R.benchY + 0.03, zt ), 0.018, 8 ), STAINLESS );
	const blk = sphere( 0.045, 10, 8 );
	blk.translate( 0, R.benchY + 0.08, zt );
	kit.add( 'fittings', blk, BLACK );

}

// the tiller: a rudder stock up through the sole and a varnished bar forward (child of the rudder,
// so it swings with it; local frame = the rudder pivot)
export function tillerGeometry( L, pivot ) {

	const yDeck = L.deckY - pivot.y;
	const top = 0.98 - pivot.y;
	const parts = [
		prepare( rod( V( 0, yDeck - 0.1, 0 ), V( 0, top, 0 ), 0.04, 10 ), STAINLESS ),
		prepare( cylinder( 0.07, 0.07, 0.05, 12 ).translate( 0, yDeck + 0.025, 0 ), BLACK ),
		prepare( rod( V( 0, top - 0.04, - 0.05 ), V( 0, top + 0.1, 1.35 ), 0.032, 10, 0.024 ), TEAK ),
		prepare( sphere( 0.032, 10, 8 ).translate( 0, top + 0.1, 1.35 ), BLACK ),
	];
	return mergePrepared( parts );

}

// the boom (in its own frame: pivot at the gooseneck, boom aft along -Z)
export function boomGeometry() {

	const R = SLOOP;
	return mergePrepared( [
		prepare( rod( V( 0, 0, - 0.05 ), V( 0, 0, - R.boomLength ), 0.055, 12, 0.045 ), SPAR ),
		prepare( cylinder( 0.06, 0.06, 0.12, 10 ).rotateX( Math.PI / 2 ).translate( 0, 0, - 0.02 ), STAINLESS ),
		prepare( cylinder( 0.05, 0.05, 0.05, 10 ).translate( 0, - 0.06, - R.boomLength + 0.6 ), BLACK ),
	] );

}

// Sail cloth as a cambered grid: rows from the foot (v = 0) to the head, each from the luff (u = 0)
// to the leech; `side` puts the belly to port (+1) or starboard (-1).
function sailGrid( rowAt, side, depth, NI = 14, NJ = 10 ) {

	const rows = [];
	for ( let i = 0; i <= NI; i ++ ) {

		const v = i / NI;
		const [ a, b ] = rowAt( v );
		const chord = a.distanceTo( b );
		const row = [];
		for ( let j = 0; j <= NJ; j ++ ) {

			const u = j / NJ;
			const p = a.clone().lerp( b, u );
			p.x += side * depth * chord * 4 * u * ( 1 - u ) * ( 1 - 0.35 * u );
			row.push( p );

		}

		rows.push( row );

	}

	const g = gridSurface( rows, { flip: side < 0, uvFn: ( p, i, j ) => [ j / NJ, i / NI ] } );
	g.computeVertexNormals();
	return g;

}

// mainsail in the boom frame
export function mainsailGeometry( side ) {

	const R = SLOOP, luff = R.mastTop - 0.35 - ( R.gooseneckY + 0.1 ), foot = R.boomLength - 0.25;
	return sailGrid( ( v ) => {

		const y = 0.08 + luff * v;
		const roach = 0.3 * Math.sin( Math.PI * v ) * ( 1 - v * 0.5 );
		const c = Math.max( 0.14, foot * ( 1 - v ) + roach );
		return [ V( 0, y, - 0.06 ), V( 0, y + 0.06 * ( 1 - v ), - 0.06 - c ) ];

	}, side, 0.09 );

}

// the jib in its own frame: the tack at the origin, the luff up the forestay, the clew aft
export const JIB = ( () => {

	const R = SLOOP;
	const tack = R.stemHead.clone().add( V( 0, 0.06, - 0.1 ) );
	const head = tack.clone().lerp( R.stayTop, 0.78 );
	const clew = V( 0, 1.85, 1.35 );
	return { tack, head: head.sub( tack ), clew: clew.sub( tack ), axis: R.stayTop.clone().sub( R.stemHead ).normalize() };

} )();

export function jibGeometry( side ) {

	const { head, clew } = JIB;
	return sailGrid( ( v ) => [ head.clone().multiplyScalar( v ), clew.clone().lerp( head, v ) ], side, 0.1, 12, 8 );

}

// ------------------------------------------------------------------ speedboat

// open console: low wrap-around windscreen over the dash, a stainless arch aft
export function buildRunabout( kit, L ) {

	const d = HOUSE.dash;
	const y0 = d.yTop + 0.01, y1 = d.yTop + 0.46;
	const zb = d.zBack - 0.02, rake = 0.3;
	// three panels: centre, and two swept back at the sides
	const xs = [ - d.halfW + 0.05, - 0.42, 0.42, d.halfW - 0.05 ];
	const zs = [ zb - 0.42, zb, zb, zb - 0.42 ];
	for ( let i = 0; i < 3; i ++ ) {

		const a = V( xs[ i ], y0, zs[ i ] ), b = V( xs[ i + 1 ], y0, zs[ i + 1 ] );
		const c = V( b.x * 0.97, y1, b.z - rake ), e = V( a.x * 0.97, y1, a.z - rake );
		const g = gridSurface( [ [ a, e ], [ b, c ] ], { flip: true } );
		g.computeVertexNormals();
		kit.add( 'glass', g, {} );
		kit.add( 'fittings', rod( e, c, 0.014, 6 ), STAINLESS );
		kit.add( 'fittings', rod( a, e, 0.012, 6 ), STAINLESS );
		if ( i === 2 ) kit.add( 'fittings', rod( b, c, 0.012, 6 ), STAINLESS );

	}

	// ski arch over the stern
	const za = - 2.85, ta = L.tAtSheerZ( za ), ys = L.sheerY( ta ) + 0.02, xa = L.sheerX( ta ) - 0.08;
	const pts = [];
	for ( let i = 0; i <= 10; i ++ ) {

		const a = Math.PI * i / 10;
		pts.push( V( Math.cos( a ) * xa, ys + Math.sin( a ) * 1.35 * Math.min( 1, Math.sin( a ) * 1.6 ), za - Math.sin( a ) * 0.2 ) );

	}

	for ( let i = 0; i < pts.length - 1; i ++ ) kit.add( 'fittings', rod( pts[ i ], pts[ i + 1 ], 0.035, 10 ), STAINLESS );
	const lamp = cylinder( 0.03, 0.03, 0.05, 10 );
	lamp.translate( 0, ys + 1.38, za - 0.2 );
	kit.add( 'glow', lamp, { color: 0xfff3dc, rough: 0.2, pattern: 0 } );

	// stern bench across the cockpit
	const zs0 = L.zAft + L.shell + 0.25;
	const xb = L.halfBreadth( L.tAtSheerZ( zs0 + 0.25 ), 0.8 ) - L.shell - 0.02;
	const bench = box( xb * 2, 0.42, 0.5 );
	bench.translate( 0, L.deckY + 0.21, zs0 + 0.25 );
	kit.add( 'gelcoat', bench, { color: PALETTE.lining, rough: 0.4 } );
	const cush = roundedBox( xb * 2 - 0.08, 0.09, 0.48, 0.035, 1 );
	cush.translate( 0, L.deckY + 0.47, zs0 + 0.25 );
	kit.add( 'fittings', cush, { color: 0xe9e4d8, rough: 0.6 } );

}

export const OUTBOARDS = { x: 0.48, z: - 4.22, y: 0.0 };

// one outboard engine; local origin on its steering axis at the waterline
export function outboardGeometry() {

	const COWL = { color: 0x1b1d20, rough: 0.35, metal: 0 };
	const LOWER = { color: 0x2a2d31, rough: 0.45, metal: 0.2 };
	return mergePrepared( [
		prepare( roundedBox( 0.5, 0.6, 0.78, 0.12, 3 ).translate( 0, 1.3, - 0.12 ), COWL ),
		prepare( box( 0.51, 0.03, 0.79 ).translate( 0, 1.12, - 0.12 ), { color: 0xd9d9d6, rough: 0.4 } ),
		prepare( roundedBox( 0.42, 0.28, 0.6, 0.06, 2 ).translate( 0, 0.88, - 0.08 ), LOWER ),
		prepare( roundedBox( 0.17, 1.0, 0.34, 0.05, 2 ).translate( 0, 0.25, - 0.05 ), LOWER ),
		prepare( box( 0.44, 0.022, 0.48 ).translate( 0, - 0.22, - 0.08 ), LOWER ),
		prepare( rod( V( 0, - 0.42, 0.18 ), V( 0, - 0.42, - 0.32 ), 0.075, 12, 0.06 ), LOWER ),
		prepare( box( 0.03, 0.24, 0.2 ).translate( 0, - 0.58, - 0.05 ), LOWER ),
		prepare( cylinder( 0.16, 0.16, 0.03, 16 ).rotateX( Math.PI / 2 ).translate( 0, - 0.42, - 0.36 ), { color: 0x8c9096, rough: 0.3, metal: 1 } ),
		// transom bracket
		prepare( box( 0.3, 0.42, 0.12 ).translate( 0, 0.95, 0.22 ), STAINLESS ),
	] );

}

// ------------------------------------------------------------------ trawler

export function buildTrawl( kit, L ) {

	// stern gantry (A-frame), with a block hanging from it
	const zg = - 3.62, tg = L.tAtSheerZ( zg ), yg = L.sheerY( tg ) + 0.04, xg = L.sheerX( tg ) - 0.1;
	const top = 4.3;
	for ( const s of [ 1, - 1 ] ) {

		kit.add( 'fittings', rod( V( s * xg, yg, zg ), V( s * 0.95, top, zg - 0.25 ), 0.075, 10 ), ORANGE );
		kit.add( 'fittings', rod( V( s * xg, yg, zg + 0.9 ), V( s * 0.95, top - 0.1, zg - 0.2 ), 0.045, 8 ), ORANGE );
		const foot = box( 0.22, 0.05, 0.3 );
		foot.translate( s * xg, yg, zg );
		kit.add( 'fittings', foot, ORANGE );

	}

	kit.add( 'fittings', rod( V( - 1.05, top, zg - 0.25 ), V( 1.05, top, zg - 0.25 ), 0.085, 10 ), ORANGE );
	kit.add( 'fittings', rod( V( 0, top - 0.05, zg - 0.25 ), V( 0, top - 0.75, zg - 0.3 ), 0.012, 5 ), WIRE );
	const block = roundedBox( 0.16, 0.3, 0.12, 0.04, 2 );
	block.translate( 0, top - 0.88, zg - 0.3 );
	kit.add( 'fittings', block, ORANGE );

	// net drum across the after deck
	const zd = - 2.3, yd = L.deckY + 0.56;
	const drum = cylinder( 0.42, 0.42, 1.4, 24, 1 );
	drum.rotateZ( Math.PI / 2 );
	drum.translate( 0, yd, zd );
	kit.add( 'fittings', drum, NET );
	for ( const s of [ 1, - 1 ] ) {

		const flange = cylinder( 0.52, 0.52, 0.04, 28 );
		flange.rotateZ( Math.PI / 2 );
		flange.translate( s * 0.72, yd, zd );
		kit.add( 'fittings', flange, ORANGE );
		const leg = box( 0.08, yd - L.deckY + 0.1, 0.5 );
		leg.translate( s * 0.79, ( yd + L.deckY ) / 2, zd );
		kit.add( 'fittings', leg, ORANGE );

	}

	// a few floats on the net
	for ( let i = 0; i < 5; i ++ ) {

		const a = i * 1.3 + 0.4;
		const f = sphere( 0.07, 10, 8 );
		f.translate( - 0.56 + i * 0.28, yd + Math.cos( a ) * 0.42, zd + Math.sin( a ) * 0.42 );
		kit.add( 'fittings', f, { color: 0xf2b21d, rough: 0.5 } );

	}

	// outriggers raised against the wheelhouse, with their stays
	for ( const s of [ 1, - 1 ] ) {

		const foot = V( s * 1.15, 1.28, - 0.45 );
		const tip = V( s * 2.5, 7.0, - 0.75 );
		kit.add( 'fittings', rod( foot, tip, 0.06, 10, 0.035 ), ORANGE );
		kit.add( 'fittings', rod( tip, V( s * 0.4, 3.0, - 0.3 ), 0.007, 5 ), WIRE );
		kit.add( 'fittings', rod( tip, V( s * ( xg - 0.1 ), yg, - 1.6 ), 0.007, 5 ), WIRE );
		const hinge = cylinder( 0.08, 0.08, 0.16, 12 );
		hinge.rotateZ( Math.PI / 2 );
		hinge.translate( foot.x, foot.y, foot.z );
		kit.add( 'fittings', hinge, ORANGE );
		const bird = box( 0.05, 0.3, 0.45 );
		bird.translate( tip.x + s * 0.05, tip.y - 0.4, tip.z );
		kit.add( 'fittings', bird, { color: 0xe8e3d4, rough: 0.5 } );

	}

}
