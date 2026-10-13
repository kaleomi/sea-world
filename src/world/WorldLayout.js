import * as THREE from '../engine/index.js';
import { islandById, HOME_ISLAND } from './islands/index.js';

// Shared world layout, built from the island being played (its data lives in islands/).
// Coordinates in meters, y up, sea level y = 0.
// The open ocean lies to the south (+z); the island to the north (-z).
// Sun rises in the east (+x) and sets in the west (-x).
export function buildLayout( island ) {

	const v3 = ( p ) => new THREE.Vector3( p.x, 0, p.z );
	return {
		island,
		terrainSize: 2048, // heightmap domain, centered at origin
		terrainRes: 2048,
		beach: { ...island.beach },
		pier: { ...island.pier },
		boatDock: { position: v3( island.boatDock ), heading: island.boatDock.heading },
		village: { center: v3( island.village ), radius: island.village.radius },
		reef: { center: v3( island.reef ), radius: island.reef.radius },
		spawn: { position: v3( island.spawn ), yaw: island.spawn.yaw },
		start: { position: v3( island.start ), yaw: island.start.yaw },
		swellDir: new THREE.Vector2( island.swellDir[ 0 ], island.swellDir[ 1 ] ).normalize(),
	};

}

export const WORLD = buildLayout( islandById( HOME_ISLAND ) );
