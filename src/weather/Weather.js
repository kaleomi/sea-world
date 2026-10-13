import { ShaderModule } from '../engine/gpu/Shader.js';
import { SceneLighting } from '../materials/SceneLighting.js';
import { G } from '../core/Globals.js';
import { Color } from '../engine/index.js';
import { Rain } from './Rain.js';
import { WEATHER, WEATHER_IDS, createWeatherState, stepWeather, cloudCover } from './WeatherState.js';

export { WEATHER, WEATHER_IDS };

// Weather: rain, wet surfaces and lightning.
//
// The numbers live in WeatherState.js (pure, testable in node). This class is the system side:
//   * writes `frame.weather` (x rain, y wetness, z lightning, w gust) so every shader can read it
//   * installs the `surface` scene hook: exposed surfaces darken and go glossy while they are wet
//   * drives the rain particles (Rain.js) and, through the SoundScape, the rain bed and thunder
//   * adds the lightning to the sky irradiance for the duration of a flash
//
// The flash is applied as a *delta*: the atmosphere owns `G.skyIrradiance`, so update() first puts
// last frame's clean value back, reads whatever the atmosphere wrote this frame as the new base, and
// only then adds the flash. Nothing accumulates, and the atmosphere stays the single source.

// how much a full flash lifts the sky irradiance (it is a diffuse pulse from the whole cloud deck)
const FLASH_GAIN = 2.0;
const FLASH_COLOR = [ 0.72, 0.8, 1.0 ];

export class Weather {

	constructor( { renderer = null, scene = null, terrain = null, audio = null, fft = null, clouds = null, onClouds = null, preset = 'Clear' } = {} ) {

		this.audio = audio;
		this.fft = fft;
		this.clouds = clouds;
		// called with the cloud cover the weather has just set, so the settings panel's slider follows
		this.onClouds = onClouds;
		this.state = createWeatherState( preset );
		// What the rain does to the sea: it roughens the short waves, so more of the surface breaks
		// into foam and the streaks it leaves are thicker. The settings panel drives foamBias and
		// foamDecay (and the wind, which shapes the spectrum), so the weather keeps off those and owns
		// these two outright - captured once here, so nothing accumulates.
		this._seaBase = fft ? { foamGain: fft.foamGain.value, foamAdd: fft.foamAdd.value } : null;
		// The rain has to come out of something. The settings panel owns `clouds.coverage` (and writes
		// it straight into the cloud shell every frame), so the weather sets it too - and thickens and
		// darkens the shell (thickness, density) which nothing else touches.
		this._cloudBase = clouds && clouds.S && clouds.S.shell
			? { thickness: clouds.S.shell.value[ 1 ], density: clouds.S.shell.value[ 2 ] }
			: null;

		// what the settings panel binds to
		this.params = { preset: WEATHER[ preset ] ? preset : 'Clear', rain: this.state.target, lightning: this.state.lightningRate, gust: this.state.gustAmount };

		this.rain = new Rain( { terrain } );
		if ( scene ) scene.add( this.rain.mesh );

		this._baseSky = new Color( 0, 0, 0 );
		this._lastFlash = 0;
		this._stormAudio = 0;

		// wet surfaces: the last word on every lit surface, installed once (SceneLighting.set bumps a
		// version that rebuilds every pipeline, so this belongs in init, never at runtime)
		SceneLighting.set( 'surface', new ShaderModule( {
			name: 'wetSurface', code: /* wgsl */`
fn hookSurface( P: vec3f, N: vec3f, s: ptr<function, Surface> ) {
	let wet = frame.weather.y;
	if ( wet <= 0.002 ) { return; }
	// a film of water lies on surfaces that face the sky: undersides and steep faces stay dry
	let w = wet * smoothstep( 0.08, 0.55, N.y );
	if ( w <= 0.002 ) { return; }
	// wet things are darker (water fills the pores, so less light leaves them) and much glossier.
	// Metal is already smooth and does not soak: it barely changes.
	let m = ( *s ).metalness;
	( *s ).albedo *= mix( 1.0, 0.52, w * ( 1.0 - m * 0.85 ) );
	( *s ).roughness = mix( ( *s ).roughness, min( ( *s ).roughness, 0.1 ), w * ( 1.0 - m ) );
}
`,
		} ) );

	}

