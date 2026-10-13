import { NetClient, errorText } from './NetClient.js';
import { RemotePlayers } from './RemotePlayers.js';
import { DEFAULT_PORT, AVATARS, cleanName, cleanAvatar } from './Protocol.js';
import { HOUSE } from '../world/boat/Wheelhouse.js';
import { FISH } from '../game/FishTable.js';
import { LEGENDS } from '../game/Legends.js';
import { CatchDisplay } from '../game/CatchDisplay.js';
import { createRodMaterial, buildRodGeometry, buildBobberGeometry, buildLineGeometry, LINE_SEGS } from '../game/FishingRod.js';
import { createLineMaterial } from '../game/GameMaterials.js';
import { SkinnedModel } from '../engine/render/Skinning.js';
import { loadGLB } from '../engine/loaders/GLTF.js';
import { Chat } from './Chat.js';
import { t } from '../i18n/index.js';

// Multiplayer in the game: the link to a shared sea (NetClient), the other players drawn in the world
// (RemotePlayers), our state (with the rod) sent every frame, catches and chat told both ways (Chat:
// Enter to talk), and the settings (name, avatar, colour, server) kept in localStorage 'tidewater.net'.
// The start screen asks for the name and avatar (main.js, saveProfile) and the game goes online as it
// starts (app.playing); ?noNet stays offline, ?server=ws://host:port picks the server. The "Online" view
// of the inventory panel (GameHUD.renderOnline, developer mode) changes the server. A build can name
// its public server (VITE_NET_SERVER=wss://..., e.g. in .env.production): the default for new players.
//   app.net = new Multiplayer( app );  app.net.update( dt ) after game.update, before query.update
const KEY = 'tidewater.net';
const COLORS = [ '#e2574c', '#f2a541', '#e8d44d', '#5fbf6a', '#3fb6c8', '#4f7fe0', '#9b6ad6', '#e070b0' ];
const ANNOUNCE_GAP = 4; // s between catch announcements of the same player
const BUILT_SERVER = ( import.meta.env && import.meta.env.VITE_NET_SERVER ) || '';

export function defaultServer( loc = globalThis.location ) {

	const host = loc && loc.hostname ? loc.hostname : '127.0.0.1';
	const secure = loc && loc.protocol === 'https:';
	return `${ secure ? 'wss' : 'ws' }://${ host.includes( ':' ) ? `[${ host }]` : host }:${ DEFAULT_PORT }`;

}

// what the player typed -> a socket address. No scheme: wss on an https page (which may only open secure
// sockets), ws otherwise. A plain ws:// address without a port gets ours; a wss:// one is a hosted server
// behind https and stays on its own port (443).
export function normalizeServer( input, loc = globalThis.location ) {

	let url = String( input ).trim().replace( /\/+$/, '' );
	if ( ! /^wss?:\/\//i.test( url ) ) url = `${ loc && loc.protocol === 'https:' ? 'wss' : 'ws' }://${ url }`;
	const m = url.match( /^(wss?):\/\/([^/]+)(.*)$/i );
	if ( m && m[ 1 ].toLowerCase() === 'ws' && ! /(^[^:]*|\]):\d+$/.test( m[ 2 ] ) ) url = `${ m[ 1 ] }://${ m[ 2 ] }:${ DEFAULT_PORT }${ m[ 3 ] }`;
	return url;

}

// the rod's state for the others (Protocol ROD_STATES)
const ROD_CODE = { stowed: 0, idle: 1, windup: 2, flick: 3, flying: 4, floating: 4, retrieving: 4, fighting: 5, landing: 6 };

const storage = () => {

	try {

		return typeof localStorage !== 'undefined' ? localStorage : null;

	} catch ( e ) {

		return null;

	}

};

// what the start screen shows: { name, av } (name '' when none was chosen yet)
export function loadProfile() {

	try {

		const s = JSON.parse( storage()?.getItem( KEY ) || '{}' ) || {};
		return { name: cleanName( s.name ) || '', av: cleanAvatar( s.av ) || AVATARS[ 0 ] };

	} catch ( e ) {

		return { name: '', av: AVATARS[ 0 ] };

	}

}

