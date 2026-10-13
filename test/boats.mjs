// The fleet (game/Boats.js): stats and upgrade tracks per boat, the sail polar, and each type's real
// hull (world/BoatModel.js) driven by the BoatController on a flat sea: top speeds in the right order,
// the sailboat sails across the wind, heels to leeward and can't sail into it.
//   node test/boats.mjs
import * as E from '../src/engine/index.js';
import { G } from '../src/core/Globals.js';
import { BOATS, BOAT_IDS, START_BOAT, boatStats, boatTrack, nextBoatLevel, boatLevelsFromJSON, sailCoefficients, sailForce, boomAngle, NO_GO } from '../src/game/Boats.js';
import { BoatModel, BOAT_LOOKS } from '../src/world/BoatModel.js';
import { BoatController } from '../src/player/BoatController.js';
import { GameState } from '../src/game/GameState.js';

let fails = 0;
const check = ( ok, msg ) => {

	console.log( ( ok ? 'ok   ' : 'FAIL ' ) + msg );
	if ( ! ok ) fails ++;

};

const DEG = Math.PI / 180;

// ---- data
check( BOAT_IDS.every( ( id ) => BOATS[ id ] && BOAT_LOOKS[ id ] ), 'every boat has stats and a look' );
check( BOATS[ START_BOAT ].price === 0 && BOATS[ START_BOAT ].sail, 'you start with the free sailboat' );
const prices = BOAT_IDS.map( ( id ) => BOATS[ id ].price );
check( prices.every( ( p, i ) => i === 0 || p > prices[ i - 1 ] ), `each boat costs more than the last (${ prices.join( ' / ' ) })` );
const st = Object.fromEntries( BOAT_IDS.map( ( id ) => [ id, boatStats( id ) ] ) );
check( st.sloop.fuelL === 0 && st.sloop.sail && ! boatTrack( 'sloop', 'fuel' ), 'the sailboat has no tank' );
check( st.workboat.holdKg === 30 && st.workboat.fuelL === 40 && st.workboat.speedMul === 1, 'the lobster boat starts as the old starting boat did (30 kg, 40 L)' );
check( st.trawler.holdKg > st.workboat.holdKg * 5 && st.trawler.fuelL >= 300, `the trawler carries the most (${ st.trawler.holdKg } kg, ${ st.trawler.fuelL } L)` );
check( st.speedboat.holdKg < 60, 'the speedboat has little room for fish' );
check( boatStats( 'workboat', { hold: 2, fuel: 1, engine: 2 } ).holdKg === 160 && boatStats( 'workboat', { hold: 2, fuel: 1, engine: 2 } ).fuelL === 80, 'levels give the level\'s stats' );
check( nextBoatLevel( 'sloop', { hold: 0 }, 'hold' ).holdKg === 70 && nextBoatLevel( 'sloop', { hold: 1 }, 'hold' ) === null && nextBoatLevel( 'sloop', {}, 'fuel' ) === null, 'next levels, maxed tracks and missing tracks' );
const cleaned = boatLevelsFromJSON( 'speedboat', { hold: 9, fuel: - 3, engine: 'x', tank: 12 } );
check( cleaned.hold === 1 && cleaned.fuel === 0 && cleaned.engine === 0 && cleaned.tank === 12, 'saved levels are clamped to the track' );

// ---- the sail polar
const c = ( a ) => sailCoefficients( a * DEG );
check( c( 0 ).drive === 0 && c( 25 ).drive === 0, 'head to wind and close to it the sails don\'t drive' );
check( c( 90 ).drive > c( 50 ).drive && c( 90 ).drive > c( 180 ).drive && c( 180 ).drive > 0.5, `best on a reach, less running (50° ${ c( 50 ).drive.toFixed( 2 ) }, 90° ${ c( 90 ).drive.toFixed( 2 ) }, 180° ${ c( 180 ).drive.toFixed( 2 ) })` );
check( c( 55 ).heel > c( 120 ).heel && c( 180 ).heel < 1e-6, 'sideways force is biggest close-hauled, none running' );
check( sailForce( 90 * DEG, 30, 20 ).drive === sailForce( 90 * DEG, 10, 20 ).drive && sailForce( 90 * DEG, 30, 20 ).reefed, 'a storm is reefed down to what a fresh breeze gives' );
check( boomAngle( 30 * DEG ) < boomAngle( 90 * DEG ) && boomAngle( 175 * DEG ) <= 80 * DEG + 1e-9, 'the boom eases out as the wind goes aft' );

