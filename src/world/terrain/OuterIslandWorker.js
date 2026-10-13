import { OuterIsland, outerSnapshot } from './OuterIsland.js';

// Generates one outer island off the main thread (world/terrain/OuterIslands.js): { def } in, the
// generated grids (outerSnapshot, transferred) out.
self.onmessage = ( e ) => {

	try {

		const snap = outerSnapshot( new OuterIsland( e.data.def ) );
		self.postMessage( { snap }, Object.values( snap ).filter( ( v ) => v && v.buffer ).map( ( v ) => v.buffer ) );

	} catch ( err ) {

		self.postMessage( { error: String( err && err.message || err ) } );

	}

};
