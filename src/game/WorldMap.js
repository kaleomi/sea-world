import { STAND } from './FishStand.js';
import { CHANDLERY } from './Chandlery.js';
import { ISLANDS } from '../world/islands/index.js';
import { paintZones, ZONE_LABELS, ZONE_BY_ID, TRENCH } from './Zones.js';
import { forecast } from '../core/WorldClock.js';
import { WEATHER } from '../weather/WeatherState.js';
import { icon } from '../ui/icons.js';
import { t } from '../i18n/index.js';

// The full map (M): every island, north up, drawn from the minimap's baked canvases into one canvas
// over the screen, on the ocean zones (Zones.js). Markers: you (an arrow the way the view faces), your boat, Joe and Marta, the quest
// givers on the outer islands (bright when a job can be handed in), the other players on the shared sea,
// the island names and a scale bar. Scroll zooms round the cursor, dragging moves it; M or Esc closes.
// Only draws while open.
//   const map = new WorldMap( hudEl, game, minimap );  map.toggle();  map.update()

const CSS = /* css */`
.gm-world { position: absolute; inset: 0; z-index: 30; display: none; place-items: center; background: rgba(4, 10, 16, 0.55); pointer-events: auto; }
.gm-world.is-open { display: grid; }
.gm-world-box { position: relative; width: min(92vw, 1500px); height: min(86vh, 900px); display: flex; flex-direction: column; border-radius: 14px; overflow: hidden; }
.gm-world-head { display: flex; justify-content: space-between; align-items: baseline; gap: var(--tw-3); padding: var(--tw-2) var(--tw-3); }
.gm-world-head b { font: 600 var(--tw-fs-lg, 16px) var(--tw-font); color: var(--tw-ink); }
.gm-world-head span { font-size: var(--tw-fs-sm); color: var(--tw-ink-3); }
.gm-world-view { position: relative; flex: 1; min-height: 0; background: #0c2c4e; cursor: grab; }
.gm-world-view.is-drag { cursor: grabbing; }
.gm-world-view canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
.gm-forecast { position: absolute; top: var(--tw-3); left: var(--tw-3); min-width: 230px; padding: var(--tw-2) var(--tw-3); border-radius: 10px;
	background: rgba(6, 16, 26, 0.78); box-shadow: 0 0 0 1px rgba(255,255,255,0.08); pointer-events: none; font-size: var(--tw-fs-sm); color: var(--tw-ink-2); }
.gm-forecast h4 { margin: 0 0 6px; font: 600 var(--tw-fs-md, 14px) var(--tw-font); color: var(--tw-ink); }
.gm-forecast-row { display: grid; grid-template-columns: 5.2em 1.4em 1fr; align-items: center; gap: 6px; padding: 3px 0; }
.gm-forecast-row.is-now { color: var(--tw-ink); font-weight: 600; }
.gm-forecast-row svg { width: 1.2em; height: 1.2em; }
.gm-forecast-row small { color: var(--tw-ink-3); }
.gm-forecast-row.is-storm { color: #ffb38a; }
`;

const MARK = { joe: '#f3c24f', marta: '#5fd3cf', quest: '#f0a35a', ready: '#ffd35a', done: '#b9b2a4', boat: '#f2efe6' };

const h = ( tag, cls, html ) => {

	const e = document.createElement( tag );
	if ( cls ) e.className = cls;
	if ( html !== undefined ) e.innerHTML = html;
	return e;

};

export class WorldMap {

