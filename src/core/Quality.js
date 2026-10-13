// Graphics quality: three presets a player picks in the settings (Performance tab), or 'auto' (the
// default), which starts from what the graphics card looks like and steps down by itself while the game
// runs too slowly. If the GPU gives up altogether (device lost: out of memory or a driver timeout, which
// shows as a black screen) the next load starts one step lower. Remembered in localStorage
// 'tidewater.quality' as { mode: 'auto' | 'high' | 'medium' | 'low', level: the auto level reached }.
//   const q = new Quality( app );  q.apply()  q.update( dt )  q.set( 'low' )  q.onDeviceLost()
// Pure decisions (presetFor, nextLevel, startLevel) are exported for the tests.

const KEY = 'tidewater.quality';
export const LEVELS = [ 'low', 'medium', 'high' ];

// what each level changes: internal resolution, the cloud march's resolution (fraction of the output),
// sun shadows, screen-space water reflections and ambient occlusion
export const PRESETS = {
	high: { renderScale: 1, clouds: 1, shadows: true, ssr: true, ao: true },
	medium: { renderScale: 0.75, clouds: 0.6, shadows: true, ssr: true, ao: true },
	low: { renderScale: 0.5, clouds: 0.4, shadows: false, ssr: false, ao: false },
};

// auto mode: below this average frame rate over a window, step down one level
export const SLOW_FPS = 24;
const WINDOW = 4; // s
const SETTLE = 6; // s after starting or a change before judging (pipelines, texture bakes, streaming)

export function presetFor( level ) {

	return PRESETS[ level ] || PRESETS.medium;

}

export function nextLevel( level ) {

	const i = LEVELS.indexOf( level );
	return i > 0 ? LEVELS[ i - 1 ] : 'low';

}

// the level auto mode starts at: an NVIDIA or Radeon RX card starts high, everything else (integrated
// graphics, Apple, unknown) medium, software adapters low; auto mode steps down from there if it must
export function startLevel( info = {} ) {

	const s = `${ info.vendor || '' } ${ info.architecture || '' } ${ info.description || '' } ${ info.device || '' }`.toLowerCase();
	if ( info.isFallbackAdapter || /swiftshader|llvmpipe|lavapipe|software|basic render/.test( s ) ) return 'low';
	if ( /nvidia|geforce|rtx|gtx|radeon rx/.test( s ) ) return 'high';
	return 'medium';

}

const store = () => {

	try {

		return typeof localStorage !== 'undefined' ? localStorage : null;

	} catch ( e ) {

		return null;

	}

};

export function loadQuality() {

	try {

		const v = JSON.parse( store()?.getItem( KEY ) || 'null' );
		if ( v && ( v.mode === 'auto' || LEVELS.includes( v.mode ) ) ) return { mode: v.mode, level: LEVELS.includes( v.level ) ? v.level : null };

	} catch ( e ) { /* fresh */ }

	return { mode: 'auto', level: null };

}

function saveQuality( q ) {

	try {

		store()?.setItem( KEY, JSON.stringify( q ) );

	} catch ( e ) { /* private mode */ }

}

export class Quality {

	constructor( app, adapterInfo = {} ) {

		this.app = app;
		const saved = loadQuality();
		this.mode = saved.mode;
		this.level = saved.mode === 'auto' ? ( saved.level || startLevel( adapterInfo ) ) : saved.mode;
		this._t = 0;
		this._acc = 0;
		this._n = 0;
		this.onChange = null; // ( level, reason ) => {}

	}

	get preset() {

		return presetFor( this.level );

	}

	// push the current level into the renderer
	apply() {

		const a = this.app, p = this.preset;
		a.setRenderScale( p.renderScale );
		if ( a.clouds ) a.clouds.resolutionScale = p.renderScale * p.clouds;
		if ( a.shadows ) a.shadows.enabled = p.shadows;
		if ( a.waterMaterial && a.waterMaterial.params && a.waterMaterial.params.ssr ) a.waterMaterial.params.ssr.value = p.ssr ? 1 : 0;
		if ( a.post ) a.post.aoEnabled = p.ao;
		this._t = 0;
		this._acc = 0;
		this._n = 0;

	}

	// the player's choice in the settings: 'auto' or a level
	set( mode ) {

		this.mode = mode === 'auto' || LEVELS.includes( mode ) ? mode : 'auto';
		if ( this.mode !== 'auto' ) this.level = this.mode;
		saveQuality( { mode: this.mode, level: this.level } );
		this.apply();

	}

	// once a frame while playing: in auto mode, a slow stretch steps the level down
	update( dt ) {

		if ( this.mode !== 'auto' || this.level === 'low' || ! ( dt > 0 ) ) return;
		this._t += dt;
		if ( this._t < SETTLE ) return;
		this._acc += Math.min( dt, 0.5 );
		this._n ++;
		if ( this._acc < WINDOW ) return;
		const fps = this._n / this._acc;
		this._acc = 0;
		this._n = 0;
		if ( fps >= SLOW_FPS ) return;
		this.level = nextLevel( this.level );
		saveQuality( { mode: this.mode, level: this.level } );
		this.apply();
		if ( this.onChange ) this.onChange( this.level, 'slow' );

	}

	// the GPU device was lost: the next load starts a level lower (and in auto mode)
	onDeviceLost() {

		const level = nextLevel( this.level );
		saveQuality( { mode: 'auto', level } );
		return level;

	}

}
