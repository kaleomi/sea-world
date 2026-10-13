// Long Cay: a long, low sand cay to the north, curving across the swell, with dunes down its spine,
// wide seagrass flats on its lee (north) and patch reefs off the windward shore facing home. (See index.js.)
export default {
	id: 'longcay',
	name: 'Long Cay',
	seed: 131,
	position: { x: - 200, z: - 3000 },
	size: 1024,
	res: 1024,
	terrain: { kind: 'bar', length: 600, width: 80, dune: 9, axis: 0.35, bend: 0.0006, lee: - 1, flats: 160, warp: 0 },
	species: [ 'silverside', 'mullet', 'needlefish', 'jack', 'tarpon', 'barracuda', 'grunt', 'wrasse', 'yellowtail', 'sergeant' ],
	legends: [ 'kingHog' ],
};
