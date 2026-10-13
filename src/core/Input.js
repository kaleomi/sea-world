// Keyboard / mouse input with pointer lock support.

// Browsers sometimes report a single mouse move hundreds of pixels long under pointer lock (the cursor
// "warping" back on Windows, right after locking, after a frame hitch), which spun the view round in one
// go. A move that is far bigger than the ones just before it, or arrives just after (un)locking, is
// dropped; ordinary fast flicks build up over several events and pass.
const LOOK_SETTLE_MS = 120; // ignore motion this long after pointer lock changes
const LOOK_SPIKE = 180; // px in one event that counts as a jump...
const LOOK_SPIKE_RATIO = 6; // ...when it is this many times the recent typical move

export function newLookState() {

	return { avg: 0, since: - Infinity };

}

// -> { x, y } to apply, or null to drop the event
export function filterLook( st, dx, dy, now ) {

	if ( ! Number.isFinite( dx ) || ! Number.isFinite( dy ) ) return null;
	if ( now - st.since < LOOK_SETTLE_MS ) return null;
	const m = Math.hypot( dx, dy );
	if ( m > LOOK_SPIKE && m > LOOK_SPIKE_RATIO * Math.max( st.avg, 8 ) ) return null;
	st.avg += ( m - st.avg ) * 0.2;
	return { x: dx, y: dy };

}

export class Input {

	constructor( dom ) {

		this.dom = dom;
		this.keys = new Set();
		this.pressed = new Set();
		this.look = { x: 0, y: 0 };
		this.wheel = 0;
		this.mouseDown = false;
		this.rightDown = false;
		this.locked = false;
		this.enabled = true;
		this._lookState = newLookState();

		window.addEventListener( 'keydown', ( e ) => {

			if ( e.target && ( e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA' ) ) return;
			if ( ! this.keys.has( e.code ) ) this.pressed.add( e.code );
			this.keys.add( e.code );
			if ( [ 'Space', 'ArrowUp', 'ArrowDown', 'Tab' ].includes( e.code ) ) e.preventDefault();

		} );
		window.addEventListener( 'keyup', ( e ) => this.keys.delete( e.code ) );
		window.addEventListener( 'blur', () => this.keys.clear() );

		dom.addEventListener( 'mousedown', ( e ) => {

			if ( e.button === 0 ) this.mouseDown = true;
			if ( e.button === 2 ) this.rightDown = true;

		} );
		window.addEventListener( 'mouseup', ( e ) => {

			if ( e.button === 0 ) this.mouseDown = false;
			if ( e.button === 2 ) this.rightDown = false;

		} );
		dom.addEventListener( 'contextmenu', ( e ) => e.preventDefault() );
		window.addEventListener( 'mousemove', ( e ) => {

			if ( this.locked || this.mouseDown || this.rightDown ) {

				const d = filterLook( this._lookState, e.movementX, e.movementY, e.timeStamp );
				if ( d ) {

					this.look.x += d.x;
					this.look.y += d.y;

				}

			}

		} );
		dom.addEventListener( 'wheel', ( e ) => {

			this.wheel += Math.sign( e.deltaY );
			e.preventDefault();

		}, { passive: false } );

		document.addEventListener( 'pointerlockchange', () => {

			this.locked = document.pointerLockElement === dom;
			this._lookState.since = performance.now(); // the first moves after (un)locking can carry a jump

		} );

	}

	requestLock() {

		if ( this.locked || ! this.dom.requestPointerLock ) return;
		// raw mouse motion where supported: no OS acceleration, and none of the jumps Windows can send
		let p;
		try {

			p = this.dom.requestPointerLock( { unadjustedMovement: true } );

		} catch ( e ) {

			p = null;

		}

		if ( p && p.catch ) p.catch( () => this.dom.requestPointerLock()?.catch?.( () => {} ) );

	}

	down( code ) {

		return this.enabled && this.keys.has( code );

	}

	// true once per physical key press
	hit( code ) {

		return this.enabled && this.pressed.has( code );

	}

	consumeLook() {

		const l = { x: this.look.x, y: this.look.y };
		this.look.x = 0;
		this.look.y = 0;
		return l;

	}

	consumeWheel() {

		const w = this.wheel;
		this.wheel = 0;
		return w;

	}

	endFrame() {

		this.pressed.clear();

	}

}
