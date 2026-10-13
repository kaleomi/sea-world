// Plain-node tests of multiplayer (no GPU, no DOM): the wire checks (src/net/Protocol.js), the
// server's sea (server/Sea.js) and the game's client (src/net/NetClient.js) joined through an
// in-memory socket, then once over a real WebSocket when the server's dependency is installed.
import { cleanName, cleanState, cleanCatch, cleanColor, PROTOCOL, MAX_FRAME } from '../src/net/Protocol.js';
import { Sea } from '../server/Sea.js';
import { NetClient, INTERP, lerpAngle, errorText } from '../src/net/NetClient.js';
import { RemotePlayers } from '../src/net/RemotePlayers.js';
import { defaultServer, normalizeServer } from '../src/net/Multiplayer.js';
import { Scene, PerspectiveCamera } from '../src/engine/index.js';
import { BoatModel } from '../src/world/BoatModel.js';

let fails = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else console.log( 'ok  ', msg );

};
const flush = () => new Promise( ( r ) => setTimeout( r, 0 ) );

// ---- the wire checks
ok( cleanName( '  <b>Kai</b>  ' ) === 'bKai/b' && cleanName( '' ) === null && cleanName( 'x'.repeat( 40 ) ).length === 16, 'names: trimmed, no markup, at most 16 characters' );
ok( cleanName( '渔夫小明' ) === '渔夫小明', 'names: Chinese names pass' );
ok( cleanColor( '#A0B1C2' ) === '#a0b1c2' && cleanColor( 'red' ) === '#5d7a8c', 'colours: #rrggbb or the default' );
const good = { m: 'deck', p: [ 1.234567, 0.5, - 3 ], yaw: 7, b: [ 1, 0.2, - 3, 0, 0.7071, 0, 0.7071 ], bh: 0.27, l: [ 0.3, 1.1, - 2 ] };
const cs = cleanState( good );
ok( cs && cs.p[ 0 ] === 1.23 && Math.abs( cs.yaw - ( 7 - 2 * Math.PI ) ) < 1e-3 && cs.l && cs.bh === 0.27, 'state: rounded to cm, yaw wrapped, deck position kept aboard' );
ok( cleanState( { ...good, m: 'fly' } ) === null && cleanState( { ...good, p: [ 0, NaN, 0 ] } ) === null && cleanState( { ...good, p: [ 1e9, 0, 0 ] } ) === null, 'state: bad mode, NaN or far-off positions are refused' );
ok( cleanState( { ...good, b: [ 0, 0, 0, 2, 0, 0, 0 ] } ) === null, 'state: a quaternion out of range is refused' );
ok( cleanState( { m: 'walk', p: [ 0, 1, 0 ], yaw: 0, l: [ 1, 1, 1 ] } ).l === undefined, 'state: no deck position when ashore' );
const isFish = ( id ) => id === 'tuna';
ok( cleanCatch( { species: 'tuna', kg: 12.345, legend: 'x<y' }, isFish ).legend === undefined && cleanCatch( { species: 'shark', kg: 1 }, isFish ) === null && cleanCatch( { species: 'tuna', kg: - 1 }, isFish ) === null, 'catch: real species and weights only' );

// ---- an in-memory socket from a NetClient to a Sea
let clock = 1000;
function hub( sea ) {

	return class FakeWS {

		constructor( url ) {

			this.url = url;
			this.readyState = 0;
			// (a frame sent before the close still arrives, as over a real socket)
			const conn = { send: ( s ) => this.readyState !== 3 && queueMicrotask( () => this.onmessage?.( { data: s } ) ), close: () => this.close() };
			this.id = sea.connect( conn );
			queueMicrotask( () => {

				this.readyState = 1;
				this.onopen?.();

			} );

		}

		send( s ) {

			queueMicrotask( () => sea.receive( this.id, s ) );

		}

		close() {

			if ( this.readyState === 3 ) return;
			this.readyState = 3;
			sea.disconnect( this.id );
			queueMicrotask( () => this.onclose?.() );

		}

	};

}

