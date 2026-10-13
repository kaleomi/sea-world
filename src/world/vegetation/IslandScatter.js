import * as THREE from '../../engine/index.js';
import { Noise2D, mulberry32, smoothstep } from '../../util/Noise.js';
import { Occupancy, KIND, scatter } from './Scatter.js';

// Vegetation for the generated outer islands (world/terrain/OuterIsland.js). The home island's
// scatter (Scatter.js) is tuned by hand to its bays, village and headlands; out here a few general
// rules from the island's own heights and masks do:
//   palms     groves along the back of every beach and over the atoll's sandy islets, leaning seaward
//   trees     a forest on the volcano's lower and middle slopes, thinning out towards the bare top
//   shrubs    the forest edge and the islets' scrub
//   ferns, young palms   under the trees
// Records have the same shape as scatterVegetation's, so Vegetation draws them with the same meshes.
const TAU = Math.PI * 2;

export function scatterIsland( island, seed = 7 ) {

	const o = island;
	const rand = mulberry32( ( o.def.seed || 1 ) * 977 + seed );
	const N = new Noise2D( ( o.def.seed || 1 ) * 13 + 2 );
	const occ = new Occupancy( 4 ), occT = new Occupancy( 6 );
	const out = { palms: [], trees: [], bananas: [], shrubs: [], youngPalms: [], ferns: [], monsteras: [], elephantEars: [], heliconias: [], strelitzias: [] };
	const n = new THREE.Vector3();
	const res = o.res, texel = o.texel;
	const mask = ( arr, x, z, scale = 1 ) => {

		const i = Math.floor( ( x - o.x0 ) / texel ), j = Math.floor( ( z - o.z0 ) / texel );
		return i < 0 || j < 0 || i >= res || j >= res ? 0 : arr[ j * res + i ] * scale;

	};
	const groundY = ( x, z, r ) => Math.min( o.heightAt( x, z ), o.heightAt( x + r, z ), o.heightAt( x - r, z ), o.heightAt( x, z + r ), o.heightAt( x, z - r ) );
	// the island's land lies well inside its grid
	const x0 = o.x0 + 40, z0 = o.z0 + 40, x1 = o.x0 + o.size - 40, z1 = o.z0 + o.size - 40;
	const peak = o.def.terrain.peak || 4;
	// low islands (the atoll's islets) are all beach: palms from just above the wet sand, denser
	const low = peak <= 20, lowest = low ? 1.6 : 1.9;

	// --- palms: beach groves, leaning down the slope to the sea
	scatter( rand, x0, z0, x1, z1, 3.4, ( x, z ) => {

		const h = o.heightAt( x, z );
		if ( h < lowest || h > 7 ) return;
		o.normalAt( x, z, n );
		if ( n.y < 0.9 || mask( o.rock, x, z ) > 0.25 ) return;
		const grove = N.fbm( ( x - o.cx ) / 45, ( z - o.cz ) / 45, 3 );
		const band = smoothstep( lowest, lowest + 0.5, h ) * ( 1 - smoothstep( 5, 7, h ) );
		if ( rand() > ( low ? 0.8 : 0.55 ) * smoothstep( - 0.3, 0.2, grove ) * band ) return;
		if ( ! occ.free( x, z, 1.95, 1 ) ) return;
		occ.add( x, z, 1.95, KIND.PALM );
		const l = Math.hypot( n.x, n.z ) || 1;
		const la = Math.atan2( n.z / l, n.x / l ) + ( rand() - 0.5 ) * 1.1;
		const s = 0.85 + rand() * 0.32;
		out.palms.push( { x, y: groundY( x, z, 0.35 ) - 0.05, z, s, yaw: rand() * TAU, la, l: ( 0.12 + 0.3 * ( 1 - smoothstep( 2.3, 5, h ) ) ) * ( 0.55 + 0.75 * rand() ), H: ( 7 + rand() * 6.5 ) * ( 0.9 + 0.2 * s ), seed: rand() } );

	} );

	// --- trees: the volcano's forest (none on the low islets: they stay palm and scrub)
	if ( peak > 20 ) scatter( rand, x0, z0, x1, z1, 4.8, ( x, z ) => {

		const h = o.heightAt( x, z );
		if ( h < 5 ) return;
		o.normalAt( x, z, n );
		const rock = mask( o.rock, x, z );
		if ( n.y < 0.72 || rock > 0.3 ) return;
		const clump = N.fbm( ( x - o.cx ) / 60, ( z - o.cz ) / 60, 3 );
		const high = smoothstep( peak * 0.45, peak * 0.7, h ); // thinning towards the bare top
		const p = ( 0.85 * smoothstep( 5, 10, h ) + 0.1 * clump ) * ( 1 - high ) * ( 1 - smoothstep( 0.15, 0.3, rock ) );
		if ( rand() > p ) return;
		const sub = rand() < 0.3;
		const s = ( sub ? 0.55 + rand() * 0.2 : 0.8 + rand() * 0.45 ) * ( rand() < 0.06 ? 1.25 : 1 );
		const sy = 0.78 + rand() * 0.34;
		const r = 2.5 * s;
		if ( ! occT.free( x, z, r, 1 ) || ! occ.free( x, z, 0.5 * s, 1 ) ) return;
		occT.add( x, z, r, KIND.TREE );
		occ.add( x, z, 0.5 * s, KIND.TREE );
		const yaw = rand() * TAU;
		out.trees.push( { x, y: groundY( x, z, 0.6 ) - 0.15, z, s, sy, yaw, la: yaw, l: sy, H: 12.5 * s * sy, seed: rand() } );

	} );

	// --- shrubs: the forest edge, and scrub on the islets behind the palms
	scatter( rand, x0, z0, x1, z1, 3.2, ( x, z ) => {

		const h = o.heightAt( x, z );
		if ( h < ( low ? 1.9 : 2.3 ) ) return;
		o.normalAt( x, z, n );
		if ( n.y < 0.75 || mask( o.rock, x, z ) > 0.35 ) return;
		const edge = peak > 20 ? smoothstep( 3, 6, h ) * ( 1 - smoothstep( 10, 18, h ) ) + 0.25 * smoothstep( peak * 0.4, peak * 0.6, h ) * ( 1 - smoothstep( peak * 0.7, peak * 0.8, h ) ) : smoothstep( 1.9, 2.6, h );
		if ( rand() > 0.3 * edge * smoothstep( - 0.3, 0.2, N.fbm( ( x - o.cx ) / 25, ( z - o.cz ) / 25, 2 ) ) ) return;
		const s = 0.75 + rand() * 0.8;
		const sy = 0.65 + rand() * 0.65;
		if ( ! occ.free( x, z, 0.85 * s, 1 ) ) return;
		occ.add( x, z, 0.85 * s, KIND.SHRUB );
		const yaw = rand() * TAU;
		out.shrubs.push( { x, y: groundY( x, z, 0.3 ) - 0.08 * s, z, s, sy, yaw, la: yaw, l: - sy, H: 1.6 * s * sy, seed: rand() } );

	} );

	// --- the understory: ferns and young palms where the trees are
	if ( peak > 20 ) scatter( rand, x0, z0, x1, z1, 2.6, ( x, z ) => {

		if ( occT.free( x, z, 1, 1 ) ) return; // only under a crown
		const h = o.heightAt( x, z );
		if ( h < 4 ) return;
		o.normalAt( x, z, n );
		if ( n.y < 0.75 || rand() > 0.35 ) return;
		const young = rand() < 0.15;
		const s = young ? 0.7 + rand() * 0.6 : 0.75 + rand() * 0.7;
		const r = young ? 1.1 * s : 0.5 * s;
		if ( ! occ.free( x, z, r, 1 ) ) return;
		occ.add( x, z, r, young ? KIND.YOUNG : KIND.FERN );
		if ( young ) out.youngPalms.push( { x, y: h - 0.05, z, s, yaw: rand() * TAU, la: rand() * TAU, l: rand() * 0.1, H: 0.35 * s, seed: rand() } );
		else out.ferns.push( { x, y: h - 0.03, z, s, yaw: rand() * TAU, la: 0, l: 0, H: 0.05, seed: rand() } );

	} );

	return out;

}
