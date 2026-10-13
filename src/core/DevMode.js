// Developer mode: the tools a player never needs (the sea, shore and sky settings, the free camera on F,
// pausing time on T, the settings rail). Typing the code anywhere in the game (not in a text field)
// turns it on or off; it is remembered in localStorage 'tidewater.dev'. ?dev (and the harness's ?bench /
// ?fly) turn it on for one load. Once the first two letters of the code are typed quickly, the rest of
// it is kept from the game, so typing it doesn't also open the map (m), the cooler (i) or mute (n).
//   import { DEV } from './core/DevMode.js';
//   DEV.on                       is it on
//   DEV.onChange( ( on ) => … )  told when it flips
//   DEV.watch( window )          listen for the code (once, at startup)
export const DEV_CODE = 'admintest';
const KEY = 'tidewater.dev';

const store = () => {

	try {

		return typeof localStorage !== 'undefined' ? localStorage : null;

	} catch ( e ) {

		return null;

	}

};

export const DEV = {

	on: false,
	_listeners: [],
	_typed: '',
	_last: - Infinity,

	init( search = typeof location !== 'undefined' ? location.search : '' ) {

		let saved = false;
		try {

			saved = store()?.getItem( KEY ) === '1';

		} catch ( e ) { /* no storage */ }

		const q = new URLSearchParams( search );
		this.on = saved || q.has( 'dev' ) || q.has( 'bench' ) || q.has( 'fly' ); // the test harness flies the camera
		return this;

	},

	set( on ) {

		on = !! on;
		if ( on === this.on ) return;
		this.on = on;
		try {

			if ( on ) store()?.setItem( KEY, '1' );
			else store()?.removeItem( KEY );

		} catch ( e ) { /* no storage */ }

		for ( const fn of this._listeners ) fn( on );

	},

	onChange( fn ) {

		this._listeners.push( fn );
		return this;

	},

	// one typed character; returns true when it completed the code (and flipped the mode)
	type( ch ) {

		if ( typeof ch !== 'string' || ch.length !== 1 ) return false;
		this._typed = ( this._typed + ch.toLowerCase() ).slice( - DEV_CODE.length );
		if ( this._typed !== DEV_CODE ) return false;
		this._typed = '';
		this.set( ! this.on );
		return true;

	},

	// a key press at time `now` (ms): types it, and returns true when the game shouldn't see it
	// (the third letter of the code onwards, each typed within GAP ms of the one before)
	consume( ch, now ) {

		if ( typeof ch !== 'string' || ch.length !== 1 ) return false;
		const GAP = 700;
		if ( now - this._last > GAP ) this._typed = '';
		this._last = now;
		const c = ch.toLowerCase();
		let k = 0; // how much of the code the typed text already ends with
		for ( let n = Math.min( this._typed.length, DEV_CODE.length - 1 ); n > 0; n -- ) if ( this._typed.endsWith( DEV_CODE.slice( 0, n ) ) ) {

			k = n;
			break;

		}

		const swallow = k >= 2 && DEV_CODE[ k ] === c;
		this.type( c );
		return swallow;

	},

	watch( target ) {

		target.addEventListener( 'keydown', ( e ) => {

			const el = e.target;
			if ( el && ( el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable ) ) return;
			if ( e.ctrlKey || e.metaKey || e.altKey || e.repeat ) return;
			if ( this.consume( e.key, e.timeStamp || performance.now() ) ) {

				e.preventDefault();
				e.stopImmediatePropagation();

			}

		}, true );
		return this;

	},

};
