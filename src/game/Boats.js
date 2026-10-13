import { UPGRADES } from './Gear.js';

// The fleet: the boats you can own, what they cost and how they go. Every boat shares the hull (the
// 8.2 m lines in world/boat/HullLines.js) and differs in its rig and gear (world/BoatModel.js builds
// each look), its engine or sails, tank and hold. Each owned boat keeps its own upgrade levels on the
// three boat tracks (hold, fuel, engine); the rod, reel, line, fish finder and lights stay with you.
//
// You start with the sailboat: no fuel to buy, the wind does the work (and a small electric motor gets
// you out of irons or a calm). The lobster boat is the old starting boat; saves from before the fleet
// keep it, with its upgrades, and get the sailboat too.
//   BOATS[ id ]  boatStats( id, levels )  boatTrack( id, key )  sailForce( angle, apparent )
// Pure, no engine imports (test/boats.mjs).

export const BOAT_IDS = [ 'sloop', 'workboat', 'speedboat', 'trawler' ];
export const START_BOAT = 'sloop';
export const BOAT_TRACKS = [ 'hold', 'fuel', 'engine' ];

// knots: about how fast it goes flat out (shown in the shop; the sailboat on a reach in a breeze).
// physics: maxThrust (N, bollard pull), pitchSpeed (m/s, thrust falls to nothing there), mass (x the
// hull's design displacement), roll (x the roll damping), burn (x the lobster boat's fuel burn).
// A sailboat's `sail` is its working sail area (m^2); `thrust` is then the little motor.
export const BOATS = {
	sloop: {
		name: 'Sailboat', price: 0, sail: 24, knots: 6,
		blurb: 'Slow, but the wind is free. Can\'t sail into the wind: tack across it.',
		physics: { maxThrust: 900, pitchSpeed: 1.5, mass: 0.85, roll: 1.4, burn: 0, ballast: 9000 },
		tracks: {
			hold: { name: 'Fish hold', levels: [
				{ cost: 0, label: 'Cooler', holdKg: 30 },
				{ cost: 120, label: 'Ice chest', holdKg: 70 },
			] },
			engine: { name: 'Sails', levels: [
				{ cost: 0, label: 'Old cotton sails', speedMul: 1 },
				{ cost: 250, label: 'New dacron sails', speedMul: 1.15 },
				{ cost: 650, label: 'Racing sails', speedMul: 1.3 },
			] },
		},
	},
	workboat: {
		name: 'Lobster boat', price: 1500, knots: 19,
		blurb: 'A steady diesel workboat. Reaches the outer islands and back on a tank.',
		physics: { maxThrust: 26000, pitchSpeed: 16, mass: 1, roll: 1, burn: 1 },
		tracks: { hold: UPGRADES.hold, fuel: UPGRADES.fuel, engine: UPGRADES.engine },
	},
	speedboat: {
		name: 'Speedboat', price: 6000, knots: 32,
		blurb: 'Twin outboards: by far the fastest, but thirsty and with little room for fish.',
		physics: { maxThrust: 64000, pitchSpeed: 25, mass: 0.8, roll: 1, burn: 2.6 },
		tracks: {
			hold: { name: 'Fish hold', levels: [
				{ cost: 0, label: 'Fish box', holdKg: 45 },
				{ cost: 350, label: 'Insulated fish box', holdKg: 100 },
			] },
			fuel: { name: 'Fuel tank', levels: [
				{ cost: 0, label: '80 L tank', fuelL: 80 },
				{ cost: 400, label: '160 L tank', fuelL: 160 },
			] },
			engine: { name: 'Engine', levels: [
				{ cost: 0, label: 'Twin 150 hp outboards', speedMul: 1 },
				{ cost: 1800, label: 'Twin 250 hp outboards', speedMul: 1.12 },
			] },
		},
	},
	trawler: {
		name: 'Trawler', price: 20000, knots: 18,
		blurb: 'A heavy ocean fishing boat: huge hold and tank for the deep sea and the trench, steady in a storm.',
		physics: { maxThrust: 30000, pitchSpeed: 12.5, mass: 1.6, roll: 1.8, burn: 1.5 },
		tracks: {
			hold: { name: 'Fish hold', levels: [
				{ cost: 0, label: 'Refrigerated hold', holdKg: 320 },
				{ cost: 2500, label: 'Big refrigerated hold', holdKg: 650 },
			] },
			fuel: { name: 'Fuel tank', levels: [
				{ cost: 0, label: '300 L tank', fuelL: 300 },
				{ cost: 1200, label: '600 L tank', fuelL: 600 },
			] },
			engine: { name: 'Engine', levels: [
				{ cost: 0, label: 'Main diesel', speedMul: 1 },
				{ cost: 2200, label: 'Turbo main diesel', speedMul: 1.12 },
			] },
		},
	},
};

