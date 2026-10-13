// Day/night + weather ecology, headless: the real Wildlife simulation run at midday, at night and
// in a storm, checking that the animals actually change what they do (not just the numbers).
//   node test/life-eco.mjs
import { setupLife } from './life-harness.mjs';

let fails = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else console.log( 'ok  ', msg );

};

const L = await setupLife( { W: 960, H: 540, ground: { center: [ 20, 0 ], size: 500 }, water: true } );
const { Wildlife } = await import( '../src/world/wildlife/Wildlife.js' );
const { G } = await import( '../src/core/Globals.js' );
const { RHYTHM } = await import( '../src/world/EcoRhythm.js' );

const T = L.terrain;
const spray = { emit() {}, emitAlongPoints() {} };
const { ShaderModule } = await import( '../src/engine/gpu/Shader.js' );
const terrainGPU = { module: new ShaderModule( { name: 'terrainStub', code: 'fn terrainHeightAt( xz: vec2f ) -> f32 { return 1.0 - xz.y * 0.03; }' } ) };
const shore = {
	period: { value: 9 },
	module: new ShaderModule( { name: 'shoreStub', code: `struct ShoreSample { runup: f32, inland: f32, dRdt: f32, tau: f32 };
fn shoreEvaluateNoNormal( xz: vec2f, depth: f32, groundH: f32 ) -> ShoreSample {
	var s: ShoreSample; s.runup = 1.5 + sin( frame.time ); s.inland = - depth / 0.066; s.dRdt = cos( frame.time ); s.tau = fract( frame.time / 9.0 ); return s; }` } ),
};
const wl = new Wildlife( { scene: L.scene, terrain: T, csm: L.shadows, spray, shore, terrainGPU } );
const cam = L.camera;
cam.position.set( 22, T.heightAt( 22, - 40 ) + 1.7, - 40 );
cam.lookAt( 22, 0.5, - 30 );
cam.updateMatrixWorld();

// ---- the sky: write the globals the way App.js does, then let the animals run
const SKY = {
	midday: { night: 0, sunY: 1, rain: 0, gust: 0 },
	night: { night: 1, sunY: - 0.9, rain: 0, gust: 0 },
	dusk: { night: 0.4, sunY: - 0.05, rain: 0, gust: 0 },
	storm: { night: 0, sunY: 0.6, rain: 1, gust: 1 },
};

const setSky = ( s ) => {

	G.night.value = s.night;
	G.sunDir.value.set( 0, s.sunY, Math.sqrt( Math.max( 0, 1 - s.sunY * s.sunY ) ) ).normalize();
	G.weather.value.set( s.rain, s.rain, 0, s.gust );

};

const step = ( seconds, sky ) => {

	setSky( sky );
	const n = Math.round( seconds * 60 );
	for ( let i = 0; i < n; i ++ ) {

		G.time.value += 1 / 60; // the rhythm resamples when the frame clock moves
		wl.update( 1 / 60, cam, null );

	}

};

const census = () => {

	let perched = 0, gulls = 0, line = 0, floating = 0;
	for ( const a of wl.birds.agents ) {

		if ( a.kind === 'gull' ) {

			gulls ++;
			if ( a.state === 'perched' ) perched ++;

		} else if ( a.kind === 'pelican' && a.slot !== undefined ) {

			if ( a.state === 'line' ) line ++;
			else if ( a.state === 'float' ) floating ++;

		}

	}

	return { perched, gulls, line, floating, crab: wl.crabs.activity };

};

// average share of the gulls sitting down over a stretch of time
const roosting = ( seconds, sky ) => {

	let sum = 0, n = 0;
	setSky( sky );
	for ( let i = 0; i < Math.round( seconds * 60 ); i ++ ) {

		G.time.value += 1 / 60;
		wl.update( 1 / 60, cam, null );
		if ( i % 10 === 0 ) {

			const c = census();
			sum += c.perched / Math.max( 1, c.gulls );
			n ++;

		}

	}

	return sum / Math.max( 1, n );

};

console.log( 'warm-up (midday, 90 s)' );
step( 90, SKY.midday );
const day = census();
const dayRoost = roosting( 180, SKY.midday );
console.log( '  midday  ', JSON.stringify( day ), 'roosting', dayRoost.toFixed( 2 ) );

step( 150, SKY.night );
const night = census();
const nightRoost = roosting( 180, SKY.night );
console.log( '  night   ', JSON.stringify( night ), 'roosting', nightRoost.toFixed( 2 ) );

step( 200, SKY.midday );
const back = census();
console.log( '  back    ', JSON.stringify( back ) );

step( 120, SKY.storm );
const storm = census();
const stormRoost = roosting( 180, SKY.storm );
console.log( '  storm   ', JSON.stringify( storm ), 'roosting', stormRoost.toFixed( 2 ) );

// ---- the rhythm really is being read from the globals
setSky( SKY.night );
G.time.value += 1 / 60;
const r = RHYTHM.sample();
ok( r.night === 1 && r.air === 0, 'the sampler reads frame.night' );
setSky( SKY.storm );
G.time.value += 1 / 60;
ok( RHYTHM.sample().rain === 1 && RHYTHM.sample().gust === 1, 'the sampler reads frame.weather' );

// ---- pelicans: the skimming line only flies in daylight
ok( day.line === 5, `midday: all five pelicans hold the line (${ day.line })` );
ok( night.line === 0 && night.floating >= 4, `night: the line breaks up and they raft on the water (${ night.floating }/5 floating)` );
ok( back.line >= 1, `the line re-forms when the light comes back (${ back.line }/5)` );

// ---- gulls: more of them sit still in the dark and in the rain. The perch pool is finite, so
// the share cannot reach 1, but the turnover stops: at night a perched gull never leaves.
ok( nightRoost > dayRoost + 0.05, `night: more gulls roost than by day (${ dayRoost.toFixed( 2 ) } -> ${ nightRoost.toFixed( 2 ) })` );
ok( stormRoost > dayRoost + 0.03, `rain: more gulls sit it out (${ dayRoost.toFixed( 2 ) } -> ${ stormRoost.toFixed( 2 ) })` );

// ---- crabs: out at dusk, back in their burrows when it pours
setSky( SKY.midday );
G.time.value += 1 / 60;
const crabDay = RHYTHM.sample().crab;
setSky( SKY.storm );
G.time.value += 1 / 60;
const crabStorm = RHYTHM.sample().crab;
ok( storm.crab === crabStorm && crabStorm < crabDay * 0.4, `rain empties the beach (crab activity ${ crabDay.toFixed( 2 ) } -> ${ crabStorm.toFixed( 2 ) })` );
ok( wl.crabs.activity <= 0.95, 'crab activity stays inside its old ceiling' );

// ---- shorebirds: driven by the same reading
setSky( SKY.night );
G.time.value += 1 / 60;
ok( RHYTHM.sample().shore > 0.6, 'the shorebirds get the roosting cue at night' );

console.log( fails === 0 ? '\nall good' : `\n${ fails } FAILED` );
process.exit( fails === 0 ? 0 : 1 );
