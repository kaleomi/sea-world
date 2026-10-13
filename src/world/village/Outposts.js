import { Color, Vector3 } from '../../engine/index.js';
import { quad01Part } from './GeoBuilder.js';
import { buildHouse, buildShed } from './Buildings.js';
import {
	C, WOOD, HARD, lin, rowboat, oar, netRack, fishRack, buoy, ropeCoil, bench, flagPole, lifeRing, bucket,
} from '../Props.js';
import { GIVERS, beachSpot } from '../../game/Quests.js';

// The quest givers' homes on the outer islands (game/Quests.js): each person's house a little way up
// the beach behind where they stand (beachSpot), dressed for their trade, and the lighthouse on Eagle
// Rock's cliff top. Built into the village's builder (Village.js), so they share its materials and
// draw calls; heights come from the outer islands through TerrainData.heightAt.
//   const outposts = buildOutposts( ctx, terrain.outer )  → [ { id, island, x, z, kind } ]

// per giver: the house (Buildings.buildHouse spec, without position) and what stands around it
const HOMES = {
	// Nalu, reef keeper on the atoll: a thatched stilt hut on the islet's sand, a canoe-like rowboat, nets
	nalu: {
		hut: true, w: 4.2, d: 4.0, roof: 'hip', roofMat: 'thatch', thatchAge: 0.45, wall: lin( 0x6aa6b8 ), trim: lin( 0xf3efe6 ), accent: lin( 0xa8463a ),
		siding: 2, paint: 0.5, weather: 0.85, porch: { depth: 1.6, rail: 'x' }, shutters: 'board', fewWindows: true, rimRaw: true, buoys: 1, porchBench: false,
		props: [ 'boat', 'net', 'buoys' ],
	},
	// Tama runs a fish smokehouse on Ember Island: a cottage, the smoke shed, drying racks and a woodpile
	tama: {
		w: 6.0, d: 5.0, roof: 'gable', roofMat: 'metal', roofColor: lin( 0x8a5a40 ), rust: 0.6, wall: lin( 0xefe2c2 ), trim: lin( 0xa8463a ), accent: lin( 0xa8463a ),
		siding: 1, paint: 0.6, porch: { depth: 2.0, rail: 'balusters' }, stovepipe: true, woodpile: 1, chimney: - 1,
		props: [ 'smokehouse', 'racks', 'barrels' ],
	},
	// Mira, pearl diver on Crescent Isle: a stilt hut on the bay's beach, her boat and baskets
	mira: {
		hut: true, w: 4.4, d: 4.0, roof: 'gableFront', roofMat: 'thatch', thatchAge: 0.3, wall: lin( 0xf2b3aa ), trim: lin( 0xe9dfc6 ), accent: lin( 0x2d7f7a ),
		siding: 2, paint: 0.55, weather: 0.8, porch: { depth: 1.6, rail: 'x' }, shutters: 'bahama', fewWindows: true, rimRaw: true, porchBench: false,
		railNet: lin( 0x2f5f8a ), props: [ 'boat', 'baskets', 'buoys' ],
	},
	// Oskar, old navigator on the Skerries: a two-storey house with a flag mast and a life ring
	oskar: {
		w: 6.4, d: 5.4, stories: 2, roof: 'hip', roofMat: 'metal', roofColor: lin( 0x4f7898 ), wall: lin( 0xf1ede2 ), trim: lin( 0x2e4f73 ), accent: lin( 0x2e4f73 ),
		siding: 1, paint: 0.75, porch: { depth: 2.1, rail: 'balusters' }, antenna: true, doorGlass: true, shutters: 'louver',
		props: [ 'flag', 'ring', 'bench' ],
	},
	// Hilde keeps the light on Eagle Rock: her cottage by the cove, the lighthouse on the cliff above
	hilde: {
		w: 5.6, d: 4.8, roof: 'gable', roofMat: 'metal', roofColor: lin( 0xa64a35 ), wall: lin( 0xf3efe6 ), trim: lin( 0xa8463a ), accent: lin( 0x2e4f73 ),
		siding: 1, paint: 0.7, porch: { depth: 1.9, rail: 'balusters' }, foundation: 'stone', stoneStyle: 1, chimney: 1, gutter: true,
		props: [ 'lighthouse', 'bench', 'ring' ],
	},
	// Bram guides on the Long Cay flats: a tin-roofed stilt hut, skiff, net rack, fuel barrels
	bram: {
		hut: true, w: 4.0, d: 4.2, roof: 'gableFront', roofMat: 'metal', roofColor: lin( 0x8c9296 ), galv: true, rust: 0.7, wall: lin( 0xa9dcbf ), trim: lin( 0xf3efe6 ), accent: lin( 0x3f79ae ),
		siding: 2, paint: 0.5, weather: 0.85, porch: { depth: 1.6, rail: 'x' }, shutters: 'board', fewWindows: true, rimRaw: true, porchBench: false,
		props: [ 'boat', 'net', 'barrels' ],
	},
};

