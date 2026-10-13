import { Vector3, Color } from '../engine/index.js';
import { WORLD } from '../world/WorldLayout.js';
import { OPEN_SEA } from '../world/islands/index.js';
import { FISH } from './FishTable.js';
import { habitatAt, pickSpecies, rollWeight, biteDelay } from './Bites.js';
import { CatchMinigame } from './CatchMinigame.js';
import { GameState } from './GameState.js';
import { FishingRod } from './FishingRod.js';
import { FishStand } from './FishStand.js';
import { Chandlery } from './Chandlery.js';
import { CatchDisplay } from './CatchDisplay.js';
import { UPGRADES, fuelBurn } from './Gear.js';
import { TIERS } from './Orders.js';
import { milestoneText } from './Collection.js';
import { LEGENDS, rollLegend, legendWeight, legendTitle } from './Legends.js';
import { LEAGUES, DURATION, place } from './Tournament.js';
import { GameHUD } from './GameHUD.js';
import { Minimap } from './Minimap.js';
import { Guide } from './Guide.js';
import { WorldMap } from './WorldMap.js';
import { Vendor } from './Vendor.js';
import { GIVERS, beachSpot, currentQuest, questReady } from './Quests.js';
import { t } from '../i18n/index.js';

// how long the catch card stays up unless dismissed (ms)
const CATCH_CARD_MS = 9000;

// The fishing game on top of the world:
//   R          take out / put away the rod (on foot, on the pier, on the boat's deck)
//   hold LMB   wind up, release to cast (hold longer = farther)
//   LMB        strike when a fish takes the bobber ("!"); then hold LMB to reel, let go to ease off
//   RMB        reel an empty line back in
//   I / Tab    cooler / hold contents and the fish log
//   E          at the fish stand: sell your catch
export class Game {

	constructor( app ) {

		this.app = app;
		this.state = new GameState();
		this.state.load();
		// closing or hiding the tab saves too (fuel between the periodic saves)
		if ( typeof window !== 'undefined' ) window.addEventListener( 'pagehide', () => this.state.save() );
		this.rod = new FishingRod( { scene: app.scene, camera: app.camera, query: app.query, terrain: app.terrainData, audio: app.audio } );
		this.rod.onLand = ( where ) => this.onBobberLanded( where );
		this.stand = new FishStand( { scene: app.scene, terrain: app.terrainData, colliders: app.colliders } );
		this.display = new CatchDisplay( { scene: app.scene, stall: this.stand.iceFish() } );
		this.landing = null; // { species, kg } while the caught fish swings in view
		this.chandlery = new Chandlery( { scene: app.scene, terrain: app.terrainData, colliders: app.colliders, material: this.stand.material } );
		this.vendors = [ this.stand.vendor, this.chandlery.vendor ];
		this.addQuestGivers();
		// cruise control at the helm (Player.updateBoat, C)
		if ( app.player ) app.player.onCruise = ( c ) => this.toast( c ? t( 'Cruise control on · C or S to stop' ) : t( 'Cruise control off' ), 1800 );
		// boat upgrades: engine (thrust / top speed) and deck floodlights for night fishing
		const b = app.boatCtl;
		this._engineBase = { maxThrust: b.maxThrust, pitchSpeed: b.pitchSpeed };
		this.floods = [];
		if ( app.localLights ) this.addFloodlights( app.localLights, app.boat );
		this._fuelOut = false;
		this._sonarT = 0;
		this._sonar = null;
		this.hud = null;
		this.fight = null; // CatchMinigame while a fish is on
		this.bite = null; // { phase: 'wait' | 'nibble' | 'take', t, nibbles, species, kg }
		this._lmb = false;
		this._rmb = false;
		this._hookedSpecies = null;
		this._pier = WORLD.pier;
		this._tmp = new Vector3();
		this.applyGear();
		this.state.onChange( () => this.applyGear() );

	}

