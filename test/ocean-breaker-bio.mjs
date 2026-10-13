// Headless test of the breaker lip's bioluminescence: run the same shore simulation twice -- once
// at night with the plankton glow on (G.night = 1), once with it off (G.night = 0) -- and verify the
// foam now flashes cold blue-green at the tearing edge of the lip. The lip shader is otherwise
// unchanged: at night it goes black and we'd lose the whole wave silhouette without this.
// usage: node test/ocean-breaker-bio.mjs [outNight.png] [outDay.png]
import { writePNG } from './headless.mjs';
import { SunShadows, GPU, RenderTarget, FullscreenPass, readTexture, readBuffer, MeshRenderer, FrameUniforms, G, setFrameCamera, commonModule } from '../src/engine/webgpu.js';
import { PerspectiveCamera, Scene, Vector2 } from '../src/engine/index.js';
import { ShoreWaves } from '../src/ocean/ShoreWaves.js';
import { ShoreSim } from '../src/ocean/ShoreSim.js';
import { Breakers } from '../src/ocean/Breakers.js';
import { RHYTHM } from '../src/world/EcoRhythm.js';
import { makeTerrain, makeSky, makeClouds, makeFFT, makeSpray, heightAt } from './ocean-shore-stubs.mjs';

let bad = 0;
const ok = ( cond, msg ) => {

	console.log( `${ cond ? 'ok  ' : 'FAIL' } ${ msg }` );
	if ( ! cond ) bad ++;

};

const outNight = process.argv[ 2 ] || '/tmp/ocean-breaker-bio-night.png';
const outDay = process.argv[ 3 ] || '/tmp/ocean-breaker-bio-day.png';

await GPU.init( { headless: true } );
let errors = 0;
GPU.device.addEventListener( 'uncapturederror', () => errors ++ );
const origErr = console.error;
console.error = ( ...a ) => { errors ++; origErr( ...a ); };

// identical setup to ocean-shore.mjs -- we want a real plunging lip to look at
const terrain = makeTerrain();
const shore = new ShoreWaves( terrain );
const sim = new ShoreSim( null, { terrainGPU: terrain, shore, center: new Vector2( 0, 20 ), size: 160, res: 768 } );
const spray = makeSpray();
const surface = { fft: makeFFT(), terrain, shoreSim: sim, amplitude: { value: 1 } };
const breakers = new Breakers( null, { surface, shore, terrainData: { heightAt }, sky: makeSky(), spray, clouds: makeClouds() } );

G.windSpeed.value = 9;
FrameUniforms.fields.frameIndex.value = 0;
const dt = 1 / 30;
G.dt.value = dt;
const camera = new PerspectiveCamera( 50, 16 / 9, 0.1, 2000 );
camera.position.set( - 8, 3.0, - 6 ); camera.lookAt( 10, 0, 40 );

// simulate long enough for a few crests to be near b = 0.65 (plunging)
for ( let f = 0; f < 750; f ++ ) {

	G.time.value = 30 + f * dt;
	FrameUniforms.fields.frameIndex.value = f;
	GPU.beginFrame();
	setFrameCamera( camera, 1280, 720 );
	sim.update();
	breakers.update( camera );
	GPU.submit();
	if ( f % 100 === 0 ) await GPU.queue.onSubmittedWorkDone();

}

await GPU.queue.onSubmittedWorkDone();
ok( breakers.NS > 1, `stations exist (${ breakers.NS })` );

// frame the camera at the most plunging lip available
const RW = 1280, RH = 720;
const c = new Float32Array( await readBuffer( breakers.crest.getGPU(), breakers.NS * 6 * 16 ) );
let best = - 1, bd = 9;
for ( let i = 0; i < breakers.NS * 2; i ++ ) if ( c[ i * 12 + 11 ] > 0.5 && Math.abs( c[ i * 12 + 3 ] - 0.65 ) < bd ) {

	bd = Math.abs( c[ i * 12 + 3 ] - 0.65 ); best = i;

}

const x = c[ best * 12 ], y = c[ best * 12 + 1 ], z = c[ best * 12 + 2 ];
camera.position.set( x - 6, y + 0.4, z - 9 ); camera.lookAt( x, y - 0.3, z );

const scene = new Scene();
scene.add( breakers.mesh );
breakers.mesh.layers.enableAll && breakers.mesh.layers.enableAll();
const mr = new MeshRenderer();
new SunShadows();
const rt = new RenderTarget( RW, RH, { colors: [ 'rgba16float', 'rgba16float', 'rgba8unorm' ], depth: 'depth32float', label: 'lipRT' } );
const ldr = new RenderTarget( RW, RH, { colors: [ 'rgba8unorm' ], label: 'lipLDR' } );
const tonemap = new FullscreenPass( { label: 'tonemap', colorFormats: [ 'rgba8unorm' ], bindings: { hdr: { texture: () => rt.texture } },
	code: `fn fragment( in: FSIn ) -> vec4f { let c = textureLoad( hdr, vec2i( in.pos.xy ), 0 ).rgb; let a = c * 0.6; let t = ( a * ( 2.51 * a + 0.03 ) ) / ( a * ( 2.43 * a + 0.59 ) + 0.14 ); return vec4f( linearToSrgb( sat3( t ) ), 1.0 ); }` } );