	constructor( parent, game, minimap ) {

		this.game = game;
		this.minimap = minimap;
		const style = h( 'style' );
		style.textContent = CSS;
		document.head.append( style );
		this.el = h( 'div', 'gm-world', `<div class="gm-world-box tw-glass"><div class="gm-world-head"><b>${ t( 'Map' ) }</b><span>${ t( 'Scroll to zoom · drag to move · M or Esc to close' ) }</span></div>
			<div class="gm-world-view"><canvas></canvas><div class="gm-forecast"></div></div></div>` );
		this.forecastEl = this.el.querySelector( '.gm-forecast' );
		this.view = this.el.querySelector( '.gm-world-view' );
		this.canvas = this.el.querySelector( 'canvas' );
		this.ctx = this.canvas.getContext( '2d' );
		parent.append( this.el );
		this.open = false;
		this.cx = 0; // world point at the view's centre
		this.cz = 0;
		this.scale = 0.2; // css px per metre
		this._fit = 0.2;
		// clicking the dark backdrop closes it
		this.el.addEventListener( 'mousedown', ( e ) => {

			if ( e.target === this.el ) this.toggle( false );

		} );
		this.view.addEventListener( 'wheel', ( e ) => {

			e.preventDefault();
			const r = this.view.getBoundingClientRect();
			const mx = e.clientX - r.left - r.width / 2, my = e.clientY - r.top - r.height / 2;
			// keep the point under the cursor where it is
			const wx = this.cx + mx / this.scale, wz = this.cz + my / this.scale;
			this.scale = Math.min( 4, Math.max( this._fit * 0.8, this.scale * Math.exp( - e.deltaY * 0.0015 ) ) );
			this.cx = wx - mx / this.scale;
			this.cz = wz - my / this.scale;

		}, { passive: false } );
		let drag = null;
		this.view.addEventListener( 'mousedown', ( e ) => {

			if ( e.button !== 0 ) return;
			drag = { x: e.clientX, y: e.clientY, cx: this.cx, cz: this.cz };
			this.view.classList.add( 'is-drag' );

		} );
		window.addEventListener( 'mousemove', ( e ) => {

			if ( ! drag ) return;
			this.cx = drag.cx - ( e.clientX - drag.x ) / this.scale;
			this.cz = drag.cz - ( e.clientY - drag.y ) / this.scale;

		} );
		window.addEventListener( 'mouseup', () => {

			drag = null;
			this.view.classList.remove( 'is-drag' );

		} );

	}

	// the world rectangle every island's bake covers, with a margin
	bounds() {

		let x0 = Infinity, z0 = Infinity, x1 = - Infinity, z1 = - Infinity;
		for ( const L of this.minimap._layers ) {

			x0 = Math.min( x0, L.x0 );
			z0 = Math.min( z0, L.z0 );
			x1 = Math.max( x1, L.x0 + L.n / L.ppm );
			z1 = Math.max( z1, L.z0 + L.n / L.ppm );

		}

		// ... and the trench, the far end of the sea (Zones.js)
		for ( const a of [ - 1, - 0.5, 0, 0.5, 1 ] ) for ( const r of [ TRENCH.r0, TRENCH.r1 ] ) {

			const ang = TRENCH.angle + a * TRENCH.half;
			x0 = Math.min( x0, Math.cos( ang ) * r );
			x1 = Math.max( x1, Math.cos( ang ) * r );
			z0 = Math.min( z0, Math.sin( ang ) * r );
			z1 = Math.max( z1, Math.sin( ang ) * r );

		}

		const m = 150;
		return { x0: x0 - m, z0: z0 - m, x1: x1 + m, z1: z1 + m };

	}

	toggle( force ) {

		const open = force ?? ! this.open;
		if ( open === this.open ) return;
		this.open = open;
		this.el.classList.toggle( 'is-open', open );
		if ( open ) {

			// fit the whole archipelago, then centre on where you are
			const b = this.bounds(), w = this.view.clientWidth || 1200, hh = this.view.clientHeight || 700;
			this._fit = Math.min( w / ( b.x1 - b.x0 ), hh / ( b.z1 - b.z0 ) );
			this.scale = this._fit;
			this.cx = ( b.x0 + b.x1 ) / 2;
			this.cz = ( b.z0 + b.z1 ) / 2;
			try {

				if ( document.pointerLockElement && document.exitPointerLock ) document.exitPointerLock();

			} catch ( e ) { /* ignore */ }

			this._fcT = 0;
			this.update();

		}

	}