// a place for a building of w x d (local frame: +z faces `yaw`) near the giver's spot `s`:
// houses sit on the steadiest ground inland, stilt huts on the sand beside them
function findSite( o, s, w, d, hut ) {

	const dx = Math.sin( s.yaw ), dz = Math.cos( s.yaw ); // out to sea
	const px = dz, pz = - dx; // along the beach
	let best = null;
	const backs = hut ? [ - 2, 0, 2, 4, 6 ] : [ 10, 12, 14, 16, 18, 21, 24, 28, 32 ];
	const lats = hut ? [ 10, - 10, 12, - 12, 14, - 14, 17, - 17, 20, - 20 ] : [ 0, 4, - 4, 8, - 8, 12, - 12, 16, - 16 ];
	for ( const back of backs ) for ( const lat of lats ) {

		const x = s.x - dx * back + px * lat, z = s.z - dz * back + pz * lat;
		let lo = Infinity, hi = - Infinity, rock = 0;
		for ( let i = - 2; i <= 2; i ++ ) for ( let j = - 2; j <= 2; j ++ ) {

			const lx = i / 4 * ( w + 1 ), lz = j / 4 * ( d + 3 );
			const h = o.heightAt( x + lx * dz + lz * dx, z - lx * dx + lz * dz );
			lo = Math.min( lo, h );
			hi = Math.max( hi, h );

		}

		if ( o.rock ) {

			const i = Math.floor( ( x - o.x0 ) / o.texel ), j = Math.floor( ( z - o.z0 ) / o.texel );
			if ( i >= 0 && j >= 0 && i < o.res && j < o.res ) rock = o.rock[ j * o.res + i ];

		}

		let score;
		if ( hut ) {

			// on the sand or out over the shallows, floor on stilts well over a spring tide
			if ( lo < - 1.0 || hi > 2.6 ) continue;
			score = Math.abs( lat ) * 0.1 + Math.abs( back - 2 ) * 0.2 + ( hi - lo );

		} else {

			if ( lo < 1.4 || hi - lo > 1.8 || rock > 0.35 ) continue;
			score = ( hi - lo ) * 3 + Math.abs( back - 14 ) * 0.12 + Math.abs( lat ) * 0.08;

		}

		if ( ! best || score < best.score ) best = { x, z, score, lo, hi };

	}

	return best;

}

export function buildOutposts( ctx, islands, footprints ) {

	const { B, terrain, colliders, rand } = ctx;
	const out = [];
	for ( const o of islands || [] ) for ( const g of Object.values( GIVERS ) ) {

		if ( g.island !== o.id || ! HOMES[ g.id ] ) continue;
		const s = beachSpot( o, 0, 0 );
		if ( ! s ) continue;
		const home = HOMES[ g.id ];
		const site = findSite( o, s, home.w, home.d + ( home.porch ? home.porch.depth : 0 ), home.hut );
		if ( ! site ) continue;
		const spec = {
			...home, name: g.id, x: site.x, z: site.z, yaw: s.yaw + rand.range( - 0.12, 0.12 ),
			curtain: lin( 0xe8d6b0 ),
		};
		if ( home.hut ) {

			spec.foundation = 'stilts';
			spec.floorY = Math.max( 3.2, site.hi + 1.6 );

		} else if ( ! spec.foundation ) spec.foundation = 'posts';

		const res = buildHouse( ctx, spec );
		footprints.push( res.footprint );
		out.push( { id: g.id, island: o.id, x: site.x, z: site.z, yaw: spec.yaw, floorY: res.floorY, kind: home.hut ? 'hut' : 'house' } );
		const props = { o, s, spec, res, footprints, out };
		for ( const p of home.props ) PROPS[ p ]?.( ctx, props );

	}

	return out;

}

// ------------------------------------------------------------------ dressing

// a point beside the house: lx across its front, lz forward (+) / back (-) from its centre
function beside( spec, lx, lz ) {

	const c = Math.cos( spec.yaw ), s = Math.sin( spec.yaw );
	return { x: spec.x + lx * c + lz * s, z: spec.z - lx * s + lz * c };

}

