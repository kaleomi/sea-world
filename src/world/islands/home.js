// Tidewater, the home island: everything about it that is data rather than code. WorldLayout builds
// WORLD from the island being played, so a new island is a new file like this one (see index.js).
// Coordinates in metres, y up, sea level y = 0; the open ocean lies to the south (+z).
export default {
	id: 'home',
	name: 'Tidewater',
	seed: 7, // TerrainData's noise seed

	// Central sandy beach inside the bay, shoreline near z ≈ -42 at x = 0.
	beach: { xMin: - 150, xMax: 170 },
	pier: {
		x: 55,
		zStart: - 64, // on dry sand
		zEnd: 40, // end of pier (~4 m depth)
		deckHeight: 2.3, // deck surface above sea level
		width: 2.6,
		headWidth: 14, // T-shaped platform at the end
		headDepth: 7,
	},
	// Where the boat is moored: east side of the pier head, bow pointing south.
	boatDock: { x: 64.5, z: 36.5, heading: 0 },
	village: { x: 40, z: - 118, radius: 95 },
	reef: { x: - 78, z: 58, radius: 58 },
	spawn: { x: 18, z: - 60, yaw: Math.PI }, // kept clear of rocks, plants and debris
	// where the player starts: on the boardwalk up from the pier foot, looking down it toward the pier
	start: { x: 53.6, z: - 77, yaw: Math.PI },
	// incoming swell direction (travel direction, normalized by WorldLayout)
	swellDir: [ - 0.12, - 1 ],

	// the species that swim here (ids in game/FishTable.js) and the legends that hunt here
	// (ids in game/Legends.js); null means all of them. The pelagics (tuna, mahi) and two of the
	// legends live out at the other islands, to give the trip there a reason.
	species: [ 'silverside', 'mullet', 'needlefish', 'sergeant', 'grunt', 'yellowtail', 'chromis', 'tang', 'wrasse', 'parrot', 'angel', 'jack', 'barracuda', 'grouper', 'redSnapper', 'tarpon' ],
	legends: [ 'ironjaw', 'silverKing', 'thunderJack' ],
};