	// one quest giver on each outer island (Quests.js), on the beach that faces the home island
	addQuestGivers() {

		this.givers = [];
		const T = this.app.terrainData;
		for ( const o of ( T && T.outer ) || [] ) for ( const g of Object.values( GIVERS ) ) {

			if ( g.island !== o.id ) continue;
			const s = beachSpot( o, 0, 0 );
			if ( ! s ) continue;
			const v = new Vendor( {
				name: g.name, kind: 'quest', position: new Vector3( s.x, T.heightAt( s.x, s.z ), s.z ), yaw: s.yaw, radius: 3.0,
				greeting: g.greeting, material: this.stand.material, look: g.look,
				// a Rocketbox character (tools/characters/), loaded when you come near the island
				character: g.character ? { url: `${ ( import.meta.env && import.meta.env.BASE_URL ) || '/' }models/characters/${ g.character }.glb`, lazy: true, range: 650, idle: 'idle_neutral_01', talk: 'gestic_talk_neutral_01', greet: 'wave_01' } : null,
			} );
			v.giver = g.id;
			if ( this.app.scene ) this.app.scene.add( v.group );
			this.vendors.push( v );
			this.givers.push( v );

		}

	}

	// hand in a quest giver's current job
	completeQuest( id ) {

		const r = this.state.completeQuest( id );
		if ( ! r ) return null;
		const done = t( 'Job done: {title} · ${v}', { title: t( r.quest.title ), v: r.reward } );
		this.toast( r.last ? `${ done } · ${ t( 'Every job on the island is done!' ) }` : done, r.last ? 4500 : 3000 );
		if ( this.app.audio && this.app.audio.coin ) this.app.audio.coin();
		return r;

	}

	// a quest giver's state for the map markers: 'ready' (a job can be handed in), 'open', or 'done'
	questState( id ) {

		const q = currentQuest( id, this.state.quests );
		if ( ! q ) return 'done';
		return questReady( q, this.state.inventory, this.state.legends ) ? 'ready' : 'open';

	}

	applyGear() {

		const g = this.state.stats;
		this.rod.setGear( { castM: g.castM, reelSpeed: g.reelSpeed } );
		const b = this.app.boatCtl;
		if ( b && this._engineBase ) {

			b.maxThrust = this._engineBase.maxThrust * g.speedMul * g.speedMul;
			b.pitchSpeed = this._engineBase.pitchSpeed * g.speedMul;

		}

		for ( const f of this.floods || [] ) f.scale = g.deckLights ? 1 : 0;

	}

	// two floodlights under the back of the wheelhouse roof, lighting the cockpit and the water
	// astern (night only, like every local light; switched by the lights upgrade)
	addFloodlights( lights, boat ) {

		const obj = boat.group;
		for ( const x of [ - 0.8, 0.8 ] ) {

			const local = new Vector3( x, 2.25, - 1.0 );
			const localDir = new Vector3( x * 0.25, - 0.75, - 0.62 ).normalize();
			const src = {
				position: new Vector3(), color: new Color( 1.0, 0.93, 0.8 ), intensity: 3.2, range: 14, kind: 'boatFlood',
				dir: new Vector3(), cosInner: 0.8, cosOuter: 0.45, scale: 0,
				update() {

					obj.updateWorldMatrix( true, false );
					this.position.copy( local ).applyMatrix4( obj.matrixWorld );
					this.dir.copy( localDir ).transformDirection( obj.matrixWorld );

				},
			};
			src.update();
			this.floods.push( src );
			lights.add( src );

		}

	}

	buy( key ) {

		const r = this.state.buy( key );
		if ( r ) this.toast( `${ t( UPGRADES[ key ].name ) }: ${ t( r.label ) }` );
		return r;

	}

