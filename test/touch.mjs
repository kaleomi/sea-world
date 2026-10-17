// Touch controls (src/ui/TouchControls.js): the thumb stick's keys and the prompt keys. Pure, no DOM.
import { stickKeys, codeOfPrompt, touchWanted, STICK_R } from '../src/ui/TouchControls.js';

let fails = 0;
const check = ( ok, msg ) => {

	console.log( ( ok ? 'ok   ' : 'FAIL ' ) + msg );
	if ( ! ok ) fails ++;

};

const keys = ( dx, dy ) => [ ...stickKeys( dx, dy ) ].sort().join( ' ' );
const R = STICK_R;
check( keys( 0, 0 ) === '' && keys( 0.15 * R, 0 ) === '', 'a resting or barely touched stick holds nothing' );
check( keys( 0, - 0.6 * R ) === 'KeyW', 'up walks forward' );
check( keys( 0, 0.6 * R ) === 'KeyS', 'down walks back' );
check( keys( 0.6 * R, 0 ) === 'KeyD' && keys( - 0.6 * R, 0 ) === 'KeyA', 'sideways strafes (steers at the helm)' );
check( keys( 0.45 * R, - 0.45 * R ) === 'KeyD KeyW', 'a diagonal holds both' );
check( keys( 0.2 * R, - 0.6 * R ) === 'KeyW', 'a little off straight ahead is still straight ahead' );
check( keys( 0, - R ) === 'KeyW ShiftLeft', 'pushed to the rim runs (flat out at the helm)' );
check( keys( - R, 0 ) === 'KeyA ShiftLeft', 'the rim runs in any direction' );
// every direction round the circle gives one or two of W A S D, never opposites
let ok = true;
for ( let a = 0; a < 360; a += 3 ) {

	const s = stickKeys( Math.sin( a * Math.PI / 180 ) * 0.7 * R, - Math.cos( a * Math.PI / 180 ) * 0.7 * R );
	if ( s.size < 1 || s.size > 2 || ( s.has( 'KeyW' ) && s.has( 'KeyS' ) ) || ( s.has( 'KeyA' ) && s.has( 'KeyD' ) ) ) ok = false;

}

check( ok, 'all round the stick: one or two keys, never opposites' );
check( codeOfPrompt( 'E' ) === 'KeyE' && codeOfPrompt( 'Space' ) === 'Space' && codeOfPrompt( 'Esc' ) === 'Escape' && codeOfPrompt( '' ) === null, 'a prompt\'s key as shown -> the key code it presses' );
check( touchWanted( '?touch=1' ) === true && touchWanted( '?a=2&touch=0' ) === false, '?touch=1 / ?touch=0 force the controls on or off' );
check( touchWanted( '' ) === false, 'no touch screen (node): off' );

console.log( fails ? `\n${ fails } FAILED` : '\nall ok' );
process.exit( fails ? 1 : 0 );