{

	const sea = new Sea( { now: () => clock, maxPlayers: 2 } );
	const WS = hub( sea );
	const a = new NetClient( { WebSocketImpl: WS, now: () => clock } ), b = new NetClient( { WebSocketImpl: WS, now: () => clock } );
	const seen = { joins: [], leaves: [], catches: [] };
	b.on( 'join', ( p ) => seen.joins.push( p.name ) ).on( 'leave', ( p ) => seen.leaves.push( p.name ) ).on( 'catch', ( p, c ) => seen.catches.push( `${ p.name } ${ c.species } ${ c.kg }` ) );
	a.connect( 'ws://x', { name: 'Ana', color: '#ff0000' } );
	await flush(); await flush();
	ok( a.online && a.id && sea.count === 1, 'the first player is welcomed' );
	b.connect( 'ws://x', { name: '阿凯' } );
	await flush(); await flush();
	ok( b.online && b.peers.size === 1 && [ ...b.peers.values() ][ 0 ].name === 'Ana', 'the second gets the list of who is already at sea' );
	ok( a.peers.size === 1 && [ ...a.peers.values() ][ 0 ].name === '阿凯', 'and the first hears them join' );

	const c = new NetClient( { WebSocketImpl: WS, now: () => clock } );
	c.connect( 'ws://x', { name: 'Third' } );
	await flush(); await flush(); await flush();
	ok( c.status === 'error' && c.error === 'full' && sea.count === 2, 'a full sea turns the next one away (and they stop retrying)' );

	// states: Ana sails east at 5 m/s, a snapshot each tick
	const peerA = b.peers.get( a.id );
	for ( let i = 0; i <= 10; i ++ ) {

		clock = 1000 + i * 0.1;
		a.sendState( { m: 'boat', p: [ i * 0.5, 1, 0 ], yaw: 0, b: [ i * 0.5, 0.3, 0, 0, 0, 0, 1 ], bh: 0.3, l: [ 0.3, 1.1, - 1 ] } );
		await flush();
		sea.tick();
		await flush();

	}

	ok( peerA.snaps.length >= 10, `snapshots arrive every tick (${ peerA.snaps.length })` );
	const s = b.sample( peerA );
	const want = ( clock - INTERP - 1000 ) * 5; // where Ana was INTERP ago
	ok( s && s.m === 'boat' && Math.abs( s.b[ 0 ] - want ) < 0.05 && Math.abs( s.p[ 0 ] - want ) < 0.05, `the sample is where they were ${ INTERP } s ago (${ s.b[ 0 ].toFixed( 2 ) } m, want ${ want.toFixed( 2 ) })` );
	clock += 0.05;
	const s2 = b.sample( peerA );
	ok( s2.b[ 0 ] > s.b[ 0 ] && s2.b[ 0 ] < s.b[ 0 ] + 0.3, 'and it moves smoothly between snapshots' );
	clock += 5;
	ok( b.sample( peerA ).b[ 0 ] === 5 && b.sample( peerA ).age > 4, 'a stalled stream holds the last pose and reports its age' );

	// unchanged states are not resent every tick
	let sent = 0;
	const real = a._ws.send.bind( a._ws );
	a._ws.send = ( x ) => {

		sent ++;
		real( x );

	};
	for ( let i = 0; i < 10; i ++ ) {

		clock += 0.1;
		a.sendState( { m: 'walk', p: [ 3, 1, 3 ], yaw: 0 } );

	}

	ok( sent === 1, `an unchanged state goes once a second, not every tick (${ sent } in 1 s)` );
	clock += 0.01;
	for ( let i = 0; i < 5; i ++ ) a.sendState( { m: 'walk', p: [ 3 + i, 1, 3 ], yaw: 0 } );
	ok( sent === 2, `a change goes at once, but never faster than the tick (${ sent - 1 } of 5 sent)` );

	a.sendCatch( { species: 'mahi', kg: 11.2 } );
	a.sendCatch( { species: 'dragon', kg: 99 } );
	await flush(); await flush();
	ok( seen.catches.length === 1 && seen.catches[ 0 ] === 'Ana mahi 11.2', 'catches are told to the others (bad ones dropped)' );

	// junk and floods
	const before = sea.count;
	sea.receive( a.id, 'not json' );
	await flush(); await flush();
	ok( sea.count === before - 1 && seen.leaves.includes( 'Ana' ), 'a client sending junk is cut off and the others see them leave' );
	b.disconnect();
	await flush(); await flush();
	ok( sea.count === 0 && b.status === 'off', 'leaving closes the link and empties the sea' );

}