	// Joe's orders (Orders.js): hand over the fish for one, or ask for a different one
	fillOrder( id ) {

		const r = this.state.fillOrder( id );
		if ( ! r ) return null;
		const done = t( 'Order filled · ${v} · reputation +{rep}', { v: r.reward, rep: r.rep } );
		this.toast( r.tierUp ? `${ done } · ${ t( 'Joe now calls you: {name}', { name: t( TIERS[ this.state.tier ].name ) } ) }` : done, r.tierUp ? 4500 : 2600 );
		if ( this.app.audio && this.app.audio.coin ) this.app.audio.coin();
		return r;

	}

	dropOrder( id ) {

		return this.state.dropOrder( id );

	}

	// tournaments (Tournament.js): entered and given up at Joe's stand
	enterTournament() {

		const a = this.state.enterTournament();
		if ( a ) this.toast( t( '{name} has started · {min} minutes on the clock', { name: t( LEAGUES[ a.league ].name ), min: Math.round( DURATION / 60 ) } ), 3600 );
		return a;

	}

	withdrawTournament() {

		return this.state.withdrawTournament();

	}

	// the tournament clock; the result toast when it runs out
	updateTournament( dt ) {

		const r = this.state.tickTournament( dt );
		if ( ! r ) return;
		const name = t( LEAGUES[ r.league ].name );
		let msg = r.prize ? t( '{name} over · you came {place} · ${v}', { name, place: t( PLACES[ r.place - 1 ] ), v: r.prize } ) : t( '{name} over · you came {place}', { name, place: t( PLACES[ r.place - 1 ] ) } );
		if ( r.promoted ) msg += ` · ${ t( 'next up: {league}', { league: t( LEAGUES[ this.state.circuit.league ].name ) } ) }`;
		this.toast( msg, 6000 );
		if ( r.prize && this.app.audio && this.app.audio.coin ) this.app.audio.coin();

	}

	refuel() {

		const l = this.state.refuel();
		if ( l > 0 ) {

			this._fuelOut = false;
			this.toast( t( 'Filled up · {n} L', { n: l.toFixed( 0 ) } ) );

		}

		return l;

	}

	toast( text, ms = 2600 ) {

		if ( this.hud ) this.hud.toast( text, ms );
		else console.log( '[game]', text );

	}

	get canFish() {

		const app = this.app, p = app.player;
		return ! app.freeCam && ( p.mode === 'walk' || p.mode === 'deck' ) && ! ( app.ui && app.ui.ui && app.ui.ui._photo );

	}

