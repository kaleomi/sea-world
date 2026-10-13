import { Group, Mesh, Quaternion, Vector3 } from '../engine/index.js';
import { buildFigure } from '../game/Vendor.js';

// The other players on the shared sea (net/NetClient.js): each one's boat and figure, and a name over
// their head. Their boat is a copy of ours (same geometry and materials, so no new pipelines), set on
// OUR waves: the sender says how high their hull rides above the water under it (bh) and we add that to
// our own water height there, read back from the GPU like our boat's (WaterQuery). The figure is the
// traders' stand-in (Vendor.buildFigure) in the player's colour; aboard it stands where they are on
// their deck and rolls with the hull.
//   const rp = new RemotePlayers( { net, scene, camera, boat, query, sceneRenderer, figureMaterial, labelRoot } );
//   rp.update( dt ) each frame, before query.update()
const SLOTS = 8; // remote boats whose water height is read back (the rest keep the sender's height)
const EYE = 1.58; // the figure's eye height (m above its feet)
const SWIM_EYE = 0.16; // a swimmer's eyes above the float point the sender gives (Player.SWIM_EYE)
const LABEL_RANGE = 600; // m: names further off are hidden
const HIDE_NEAR_OURS = 5; // m: a boat (nearly) on top of ours is not drawn (everyone starts at the same berth)
const CSS = /* css */`
.np-labels { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
.np-label { position: absolute; left: 0; top: 0; transform: translate(-50%, -100%); padding: 2px 8px; border-radius: 999px; white-space: nowrap;
	font: 600 12px var(--tw-font, system-ui); color: #fff; background: rgba(8, 18, 26, 0.55); text-shadow: 0 1px 2px rgba(0,0,0,0.6); will-change: transform; }
.np-label i { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; vertical-align: 0; box-shadow: 0 0 0 1px rgba(255,255,255,0.8); }
`;

const _v = new Vector3(), _q = new Quaternion(), _qy = new Quaternion(), _up = new Vector3( 0, 1, 0 ), _z = new Vector3( 0, 0, 1 );
const hex = ( c ) => parseInt( String( c || '#5d7a8c' ).slice( 1 ), 16 ) || 0x5d7a8c;

export class RemotePlayers {

	constructor( { net, scene, camera, boat, query = null, sceneRenderer = null, figureMaterial, labelRoot = null } ) {

		this.net = net;
		this.scene = scene;
		this.camera = camera;
		this.boat = boat; // our BoatModel: the template, and where our own boat is
		this.query = query;
		this.sceneRenderer = sceneRenderer;
		this.figureMaterial = figureMaterial;
		this.slot = query ? query.allocate( 'remoteBoats', SLOTS ) : - 1;
		this.slotsUsed = new Array( SLOTS ).fill( null );
		this.views = new Map(); // peer id -> view
		this._hull = null;
		if ( labelRoot && typeof document !== 'undefined' ) {

			const style = document.createElement( 'style' );
			style.textContent = CSS;
			document.head.append( style );
			this.labels = document.createElement( 'div' );
			this.labels.className = 'np-labels';
			labelRoot.prepend( this.labels );

		} else this.labels = null;

		net.on( 'join', ( p ) => this._add( p ) );
		net.on( 'leave', ( p ) => this._remove( p.id ) );

	}

	// a copy of our boat's hull, house and gear (only the boat's own parts, not what the game hung on it)
	_cloneBoat() {

		const g = new Group();
		g.name = 'RemoteBoat';
		for ( const c of this.boat.group.children ) if ( c.name.startsWith( 'boat-' ) ) g.add( c.clone( true ) );
		g.position.set( 0, - 1000, 0 );
		return g;

	}

	_add( peer ) {

		if ( this.views.has( peer.id ) ) return;
		const boat = this._cloneBoat();
		let radar = null;
		boat.traverse( ( o ) => { if ( o.name === 'boat-radar' ) radar = o; } );
		const figure = new Mesh( buildFigure( { shirt: hex( peer.color ), hat: 0xd9cfb0 } ), this.figureMaterial );
		figure.name = 'remote-player';
		figure.castShadow = true;
		figure.receiveShadow = true;
		figure.position.set( 0, - 1000, 0 );
		this.scene.add( boat, figure );
		let mask = null;
		if ( this.sceneRenderer ) {

			this._hull ||= this.boat.createHullVolumeGeometry();
			mask = this.sceneRenderer.addHullMask( this._hull, boat );

		}

		const slot = this.slotsUsed.indexOf( null );
		if ( slot >= 0 ) this.slotsUsed[ slot ] = peer.id;
		let label = null;
		if ( this.labels ) {

			label = document.createElement( 'div' );
			label.className = 'np-label';
			const dot = document.createElement( 'i' );
			dot.style.background = peer.color;
			label.append( dot, document.createTextNode( peer.name ) );
			label.style.display = 'none';
			this.labels.append( label );

		}

		this.views.set( peer.id, { peer, boat, figure, radar, mask, slot, label, water: null, s: {}, t: Math.random() * 10, shown: false } );

	}

