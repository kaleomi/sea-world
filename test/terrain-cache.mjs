// Plain-node tests of the terrain cache (no GPU, no IndexedDB): a terrain built from a snapshot is the
// generated one, the snapshot is a copy the village can't change, and a stale or damaged snapshot is
// refused. src/world/TerrainCache.js, src/world/TerrainData.js.
import { TerrainData } from '../src/world/TerrainData.js';
import { TERRAIN_FIELDS, terrainSnapshot, validSnapshot, terrainCacheKey, loadTerrain, saveTerrain } from '../src/world/TerrainCache.js';

let fails = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else console.log( 'ok  ', msg );

};

const equal = ( a, b ) => a.length === b.length && a.every( ( v, i ) => v === b[ i ] );

let t = performance.now();
const gen = new TerrainData( 7 );
const genMs = performance.now() - t;
const snap = terrainSnapshot( gen );
ok( validSnapshot( snap, gen.res ), 'a fresh snapshot is valid' );

t = performance.now();
const cached = new TerrainData( 7, snap );
const cachedMs = performance.now() - t;
ok( cached.fromCache && ! gen.fromCache, 'the snapshot is used instead of generating' );
ok( TERRAIN_FIELDS.every( ( [ name ] ) => equal( cached[ name ], gen[ name ] ) ), 'every grid matches the generated one' );
ok( JSON.stringify( cached.rockSites ) === JSON.stringify( gen.rockSites ), 'rock sites match' );
ok( equal( cached.mmMin, gen.mmMin ) && equal( cached.mmMax, gen.mmMax ), 'the culling pyramid is rebuilt the same' );
let same = true;
for ( let i = 0; i < 200; i ++ ) {

	const x = ( i * 37.3 ) % 900 - 450, z = ( i * 91.7 ) % 900 - 450;
	if ( cached.heightAt( x, z ) !== gen.heightAt( x, z ) ) same = false;

}

ok( same, 'heightAt agrees at 200 points' );
ok( cachedMs < genMs / 5, `loading is much faster than generating (${ cachedMs.toFixed( 0 ) } ms vs ${ genMs.toFixed( 0 ) } ms)` );

// the village flattens pads into the live grids after the snapshot is taken
gen.heights[ 1000 ] += 5;
gen.rockSites[ 0 ].h += 1;
ok( snap.heights[ 1000 ] !== gen.heights[ 1000 ] && snap.rockSites[ 0 ].h !== gen.rockSites[ 0 ].h, 'the snapshot is a copy, not a view' );

ok( ! validSnapshot( { ...snap, res: gen.res / 2 }, gen.res ), 'a snapshot of another resolution is refused' );
ok( ! validSnapshot( { ...snap, sand: new Uint8Array( 4 ) }, gen.res ), 'a truncated grid is refused' );
ok( ! validSnapshot( { ...snap, heights: new Uint8Array( gen.res * gen.res ) }, gen.res ), 'a grid of the wrong type is refused' );
ok( ! validSnapshot( null, gen.res ) && ! validSnapshot( {}, gen.res ), 'nothing stored is refused' );

// node has neither the build hash nor IndexedDB: the cache stays out of the way
ok( terrainCacheKey( 7 ) === null, 'no cache key outside a production build' );
ok( await loadTerrain( 'terrain:7:x' ) === null && await saveTerrain( 'terrain:7:x', snap ) === false, 'no IndexedDB: load and save just fail quietly' );

console.log( fails ? `${ fails } FAILED` : 'all passed' );
process.exit( fails ? 1 : 0 );
