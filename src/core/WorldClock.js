// The world clock and the weather schedule. Both come from the real time (Date.now()), so everyone on
// the shared sea sees the same hour and the same weather without the server keeping either.
//
// A day runs about 18½ real minutes: daylight (06:00–19:00) at a real minute per game hour, the night
// twice as fast. The weather changes every WEATHER_BLOCK real seconds, chosen by a seeded chain (a
// rainy spell tends to follow cloud, a storm to tail off into rain), with a sea state to match; the
// forecast is just the next few blocks of the same schedule.
//   worldHour( ms )  game hour 0..24        worldDay( ms )  whole game days since the epoch
//   weatherAt( ms )  { weather, sea }        forecast( ms, n )  [ { start, end, hour, weather, sea } ]
// Pure, no engine imports (test/world-clock.mjs).

export const DAWN = 6, DUSK = 19;
export const DAY_SEC_PER_HOUR = 60;
export const NIGHT_SEC_PER_HOUR = 30;
const DAY_SPAN = ( DUSK - DAWN ) * DAY_SEC_PER_HOUR; // real s of daylight
export const CYCLE = DAY_SPAN + ( 24 - DUSK + DAWN ) * NIGHT_SEC_PER_HOUR; // real s per game day
// shift so that the world isn't in the same phase as UTC midnight (arbitrary, fixed for everyone)
const OFFSET = 0.37 * CYCLE;

// seconds into the game day (from DAWN) -> game hour
function hourOfCycle( c ) {

	if ( c < DAY_SPAN ) return DAWN + c / DAY_SEC_PER_HOUR;
	return ( DUSK + ( c - DAY_SPAN ) / NIGHT_SEC_PER_HOUR ) % 24;

}

// game hour -> seconds into the game day (from DAWN)
export function cycleOfHour( h ) {

	h = ( ( h % 24 ) + 24 ) % 24;
	if ( h >= DAWN && h < DUSK ) return ( h - DAWN ) * DAY_SEC_PER_HOUR;
	const after = ( h - DUSK + 24 ) % 24; // hours since dusk
	return DAY_SPAN + after * NIGHT_SEC_PER_HOUR;

}

const cycleSec = ( ms ) => ( ( ( ms / 1000 + OFFSET ) % CYCLE ) + CYCLE ) % CYCLE;

export function worldHour( ms = Date.now() ) {

	return hourOfCycle( cycleSec( ms ) );

}

export function worldDay( ms = Date.now() ) {

	return Math.floor( ( ms / 1000 + OFFSET ) / CYCLE );

}

// the real time (ms) when the game hour next reaches `h`
export function msUntilHour( h, ms = Date.now() ) {

	let d = cycleOfHour( h ) - cycleSec( ms );
	if ( d <= 0 ) d += CYCLE;
	return d * 1000;

}

// ---- weather
export const WEATHER_BLOCK = 420; // real s per weather spell (7 minutes)
export const WEATHER_KINDS = [ 'Clear', 'Drizzle', 'Rain', 'Storm' ];
// where each spell tends to go next (rows: from, columns: to, in WEATHER_KINDS order)
const NEXT = {
	Clear: [ 0.7, 0.18, 0.1, 0.02 ],
	Drizzle: [ 0.55, 0.2, 0.2, 0.05 ],
	Rain: [ 0.35, 0.3, 0.25, 0.1 ],
	Storm: [ 0.15, 0.25, 0.45, 0.15 ],
};
const START = [ 0.6, 0.2, 0.15, 0.05 ];
const MEMORY = 10; // spells of history each spell is worked out from (the chain restarts this far back)

// a well-mixed 0..1 number for spell n and a stream id
function hash( n, k ) {

	let x = ( Math.imul( n | 0, 0x9e3779b1 ) ^ Math.imul( k + 1, 0x85ebca6b ) ) >>> 0;
	x = Math.imul( x ^ ( x >>> 16 ), 0x7feb352d ) >>> 0;
	x = Math.imul( x ^ ( x >>> 15 ), 0x846ca68b ) >>> 0;
	return ( ( x ^ ( x >>> 16 ) ) >>> 0 ) / 4294967296;

}

function pick( probs, r ) {

	for ( let i = 0; i < probs.length; i ++ ) {

		r -= probs[ i ];
		if ( r < 0 ) return WEATHER_KINDS[ i ];

	}

	return WEATHER_KINDS[ probs.length - 1 ];

}

export const weatherBlock = ( ms = Date.now() ) => Math.floor( ms / 1000 / WEATHER_BLOCK );

// the weather of spell n: the same for everyone
export function weatherOf( n ) {

	let w = pick( START, hash( n - MEMORY, 1 ) );
	for ( let k = n - MEMORY + 1; k <= n; k ++ ) w = pick( NEXT[ w ], hash( k, 2 ) );
	return w;

}

// the sea that goes with it (AppUI's sea-state presets): fine days are calm or breezy
export function seaOf( n, weather = weatherOf( n ) ) {

	if ( weather === 'Storm' ) return 'Storm';
	if ( weather === 'Rain' ) return 'Choppy';
	if ( weather === 'Drizzle' ) return 'Breezy';
	return hash( n, 3 ) < 0.35 ? 'Calm' : 'Breezy';

}

export function weatherAt( ms = Date.now() ) {

	const n = weatherBlock( ms );
	const weather = weatherOf( n );
	return { block: n, weather, sea: seaOf( n, weather ) };

}

// the current spell and the next n - 1: start / end are real ms, hour the game hour it starts at
export function forecast( ms = Date.now(), n = 6 ) {

	const b0 = weatherBlock( ms ), out = [];
	for ( let b = b0; b < b0 + n; b ++ ) {

		const start = b * WEATHER_BLOCK * 1000, weather = weatherOf( b );
		out.push( { block: b, start, end: start + WEATHER_BLOCK * 1000, hour: worldHour( Math.max( start, ms ) ), weather, sea: seaOf( b, weather ) } );

	}

	return out;

}

// "HH:MM" for a game hour
export function clockText( h ) {

	h = ( ( h % 24 ) + 24 ) % 24;
	let hh = Math.floor( h ), mm = Math.floor( ( h - hh ) * 60 );
	if ( mm === 60 ) { hh = ( hh + 1 ) % 24; mm = 0; }
	return `${ String( hh ).padStart( 2, '0' ) }:${ String( mm ).padStart( 2, '0' ) }`;

}
