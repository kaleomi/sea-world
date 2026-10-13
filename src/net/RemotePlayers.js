import { Group, Mesh, Matrix4, Quaternion, Vector3 } from '../engine/index.js';
import { buildFigure } from '../game/Vendor.js';

// The other players on the shared sea (net/NetClient.js): each one's boat and figure, and a name over
// their head. Their boat is a copy of ours (same geometry and materials, so no new pipelines), set on
// OUR waves: the sender says how high their hull rides above the water under it (bh) and we add that to
// our own water height there, read back from the GPU like our boat's (WaterQuery). The figure is the
// avatar they picked (a Rocketbox character, loadAvatar( av ) -> SkinnedModel) once it has loaded, the
// traders' stand-in in their colour until then; aboard it stands where they are on their deck and rolls
// with the hull. It stands, walks, holds a rod (rod state r) and cheers when they land a fish. Their rod
// is a copy of ours (rodKit) in the left hand, with the line out to where they cast (k) and the bobber;
// a fish they land hangs on the line for a moment (catchDisplay). Chat lines show over their name.
//   const rp = new RemotePlayers( { net, scene, camera, boat, query, sceneRenderer, figureMaterial, labelRoot, loadAvatar, rodKit, catchDisplay } );
//   rp.update( dt ) each frame, before query.update();  rp.say( id, text );  rp.landed( id, species, kg )
const SLOTS = 8; // remote boats whose water height is read back (the rest keep the sender's height)
const EYE = 1.58; // the figure's eye height (m above its feet)
const SWIM_EYE = 0.16; // a swimmer's eyes above the float point the sender gives (Player.SWIM_EYE)
const LABEL_RANGE = 600; // m: names further off are hidden
const HIDE_NEAR_OURS = 5; // m: a boat (nearly) on top of ours is not drawn (everyone starts at the same berth)
const ANIM_RANGE = 160; // m: avatars further off hold their pose
const ROD_RANGE = 250; // m: rods further off aren't drawn
const SAY_MS = 7000; // a chat line stays over their head this long
const LAND_S = 3.2; // s a landed fish hangs on their line
const HAND = 'Bip01 L Hand'; // the rod hand (the 'umbrella' hold raises the left forearm)
const SEAT = 0.4; // m from the rod's butt to where the hand holds it
const ROD_L = 2.13;
// the rod's elevation above level for each rod state (rad), and how far it bends
const ELEV = [ 0, 0.75, 1.95, 0.35, 0.55, 1.05, 1.2 ];
const BEND = [ 0, 0.01, 0.02, 0.0, 0.03, 0.2, 0.12 ];
const CLIP = { idle: 'idle_neutral_01', hold: 'umbrella_idle_01', walk: 'walk_neutral_01', cheer: 'cheer_01' };
const CSS = /* css */`
.np-labels { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
.np-label { position: absolute; left: 0; top: 0; transform: translate(-50%, -100%); padding: 2px 8px; border-radius: 999px; white-space: nowrap;
	font: 600 12px var(--tw-font, system-ui); color: #fff; background: rgba(8, 18, 26, 0.55); text-shadow: 0 1px 2px rgba(0,0,0,0.6); will-change: transform; }
.np-label .np-say { position: absolute; left: 50%; bottom: calc(100% + 6px); transform: translateX(-50%); max-width: 260px; width: max-content; padding: 6px 10px;
	border-radius: 12px; font-weight: 500; white-space: normal; text-align: center; color: #0b1418; background: rgba(255,255,255,0.92); text-shadow: none;
	box-shadow: 0 2px 8px rgba(0,0,0,0.35); }
.np-label .np-say:empty { display: none; }
.np-label i { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; vertical-align: 0; box-shadow: 0 0 0 1px rgba(255,255,255,0.8); }
`;

