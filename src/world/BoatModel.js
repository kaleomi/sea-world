import { Group, MathUtils, Mesh, Object3D, Quaternion, Vector3 } from '../engine/index.js';
import { G } from '../engine/render/Frame.js';
import { HullLines, RHO_SEAWATER } from './boat/HullLines.js';
import { GeoKit, triangleCount } from './boat/GeoKit.js';
import { BoatMaterials } from './boat/BoatMaterials.js';
import { buildHull, buildHullVolume, keelVolume, houseHalfWidth, KEEL } from './boat/HullBuilder.js';
import { buildWheelhouse, buildHelmConsole, wheelGeometry, throttleGeometry, radarArrayGeometry, HOUSE, roofTopY } from './boat/Wheelhouse.js';
import { buildDeckGear, TRAPS, TRAP, HAULER } from './boat/DeckGear.js';
import { propellerGeometry, rudderGeometry, PROP, RUDDER } from './boat/Running.js';
import { buildBulkhead, buildSloop, buildRunabout, buildTrawl, tillerGeometry, boomGeometry, mainsailGeometry, jibGeometry, outboardGeometry, SLOOP, JIB, OUTBOARDS } from './boat/Rigs.js';

const STATIC_BUCKETS = [ 'hull', 'gelcoat', 'wood', 'fittings', 'trap', 'glow', 'glass' ];
const WHEEL_TURNS = 0.75; // wheel turns from centre to hard over
const THROTTLE_ANGLE = 0.6; // lever travel (rad) from neutral to full
const RADAR_RPM = 24;
const PROP_DISPLAY_RPS = 5;

const _v = new Vector3();
const _pos = new Vector3();
const _scale = new Vector3();
const _q = new Quaternion();

function transverseInertia( lines ) {

	let I = 0;
	const n = 800, z0 = lines.wlStart, dz = ( lines.wlEnd - lines.wlStart ) / n;
	for ( let i = 0; i < n; i ++ ) I += ( 2 / 3 ) * Math.pow( lines.halfBeamAt( z0 + ( i + 0.5 ) * dz ), 3 ) * dz;
	return I;

}

// What each boat type looks like on the shared hull (game/Boats.js has how they go): house 'wheelhouse'
// | 'console' (open, dash and windscreen) | 'none'; the sailboat's rig, the speedboat's outboards, the
// trawler's gear, which deck gear stays aboard and the hull paint ({ bottom, boot, top, cove }).
export const BOAT_LOOKS = {
	sloop: { house: 'none', rig: 'sloop', gear: { lobster: false, buoys: false }, paint: { bottom: 0x7a1d15, boot: 0xe9e1c8, top: 0x1f4d3a, cove: 0xc9a24a, scuff: 0.15 } },
	workboat: { house: 'wheelhouse', gear: { lobster: true } },
	speedboat: { house: 'console', outboards: true, inboard: false, gear: { lobster: false, buoys: false }, paint: { bottom: 0xe6e6e2, boot: 0x15171a, top: 0xb3121f, cove: 0xf4f3ef, scuff: 0.1 } },
	trawler: { house: 'wheelhouse', trawl: true, gear: { lobster: false, buoys: true, coils: false }, paint: { bottom: 0x7a1d15, boot: 0xf2efe6, top: 0x1b3a5c, cove: 0xf2c14e, scuff: 0.5 } },
};

// ~8.2 m Downeast lobster boat, built procedurally (37k triangles, 12 draw calls), and the other boat
// types on the same hull (BOAT_LOOKS).
//
// Boat frame: +Z forward, +Y up, +X port. y = 0 is the design waterline,
// z = 0 the middle of the waterline, x = 0 the centerline.
//
// Integration notes:
// - All anchor points (helmEye, boardPoint, exitPoints, propeller, rudder, bowSprayPoints,
//   hullSamples, colliders) are in the boat frame; transform with group.matrixWorld.
// - hullSamples: position.y is the mean hull depth of each sample's waterplane patch, so
//   sum( area * max( 0, waterY - y ) ) * rho * g equals the displaced weight; with
//   mass = hydro.suggestedMass the boat floats on its design waterline. bottomY holds the
//   literal hull bottom under the sample.
// - Put the centre of mass at hydro.centerOfMass (over the centre of buoyancy) for level trim.
// - setSteering( +1 ) turns to port (left): positive yaw rate about +Y.
// - Shaders animate with G.time (radar sweep, antenna sway, ensign) and brighten with G.night.
export class BoatModel {