// ---- driving the real hulls on a flat sea
const query = {
	n: 0, points: new Float32Array( 1024 * 4 ), cpu: new Float32Array( 1024 * 4 ), resultInputs: new Float32Array( 1024 * 4 ),
	cpuValid: false, version: 0, resultTime: 0, latency: 2 / 60, time: 0,
	allocate( name, n ) { const s = this.n; this.n += n; return s; },
	setPoint( i, x, z ) { this.points[ i * 4 ] = x; this.points[ i * 4 + 1 ] = z; },
	tick() {

		for ( let i = 0; i < this.n; i ++ ) {

			this.cpu[ i * 4 ] = 0; this.cpu[ i * 4 + 1 ] = 0; this.cpu[ i * 4 + 2 ] = 0;
			this.resultInputs[ i * 4 ] = this.points[ i * 4 ];
			this.resultInputs[ i * 4 + 1 ] = this.points[ i * 4 + 1 ];

		}

		this.cpuValid = true;
		this.version ++;
		this.resultTime = this.time;

	},
};
const terrain = { heightAt: () => - 200 };
const colliders = { boxes: [], groundHeightAt: () => - Infinity, resolveCapsule: () => false };
G.seaLevel.value = 0;

// heading: the boat's +Z in the world; wind: where the air goes (G.windDir), speed m/s
function drive( type, { sec = 70, throttle = 1, course = 0, wind = 7, windTo = Math.PI } = {} ) {

	const model = new BoatModel( type );
	const b = new BoatController( { model, query, terrain, colliders } );
	const B = BOATS[ type ];
	b.configure( B.physics, B.sail || 0 );
	G.windSpeed.value = wind;
	G.windDir.value.set( Math.sin( windTo ), Math.cos( windTo ) );
	b.position.set( 0, 0, 0 );
	b.quaternion.setFromAxisAngle( new E.Vector3( 0, 1, 0 ), course );
	b.moored = false;
	b.driven = true;
	const dt = 1 / 60;
	let heel = 0, speed = 0, n = 0;
	const fwd = new E.Vector3(), up = new E.Vector3();
	for ( let t = 0; t < sec; t += dt ) {

		query.time += dt;
		// hold the course with the rudder
		b.forward( fwd );
		let err = course - Math.atan2( fwd.x, fwd.z );
		err = Math.atan2( Math.sin( err ), Math.cos( err ) );
		b.setInput( throttle, Math.max( - 1, Math.min( 1, err * 3 - b.angular.y * 1.5 ) ), dt );
		b.queueQueries();
		b.update( dt );
		query.tick();
		if ( t > sec - 10 ) {

			up.set( 0, 1, 0 ).applyQuaternion( b.quaternion );
			heel += Math.atan2( new E.Vector3( 1, 0, 0 ).applyQuaternion( b.quaternion ).y, 1 );
			speed += b.velocity.dot( b.forward( fwd ) );
			n ++;

		}

	}

	query.n = 0;
	return { speed: speed / n, heel: heel / n / DEG, sailing: b.sailing, ok: b.isFinite() };

}

const top = {};
for ( const id of [ 'workboat', 'speedboat', 'trawler' ] ) top[ id ] = drive( id ).speed;
console.log( '     top speeds m/s:', Object.entries( top ).map( ( [ k, v ] ) => `${ k } ${ v.toFixed( 1 ) } (${ ( v * 1.944 ).toFixed( 0 ) } kn)` ).join( ', ' ) );
check( top.speedboat > top.workboat * 1.4, 'the speedboat is much the fastest' );
check( top.workboat > top.trawler && top.trawler > top.workboat * 0.7, 'the trawler is a little slower than the lobster boat' );
check( top.workboat > 9 && top.workboat < 12, 'the lobster boat keeps its old top speed' );