const _v = new Vector3(), _q = new Quaternion(), _qy = new Quaternion(), _up = new Vector3( 0, 1, 0 ), _z = new Vector3( 0, 0, 1 );
const _hand = new Vector3(), _fw = new Vector3(), _dir = new Vector3(), _rx = new Vector3(), _rz = new Vector3(), _tip = new Vector3(), _end = new Vector3(), _m = new Matrix4();
const hex = ( c ) => parseInt( String( c || '#5d7a8c' ).slice( 1 ), 16 ) || 0x5d7a8c;

export class RemotePlayers {

	constructor( { net, scene, camera, boat, query = null, sceneRenderer = null, figureMaterial, labelRoot = null, loadAvatar = null, rodKit = null, catchDisplay = null } ) {

		this.net = net;
		this.scene = scene;
		this.camera = camera;
		this.boat = boat; // our BoatModel: the template, and where our own boat is
		this.query = query;
		this.sceneRenderer = sceneRenderer;
		this.figureMaterial = figureMaterial;
		this.loadAvatar = loadAvatar; // ( av ) -> Promise<SkinnedModel>
		this.rodKit = rodKit; // { rodGeometry, rodMaterial(), lineGeometry, lineMaterial(), bobberGeometry, bobberMaterial }
		this.catchDisplay = catchDisplay; // () -> CatchDisplay (made on the first fish)
		this._display = null;
		this._shownFish = null; // the view whose fish hangs on its line
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
		// the figure: the stand-in until their avatar has loaded
		const figure = new Group();
		figure.name = 'remote-player';
		const stand = new Mesh( buildFigure( { shirt: hex( peer.color ), hat: 0xd9cfb0 } ), this.figureMaterial );
		stand.castShadow = true;
		stand.receiveShadow = true;
		figure.add( stand );
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
			const say = document.createElement( 'span' );
			say.className = 'np-say';
			label.append( say, dot, document.createTextNode( peer.name ) );
			label.style.display = 'none';
			this.labels.append( label );

		}