	// ---- per frame (after the player / camera update)
	update( dt ) {

		const app = this.app, p = app.player, inp = app.input, rod = this.rod;
		this._cardDismissed = false;
		if ( ! this.hud && app.ui && app.ui.ui && typeof document !== 'undefined' && document.head ) {

			const ui = app.ui.ui;
			this.hud = new GameHUD( ui, this );
			// the minimap (lower right) and the first-play guide (intro, one-time tips; replay from F1)
			this.minimap = new Minimap( ui.hud || ui.root, this );
			this.guide = new Guide( ui, this, this.minimap );
			this.worldMap = new WorldMap( ui.root, this, this.minimap );
			ui.onReplayGuide = () => this.guide.replay();

		}

		const can = this.canFish;
		if ( inp.hit( 'KeyR' ) && can && ! this.fight ) {

			rod.equip( ! rod.equipped );
			if ( ! rod.equipped ) this.cancelLine();
			this.toast( rod.equipped ? 'Rod out · hold left mouse to cast' : 'Rod away', 1600 );

		}

		if ( ! can && rod.equipped ) {

			// swimming, driving, free camera: the line comes in and the rod goes away
			this.cancelLine( true );
			rod.equip( false );

		}

		if ( this.hud && ( inp.hit( 'KeyI' ) || inp.hit( 'Tab' ) ) ) {

			if ( this.worldMap ) this.worldMap.toggle( false );
			this.hud.toggleInventory();

		}

		// M: the full map (it lets go of the mouse; closing it with M takes it back)
		if ( this.worldMap && inp.hit( 'KeyM' ) && ! this.fight ) {

			const open = ! this.worldMap.open;
			if ( open ) {

				this.hud.toggleInventory( false );
				this.hud.closeStand();

			}

			this.worldMap.toggle( open );
			if ( ! open ) app.input.requestLock();

		}

		if ( this.hud && inp.hit( 'Escape' ) ) {

			this.hud.toggleInventory( false );
			this.hud.closeStand();
			if ( this.worldMap ) this.worldMap.toggle( false );

		}

		if ( this.worldMap ) this.worldMap.update();

		// mouse edges (the left button also looks around while the pointer isn't captured)
		const lmb = inp.mouseDown && inp.enabled, rmb = inp.rightDown && inp.enabled;
		const lDown = lmb && ! this._lmb, lUp = ! lmb && this._lmb, rDown = rmb && ! this._rmb;
		this._lmb = lmb;
		this._rmb = rmb;
		const panelOpen = this.mapOpen || ( this.hud && ( this.hud.invOpen || this.hud.standOpen ) );

		if ( rod.equipped && ! panelOpen ) {

			if ( rod.state === 'idle' && lDown ) rod.startWindup();
			else if ( rod.state === 'windup' && lUp ) rod.release();
			else if ( rod.state === 'floating' ) {

				if ( lDown ) this.strike();
				else if ( rDown ) {

					rod.retrieve();
					this.bite = null;

				}

			} else if ( rod.state === 'flying' && rDown ) rod.retrieve();

		}

		// bites and the fight
		if ( rod.state === 'floating' ) this.updateBite( dt );
		else if ( ! this.fight ) rod.dip = Math.max( 0, rod.dip - dt * 4 );
		if ( this.fight ) this.updateFight( dt, lmb && ! panelOpen );

		rod.update( dt, { visible: can, fight: this.fight } );
		// the landed fish hangs on the end of the line, turned to face you, then goes in the cooler. With
		// the HUD the catch card comes up once the fish has swung in, and the fish stays (slowly turning)
		// until the card is dismissed (click, E, Esc) or times out.
		const L = this.landing;
		if ( L && rod.state === 'landing' && can ) {

			const c = app.camera.position, m = rod.bobber;
			let yaw = Math.atan2( c.x - m.x, c.z - m.z );
			if ( L.card ) {

				if ( ! L.shown && rod.t > 0.3 ) {

					L.shown = true;
					this.hud.showCatch( L.card, CATCH_CARD_MS );

				}

				if ( L.shown ) {

					// a slow turn so both flanks show
					L.cardT += dt;
					yaw += Math.sin( L.cardT * 0.7 ) * 0.55;
					if ( lDown || inp.hit( 'KeyE' ) || inp.hit( 'Escape' ) || L.cardT > CATCH_CARD_MS / 1000 ) {

						this._cardDismissed = true; // this frame's E / click belong to the card
						this.endLanding();

					}

				}

			}

			if ( this.landing ) {

				// with the HUD the fish is shown on the full-screen catch card (studio portrait), not on
				// the line; without it (headless) it hangs on the line for a moment
				if ( ! L.card ) this.display.show( L.species, L.kg, m, yaw, dt );
				else if ( this.display.shown ) this.display.hide();
				if ( ! L.card && rod.t > 2.8 ) this.endLanding();

			}

		} else if ( this.landing || this.display.shown ) this.endLanding();

		p.busy = rod.lineInWater || rod.state === 'windup';

		this.updateBoat( dt );

		// the traders
		for ( const v of this.vendors ) v.update( dt, p.mode === 'walk' ? p.position : null );
		for ( const v of this.givers || [] ) v.loadWhenNear( p.position );
		this.updateVendors( inp, p );

		// prompts when the player has nothing to say
		if ( ! p.prompt && can ) p.prompt = this.prompt();

		const aboard = p.mode === 'boat' || p.mode === 'deck';
		this.updateTournament( dt );
		const tour = this.state.circuit.active;
		// the catch card's live fish portrait (or one queued thumbnail)
		if ( this.hud && this.hud.portrait ) this.hud.portrait.update( dt );
		if ( this.hud ) this.hud.update( {
			fuel: aboard ? { litres: this.state.fuelL, tank: this.state.stats.fuelL } : null,
			sonar: aboard && this.state.stats.finder ? this._sonar : null,
			fight: this.fight,
			casting: rod.state === 'windup',
			power: rod.power,
			bite: this.bite && this.bite.phase === 'take',
			aiming: rod.equipped,
			tourney: tour ? { left: tour.left, score: tour.score, place: place( this.state.circuit ) } : null,
		} );
		if ( this.minimap ) this.minimap.update( dt );
		if ( this.guide ) this.guide.update( dt );

	}