	// type: a BOAT_LOOKS key (setType() rebuilds the boat in place, in the same group)
	constructor( type = 'workboat' ) {

		const lines = this.lines = new HullLines();
		this.group = new Group();
		this.group.name = 'Boat';
		this.meshes = {};
		this.type = null;

		// ---- dimensions and hydrostatics

		const kv = keelVolume( lines );
		const displaced = lines.canoeVolume + kv;
		let maxBeam = 0;
		for ( let i = 0; i <= 200; i ++ ) maxBeam = Math.max( maxBeam, lines.sheerX( i / 200 ) );
		let minSheer = Infinity;
		for ( let i = 0; i <= 200; i ++ ) minSheer = Math.min( minSheer, lines.sheerY( i / 200 ) );

		this.dimensions = {
			length: lines.length, // hull LOA (stem head to transom), m
			beam: maxBeam * 2, // max beam at the sheer (rubrail adds ~0.08)
			draft: - KEEL.bottom, // keel shoe below the waterline
			freeboard: minSheer, // lowest sheer height (aft)
			freeboardBow: lines.sheerY( 1 ),
			deckHeight: lines.deckY,
			hullDepth: lines.draftAt( lines.centerOfFlotationZ ), // canoe body depth
			waterlineLength: lines.wlEnd - lines.wlStart,
			waterlineBeam: 2 * this._maxHalfBeam(),
			houseRoofHeight: roofTopY( 0 ),
		};

		this.hydro = {
			waterplaneArea: lines.waterplaneArea, // m^2
			canoeVolume: lines.canoeVolume, // m^3, hull below y = 0 (what hullSamples integrate)
			keelVolume: kv, // m^3, keel/skeg appendage
			displacedVolume: displaced, // m^3
			suggestedMass: Math.round( RHO_SEAWATER * lines.canoeVolume ), // kg, floats exactly on the design WL with hullSamples
			massWithKeel: Math.round( RHO_SEAWATER * displaced ),
			centerOfBuoyancy: lines.centerOfBuoyancy.clone(), // put the centre of mass at this z for level trim
			centerOfFlotationZ: lines.centerOfFlotationZ,
			waterlineStart: lines.wlStart,
			waterlineEnd: lines.wlEnd,
			seawaterDensity: RHO_SEAWATER,
		};

		// Suggested rigid-body properties (boat frame). Centre of mass over the centre of
		// buoyancy for level trim, ~0.3 m above the waterline (engine low, wheelhouse high).
		// Inertia from radii of gyration: roll ~0.36 B, pitch/yaw ~0.26 L.
		const mass = this.hydro.suggestedMass;
		const kRoll = 0.36 * this.dimensions.beam, kPitch = 0.26 * lines.length, kYaw = 0.27 * lines.length;
		this.hydro.centerOfMass = new Vector3( 0, 0.3, lines.centerOfBuoyancy.z );
		this.hydro.inertia = new Vector3( mass * kPitch * kPitch, mass * kYaw * kYaw, mass * kRoll * kRoll ); // about x (pitch), y (yaw), z (roll)
		this.hydro.metacentricRadius = transverseInertia( lines ) / lines.canoeVolume; // BM (m)

		// ---- anchor points (boat frame)

		this.boardPoint = new Vector3( 0, lines.deckY, - 1.75 );

		this.exitPoints = [];
		for ( const z of [ - 3.0, - 2.0, - 1.2 ] ) {

			const t = lines.tAtSheerZ( z );
			for ( const s of [ 1, - 1 ] ) this.exitPoints.push( new Vector3( s * ( lines.sheerX( t ) - 0.035 ), lines.sheerY( t ) + 0.05, z ) );

		}

		this.propeller = PROP.position.clone();
		this.rudder = RUDDER.pivot.clone();

		this.bowSprayPoints = [];
		for ( const z of [ 2.0, 2.6, 3.2, 3.8 ] ) {

			const hb = lines.halfBeamAt( z );
			for ( const s of [ 1, - 1 ] ) this.bowSprayPoints.push( new Vector3( s * ( hb + 0.01 ), 0.05, z ) );

		}

		this.hullSamples = lines.buildHullSamples( 8 );

		// ---- state

		this._steer = 0;
		this._throttle = 0;
		this._rpm = 0;
		this._propAngle = 0;
		this._radarAngle = 0;
		this._time = 0;
		this._lastPos = new Vector3();
		this._hasLastPos = false;
		this._vel = new Vector3();
		this._flagDir = new Vector3( 0, 0, - 1 );
		this._flagWind = 0.5;
		this._sailSide = 1; // the side the boom is out on (+1 port)
		this._boom = 0.2; // boom angle off the centreline
		this._sailFill = 0; // 0 sails down / flogging .. 1 drawing
		this.sailing = null; // set by the controller each frame: { side, angle, fill } (sailboat only)

		this.setType( type );

	}