		const v = { peer, boat, figure, stand, avatar: null, clip: null, hand: - 1, radar, mask, slot, label, water: null, s: {}, t: Math.random() * 10, shown: false,
			speed: 0, last: null, rod: null, line: null, bobber: null, elev: 0, bend: 0, land: null, sayT: 0 };
		this.views.set( peer.id, v );
		if ( this.loadAvatar ) {

			this.loadAvatar( peer.av ).then( ( model ) => {

				if ( this.views.get( peer.id ) !== v ) return model.dispose();
				v.avatar = model;
				v.hand = model.nodeIndex( HAND );
				figure.remove( stand );
				stand.geometry.dispose && stand.geometry.dispose();
				figure.add( model.group );
				this._play( v, CLIP.idle );

			} ).catch( ( e ) => console.warn( 'RemotePlayers: avatar failed to load', e ) );

		}

	}

	_remove( id ) {

		const v = this.views.get( id );
		if ( ! v ) return;
		this.scene.remove( v.boat, v.figure );
		for ( const o of [ v.rod, v.line, v.bobber ] ) if ( o ) this.scene.remove( o );
		if ( this._shownFish === v ) this._hideFish();
		if ( v.mask && this.sceneRenderer ) this.sceneRenderer.removeHullMask( v.mask );
		if ( v.slot >= 0 ) this.slotsUsed[ v.slot ] = null;
		if ( v.label ) v.label.remove();
		if ( v.avatar ) v.avatar.dispose();
		else v.stand.geometry.dispose && v.stand.geometry.dispose();
		this.views.delete( id );

	}

	clear() {

		for ( const id of [ ...this.views.keys() ] ) this._remove( id );

	}

	// a chat line from player id: over their head for a while
	say( id, text ) {

		const v = this.views.get( id );
		if ( ! v || ! v.label ) return;
		v.label.firstChild.textContent = text;
		v.sayT = performance.now() + SAY_MS;

	}

	// player id landed a fish: it hangs on their line for a moment, and they cheer
	landed( id, species, kg ) {

		const v = this.views.get( id );
		if ( v ) v.land = { species, kg, t: 0 };

	}

	_play( v, name, opts = {} ) {

		if ( ! v.avatar || v.clip === name || ! v.avatar.clips.has( name ) ) return;
		v.clip = name;
		v.avatar.play( name, { fade: 0.35, ...opts } );

	}

	_hideFish() {

		if ( this._display ) this._display.hide();
		this._shownFish = null;

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
				for ( const o of [ v.rod, v.line, v.bobber ] ) if ( o ) o.visible = false;
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

			// how fast they walk (for the walk cycle)
			if ( v.last && dt > 0 ) {

				const sp = Math.hypot( F.position.x - v.last.x, F.position.z - v.last.z ) / dt;
				v.speed += ( Math.min( sp, 12 ) - v.speed ) * ( 1 - Math.exp( - dt * 6 ) );

			}

			( v.last ||= new Vector3() ).copy( F.position );
			this._animate( v, s, dt );
			this._rodAndLine( v, s, dt );

			// ---- the name over their head (and what they last said)
			if ( v.label ) {

				if ( v.sayT && performance.now() > v.sayT ) {

					v.sayT = 0;
					v.label.firstChild.textContent = '';

				}

				this._label( v.label, _v.set( 0, EYE + 0.45, 0 ).applyQuaternion( F.quaternion ).add( F.position ) );

			}

		}

		// slots of boats that left: free for the next one
		if ( q ) for ( let i = 0; i < SLOTS; i ++ ) if ( this.slotsUsed[ i ] === null ) q.setPoint( this.slot + i, 0, 0 );

	}

	// the avatar's clip: cheering a fish they just landed, walking, holding a rod, or standing
	_animate( v, s, dt ) {

		if ( v.land && ( v.land.t += dt ) > LAND_S + 3 ) v.land = null;
		const A = v.avatar;
		if ( ! A ) return;
		const far = v.figure.position.distanceTo( this.camera.position ) > ANIM_RANGE;
		let clip = CLIP.idle, speed = 1;
		if ( v.land && v.land.t > 0.6 && v.land.t < LAND_S + 1.5 ) clip = CLIP.cheer;
		else if ( s.m === 'walk' && v.speed > 0.5 ) {

			clip = CLIP.walk;
			speed = Math.min( 2.2, Math.max( 0.6, v.speed / 1.35 ) );

		} else if ( s.r > 0 ) clip = CLIP.hold;
		this._play( v, clip );
		if ( clip === CLIP.walk ) for ( const l of A.layers ) if ( l.clip.name === CLIP.walk ) l.speed = speed;
		if ( far ) A.hold();
		else A.update( dt );

	}

	// their rod in the hand, the line out to where they cast, the bobber, a landed fish on the line
	_rodAndLine( v, s, dt ) {

		const K = this.rodKit, F = v.figure;
		const show = s.r > 0 && F.position.distanceTo( this.camera.position ) < ROD_RANGE;
		if ( ! K || ( ! show && ! v.rod ) ) return;
		if ( ! v.rod ) {

			v.rod = new Mesh( K.rodGeometry, K.rodMaterial() );
			v.rod.name = 'RemoteRod';
			v.rod.matrixAutoUpdate = false;
			v.rod.frustumCulled = false;
			v.line = new Mesh( K.lineGeometry, K.lineMaterial() );
			v.line.frustumCulled = false;
			v.line.castShadow = false;
			v.bobber = new Mesh( K.bobberGeometry, K.bobberMaterial );
			v.bobber.castShadow = false;
			this.scene.add( v.rod, v.line, v.bobber );

		}

		v.rod.visible = show;
		if ( ! show ) {

			v.line.visible = v.bobber.visible = false;
			if ( this._shownFish === v ) this._hideFish();
			return;

		}

		// the hand: the avatar's left hand, or about where the stand-in's would be
		F.updateWorldMatrix( true, false );
		if ( v.avatar && v.hand >= 0 ) {

			const M = v.avatar.nodeMatrix( v.hand );
			_hand.set( M[ 12 ], M[ 13 ], M[ 14 ] ).applyMatrix4( F.matrixWorld );

		} else _hand.set( 0.22, 1.05, 0.35 ).applyMatrix4( F.matrixWorld );

		// the rod's direction: ahead of them (toward the line when it is out), raised by the state's angle
		_fw.copy( _z ).applyQuaternion( F.quaternion ).setY( 0 ).normalize();
		const r = Math.min( s.r, ELEV.length - 1 );
		const hasEnd = s.k && r >= 3;
		if ( hasEnd ) {

			_end.set( s.k[ 0 ], s.k[ 1 ], s.k[ 2 ] );
			_v.copy( _end ).sub( _hand ).setY( 0 );
			if ( _v.lengthSq() > 0.25 ) _fw.lerp( _v.normalize(), 0.7 ).normalize();

		}

		const ease = 1 - Math.exp( - dt * ( r === 3 ? 18 : 6 ) );
		v.elev += ( ELEV[ r ] - v.elev ) * ease;
		v.bend += ( BEND[ r ] - v.bend ) * ease;
		_dir.copy( _fw ).multiplyScalar( Math.cos( v.elev ) ).addScaledVector( _up, Math.sin( v.elev ) ).normalize();
		// rod frame: +Y along the blank, the reel hanging below (-Z), +X to the side
		_rz.copy( _up ).addScaledVector( _dir, - _up.dot( _dir ) );
		if ( _rz.lengthSq() < 1e-6 ) _rz.copy( _fw ).negate();
		_rz.normalize();
		_rx.crossVectors( _dir, _rz );
		_m.makeBasis( _rx, _dir, _rz ).setPosition( _hand.x - _dir.x * SEAT, _hand.y - _dir.y * SEAT, _hand.z - _dir.z * SEAT );
		v.rod.matrix.copy( _m );
		v.rod.matrixWorld.copy( _m );
		// bend toward the line (in rod space, across the blank)
		const u = v.rod.material.uniforms;
		let bx = 0, bz = 1;
		if ( hasEnd ) {

			_v.copy( _end ).sub( _hand ).normalize();
			bx = _v.dot( _rx );
			bz = _v.dot( _rz );
			const l = Math.hypot( bx, bz ) || 1;
			bx /= l; bz /= l;

		}

		if ( u.rodBend ) u.rodBend.value.set( bx, 0, bz, v.bend );
		_tip.set( _m.elements[ 12 ], _m.elements[ 13 ], _m.elements[ 14 ] ).addScaledVector( _dir, ROD_L - v.bend * v.bend * ROD_L * 0.5 )
			.addScaledVector( _rx, bx * v.bend * ROD_L ).addScaledVector( _rz, bz * v.bend * ROD_L );

		// the line: out to the bobber (or the fish), or a short drop with the landed fish on it
		const landing = v.land && v.land.t < LAND_S;
		if ( landing ) _end.copy( _tip ).y -= 0.9;
		const lineOn = hasEnd || landing;
		v.line.visible = lineOn;
		if ( lineOn ) {

			const L = v.line.material.uniforms;
			L.lineA.value.copy( _tip );
			L.lineB.value.copy( _end );
			const d = _tip.distanceTo( _end ), taut = r === 5 || landing ? 0.9 : 0;
			L.lineCtl.value.copy( _tip ).lerp( _end, 0.5 ).y -= d * 0.07 * ( 1 - taut ) + 0.02;
			L.lineShow.value = 1;

		}

		v.bobber.visible = hasEnd && r >= 3 && r <= 5 && ! landing;
		if ( v.bobber.visible ) {

			v.bobber.position.copy( _end );
			v.bobber.scale.setScalar( Math.max( 1, _end.distanceTo( this.camera.position ) / 7 ) );

		}

		// the landed fish on the end of the line, turned toward us
		if ( landing && this.catchDisplay ) {

			this._display ||= this.catchDisplay();
			if ( this._shownFish && this._shownFish !== v ) this._hideFish();
			this._shownFish = v;
			const c = this.camera.position;
			this._display.show( v.land.species, v.land.kg, _end, Math.atan2( c.x - _end.x, c.z - _end.z ), dt );

		} else if ( this._shownFish === v ) this._hideFish();

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
