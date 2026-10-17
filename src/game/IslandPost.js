import { Mesh, Vector3 } from '../engine/index.js';
import { loadStallAssets, KitBuilder, LAYER, place, Shapes } from './StallKit.js';

// The trading posts on the outer islands: a lean-to stall with a tin roof on the beach where the
// island's quest giver stands (Quests.beachSpot), so they work behind its counter. They buy fish and
// sell diesel at the outpost prices (Gear.OUTPOST); boats, upgrades and gear stay at Marta's. Built
// from the same scanned kit as Joe's and Marta's stalls (StallKit), one merged mesh per post, the
// counter painted in the keeper's colour.
//   const post = buildIslandPost( { scene, terrain, colliders, spot, giver } )   // spot: { x, z, yaw }
// The giver stands at the spot facing out to sea; the counter is in front of them (TABLE_AHEAD).

export const TABLE_AHEAD = 0.75;

// the keeper's colour on the counter front and the eave board
const PAINT = {
	nalu: [ 0.2, 0.52, 0.62 ],
	tama: [ 0.62, 0.22, 0.17 ],
	mira: [ 0.85, 0.5, 0.45 ],
	oskar: [ 0.2, 0.32, 0.5 ],
	hilde: [ 0.66, 0.24, 0.18 ],
	bram: [ 0.3, 0.58, 0.48 ],
};

export function buildIslandPost( { scene, terrain, colliders, spot, giver } ) {

	const out = new Vector3( Math.sin( spot.yaw ), 0, Math.cos( spot.yaw ) );
	const x = spot.x + out.x * TABLE_AHEAD, z = spot.z + out.z * TABLE_AHEAD;
	const y = terrain.heightAt( x, z );
	const post = { x, y, z, yaw: spot.yaw, mesh: null };
	post.ready = loadStallAssets().then( ( a ) => {

		const mesh = new Mesh( buildPostKit( a, PAINT[ giver ] || [ 0.5, 0.5, 0.5 ], giver ), a.material );
		mesh.name = 'IslandPost_' + giver;
		mesh.castShadow = true;
		mesh.position.set( x, y, z );
		mesh.rotation.y = spot.yaw;
		post.mesh = mesh;
		if ( scene ) scene.add( mesh );
		return mesh;

	} ).catch( ( e ) => console.error( 'IslandPost: stall assets failed', e ) );

	if ( colliders ) {

		const at = ( lx, lz ) => new Vector3( x + lx * Math.cos( spot.yaw ) + lz * out.x, 0, z - lx * Math.sin( spot.yaw ) + lz * out.z );
		const box = ( lx, lz, hx, hy, hz, tag ) => {

			const c = at( lx, lz );
			c.y = y + hy;
			colliders.addBox( c, new Vector3( hx, hy, hz ), spot.yaw, { tag } );

		};
		box( 0, 0, 1.0, 0.45, 0.4, 'post-counter' );
		for ( const [ lx, lz ] of POSTS ) box( lx, lz, 0.07, 1.2, 0.07, 'post' );
		box( 1.85, - 0.15, 0.45, 0.45, 0.6, 'post-drums' );
		box( - 1.85, - 0.3, 0.35, 0.35, 0.3, 'post-crates' );

	}

	return post;

}

// the four roof posts (local x, z): the front pair at the counter, the back pair behind the keeper
const POSTS = [ [ - 1.3, 0.5 ], [ 1.3, 0.5 ], [ - 1.3, - 1.65 ], [ 1.3, - 1.65 ] ];

