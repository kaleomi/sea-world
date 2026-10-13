// Eagle Rock: a flat-topped island to the south, ringed by sea cliffs, with sea stacks offshore and
// one beach cove on the side facing home. Deep blue water right under the cliffs. (See index.js.)
const position = { x: - 700, z: 2900 };
export default {
	id: 'mesa',
	name: 'Eagle Rock',
	seed: 101,
	position,
	size: 1024,
	res: 1024,
	terrain: { kind: 'mesa', radius: 215, height: 62, peak: 62, treeline: 140, cove: Math.atan2( - position.z, - position.x ), coveRadius: 105, stacks: 5, warp: 0.14 },
	species: [ 'tuna', 'mahi', 'redSnapper', 'grouper', 'barracuda', 'jack', 'yellowtail', 'wrasse' ],
	legends: [ 'ironFin' ],
};
