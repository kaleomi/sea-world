import { Material } from '../engine/render/Material.js';
import { Mesh } from '../engine/scene/Mesh.js';
import { PlaneGeometry } from '../engine/geometry/index.js';
import { ShaderModule, UniformBlock } from '../engine/gpu/Shader.js';
import { LAYERS } from '../engine/render/SceneRenderer.js';
import { G } from '../engine/render/Frame.js';
import { Vector2, Vector3 } from '../engine/math/index.js';

// Falling rain around the camera: instanced streaks, no simulation and no storage buffer.
//
// Like AirMotes the drops are procedural (a hash of the instance index) inside a box that wraps
// around the camera: the horizontal position wraps, and the height is `fract( hash + t * speed / H )`
// so every drop falls for ever at its own terminal velocity without any state. Rain is statistically
// uniform, so wrapping is invisible: it costs one instanced draw and a handful of uniforms.
//
// Each drop is a camera-facing streak along its own velocity (down, plus the wind and the squall),
// as long as it travels in one exposure: the length is the real distance, the width is the real drop
// size but never under ~1.2 px, and the opacity is the drop's coverage of that footprint, so a
// distant drizzle thins out instead of turning into a wall of opaque lines. Drops are lit per
// instance: clear water, strongly forward scattering, so they catch the sun when backlit and light
// up with the lightning. They stop at the ground (terrainHeightAt) and at the sea surface.
//
// WGSL (this.module, prefix `rain`): nothing is exported (the module only carries the uniforms).
// Consumes terrain.module (terrainHeightAt), if given.
// Rain reads larger than life: a 1 mm drop is a fraction of a pixel across at any distance you would
// notice it, and what you actually see is the streak it smears over the exposure, defocused and bloomed.
const VISIBILITY = 5;

const f = ( x ) => {

	const s = String( x );
	return s.includes( '.' ) || s.includes( 'e' ) ? s : s + '.0';

};

export class Rain {