camera.aspect = RW / RH; camera.updateProjectionMatrix();

async function render( night ) {

	G.night.value = night;
	// dark night: no sun, no sky -- whatever the lip shows must be its own light
	G.sunDir.value.set( 0.2, - 0.9, 0.3 ).normalize();
	G.sunColor.value.setRGB( 0.004, 0.005, 0.008 );
	G.skyIrradiance.value.setRGB( 0.006, 0.008, 0.014 );
	// Hold time fixed so both images use identical crests and flowing textures. Invalidate only
	// the test's rhythm cache: the live game naturally advances this cache once per frame.
	RHYTHM.stamp = - 1;

	GPU.beginFrame();
	setFrameCamera( camera, RW, RH );
	breakers.update( camera );
	mr.render( scene, { camera, kind: 'main', late: true, colorViews: rt.textures.map( ( t ) => t.view() ), colorFormats: rt.formats,
		clearColors: [ [ 0.002, 0.004, 0.008, 1 ], [ 0, 0, 0, 0 ], [ 0, 0, 0, 0 ] ], depthView: rt.depthTexture.view(), depthFormat: 'depth32float', clearDepth: 0 } );
	tonemap.render( { colorViews: [ ldr.texture ] } );
	GPU.submit();
	await GPU.queue.onSubmittedWorkDone();
	return new Uint8Array( ( await readTexture( ldr.texture ) ).data );

}

const lit = await render( 1 );
const bio = breakers.breakerBio.value;
const dark = await render( 0 );
const off = breakers.breakerBio.value;
writePNG( outNight, RW, RH, lit );
writePNG( outDay, RW, RH, dark );

const luma = ( px, i ) => 0.2126 * px[ i ] + 0.7152 * px[ i + 1 ] + 0.0722 * px[ i + 2 ];
let nHit = 0, sumDR = 0, sumDG = 0, sumDB = 0, sumD = 0, peak = 0;
for ( let i = 0; i < RW * RH; i ++ ) {

	const dL = luma( lit, i * 4 ) - luma( dark, i * 4 );
	const dR = lit[ i * 4 ] - dark[ i * 4 ];
	const dG = lit[ i * 4 + 1 ] - dark[ i * 4 + 1 ];
	const dB = lit[ i * 4 + 2 ] - dark[ i * 4 + 2 ];
	if ( dL > 4 ) { nHit ++; sumD += dL; sumDR += dR; sumDG += dG; sumDB += dB; if ( dL > peak ) peak = dL; }

}
const meanD = sumD / Math.max( nHit, 1 );
const meanDR = sumDR / Math.max( nHit, 1 );
const meanDG = sumDG / Math.max( nHit, 1 );
const meanDB = sumDB / Math.max( nHit, 1 );

console.log( `lip bio level night ${ bio.toFixed( 3 ) }, day ${ off.toFixed( 3 ) }` );
console.log( `lit pixels ${ nHit } (${ ( nHit * 100 / ( RW * RH ) ).toFixed( 2 ) }%), mean +${ meanD.toFixed( 1 ) }, peak +${ peak }  (g +${ meanDG.toFixed( 1 ) }, b +${ meanDB.toFixed( 1 ) }, r +${ meanDR.toFixed( 1 ) })` );

ok( bio > 0.95, `a dark night: the lip is set to glow (${ bio.toFixed( 2 ) })` );
ok( off === 0, `midday: the lip does not glow (${ off.toFixed( 2 ) })` );
ok( Math.abs( RHYTHM.sample().glow - off ) < 1e-6, 'the lip reads the hour from the same rhythm as everything else' );
ok( nHit > 200, `a clear trail along the lip is glowing (${ nHit } pixels)` );
ok( meanD > 8, `the lit pixels are bright (mean +${ meanD.toFixed( 1 ) }, peak +${ peak })` );
ok( meanDG > meanDR * 1.8, `the light is green, not warm (g +${ meanDG.toFixed( 1 ) }, r +${ meanDR.toFixed( 1 ) })` );
ok( meanDB > meanDR * 1.8, `... and blue (b +${ meanDB.toFixed( 1 ) })` );
ok( errors === 0, `zero GPU errors during the test (${ errors })` );

console.log( 'wrote', outNight, 'and', outDay );
console.log( bad === 0 ? 'all good' : `${ bad } failed` );
await new Promise( ( r ) => setTimeout( r, 300 ) );
process.exit( bad === 0 && errors === 0 ? 0 : 1 );