// Headless test of the spray's bioluminescence: the same jet of drops is drawn twice under the same
// dark-night lighting, once with the plankton glow on (G.night = 1) and once with it off
// (G.night = 0). The difference is the plankton's own light, and it must be cold blue-green.
// usage: node test/ocean-spray-bio.mjs [outNight.png] [outDay.png]
import { writePNG } from './headless.mjs';
import { GPU } from '../src/engine/gpu/GPU.js';
import { RenderTarget } from '../src/engine/gpu/Texture.js';
import { ShaderModule } from '../src/engine/gpu/Shader.js';
import { readTexture } from '../src/engine/gpu/Readback.js';
import { G, setFrameCamera } from '../src/engine/render/Frame.js';
import { Material } from '../src/engine/render/Material.js';
import { MeshRenderer } from '../src/engine/render/MeshRenderer.js';
import { SceneRenderer } from '../src/engine/render/SceneRenderer.js';
import { FullscreenPass } from '../src/engine/render/FullscreenPass.js';
import { SunShadows } from '../src/engine/render/Shadows.js';
import * as E from '../src/engine/index.js';
import { Spray, SPRAY } from '../src/fx/Spray.js';
import { RHYTHM } from '../src/world/EcoRhythm.js';

let bad = 0;
const ok = ( cond, msg ) => {

	console.log( `${ cond ? 'ok  ' : 'FAIL' } ${ msg }` );
	if ( ! cond ) bad ++;

};

await GPU.init( { headless: true } );
const W = Number( process.env.W || 640 ), H = Number( process.env.H || 360 );
const outNight = process.argv[ 2 ] || '/tmp/ocean-spray-bio-night.png';
const outDay = process.argv[ 3 ] || '/tmp/ocean-spray-bio-day.png';

const query = { module: new ShaderModule( { name: 'queryStub', code: /* wgsl */`
fn waterQueryHeightAtXZ( xz: vec2f ) -> f32 { return 0.0; }
fn waterQueryCameraState() -> vec4f { return vec4f( 0.0 ); }
` } ) };
const terrain = { module: new ShaderModule( { name: 'terrainStub', code: 'fn terrainHeightAt( xz: vec2f ) -> f32 { return - 6.0; }' } ) };
const clouds = { module: new ShaderModule( { name: 'cloudsStub', code: 'fn cloudsShadow( xz: vec2f ) -> f32 { return 1.0; }' } ) };

const scene = new E.Scene();
const floor = new E.Mesh( new E.PlaneGeometry( 200, 200 ).rotateX( - Math.PI / 2 ), new Material( { name: 'floor', color: 0x0a2a3a, roughness: 0.3 } ) );
scene.add( floor );

const camera = new E.PerspectiveCamera( 50, W / H, 0.1, 2000 );
camera.position.set( 0, 2.2, 9 ); camera.lookAt( 0, 1.5, 0 );
// a dark night: no sun, no sky -- anything the spray shows is its own light
G.sunDir.value.set( 0.1, - 0.9, - 0.4 ).normalize();
G.sunColor.value.setRGB( 0.004, 0.005, 0.008 );
G.skyIrradiance.value.setRGB( 0.006, 0.008, 0.014 );
G.windSpeed.value = 3;

const mr = new MeshRenderer();
const shadows = new SunShadows();
const sr = new SceneRenderer( mr, scene, camera );
sr.setSize( W, H );
sr.clearColor = [ 0.002, 0.003, 0.006, 1 ];
const spray = new Spray( null, { query, terrain, sceneCopy: sr.opaqueCopy, clouds } );
scene.add( spray.mesh );

const tonemap = new FullscreenPass( { label: 'tonemap', colorFormats: [ 'rgba8unorm' ], bindings: { hdr: { texture: () => sr.sceneRT.texture } },
	code: `fn fragment( in: FSIn ) -> vec4f {
		let c = textureLoad( hdr, vec2i( in.pos.xy ), 0 ).rgb;
		let a = c * 0.6; let t = ( a * ( 2.51 * a + 0.03 ) ) / ( a * ( 2.43 * a + 0.59 ) + 0.14 );
		return vec4f( linearToSrgb( sat3( t ) ), 1.0 ); }` } );
const ldr = new RenderTarget( W, H, { colors: [ 'rgba8unorm' ], label: 'ldr' } );

const dt = 1 / 60;
const V = ( x, y, z ) => new E.Vector3( x, y, z );
const luma = ( px, i ) => 0.2126 * px[ i ] + 0.7152 * px[ i + 1 ] + 0.0722 * px[ i + 2 ];
const mean = ( px ) => {

	let r = 0, g = 0, b = 0;
	const n = W * H;
	for ( let i = 0; i < n; i ++ ) { r += px[ i * 4 ]; g += px[ i * 4 + 1 ]; b += px[ i * 4 + 2 ]; }
	return { r: r / n, g: g / n, b: b / n, luma: ( 0.2126 * r + 0.7152 * g + 0.0722 * b ) / n };

};
const compare = ( lit, dark ) => {

	let nHit = 0, sumD = 0, sumDR = 0, sumDG = 0, sumDB = 0, peak = 0;
	const n = W * H;
	for ( let i = 0; i < n; i ++ ) {

		const dL = luma( lit, i * 4 ) - luma( dark, i * 4 );
		const dR = lit[ i * 4 ] - dark[ i * 4 ];
		const dG = lit[ i * 4 + 1 ] - dark[ i * 4 + 1 ];
		const dB = lit[ i * 4 + 2 ] - dark[ i * 4 + 2 ];
		if ( dL > 4 ) { nHit ++; sumD += dL; sumDR += dR; sumDG += dG; sumDB += dB; if ( dL > peak ) peak = dL; }

	}
	return { nHit, frac: nHit / n, meanD: sumD / Math.max( nHit, 1 ), meanDR: sumDR / Math.max( nHit, 1 ), meanDG: sumDG / Math.max( nHit, 1 ), meanDB: sumDB / Math.max( nHit, 1 ), peak };

};

