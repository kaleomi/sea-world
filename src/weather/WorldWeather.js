import { worldHour, weatherAt } from '../core/WorldClock.js';

// Drives the hour and the weather from the shared world clock (core/WorldClock.js): every player sees
// the same time of day, the same rain and the same sea. Developers can take either over by hand (the
// Sky tab's time slider, T, a weather preset or a sea-state preset); a manual change switches that
// part off until it's switched back on (app.worldWeather.clock / .weather, the Sky tab toggles).
//   const ww = new WorldWeather( app );  ww.update( dt )  ww.onChange = ( weather, sea, first ) => {}
export class WorldWeather {

	constructor( app, { clock = true, weather = true, now = () => Date.now() } = {} ) {

		this.app = app;
		this.clock = clock;
		this.weather = weather;
		this.now = now;
		this.current = null; // { block, weather, sea } last applied
		this.onChange = null;
		this._hour = null;
		this._seaT = 0;
		this._checkT = 0;

	}

	// the time of day: once a frame, before anything reads it
	updateClock() {

		const s = this.app.settings;
		if ( ! this.clock ) return;
		// someone moved the hour by hand (the slider, a view preset): hand the clock over to them
		if ( this._hour !== null && Math.abs( s.timeOfDay - this._hour ) > 1e-6 ) {

			this.clock = false;
			this._hour = null;
			return;

		}

		s.timeSpeed = 0;
		s.timeOfDay = this._hour = worldHour( this.now() );

	}

	setClock( on ) {

		this.clock = !! on;
		this._hour = null;
		if ( on ) this.updateClock();

	}

	setWeather( on ) {

		this.weather = !! on;
		this.current = null;
		this._checkT = 0;

	}

	update( dt ) {

		this.updateClock();
		if ( ! this.weather ) return;
		const app = this.app;
		this._checkT -= dt;
		if ( this._checkT <= 0 ) {

			this._checkT = 1;
			const w = weatherAt( this.now() );
			if ( ! this.current || w.weather !== this.current.weather || w.sea !== this.current.sea ) {

				const first = ! this.current;
				this.current = w;
				if ( app.weather ) app.weather.setPreset( w.weather );
				if ( first && app.ui && app.ui.seaToward ) app.ui.seaToward( w.sea, 1 );
				if ( this.onChange ) this.onChange( w.weather, w.sea, first );

			}

		}

		// the sea follows over half a minute or so (small steps: the spectrum keeps its phases)
		this._seaT -= dt;
		if ( this._seaT <= 0 && this.current && app.ui && app.ui.seaToward ) {

			this._seaT = 2;
			app.ui.seaToward( this.current.sea, 0.12 );

		}

	}

}