// the sailboat in a breeze (7 m/s) blowing toward -z (from the north... +z): course 0 = head to wind
const reach = drive( 'sloop', { course: 90 * DEG } );
const beat = drive( 'sloop', { course: 50 * DEG } );
const run = drive( 'sloop', { course: 180 * DEG } );
const irons = drive( 'sloop', { course: 0 } );
const calm = drive( 'sloop', { course: 90 * DEG, wind: 0 } );
const fresh = drive( 'sloop', { course: 90 * DEG, wind: 12 } );
console.log( `     sailboat m/s: reach ${ reach.speed.toFixed( 2 ) }, close-hauled ${ beat.speed.toFixed( 2 ) }, running ${ run.speed.toFixed( 2 ) }, in irons ${ irons.speed.toFixed( 2 ) }, calm ${ calm.speed.toFixed( 2 ) }, fresh breeze ${ fresh.speed.toFixed( 2 ) }; heel reach ${ reach.heel.toFixed( 1 ) }°, beat ${ beat.heel.toFixed( 1 ) }°` );
check( [ reach, beat, run, irons, calm, fresh ].every( ( r ) => r.ok ), 'the sailboat integrates cleanly' );
check( reach.speed > 2.6 && reach.speed < 4.5, 'a beam reach makes a few knots' );
check( reach.speed > beat.speed && reach.speed > run.speed && beat.speed > irons.speed + 0.5, 'reaching beats running and beating; head to wind it barely moves' );
check( irons.sailing && irons.sailing.irons, 'head to wind it reports being in irons' );
check( calm.speed > 0.6 && calm.speed < 1.8, 'the little motor gets you home in a calm' );
check( fresh.speed >= reach.speed && fresh.speed < 5.5, 'a fresh breeze is faster, but the hull speed caps it' );
check( Math.abs( beat.heel ) > 3 && Math.abs( beat.heel ) < 25, `close-hauled it heels (${ beat.heel.toFixed( 1 ) }°)` );
check( top.workboat > reach.speed * 2, 'the lobster boat is far quicker than the sailboat' );
const sideReach = drive( 'sloop', { course: - 90 * DEG, sec: 30 } );
check( reach.sailing.side === - sideReach.sailing.side, 'the boom goes out on the side away from the wind' );

// ---- the fleet in the save
{

	const fresh = new GameState( null );
	check( fresh.boat === 'sloop' && fresh.stats.sail && fresh.stats.fuelL === 0 && fresh.stats.holdKg === 30, 'a new game starts in the sailboat' );
	const v1 = { v: 1, money: 2000, inventory: [], log: {}, upgrades: { hold: 2, fuel: 1, engine: 1, reel: 2 }, fuel: 33, nextId: 1 };
	const old = new GameState( { getItem: ( k ) => k === 'tidewater.save.v1' ? JSON.stringify( v1 ) : null, setItem: () => {} } );
	check( old.load() && old.boat === 'workboat' && old.owns( 'sloop' ), 'an old save keeps the lobster boat and gets the sailboat' );
	check( old.stats.holdKg === 160 && old.stats.fuelL === 80 && old.stats.speedMul === 1.15 && Math.abs( old.fuelL - 33 ) < 1e-9 && old.stats.reelSpeed === 2.2, 'with its hold, tank, engine, the fuel in it, and the reel' );
	check( old.switchBoat( 'sloop' ) && old.stats.holdKg === 30 && old.stats.fuelL === 0 && old.holdWord === 'Cooler', 'the sailboat has its own (lower) levels' );
	check( old.switchBoat( 'workboat' ) && old.stats.holdKg === 160 && Math.abs( old.fuelL - 33 ) < 1e-9 && old.holdWord === 'Hold', 'and switching back finds the lobster boat as it was' );
	check( old.buyBoat( 'speedboat' ) === null && old.money === 2000, 'a boat you can\'t afford stays in the shop' );
	old.money = 7000;
	check( old.buyBoat( 'speedboat' ) === 'speedboat' && old.money === 1000 && old.boat === 'speedboat' && old.fuelL === 80, 'buying a boat: paid for, taken, tank full' );
	check( old.buyBoat( 'speedboat' ) === null, 'you can\'t buy a boat twice' );
	check( old.buy( 'hold' ) && old.stats.holdKg === 100 && old.fleet.workboat.hold === 2, 'upgrades go on the boat you\'re in' );
	const m = new Map();
	const a = new GameState( { getItem: ( k ) => m.get( k ) ?? null, setItem: ( k, v ) => m.set( k, v ) } );
	a.money = 30000;
	a.buyBoat( 'trawler' );
	a.burn( 50 );
	a.switchBoat( 'sloop' );
	const b = new GameState( { getItem: ( k ) => m.get( k ) ?? null, setItem: () => {} } );
	check( b.load() && b.boat === 'sloop' && b.owns( 'trawler' ) && b.switchBoat( 'trawler' ) && Math.abs( b.fuelL - 250 ) < 1e-6, 'the fleet and each tank survive a reload' );

}

console.log( fails ? `\n${ fails } FAILED` : '\nall ok' );
process.exit( fails ? 1 : 0 );
