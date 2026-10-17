// Mip chains on a GPU that lets a kernel write only 4 storage textures (WebGPU's default; many phones):
// the ocean FFT and ComputeMips then make the lower levels one per dispatch. The chains must match the
// 8-texture path.   node test/mips-limit.mjs        (GPU; not in npm test)
//   node test/mips-limit.mjs 4   also opens the device with the 4-texture limit (validation errors fail)
import './headless.mjs';
import { GPU, Texture } from '../src/engine/webgpu.js';
import { G } from '../src/engine/render/Frame.js';
import { OceanFFT } from '../src/ocean/OceanFFT.js';
import { ComputeMips } from '../src/ocean/ComputeMips.js';
import { readFloatTexture } from './ocean-util.mjs';

const lim = Number( process.argv[ 2 ] ) || 8;
await GPU.init( { headless: true, requiredLimits: { maxStorageTexturesPerShaderStage: lim } } );
let errors = 0;
GPU.device.addEventListener?.( 'uncapturederror', ( e ) => { errors ++; console.log( 'GPU error:', e.error.message.split( '\n' )[ 0 ] ); } );
let fails = 0;
const check = ( ok, msg ) => { console.log( ( ok ? 'ok   ' : 'FAIL ' ) + msg ); if ( ! ok ) fails ++; };
console.log( 'device maxStorageTexturesPerShaderStage', GPU.limits.maxStorageTexturesPerShaderStage );

// build one of each with the real limits and one as if only 4 were allowed
const real = GPU.limits;
const asIf4 = ( make ) => {

	GPU.limits = new Proxy( real, { get: ( o, k ) => ( k === 'maxStorageTexturesPerShaderStage' ? 4 : o[ k ] ) } );
	try { return make(); } finally { GPU.limits = real; }

};

const diff = async ( a, b, opts ) => {

	const x = await readFloatTexture( a, opts ), y = await readFloatTexture( b, opts );
	let d = 0, m = 0;
	for ( let i = 0; i < x.data.length; i ++ ) {

		d = Math.max( d, Math.abs( x.data[ i ] - y.data[ i ] ) );
		m = Math.max( m, Math.abs( x.data[ i ] ) );

	}

	return { d, m };

};

// ---- ocean FFT
const fa = new OceanFFT( null ), fb = asIf4( () => new OceanFFT( null ) );
check( fb.mipLevels.length > 0 && fb.mipKernelsB.length === 0, `4-texture FFT makes ${ fb.mipLevels.length } levels one at a time` );
G.dt.value = 1 / 60;
for ( let f = 0; f < 30; f ++ ) {

	GPU.beginFrame();
	fa.update( 1 / 60 );
	fb.update( 1 / 60 );
	GPU.submit();

}

await GPU.queue.onSubmittedWorkDone();
for ( const t of [ 'displacementTexture', 'derivativeTexture' ] ) for ( let mip = 0; mip <= 8; mip ++ ) {

	const r = await diff( fa[ t ], fb[ t ], { layer: 2, mip } );
	check( r.d <= Math.max( 1e-3, r.m * 2e-3 ) && ( r.m > 0 || mip > 6 ), `ocean ${ t } mip ${ mip } matches (max diff ${ r.d.toExponential( 2 ) } of ${ r.m.toFixed( 3 ) })` );

}

// ---- ComputeMips on a 256 array texture with a pattern in level 0
const make = () => new Texture( { label: 'mipsTest', width: 256, height: 256, depth: 2, dimension: '2d-array', format: 'rgba16float', mips: true, usage: [ 'sample', 'storage', 'copyDst', 'copySrc' ] } );
const ta = make(), tb = make();
const px = new Uint16Array( 256 * 256 * 4 );
const h16 = ( v ) => {

	// float -> half for normal values (|v| in 6e-5..65504), small ones flush to zero
	const s = v < 0 ? 0x8000 : 0, a = Math.abs( v );
	if ( a < 6.2e-5 ) return s;
	const e = Math.floor( Math.log2( a ) ), m = Math.round( ( a / 2 ** e - 1 ) * 1024 );
	return s | ( ( e + 15 ) << 10 ) | Math.min( m, 1023 );

};
for ( let j = 0; j < 256; j ++ ) for ( let i = 0; i < 256; i ++ ) for ( let c = 0; c < 4; c ++ ) px[ ( j * 256 + i ) * 4 + c ] = h16( 0.25 + 0.5 * Math.sin( i * 0.07 * ( c + 1 ) ) * Math.cos( j * 0.05 ) );
for ( const t of [ ta, tb ] ) for ( let layer = 0; layer < 2; layer ++ ) GPU.queue.writeTexture( { texture: t.getGPU(), origin: { x: 0, y: 0, z: layer } }, px, { bytesPerRow: 256 * 8, rowsPerImage: 256 }, { width: 256, height: 256, depthOrArrayLayers: 1 } );
const ma = new ComputeMips( ta, 'mipsA' ), mb = asIf4( () => new ComputeMips( tb, 'mipsB' ) );
check( mb.levelKernels.length > 0 && ! mb.kernelB, `4-texture ComputeMips makes ${ mb.levelKernels.length } levels one at a time` );
ma.dispatch();
mb.dispatch();
await GPU.queue.onSubmittedWorkDone();
for ( let mip = 1; mip < ta.mipLevelCount; mip ++ ) {

	const r = await diff( ta, tb, { layer: 1, mip } );
	check( r.d <= 2e-3 && r.m > 0, `ComputeMips mip ${ mip } matches (max diff ${ r.d.toExponential( 2 ) })` );

}

check( errors === 0, `no GPU validation errors (${ errors })` );
console.log( fails ? `\n${ fails } FAILED` : '\nall ok' );
process.exit( fails ? 1 : 0 );
