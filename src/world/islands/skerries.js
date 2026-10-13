// The Skerries: a scatter of small hilly islets on one shallow bank to the north-west, with broken
// reefs round every one of them: the richest reef fishing in the archipelago. (See index.js.)
export default {
	id: 'skerries',
	name: 'The Skerries',
	seed: 83,
	position: { x: - 2300, z: - 2000 },
	size: 1024,
	res: 1024,
	terrain: { kind: 'cluster', count: 7, spread: 300, peak: 30, bankDepth: 6, warp: 0.15 },
	species: [ 'chromis', 'tang', 'parrot', 'angel', 'wrasse', 'sergeant', 'yellowtail', 'grunt', 'grouper', 'barracuda', 'jack', 'redSnapper' ],
	legends: [ 'rainbowEmperor' ],
};