	// Rebuild as another boat type (BOAT_LOOKS), in place: the same group, hull lines and hydrostatics;
	// new meshes, materials, helm, colliders, light and perch points.
	setType( type ) {

		if ( ! BOAT_LOOKS[ type ] ) type = 'workboat';
		if ( type === this.type ) return false;
		this._clear();
		this.type = type;
		this.look = BOAT_LOOKS[ type ];
		this._build( this.look );
		this.setSteering( this._steer || 0 );
		this.setThrottle( this._throttle || 0 );
		return true;

	}

	_clear() {

		if ( ! this.materials ) return;
		for ( const c of [ ...this.group.children ] ) if ( c.name.startsWith( 'boat-' ) ) this.group.remove( c );
		for ( const m of Object.values( this.meshes ) ) m.geometry.dispose();
		this.materials.dispose();
		this.meshes = {};
		this.wheelMesh = this.throttleMesh = this.radarMesh = this.propMesh = this.rudderMesh = this.tillerMesh = null;
		this.boomPivot = this.jibPivot = this.outboards = null;

	}

	_build( look ) {

		const lines = this.lines;
		const materials = this.materials = new BoatMaterials( lines, look.paint );
		const kit = new GeoKit();
		const parts = {};

		buildHull( kit, lines );
		if ( look.house === 'wheelhouse' ) buildWheelhouse( kit, lines, parts );
		else {

			buildBulkhead( kit, lines );
			if ( look.house === 'console' ) buildHelmConsole( kit, lines, parts );

		}

		if ( look.rig === 'sloop' ) buildSloop( kit, lines );
		if ( look.house === 'console' ) buildRunabout( kit, lines );
		if ( look.trawl ) buildTrawl( kit, lines );
		buildDeckGear( kit, lines, parts, look.gear );

		for ( const name of STATIC_BUCKETS ) {

			const geo = kit.merged( name );
			if ( ! geo ) continue;
			const mesh = new Mesh( geo, materials[ name ] );
			mesh.name = 'boat-' + name;
			mesh.castShadow = name !== 'glass';
			mesh.receiveShadow = true;
			if ( name === 'glass' ) mesh.renderOrder = 1;
			this.group.add( mesh );
			this.meshes[ name ] = mesh;

		}

		// ---- animated parts (one draw call each)

		const addPart = ( name, geo, mat, position, parent = this.group ) => {

			const mesh = new Mesh( geo, mat );
			mesh.name = 'boat-' + name;
			mesh.castShadow = true;
			mesh.receiveShadow = true;
			mesh.position.copy( position );
			parent.add( mesh );
			this.meshes[ name ] = mesh;
			return mesh;

		};

		const pivot = ( name, position ) => {

			const o = new Object3D();
			o.name = 'boat-' + name;
			o.position.copy( position );
			this.group.add( o );
			return o;

		};

		// helm wheel: pivot aligned with the shaft, wheel spins about its local Z
		if ( parts.wheelCenter ) {

			this.wheelPivot = pivot( 'wheel-pivot', parts.wheelCenter );
			this.wheelPivot.quaternion.setFromUnitVectors( new Vector3( 0, 0, 1 ), parts.wheelAxis );
			this.wheelMesh = addPart( 'wheel', wheelGeometry(), materials.wood, new Vector3(), this.wheelPivot );

		}

		if ( parts.throttlePivot ) this.throttleMesh = addPart( 'throttle', throttleGeometry(), materials.fittings, parts.throttlePivot );
		if ( parts.radarPivot ) this.radarMesh = addPart( 'radar', radarArrayGeometry(), materials.fittings, parts.radarPivot );
		if ( look.inboard !== false ) {

			this.propMesh = addPart( 'propeller', propellerGeometry(), materials.fittings, PROP.position );
			this.rudderMesh = addPart( 'rudder', rudderGeometry(), materials.fittings, RUDDER.pivot );

		}

		if ( look.rig === 'sloop' ) {

			this.tillerMesh = addPart( 'tiller', tillerGeometry( lines, RUDDER.pivot ), materials.wood, new Vector3(), this.rudderMesh );
			// boom and mainsail swing about the gooseneck; the jib about the forestay
			this.boomPivot = pivot( 'boom-pivot', new Vector3( 0, SLOOP.gooseneckY, SLOOP.mastZ - 0.1 ) );
			addPart( 'boom', boomGeometry(), materials.fittings, new Vector3( 0, 0, 0 ), this.boomPivot );
			this.mainsails = [ 1, - 1 ].map( ( s ) => addPart( s > 0 ? 'mainsail-port' : 'mainsail-stbd', mainsailGeometry( s ), materials.sail, new Vector3( 0, 0, 0 ), this.boomPivot ) );
			this.jibPivot = pivot( 'jib-pivot', JIB.tack );
			this.jibs = [ 1, - 1 ].map( ( s ) => addPart( s > 0 ? 'jib-port' : 'jib-stbd', jibGeometry( s ), materials.sail, new Vector3(), this.jibPivot ) );
			this._setSails( 1, 0.2, 0 );

		}

		if ( look.outboards ) {

			this.outboards = [];
			const geo = outboardGeometry();
			for ( const s of [ 1, - 1 ] ) {

				const p = pivot( s > 0 ? 'outboard-port' : 'outboard-stbd', new Vector3( s * OUTBOARDS.x, OUTBOARDS.y, OUTBOARDS.z ) );
				addPart( s > 0 ? 'outboard-p' : 'outboard-s', s > 0 ? geo : geo.clone(), materials.fittings, new Vector3(), p );
				this.outboards.push( p );

			}

		}

		materials.flagPivot.value.copy( parts.flagPivot );

		// ---- the helm and the other type-dependent anchor points (boat frame)
		const L = lines;
		if ( look.rig === 'sloop' ) {

			this.helmSeat = { x: SLOOP.helm.x, z: SLOOP.helm.z };
			this.helmEye = new Vector3( SLOOP.helm.x, SLOOP.benchY + 0.78, SLOOP.helm.z );
			this.helmStand = new Vector3( SLOOP.helm.x + 0.55, L.deckY, SLOOP.helm.z + 0.2 );

		} else {

			this.helmSeat = { x: HOUSE.helmX, z: HOUSE.seatZ };
			this.helmEye = new Vector3( HOUSE.helmX, 1.85, 0.3 );
			this.helmStand = new Vector3( HOUSE.helmX + 0.45, L.deckY, HOUSE.seatZ - 0.1 );

		}

		const tBow = L.tAtSheerZ( 3.6 ), yBow = L.sheerY( tBow ) + 0.06, xBow = L.sheerX( tBow ) - 0.05;
		const stern = [ 0, L.sheerY( 0 ) + 0.1, L.zAft - 0.05 ];
		if ( look.house === 'wheelhouse' ) {

			this.lightPoints = { dome: [ 0, 2.24, 0.42 ], instruments: [ - 0.45, 1.5, 1.12 ], port: [ 0.47, 3.45, - 0.47 ], starboard: [ - 0.47, 3.45, - 0.47 ], masthead: [ 0, 3.97, - 0.5 ], stern };
			this.floodPoints = [ [ - 0.8, 2.25, - 1.0 ], [ 0.8, 2.25, - 1.0 ] ];
			this.perch = new Vector3( - 0.5, this.dimensions.houseRoofHeight, 0.15 );

		} else if ( look.rig === 'sloop' ) {

			this.lightPoints = { dome: null, instruments: null, port: [ xBow, yBow + 0.55, 3.75 ], starboard: [ - xBow, yBow + 0.55, 3.75 ], masthead: [ 0, SLOOP.mastTop + 0.1, SLOOP.mastZ ], stern };
			this.floodPoints = [ [ - 0.25, SLOOP.spreaderY - 0.15, SLOOP.mastZ - 0.12 ], [ 0.25, SLOOP.spreaderY - 0.15, SLOOP.mastZ - 0.12 ] ];
			this.perch = new Vector3( 0, L.sheerY( L.tAtSheerZ( 4.1 ) ) + 0.6, 4.05 );

		} else {

			const ya = L.sheerY( L.tAtSheerZ( - 2.85 ) ) + 1.37;
			this.lightPoints = { dome: null, instruments: [ - 0.45, 1.5, 1.12 ], port: [ xBow, yBow, 3.6 ], starboard: [ - xBow, yBow, 3.6 ], masthead: [ 0, ya + 0.05, - 3.05 ], stern };
			this.floodPoints = [ [ - 0.5, ya - 0.1, - 3.0 ], [ 0.5, ya - 0.1, - 3.0 ] ];
			this.perch = new Vector3( 0, ya + 0.04, - 3.05 );

		}

		this.colliders = this._buildColliders( look );

	}