const box = ( colliders, x, y, z, hx, hy, hz, ry, tag ) => colliders.addBox( new Vector3( x, y, z ), new Vector3( hx, hy, hz ), ry, { tag } );

const PROPS = {

	// a rowboat pulled up on the sand between the giver and the sea, oars beside it
	boat( { B, terrain, colliders, rand }, { s, footprints } ) {

		const dx = Math.sin( s.yaw ), dz = Math.cos( s.yaw );
		const side = rand.chance( 0.5 ) ? 1 : - 1;
		const x = s.x + dz * 6 * side + dx * 1.5, z = s.z - dx * 6 * side + dz * 1.5;
		const gy = terrain.heightAt( x, z );
		const ry = s.yaw + side * 0.5;
		rowboat( B, x, gy + 0.05, z, ry, { seed: rand.next(), hull: rand.pick( [ lin( 0x2f8f9a ), lin( 0xd8c35a ), lin( 0xe9e4d6 ) ] ), bottom: lin( 0xa0402e ), trim: C.white, rz: 0.12 * side, oars: true } );
		box( colliders, x, gy + 0.4, z, 0.72, 0.45, 2.0, ry, 'rowboat' );
		footprints.push( { x, z, r: 2.4, kind: 'prop' } );

	},

	// a net drying rack at the side of the house
	net( { B, terrain, colliders, rand }, { spec, footprints } ) {

		const p = beside( spec, spec.w / 2 + 2.6, 1.2 );
		const ry = spec.yaw + Math.PI / 2 + rand.range( - 0.2, 0.2 );
		const cy = Math.cos( ry ), sy = Math.sin( ry );
		const g = ( x, z ) => terrain.heightAt( x, z );
		netRack( B, p.x, g( p.x, p.z ), p.z, ry, 3.0, rand.pick( [ lin( 0x3f6f5f ), lin( 0x2f5f8a ), lin( 0xb0553a ) ] ), rand.next(), ( lx, lz ) => g( p.x + lx * cy + lz * sy, p.z - lx * sy + lz * cy ) );
		for ( const sx of [ - 1.5, 1.5 ] ) {

			const px = p.x + sx * cy, pz = p.z - sx * sy;
			colliders.addCylinder( px, pz, 0.1, g( px, pz ) - 0.4, g( px, pz ) + 2.0, { tag: 'rack' } );

		}

		footprints.push( { x: p.x, z: p.z, r: 2.2, kind: 'prop' } );

	},

	// loose buoys and a coil of rope on the sand by the giver
	buoys( { B, terrain, rand }, { s } ) {

		const pal = [ [ C.orange, C.white ], [ C.red, C.white ], [ C.yellow, C.black ], [ C.white, C.blue ] ];
		const dx = Math.sin( s.yaw ), dz = Math.cos( s.yaw );
		for ( let i = 0; i < 3; i ++ ) {

			const lat = - 3 - i * 0.7, x = s.x + dz * lat - dx * ( 1 + i * 0.4 ), z = s.z - dx * lat - dz * ( 1 + i * 0.4 );
			const [ a, b ] = rand.pick( pal );
			buoy( B, x, terrain.heightAt( x, z ) - 0.02, z, a, b, rand.chance( 0.5 ) ? 0 : 2, rand.next(), { rz: 1.4, ry: rand.range( 0, 6 ) } );

		}

		const x = s.x - dz * 2.2 - dx * 2.4, z = s.z + dx * 2.2 - dz * 2.4;
		ropeCoil( B, x, terrain.heightAt( x, z ), z, 0.08, 0.3, 4, rand.next() );

	},

	// Mira's baskets of shells: buckets and crates by her hut's steps
	baskets( { B, terrain, rand, inst }, { spec } ) {

		for ( let i = 0; i < 3; i ++ ) {

			const p = beside( spec, - spec.w / 2 - 0.9 - i * 0.55, spec.d / 2 + 0.6 + ( i % 2 ) * 0.4 );
			bucket( B, p.x, terrain.heightAt( p.x, p.z ), p.z, rand.pick( [ C.blue, C.yellow, C.white ] ), rand.next() );

		}

		const p = beside( spec, - spec.w / 2 - 1.2, spec.d / 2 - 0.6 );
		inst.add( 'crate', p.x, terrain.heightAt( p.x, p.z ) - 0.02, p.z, spec.yaw + 0.3, [ 1, 0.95, 0.9 ] );

	},

	barrels( { terrain, colliders, rand, inst }, { spec } ) {

		for ( const [ lx, lz ] of [ [ - 0.0, 0 ], [ 0.75, 0.25 ], [ 0.3, - 0.6 ] ] ) {

			const p = beside( spec, - spec.w / 2 - 1.2 + lx, - spec.d / 2 + 1.0 + lz );
			const gy = terrain.heightAt( p.x, p.z );
			inst.add( 'barrel', p.x, gy - 0.02, p.z, rand.range( 0, 6 ), [ rand.range( 0.85, 1.05 ), 0.92, 0.85 ] );
			colliders.addCylinder( p.x, p.z, 0.32, gy, gy + 0.9, { tag: 'barrel' } );

		}

	},

	// Tama's smoke shed beside the cottage, and two racks of fish drying in the wind
	smokehouse( ctx, { spec, footprints } ) {

		const { B, terrain, colliders, rand } = ctx;
		const p = beside( spec, spec.w / 2 + 2.4, - 0.8 );
		const res = buildShed( ctx, { name: 'smokehouse', x: p.x, z: p.z, yaw: spec.yaw - 0.15, w: 2.4, d: 2.2, wall: lin( 0x8a6a50 ), door: lin( 0x3a3028 ), galv: true } );
		footprints.push( res.footprint );
		// a stovepipe out of the shed's roof
		B.cyl( 'hard', p.x, res.roofTop - 0.4, p.z, 0.09, 0.09, 1.5, { segs: 8, tint: C.iron, data: HARD( rand.next(), 0.7, 0.6, 0.5 ) } );
		colliders.addCylinder( p.x, p.z, 1.4, terrain.heightAt( p.x, p.z ), res.roofTop, { tag: 'shed' } );

	},

	racks( { B, terrain, colliders, rand }, { spec, footprints } ) {

		for ( const lx of [ - spec.w / 2 - 2.2, - spec.w / 2 - 5.0 ] ) {

			const p = beside( spec, lx, spec.d / 2 + 1.5 );
			const ry = spec.yaw + rand.range( - 0.15, 0.15 );
			const gy = terrain.heightAt( p.x, p.z );
			fishRack( B, p.x, gy, p.z, ry, 2.4, rand.next(), rand );
			box( colliders, p.x, gy + 1.0, p.z, 1.35, 1.0, 0.7, ry, 'rack' );
			footprints.push( { x: p.x, z: p.z, r: 1.8, kind: 'prop' } );

		}

	},

	flag( { B, terrain, colliders, rand }, { spec, footprints } ) {

		const p = beside( spec, spec.w / 2 + 2.2, spec.d / 2 + 1.8 );
		const gy = terrain.heightAt( p.x, p.z );
		flagPole( B, p.x, gy, p.z, 6.5, C.blue, rand.next() );
		colliders.addCylinder( p.x, p.z, 0.08, gy, gy + 6.5, { tag: 'flagpole' } );
		footprints.push( { x: p.x, z: p.z, r: 1.0, kind: 'prop' } );

	},

	// a life ring on a post by the front steps
	ring( { B, terrain, colliders, rand }, { spec } ) {

		const p = beside( spec, - spec.w / 2 - 0.6, spec.d / 2 + 2.6 );
		const gy = terrain.heightAt( p.x, p.z );
		B.cyl( 'wood', p.x, gy - 0.4, p.z, 0.07, 0.08, 1.9, { segs: 6, data: WOOD( rand.next(), 0.9 ) } );
		lifeRing( B, p.x + Math.sin( spec.yaw ) * 0.12, gy + 1.05, p.z + Math.cos( spec.yaw ) * 0.12, spec.yaw, rand.next() );
		colliders.addCylinder( p.x, p.z, 0.1, gy - 0.4, gy + 1.5, { tag: 'post' } );

	},

	bench( { B, terrain, colliders, rand }, { spec } ) {

		const p = beside( spec, spec.w / 2 - 0.9, spec.d / 2 + ( spec.porch ? spec.porch.depth : 0 ) + 2.4 );
		const gy = terrain.heightAt( p.x, p.z );
		const ry = spec.yaw + Math.PI;
		bench( B, p.x, gy, p.z, ry, 1.6, rand.next(), lin( 0x4f8fa0 ) );
		box( colliders, p.x, gy + 0.45, p.z, 0.85, 0.45, 0.3, ry, 'bench' );

	},

	// the lighthouse on the cliff top above Hilde's cove
	lighthouse( ctx, { o, s, footprints, out } ) {

		const site = cliffTop( o, s );
		if ( ! site ) return;
		const res = buildLighthouse( ctx, site );
		footprints.push( res.footprint );
		out.push( { id: 'lighthouse', island: o.id, x: site.x, z: site.z, yaw: site.yaw, floorY: res.base, top: res.lamp.y, kind: 'lighthouse' } );

	},

};

