import { PROTOCOL, TICK_HZ } from './Protocol.js';

// The game's end of the multiplayer link (server/): one WebSocket to a shared sea.
//   const net = new NetClient();
//   net.connect( 'ws://127.0.0.1:5191', { name, color } );  net.disconnect()
//   net.sendState( state ) every frame (sent TICK_HZ a second, less when nothing changes)
//   net.sendCatch( { species, kg, legend } )
//   net.sample( peer, out ) the peer's state INTERP s in the past, interpolated between snapshots
//   net.on( 'join' | 'leave' | 'catch' | 'status', fn )
// status: 'off' | 'connecting' | 'online' | 'retrying' | 'error' (error: net.error = 'full' |
// 'version' | 'bad' | 'unreachable'). A dropped link retries with backoff until disconnect().
export const INTERP = 0.2; // s behind the newest snapshot: two ticks, so there is nearly always a pair to blend
const KEEP = 24; // snapshots kept per peer
const KEEPALIVE = 1; // s: an unchanged state is still sent this often

// the player-facing reason for status 'error' (English source string; callers translate)
export function errorText( code ) {

	return {
		full: 'The shared sea is full',
		version: 'That server runs another version of the game',
		bad: 'The server cut the link',
		unreachable: 'Could not reach the server',
	}[ code ] || 'Could not reach the server';

}

export class NetClient {

	constructor( { WebSocketImpl = globalThis.WebSocket, now = () => performance.now() / 1000 } = {} ) {

		this.WS = WebSocketImpl;
		this.now = now;
		this.status = 'off';
		this.error = null;
		this.id = null;
		this.peers = new Map(); // id -> { id, name, color, snaps: [ { t, s } ] }
		this._ws = null;
		this._handlers = {};
		this._sentAt = - Infinity;
		this._lastSent = '';
		this._offset = null; // local clock - server clock (s), smoothed
		this._retry = 0;
		this._timer = null;

	}

	on( ev, fn ) {

		( this._handlers[ ev ] ||= [] ).push( fn );
		return this;

	}

	_emit( ev, ...a ) {

		for ( const fn of this._handlers[ ev ] || [] ) fn( ...a );

	}

	_setStatus( s, error = null ) {

		this.status = s;
		this.error = error;
		this._emit( 'status', s, error );

	}

	get online() {

		return this.status === 'online';

	}

	connect( url, { name, color } = {} ) {

		this.disconnect();
		this.url = url;
		this.hello = { t: 'hello', v: PROTOCOL, name, color };
		this._wanted = true;
		this._open();

	}

	disconnect() {

		this._wanted = false;
		clearTimeout( this._timer );
		this._timer = null;
		if ( this._ws ) {

			const ws = this._ws;
			this._ws = null;
			try {

				ws.close();

			} catch ( e ) { /* not open */ }

		}

		this._reset();
		this._retry = 0;
		if ( this.status !== 'off' ) this._setStatus( 'off' );

	}

	_reset() {

		for ( const id of [ ...this.peers.keys() ] ) this._emit( 'leave', this.peers.get( id ) );
		this.peers.clear();
		this.id = null;
		this._offset = null;
		this._lastSent = '';

	}

	_open() {

		if ( ! this.WS ) return this._setStatus( 'error', 'unreachable' );
		this._setStatus( this._retry ? 'retrying' : 'connecting' );
		let ws;
		try {

			ws = new this.WS( this.url );

		} catch ( e ) {

			return this._setStatus( 'error', 'unreachable' );

		}

		this._ws = ws;
		let fatal = null;
		ws.onopen = () => ws.send( JSON.stringify( this.hello ) );
		ws.onmessage = ( e ) => {

			if ( ws !== this._ws ) return;
			let m;
			try {

				m = JSON.parse( e.data );

			} catch ( err ) {

				return;

			}

			if ( m.t === 'error' ) fatal = m.code;
			else this._message( m );

		};
		ws.onclose = () => {

			if ( ws !== this._ws ) return;
			this._ws = null;
			const wasOnline = this.status === 'online';
			this._reset();
			if ( fatal === 'full' || fatal === 'version' || fatal === 'bad' || ! this._wanted ) {

				this._wanted = false;
				return this._setStatus( fatal ? 'error' : 'off', fatal );

			}

			// a dropped link (or a server that isn't up yet): try again, backing off to 30 s
			this._retry = wasOnline ? 1 : this._retry + 1;
			if ( this._retry > 8 && ! wasOnline ) {

				this._wanted = false;
				return this._setStatus( 'error', 'unreachable' );

			}

			this._setStatus( 'retrying' );
			this._timer = setTimeout( () => this._wanted && this._open(), Math.min( 30, 2 ** this._retry ) * 1000 );

		};
		ws.onerror = () => { /* onclose follows */ };

	}

