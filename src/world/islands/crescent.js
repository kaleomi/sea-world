// Crescent Isle: a horseshoe ridge to the east-north-east, its sheltered bay opening toward the home
// island. Jacks and tarpon in the bay, houndfish over the sand at night, the pelagics off the back.
// (See index.js for the fields.)
const position = { x: 2900, z: - 900 };
export default {
	id: 'crescent',
	name: 'Crescent Isle',
	seed: 57,
	position,
	size: 1024,
	res: 1024,
	terrain: { kind: 'crescent', radius: 250, width: 85, peak: 46, bayDepth: 7, gap: 0.7, opening: Math.atan2( - position.z, - position.x ), warp: 0.12 },
	species: [ 'mullet', 'needlefish', 'jack', 'tarpon', 'grunt', 'yellowtail', 'sergeant', 'barracuda', 'wrasse', 'mahi', 'tuna' ],
	legends: [ 'silverNeedle' ],
};