// the highest flat ground near the cliff edge, closest to the giver (so it stands over the cove)
function cliffTop( o, s ) {

	let best = null;
	const top = o.def.terrain.height || o.def.terrain.peak || 40;
	for ( let r = 30; r <= 260; r += 6 ) for ( let a = 0; a < 64; a ++ ) {

		const ang = a / 64 * Math.PI * 2;
		const x = s.x + Math.cos( ang ) * r, z = s.z + Math.sin( ang ) * r;
		const h = o.heightAt( x, z );
		if ( h < top * 0.75 ) continue;
		let flat = true, drop = 0, dAng = 0;
		for ( let k = 0; k < 8; k ++ ) {

			const ka = k / 8 * Math.PI * 2, c = Math.cos( ka ), sn = Math.sin( ka );
			if ( Math.abs( o.heightAt( x + c * 4, z + sn * 4 ) - h ) > 1.2 ) flat = false;
			const dd = h - o.heightAt( x + c * 24, z + sn * 24 );
			if ( dd > drop ) {

				drop = dd;
				dAng = ka;

			}

		}

		if ( ! flat || drop < 18 ) continue;
		const score = r - drop * 0.5;
		if ( ! best || score < best.score ) best = { x, z, y: h, yaw: Math.atan2( Math.cos( dAng ), Math.sin( dAng ) ), score };

	}

	return best;

}