// Run `frames` frames of a steady jet at the given hour; returns the tonemapped pixels of the last
// frame. night = 1 -> the plankton glow is on (read by Spray.update from RHYTHM).
async function run( frames, night ) {

	G.night.value = night;
	let px = null;
	for ( let f = 0; f < frames; f ++ ) {

		G.time.value += dt; G.dt.value = dt;
		spray.emit( V( - 1.5, 0.1, 0 ), V( 0.4, 5.5, 0 ), 90, 0.006, SPRAY.DROPLET, { spread: 1.0, jitter: 0.12, life: 1.4 } );
		spray.emit( V( - 1.5, 0.1, 0 ), V( 0.4, 5.0, 0 ), 10, 0.014, SPRAY.LIGAMENT, { spread: 0.7, jitter: 0.12, life: 1.3 } );
		if ( f % 3 === 0 ) spray.emit( V( 0.5, 0.2, 0 ), V( 0, 3.2, 0.4 ), 14, 0.22, SPRAY.SPRAY, { spread: 1.2, jitter: 0.25, life: 2.0, sizeJitter: 0.8 } );

		GPU.beginFrame();
		setFrameCamera( camera, W, H );
		spray.update();
		GPU.submit();
		await GPU.queue.onSubmittedWorkDone();
		shadows.render( scene, mr, shadows.update( camera, G.sunDir.value ) );
		sr.render();
		tonemap.render( { colorViews: [ ldr.texture ] } );
		GPU.submit();
		await GPU.queue.onSubmittedWorkDone();
		if ( f === frames - 1 ) { px = new Uint8Array( ( await readTexture( ldr.texture ) ).data ); }

	}

	return px;

}

const frames = 60;
const litPx = await run( frames, 1 );
const glow = spray.bio.value;
// Freeze particle positions, ages and time. Only the glow uniform changes for the A/B image.
G.night.value = 0;
RHYTHM.stamp = - 1;
spray.bio.value = RHYTHM.sample().glow;
GPU.beginFrame();
setFrameCamera( camera, W, H );
shadows.render( scene, mr, shadows.update( camera, G.sunDir.value ) );
sr.render();
tonemap.render( { colorViews: [ ldr.texture ] } );
GPU.submit();
await GPU.queue.onSubmittedWorkDone();
const darkPx = new Uint8Array( ( await readTexture( ldr.texture ) ).data );
const off = spray.bio.value;
writePNG( outNight, W, H, litPx );
writePNG( outDay, W, H, darkPx );
const lit = mean( litPx );
const dark = mean( darkPx );
const diff = compare( litPx, darkPx );

console.log( `night glow level ${ glow.toFixed( 3 ) }, day ${ off.toFixed( 3 ) }` );
console.log( `mean over the frame -- night ${ lit.luma.toFixed( 2 ) } (rgb ${ lit.r.toFixed( 2 ) } ${ lit.g.toFixed( 2 ) } ${ lit.b.toFixed( 2 ) }), no glow ${ dark.luma.toFixed( 2 ) } (rgb ${ dark.r.toFixed( 2 ) } ${ dark.g.toFixed( 2 ) } ${ dark.b.toFixed( 2 ) })` );
console.log( `lit pixels ${ ( diff.frac * 100 ).toFixed( 2 ) }%, mean delta +${ diff.meanD.toFixed( 1 ) }, peak +${ diff.peak }` );

ok( glow > 0.95, `a dark night: the plankton glow is at full strength (${ glow.toFixed( 2 ) })` );
ok( off === 0, `midday: nothing glows (${ off.toFixed( 2 ) })` );
ok( Math.abs( RHYTHM.sample().glow - off ) < 1e-6, 'the spray reads the hour from the same rhythm as everything else' );
ok( diff.frac > 0.005, `a noticeable fraction of the frame is glowing (${ ( diff.frac * 100 ).toFixed( 2 ) }%)` );
ok( diff.meanD > 15, `the lit pixels are clearly bright (mean +${ diff.meanD.toFixed( 1 ) }, peak +${ diff.peak })` );
ok( diff.meanDG > diff.meanDR * 2.2, `the light is green, not warm (g +${ diff.meanDG.toFixed( 1 ) }, r +${ diff.meanDR.toFixed( 1 ) })` );
ok( diff.meanDB > diff.meanDR * 2.2, `... and blue (b +${ diff.meanDB.toFixed( 1 ) })` );

console.log( 'wrote', outNight, 'and', outDay );
console.log( bad === 0 ? 'all good' : `${ bad } failed` );
await new Promise( ( r ) => setTimeout( r, 300 ) );
process.exit( bad === 0 ? 0 : 1 );