	prompt() {

		const rod = this.rod, p = this.app.player;
		if ( ! rod.equipped ) {

			// by the water (boat deck, pier, the wet beach, wading): suggest the rod
			const byWater = p.mode === 'deck' || ( p.mode === 'walk' && [ 'wood', 'wetsand', 'water' ].includes( p.surface ) );
			return byWater ? { key: 'R', text: 'Take out the rod' } : null;

		}

		const b = this.bite;
		switch ( rod.state ) {

			case 'idle': return { key: 'LMB', text: 'Hold to wind up, release to cast   ·   R  put the rod away' };
			case 'windup': return { key: 'LMB', text: 'Release to cast (hold longer to cast farther)' };
			case 'flying': return null;
			case 'floating':
				if ( b && b.phase === 'take' ) return { key: 'LMB', text: 'Strike now!' };
				if ( b && b.phase === 'nibble' ) return { key: '…', text: 'Something\'s nibbling · wait until the bobber is pulled under' };
				return { key: 'RMB', text: 'Waiting for a bite · right-click to reel the line in' };
			case 'retrieving': return { key: 'RMB', text: 'Reeling in' };
			case 'fighting': return this.fight && this.fight.tension > this.fight.band[ 1 ]
				? { key: 'LMB', text: 'Too much tension · let go!' }
				: { key: 'LMB', text: 'Hold to reel · let go when the tension goes red' };
			case 'landing': return null;
			default: return null;

		}

	}

	// crossing from one island's waters to another's (or out to the open sea): name the new water
	updateWaters( dt, pos ) {

		this._watersT = ( this._watersT || 0 ) - dt;
		if ( this._watersT > 0 ) return;
		this._watersT = 1;
		const isle = this.islandAt( pos.x, pos.z );
		if ( this._waters && isle.id !== this._waters ) {

			this.toast( isle === OPEN_SEA
				? t( 'Open sea · tuna and mahi roam out here' )
				: t( 'Entering the waters of {name}', { name: t( isle.name ) } ), 3600 );

		}

		this._waters = isle.id;

	}

	// fuel burn at the helm (the engine stops when the tank is dry) and the fish finder
	updateBoat( dt ) {

		const app = this.app, b = app.boatCtl, p = app.player, s = this.state;
		const aboard = p.mode === 'boat' || p.mode === 'deck';
		if ( aboard ) this.updateWaters( dt, b.position );
		if ( this._aboard && ! aboard && b.anchored ) this.toast( t( 'Anchor down · the boat waits here' ), 3000 );
		this._aboard = aboard;
		if ( b.driven ) {

			const left = s.burn( fuelBurn( b.rpm ) * dt );
			if ( left <= 0 ) {

				b.throttle = 0;
				p.cruise = 0;
				if ( ! this._fuelOut ) this.toast( 'Out of fuel · buy diesel at the chandlery by the boathouse', 4000 );
				this._fuelOut = true;

			}

		} else if ( this._wasDriven ) s.save();
		this._wasDriven = b.driven;

		if ( ( p.mode === 'boat' || p.mode === 'deck' ) && s.stats.finder ) {

			this._sonarT -= dt;
			if ( this._sonarT <= 0 ) {

				this._sonarT = 0.5;
				const x = b.position.x, z = b.position.z;
				const depth = Math.max( 0, - app.terrainData.heightAt( x, z ) );
				const h = this.habitatAtPoint( x, z, depth );
				let rich = 0;
				for ( const k in h ) rich += h[ k ];
				this._sonar = { depth, fish: Math.min( 1, rich / 1.4 ) };

			}

		}

	}

