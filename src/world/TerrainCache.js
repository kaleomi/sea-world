// IndexedDB cache of the generated terrain grids. TerrainData.generate() is the slowest step of the
// first load (several seconds of noise, erosion and masks on the CPU) and its result only changes
// when the terrain code does, so a production build stores it on first load and reads it back on
// later visits. The key carries a hash of the world sources (vite.config.js defines
// __TIDEWATER_TERRAIN_HASH__ at build time): a deploy that changes the terrain misses the old entry and
// replaces it. The dev server defines no hash, so edits always regenerate; ?noCache skips it too.
// Storage can be missing, full or blocked: every failure just means "generate as before".

const DB_NAME = 'tidewater-cache';
const STORE = 'terrain';

// the grids generate() fills; everything else in TerrainData is derived from them or constant
export const TERRAIN_FIELDS = [
	[ 'heights', Float32Array ], [ 'rock', Float32Array ], [ 'sand', Uint8Array ], [ 'path', Uint8Array ],
	[ 'gully', Uint8Array ], [ 'seagrass', Uint8Array ], [ 'rubble', Uint8Array ], [ 'scarp', Uint8Array ],
];

/* global __TIDEWATER_TERRAIN_HASH__ */
const BUILD_HASH = typeof __TIDEWATER_TERRAIN_HASH__ === 'string' ? __TIDEWATER_TERRAIN_HASH__ : null;

// the cache key for a seed, or null when this build doesn't cache
export function terrainCacheKey( seed ) {

	return BUILD_HASH ? `terrain:${ seed }:${ BUILD_HASH }` : null;

}

// a copy of the generated grids, taken before the village flattens its pads into them
export function terrainSnapshot( td ) {

	const snap = { res: td.res, rockSites: td.rockSites.map( ( s ) => ( { ...s } ) ) };
	for ( const [ name ] of TERRAIN_FIELDS ) snap[ name ] = td[ name ].slice();
	return snap;

}

// does a stored snapshot fit a terrain of `res`? (a stale or damaged entry is regenerated)
export function validSnapshot( snap, res ) {

	if ( ! snap || snap.res !== res || ! Array.isArray( snap.rockSites ) ) return false;
	for ( const [ name, Type ] of TERRAIN_FIELDS ) if ( ! ( snap[ name ] instanceof Type ) || snap[ name ].length !== res * res ) return false;
	return true;

}

function openDB() {

	return new Promise( ( resolve, reject ) => {

		if ( typeof indexedDB === 'undefined' ) return reject( new Error( 'no IndexedDB' ) );
		const req = indexedDB.open( DB_NAME, 1 );
		req.onupgradeneeded = () => req.result.createObjectStore( STORE );
		req.onsuccess = () => resolve( req.result );
		req.onerror = () => reject( req.error );
		req.onblocked = () => reject( new Error( 'IndexedDB blocked' ) );

	} );

}

function done( tx ) {

	return new Promise( ( resolve, reject ) => {

		tx.oncomplete = () => resolve();
		tx.onerror = tx.onabort = () => reject( tx.error );

	} );

}

export async function loadTerrain( key ) {

	if ( ! key ) return null;
	try {

		const db = await openDB();
		const tx = db.transaction( STORE, 'readonly' );
		const req = tx.objectStore( STORE ).get( key );
		await done( tx );
		db.close();
		return req.result || null;

	} catch ( e ) {

		return null;

	}

}

// store a snapshot under `key` and drop entries from older builds (only one terrain is kept)
export async function saveTerrain( key, snap ) {

	if ( ! key ) return false;
	try {

		const db = await openDB();
		const tx = db.transaction( STORE, 'readwrite' );
		const store = tx.objectStore( STORE );
		store.clear();
		store.put( snap, key );
		await done( tx );
		db.close();
		return true;

	} catch ( e ) {

		return false;

	}

}
