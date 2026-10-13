import { defineConfig } from 'vite';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';

// the sources TerrainData.generate() depends on: their hash keys the browser's terrain cache
// (src/world/TerrainCache.js), so a build that changes the terrain never reads an old one
const TERRAIN_SOURCES = [
	'src/world/TerrainData.js', 'src/world/TerrainCache.js', 'src/world/WorldLayout.js', 'src/util/Noise.js',
	'src/world/terrain/OuterIsland.js',
	'src/world/terrain/TerrainNoise.js', 'src/world/terrain/IslandShape.js',
	...readdirSync( 'src/world/islands' ).map( ( f ) => `src/world/islands/${ f }` ),
	...readdirSync( 'src/engine/math' ).map( ( f ) => `src/engine/math/${ f }` ),
];

function terrainHash() {

	const h = createHash( 'sha256' );
	for ( const f of TERRAIN_SOURCES ) h.update( f ).update( readFileSync( f ) );
	return h.digest( 'hex' ).slice( 0, 16 );

}

export default defineConfig( ( { command } ) => ( {
	// relative asset paths: the build runs from any sub-path (GitHub Pages serves it under /tidewater/)
	base: './',
	build: { target: 'esnext', chunkSizeWarningLimit: 4000 },
	server: { port: 5189, strictPort: true, host: '127.0.0.1' },
	// builds only: the dev server leaves it undefined, so terrain edits always regenerate
	define: command === 'build' ? { __TIDEWATER_TERRAIN_HASH__: JSON.stringify( terrainHash() ) } : {},
} ) );
