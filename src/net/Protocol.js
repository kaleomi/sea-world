// The multiplayer wire format, shared by the game (net/NetClient.js) and the server (server/).
// Plain JSON text frames over one WebSocket. Everything a client sends is checked here before the
// server passes it on, so a bad or hostile client can't push junk to the others.
//
// client -> server
//   { t: 'hello', v: PROTOCOL, name, color, av }          first frame; answered by 'welcome'
//   { t: 'state', m, p, yaw, b?, bh?, l?, r?, k? }        ~TICK_HZ times a second (see cleanState)
//   { t: 'catch', species, kg, legend? }                  a fish landed (kept); told to everyone
//   { t: 'chat', text }                                   a chat line (see cleanChat)
// server -> client
//   { t: 'welcome', id, peers: [ { id, name, color, av } ], tick }
//   { t: 'join', id, name, color, av } / { t: 'leave', id }
//   { t: 'states', time, list: [ { id, ...state } ] }     everyone's latest state, TICK_HZ a second
//   { t: 'catch', id, species, kg, legend? }
//   { t: 'chat', id, text }                               to everyone else
//   { t: 'error', code }                                  then the server closes: 'full', 'version', 'bad'
// av, r, k and chat came later inside protocol 1: an older server drops them, and the games still meet.

export const PROTOCOL = 1;
export const DEFAULT_PORT = 5191;
export const TICK_HZ = 10;
export const MAX_NAME = 16;
export const MAX_PLAYERS = 32;
export const MAX_FRAME = 2048; // bytes; anything longer is dropped (and the client cut off)
export const MODES = [ 'walk', 'swim', 'boat', 'deck' ];
export const BOAT_TYPES = [ 'sloop', 'workboat', 'speedboat', 'trawler' ]; // game/Boats.js BOAT_IDS
export const AVATARS = [ 'm1', 'm2', 'f1', 'f2' ]; // public/models/characters/player_<av>.glb
export const MAX_CHAT = 120; // characters
// the rod (state r): 0 put away, 1 held, 2 winding up, 3 the cast, 4 line out, 5 a fish on, 6 landing it
export const ROD_STATES = 7;
const WORLD_LIMIT = 20000; // m from the origin: far beyond every island

const finite = ( v, lim ) => typeof v === 'number' && Number.isFinite( v ) && Math.abs( v ) <= lim;
const round = ( v, k = 100 ) => Math.round( v * k ) / k;
const vec = ( a, n, lim ) => Array.isArray( a ) && a.length === n && a.every( ( v ) => finite( v, lim ) );

// a display name: trimmed, no control characters or markup, at most MAX_NAME characters
export function cleanName( s ) {

	const n = String( s ?? '' ).replace( /[\u0000-\u001f\u007f<>&"'`]/g, '' ).trim().slice( 0, MAX_NAME );
	return n || null;

}

// an avatar colour '#rrggbb' (anything else becomes a default)
export function cleanColor( c ) {

	return typeof c === 'string' && /^#[0-9a-f]{6}$/i.test( c ) ? c.toLowerCase() : '#5d7a8c';

}

// an avatar id from AVATARS, or null
export function cleanAvatar( a ) {

	return AVATARS.includes( a ) ? a : null;

}

// a chat line: one line, no control characters, at most MAX_CHAT characters; null when empty
export function cleanChat( s ) {

	const n = String( s ?? '' ).replace( /[\u0000-\u001f\u007f]/g, ' ' ).replace( /\s+/g, ' ' ).trim().slice( 0, MAX_CHAT );
	return n || null;

}

// A player's state, or null if it isn't one:
//   m    mode: 'walk' | 'swim' (p is where they are) or 'boat' | 'deck' (aboard their own boat)
//   p    [ x, y, z ] world position (m), yaw (rad)
//   b    [ x, y, z, qx, qy, qz, qw ] their boat (always sent: an anchored boat waits where it is)
//   bh   the boat's height above the water under it (m): the other end puts it on its own waves
//   l    [ x, y, z ] their position on the deck, in the boat's frame (aboard)
//   r    the rod (ROD_STATES), k [ x, y, z ] the end of the line (the bobber, or the hooked fish)
// Numbers are rounded (cm, 1/1000 for the quaternion) to keep the frames small.
export function cleanState( s ) {

	if ( ! s || typeof s !== 'object' || ! MODES.includes( s.m ) ) return null;
	if ( ! vec( s.p, 3, WORLD_LIMIT ) || ! finite( s.yaw, 100 ) ) return null;
	const out = { m: s.m, p: s.p.map( ( v ) => round( v ) ), yaw: round( Math.atan2( Math.sin( s.yaw ), Math.cos( s.yaw ) ), 1000 ) };
	if ( s.b !== undefined ) {

		if ( ! vec( s.b, 7, WORLD_LIMIT ) || s.b.slice( 3 ).some( ( v ) => Math.abs( v ) > 1.001 ) ) return null;
		out.b = [ ...s.b.slice( 0, 3 ).map( ( v ) => round( v ) ), ...s.b.slice( 3 ).map( ( v ) => round( v, 1000 ) ) ];
		out.bh = finite( s.bh, 5 ) ? round( s.bh ) : 0;
		if ( BOAT_TYPES.includes( s.bt ) ) out.bt = s.bt;

	}

	if ( ( s.m === 'boat' || s.m === 'deck' ) && vec( s.l, 3, 20 ) ) out.l = s.l.map( ( v ) => round( v ) );
	if ( Number.isInteger( s.r ) && s.r > 0 && s.r < ROD_STATES ) {

		out.r = s.r;
		// the line end: within a long cast of them
		if ( s.r >= 3 && vec( s.k, 3, WORLD_LIMIT ) && Math.hypot( s.k[ 0 ] - s.p[ 0 ], s.k[ 2 ] - s.p[ 2 ] ) < 300 ) out.k = s.k.map( ( v ) => round( v ) );

	}

	return out;

}

// a catch to tell everyone about, or null
export function cleanCatch( c, isFish ) {

	if ( ! c || typeof c.species !== 'string' || ! isFish( c.species ) || ! finite( c.kg, 500 ) || c.kg <= 0 ) return null;
	const out = { species: c.species, kg: round( c.kg ) };
	if ( typeof c.legend === 'string' && /^[a-zA-Z]{1,24}$/.test( c.legend ) ) out.legend = c.legend;
	return out;

}
