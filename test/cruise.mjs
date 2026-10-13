// Cruise control at the helm (src/player/Player.js helmThrottle): C holds the throttle without W, Shift
// or an already flat-out boat makes it full, S or C again lets go.
import { helmThrottle } from '../src/player/Player.js';

let fails = 0;
const check = ( ok, msg ) => {

	console.log( ( ok ? 'ok   ' : 'FAIL ' ) + msg );
	if ( ! ok ) fails ++;

};

const K = ( o = {} ) => ( { w: false, s: false, c: false, boost: false, ...o } );
check( helmThrottle( 0, K() ).throttle === 0, 'no keys, no cruise: the lever goes to idle' );
check( helmThrottle( 0, K( { w: true } ) ).throttle === 0.7 && helmThrottle( 0, K( { w: true, boost: true } ) ).throttle === 1, 'W ahead, Shift + W full' );
let r = helmThrottle( 0, K( { c: true } ), 0.7 );
check( r.cruise === 0.7 && r.throttle === 0.7, 'C while cruising along: holds cruising speed' );
r = helmThrottle( r.cruise, K() );
check( r.throttle === 0.7, 'with W let go the boat keeps going' );
check( helmThrottle( r.cruise, K( { w: true, boost: true } ) ).throttle === 1, 'Shift + W still boosts over it' );
check( helmThrottle( 0, K( { c: true } ), 0.95 ).cruise === 1, 'C at full throttle holds full' );
check( helmThrottle( 0, K( { c: true, boost: true } ) ).cruise === 1, 'Shift + C holds full' );
r = helmThrottle( 0.7, K( { s: true } ) );
check( r.cruise === 0 && r.throttle === - 0.6, 'S turns cruise off and goes astern' );
r = helmThrottle( 0.7, K( { c: true } ) );
check( r.cruise === 0 && r.throttle === 0, 'C again turns it off' );
console.log( fails ? `\n${ fails } failed` : '\nall passed' );
process.exit( fails ? 1 : 0 );