	constructor( { terrain = null, count = 16000, radius = 26, height = 20 } = {} ) {

		this.boxW = radius * 2;
		this.boxH = height;
		this.windScale = 0.85; // the wind aloft, where the drops have been falling for a while

		this.uniforms = new UniformBlock( 'RainParams', {
			camPos: [ 'vec3f', new Vector3() ],
			intensity: [ 'f32', 0 ], // 0..1 how hard it is raining
			drift: [ 'vec2f', new Vector2() ], // wind drift, wrapped to the box (m)
			stretch: [ 'f32', 1 / 45 ], // exposure per streak (s): how long the drop is drawn
			box: [ 'vec2f', new Vector2( this.boxW, this.boxH ) ], // width, height (m)
		}, { label: 'rain' } );
		this.camPos = this.uniforms.fields.camPos;
		this.drift = this.uniforms.fields.drift;
		this.intensity = this.uniforms.fields.intensity;
		this.stretch = this.uniforms.fields.stretch;

		const hasTerrain = !! ( terrain && terrain.module );

		const params = new ShaderModule( {
			name: 'rainParams', uniforms: this.uniforms, uniformName: 'rain', code: /* wgsl */`
fn rainHash3( n: f32 ) -> vec3f { return fract( sin( vec3f( n, n + 17.13, n + 43.71 ) ) * vec3f( 43758.5453, 22578.1459, 19642.3490 ) ); }
// Henyey-Greenstein phase (1/sr)
fn rainPhaseHG( cosT: f32, g: f32 ) -> f32 { return ( ( 1.0 - g * g ) / ( 4.0 * PI ) ) / pow( max( 1.0 + g * g - cosT * 2.0 * g, 1e-4 ), 1.5 ); }
` } );

		const mat = new Material( {
			name: 'Rain',
			modules: [ params, hasTerrain && terrain.module ].filter( Boolean ),
			lit: false,
			transparent: true,
			// the core of each streak writes depth, so the temporal resolve follows it (a drop is a
			// real object crossing the view, not a blend that should keep the background's motion)
			depthWrite: true,
			depthTest: true,
			side: 'double',
			blending: 'premultiplied',
			defines: { VELOCITY_OPAQUE: 1 },
			varyings: { vRainCol: 'vec4f', vRainUV: 'vec2f' }, // radiance, opacity; quad corner
			vertex: /* wgsl */`
	let id = f32( v.instance );
	let h = rainHash3( id * 0.7131 + 0.37 );
	let h2 = rainHash3( id * 1.3917 + 5.1 );
	let h3 = rainHash3( id * 2.1733 + 11.7 );
	let t = frame.time;
	let Bx = rain.box.x;
	let By = rain.box.y;

	// ---- how many: the instance is either alive (a drop) or collapsed off-screen
	let density = rain.intensity * 0.95;
	let alive = h3.y < density;

	// ---- where: horizontally wrapped around the camera (with the wind's drift)
	let cell = fract( h.xz + ( rain.drift - rain.camPos.xz ) / Bx );
	let xz0 = rain.camPos.xz + ( cell - 0.5 ) * Bx;

	// ---- fall: terminal velocity by drop size (1.2 mm ~ 4.5 m/s, 2.5 mm ~ 9 m/s), falling for ever
	let speed = mix( 4.6, 9.0, h2.x * h2.x );
	let yTop = rain.camPos.y + By * 0.55;
	let y = yTop - fract( h.y + t * speed / By ) * By;

	// ---- the wind carries the drops (and the squall adds to it)
	let gust = frame.weather.w;
	let windX = frame.windSpeed * ${ f( this.windScale ) } * ( 1.0 + 0.8 * gust );
	let vel = vec3f( frame.windDir.x * windX, - speed, frame.windDir.y * windX );

	// ---- stop at the ground and at the sea
	let ground = max( ${ hasTerrain ? 'terrainHeightAt( xz0 )' : '- 1e4' }, frame.seaLevel );
	let above = y - ground;

	let p = vec3f( xz0.x, y, xz0.y );

	// ---- footprint: never under ~1.2 px wide; the streak is as long as the drop travels in one
	// exposure (a real 9 m/s drop crosses 20 cm in 1/45 s: at 10 m that is a short dash, not a line)
	let toCam = frame.cameraPos - p;
	let dist = max( length( toCam ), 0.05 );
	let Vd = toCam / dist;
	let p11 = frame.proj[ 1 ][ 1 ];
	let pixel = dist * 2.0 / ( p11 * frame.resolution.y );
	let r = mix( 0.0006, 0.0014, h.x ); // drop radius (m)
	let wid = max( r, pixel * 1.2 );
	let len = speed * rain.stretch;

	// ---- lighting: clear water, forward scattering, so it is dark against the land and glows when
	// it is backlit; the lightning flash (frame.weather.z) lights the whole curtain of rain
	let cosT = - dot( Vd, frame.sunDir );
	let sun = frame.sunColor * rainPhaseHG( cosT, 0.88 ) * 0.5;
	let sky = frame.skyIrradiance * 0.35;
	let flash = vec3f( 0.75, 0.82, 1.0 ) * ( frame.weather.z * rainPhaseHG( cosT, 0.6 ) * 2.2 );
	let col = sun + sky + flash;

	// ---- opacity: the drop's coverage of the footprint it is drawn at. The streak is anisotropic: it
	// is drawn wider than the drop (never under ~1.2 px) but no longer than it really travels, so the
	// coverage is the drop's share of the *width* (one factor of r / wid, not two as for a round mote:
	// along the fall the drop already fills the streak). Sub-pixel drops stay faint this way, and a
	// distant drizzle thins out instead of becoming a wall of opaque lines.
	let rs = r / wid;
	let cover = min( rs * ${ f( 3.5 * VISIBILITY ) }, 1.0 );
	// fades: the box edges (before the wrap), right in front of the lens, and at the ground
	let edge = smoothstep( Bx * 0.5, Bx * 0.36, max( abs( p.x - rain.camPos.x ), abs( p.z - rain.camPos.z ) ) );
	let fade = edge * smoothstep( 0.2, 0.7, dist ) * smoothstep( 0.0, 0.35, above );
	let a = cover * fade * select( 0.0, 1.0, alive ) * smoothstep( 0.0, 0.08, rain.intensity );

	// ---- the streak: a camera-facing quad stretched along the drop's own velocity
	let dirV = normalize( vel );
	let side = normalize( cross( dirV, Vd ) + vec3f( 1e-5, 0.0, 0.0 ) );
	let corner = v.position.xy; // plane is 2 x 2: corner.y is along the fall, corner.x across
	let world = p + dirV * ( corner.y * len ) + side * ( corner.x * wid );

	o.vRainCol = vec4f( col, a );
	o.vRainUV = corner;
	v.useWorld = true;
	v.worldPos = select( vec3f( 0.0, - 1e5, 0.0 ), world, a > 2e-4 );
	v.worldNormal = Vd;
	v.prevWorldPos = v.worldPos - vel * frame.dt;
`,
			// soft across the streak, fading along it (a drop is brightest at its head)
			surface: /* wgsl */`
	let uvq = in.vs.vRainUV;
	let g = exp( uvq.x * uvq.x * - 3.2 );
	let head = 1.0 - 0.55 * max( uvq.y, 0.0 );
	let a = min( in.vs.vRainCol.w * g * head, 1.0 );
	if ( g < 0.3 || a < 0.0025 ) { discard; }
	s.albedo = in.vs.vRainCol.rgb * a;
	s.emissive = vec3f( 0.0 );
	s.alpha = a;
`,
			output: 'r.color = vec4f( s.albedo, s.alpha );',
		} );

		const geo = new PlaneGeometry( 2, 2 );
		geo.instanceCount = count;
		this.material = mat;
		this.mesh = new Mesh( geo, mat );
		this.mesh.name = 'Rain';
		this.mesh.frustumCulled = false;
		this.mesh.castShadow = false;
		this.mesh.receiveShadow = false;
		this.mesh.renderOrder = 22; // after the air motes: rain is the nearest thing to the lens
		this.mesh.layers.set( LAYERS.TRANSPARENT );

	}

	// rain 0..1; cameraWaterHeight: none is drawn with the camera under water
	update( dt, camera, rain = 0, cameraWaterHeight = 0 ) {

		const visible = rain > 0.005 && camera.position.y > cameraWaterHeight;
		this.mesh.visible = visible;
		if ( ! visible ) return;
		this.intensity.value = rain;
		this.camPos.value.copy( camera.position );
		const s = G.windSpeed.value * this.windScale * dt * ( 1 + 0.8 * G.weather.value.w );
		const d = this.drift.value;
		d.x = ( d.x + G.windDir.value.x * s ) % this.boxW;
		d.y = ( d.y + G.windDir.value.y * s ) % this.boxW;

	}

}
