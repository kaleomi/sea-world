// The quest givers on the outer islands: one person on each, with a chain of jobs handed out one at a
// time. A job asks for fish from the cooler (a species, how many, how heavy at least) or for a legend
// on the trophy wall (Legends.js), and pays a reward. Plain data and pure functions; GameState keeps the
// progress ({ giver id: jobs done }), Game places the people (beachSpot) and GameHUD shows the panel.
//   const job = currentQuest( 'nalu', state.quests );  questReady( job, inventory, legends )
//   const r = completeQuest( 'nalu', state.quests, inventory, legends )  → { quest, fish, reward } | null

export const GIVERS = {

	nalu: {
		id: 'nalu',
		island: 'coral',
		name: 'Nalu · Reef keeper',
		greeting: 'The reef feeds the whole atoll. Help me keep an eye on it.',
		done: 'The reef has never looked better. Come and fish the lagoon any time.',
		look: { shirt: 0x2f8f8a, trousers: 0x2e3a44, apron: 0xe8d9b0, hat: 0xd9c38a, hair: 0x1e1712, skin: 0x8a5a3c },
		quests: [
			{ id: 'colours', title: 'Colours of the reef', text: 'I count the small reef fish every season. Bring me some to look at.', needs: [ { species: 'tang', count: 2, minKg: 0.2 }, { species: 'chromis', count: 2, minKg: 0.03 } ], reward: 120 },
			{ id: 'parrots', title: 'The sand makers', text: 'Parrotfish grind the coral into our white sand. Are the big ones still about?', needs: [ { species: 'parrot', count: 2, minKg: 1.5 } ], reward: 180 },
			{ id: 'lagoon', title: 'Queen of the lagoon', text: 'A queen angelfish and a good hogfish, both from the lagoon.', needs: [ { species: 'angel', count: 1, minKg: 0.9 }, { species: 'wrasse', count: 1, minKg: 2 } ], reward: 260 },
			{ id: 'hunters', title: 'Hunters on the wall', text: 'Barracuda patrol the outer wall. Two big ones tell me the reef is healthy.', needs: [ { species: 'barracuda', count: 2, minKg: 6 } ], reward: 380 },
			{ id: 'ghost', title: 'The Reef Ghost', text: 'There is one barracuda nobody has landed. A pale shadow off the wall at dusk. Find it.', legend: 'reefGhost', reward: 600 },
		],
	},

	tama: {
		id: 'tama',
		island: 'ember',
		name: 'Tama · Smokehouse',
		greeting: 'Smoke and salt, that\'s Ember Island. I always need more fish for the racks.',
		done: 'The racks are full for the season. You\'re a real fisher.',
		look: { shirt: 0x7a3a24, trousers: 0x2c2724, apron: 0x4a3a2c, hat: 0x3a3330, hair: 0x2a2420, skin: 0x7a5236 },
		quests: [
			{ id: 'mullet', title: 'Fish for the racks', text: 'Mullet smoke beautifully. Three, and not tiddlers.', needs: [ { species: 'mullet', count: 3, minKg: 0.8 } ], reward: 110 },
			{ id: 'snapper', title: 'Red for the market', text: 'Smoked red snapper sells out every time. Two good ones.', needs: [ { species: 'redSnapper', count: 2, minKg: 3 } ], reward: 220 },
			{ id: 'fillets', title: 'Thick fillets', text: 'A Nassau grouper and a couple of jacks for the big rack.', needs: [ { species: 'grouper', count: 1, minKg: 6 }, { species: 'jack', count: 2, minKg: 3 } ], reward: 320 },
			{ id: 'tuna', title: 'Tuna steaks', text: 'The tuna run past the island. Bring me two heavy ones.', needs: [ { species: 'tuna', count: 2, minKg: 6 } ], reward: 420 },
			{ id: 'tarpon', title: 'Silver giant', text: 'A tarpon, a proper one. Off the west side where the water drops away.', needs: [ { species: 'tarpon', count: 1, minKg: 25 } ], reward: 520 },
			{ id: 'bigRed', title: 'Big Red', text: 'The old fishers talk about a red snapper the size of a child. Prove it\'s real.', legend: 'bigRed', reward: 700 },
		],
	},

};