	updateVendors( inp, p ) {

		const hud = this.hud;
		let near = null;
		if ( p.mode === 'walk' ) for ( const v of this.vendors ) if ( v.inRange( p.position ) ) near = v;
		for ( const v of this.vendors ) v.talking = !! ( hud && hud.standOpen && hud.vendor === v );
		if ( hud && hud.standOpen && ( ! near || near !== hud.vendor ) ) hud.closeStand();
		if ( ! near || this.fight || this._cardDismissed || ( hud && hud.catchOpen ) ) return;
		if ( ! p.prompt ) p.prompt = { key: 'E', text: hud && hud.standOpen ? 'Leave' : t( 'Talk to {name}', { name: t( near.name ).split( ' · ' )[ 0 ] } ) };
		if ( inp.hit( 'KeyE' ) ) {

			if ( ! hud ) {

				if ( near.kind === 'buyer' ) this.sellAll(); // headless: straight sale

			} else if ( hud.standOpen ) hud.closeStand();
			else hud.openStand( near );

		}

	}

	sellAll() {

		const r = this.state.sell();
		if ( r.count ) this.toast( t( 'Sold {n} fish for ${v}', { n: r.count, v: r.total } ) );
		if ( this.app.audio && this.app.audio.coin ) this.app.audio.coin();
		return r;

	}

	sell( ids ) {

		const r = this.state.sell( ids );
		if ( r.count ) this.toast( t( 'Sold for ${v}', { v: r.total } ) );
		return r;

	}

	// ---- bites
	habitat() {

		return this.habitatAtPoint( this.rod.bobber.x, this.rod.bobber.z, this.rod.depth );

	}

	habitatAtPoint( x, z, depth ) {

		const b = { x, z };
		const outer = this.app.terrainData.outerAt?.( x, z );
		if ( outer ) return habitatAt( { depth, reefDist: outer.reefDist( x, z ), pierDist: Infinity } );
		const reef = WORLD.reef;
		const reefDist = Math.hypot( b.x - reef.center.x, b.z - reef.center.z ) - reef.radius;
		const P = this._pier;
		const rect = ( x0, x1, z0, z1 ) => Math.hypot( Math.max( x0 - b.x, 0, b.x - x1 ), Math.max( z0 - b.z, 0, b.z - z1 ) );
		const walk = rect( P.x - P.width / 2, P.x + P.width / 2, P.zStart, P.zEnd );
		const head = rect( P.x - P.headWidth / 2, P.x + P.headWidth / 2, P.zEnd - P.headDepth, P.zEnd );
		return habitatAt( { depth, reefDist, pierDist: Math.min( walk, head ) } );

	}

	// the island definition whose water (x, z) is in: an outer island's grid, the home island's,
	// or the open sea between them
	islandAt( x, z ) {

		const T = this.app.terrainData;
		const o = T.outerAt?.( x, z );
		if ( o ) return o.def;
		const half = T.size / 2;
		return Math.abs( x ) < half && Math.abs( z ) < half ? WORLD.island : OPEN_SEA;

	}

	get mapOpen() {

		return !! ( this.worldMap && this.worldMap.open );

	}

	get hour() {

		return this.app.settings.timeOfDay;

	}

	onBobberLanded( where ) {

		if ( where !== 'water' ) {

			this.toast( 'Landed on the sand', 1400 );
			return;

		}

		this.bite = { phase: 'wait', t: biteDelay( this.habitat(), this.hour, Math.random, this.rain() ) };

	}