	// the sails' set: side +1 = boom out to port; boom radians off the centreline; fill 0 (luffing,
	// shaking) .. 1 (drawing)
	_setSails( side, boom, fill ) {

		const s = side >= 0 ? 1 : - 1;
		this.boomPivot.rotation.y = - s * boom;
		this.mainsails[ 0 ].visible = s > 0;
		this.mainsails[ 1 ].visible = s < 0;
		this.mainsails[ 0 ].scale.x = this.mainsails[ 1 ].scale.x = 0.15 + 0.85 * fill;
		_q.setFromAxisAngle( JIB.axis, s * Math.min( boom * 0.75, 0.75 ) );
		this.jibPivot.quaternion.copy( _q );
		this.jibs[ 0 ].visible = s > 0;
		this.jibs[ 1 ].visible = s < 0;
		this.jibs[ 0 ].scale.x = this.jibs[ 1 ].scale.x = 0.15 + 0.85 * fill;

	}

	// Closed, low-poly hull volume (shell + transom + lid at the sheer) in the boat frame.
	// Not added to the group: useful as a water-exclusion mask (e.g. depth/stencil pre-pass
	// so the ocean surface is not drawn inside the cockpit), occlusion or physics proxies.
	createHullVolumeGeometry() {

		return buildHullVolume( this.lines );

	}