	// the weather forecast card (the shared schedule, core/WorldClock.js): now and the next spells, each
	// with the real minutes until it starts and the sea it brings
	renderForecast() {

		const ww = this.game.app.worldWeather;
		if ( ! ww || ! ww.weather ) {

			this.forecastEl.style.display = 'none';
			return;

		}

		this.forecastEl.style.display = '';
		const now = Date.now();
		const rows = forecast( now, 6 ).map( ( f, i ) => {

			const w = f.weather;
			const ic = w === 'Storm' ? 'storm' : w === 'Rain' ? 'droplet' : w === 'Drizzle' ? 'cloud' : 'sun';
			const when = i === 0 ? t( 'Now' ) : t( 'in {m} min', { m: Math.max( 1, Math.round( ( f.start - now ) / 60000 ) ) } );
			return `<div class="gm-forecast-row${ i === 0 ? ' is-now' : '' }${ w === 'Storm' ? ' is-storm' : '' }"><span>${ when }</span>${ icon( ic ) }<span>${ t( WEATHER[ w ].label ) } <small>· ${ t( f.sea ) }</small></span></div>`;

		} ).join( '' );
		const html = `<h4>${ t( 'Weather forecast' ) }</h4>${ rows }`;
		if ( html !== this._fcHtml ) this.forecastEl.innerHTML = this._fcHtml = html;

	}

