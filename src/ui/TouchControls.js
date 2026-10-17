import { t } from '../i18n/index.js';

// Touch controls for phones and tablets: a thumb stick on the left half of the screen (walk, swim,
// steer), dragging on the right half to look round, and buttons on the right for what you can do now
// (cast and reel, jump, dive, cruise, camera, get unstuck) plus a row along the top (cooler, map, chat,
// settings, full screen). Tapping the prompt at the bottom does what it says (board, take the helm,
// talk to a trader...).
//
// It plays the keyboard and mouse: the stick and buttons send the same key events a keyboard would
// (so everything listening for keys, the chat and the settings included, works unchanged), the cast
// button holds the left mouse button and "reel in" clicks the right one, and looking adds to Input.look.
//   if ( touchWanted() ) app.touch = new TouchControls( ui.root, app.input );   ...   app.touch.update( app )
// stickKeys() is pure (test/touch.mjs).

// how far the thumb moves the stick (CSS px) and how far into that it starts walking / runs
export const STICK_R = 54;
const DEAD = 0.22;
const RUN = 0.9;
// look: radians per CSS px are Input's 0.0022 x this (a swipe across a phone turns about 120 degrees)
export const LOOK_GAIN = 2.4;

// ?touch=1 / ?touch=0 force it; otherwise a device whose main pointer is a finger
export function touchWanted( search = typeof location !== 'undefined' ? location.search : '' ) {

	const m = /[?&]touch=([01])/.exec( search );
	if ( m ) return m[ 1 ] === '1';
	if ( typeof matchMedia === 'undefined' || typeof navigator === 'undefined' ) return false;
	return ( navigator.maxTouchPoints || 0 ) > 0 && matchMedia( '(pointer: coarse)' ).matches;

}

// the keys the stick holds at an offset (dx right, dy down, CSS px): W A S D in eight directions, Shift
// at the edge
export function stickKeys( dx, dy, r = STICK_R ) {

	const keys = new Set();
	const m = Math.hypot( dx, dy ) / r;
	if ( m < DEAD ) return keys;
	const deg = Math.atan2( dx, - dy ) * 180 / Math.PI; // 0 up, 90 right
	if ( Math.abs( deg ) < 67.5 ) keys.add( 'KeyW' );
	if ( Math.abs( deg ) > 112.5 ) keys.add( 'KeyS' );
	if ( deg > 22.5 && deg < 157.5 ) keys.add( 'KeyD' );
	if ( deg < - 22.5 && deg > - 157.5 ) keys.add( 'KeyA' );
	if ( m > RUN ) keys.add( 'ShiftLeft' );
	return keys;

}

// what the key events carry as `key`
const KEY_OF = { KeyL: 'l', KeyW: 'w', KeyA: 'a', KeyS: 's', KeyD: 'd', KeyE: 'e', KeyR: 'r', KeyC: 'c', KeyV: 'v', KeyB: 'b', KeyI: 'i', KeyM: 'm', Space: ' ', ShiftLeft: 'Shift', Escape: 'Escape', Enter: 'Enter' };
// a prompt's key as shown ('E', 'Space') -> its code
export const codeOfPrompt = ( k ) => ( k === 'Space' ? 'Space' : k === 'Esc' ? 'Escape' : /^[A-Z]$/.test( k || '' ) ? 'Key' + k : null );