export const GIVER_IDS = Object.keys( GIVERS );

// progress: giver id -> jobs done (a count), from a save
export function questsFromJSON( d ) {

	const out = {};
	for ( const id of GIVER_IDS ) {

		const n = d && Number.isFinite( d[ id ] ) ? Math.floor( d[ id ] ) : 0;
		out[ id ] = Math.max( 0, Math.min( GIVERS[ id ].quests.length, n ) );

	}

	return out;

}

// the job a giver has for you now, or null when you've done them all
export function currentQuest( id, progress ) {

	const g = GIVERS[ id ];
	return g ? g.quests[ progress[ id ] | 0 ] || null : null;

}

// fish from `inventory` that would go to one need: the cheapest that qualify, at most `count`
export function fishFor( need, inventory, taken = new Set() ) {

	return inventory.filter( ( f ) => ! taken.has( f.id ) && f.species === need.species && f.kg >= need.minKg - 1e-6 )
		.sort( ( a, b ) => ( a.value ?? 0 ) - ( b.value ?? 0 ) || a.kg - b.kg ).slice( 0, need.count );

}

// per need: { need, have }, and the fish that would be handed over
export function questProgress( quest, inventory, legends = {} ) {

	if ( quest.legend ) {

		const have = ( legends[ quest.legend ]?.count | 0 ) > 0 ? 1 : 0;
		return { rows: [ { legend: quest.legend, have, count: 1 } ], fish: [], ready: have > 0 };

	}

	const taken = new Set(), rows = [];
	for ( const need of quest.needs ) {

		const fish = fishFor( need, inventory, taken );
		for ( const f of fish ) taken.add( f.id );
		rows.push( { need, have: fish.length, count: need.count } );

	}

	return { rows, fish: inventory.filter( ( f ) => taken.has( f.id ) ), ready: rows.every( ( r ) => r.have >= r.count ) };

}

export function questReady( quest, inventory, legends ) {

	return !! quest && questProgress( quest, inventory, legends ).ready;

}

// hand in the current job: advances `progress` and returns { quest, fish (to take out of the
// cooler), reward, last (the chain is finished) }, or null when it isn't ready
export function completeQuest( id, progress, inventory, legends ) {

	const quest = currentQuest( id, progress );
	if ( ! quest ) return null;
	const p = questProgress( quest, inventory, legends );
	if ( ! p.ready ) return null;
	progress[ id ] = ( progress[ id ] | 0 ) + 1;
	return { quest, fish: p.fish, reward: quest.reward, last: ! currentQuest( id, progress ) };

}

// where a giver stands: walking in from the rim of island `isl` (an OuterIsland: cx, cz, size,
// heightAt) along the bearing to (tx, tz), or near it, the first dry and level ground with land behind
// it, a few metres up the beach. { x, y, z, yaw (facing the sea) } or null.
export function beachSpot( isl, tx = 0, tz = 0 ) {

	const base = Math.atan2( tz - isl.cz, tx - isl.cx );
	for ( let k = 0; k < 37; k ++ ) {

		const ang = base + ( k % 2 ? 1 : - 1 ) * Math.ceil( k / 2 ) * 0.17;
		const dx = Math.cos( ang ), dz = Math.sin( ang );
		for ( let r = isl.size / 2 - 20; r > 20; r -= 1 ) {

			const x = isl.cx + dx * r, z = isl.cz + dz * r;
			if ( isl.heightAt( x, z ) < 0.9 ) continue;
			const sx = x - dx * 3, sz = z - dz * 3, sh = isl.heightAt( sx, sz );
			let flat = sh > 0.9 && sh < 6;
			for ( let a = 0; a < 8 && flat; a ++ ) if ( Math.abs( isl.heightAt( sx + Math.cos( a * Math.PI / 4 ) * 2.5, sz + Math.sin( a * Math.PI / 4 ) * 2.5 ) - sh ) > 0.9 ) flat = false;
			if ( flat && isl.heightAt( x - dx * 9, z - dz * 9 ) > 0.5 ) return { x: sx, y: sh, z: sz, yaw: Math.atan2( dx, dz ) };
			break;

		}

	}

	return null;

}