	_maxHalfBeam() {

		let m = 0;
		for ( let z = this.lines.wlStart; z <= this.lines.wlEnd; z += 0.02 ) m = Math.max( m, this.lines.halfBeamAt( z ) );
		return m;

	}

	// Waterplane half-beam at longitudinal position z (0 outside the waterline length).
	halfBeamAt( z ) {

		return this.lines.halfBeamAt( z );

	}

	// Canoe-body depth below the design waterline at z (0 outside); the keel adds up to ~0.3 m more.
	draftAt( z ) {

		return this.lines.draftAt( z );

	}

	// -1..1, positive turns the boat to port (left): rudder trailing edge to port,
	// wheel turned counter-clockwise as seen from the helm.
	setSteering( angle ) {

		const a = MathUtils.clamp( angle, - 1, 1 );
		this._steer = a;
		if ( this.wheelMesh ) this.wheelMesh.rotation.z = - a * WHEEL_TURNS * Math.PI * 2;
		if ( this.rudderMesh ) this.rudderMesh.rotation.y = - a * RUDDER.maxAngle;
		if ( this.outboards ) for ( const o of this.outboards ) o.rotation.y = - a * 0.45;

	}

	// -1 (full astern) .. 0 (neutral) .. 1 (full ahead); lever tips forward for ahead.
	setThrottle( t ) {

		this._throttle = MathUtils.clamp( t, - 1, 1 );
		if ( this.throttleMesh ) this.throttleMesh.rotation.x = this._throttle * THROTTLE_ANGLE;

	}

	// Shaft RPM; positive = ahead (right-handed prop, clockwise from astern).
	setPropellerRPM( rpm ) {

		this._rpm = rpm;

	}

	setNavLights( on ) {

		this.materials.setNavLights( on );

	}