	_message( m ) {

		const now = this.now();
		if ( m.t === 'welcome' ) {

			this.id = m.id;
			this._retry = 0;
			for ( const p of m.peers || [] ) this._join( p );
			this._setStatus( 'online' );

		} else if ( m.t === 'join' ) this._join( m );
		else if ( m.t === 'leave' ) {

			const p = this.peers.get( m.id );
			if ( p ) {

				this.peers.delete( m.id );
				this._emit( 'leave', p );

			}

		} else if ( m.t === 'states' && Array.isArray( m.list ) ) {

			// the server's clock against ours: the smallest offset seen is the least delayed frame
			const off = now - m.time;
			this._offset = this._offset === null ? off : Math.min( off, this._offset + 0.002 );
			const t = m.time + this._offset;
			for ( const s of m.list ) {

				const p = this.peers.get( s.id );
				if ( ! p ) continue;
				p.snaps.push( { t, s } );
				if ( p.snaps.length > KEEP ) p.snaps.shift();

			}

		} else if ( m.t === 'catch' ) {

			const p = this.peers.get( m.id );
			if ( p ) this._emit( 'catch', p, m );

		}

	}

	_join( { id, name, color } ) {

		if ( id === this.id || this.peers.has( id ) ) return;
		const p = { id, name, color, snaps: [] };
		this.peers.set( id, p );
		this._emit( 'join', p );

	}

	// call every frame; sends at most TICK_HZ a second, and an unchanged state only once a second
	sendState( state ) {

		if ( ! this.online ) return;
		const t = this.now();
		if ( t - this._sentAt < 1 / TICK_HZ - 1e-3 ) return;
		const s = JSON.stringify( { t: 'state', ...state } );
		if ( s === this._lastSent && t - this._sentAt < KEEPALIVE ) return;
		this._ws.send( s );
		this._sentAt = t;
		this._lastSent = s;

	}

	sendCatch( c ) {

		if ( this.online ) this._ws.send( JSON.stringify( { t: 'catch', ...c } ) );

	}

	// The peer's state at render time (now - INTERP), blended between the two snapshots around it
	// (held at the newest when the stream stalls; out = null until the first one arrives). Returns
	// { m, p, yaw, b?, bh?, l?, age } where age is how stale the newest snapshot is (s).
	sample( peer, out = {} ) {

		const S = peer.snaps;
		if ( ! S.length ) return null;
		const rt = this.now() - INTERP;
		let i = S.length - 1;
		while ( i > 0 && S[ i - 1 ].t > rt ) i --;
		const b = S[ i ], a = i > 0 ? S[ i - 1 ] : b;
		const k = b.t > a.t ? Math.min( 1, Math.max( 0, ( rt - a.t ) / ( b.t - a.t ) ) ) : 1;
		const A = a.s, B = b.s;
		// a mode change (boarding, diving in) snaps rather than sliding between the two
		const s = A.m === B.m ? null : B;
		out.m = B.m;
		out.p = s ? [ ...B.p ] : lerp3( A.p, B.p, k, out.p );
		out.yaw = s ? B.yaw : lerpAngle( A.yaw, B.yaw, k );
		if ( B.b ) {

			const jump = ! A.b || Math.hypot( A.b[ 0 ] - B.b[ 0 ], A.b[ 2 ] - B.b[ 2 ] ) > 30; // a reset to the dock
			out.b = jump ? [ ...B.b ] : nlerpPose( A.b, B.b, k, out.b );
			out.bh = jump ? B.bh : ( A.bh ?? 0 ) + ( ( B.bh ?? 0 ) - ( A.bh ?? 0 ) ) * k;

		} else out.b = null;

		out.l = B.l ? ( A.l && ! s ? lerp3( A.l, B.l, k, out.l ) : [ ...B.l ] ) : null;
		out.age = this.now() - S[ S.length - 1 ].t;
		return out;

	}

}

function lerp3( a, b, k, out = [ 0, 0, 0 ] ) {

	out[ 0 ] = a[ 0 ] + ( b[ 0 ] - a[ 0 ] ) * k;
	out[ 1 ] = a[ 1 ] + ( b[ 1 ] - a[ 1 ] ) * k;
	out[ 2 ] = a[ 2 ] + ( b[ 2 ] - a[ 2 ] ) * k;
	return out;

}

export function lerpAngle( a, b, k ) {

	const d = Math.atan2( Math.sin( b - a ), Math.cos( b - a ) );
	return a + d * k;

}

// position lerp + quaternion nlerp (shortest arc) of [ x, y, z, qx, qy, qz, qw ]
function nlerpPose( a, b, k, out = new Array( 7 ) ) {

	lerp3( a, b, k, out );
	const dot = a[ 3 ] * b[ 3 ] + a[ 4 ] * b[ 4 ] + a[ 5 ] * b[ 5 ] + a[ 6 ] * b[ 6 ];
	const sg = dot < 0 ? - 1 : 1;
	let n = 0;
	for ( let i = 3; i < 7; i ++ ) {

		out[ i ] = a[ i ] + ( b[ i ] * sg - a[ i ] ) * k;
		n += out[ i ] * out[ i ];

	}

	n = Math.sqrt( n ) || 1;
	for ( let i = 3; i < 7; i ++ ) out[ i ] /= n;
	return out;

}