const ICON = {
	bag: '<path d="M6 8h12l-1 12H7L6 8Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
	map: '<path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2V6Z"/><path d="M9 4v14M15 6v14"/>',
	chat: '<path d="M4 5h16v11H9l-5 4V5Z"/>',
	gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>',
	full: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>',
	light: '<path d="M9 3h6l-1 6h-4L9 3Z"/><path d="M10 9v11h4V9"/><path d="M4 6l2 1M20 6l-2 1M12 1v0"/>',
};
const svg = ( p ) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ p }</svg>`;

const CSS = `
.tw-touch { position: absolute; inset: 0; pointer-events: none; touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
.tw-touch * { -webkit-tap-highlight-color: transparent; }
.tw-root.is-starting .tw-touch, .tw-root.is-photo .tw-touch, .tw-root[data-panel="open"] .tw-touch { display: none; }
.tw-touch-pad { pointer-events: auto; }
.tw-touch.is-window .tw-touch-pad, .tw-touch.is-window .tw-touch-top { display: none; }
.tw-touch .tw-tb { pointer-events: auto; }
.tw-touch-stick { position: absolute; width: ${ STICK_R * 2 + 28 }px; height: ${ STICK_R * 2 + 28 }px; margin: -${ STICK_R + 14 }px 0 0 -${ STICK_R + 14 }px;
	border-radius: 50%; border: 2px solid rgba(255,255,255,0.28); background: radial-gradient(circle, rgba(8,18,26,0.12), rgba(8,18,26,0.32));
	pointer-events: none; opacity: 0.55; transition: opacity 200ms; }
.tw-touch-stick.is-on { opacity: 1; }
.tw-touch-knob { position: absolute; left: 50%; top: 50%; width: 52px; height: 52px; margin: -26px 0 0 -26px; border-radius: 50%;
	background: rgba(255,255,255,0.78); box-shadow: 0 2px 10px rgba(0,0,0,0.35); }
.tw-touch-btns { position: absolute; right: calc(env(safe-area-inset-right, 0px) + 18px); bottom: 18px; display: grid; grid-template-columns: repeat(3, auto); gap: 12px;
	align-items: end; justify-items: center; direction: rtl; }
.tw-tb { direction: ltr; display: grid; place-items: center; width: 58px; height: 58px; border-radius: 50%; border: 0; padding: 0;
	font: 700 13px/1.1 var(--tw-font, system-ui); color: #fff; background: rgba(8,18,26,0.5); box-shadow: inset 0 0 0 2px rgba(255,255,255,0.32);
	backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); text-shadow: 0 1px 2px rgba(0,0,0,0.5); text-align: center; }
