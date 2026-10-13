// Deterministic GPU A/B test plus swimming-response regression checks for MarineSnow.
// All A/B images freeze time, camera, particles and lighting; only snowBio changes.
import assert from 'node:assert/strict';
import { writePNG } from './headless.mjs';
import { GPU, RenderTarget, ShaderModule, readTexture, MeshRenderer, SceneRenderer, FullscreenPass, SunShadows, G, setFrameCamera } from '../src/engine/webgpu.js';
import { PerspectiveCamera, Scene } from '../src/engine/index.js';
import { OceanFFT } from '../src/ocean/OceanFFT.js';
import { MarineSnow } from '../src/fx/MarineSnow.js';
import { RHYTHM } from '../src/world/EcoRhythm.js';

await GPU.init( { headless: true } );
let errors = 0;
GPU.device.addEventListener( 'uncapturederror', () => errors ++ );
const W = 640, H = 360;
const fft = new OceanFFT( null );
const query = { module: new ShaderModule( { name: 'snowBioQuery', code: 'fn waterQueryHeightAtXZ( xz: vec2f ) -> f32 { return 0.0; }' } ) };
const snow = new MarineSnow( { fft, query } );
// Resolve the existing automatic torch import before explicitly switching its light off.
await import( '../src/materials/LocalLights.js' );
await Promise.resolve();
snow.flashBlock.fields.on = { value: 0 };
const camera = new PerspectiveCamera( 60, W / H, 0.05, 500 );
camera.position.set( 0, - 2, 0 ); camera.lookAt( 0, - 2, - 5 );
G.time.value = 10; G.dt.value = 1 / 60; G.night.value = 1;
G.weather.value.set( 0, 0, 0, 0 );
G.sunDir.value.set( 0.1, - 0.9, 0.3 ).normalize();
G.sunColor.value.setRGB( 0, 0, 0 );
G.skyIrradiance.value.setRGB( 0, 0, 0 );
RHYTHM.stamp = - 1;
snow.update( camera, true );
assert.equal( snow.bio.value, 1 );

function swim( fps ) {

	snow.update( camera, false );
	camera.position.set( 0, - 2, 0 );
	snow.update( camera, true, 1 / fps );
	for ( let i = 0; i < fps; i ++ ) {

		camera.position.x += 3 / fps;
		snow.update( camera, true, 1 / fps );

	}
	const active = snow.churn.value;
	for ( let i = 0; i < fps; i ++ ) snow.update( camera, true, 1 / fps );
	return [ active, snow.churn.value ];

}
const values = [ 30, 60, 120 ].map( swim );
for ( const v of values ) {

	assert.ok( Math.abs( v[ 0 ] - values[ 1 ][ 0 ] ) < 1e-6, 'swimming excitation is frame-rate independent' );
	assert.ok( Math.abs( v[ 1 ] - values[ 1 ][ 1 ] ) < 1e-6, 'afterglow decay is frame-rate independent' );

}
console.log( 'ok swimming and decay match at 30/60/120 fps:', values );
snow.update( camera, false );
assert.equal( snow.churn.value, 0 ); assert.equal( snow.bio.value, 0 );
assert.equal( snow.mesh.visible, false );
camera.position.set( 400, - 2, 500 );
snow.update( camera, true );
assert.equal( snow.churn.value, 0, 're-entering water ignores travel on land' );
snow.update( camera, true, 0 );
assert.ok( Number.isFinite( snow.churn.value ), 'zero dt remains finite' );
console.log( 'ok resurfacing and re-entry do not create stale flashes' );

camera.position.set( 0, - 2, 0 ); camera.lookAt( 0, - 2, - 5 );
snow.update( camera, false ); snow.update( camera, true );
snow.churn.value = 1;
const scene = new Scene(); scene.add( snow.mesh );
const mr = new MeshRenderer(); new SunShadows();
const sr = new SceneRenderer( mr, scene, camera ); sr.setSize( W, H );
sr.clearColor = [ 0, 0, 0, 1 ];
const ldr = new RenderTarget( W, H, { colors: [ 'rgba8unorm' ], label: 'snowBioLDR' } );
const tone = new FullscreenPass( { label: 'snowBioTone', colorFormats: [ 'rgba8unorm' ], bindings: { hdr: { texture: () => sr.sceneRT.texture } },
	code: 'fn fragment( in: FSIn ) -> vec4f { let c = textureLoad( hdr, vec2i( in.pos.xy ), 0 ).rgb; return vec4f( linearToSrgb( sat3( c / ( 1.0 + c ) ) ), 1.0 ); }' } );
GPU.beginFrame(); setFrameCamera( camera, W, H ); fft.update( 1 / 60 ); GPU.submit();
await GPU.queue.onSubmittedWorkDone();
async function render( bio ) {

	snow.bio.value = bio;
	GPU.beginFrame(); setFrameCamera( camera, W, H );
	sr.render(); tone.render( { colorViews: [ ldr.texture ] } ); GPU.submit();
	await GPU.queue.onSubmittedWorkDone();
	return new Uint8Array( ( await readTexture( ldr.texture ) ).data );

}
const lit = await render( 1 );
const dark = await render( 0 );
const rain = await render( 0.55 );
let hits = 0, red = 0, green = 0, blue = 0, wetEnergy = 0;
for ( let i = 0; i < lit.length; i += 4 ) {

	const dr = lit[ i ] - dark[ i ], dg = lit[ i + 1 ] - dark[ i + 1 ], db = lit[ i + 2 ] - dark[ i + 2 ];
	if ( dg + db > 8 ) hits ++;
	red += dr; green += dg; blue += db;
	wetEnergy += rain[ i + 1 ] - dark[ i + 1 ] + rain[ i + 2 ] - dark[ i + 2 ];

}
// Only a quarter of millimetre-scale specks within 1.7 m can glow; at 640x360 a sparse
// double-digit pixel footprint is expected. Do not demand a screen-filling particle cloud.
assert.ok( hits > 10, `cold luminous plankton are visible without a lamp (${ hits } pixels)` );
assert.ok( green > red * 1.8 && blue > red * 1.8, 'glow is cold blue-green' );
assert.ok( wetEnergy < green + blue, 'rain reduces pixel emission' );
snow.opacity.value = 0;
const hidden = await render( 1 );
assert.ok( hidden.every( ( v, i ) => i % 4 === 3 || v === 0 ), 'zero opacity also suppresses glow' );
writePNG( process.argv[ 2 ] || '/tmp/ocean-snow-bio-night.png', W, H, lit );
writePNG( process.argv[ 3 ] || '/tmp/ocean-snow-bio-off.png', W, H, dark );
assert.equal( errors, 0 );
console.log( `ok ${ hits } lit pixels, rain reduces energy, zero GPU errors` );
console.log( 'all good' );
process.exit( 0 );
