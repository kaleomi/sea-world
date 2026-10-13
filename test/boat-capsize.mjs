// Capsize guard test (node, no GPU). Drives the BoatController with a violent, steep crossing
// sea — the kind that lays a small boat right over — and checks that:
//   - with the guard disabled the hull really does go past the point of no return (so the test
//     scenario is genuine, not a no-op),
//   - with the guard on the boat is never rolled past the capsize limit and rights itself once
//     the sea calms.
//   node test/boat-capsize.mjs
import * as E from '../src/engine/index.js';
import { TerrainData } from '../src/world/TerrainData.js';
import { BoatController } from '../src/player/BoatController.js';

let fails = 0;
const check = ( ok, msg ) => {

	console.log( ( ok ? 'ok   ' : 'FAIL ' ) + msg );
	if ( ! ok ) fails ++;

};

const terrain = new TerrainData();

// ---- violent sea: three crossing wave trains, short and tall (max slope > 1)
let time = 0, storm = 1;
const swell = ( x, z, t ) => storm * ( 1.25 * Math.sin( 0.55 * x + 2.1 * t ) + 0.9 * Math.sin( 0.42 * z - 1.7 * t ) + 0.5 * Math.sin( 0.9 * ( x + z ) + 3.0 * t ) );
const grad = ( x, z, t ) => {

	const gx = storm * ( 1.25 * 0.55 * Math.cos( 0.55 * x + 2.1 * t ) + 0.5 * 0.9 * Math.cos( 0.9 * ( x + z ) + 3.0 * t ) );
	const gz = storm * ( 0.9 * 0.42 * Math.cos( 0.42 * z - 1.7 * t ) + 0.5 * 0.9 * Math.cos( 0.9 * ( x + z ) + 3.0 * t ) );
	return [ gx, gz ];

};

const query = {
	n: 0, points: new Float32Array( 1024 * 4 ), cpu: new Float32Array( 1024 * 4 ), resultInputs: new Float32Array( 1024 * 4 ),
	cpuValid: false, version: 0, resultTime: 0, latency: 2 / 60,
	allocate( name, n ) { const s = this.n; this.n += n; return s; },
	setPoint( i, x, z ) { this.points[ i * 4 ] = x; this.points[ i * 4 + 1 ] = z; },
	tick() {

		for ( let i = 0; i < this.n; i ++ ) {

			const x = this.points[ i * 4 ], z = this.points[ i * 4 + 1 ];
			const [ gx, gz ] = grad( x, z, time );
			const l = Math.hypot( gx, 1, gz );
			this.cpu[ i * 4 ] = swell( x, z, time );
			this.cpu[ i * 4 + 1 ] = - gx / l;
			this.cpu[ i * 4 + 2 ] = - gz / l;
			this.resultInputs[ i * 4 ] = x;
			this.resultInputs[ i * 4 + 1 ] = z;

		}

		this.cpuValid = true;
		this.version ++;
		this.resultTime = time;

	},
};
const colliders = { boxes: [], groundHeightAt: () => - Infinity, resolveCapsule: () => false };

// 8.2 m hull as a 5 x 3 waterplane grid (BoatModel's anchor / hydro API)
const hullSamples = [];
for ( let i = 0; i < 5; i ++ ) for ( let j = 0; j < 3; j ++ ) hullSamples.push( { position: new E.Vector3( ( j - 1 ) * 0.95, - 0.22, - 3.2 + i * 1.5 ), area: 1.1, bottomY: - 0.6 } );
const volume = hullSamples.reduce( ( a, s ) => a + s.area * - s.position.y, 0 );
const model = {
	group: new E.Group(),
	hullSamples,
	hydro: { suggestedMass: Math.round( 1025 * volume ), centerOfMass: new E.Vector3( 0, 0.3, - 0.2 ), centerOfBuoyancy: new E.Vector3( 0, - 0.11, - 0.2 ), inertia: new E.Vector3( 14600, 15700, 3500 ) },
	propeller: new E.Vector3( 0, - 0.55, - 3.3 ),
	rudder: new E.Vector3( 0, - 0.5, - 3.6 ),
	setThrottle() {}, setSteering() {}, setPropellerRPM() {},
};