// the start screen's choice, kept with the other settings
export function saveProfile( { name, av } ) {

	try {

		const s = JSON.parse( storage()?.getItem( KEY ) || '{}' ) || {};
		if ( cleanName( name ) ) s.name = cleanName( name );
		if ( cleanAvatar( av ) ) s.av = av;
		storage()?.setItem( KEY, JSON.stringify( s ) );

	} catch ( e ) { /* private mode */ }

}

export class Multiplayer {

	constructor( app ) {

		this.app = app;
		this.client = new NetClient();
		this.settings = this._load();
		this._listeners = [];
		this._announced = new Map();
		const ui = app.ui && app.ui.ui;
		const base = ( import.meta.env && import.meta.env.BASE_URL ) || '/';
		const glbs = new Map();
		const rod = app.game.rod;
		this.remote = new RemotePlayers( {
			net: this.client, scene: app.scene, camera: app.camera, boat: app.boat, query: app.query,
			sceneRenderer: app.sceneRenderer, figureMaterial: app.game.stand.vendor.material,
			labelRoot: ui ? ( ui.hud || ui.root ) : null,
			// one parsed GLB per avatar, one SkinnedModel (its own pose) per player
			loadAvatar: ( av ) => {

				if ( ! glbs.has( av ) ) glbs.set( av, loadGLB( `${ base }models/characters/player_${ av }.glb` ) );
				return glbs.get( av ).then( ( g ) => SkinnedModel.create( g ) );

			},
			rodKit: {
				rodGeometry: buildRodGeometry(), rodMaterial: createRodMaterial,
				lineGeometry: buildLineGeometry( LINE_SEGS ), lineMaterial: () => createLineMaterial( LINE_SEGS ),
				bobberGeometry: buildBobberGeometry(), bobberMaterial: rod.bobberMat,
			},
			catchDisplay: () => new CatchDisplay( { scene: app.scene } ),
		} );
		// Enter talks, unless the start screen, the guide or the map has it
		this.chat = ui ? new Chat( ui.hud || ui.root, this, { canOpen: () => ! ui._start && ! ( app.game.guide && app.game.guide.open ) && ! app.game.mapOpen } ) : null;
		const c = this.client;
		c.on( 'join', ( p ) => {

			const msg = t( '{name} sailed into the shared sea', { name: p.name } );
			if ( this.chat ) this.chat.system( msg );
			else this._toast( msg );
			this._changed();

		} );
		c.on( 'leave', ( p ) => {

			if ( c.online && this.chat ) this.chat.system( t( '{name} left the shared sea', { name: p.name } ) );
			else if ( c.online ) this._toast( t( '{name} left the shared sea', { name: p.name } ) );
			this._changed();

		} );
		c.on( 'catch', ( p, m ) => {

			this.remote.landed( p.id, m.species, m.kg );
			this._theirCatch( p, m );

		} );
		c.on( 'chat', ( p, text ) => {

			this.remote.say( p.id, text );
			if ( this.chat ) this.chat.add( p.name, text, p.color );

		} );
		c.on( 'status', ( s, err ) => {

			if ( s === 'online' && this.chat ) this.chat.system( t( 'Online · {n} other players on this sea', { n: c.peers.size } ) );
			else if ( s === 'online' ) this._toast( t( 'Online · {n} other players on this sea', { n: c.peers.size } ) );
			else if ( s === 'error' ) this._toast( t( errorText( err ) ), 5000 );
			this._changed();

		} );
		app.game.onCatch = ( f ) => c.sendCatch( f );
		const qs = app.qs;
		if ( qs && qs.has( 'server' ) ) this.connect( { server: qs.get( 'server' ) } );
		else if ( app.playing ) this.connect(); // the start screen has already been passed

	}

	_load() {

		let s = {};
		try {

			s = JSON.parse( storage()?.getItem( KEY ) || '{}' ) || {};

		} catch ( e ) { /* fresh */ }

		return {
			name: cleanName( s.name ) || `${ t( 'Sailor' ) } ${ 100 + Math.floor( Math.random() * 900 ) }`,
			color: COLORS.includes( s.color ) ? s.color : COLORS[ Math.floor( Math.random() * COLORS.length ) ],
			av: cleanAvatar( s.av ) || AVATARS[ 0 ],
			server: typeof s.server === 'string' && s.server ? s.server : BUILT_SERVER || defaultServer(),
		};

	}

