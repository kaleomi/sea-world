import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { Sea } from './Sea.js';
import { DEFAULT_PORT, TICK_HZ, MAX_FRAME } from '../src/net/Protocol.js';

// The multiplayer server: one shared sea that every game connected to it sails in (index.js
// starts it). It relays positions and catches between the games and checks what they send (src/net/Protocol.js);
// it keeps no saves. GET / answers with how many are at sea (a health check for a host).
export function startServer( { port = Number( process.env.PORT ) || DEFAULT_PORT, host = process.env.HOST || '127.0.0.1', log = console.log } = {} ) {

	const sea = new Sea( { log } );
	const http = createServer( ( req, res ) => {

		res.writeHead( 200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' } );
		res.end( JSON.stringify( { ok: true, players: sea.count } ) );

	} );
	const wss = new WebSocketServer( { server: http, maxPayload: MAX_FRAME } );
	wss.on( 'connection', ( ws ) => {

		const id = sea.connect( { send: ( s ) => ws.readyState === 1 && ws.send( s ), close: ( c, r ) => ws.close( c, r ) } );
		ws.on( 'message', ( data, binary ) => sea.receive( id, binary ? null : data.toString() ) );
		ws.on( 'close', () => sea.disconnect( id ) );
		ws.on( 'error', () => sea.disconnect( id ) );

	} );
	const timer = setInterval( () => sea.tick(), 1000 / TICK_HZ );
	return new Promise( ( resolve ) => http.listen( port, host, () => {

		const addr = http.address();
		log( `Tidewater sea open on ws://${ host }:${ addr.port }` );
		resolve( { sea, port: addr.port, close: () => new Promise( ( r ) => {

			clearInterval( timer );
			for ( const c of wss.clients ) c.terminate();
			wss.close();
			http.close( () => r() );

		} ) } );

	} ) );

}
