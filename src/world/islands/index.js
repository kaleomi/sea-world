import home from './home.js';
import coral from './coral.js';
import ember from './ember.js';

// Every island in the archipelago, by id. An island is plain data: where it lies in the shared sea,
// how its terrain is made, and which fish and legends live there. The home island (home.js) is the
// hand-built one at the world origin that WorldLayout builds WORLD from; the others are generated
// (world/terrain/OuterIsland.js) from their `terrain` recipe:
//
//   id, name, seed      key, display name, noise seed
//   position { x, z }   centre in the world (m); size, res: heightmap domain (m) and texels per side
//   terrain             { kind: 'atoll' | 'volcanic', ... } (see OuterIsland)
//   species, legends    ids from game/FishTable.js and game/Legends.js (null: all of them)
export const ISLANDS = { [ home.id ]: home, [ coral.id ]: coral, [ ember.id ]: ember };

export const HOME_ISLAND = home.id;

// the generated islands, out in the sea round the home island
export const OUTER_ISLANDS = Object.values( ISLANDS ).filter( ( d ) => d.id !== HOME_ISLAND );

// the open sea between the islands (outside every island's grid): only the pelagics, no legends
export const OPEN_SEA = { id: 'sea', name: 'Open sea', species: [ 'tuna', 'mahi', 'barracuda', 'redSnapper', 'jack' ], legends: [] };

// the island definition for an id (the home island for anything unknown)
export function islandById( id ) {

	return ISLANDS[ id ] || ISLANDS[ HOME_ISLAND ];

}
