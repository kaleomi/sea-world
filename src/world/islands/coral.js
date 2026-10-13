// Coral Atoll: a ring of reef and sandy islets round a turquoise lagoon, out to the south-east.
// Reef fish in the lagoon, the big pelagics off the outer wall. (See index.js for the fields.)
export default {
	id: 'coral',
	name: 'Coral Atoll',
	seed: 23,
	position: { x: 2400, z: 1600 }, // world metres; the home island sits at the origin
	size: 1024, // heightmap domain (m)
	res: 1024,
	terrain: { kind: 'atoll', radius: 300, ringWidth: 70, lagoonDepth: 7, motu: 0.02, warp: 0.16 },
	species: [ 'yellowtail', 'chromis', 'tang', 'parrot', 'angel', 'wrasse', 'sergeant', 'grunt', 'barracuda', 'grouper', 'tuna', 'mahi', 'redSnapper' ],
	legends: [ 'reefGhost' ],
};