	// 0..1: how hard it is raining (fish feed better in it; see Bites.rainBiteRate)
	rain() {

		const w = this.app.weather;
		return w ? w.rainLevel : 0;

	}

	updateBite( dt ) {

		const rod = this.rod;
		const b = this.bite;
		if ( ! b ) return;
		b.t -= dt;
		// bobber motion for the cues
		if ( b.phase === 'nibble' ) rod.dip = Math.max( 0, Math.sin( Math.min( 1, ( b.pulse || 0 ) ) * Math.PI ) * 0.45 );
		else if ( b.phase === 'take' ) rod.dip += ( 1.4 - rod.dip ) * ( 1 - Math.exp( - dt * 14 ) );
		else rod.dip = Math.max( 0, rod.dip - dt * 3 );
		if ( b.phase === 'nibble' ) b.pulse = ( b.pulse || 0 ) + dt * 3.2;

		if ( b.t > 0 ) return;
		if ( b.phase === 'wait' ) {

			const h = this.habitat();
			const isle = this.islandAt( this.rod.bobber.x, this.rod.bobber.z );
			const species = pickSpecies( h, this.hour, Math.random, isle.species || undefined );
			if ( ! species ) {

				b.t = 8;
				return;

			}

			// now and then, in its own conditions, a legend takes the bait instead (Legends.js)
			const legend = rollLegend( { habitat: h, hour: this.hour, rain: this.rain(), tide: this.app.tide }, this.state.legends, Math.random, isle.legends || undefined );
			b.legend = legend;
			b.species = legend ? LEGENDS[ legend ].species : species;
			b.kg = legend ? legendWeight( legend ) : rollWeight( species );
			b.phase = 'nibble';
			b.nibbles = 1 + Math.floor( Math.random() * 3 );
			if ( legend ) this.toast( 'Something heavy is mouthing the bait…', 2200 );
			b.t = 0.7 + Math.random() * 0.8;
			b.pulse = 0;

		} else if ( b.phase === 'nibble' ) {

			b.nibbles --;
			b.pulse = 0;
			if ( b.nibbles > 0 ) b.t = 0.6 + Math.random() * 1.0;
			else {

				b.phase = 'take';
				// big, strong fish give a (slightly) shorter window
				b.t = 2.4 - FISH[ b.species ].fight * 0.5;
				if ( this.app.audio && this.app.audio.fishSplash ) this.app.audio.fishSplash( rod.bobber, 0.35 );

			}

		} else if ( b.phase === 'take' ) {

			this.toast( 'It took the bait and ran', 1800 );
			this.bite = { phase: 'wait', t: biteDelay( this.habitat(), this.hour, Math.random, this.rain() ) };

		}

	}

	strike() {

		const b = this.bite;
		if ( ! b || b.phase === 'wait' || b.phase === 'nibble' ) {

			// too early: a nibbling fish isn't hooked yet; it keeps nibbling (a hint, no penalty)
			if ( b && b.phase === 'nibble' ) this.toast( 'Not yet · wait for it to pull under', 1500 );
			return;

		}

		const g = this.state.stats;
		const legend = b.legend ? LEGENDS[ b.legend ] : null;
		this.fight = new CatchMinigame( { species: b.species, kg: b.kg, lineKg: g.lineKg, reelSpeed: g.reelSpeed, distance: Math.max( 3, this.rod.lineOut ), staminaMul: legend ? legend.stamina : 1, powerMul: legend ? legend.power : 1 } );
		this.fight.legend = b.legend || null;
		this.bite = null;
		this.rod.hook();
		this.toast( legend ? t( 'Fish on! It\'s {legend}!', { legend: t( legend.name ) } ) : 'Fish on!', legend ? 2600 : 1200 );

	}

