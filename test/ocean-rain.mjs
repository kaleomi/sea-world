// Rain on the ocean surface: the rings the drops leave, the roughness they add farther out, and what
// it costs.  node test/ocean-rain.mjs [outDir]
//
// The two shots are the *same instant* of the same sea (frame( 0 ), so the FFT does not advance):
// every difference between them is the rain, not the swell moving under the camera.
import { makeOceanScene } from './ocean-scene.mjs';
import { G } from '../src/engine/render/Frame.js';
import { writePNG } from './headless.mjs';
import { mkdirSync } from 'node:fs';

let fails = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else console.log( 'ok  ', msg );

};

const out = process.argv[ 2 ];
if ( out ) mkdirSync( out, { recursive: true } );
const s = await makeOceanScene();

// low over the water, so the near surface fills the frame (the rings are only drawn close up)
s.camera.position.set( - 50, 2.2, 0 );
s.camera.lookAt( 200, 0, - 10 );
for ( let i = 0; i < 3; i ++ ) s.frame(); // build the pipelines

const shot = async ( rain ) => {

	G.weather.value.set( rain, 0, 0, 0 );
	s.frame( 0 );
	return s.read();

};

const dry = await shot( 0 );
const wet = await shot( 1 );

const diff = ( a, b ) => {

	let n = 0, sum = 0;
	for ( let i = 0; i < a.length; i += 4 ) {

		const d = Math.abs( a[ i ] - b[ i ] ) + Math.abs( a[ i + 1 ] - b[ i + 1 ] ) + Math.abs( a[ i + 2 ] - b[ i + 2 ] );
		if ( d > 6 ) n ++;
		sum += d;

	}

	return { mean: sum / ( a.length / 4 ), changed: n / ( a.length / 4 ) };

};

const d = diff( dry, wet );
ok( d.changed > 0.01, `rain changes the water surface (${ ( 100 * d.changed ).toFixed( 1 ) }% of pixels, mean ${ d.mean.toFixed( 1 ) })` );

// the rings have to be local: the far water should not be repainted by a drop a metre across
const luma = ( x ) => {

	let s2 = 0;
	for ( let i = 0; i < x.length; i += 4 ) s2 += 0.2126 * x[ i ] + 0.7152 * x[ i + 1 ] + 0.0722 * x[ i + 2 ];
	return s2 / ( x.length / 4 );

};

ok( Math.abs( luma( dry ) - luma( wet ) ) < 12, `the sea keeps its overall brightness (${ luma( dry ).toFixed( 1 ) } -> ${ luma( wet ).toFixed( 1 ) })` );

// ---- cost: the rings are only computed where they are bigger than a pixel, so a downpour should not
// blow the frame budget. (This view is nearly all near water: the worst case for the ripple loop.)
G.weather.value.set( 0, 0, 0, 0 );
const tDry = await s.time( 20 );
G.weather.value.set( 1, 0, 0, 0 );
const tRain = await s.time( 20 );
console.log( `     frame @ ${ s.W }x${ s.H }: ${ tDry.toFixed( 2 ) } ms dry, ${ tRain.toFixed( 2 ) } ms raining` );
ok( tRain < tDry + 4, `rain does not blow the frame budget (+${ ( tRain - tDry ).toFixed( 2 ) } ms)` );

if ( out ) {

	writePNG( `${ out }/ocean-rain-dry.png`, s.W, s.H, dry );
	writePNG( `${ out }/ocean-rain-wet.png`, s.W, s.H, wet );

}

console.log( fails ? `\n${ fails } FAILED` : '\nall passed' );
process.exit( fails ? 1 : 0 );
