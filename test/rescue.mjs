// Getting a stranded boat off (src/game/Rescue.js): from the home beach, from an outer island's sand and
// from a flat with no deep water anywhere near.
import { TerrainData } from '../src/world/TerrainData.js';
import { ISLANDS } from '../src/world/islands/index.js';
import { OuterIsland } from '../src/world/terrain/OuterIsland.js';
import { deepWaterNear, aground, MIN_DEPTH } from '../src/game/Rescue.js';

let fails = 0;
const check = ( ok, msg ) => {

	console.log( ( ok ? 'ok   ' : 'FAIL ' ) + msg );
	if ( ! ok ) fails ++;

};

const data = new TerrainData();
data.outer = [ new OuterIsland( ISLANDS.longcay ) ];
const h = ( x, z ) => data.heightAt( x, z );

// a spot on the home island's beach just above the waterline
let beach = null;
for ( let z = - 40; z > - 120 && ! beach; z -= 1 ) if ( h( 30, z ) > 0.3 && h( 30, z ) < 1.5 ) beach = { x: 30, z };
check( !! beach, `found a beach spot at the home island (${ beach && beach.z })` );
if ( beach ) {

	const s = deepWaterNear( h, beach.x, beach.z, 0 );
	check( !! s && - h( s.x, s.z ) >= MIN_DEPTH, `home beach: deep water ${ s && Math.round( s.dist ) } m away, ${ s && ( - h( s.x, s.z ) ).toFixed( 1 ) } m deep` );
	check( s && s.dist < 300, 'and not far' );
	// the bow points away from the beach: a little way ahead is no shallower
	const ahead = s && - h( s.x + Math.sin( s.heading ) * 20, s.z + Math.cos( s.heading ) * 20 );
	check( s && ahead >= 2.5, `pointing out to sea (${ ahead && ahead.toFixed( 1 ) } m deep 20 m ahead)` );

}

// on Long Cay's lee flats
const o = data.outer[ 0 ];
let flat = null;
for ( let r = 0; r < 400 && ! flat; r += 3 ) for ( let a = 0; a < 32 && ! flat; a ++ ) {

	const x = o.cx + Math.cos( a / 32 * 6.283 ) * r, z = o.cz + Math.sin( a / 32 * 6.283 ) * r;
	if ( h( x, z ) > - 0.8 && h( x, z ) < 0.2 ) flat = { x, z };

}

check( !! flat, 'found a sand flat at Long Cay' );
if ( flat ) {

	const s = deepWaterNear( h, flat.x, flat.z, 0 );
	check( !! s && - h( s.x, s.z ) >= MIN_DEPTH, `Long Cay flat: deep water ${ s && Math.round( s.dist ) } m away` );

}

check( deepWaterNear( () => - 1, 0, 0, 0, { maxR: 60 } ) === null, 'no deep water anywhere: null' );
check( aground( 0.5, 0.7, 0.1 ) && ! aground( 5, 0.7, 0.1 ) && ! aground( 0.5, 0, 0 ) && ! aground( 0.5, 0.7, 3 ), 'aground: shallow, throttle on, not moving' );
console.log( fails ? `\n${ fails } failed` : '\nall passed' );
process.exit( fails ? 1 : 0 );
