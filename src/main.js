import './core/BenchSeed.js';
import { App } from './App.js';
import { UI } from './ui/UI.js';
import { AppUI } from './ui/AppUI.js';
import { t } from './i18n/index.js';
import { DEV } from './core/DevMode.js';
import { mountProfile } from './net/StartProfile.js';
import { saveProfile } from './net/Multiplayer.js';

// ?bench runs in background tabs too (automation): rAF does not fire in a hidden page
if ( /[?&]bench\b/.test( location.search ) ) {

	const raf = window.requestAnimationFrame.bind( window ), caf = window.cancelAnimationFrame.bind( window );
	window.requestAnimationFrame = ( cb ) => document.visibilityState === 'hidden' ? setTimeout( () => cb( performance.now() ), 16 ) : raf( cb );
	window.cancelAnimationFrame = ( id ) => ( clearTimeout( id ), caf( id ) );

}

// developer tools stay hidden unless the code is typed (core/DevMode.js)
DEV.init().watch( window );
const ui = new UI();
const app = new App();
window.__ui = ui;

app.init( ( p, text, until ) => ui.setLoading( p, text, until ) ).then( async () => {

	app.ui = new AppUI( app, ui );
	ui.setLoading( 1, t( 'Ready' ) );
	await ui.hideLoader();
	// frame-time benchmark and reference shots (see core/Bench.js): it drives the frames itself
	if ( app.qs.has( 'bench' ) ) {

		window.__bench = new ( await import( './core/Bench.js' ) ).Bench( app );
		if ( app.qs.has( 'auto' ) ) window.__job = window.__bench.auto( app.qs.get( 'auto' ), { runs: Number( app.qs.get( 'runs' ) ) || 1 } );
		// ?bench&shots=view1,view2[&tag=name][&dt=seconds][&seq=n&every=frames]: reference shots of the named views only (core/DebugViews.js; dt > 0: the clock runs, e.g. for the eased lens flare)
		// &wdbg=N: the water shader's debug view (WaterMaterial debugMode) in the shots
		if ( app.qs.has( 'wdbg' ) && app.waterMaterial ) app.waterMaterial.debugMode.value = Number( app.qs.get( 'wdbg' ) );
		if ( app.qs.has( 'shots' ) ) window.__job = window.__bench.shots( app.qs.get( 'shots' ).split( ',' ), { tag: app.qs.get( 'tag' ) || 'shot', dt: Number( app.qs.get( 'dt' ) ) || 0, seq: Number( app.qs.get( 'seq' ) ) || 1, every: Number( app.qs.get( 'every' ) ) || 1 } );

	} else app.start();
	// who you are at sea: asked on the start screen, and the game goes online as it starts
	const inner = ui.startEl.querySelector( '.tw-start-inner' );
	const profile = app.qs.has( 'noNet' ) || app.qs.has( 'bench' ) ? null : mountProfile( inner, inner.querySelector( '.tw-start-cta' ) );
	ui.showStartOverlay( () => {

		app.input.requestLock();
		if ( app.audio ) app.audio.resume();
		if ( profile ) {

			const me = profile.get();
			saveProfile( me );
			app.playing = true;
			if ( app.net && ! [ 'online', 'connecting' ].includes( app.net.status ) ) app.net.connect( me );

		}

	} );

} ).catch( ( e ) => {

	console.error( e );
	ui.setLoadingError( startupError( e ) );

} );

// what the player can do about it: most failures are a browser or GPU without WebGPU
function startupError( e ) {

	if ( ! navigator.gpu ) return t( 'This browser does not support WebGPU. Open the game in a recent Chrome, Edge or Safari.' );
	if ( /No WebGPU adapter/.test( e && e.message ) ) return t( 'No graphics card is available to WebGPU. Turn on hardware acceleration in the browser settings, or update the graphics driver.' );
	return t( 'Something went wrong: ' ) + ( e && e.message );

}