{

	// the hello: version and timeout
	const sea = new Sea( { now: () => clock } );
	const sent = [];
	let closed = false;
	const id = sea.connect( { send: ( s ) => sent.push( JSON.parse( s ) ), close: () => { closed = true; } } );
	sea.receive( id, JSON.stringify( { t: 'hello', v: PROTOCOL + 1, name: 'x' } ) );
	ok( closed && sent[ 0 ].code === 'version' && sea.count === 0, 'an old or new game version is told so and closed' );
	closed = false;
	sea.connect( { send: () => {}, close: () => { closed = true; } } );
	clock += 20;
	sea.tick();
	ok( closed, 'a connection that never says hello is dropped' );
	const id3 = sea.connect( { send: () => {}, close: () => { closed = true; } } );
	sea.receive( id3, 'x'.repeat( MAX_FRAME + 1 ) );
	ok( sea.pending.size === 0, 'an oversized frame is refused' );
	const id4 = sea.connect( { send: () => {}, close: () => { closed = true; } } );
	sea.receive( id4, JSON.stringify( { t: 'hello', v: PROTOCOL, name: 'Flood' } ) );
	closed = false;
	for ( let i = 0; i < 200; i ++ ) sea.receive( id4, JSON.stringify( { t: 'state', m: 'walk', p: [ i, 0, 0 ], yaw: 0 } ) );
	ok( closed && sea.count === 0, 'a client flooding messages is cut off' );

}

ok( Math.abs( lerpAngle( 3.0, - 3.0, 0.5 ) - Math.PI ) < 0.15, 'angles blend the short way round' );

// ---- once over a real WebSocket (needs `npm install` in server/)
let startServer = null;
try {

	( { startServer } = await import( '../server/Server.js' ) );

} catch ( e ) {

	console.log( '     (server/node_modules missing: skipping the real-socket check)' );

}

if ( startServer && typeof WebSocket !== 'undefined' ) {

	const srv = await startServer( { port: 0, log: () => {} } );
	const url = `ws://127.0.0.1:${ srv.port }`;
	const a = new NetClient(), b = new NetClient();
	const until = async ( f, ms = 3000 ) => {

		const t0 = Date.now();
		while ( ! f() && Date.now() - t0 < ms ) await new Promise( ( r ) => setTimeout( r, 20 ) );
		return f();

	};
	a.connect( url, { name: 'Real A' } );
	b.connect( url, { name: 'Real B' } );
	ok( await until( () => a.online && b.online && a.peers.size === 1 && b.peers.size === 1 ), 'real socket: two games meet at sea' );
	const peer = b.peers.get( a.id );
	a.sendState( { m: 'swim', p: [ 10, 0, 20 ], yaw: 1 } );
	ok( await until( () => peer.snaps.length > 0 ), 'real socket: a state arrives within a tick' );
	const health = await ( await fetch( `http://127.0.0.1:${ srv.port }/` ) ).json();
	ok( health.ok && health.players === 2, 'real socket: the health check counts the players' );
	a.disconnect();
	ok( await until( () => b.peers.size === 0 ), 'real socket: leaving is seen' );
	b.disconnect();
	await srv.close();

}