	update( dt ) {

		if ( ! ( dt > 0 ) ) return;
		this._time += dt;

		// propeller: displayed speed saturates (~5 rev/s) so the blades don't strobe backwards
		const rps = this._rpm / 60;
		const shown = PROP_DISPLAY_RPS * Math.tanh( rps / PROP_DISPLAY_RPS );
		this._propAngle = ( this._propAngle + shown * Math.PI * 2 * dt ) % ( Math.PI * 2 );
		if ( this.propMesh ) this.propMesh.rotation.z = this._propAngle;

		this._radarAngle = ( this._radarAngle + RADAR_RPM / 60 * Math.PI * 2 * dt ) % ( Math.PI * 2 );
		if ( this.radarMesh ) this.radarMesh.rotation.y = this._radarAngle;

		// sails: the boom eases toward where the controller wants it (the boat's point of sail), gybing
		// across when the wind comes over the other side; sails flutter when they don't draw
		if ( this.boomPivot ) {

			const s = this.sailing;
			const side = s ? s.side : this._sailSide, target = s ? s.angle : 0.12, fill = s ? s.fill : 0;
			if ( side !== this._sailSide ) {

				// the boom swings through the centreline first
				this._boom -= dt * 1.6;
				if ( this._boom <= 0.04 ) this._sailSide = side;

			} else this._boom += ( target - this._boom ) * ( 1 - Math.exp( - dt * 1.5 ) );

			this._sailFill += ( fill - this._sailFill ) * ( 1 - Math.exp( - dt * 2 ) );
			const flog = ( 1 - this._sailFill ) * 0.06 * Math.sin( this._time * 11 ) * ( s ? 1 : 0.3 );
			this._setSails( this._sailSide, Math.max( 0.02, this._boom + flog ), this._sailFill );

		}

		// apparent wind (true wind minus boat velocity) in the boat frame drives the ensign
		this.group.updateWorldMatrix( true, false );
		this.group.matrixWorld.decompose( _pos, _q, _scale );
		if ( this._hasLastPos ) {

			_v.subVectors( _pos, this._lastPos ).divideScalar( dt );
			if ( _v.lengthSq() < 900 ) this._vel.lerp( _v, 1 - Math.exp( - dt * 4 ) ); // ignore teleports

		}

		this._lastPos.copy( _pos );
		this._hasLastPos = true;

		const wd = G.windDir.value, ws = G.windSpeed.value;
		_v.set( wd.x * ws, 0, wd.y * ws ).sub( this._vel ).applyQuaternion( _q.invert() );
		_v.y = 0;
		const speed = _v.length();
		if ( speed > 1e-3 ) {

			_v.divideScalar( speed );
			this._flagDir.lerp( _v, 1 - Math.exp( - dt * 3 ) );
			if ( this._flagDir.lengthSq() < 1e-4 ) this._flagDir.copy( _v );
			this._flagDir.normalize();

		}

		this._flagWind += ( MathUtils.clamp( speed / 9, 0, 1 ) - this._flagWind ) * ( 1 - Math.exp( - dt * 2 ) );
		this.materials.flagDir.value.copy( this._flagDir );
		this.materials.flagWind.value = this._flagWind;

	}

	dispose() {

		for ( const m of Object.values( this.meshes ) ) m.geometry.dispose();
		this.materials.dispose();

	}

	get triangleCount() {

		let n = 0;
		for ( const m of Object.values( this.meshes ) ) n += triangleCount( m.geometry );
		return n;

	}