	update() {

		if ( ! this.open ) return;
		this._fcT = ( this._fcT || 0 ) - 1;
		if ( this._fcT <= 0 ) {

			this._fcT = 30;
			this.renderForecast();

		}

		const dpr = Math.min( 2, window.devicePixelRatio || 1 );
		const W = this.view.clientWidth, H = this.view.clientHeight;
		if ( ! W || ! H ) return;
		if ( this.canvas.width !== Math.round( W * dpr ) || this.canvas.height !== Math.round( H * dpr ) ) {

			this.canvas.width = Math.round( W * dpr );
			this.canvas.height = Math.round( H * dpr );

		}

		const ctx = this.ctx, s = this.scale;
		const X = ( x ) => W / 2 + ( x - this.cx ) * s, Y = ( z ) => H / 2 + ( z - this.cz ) * s;
		ctx.setTransform( dpr, 0, 0, dpr, 0, 0 );
		// the ocean zones (coastal, offshore, deep sea, the trench) under the islands
		paintZones( ctx, X, Y, s, W, H );
		ctx.imageSmoothingEnabled = true;
		for ( const L of this.minimap._layers ) {

			const ext = L.n / L.ppm;
			ctx.drawImage( L.canvas, X( L.x0 ), Y( L.z0 ), ext * s, ext * s );

		}

		const app = this.game.app, p = app.player, cam = app.camera;
		// labels: drawn in priority order, one that would overlap an earlier one is left out (zoom in to see it)
		const taken = [];
		const label = ( text, x, y, size, color = '#fff', weight = 600, force = false ) => {

			ctx.font = `${ weight } ${ size }px system-ui, "PingFang SC", "Microsoft YaHei", sans-serif`;
			const w = ctx.measureText( text ).width + 6, hh = size + 4;
			const box = { x0: x - w / 2, x1: x + w / 2, y0: y - hh / 2, y1: y + hh / 2 };
			if ( ! force && taken.some( ( b ) => b.x0 < box.x1 && box.x0 < b.x1 && b.y0 < box.y1 && box.y0 < b.y1 ) ) return;
			taken.push( box );
			ctx.textAlign = 'center';
			ctx.textBaseline = 'middle';
			ctx.lineJoin = 'round';
			ctx.lineWidth = 3;
			ctx.strokeStyle = 'rgba(0, 0, 0, 0.65)';
			ctx.strokeText( text, x, y );
			ctx.fillStyle = color;
			ctx.fillText( text, x, y );

		};
		const dots = [];
		const dot = ( x, z, color, r, text ) => {

			const sx = X( x ), sy = Y( z );
			ctx.beginPath();
			ctx.arc( sx, sy, r, 0, Math.PI * 2 );
			ctx.fillStyle = color;
			ctx.fill();
			ctx.lineWidth = 1.5;
			ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
			ctx.stroke();
			if ( text ) dots.push( [ text, sx, sy - r - 9 ] );

		};

		const short = ( name ) => t( name ).split( ' · ' )[ 0 ];
		// Joe, Marta and the quest givers
		dot( STAND.x, STAND.z, MARK.joe, 6, short( 'Joe · Fish buyer' ) );
		dot( CHANDLERY.x, CHANDLERY.z, MARK.marta, 6, short( 'Marta · Chandlery' ) );
		for ( const v of this.game.givers || [] ) {

			const st = this.game.questState( v.giver );
			dot( v.position.x, v.position.z, MARK[ st === 'open' ? 'quest' : st ], st === 'ready' ? 8 : 6, short( v.name ) + ( st === 'ready' ? ' !' : '' ) );

		}

		// the other players
		for ( const q of app.net ? app.net.remote.positions() : [] ) dot( q.x, q.z, q.color, 5, q.name );

		// the boat, when you're not on it
		const b = app.boatCtl;
		if ( b && p.mode !== 'boat' && p.mode !== 'deck' ) dot( b.position.x, b.position.z, MARK.boat, 5, t( 'Boat' ) );

		// you: an arrow the way the view faces
		const e = cam.matrixWorld.elements;
		const ang = Math.atan2( - e[ 8 ], - e[ 10 ] ); // forward (x, z) as an angle from +z
		const px = X( cam.position.x ), py = Y( cam.position.z );
		ctx.save();
		ctx.translate( px, py );
		ctx.rotate( Math.PI - ang );
		ctx.beginPath();
		ctx.moveTo( 0, - 11 );
		ctx.lineTo( 8, 9 );
		ctx.lineTo( 0, 4.5 );
		ctx.lineTo( - 8, 9 );
		ctx.closePath();
		ctx.fillStyle = '#fff';
		ctx.fill();
		ctx.lineWidth = 1.6;
		ctx.strokeStyle = '#0b1418';
		ctx.stroke();
		ctx.restore();
		// the labels, most important first: you, the island names (north of each island), the people
		// (zoom in to see the ones that would overlap)
		label( t( 'You' ), px, py + 20, 12, '#fff', 600, true );
		for ( const d of Object.values( ISLANDS ) ) {

			const ox = d.position ? d.position.x : 0, oz = d.position ? d.position.z : - 180;
			const north = d.position ? ( d.size || 1024 ) * 0.36 : 520; // metres from the centre to above the land
			label( t( d.name ), X( ox ), Math.min( Y( oz ) - 24, Y( oz - north ) ), Math.round( Math.min( 22, Math.max( 14, 60 * s ) ) ), '#fff7e0', 700 );

		}

		for ( const z of ZONE_LABELS ) label( t( ZONE_BY_ID[ z.id ].name ), X( z.x ), Y( z.z ), 13, z.id === 'trench' ? '#c9b8ff' : '#b8d4f0', 600 );
		for ( const [ text, x, y ] of dots.reverse() ) label( text, x, y, 12 );

		// scale bar: a round distance about 120 px long
		const want = 120 / s;
		const steps = [ 25, 50, 100, 200, 250, 500, 1000, 2000 ];
		const m = steps.find( ( v ) => v >= want * 0.6 ) || 2000;
		const len = m * s, bx = 18, by = H - 22;
		ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
		ctx.fillRect( bx - 8, by - 22, len + 16, 32 );
		ctx.strokeStyle = '#fff';
		ctx.lineWidth = 2;
		ctx.beginPath();
		ctx.moveTo( bx, by - 4 );
		ctx.lineTo( bx, by );
		ctx.lineTo( bx + len, by );
		ctx.lineTo( bx + len, by - 4 );
		ctx.stroke();
		label( m >= 1000 ? `${ m / 1000 } km` : `${ m } m`, bx + len / 2, by - 11, 11, '#fff', 600, true );
		// north
		label( t( 'N' ), W - 22, 22, 14, '#fff', 600, true );
		ctx.beginPath();
		ctx.moveTo( W - 22, 30 );
		ctx.lineTo( W - 22, 46 );
		ctx.strokeStyle = '#fff';
		ctx.stroke();

	}

}