// A round masonry tower in white with red bands, a gallery with a railing, the glazed lantern room and
// a red cap. The lantern glass glows at night (village glass, lantern kind) and a strong light hangs in it.
export function buildLighthouse( ctx, site ) {

	const { B, terrain, colliders, rand, lights } = ctx;
	const { x, z } = site;
	let g0 = Infinity;
	for ( let k = 0; k < 12; k ++ ) g0 = Math.min( g0, terrain.heightAt( x + Math.cos( k / 12 * 6.283 ) * 3.6, z + Math.sin( k / 12 * 6.283 ) * 3.6 ) );
	const white = lin( 0xf1ede2 ), red = lin( 0xb8402f ), iron = C.iron;
	const sd = ( style = 1 ) => [ rand.next(), style, 0, 0 ];
	const base = g0 + 0.6, H = 19, r0 = 2.5, r1 = 1.7;
	const rAt = ( y ) => r0 + ( r1 - r0 ) * ( y - base ) / H;

	// plinth of rough stone, then the tower in five bands
	B.cyl( 'stone', x, g0 - 0.8, z, 3.3, 3.5, base - g0 + 0.8, { segs: 20, capTop: true, tint: lin( 0xcfc8b8 ), data: sd( 0 ) } );
	const bands = [ 0, 4.2, 7.6, 11.4, 14.8, H ];
	for ( let i = 0; i < 5; i ++ ) {

		const y0 = base + bands[ i ], y1 = base + bands[ i + 1 ];
		B.cyl( 'stone', x, y0, z, rAt( y1 ), rAt( y0 ), y1 - y0, { segs: 24, capTop: i === 4, tint: i % 2 ? red : white, data: sd() } );

	}

	// the door on the landward side (site.yaw faces over the cliff), small windows up the tower
	const fy = site.yaw + Math.PI;
	const dx = Math.sin( fy ), dz = Math.cos( fy );
	B.pushAt( x, 0, z, fy );
	B.box( 'wood', 0, base + 1.05, r0 - 0.02, 1.0, 2.1, 0.12, { grain: 1, tint: lin( 0x2e4f73 ), data: WOOD( rand.next(), 0.5, 0.75, 2 ) } );
	for ( const [ y, a ] of [ [ 6.0, 0.4 ], [ 10.0, - 0.5 ], [ 13.6, 0.3 ] ] ) {

		const r = rAt( base + y ) + 0.01;
		B.pushAt( Math.sin( a ) * r, 0, Math.cos( a ) * r, a );
		B.part( 'glass', quad01Part( 0.5, 0.8 ), 0, base + y, 0.0, { tint: lin( 0xe8d6b0 ), data: [ rand.next(), 0, 1, 0 ] } );
		B.box( 'wood', 0, base + y - 0.45, 0.04, 0.7, 0.08, 0.14, { grain: 0, tint: white, data: WOOD( rand.next(), 0.3, 0.8, 0 ) } );
		B.pop();

	}

	B.pop();

	// gallery deck, railing and posts
	const gy = base + H;
	B.cyl( 'stone', x, gy - 0.05, z, 2.45, 2.2, 0.35, { segs: 24, capBot: true, tint: white, data: sd() } );
	B.torus( 'hard', x, gy + 1.0, z, 2.3, 0.035, { rx: Math.PI / 2, radial: 5, tubular: 32, tint: iron, data: HARD( rand.next(), 0.4, 0.5, 0.5 ) } );
	B.torus( 'hard', x, gy + 0.55, z, 2.3, 0.025, { rx: Math.PI / 2, radial: 5, tubular: 32, tint: iron, data: HARD( rand.next(), 0.4, 0.5, 0.5 ) } );
	for ( let k = 0; k < 16; k ++ ) {

		const a = k / 16 * Math.PI * 2;
		B.cyl( 'hard', x + Math.cos( a ) * 2.3, gy + 0.3, z + Math.sin( a ) * 2.3, 0.03, 0.03, 0.72, { segs: 5, tint: iron, data: HARD( rand.next(), 0.4, 0.5, 0.5 ) } );

	}

	// lantern room: iron base ring, glass all round between mullions, red domed cap and a vane
	const ly = gy + 0.3;
	B.cyl( 'hard', x, ly, z, 1.35, 1.4, 0.8, { segs: 16, tint: red, data: HARD( rand.next(), 0.25, 0.3, 0.45 ) } );
	B.cyl( 'glass', x, ly + 0.8, z, 1.25, 1.25, 1.7, { segs: 16, capTop: false, tint: C.glassWarm, data: [ rand.next(), 1, 1, 0 ] } );
	for ( let k = 0; k < 8; k ++ ) {

		const a = k / 8 * Math.PI * 2;
		B.box( 'hard', x + Math.cos( a ) * 1.27, ly + 1.65, z + Math.sin( a ) * 1.27, 0.07, 1.72, 0.07, { tint: iron, data: HARD( rand.next(), 0.3, 0.6, 0.4 ) } );

	}

	const cy = ly + 2.5;
	B.cyl( 'hard', x, cy, z, 1.5, 1.5, 0.12, { segs: 16, capBot: true, tint: iron, data: HARD( rand.next(), 0.3, 0.6, 0.4 ) } );
	B.lathe( 'roofMetal', x, cy + 0.12, z, [ [ 1.45, 0 ], [ 1.2, 0.45 ], [ 0.75, 0.85 ], [ 0.25, 1.1 ], [ 0, 1.15 ] ], { segs: 16, tint: red, data: [ rand.next(), 0.2, 0, 0 ] } );
	B.cyl( 'hard', x, cy + 1.2, z, 0.03, 0.05, 1.0, { segs: 6, tint: iron, data: HARD( rand.next(), 0.3, 0.6, 0.4 ) } );
	B.lathe( 'hard', x, cy + 1.25, z, [ [ 0, 0 ], [ 0.12, 0.06 ], [ 0.12, 0.16 ], [ 0, 0.24 ] ], { segs: 8, tint: C.brass, data: HARD( rand.next(), 0.2, 0.9, 0.35 ) } );

	const lamp = new Vector3( x, ly + 1.6, z );
	lights.push( { position: lamp, color: new Color( 1.0, 0.86, 0.62 ), intensity: 14, kind: 'beacon' } );
	colliders.addCylinder( x, z, r0 + 0.1, g0, cy + 1.2, { tag: 'lighthouse' } );
	// a boulder-edged step up to the door
	const sx = x + dx * ( r0 + 0.7 ), sz = z + dz * ( r0 + 0.7 );
	B.box( 'stone', sx, ( terrain.heightAt( sx, sz ) + base ) / 2 - 0.1, sz, 1.6, base - terrain.heightAt( sx, sz ) + 0.4, 1.0, { ry: fy, grain: 0, tint: lin( 0xcfc8b8 ), data: sd( 0 ) } );
	// a clearing round it (the footprint keeps the plateau's forest back)
	return { base, lamp, footprint: { x, z, r: 13, kind: 'building' } };

}
