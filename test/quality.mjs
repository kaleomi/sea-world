// Graphics quality (src/core/Quality.js): the start level from the graphics card, stepping down while the
// game runs slowly (auto mode only), and starting lower after the GPU was lost.
import { Quality, startLevel, nextLevel, presetFor, loadQuality, SLOW_FPS } from '../src/core/Quality.js';

let fails = 0;
const check = ( ok, msg ) => {

	console.log( ( ok ? 'ok   ' : 'FAIL ' ) + msg );
	if ( ! ok ) fails ++;

};

const mem = {};
globalThis.localStorage = { getItem: ( k ) => mem[ k ] ?? null, setItem: ( k, v ) => { mem[ k ] = String( v ); } };

check( startLevel( { vendor: 'nvidia', architecture: 'turing' } ) === 'high', 'an NVIDIA card starts high' );
check( startLevel( { vendor: 'intel', architecture: 'gen-12lp' } ) === 'medium', 'Intel graphics start medium' );
check( startLevel( { vendor: 'google', architecture: 'swiftshader', isFallbackAdapter: true } ) === 'low', 'a software adapter starts low' );
check( startLevel( {} ) === 'medium', 'an unknown card starts medium' );
check( startLevel( { vendor: 'qualcomm', architecture: 'adreno-7xx' } ) === 'low' && startLevel( { vendor: 'arm', architecture: 'valhall', description: 'Mali-G710' } ) === 'low', 'phone GPUs (Adreno, Mali) start low' );
check( startLevel( { vendor: 'apple', architecture: 'common-3' }, true ) === 'low' && startLevel( { vendor: 'apple', architecture: 'common-3' } ) === 'medium', 'an iPhone starts low, a Mac medium' );
check( nextLevel( 'high' ) === 'medium' && nextLevel( 'medium' ) === 'low' && nextLevel( 'low' ) === 'low', 'levels step down high → medium → low' );
check( presetFor( 'low' ).renderScale < presetFor( 'medium' ).renderScale && presetFor( 'medium' ).renderScale < presetFor( 'high' ).renderScale, 'lower levels render fewer pixels' );
check( ! presetFor( 'low' ).shadows && ! presetFor( 'low' ).ao && ! presetFor( 'low' ).ssr, 'low turns off shadows, AO and water reflections' );

// a stand-in app with the switches Quality drives
const fakeApp = () => ( {
	settings: {}, setRenderScale( v ) { this.settings.renderScale = v; },
	clouds: { resolutionScale: 1 }, shadows: { enabled: true }, waterMaterial: { params: { ssr: { value: 1 } } }, post: { aoEnabled: true },
} );

let app = fakeApp();
let q = new Quality( app, { vendor: 'nvidia' } );
q.apply();
check( q.mode === 'auto' && q.level === 'high' && app.settings.renderScale === 1, 'fresh start: auto, high on this card' );
let changed = null;
q.onChange = ( l ) => { changed = l; };
for ( let i = 0; i < 60 * 12; i ++ ) q.update( 1 / 60 );
check( q.level === 'high' && ! changed, '60 fps keeps the level' );
for ( let i = 0; i < 15 * 12; i ++ ) q.update( 1 / 15 );
check( q.level === 'medium' && changed === 'medium' && app.settings.renderScale === 0.75, `15 fps (< ${ SLOW_FPS }) steps down to medium` );
for ( let i = 0; i < 15 * 30; i ++ ) q.update( 1 / 15 );
check( q.level === 'low' && ! app.shadows.enabled && ! app.post.aoEnabled && app.waterMaterial.params.ssr.value === 0, 'still slow: low, with shadows, AO and reflections off' );
check( loadQuality().level === 'low', 'the level reached is remembered' );

// a chosen level never changes by itself
q.set( 'high' );
for ( let i = 0; i < 15 * 30; i ++ ) q.update( 1 / 15 );
check( q.level === 'high' && app.shadows.enabled, 'a chosen level stays, however slow' );
app = fakeApp();
q = new Quality( app, {} );
check( q.mode === 'high' && q.level === 'high', 'the choice is remembered on the next load' );

// the GPU was lost: the next load starts lower, in auto mode
q.onDeviceLost();
q = new Quality( fakeApp(), { vendor: 'nvidia' } );
check( q.mode === 'auto' && q.level === 'medium', 'after a lost GPU the next load starts a level lower' );

console.log( fails ? `\n${ fails } failed` : '\nall passed' );
process.exit( fails ? 1 : 0 );