	get rainLevel() { return this.state.rain; }
	get wetness() { return this.state.wetness; }
	get lightning() { return this.state.lightning; }

	setPreset( id ) {

		const p = WEATHER[ id ];
		if ( ! p ) return;
		this.params.preset = id;
		this.params.rain = p.rain;
		this.params.lightning = p.lightning;
		this.params.gust = p.gust;
		this._apply();

	}

	// the settings panel's sliders (a custom mix: no longer one of the presets)
	setRain( v ) { this.params.rain = Math.max( 0, Math.min( 1, v ) ); this.params.preset = 'Custom'; this._apply(); }
	setLightning( v ) { this.params.lightning = Math.max( 0, Math.min( 1, v ) ); this.params.preset = 'Custom'; this._apply(); }
	setGust( v ) { this.params.gust = Math.max( 0, Math.min( 1, v ) ); this.params.preset = 'Custom'; this._apply(); }

	_apply() {

		const s = this.state;
		s.target = this.params.rain;
		s.lightningRate = this.params.lightning;
		s.gustAmount = this.params.gust;
		s.preset = this.params.preset;
		this._applyClouds();

	}

	_applyClouds() {

		if ( ! this.clouds ) return;
		const cov = cloudCover( this.params.rain );
		this.clouds.coverage.value = cov;
		if ( this.onClouds ) this.onClouds( cov );

	}

	update( dt, camera, cameraWaterHeight = 0 ) {

		const s = this.state;
		const before = s.flashCount;

		stepWeather( s, dt, { night: G.night.value, windSpeed: G.windSpeed.value } );

		// ---- the lightning: put last frame's clean irradiance back, read the atmosphere's value as
		// the new base, then add the flash (so nothing accumulates across frames)
		const sky = G.skyIrradiance.value;
		sky.copy( this._baseSky );
		this._baseSky.copy( sky );
		const L = s.lightning;
		if ( L > 1e-4 ) {

			const k = L * FLASH_GAIN;
			sky.r = this._baseSky.r + FLASH_COLOR[ 0 ] * k;
			sky.g = this._baseSky.g + FLASH_COLOR[ 1 ] * k;
			sky.b = this._baseSky.b + FLASH_COLOR[ 2 ] * k;

		}

		// a strike has just started: thunder (and the rain bed follows the level every frame)
		if ( s.flashCount > before && this.audio && this.audio.thunder ) {

			let amp = 0;
			for ( const f of s.strikes ) if ( f.t0 <= s.time && f.t0 > s.time - dt ) amp = Math.max( amp, f.amp );
			this.audio.thunder( Math.min( amp, 1.2 ), s.rain );

		}

		if ( this.audio && this.audio.setWeather ) this.audio.setWeather( s.rain, s.wetness );

		// ---- frame uniform + the particles
		G.weather.value.set( s.rain, s.wetness, L, s.gust );
		this.rain.update( dt, camera, s.rain, cameraWaterHeight );

		// ---- the sea: more whitecaps while it rains (the water shader reads frame.weather.x itself
		// for the rings the drops leave, and for the short-wave roughness they add)
		if ( this._seaBase ) {

			this.fft.foamGain.value = this._seaBase.foamGain * ( 1 + 0.9 * s.rain );
			this.fft.foamAdd.value = this._seaBase.foamAdd + 2.4 * s.rain;

		}

		// ---- the cloud: a rain cloud is a deeper, denser shell than fair-weather cumulus (the panel's
		// cloud cover is set with the preset; these two are the weather's own)
		if ( this._cloudBase ) {

			const sh = this.clouds.S.shell.value;
			sh[ 1 ] = this._cloudBase.thickness * ( 1 + 0.55 * s.rain );
			sh[ 2 ] = this._cloudBase.density * ( 1 + 1.3 * s.rain );

		}

	}

}
