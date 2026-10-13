import { OuterIsland, outerSnapshot, validOuterSnapshot } from './OuterIsland.js';
import { outerCacheKey, loadTerrain, saveTerrainEntry } from '../TerrainCache.js';

// The outer islands for App: each from the browser cache when this build has stored it before, else
// generated in a web worker (all of them at once, and alongside the home island's generation on the
// main thread), else on the main thread. New ones go into the cache for the next visit.
//   const islands = await buildOuterIslands( OUTER_ISLANDS, { cache: true } );
export async function buildOuterIslands( defs, { cache = true } = {} ) {

	return Promise.all( defs.map( async ( def ) => {

		const key = cache ? outerCacheKey( def ) : null;
		const stored = await loadTerrain( key );
		if ( stored && validOuterSnapshot( stored, def.res || 1024 ) ) return new OuterIsland( def, stored );
		const snap = await inWorker( def );
		const o = new OuterIsland( def, snap );
		if ( key ) saveTerrainEntry( key, snap || outerSnapshot( o ) );
		return o;

	} ) );

}

// the island's grids from a worker, or null (no workers here, or it failed: the caller generates)
function inWorker( def ) {

	return new Promise( ( resolve ) => {

		let w;
		try {

			w = new Worker( new URL( './OuterIslandWorker.js', import.meta.url ), { type: 'module' } );

		} catch ( e ) {

			return resolve( null );

		}

		const end = ( v ) => {

			w.terminate();
			resolve( v );

		};
		w.onmessage = ( e ) => end( e.data && e.data.snap && validOuterSnapshot( e.data.snap, def.res || 1024 ) ? e.data.snap : null );
		w.onerror = () => end( null );
		w.postMessage( { def: JSON.parse( JSON.stringify( def ) ) } );

	} );

}