	_save() {

		try {

			storage()?.setItem( KEY, JSON.stringify( this.settings ) );

		} catch ( e ) { /* private mode */ }

	}

	get status() {

		return this.client.status;

	}

	get error() {

		return this.client.error;

	}

	get colors() {

		return COLORS;

	}

	// [ { name, color, you? } ]: us first, then the others
	players() {

		const list = [ { name: this.settings.name, color: this.settings.color, you: true } ];
		for ( const p of this.client.peers.values() ) list.push( { name: p.name, color: p.color } );
		return list;

	}

	onChange( fn ) {

		this._listeners.push( fn );

	}

	_changed() {

		for ( const fn of this._listeners ) fn();

	}

	connect( { name, color, server, av } = {} ) {

		if ( name !== undefined ) this.settings.name = cleanName( name ) || this.settings.name;
		if ( av !== undefined && cleanAvatar( av ) ) this.settings.av = av;
		if ( color !== undefined && COLORS.includes( color ) ) this.settings.color = color;
		if ( server !== undefined && String( server ).trim() ) this.settings.server = normalizeServer( server );

		this._save();
		this.client.connect( this.settings.server, { name: this.settings.name, color: this.settings.color, av: this.settings.av } );

	}

	disconnect() {

		this.client.disconnect();

	}

	// a chat line from us: to the others, and into our own log
	say( text ) {

		const s = this.client.sendChat( text );
		if ( ! s ) return false;
		if ( this.chat ) this.chat.add( this.settings.name, s, this.settings.color, true );
		return true;

	}

	_toast( text, ms = 3200 ) {

		this.app.game.toast( text, ms );

	}

	// a legend, or a fish in the heavier half of its species' range, is worth telling everyone
	_theirCatch( p, m ) {

		const f = FISH[ m.species ];
		if ( ! f ) return;
		const now = performance.now() / 1000;
		if ( now - ( this._announced.get( p.id ) ?? - Infinity ) < ANNOUNCE_GAP ) return;
		if ( m.legend && LEGENDS[ m.legend ] ) this._toast( t( '{name} landed {legend}! {kg} kg', { name: p.name, legend: t( LEGENDS[ m.legend ].name ), kg: m.kg.toFixed( 1 ) } ), 6000 );
		else if ( m.kg >= ( f.kg[ 0 ] + f.kg[ 1 ] ) / 2 ) this._toast( t( '{name} caught a {kg} kg {fish}', { name: p.name, kg: m.kg < 1 ? m.kg.toFixed( 2 ) : m.kg.toFixed( 1 ), fish: t( f.name ) } ), 4000 );
		else return;
		this._announced.set( p.id, now );

	}

	// what the others need to draw us
	state() {

		const app = this.app, p = app.player, g = app.boat.group;
		const e = app.camera.matrixWorld.elements;
		const s = {
			m: p.mode,
			p: [ p.position.x, p.position.y, p.position.z ],
			yaw: Math.atan2( - e[ 8 ], - e[ 10 ] ),
			b: [ g.position.x, g.position.y, g.position.z, g.quaternion.x, g.quaternion.y, g.quaternion.z, g.quaternion.w ],
			bh: g.position.y - app.boatCtl.waterLevel,
		};
		if ( p.mode === 'deck' ) s.l = [ p.deckPos.x, p.deckPos.y, p.deckPos.z ];
		else if ( p.mode === 'boat' ) s.l = [ HOUSE.helmX, app.boat.lines.deckY, HOUSE.seatZ ];
		// the rod, and where the line ends
		const rod = app.game.rod;
		const r = rod.equipped ? ROD_CODE[ rod.state ] ?? 1 : 0;
		if ( r ) s.r = r;
		if ( r >= 3 ) s.k = [ rod.bobber.x, rod.bobber.y, rod.bobber.z ];
		if ( ! [ 'walk', 'swim', 'boat', 'deck' ].includes( s.m ) ) s.m = 'walk';
		return s;

	}

	update( dt ) {

		if ( this.client.online ) this.client.sendState( this.state() );
		this.remote.update( dt );

	}

}