	// Rough boat-frame colliders (axis-aligned in the boat frame) for a character controller.
	_buildColliders( look = BOAT_LOOKS.workboat ) {

		const L = this.lines;
		const house = look.house === 'wheelhouse', dash = look.house !== 'none';
		const boxes = [];
		const add = ( tag, min, max, walkable = false, solid = true ) => {

			const center = new Vector3().addVectors( min, max ).multiplyScalar( 0.5 );
			const half = new Vector3().subVectors( max, min ).multiplyScalar( 0.5 );
			boxes.push( { tag, center, half, walkable, solid } );

		};

		const V = ( x, y, z ) => new Vector3( x, y, z );
		const inner = ( z ) => L.halfBreadth( L.tAtSheerZ( z ), L.deckY ) - L.shell;
		add( 'deck', V( - inner( - 1.5 ), L.deckY - 0.1, L.zAft + L.shell ), V( inner( - 1.5 ), L.deckY, dash ? HOUSE.dash.zFace : L.houseFront ), true, false );
		// bulwarks in three segments following the sheer
		for ( const [ z0, z1 ] of [ [ L.zAft, - 2.3 ], [ - 2.3, - 0.7 ], [ - 0.7, L.houseFront ] ] ) {

			const t0 = L.tAtSheerZ( z0 ), t1 = L.tAtSheerZ( z1 );
			const top = Math.max( L.sheerY( t0 ), L.sheerY( t1 ) ) + 0.045;
			const xo = Math.max( L.sheerX( t0 ), L.sheerX( t1 ) );
			const xi = Math.min( inner( z0 ), inner( z1 ) );
			for ( const s of [ 1, - 1 ] ) add( 'bulwark', V( Math.min( s * xi, s * xo ), L.deckY, z0 ), V( Math.max( s * xi, s * xo ), top, z1 ) );

		}

		add( 'transom', V( - L.sheerX( 0 ), L.deckY, L.zAft ), V( L.sheerX( 0 ), L.sheerY( 0 ) + 0.045, L.zAft + L.shell ) );
		if ( house ) for ( const s of [ 1, - 1 ] ) {

			const x0 = houseHalfWidth( L, L.houseBack ) - HOUSE.wallT, x1 = houseHalfWidth( L, L.houseBack );
			add( 'houseWall', V( Math.min( s * x0, s * x1 ), L.sheerY( L.tAtSheerZ( L.houseBack ) ), L.houseBack ), V( Math.max( s * x0, s * x1 ), HOUSE.roofUnderY, L.houseFront ) );

		}

		if ( dash ) {

			const d = HOUSE.dash;
			add( 'console', V( - d.halfW, L.deckY, d.zFace ), V( d.halfW, d.yTop, L.houseFront ) );
			add( 'helmSeat', V( HOUSE.helmX - 0.23, L.deckY, HOUSE.seatZ - 0.24 ), V( HOUSE.helmX + 0.23, 1.05, HOUSE.seatZ + 0.21 ) );
			add( 'bench', V( 0.65, L.deckY, 0.075 ), V( 1.07, L.deckY + 0.47, 0.825 ), true );

		}

		if ( house ) add( 'roof', V( - 1.25, HOUSE.roofUnderY, HOUSE.roofZ0 ), V( 1.25, roofTopY( 0 ), HOUSE.roofZ1 ), true );
		if ( look.gear && look.gear.lobster ) {

			for ( const [ x, level, z ] of TRAPS ) {

				const y0 = L.deckY + 0.03 + level * ( TRAP.H + 0.035 );
				add( 'trap', V( x - TRAP.W / 2, y0, z - TRAP.L / 2 ), V( x + TRAP.W / 2, y0 + TRAP.H, z + TRAP.L / 2 ), true );

			}

			add( 'hauler', V( HAULER.x - 0.2, L.deckY, HAULER.z - 0.08 ), V( HAULER.x + 0.2, HAULER.y + 0.2, HAULER.z + 0.25 ) );
			add( 'baitBarrel', V( 0.6, L.deckY, - 1.06 ), V( 1.12, L.deckY + 0.8, - 0.54 ) );

		}

		if ( look.rig === 'sloop' ) {

			// cockpit benches (walkable), the mast
			const [ z0, z1 ] = SLOOP.benchZ;
			const xo = inner( ( z0 + z1 ) / 2 );
			for ( const s of [ 1, - 1 ] ) add( 'bench', V( Math.min( s * xo, s * ( xo - 0.42 ) ), L.deckY, z0 ), V( Math.max( s * xo, s * ( xo - 0.42 ) ), SLOOP.benchY + 0.02, z1 ), true );
			add( 'mast', V( - 0.08, L.deckY, SLOOP.mastZ - 0.08 ), V( 0.08, SLOOP.mastTop, SLOOP.mastZ + 0.08 ) );

		}

		if ( look.house === 'console' ) add( 'sternBench', V( - 1.2, L.deckY, L.zAft + L.shell ), V( 1.2, L.deckY + 0.5, L.zAft + L.shell + 0.75 ), true );
		if ( look.trawl ) add( 'netDrum', V( - 0.85, L.deckY, - 2.9 ), V( 0.85, L.deckY + 1.25, - 1.7 ) );
		// foredeck steps (walkable) from the house front to the stem head
		for ( const [ z0, z1 ] of [ [ L.houseFront, 2.4 ], [ 2.4, 3.3 ], [ 3.3, 4.15 ] ] ) {

			const t0 = L.tAtSheerZ( z0 ), t1 = L.tAtSheerZ( z1 );
			const w = L.sheerX( t0 ) - L.shell;
			add( 'foredeck', V( - w, L.deckY, z0 ), V( w, ( L.sheerY( t0 ) + L.sheerY( t1 ) ) / 2 + 0.06, z1 ), true );

		}

		return boxes;

	}

}