	_remove( id ) {

		const v = this.views.get( id );
		if ( ! v ) return;
		this.scene.remove( v.boat, v.figure );
		if ( v.mask && this.sceneRenderer ) this.sceneRenderer.removeHullMask( v.mask );
		if ( v.slot >= 0 ) this.slotsUsed[ v.slot ] = null;
		if ( v.label ) v.label.remove();
		v.figure.geometry.dispose && v.figure.geometry.dispose();
		this.views.delete( id );

	}

	clear() {

		for ( const id of [ ...this.views.keys() ] ) this._remove( id );

	}

	// where each player is drawn (for the minimap): [ { id, name, color, x, z } ]
	positions() {

		const out = [];
		for ( const v of this.views.values() ) if ( v.shown ) out.push( { id: v.peer.id, name: v.peer.name, color: v.peer.color, x: v.figure.position.x, z: v.figure.position.z } );
		return out;

	}

	update( dt ) {

		const q = this.query, ours = this.boat.group.position;
		for ( const v of this.views.values() ) {

			v.t += dt;
			const s = this.net.sample( v.peer, v.s );
			v.shown = !! s;
			if ( ! s ) {

				v.boat.visible = v.figure.visible = false;
				if ( v.label ) v.label.style.display = 'none';
				continue;

			}

			// ---- their boat, on our water
			const B = v.boat;
			if ( s.b ) {

				let y = s.b[ 1 ];
				if ( v.slot >= 0 && q ) {

					q.setPoint( this.slot + v.slot, s.b[ 0 ], s.b[ 2 ] );
					const h = q.cpuValid ? q.get( this.slot + v.slot, _hq ).height : NaN;
					if ( Number.isFinite( h ) ) v.water = v.water === null ? h : v.water + ( h - v.water ) * ( 1 - Math.exp( - dt * 12 ) );
					if ( v.water !== null ) y = v.water + ( s.bh ?? 0 );

				}

				B.position.set( s.b[ 0 ], y, s.b[ 2 ] );
				B.quaternion.set( s.b[ 3 ], s.b[ 4 ], s.b[ 5 ], s.b[ 6 ] );
				B.visible = Math.hypot( s.b[ 0 ] - ours.x, s.b[ 2 ] - ours.z ) > HIDE_NEAR_OURS;
				if ( v.radar ) v.radar.rotation.y = ( v.t * 2.4 ) % ( Math.PI * 2 );

			} else B.visible = false;

			// ---- the figure
			const F = v.figure;
			F.visible = true;
			if ( ( s.m === 'boat' || s.m === 'deck' ) && s.l && s.b ) {

				// on their deck: in the boat's frame, turned to where they look and rolling with the hull
				_v.set( s.l[ 0 ], s.l[ 1 ], s.l[ 2 ] ).applyQuaternion( B.quaternion ).add( B.position );
				F.position.copy( _v );
				_v.copy( _z ).applyQuaternion( B.quaternion );
				const boatYaw = Math.atan2( _v.x, _v.z );
				_qy.setFromAxisAngle( _up, s.yaw - boatYaw );
				F.quaternion.copy( B.quaternion ).multiply( _qy );

			} else {

				F.position.set( s.p[ 0 ], s.p[ 1 ], s.p[ 2 ] );
				if ( s.m === 'swim' ) F.position.y += SWIM_EYE - EYE + Math.sin( v.t * 1.3 ) * 0.04;
				F.quaternion.setFromAxisAngle( _up, s.yaw );

			}

			// ---- the name over their head
			if ( v.label ) this._label( v.label, _v.set( 0, EYE + 0.45, 0 ).applyQuaternion( F.quaternion ).add( F.position ) );

		}

		// slots of boats that left: free for the next one
		if ( q ) for ( let i = 0; i < SLOTS; i ++ ) if ( this.slotsUsed[ i ] === null ) q.setPoint( this.slot + i, 0, 0 );

	}

	_label( el, p ) {

		const cam = this.camera;
		const d = p.distanceTo( cam.position );
		_v.copy( p ).applyMatrix4( cam.matrixWorldInverse );
		if ( _v.z > - 0.2 || d > LABEL_RANGE ) {

			if ( el.style.display !== 'none' ) el.style.display = 'none';
			return;

		}

		_v.applyMatrix4( cam.projectionMatrix );
		const W = this.labels.clientWidth || window.innerWidth, H = this.labels.clientHeight || window.innerHeight;
		const x = ( _v.x * 0.5 + 0.5 ) * W, y = ( 0.5 - _v.y * 0.5 ) * H;
		if ( el.style.display === 'none' ) el.style.display = '';
		el.style.transform = `translate(${ x.toFixed( 1 ) }px, ${ y.toFixed( 1 ) }px) translate(-50%, -100%)`;
		el.style.opacity = d > LABEL_RANGE * 0.6 ? String( Math.max( 0, ( LABEL_RANGE - d ) / ( LABEL_RANGE * 0.4 ) ).toFixed( 2 ) ) : '1';

	}

}

const _hq = {};