.tw-tb[hidden] { display: none; }
.tw-tb.is-main { width: 84px; height: 84px; font-size: 16px; background: rgba(95,211,207,0.42); box-shadow: inset 0 0 0 2px rgba(255,255,255,0.55); }
.tw-tb.is-down { background: rgba(95,211,207,0.75); transform: scale(0.94); }
.tw-tb.is-hot { animation: tw-tb-hot 700ms ease-in-out infinite alternate; }
@keyframes tw-tb-hot { to { background: rgba(255,170,90,0.8); } }
.tw-touch-top { position: absolute; top: calc(var(--tw-edge, 16px) + 50px); right: calc(env(safe-area-inset-right, 0px) + var(--tw-edge, 16px)); display: flex; gap: 8px; }
.tw-touch-top .tw-tb { width: 42px; height: 42px; }
.tw-touch-top .tw-tb svg { width: 20px; height: 20px; }
.tw-touch-tip { position: absolute; left: 50%; top: 40%; transform: translate(-50%, -50%); max-width: 80vw; padding: 14px 18px; border-radius: 14px;
	background: rgba(8,18,26,0.78); color: #fff; font: 600 15px/1.5 var(--tw-font, system-ui); text-align: center; pointer-events: none; }
.tw-touch-tip[hidden] { display: none; }
/* the HUD around the controls: the prompt is a button, the hints for keys go, the minimap moves up */
.tw-root.is-touch .tw-prompt { pointer-events: auto; cursor: pointer; bottom: 20px; padding: 10px 18px; font-size: 15px; }
.tw-root.is-touch .tw-prompt-key, .tw-root.is-touch .tw-keys-hint { display: none; }
.tw-root.is-touch .tw-touch-hint { display: inline; }
.tw-root.is-touch .gm-map { top: calc(var(--tw-edge) + 102px); bottom: auto; width: 104px; height: 104px; }
.tw-root.is-touch .tw-boat { left: 50%; bottom: 12px; transform-origin: 50% 100%; scale: 0.55; translate: -50% 0; }
.tw-root.is-touch:has(.tw-boat.is-on) .tw-prompt { bottom: 112px; }
.tw-root.is-touch .tw-brand-name { display: none; }
.tw-root.is-touch .np-chat { bottom: 176px; width: min(360px, 38vw); }
.tw-root.is-touch .tw-toasts { top: calc(var(--tw-edge) + 54px); }
.tw-root.is-touch .gm-coach { left: calc(env(safe-area-inset-left, 0px) + var(--tw-edge)); right: auto; top: calc(var(--tw-edge) + 50px); bottom: auto; width: min(320px, 40vw); }
.tw-root.is-touch .np-chat-hint { display: none; }
.tw-root.is-touch .tw-tl .tw-stats { display: none; }
`;

const el = ( tag, cls, html ) => {

	const e = document.createElement( tag );
	if ( cls ) e.className = cls;
	if ( html ) e.innerHTML = html;
	return e;

};

export class TouchControls {

	// root: the UI root (.tw-root); input: core/Input
	constructor( root, input, { chat = () => false } = {} ) {

		this.root = root;
		this.input = input;
		this.chat = chat; // () => true when the chat can open (online)
		this.held = new Set(); // codes this layer holds down
		this.stick = null; // { id, x0, y0 }
		this.looks = new Map(); // pointerId -> { x, y }
		input.touch = true;

		const style = el( 'style' );
		style.textContent = CSS;
		document.head.append( style );
		root.classList.add( 'is-touch' );

		this.el = el( 'div', 'tw-touch' );
		this.pad = el( 'div', 'tw-touch-pad' );
		this.pad.style.cssText = 'position:absolute;inset:0';
		this.stickEl = el( 'div', 'tw-touch-stick', '<div class="tw-touch-knob"></div>' );
		this.knob = this.stickEl.firstChild;
		this.btns = el( 'div', 'tw-touch-btns' );
		this.top = el( 'div', 'tw-touch-top' );
		this.tip = el( 'div', 'tw-touch-tip' );
		this.tip.hidden = true;
		this.pad.append( this.stickEl, this.btns );
		this.el.append( this.pad, this.top, this.tip );
		// under the HUD's own panels (the settings, the cooler, a trader) so those stay on top
		const hud = root.querySelector( '.tw-hud' );
		if ( hud ) hud.before( this.el );
		else root.append( this.el );
		this._restStick();

		// the right-hand buttons: [ id, label, how ] where how is a key code, 'lmb' (held) or 'rmb' (a click)
		this.b = {};
		const add = ( id, how, main = false ) => {

			const b = el( 'button', 'tw-tb' + ( main ? ' is-main' : '' ) );
			b.type = 'button';
			b.hidden = true;
			b.dataset.id = id;
			this.btns.append( b );
			this.b[ id ] = { el: b, how, label: '' };
			this._bindHold( b, ( down ) => this._press( this.b[ id ].how, down ) );

		};
		// grid fills right to left from the bottom right: main first
		add( 'main', 'lmb', true );
		add( 'jump', 'Space' );
		add( 'rod', 'KeyR' );
		add( 'reel', 'rmb' );
		add( 'dive', 'KeyC' );
		add( 'cruise', 'KeyC' );
		add( 'view', 'KeyV' );
		add( 'rescue', 'KeyB' );

		const topBtn = ( icon, code, title ) => {

			const b = el( 'button', 'tw-tb', svg( ICON[ icon ] ) );
			b.type = 'button';
			b.setAttribute( 'aria-label', title );
			b.addEventListener( 'click', () => ( code === 'full' ? this.fullscreen( ! document.fullscreenElement ) : this.tap( code ) ) );
			this.top.append( b );
			return b;

		};
		topBtn( 'bag', 'KeyI', t( 'Cooler' ) );
		topBtn( 'map', 'KeyM', t( 'Map' ) );
		this.chatBtn = topBtn( 'chat', 'Enter', t( 'Chat' ) );
		topBtn( 'light', 'KeyL', t( 'Flashlight' ) );
		topBtn( 'gear', 'Escape', t( 'Settings' ) );
		if ( typeof document !== 'undefined' && document.fullscreenEnabled ) topBtn( 'full', 'full', t( 'Full screen' ) );

		// the prompt is a button: it presses the key it shows
		this.promptEl = root.querySelector( '.tw-prompt' );
		this.promptCode = null;
		if ( this.promptEl ) this.promptEl.addEventListener( 'click', () => this.promptCode && this.tap( this.promptCode ) );

		// stick (left half) and look (right half) on the pad itself
		this.pad.addEventListener( 'pointerdown', ( e ) => this._down( e ) );
		this.pad.addEventListener( 'pointermove', ( e ) => this._move( e ) );
		for ( const ev of [ 'pointerup', 'pointercancel', 'lostpointercapture' ] ) this.pad.addEventListener( ev, ( e ) => this._up( e ) );
		// a phone gesture must not scroll, zoom or bring up the text menu
		this.el.addEventListener( 'touchstart', ( e ) => e.target.closest( 'button' ) || e.preventDefault(), { passive: false } );
		this.el.addEventListener( 'contextmenu', ( e ) => e.preventDefault() );
		window.addEventListener( 'blur', () => this.releaseAll() );

		// portrait: say once that the game plays sideways
		this._portrait = typeof matchMedia !== 'undefined' ? matchMedia( '(orientation: portrait)' ) : null;

	}

	// ---- input out

	key( code, down ) {

		if ( down ) this.held.add( code );
		else this.held.delete( code );
		window.dispatchEvent( new KeyboardEvent( down ? 'keydown' : 'keyup', { code, key: KEY_OF[ code ] || code, bubbles: true, cancelable: true } ) );

	}

	tap( code ) {

		this.key( code, true );
		this.key( code, false );

	}

	_press( how, down ) {

		const inp = this.input;
		if ( how === 'lmb' ) inp.mouseDown = down;
		else if ( how === 'rmb' ) {

			// a click: down now, up next frame (Game looks for the edge)
			if ( down ) {

				inp.rightDown = true;
				this._rmbUp = 2;

			}

		} else if ( how ) {

			// held keys stay down while the finger does (swim up, dive); taps are a press and release
			if ( down ) this.key( how, true );
			else if ( this.held.has( how ) ) this.key( how, false );

		}

	}

	releaseAll() {

		for ( const c of [ ...this.held ] ) this.key( c, false );
		this.input.mouseDown = false;
		this.input.rightDown = false;
		this.stick = null;
		this.looks.clear();
		this._restStick();
		for ( const b of Object.values( this.b || {} ) ) b.el.classList.remove( 'is-down' );

	}

	_bindHold( b, fn ) {

		let id = null;
		b.addEventListener( 'pointerdown', ( e ) => {

			e.preventDefault();
			e.stopPropagation();
			if ( id !== null ) return;
			id = e.pointerId;
			b.setPointerCapture?.( id );
			b.classList.add( 'is-down' );
			fn( true );

		} );
		const up = ( e ) => {

			if ( e.pointerId !== id ) return;
			id = null;
			b.classList.remove( 'is-down' );
			fn( false );

		};
		b.addEventListener( 'pointerup', up );
		b.addEventListener( 'pointercancel', up );
		b.addEventListener( 'lostpointercapture', up );

	}

	// ---- stick and look

	_down( e ) {

		if ( e.target.closest( 'button' ) ) return;
		e.preventDefault();
		this.pad.setPointerCapture?.( e.pointerId );
		// the catch card covers the screen: a tap anywhere puts the fish away (a click, as with a mouse)
		if ( this._card ) {

			this.input.mouseDown = true;
			this._cardTap = e.pointerId;
			return;

		}

		const w = this.pad.clientWidth || window.innerWidth;
		if ( e.clientX < w * 0.45 && ! this.stick ) {

			this.stick = { id: e.pointerId, x0: e.clientX, y0: e.clientY };
			this.stickEl.style.left = e.clientX + 'px';
			this.stickEl.style.top = e.clientY + 'px';
			this.stickEl.classList.add( 'is-on' );
			this._setStick( 0, 0 );

		} else this.looks.set( e.pointerId, { x: e.clientX, y: e.clientY } );

	}

	_move( e ) {

		const s = this.stick;
		if ( s && e.pointerId === s.id ) {

			let dx = e.clientX - s.x0, dy = e.clientY - s.y0;
			const m = Math.hypot( dx, dy );
			// past the rim the stick follows the thumb, so turning back answers at once
			if ( m > STICK_R ) {

				const k = ( m - STICK_R ) / m;
				s.x0 += dx * k;
				s.y0 += dy * k;
				dx *= 1 - k;
				dy *= 1 - k;
				this.stickEl.style.left = s.x0 + 'px';
				this.stickEl.style.top = s.y0 + 'px';

			}

			this._setStick( dx, dy );
			return;

		}

		const l = this.looks.get( e.pointerId );
		if ( l ) {

			this.input.look.x += ( e.clientX - l.x ) * LOOK_GAIN;
			this.input.look.y += ( e.clientY - l.y ) * LOOK_GAIN;
			l.x = e.clientX;
			l.y = e.clientY;

		}

	}

	_up( e ) {

		if ( e.pointerId === this._cardTap ) {

			this._cardTap = null;
			this.input.mouseDown = false;

		}

		if ( this.stick && e.pointerId === this.stick.id ) {

			this.stick = null;
			this._setStick( 0, 0 );
			this._restStick();

		}

		this.looks.delete( e.pointerId );

	}

	_setStick( dx, dy ) {

		this.knob.style.transform = `translate(${ dx }px, ${ dy }px)`;
		const want = stickKeys( dx, dy );
		for ( const c of [ 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft' ] ) {

			const on = !! this._stickHeld && this._stickHeld.has( c );
			if ( want.has( c ) && ! on ) this.key( c, true );
			else if ( ! want.has( c ) && on ) this.key( c, false );

		}

		this._stickHeld = want;

	}

	_restStick() {

		this.stickEl.classList.remove( 'is-on' );
		this.stickEl.style.left = 'calc(env(safe-area-inset-left, 0px) + 96px)';
		this.stickEl.style.top = 'calc(100% - 96px)';
		this.knob.style.transform = '';

	}

	// ---- per frame: which buttons show, and what they say

	_show( id, label, opts = {} ) {

		const b = this.b[ id ];
		if ( ! b ) return;
		if ( opts.how ) b.how = opts.how;
		b.el.hidden = false;
		if ( b.label !== label ) {

			b.label = label;
			b.el.textContent = label;

		}

		b.el.classList.toggle( 'is-hot', !! opts.hot );
		this._shown.add( id );

	}

	// app: the running App (player, game, boat), or a stand-in with the same fields (test/touch.html)
	update( app ) {

		if ( this._rmbUp && -- this._rmbUp === 0 ) this.input.rightDown = false;
		this._shown = new Set();
		const p = app.player || {}, g = app.game || {}, rod = g.rod || {}, boat = app.boatCtl || {};
		const mode = p.mode;
		const fight = !! g.fight;
		const landing = !! ( g.landing && g.landing.shown );
		this._card = landing;
		// a game window (the cooler, a trader, the map, the chat line) takes the screen: no stick or buttons
		const hud = g.hud;
		const windowOpen = !! ( ( hud && ( hud.invOpen || hud.standOpen ) ) || g.mapOpen || ( app.net && app.net.chat && app.net.chat.open ) );
		if ( windowOpen !== this._windowOpen ) {

			this._windowOpen = windowOpen;
			this.el.classList.toggle( 'is-window', windowOpen );
			if ( windowOpen ) this.releaseAll();

		}

		if ( landing ) this._show( 'main', t( 'Keep it' ), { how: 'lmb' } );
		else if ( rod.equipped && ( mode === 'walk' || mode === 'deck' ) ) {

			const st = rod.state;
			if ( fight ) this._show( 'main', t( 'Hold to reel' ), { how: 'lmb', hot: true } );
			else if ( st === 'windup' ) this._show( 'main', t( 'Let go to cast' ), { how: 'lmb' } );
			else if ( st === 'floating' ) this._show( 'main', t( 'Strike' ), { how: 'lmb', hot: !! g.bite } );
			else if ( st === 'flying' || st === 'landing' ) this._show( 'main', '…', { how: null } );
			else this._show( 'main', t( 'Cast' ), { how: 'lmb' } );
			if ( st === 'floating' || st === 'flying' ) this._show( 'reel', t( 'Take the line in' ) );
			if ( ! fight && st !== 'floating' && st !== 'flying' ) this._show( 'rod', t( 'Stow rod' ) );
			if ( st === 'idle' ) this._show( 'jump', t( 'Jump' ), { how: 'Space' } );

		} else if ( mode === 'walk' || mode === 'deck' ) {

			this._show( 'main', t( 'Jump' ), { how: 'Space' } );
			if ( g.canFish !== false ) this._show( 'rod', t( 'Rod' ) );

		} else if ( mode === 'swim' ) {

			this._show( 'main', t( 'Swim up' ), { how: 'Space' } );
			this._show( 'dive', t( 'Dive' ) );

		} else if ( mode === 'boat' ) {

			const sail = boat.sailArea > 0, cruise = !! p.cruise;
			this._show( 'cruise', sail ? t( cruise ? 'Lower sails' : 'Keep sails up' ) : t( cruise ? 'Cruise off' : 'Cruise' ) );
			this._show( 'view', t( 'View' ) );
			if ( g._stuckSaid ) this._show( 'rescue', t( 'Get unstuck' ), { hot: true } );

		}

		for ( const [ id, b ] of Object.entries( this.b ) ) {

			if ( this._shown.has( id ) || b.el.hidden ) continue;
			b.el.hidden = true;
			// a button that goes away under the finger lets go of what it held
			if ( b.el.classList.contains( 'is-down' ) ) {

				b.el.classList.remove( 'is-down' );
				this._press( b.how, false );

			}

		}

		// the prompt button presses the prompt's key
		this.promptCode = p.prompt ? codeOfPrompt( p.prompt.key ) : null;
		this.chatBtn.hidden = ! this.chat();

		// portrait: the game plays sideways
		const portrait = !! ( this._portrait && this._portrait.matches );
		if ( portrait !== this._wasPortrait ) {

			this._wasPortrait = portrait;
			this.tip.textContent = t( 'Turn your phone sideways to play' );
			this.tip.hidden = ! portrait;

		}

	}

	// the start tap: full screen and sideways where the browser allows (Android; not iPhone Safari)
	fullscreen( on = true ) {

		try {

			if ( on && ! document.fullscreenElement && document.documentElement.requestFullscreen ) {

				const r = document.documentElement.requestFullscreen( { navigationUI: 'hide' } );
				if ( r && r.then ) r.then( () => screen.orientation?.lock?.( 'landscape' ).catch( () => {} ) ).catch( () => {} );

			} else if ( ! on && document.fullscreenElement ) document.exitFullscreen().catch( () => {} );

		} catch ( e ) { /* not allowed here */ }

	}

}
