import { FISH, FISH_IDS } from './FishTable.js';

// Where the bobber is and what lives there.
//   depth     water depth under the bobber (m)
//   reefDist  horizontal distance to the reef edge (m, < 0 inside it)
//   pierDist  horizontal distance to the pier (piles / head) (m)
// Returns weights per water type (they overlap: a spot can be both pier and bay).
export function habitatAt( { depth, reefDist, pierDist } ) {

	const h = { shallows: 0, reef: 0, pier: 0, bay: 0, deep: 0 };
	if ( depth < 0.25 ) return h; // on the sand
	h.shallows = smooth( 3.5, 1.0, depth );
	h.reef = smooth( 12, - 6, reefDist ) * smooth( 0.8, 2.5, depth );
	h.pier = smooth( 9, 2, pierDist ) * smooth( 0.6, 2, depth );
	h.bay = smooth( 1.5, 4, depth ) * ( 1 - smooth( 18, 30, depth ) );
	h.deep = smooth( 16, 28, depth );
	return h;

}

// 1 at the species' favourite time, less at others; hour 0..24
export function activity( pref, hour ) {

	const dawn = Math.exp( - ( ( hour - 6.5 ) ** 2 ) / 2.5 ), dusk = Math.exp( - ( ( hour - 18.5 ) ** 2 ) / 2.5 );
	const night = hour < 5.5 || hour > 19.5 ? 1 : 0;
	const day = hour > 7 && hour < 18 ? 1 : 0.35;
	switch ( pref ) {

		case 'day': return 0.25 + 0.75 * day * ( 1 - night );
		case 'dawnDusk': return 0.3 + 0.7 * Math.max( dawn, dusk ) + 0.1 * day;
		case 'night': return 0.15 + 0.85 * Math.max( night, dusk * 0.8 );
		default: return 0.8 + 0.2 * Math.max( dawn, dusk );

	}

}

// Weighted pick of the species that bites here; null when nothing lives here.
// rng: () => [0, 1); ids: the species on this island (WORLD.island.species), all by default
export function pickSpecies( habitat, hour, rng = Math.random, ids = FISH_IDS ) {

	let total = 0;
	const w = [];
	for ( const id of ids ) {

		const f = FISH[ id ];
		let hw = 0;
		for ( const k in f.habitat ) hw += f.habitat[ k ] * habitat[ k ];
		const x = hw * f.rarity * activity( f.time, hour );
		w.push( x );
		total += x;

	}

	if ( total < 1e-4 ) return null;
	let r = rng() * total;
	for ( let i = 0; i < w.length; i ++ ) {

		r -= w[ i ];
		if ( r <= 0 ) return ids[ i ];

	}

	return ids[ ids.length - 1 ];

}

// Weight in kg: skewed toward the small end (most fish are small, trophies are rare)
export function rollWeight( id, rng = Math.random ) {

	const [ a, b ] = FISH[ id ].kg;
	const t = Math.pow( rng(), 2.2 );
	return a + ( b - a ) * t;

}

// Fish feed better in the rain: it washes food into the water, dims the light and breaks up the
// surface, so the line is harder to see. Returns a multiplier on how often something takes the bait.
export function rainBiteRate( rain = 0 ) {

	return 1 + 0.85 * Math.min( 1, Math.max( 0, rain ) );

}

// Seconds until the next bite at this spot: richer water bites sooner. Infinity when barren.
// rain: 0..1 (see src/weather/), from App through Game.
export function biteDelay( habitat, hour, rng = Math.random, rain = 0 ) {

	let rich = 0;
	for ( const k in habitat ) rich += habitat[ k ];
	if ( rich < 0.05 ) return Infinity;
	// open water between the named habitats still has fish: never much slower than a poor spot
	rich = Math.max( rich, 0.35 );
	const light = hour > 6 && hour < 19 ? 1 : 0.8;
	const mean = 8 / ( Math.min( rich, 1.6 ) * light * rainBiteRate( rain ) );
	return 2 + - Math.log( 1 - rng() * 0.98 ) * mean * 0.6;

}

function smooth( e0, e1, x ) {

	const t = Math.min( 1, Math.max( 0, ( x - e0 ) / ( e1 - e0 ) ) );
	return t * t * ( 3 - 2 * t );

}