const boat = new BoatController( { model, query, terrain, colliders } );
const GUARD_FROM = boat.guardFrom, CAPSIZE_AT = boat.capsizeAt; // the tuned defaults
const dt = 1 / 60;
const upright = () => {

	// put the boat adrift in deep water, upright, at rest
	boat.position.set( 0, 0, 150 );
	boat.quaternion.identity();
	boat.velocity.set( 0, 0, 0 );
	boat.angular.set( 0, 0, 0 );
	boat.moored = false;
	boat.driven = false;
	boat.hasWater = false;

};
const upY = () => new E.Vector3( 0, 1, 0 ).applyQuaternion( boat.quaternion ).y;
const run = ( sec, each ) => {

	for ( let t = 0; t < sec; t += dt ) {

		time += dt;
		if ( each ) each();
		boat.queueQueries();
		boat.update( dt );
		query.tick();
		if ( ! boat.isFinite() ) return false;

	}

	return true;

};

// ---- 1. guard OFF: the sea really does capsize the hull (validates the scenario)
{
	boat.guardFrom = Math.PI;
	boat.capsizeAt = Math.PI;
	upright();
	storm = 1;
	let minUp = 1;
	const ok = run( 45, () => { minUp = Math.min( minUp, upY() ); } );
	check( ok, 'guard off: the integration stays finite' );
	check( minUp < 0.25, `guard off: the sea lays the hull right over (min up.y ${ minUp.toFixed( 3 ) }, heel > ${ ( Math.acos( Math.max( - 1, minUp ) ) * 180 / Math.PI ).toFixed( 0 ) }°)` );
	check( minUp < 0.0, `guard off: it ends up inverted, the bug we are fixing (min up.y ${ minUp.toFixed( 3 ) })` );
}

// ---- 2. guard ON: it is held below the limit, never inverts, and rights itself when it calms
{
	boat.guardFrom = GUARD_FROM;
	boat.capsizeAt = CAPSIZE_AT;
	upright();
	storm = 1;
	const floor = Math.cos( boat.capsizeAt );
	let minUp = 1;
	const ok = run( 45, () => { minUp = Math.min( minUp, upY() ); } );
	check( ok, 'guard on: the integration stays finite through the storm' );
	check( minUp > floor - 1e-3, `guard on: never rolled past the capsize limit (min up.y ${ minUp.toFixed( 3 ) } >= cos70° ${ floor.toFixed( 3 ) })` );
	check( minUp > 0.0, 'guard on: never inverted at any instant' );
	storm = 0; // calm: it should come back up
	run( 25 );
	const rest = upY();
	check( rest > 0.95, `guard on: rights itself once the sea calms (up.y ${ rest.toFixed( 3 ) })` );
	check( Math.abs( boat.position.y ) < 1.5, `guard on: floats at the surface (y ${ boat.position.y.toFixed( 2 ) })` );
}

// ---- 3. normal operation is untouched: calm, a moderate sea, and driving at speed
{
	upright();
	boat.driven = false;
	boat.throttle = 0;
	storm = 0;
	run( 20 );
	const rest = upY();
	check( rest > 0.99, `calm: rests upright (up.y ${ rest.toFixed( 3 ) })` );

	storm = 0.35; // a moderate sea
	let minUp = 1;
	run( 30, () => { minUp = Math.min( minUp, upY() ); } );
	// the guard only engages past its threshold, so a normal roll must stay entirely the hull's own
	check( minUp > Math.cos( boat.guardFrom ), `moderate sea: the guard stays out of the way (min up.y ${ minUp.toFixed( 3 ) } > cos${ ( boat.guardFrom * 180 / Math.PI ).toFixed( 0 ) }° ${ Math.cos( boat.guardFrom ).toFixed( 3 ) })` );

	// drive at speed in the same sea: still upright, and it makes way
	boat.driven = true;
	let minUp2 = 1;
	for ( let t = 0; t < 20; t += dt ) {

		time += dt;
		boat.setInput( 1, 0.1, dt );
		boat.queueQueries();
		boat.update( dt );
		query.tick();
		minUp2 = Math.min( minUp2, upY() );

	}

	check( boat.speed > 2, `underway: it makes way (speed ${ boat.speed.toFixed( 2 ) } m/s)` );
	check( minUp2 > 0.9, `underway in a moderate sea: upright (min up.y ${ minUp2.toFixed( 3 ) })` );
}

console.log( fails ? `${ fails } FAILED` : 'all passed' );
process.exit( fails ? 1 : 0 );