	updateFight( dt, reeling ) {

		const f = this.fight;
		const st = f.update( dt, reeling );
		// the fish thrashes at the surface as each run starts
		const au = this.app.audio;
		if ( f.surge > 0.6 && ! f._splashed && au && au.fishSplash ) au.fishSplash( this.rod.bobber, 0.3 + 0.5 * Math.min( 1, f.kg / 8 ) );
		f._splashed = f.surge > 0.6 ? true : f.surge < 0.3 ? false : f._splashed;
		if ( st === 'fighting' ) return;
		this.fight = null;
		this.rod.dip = 0;
		const name = FISH[ f.species ].name;
		if ( st === 'caught' && f.legend ) {

			// a legend: Joe's bounty and the trophy wall, never the cooler
			const info = this.state.addLegend( f.legend, f.kg );
			if ( this.onCatch ) this.onCatch( { species: f.species, kg: f.kg, legend: f.legend } );
			this.toast( t( info.firstLegend ? 'Legend landed: {legend} · ${v} bounty' : '{legend} again · ${v} bounty', { legend: legendTitle( f.legend ), v: info.value } ), 5000 );
			if ( au && au.fishSplash ) au.fishSplash( this.rod.bobber, 1 );
			if ( au && au.fishFlop ) au.fishFlop();
			if ( this.hud ) this.landing = { species: f.species, kg: f.kg, card: info, cardT: 0 };
			else this.landing = { species: f.species, kg: f.kg };
			this.rod.land();

		} else if ( st === 'caught' ) {

			const entry = this.state.addFish( f.species, f.kg, this.hour );
			if ( this.onCatch ) this.onCatch( { species: f.species, kg: f.kg } );
			const info = this.state.lastCatch;
			for ( const m of info.milestones ) this.toast( milestoneText( m ), 4500 );
			if ( au && au.fishSplash ) au.fishSplash( this.rod.bobber, 0.8 );
			if ( au && au.fishFlop ) au.fishFlop();
			// the catch card (with a HUD) while the fish hangs on the line; a toast otherwise
			if ( this.hud ) this.landing = { species: f.species, kg: f.kg, card: info, cardT: 0 };
			else {

				if ( entry ) this.toast( `${ info.record ? t( 'New record! ' ) : '' }${ t( '{name} · {kg} kg · ${v}', { name: t( name ), kg: entry.kg.toFixed( 2 ), v: entry.value } ) }`, 3600 );
				else this.toast( t( '{name} · {kg} kg · no room in the {hold}, let it go', { name: t( name ), kg: f.kg.toFixed( 1 ), hold: t( this.state.upgrades.hold > 0 ? 'Hold' : 'Cooler' ) } ), 3600 );
				this.landing = { species: f.species, kg: f.kg };

			}

			this.rod.land();

		} else if ( st === 'snapped' ) {

			this.toast( f.legend ? t( 'Snap! {legend} broke the line. It\'s still out there.', { legend: t( LEGENDS[ f.legend ].name ) } ) : 'Snap! The line broke', 2400 );
			if ( au && au.lineSnap ) au.lineSnap();
			this.rod.setState( 'idle' );

		} else {

			this.toast( f.legend ? t( '{legend} threw the hook. It\'s still out there.', { legend: t( LEGENDS[ f.legend ].name ) } ) : 'It threw the hook', 2000 );
			this.rod.endFight();

		}

	}

	// the landed fish goes in the cooler: card, fish and line away
	endLanding() {

		this.landing = null;
		this.display.hide();
		if ( this.hud && this.hud.catchOpen ) this.hud.hideCatch();
		if ( this.rod.state === 'landing' ) this.rod.setState( 'idle' );

	}

	// line in at once (mode change)
	cancelLine( silent = false ) {

		if ( this.fight && ! silent ) this.toast( 'Lost it', 1400 );
		this.fight = null;
		this.bite = null;
		if ( this.rod.state !== 'stowed' ) this.rod.setState( this.rod.equipped ? 'idle' : 'stowed' );

	}

}

// 1st, 2nd, 3rd, 4th: for the tournament result
const PLACES = [ '1st', '2nd', '3rd', '4th' ];