function buildPostKit( assets, paint, giver ) {

	let seed = 3;
	for ( const c of giver || '' ) seed = ( seed * 31 + c.charCodeAt( 0 ) ) % 2147483647;
	const K = new KitBuilder( assets, seed || 3 );
	const { DECK, PAINTED, PLAIN, ROPE, FLOAT } = LAYER;
	const V = ( a, b, c ) => new Vector3( a, b, c );
	const J = ( a ) => K.jit( a );
	const tone = () => { const t = 0.84 + K.rnd() * 0.22; return [ t, t * ( 0.97 + K.rnd() * 0.05 ), t * ( 0.93 + K.rnd() * 0.06 ) ]; };
	const top = 0.83; // the table's top

	// the counter, its front boarded and painted
	K.prop( 'WoodenTable_03', place( 0, 0, 0, J( 0.04 ) ) );
	K.box( 1.9, 0.62, 0.03, place( 0, 0.43, 0.43, 0, 0, J( 0.01 ) ), { layer: PAINTED, along: 'x', color: paint } );

	// posts (the front ones taller), eave beams, rafters and two corrugated sheets falling to the back
	const hf = 2.42, hb = 2.08;
	for ( const [ lx, lz ] of POSTS ) {

		const h = lz > 0 ? hf : hb;
		K.box( 0.1, h, 0.1, place( lx, h / 2, lz, J( 0.2 ), J( 0.03 ), J( 0.03 ) ), { layer: DECK, along: 'y', color: tone() } );

	}

	K.box( 2.8, 0.12, 0.07, place( 0, hf - 0.06, 0.53 ), { layer: DECK, along: 'x', color: tone() } );
	K.box( 2.8, 0.1, 0.07, place( 0, hb - 0.05, - 1.68 ), { layer: DECK, along: 'x', color: tone() } );
	const slope = Math.atan2( hf - hb, 2.2 );
	for ( const lx of [ - 1.3, 0, 1.3 ] ) K.box( 0.07, 0.09, 2.6, place( lx, ( hf + hb ) / 2 - 0.02, - 0.57, 0, - slope ), { layer: DECK, along: 'z', color: tone() } );
	for ( let i = 0; i < 2; i ++ ) {

		K.corrugated( 1.5, 2.72, place( - 0.7 + i * 1.4, ( hf + hb ) / 2 + 0.05 + i * 0.006, - 0.55, J( 0.02 ), - slope + J( 0.02 ), J( 0.02 ) ), K.rnd(), [ 1, 1, 1 ] );

	}

	// the painted eave board, and a strip of bunting under it
	K.box( 2.5, 0.26, 0.035, place( 0, hf - 0.24, 0.57, 0, 0, J( 0.01 ) ), { layer: PAINTED, along: 'x', color: paint } );
	const flags = [ [ 0.85, 0.25, 0.18 ], [ 0.95, 0.82, 0.3 ], [ 0.22, 0.5, 0.75 ], [ 0.95, 0.95, 0.9 ] ];
	for ( let i = 0; i < 9; i ++ ) {

		const lx = - 1.2 + i * 0.3;
		K.geometry( Shapes.cylinder( 0.0, 0.07, 0.14, 3 ), place( lx, hf - 0.46 - 0.03 * Math.sin( i / 8 * Math.PI ), 0.6, 0, 0, Math.PI ), { layer: PLAIN, color: flags[ i % 4 ], params: [ 0.8, 0 ] } );

	}

	// on the counter: a fish box of crushed ice, a cutting board and knife, a coil of line
	const bx = - 0.45, bz = 0.02, b0 = top, bw = 0.72, bd = 0.46, bh = 0.2, t = 0.025;
	K.box( bw, 0.025, bd, place( bx, b0 + 0.0125, bz ), { layer: DECK, along: 'x', color: tone() } );
	for ( const s of [ - 1, 1 ] ) {

		K.box( bw, bh, t, place( bx, b0 + bh / 2, bz + s * ( bd / 2 - t / 2 ) ), { layer: DECK, along: 'x', color: tone() } );
		K.box( t, bh, bd - 2 * t, place( bx + s * ( bw / 2 - t / 2 ), b0 + bh / 2, bz ), { layer: DECK, along: 'z', color: tone() } );

	}

	K.ice( bw - 2 * t - 0.01, bd - 2 * t - 0.01, place( bx, b0 + bh - 0.01, bz ), 0.02 );
	K.prop( 'wooden_cutting_board', place( 0.3, top, 0.04, 0.1 ) );
	K.prop( 'fish_knife', place( 0.28, top + 0.049, 0.0, 1.2, - Math.PI / 2 ) );
	K.coil( 0.62, top, - 0.12, 0.09, 4, 0.006, [ 0.7, 0.62, 0.45 ] );

	// behind the keeper: a shelf of floats and rope on the back posts, a lantern from the rafter
	K.box( 2.5, 0.035, 0.28, place( 0, 1.05, - 1.6 ), { layer: DECK, along: 'x', color: tone() } );
	for ( let i = 0; i < 5; i ++ ) {

		const lx = - 1.0 + i * 0.5;
		if ( i % 2 ) K.coil( lx, 1.07, - 1.6, 0.11, 4, 0.01, [ 0.72, 0.64, 0.46 ] );
		else K.geometry( floatGeo(), place( lx, 1.15, - 1.6, J( 1 ), Math.PI / 2, 0 ), { layer: FLOAT, color: [ [ 0.75, 0.22, 0.08 ], [ 0.82, 0.8, 0.74 ], [ 0.78, 0.6, 0.12 ] ][ i % 3 ] } );

	}

	K.rope( [ V( 0.85, hf - 0.1, - 0.2 ), V( 0.85, hf - 0.36, - 0.2 ) ], 0.004 );
	K.prop( 'wooden_lantern_01', place( 0.85, hf - 0.84, - 0.2, 0.4 ) );
	K.prop( 'lifebuoy', place( 1.37, 1.15, 0.5, Math.PI / 2 + 0.05, 0, 0.08 ) );

	// diesel on the right: two drums and the cans
	const drum = ( lx, lz, c ) => {

		K.geometry( Shapes.cylinder( 0.29, 0.29, 0.88, 22 ), place( lx, 0.44, lz, K.rnd() * 3 ), { layer: PLAIN, color: c, params: [ 0.55, 0.6 ] } );
		for ( const hy of [ 0.3, 0.6 ] ) K.geometry( Shapes.torus( 0.292, 0.012, 6, 22 ), place( lx, hy, lz, 0, Math.PI / 2 ), { layer: PLAIN, color: c.map( ( v ) => v * 0.8 ), params: [ 0.5, 0.6 ] } );

	};
	drum( 1.75, - 0.5, [ 0.62, 0.14, 0.1 ] );
	drum( 2.05, 0.1, [ 0.16, 0.3, 0.52 ] );
	K.prop( 'metal_jerrycan_green', place( 1.6, 0, 0.45, 0.4 ) );
	K.prop( 'plastic_jerrycan', place( 1.95, 0, 0.75, 1.2 ) );

	// crates for the fish on the left, a bucket
	K.prop( 'wooden_crate_01', place( - 1.85, 0, - 0.3, Math.PI / 2 + J( 0.2 ) ) );
	K.prop( 'wooden_crate_02', place( - 1.8, 0.335, - 0.3, J( 0.3 ) ) );
	K.prop( 'wooden_bucket_01', place( - 1.55, 0, 0.55, 0.7 ) );
	return K.build();

}

function floatGeo() {

	const pts = [];
	for ( let i = 0; i <= 12; i ++ ) {

		const t = i / 12, e = Math.min( 1, Math.min( t, 1 - t ) / 0.25 );
		pts.push( [ 0.012 + 0.04 * Math.sqrt( e * ( 2 - e ) ), ( t - 0.5 ) * 0.15 ] );

	}

	return Shapes.lathe( pts, 12 );

}
