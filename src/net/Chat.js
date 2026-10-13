import { MAX_CHAT } from './Protocol.js';
import { t } from '../i18n/index.js';

// Chat with the others on the shared sea, lower left. Enter opens the line (Enter sends it, Esc
// drops it); the last lines stay up for a while and all of them show while the line is open. Joins,
// leaves and the link's state come in as grey system lines.
//   const chat = new Chat( hudEl, net );  chat.add( name, text, color, mine );  chat.system( text );  chat.open
const KEEP = 40; // lines kept
const SHOW = 7; // lines shown when the line is closed
const FADE_MS = 14000; // a line fades this long after it came in

const CSS = /* css */`
.np-chat { position: absolute; left: var(--tw-edge, 16px); bottom: calc(var(--tw-edge, 16px) + 8px); width: min(420px, 42vw); pointer-events: none;
	display: flex; flex-direction: column; gap: 6px; font: 500 13px/1.4 var(--tw-font, system-ui); z-index: 6; transition: bottom 300ms ease; }
.tw-root:has(.tw-boat.is-on) .np-chat { bottom: calc(var(--tw-edge, 16px) + 172 * var(--tw-u, 1px)); }
.np-chat-log { display: flex; flex-direction: column; gap: 3px; }
.np-chat-line { align-self: flex-start; max-width: 100%; padding: 4px 10px; border-radius: 10px; color: #fff; background: rgba(8, 18, 26, 0.5);
	text-shadow: 0 1px 2px rgba(0,0,0,0.6); overflow-wrap: anywhere; transition: opacity 900ms ease; }
.np-chat-line b { font-weight: 700; margin-right: 6px; }
.np-chat-line.is-sys { color: rgba(255,255,255,0.75); font-style: italic; }
.np-chat-line.is-old { opacity: 0; }
.np-chat:not(.is-open) .np-chat-line.is-hid { display: none; }
.np-chat.is-open .np-chat-line { opacity: 1; }
.np-chat.is-open .np-chat-log { max-height: 40vh; overflow-y: auto; pointer-events: auto; }
.np-chat-row { display: none; pointer-events: auto; }
.np-chat.is-open .np-chat-row { display: flex; }
.np-chat-row input { flex: 1; min-width: 0; padding: 8px 12px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.25); outline: none;
	font: inherit; color: #fff; background: rgba(8, 18, 26, 0.78); }
.np-chat-row input:focus { border-color: var(--tw-aqua, #5fd3cf); }
.np-chat-hint { margin-left: 8px; align-self: center; color: rgba(255,255,255,0.7); font-size: 12px; white-space: nowrap; text-shadow: 0 1px 2px rgba(0,0,0,0.7); }
@media (max-width: 640px) { .np-chat { width: calc(100vw - 2 * var(--tw-edge, 16px)); bottom: 150px; } }
`;

export class Chat {

	// net: Multiplayer (say( text ), status); canOpen: () => false while something else owns Enter
	constructor( parent, net, { canOpen = () => true } = {} ) {

		this.net = net;
		this.canOpen = canOpen;
		const style = document.createElement( 'style' );
		style.textContent = CSS;
		document.head.append( style );
		this.el = document.createElement( 'div' );
		this.el.className = 'np-chat';
		this.el.innerHTML = `<div class="np-chat-log"></div><div class="np-chat-row"><input type="text" maxlength="${ MAX_CHAT }" autocomplete="off" spellcheck="false"><span class="np-chat-hint">${ t( 'Enter to send · Esc to cancel' ) }</span></div>`;
		this.log = this.el.firstChild;
		this.input = this.el.querySelector( 'input' );
		this.input.placeholder = t( 'Say something to everyone at sea…' );
		parent.append( this.el );
		this.open = false;
		this.lines = [];

		this.input.addEventListener( 'keydown', ( e ) => {

			// the line keeps its keys: nothing else in the game sees them
			e.stopPropagation();
			if ( e.key === 'Enter' && ! e.isComposing ) {

				e.preventDefault();
				const text = this.input.value;
				if ( text.trim() && ! this.net.say( text ) ) this.system( t( 'Not connected to the shared sea yet' ) );
				this.close();

			} else if ( e.key === 'Escape' ) {

				e.preventDefault();
				this.close();

			}

		} );
		this.input.addEventListener( 'keyup', ( e ) => e.stopPropagation() );
		window.addEventListener( 'keydown', ( e ) => {

			if ( e.key !== 'Enter' || e.repeat || this.open || e.isComposing ) return;
			const el = e.target;
			if ( el && ( el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.tagName === 'BUTTON' || el.isContentEditable ) ) return;
			if ( ! this.canOpen() ) return;
			e.preventDefault();
			this.show();

		} );
		this._timer = setInterval( () => this._fade(), 1000 );

	}

	show() {

		this.open = true;
		this.el.classList.add( 'is-open' );
		this.input.value = '';
		this.input.focus();
		this.log.scrollTop = this.log.scrollHeight;

	}

	close() {

		this.open = false;
		this.el.classList.remove( 'is-open' );
		this.input.value = '';
		this.input.blur();
		this._fade();

	}

	// a line from a player (mine: ours)
	add( name, text, color = '#fff', mine = false ) {

		const line = document.createElement( 'div' );
		line.className = 'np-chat-line' + ( mine ? ' is-mine' : '' );
		const who = document.createElement( 'b' );
		who.style.color = color;
		who.textContent = name;
		line.append( who, document.createTextNode( text ) );
		this._push( line );

	}

	system( text ) {

		const line = document.createElement( 'div' );
		line.className = 'np-chat-line is-sys';
		line.textContent = text;
		this._push( line );

	}

	_push( line ) {

		line._at = performance.now();
		this.log.append( line );
		this.lines.push( line );
		while ( this.lines.length > KEEP ) this.lines.shift().remove();
		this.log.scrollTop = this.log.scrollHeight;
		this._fade();

	}

	// lines older than FADE_MS, and all but the last SHOW, fade out (all show while the line is open)
	_fade() {

		const now = performance.now(), n = this.lines.length;
		this.lines.forEach( ( l, i ) => {

			l.classList.toggle( 'is-hid', i < n - SHOW );
			l.classList.toggle( 'is-old', now - l._at > FADE_MS );

		} );

	}

}