export const isBoat = ( id ) => Object.prototype.hasOwnProperty.call( BOATS, id );

// a boat's upgrade track (null: the sailboat has no tank)
export function boatTrack( id, key ) {

	return ( BOATS[ id ] && BOATS[ id ].tracks[ key ] ) || null;

}

// a newly bought boat: every track at its first level, the tank full
export function newBoatLevels() {

	return { hold: 0, fuel: 0, engine: 0, tank: null };

}

// a saved boat's levels, cleaned (unknown or out-of-range levels drop to what's valid)
export function boatLevelsFromJSON( id, d ) {

	const out = newBoatLevels();
	if ( ! d || typeof d !== 'object' ) return out;
	for ( const k of BOAT_TRACKS ) {

		const tr = boatTrack( id, k );
		out[ k ] = tr ? Math.max( 0, Math.min( tr.levels.length - 1, d[ k ] | 0 ) ) : 0;

	}

	out.tank = Number.isFinite( d.tank ) && d.tank >= 0 ? d.tank : null;
	return out;

}

// the next level of a boat track, or null when maxed (or there is no such track)
export function nextBoatLevel( id, levels, key ) {

	const tr = boatTrack( id, key );
	if ( ! tr ) return null;
	const i = ( levels[ key ] | 0 ) + 1;
	return i < tr.levels.length ? { index: i, ...tr.levels[ i ] } : null;

}

// what the boat gives at its levels: holdKg, fuelL (0 for the sailboat), speedMul, plus the type
export function boatStats( id, levels = newBoatLevels() ) {

	const b = BOATS[ id ] || BOATS.workboat;
	const s = { boat: isBoat( id ) ? id : 'workboat', sail: !! b.sail, holdKg: 0, fuelL: 0, speedMul: 1 };
	for ( const k of BOAT_TRACKS ) {

		const tr = b.tracks[ k ];
		if ( ! tr ) continue;
		const lv = tr.levels[ Math.max( 0, Math.min( tr.levels.length - 1, levels[ k ] | 0 ) ) ];
		for ( const [ key, v ] of Object.entries( lv ) ) if ( key !== 'cost' && key !== 'label' ) s[ key ] = v;

	}

	return s;

}

// ---- sailing
// Sail coefficients by the angle between the bow and where the apparent wind comes from (0 = head to
// wind, PI = dead astern): `drive` pushes the boat along, `heel` pushes it sideways (and over). Inside
// the no-go zone (~40 degrees either side of the wind) the sails just flog.
export const NO_GO = 38 * Math.PI / 180;
const DEG = Math.PI / 180;
const sstep = ( a, b, x ) => {

	const t = Math.min( 1, Math.max( 0, ( x - a ) / ( b - a ) ) );
	return t * t * ( 3 - 2 * t );

};

export function sailCoefficients( angle ) {

	const a = Math.abs( angle );
	const on = sstep( NO_GO - 6 * DEG, NO_GO + 14 * DEG, a ); // sails fill once off the wind
	// best on a beam reach, a little less running dead downwind
	const drive = on * ( 0.55 + 0.6 * Math.sin( Math.min( a, 110 * DEG ) * 90 / 110 ) - 0.35 * sstep( 110 * DEG, 180 * DEG, a ) );
	// sideways: strongest close-hauled, nothing running
	const heel = on * 1.15 * Math.max( 0, Math.cos( ( a - NO_GO ) / ( Math.PI - NO_GO ) * Math.PI / 2 ) );
	return { drive, heel };

}

// apparent wind past this is reefed away (a storm doesn't drive the boat any harder)
export const REEF_AT = 10;
const RHO_AIR = 1.2;

// sail forces (N) for `area` m^2 at `angle` off the apparent wind of `speed` m/s
export function sailForce( angle, speed, area ) {

	const v = Math.min( speed, REEF_AT );
	const q = 0.5 * RHO_AIR * v * v * area;
	const c = sailCoefficients( angle );
	return { drive: q * c.drive, side: q * c.heel, reefed: speed > REEF_AT };

}

// where the boom sits (radians off the centreline, toward the side away from the wind): eased out
// as the wind goes aft, close in when beating; flogging near the centre in irons
export function boomAngle( angle ) {

	const a = Math.abs( angle );
	return Math.min( 80 * DEG, Math.max( 6 * DEG, ( a - 20 * DEG ) * 0.62 ) );

}
