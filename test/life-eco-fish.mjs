// The reef at midday and at night, headless: the schools really do move up and down the water
// column with the hour (EcoRhythm + FishSchools). Runs the CPU simulation only, no pictures.
//   node test/life-eco-fish.mjs
import { setupLife } from './life-harness.mjs';
import { WORLD } from '../src/world/WorldLayout.js';
import { FishSchools } from '../src/world/Fish.js';
import { G } from '../src/core/Globals.js';

let fails = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else console.log( 'ok  ', msg );

};

const rc = WORLD.reef.center;
const L = await setupLife( { W: 256, H: 144, ground: { center: [ rc.x, rc.z ], size: 360, res: 0.75 }, water: true, near: 0.05 } );
const fish = new FishSchools( { parent: L.scene, terrain: L.terrain, center: rc.clone(), radius: WORLD.reef.radius + 10 } );
const cam = L.camera;
console.log( 'fish', fish.fishCount, 'groups', fish.groups.length );

const setSky = ( s ) => {

	G.night.value = s.night;
	G.sunDir.value.set( 0, s.sunY, Math.sqrt( Math.max( 0, 1 - s.sunY * s.sunY ) ) ).normalize();
	G.weather.value.set( s.rain, s.rain, 0, s.gust );

};

const MIDDAY = { night: 0, sunY: 1, rain: 0, gust: 0 };
const NIGHT = { night: 1, sunY: - 0.9, rain: 0, gust: 0 };

// mean height of a school (the y of every fish in it)
const meanY = ( g ) => {

	let s = 0;
	for ( let k = 0; k < g.count; k ++ ) s += fish.pos[ ( g.offset + k ) * 3 + 1 ];
	return s / g.count;

};

// sit the camera over the school so it simulates, then let it swim for a while
const hold = ( g, seconds, sky ) => {

	cam.position.set( g.center.x, 6, g.center.z );
	cam.updateMatrixWorld();
	setSky( sky );
	for ( let i = 0; i < Math.round( seconds * 60 ); i ++ ) {

		G.time.value += 1 / 60;
		fish.update( 1 / 60, cam.position );

	}

	return meanY( g );

};

const find = ( names ) => {

	for ( const n of names ) {

		const g = fish.groups.find( ( x ) => x.sp.name === n && x.count > 2 );
		if ( g ) return g;

	}

	return null;

};

// ---- a daylight reef fish sinks into the reef at night
{
	// yellowtail and silverside hang well above the bottom, so there is room to sink
	const g = find( [ 'yellowtail', 'silverside', 'tang', 'sergeant', 'grunt' ] );
	ok( g !== null, 'found a diurnal school' );
	if ( g ) {

		const day = hold( g, 240, MIDDAY );
		const night = hold( g, 360, NIGHT );
		console.log( `  ${ g.sp.name }: ${ day.toFixed( 2 ) } m by day, ${ night.toFixed( 2 ) } m at night` );
		ok( night < day - 0.15, `${ g.sp.name } sinks at night (${ day.toFixed( 2 ) } -> ${ night.toFixed( 2 ) } m)` );

	}

}

// ---- a night hunter rises
{
	const g = find( [ 'jack', 'tarpon', 'barracuda' ] );
	ok( g !== null, 'found a nocturnal school' );
	if ( g ) {

		const day = hold( g, 240, MIDDAY );
		const night = hold( g, 360, NIGHT );
		console.log( `  ${ g.sp.name }: ${ day.toFixed( 2 ) } m by day, ${ night.toFixed( 2 ) } m at night` );
		ok( night > day + 0.05, `${ g.sp.name } rises at night (${ day.toFixed( 2 ) } -> ${ night.toFixed( 2 ) } m)` );

	}

}

// ---- and the pace: the same school covers less ground in the dark
{
	const g = find( [ 'chromis', 'grunt', 'tang', 'sergeant', 'wrasse' ] );
	if ( g ) {

		const travel = ( sky ) => {

			cam.position.set( g.center.x, 6, g.center.z );
			cam.updateMatrixWorld();
			setSky( sky );
			let d = 0;
			const p0 = fish.pos.slice();
			for ( let i = 0; i < 60 * 20; i ++ ) {

				G.time.value += 1 / 60;
				fish.update( 1 / 60, cam.position );

			}

			for ( let k = 0; k < g.count; k ++ ) {

				const i = ( g.offset + k ) * 3;
				d += Math.hypot( fish.pos[ i ] - p0[ i ], fish.pos[ i + 2 ] - p0[ i + 2 ] );

			}

			return d / g.count;

		};

		const day = travel( MIDDAY );
		const night = travel( NIGHT );
		console.log( `  ${ g.sp.name }: moved ${ day.toFixed( 2 ) } m by day, ${ night.toFixed( 2 ) } m at night` );
		ok( night < day, `${ g.sp.name } moves about less in the dark` );

	}

}

console.log( fails === 0 ? '\nall good' : `\n${ fails } FAILED` );
process.exit( fails === 0 ? 0 : 1 );