// ---- drawing the others (RemotePlayers) with the real boat model, no GPU
{

	const scene = new Scene(), camera = new PerspectiveCamera( 60, 1.6, 0.1, 1000 );
	const boat = new BoatModel();
	scene.add( boat.group );
	boat.group.add( new PerspectiveCamera() ); // something the game hung on our boat: not copied
	const h = {}, cur = {};
	const net = { on: ( e, f ) => ( h[ e ] = f ), sample: ( p, o ) => ( cur[ p.id ] ? Object.assign( o, cur[ p.id ] ) : null ) };
	const masks = [];
	const sceneRenderer = { addHullMask: ( g, o ) => ( masks.push( o ), { o } ), removeHullMask: ( m ) => masks.splice( masks.indexOf( m.o ), 1 ) };
	const rp = new RemotePlayers( { net, scene, camera, boat, sceneRenderer, figureMaterial: {} } );
	const yaw = 1.0, q = [ 0, Math.sin( yaw / 2 ), 0, Math.cos( yaw / 2 ) ];
	h.join( { id: 2, name: 'Ann', color: '#e2574c' } );
	rp.update( 0.016 );
	const v = rp.views.get( 2 );
	ok( v && ! v.boat.visible && ! v.figure.visible && rp.positions().length === 0, 'remote: nothing drawn before their first state' );
	cur[ 2 ] = { m: 'deck', p: [ 0, 0, 0 ], yaw: yaw + 0.5, b: [ 100, 0.1, 50, ...q ], bh: 0.1, l: [ 0, 1, - 2 ] };
	rp.update( 0.016 );
	const parts = boat.group.children.filter( ( c ) => c.name.startsWith( 'boat-' ) ).length;
	ok( v.boat.children.length === parts && v.radar && masks.length === 1, 'remote: their boat is a copy of ours (its own parts only) with a hull mask' );
	ok( v.boat.visible && Math.abs( v.figure.position.x - ( 100 - 2 * Math.sin( yaw ) ) ) < 1e-6 && Math.abs( v.figure.position.y - 1.1 ) < 1e-6, 'remote: aboard, the figure stands on their deck in the boat frame' );
	const e = v.figure.quaternion;
	const fy = Math.atan2( 2 * ( e.w * e.y + e.x * e.z ), 1 - 2 * ( e.y * e.y + e.x * e.x ) );
	ok( Math.abs( fy - ( yaw + 0.5 ) ) < 1e-6, 'remote: the figure faces where they look' );
	cur[ 2 ] = { m: 'walk', p: [ 3, 2, 1 ], yaw: 0, b: [ 0.5, 0, 0.5, 0, 0, 0, 1 ], bh: 0 };
	rp.update( 0.016 );
	ok( ! v.boat.visible && v.figure.position.x === 3 && v.figure.position.y === 2, 'remote: ashore at their feet; a boat on top of ours (the shared berth) is hidden' );
	h.leave( { id: 2 } );
	ok( rp.views.size === 0 && masks.length === 0 && scene.children.length === 1, 'remote: leaving takes the boat, figure and hull mask away' );

}

ok( defaultServer( { hostname: 'localhost', protocol: 'http:' } ) === 'ws://localhost:5191' && defaultServer( { hostname: 'sea.example', protocol: 'https:' } ) === 'wss://sea.example:5191', 'settings: the default server follows the page (wss on https)' );
const http = { protocol: 'http:' }, https = { protocol: 'https:' };
ok( normalizeServer( '192.168.1.5', http ) === 'ws://192.168.1.5:5191' && normalizeServer( 'ws://localhost:6000/', http ) === 'ws://localhost:6000' && normalizeServer( 'ws://[::1]', http ) === 'ws://[::1]:5191', 'settings: a plain address gets ws:// and our port' );
ok( normalizeServer( 'wss://tidewater-sea.onrender.com/', https ) === 'wss://tidewater-sea.onrender.com' && normalizeServer( 'tidewater-sea.onrender.com', https ) === 'wss://tidewater-sea.onrender.com', 'settings: a hosted wss:// server keeps its own port (443); no scheme on an https page means wss' );
ok( errorText( 'full' ) !== errorText( 'version' ) && errorText( 'nonsense' ) === errorText( 'unreachable' ), 'errors: each has its own message' );

console.log( fails ? `\n${ fails } failed` : '\nall passed' );
process.exit( fails ? 1 : 0 );
