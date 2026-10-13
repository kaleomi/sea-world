import { PROTOCOL, TICK_HZ, MAX_PLAYERS, MAX_FRAME, AVATARS, cleanName, cleanColor, cleanAvatar, cleanState, cleanCatch, cleanChat } from '../src/net/Protocol.js';
import { FISH } from '../src/game/FishTable.js';

// One shared sea: who is in it and where they are. Transport-free (server/index.js wires it to
// WebSockets; test/net.mjs drives it directly). A connection is anything with send( text ) and
// close( code, reason ).
//   const sea = new Sea();  const id = sea.connect( conn );  sea.receive( id, text );  sea.disconnect( id );
//   sea.tick()   (TICK_HZ a second): sends everyone's latest state to everyone
// The server only relays and checks: each game simulates its own world, fish and money.
const MSGS_PER_SEC = 40; // a client sending more than this (sustained) is cut off
const HELLO_TIMEOUT = 10; // s to say hello after connecting
const CHAT_GAP = 0.7; // s between chat lines (a short burst is allowed)
const CHAT_BURST = 3;
const isFish = ( id ) => Object.prototype.hasOwnProperty.call( FISH, id );

export class Sea {

	constructor( { maxPlayers = MAX_PLAYERS, now = () => Date.now() / 1000, log = () => {} } = {} ) {

		this.maxPlayers = maxPlayers;
		this.now = now;
		this.log = log;
		this.players = new Map(); // id -> { conn, name, color, av, state, dirty, budget, at, chat, chatAt }
		this.pending = new Map(); // id -> { conn, at } (connected, no hello yet)
		this._next = 1;

	}

	get count() {

		return this.players.size;

	}

	connect( conn ) {

		const id = this._next ++;
		this.pending.set( id, { conn, at: this.now() } );
		return id;

	}

	disconnect( id ) {

		this.pending.delete( id );
		const p = this.players.get( id );
		if ( ! p ) return;
		this.players.delete( id );
		this.log( `leave ${ id } ${ p.name } (${ this.count } at sea)` );
		this._broadcast( { t: 'leave', id } );

	}

	_kick( id, conn, code ) {

		try {

			conn.send( JSON.stringify( { t: 'error', code } ) );
			conn.close( 1008, code );

		} catch ( e ) { /* already gone */ }

		this.pending.delete( id );
		if ( this.players.has( id ) ) this.disconnect( id );

	}

	receive( id, text ) {

		const pend = this.pending.get( id ), p = this.players.get( id );
		const conn = p ? p.conn : pend && pend.conn;
		if ( ! conn ) return;
		if ( typeof text !== 'string' || text.length > MAX_FRAME ) return this._kick( id, conn, 'bad' );
		let msg;
		try {

			msg = JSON.parse( text );

		} catch ( e ) {

			return this._kick( id, conn, 'bad' );

		}

		if ( ! msg || typeof msg !== 'object' ) return this._kick( id, conn, 'bad' );

		if ( pend ) {

			if ( msg.t !== 'hello' ) return this._kick( id, conn, 'bad' );
			if ( msg.v !== PROTOCOL ) return this._kick( id, conn, 'version' );
			if ( this.players.size >= this.maxPlayers ) return this._kick( id, conn, 'full' );
			const name = cleanName( msg.name ) || `Fisher ${ id }`;
			const color = cleanColor( msg.color );
			const av = cleanAvatar( msg.av ) || AVATARS[ id % AVATARS.length ];
			this.pending.delete( id );
			const peers = [ ...this.players ].map( ( [ pid, q ] ) => ( { id: pid, name: q.name, color: q.color, av: q.av } ) );
			this.players.set( id, { conn, name, color, av, state: null, dirty: false, budget: MSGS_PER_SEC, at: this.now(), chat: CHAT_BURST, chatAt: this.now() } );
			conn.send( JSON.stringify( { t: 'welcome', id, peers, tick: TICK_HZ } ) );
			this._broadcast( { t: 'join', id, name, color, av }, id );
			this.log( `join ${ id } ${ name } (${ this.count } at sea)` );
			return;

		}

		// rate limit: a budget that refills at MSGS_PER_SEC
		const t = this.now();
		p.budget = Math.min( MSGS_PER_SEC, p.budget + ( t - p.at ) * MSGS_PER_SEC ) - 1;
		p.at = t;
		if ( p.budget < - MSGS_PER_SEC ) return this._kick( id, conn, 'bad' );
		if ( p.budget < 0 ) return; // over the rate: dropped

		if ( msg.t === 'state' ) {

			const s = cleanState( msg );
			if ( s ) {

				p.state = s;
				p.dirty = true;

			}

		} else if ( msg.t === 'catch' ) {

			const c = cleanCatch( msg, isFish );
			if ( c ) this._broadcast( { t: 'catch', id, ...c }, id );

		} else if ( msg.t === 'chat' ) {

			// its own slower budget: a few lines in a row, then one every CHAT_GAP s
			p.chat = Math.min( CHAT_BURST, p.chat + ( t - p.chatAt ) / CHAT_GAP );
			p.chatAt = t;
			const text = cleanChat( msg.text );
			if ( ! text || p.chat < 1 ) return;
			p.chat -= 1;
			this._broadcast( { t: 'chat', id, text }, id );

		}

	}

	// everyone's state that changed since the last tick, to everyone else; drops silent connections
	tick() {

		const t = this.now();
		for ( const [ id, q ] of this.pending ) if ( t - q.at > HELLO_TIMEOUT ) this._kick( id, q.conn, 'bad' );
		const list = [];
		for ( const [ id, p ] of this.players ) if ( p.dirty && p.state ) {

			list.push( { id, ...p.state } );
			p.dirty = false;

		}

		if ( ! list.length ) return;
		const all = JSON.stringify( { t: 'states', time: Math.round( t * 1000 ) / 1000, list } );
		for ( const [ id, p ] of this.players ) {

			// (everyone gets the whole list, their own entry included: one string for all)
			try {

				p.conn.send( all );

			} catch ( e ) {

				this.disconnect( id );

			}

		}

	}

	_broadcast( msg, except = null ) {

		const s = JSON.stringify( msg );
		for ( const [ id, p ] of this.players ) if ( id !== except ) {

			try {

				p.conn.send( s );

			} catch ( e ) { /* the close handler cleans up */ }

		}

	}

}
