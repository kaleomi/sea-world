import { FISH, fishValue, fishLengthCm } from './FishTable.js';
import { defaultUpgrades, gearStats, nextLevel, UPGRADES, FUEL_PRICE } from './Gear.js';
import { medalFor, newMilestones, MILESTONES } from './Collection.js';
import { newBoard, boardFromJSON, fillBoard, fillOrder, dropOrder, tierOf, TIERS } from './Orders.js';
import { LEGENDS, legendBounty, legendsFromJSON } from './Legends.js';
import { questsFromJSON, completeQuest } from './Quests.js';
import { LEAGUES, newCircuit, circuitFromJSON, makeOffer, enter, weighIn, tick, withdraw } from './Tournament.js';

const SAVE_KEY = 'tidewater.save.v1';
const BACKUP_KEY = SAVE_KEY + '.bak'; // the save before the last one: what load falls back to
const BROKEN_KEY = SAVE_KEY + '.broken'; // an unreadable save, kept aside instead of overwritten
// the save format; bump it when toJSON changes and add a MIGRATIONS step for the old one
export const SAVE_VERSION = 1;
// MIGRATIONS[ n ]( d ) turns a version-n save into a version n + 1 one
const MIGRATIONS = {};
const FUEL_SAVE_MS = 5000;
const TOURNEY_SAVE_MS = 10000; // the tournament clock is saved this often while one runs // at the helm the tank is saved this often, so a reload doesn't refill it

// Everything the player owns: wallet, the fish in the cooler / hold, the fish log and the gear
// levels. Saved to localStorage (per browser) after every change; storage can be missing or throw
// (private windows, blocked site data), so every access is guarded and the game runs without it.
export class GameState {

	constructor( storage = safeStorage(), now = () => Date.now() ) {

		this.storage = storage;
		this.now = now;
		this.loadedFrom = null; // 'save' | 'backup' | null (nothing to load)
		this.readOnly = false; // the save on disk is from a newer version: never overwrite it
		this._lastSaved = null;
		this._fuelSavedAt = - Infinity;
		this.money = 0;
		this.inventory = []; // { id, species, kg, cm, value, caughtAt (game hours), record }
		this.log = {}; // species -> { count, bestKg, bestCm }
		// the last addFish: { species, kg, cm, value, newSpecies, record, prevBestKg, prevBestCm, kept } (the catch card)
		this.lastCatch = null;
		this.upgrades = defaultUpgrades();
		this.fuel = null; // litres left (null = full tank)
		this.orders = newBoard(); // Joe's orders and your reputation with him (Orders.js)
		this.claimed = []; // collection milestones already paid (Collection.js)
		this.legends = {}; // the trophy wall: legend id -> { count, bestKg } (Legends.js)
		this.quests = questsFromJSON( null ); // the outer islands' quest givers: id -> jobs done (Quests.js)
		this.rng = Math.random;
		fillBoard( this.orders, this.rng );
		this.circuit = newCircuit(); // tournaments: the league, the one on offer, the one running (Tournament.js)
		this.circuit.offer = makeOffer( this.circuit, this.rng );
		this._tourneySavedAt = - Infinity;
		this._nextId = 1;
		this.listeners = new Set();

	}

	get stats() {

		return gearStats( this.upgrades );

	}

	get holdKg() {

		let kg = 0;
		for ( const f of this.inventory ) kg += f.kg;
		return kg;

	}

	get holdValue() {

		let v = 0;
		for ( const f of this.inventory ) v += f.value;
		return v;

	}

	// room in the cooler / hold for a fish of `kg`?
	fits( kg ) {

		return this.holdKg + kg <= this.stats.holdKg + 1e-6;

	}

	// store a caught fish; returns the entry, or null when the hold is full (it is logged either way).
	// A record beats an earlier catch of the species; the first one of a species is a new species.
	// land a legendary fish (Legends.js): it goes on the trophy wall, not in the cooler, and Joe pays
	// the bounty (the full one the first time). Sets lastCatch for the catch card.
	addLegend( id, kg ) {

		const L = LEGENDS[ id ];
		if ( ! L ) return null;
		kg = Math.round( kg * 100 ) / 100;
		const cm = Math.round( fishLengthCm( L.species, kg ) );
		const e = this.legends[ id ] || ( this.legends[ id ] = { count: 0, bestKg: 0 } );
		const first = e.count === 0, prevBestKg = e.bestKg;
		e.count ++;
		e.bestKg = Math.max( e.bestKg, kg );
		const value = legendBounty( id, first );
		this.money += value;
		const counted = weighIn( this.circuit, L.species, kg );
		this.lastCatch = { species: L.species, kg, cm, value, legend: id, firstLegend: first, record: ! first && kg > prevBestKg, prevBestKg, newSpecies: false, kept: true, medal: 0, medalUp: false, milestones: [], tourney: this.circuit.active ? { counted, score: this.circuit.active.score, only: this.circuit.active.kind === 'species' ? this.circuit.active.species : null } : null };
		this.save();
		this.emit();
		return this.lastCatch;

	}

	addFish( species, kg, timeOfDay = 12 ) {

		kg = Math.round( kg * 100 ) / 100;
		const cm = Math.round( fishLengthCm( species, kg ) );
		const logEntry = this.log[ species ] || ( this.log[ species ] = { count: 0, bestKg: 0 } );
		const newSpecies = logEntry.count === 0;
		const prevBestKg = logEntry.bestKg, prevBestCm = logEntry.bestCm ?? ( prevBestKg > 0 ? Math.round( fishLengthCm( species, prevBestKg ) ) : 0 );
		const record = ! newSpecies && kg > prevBestKg;
		const prevMedal = newSpecies ? 0 : medalFor( species, prevBestKg );
		logEntry.count ++;
		if ( kg > prevBestKg ) {

			logEntry.bestKg = kg;
			logEntry.bestCm = cm;

		}

		// the collection: a better medal for the species, and milestones that pay out once
		const medal = medalFor( species, logEntry.bestKg );
		const milestones = newMilestones( this.log, this.claimed );
		for ( const m of milestones ) {

			this.money += m.reward;
			this.claimed.push( m.id );

		}

		const value = fishValue( species, kg );
		const kept = this.fits( kg );
		// a tournament running: every landed fish is weighed in, kept or not
		const counted = weighIn( this.circuit, species, kg );
		this.lastCatch = { species, kg, cm, value, newSpecies, record, prevBestKg, prevBestCm, kept, medal, medalUp: medal > prevMedal, milestones, tourney: this.circuit.active ? { counted, score: this.circuit.active.score, only: this.circuit.active.kind === 'species' ? this.circuit.active.species : null } : null };
		if ( ! kept ) {

			this.save();
			this.emit();
			return null;

		}

		const f = { id: this._nextId ++, species, kg, cm, value, caughtAt: timeOfDay, record };
		this.inventory.push( f );
		this.save();
		this.emit();
		return f;

	}

	// reputation with Joe: tier index (Orders.TIERS) and the bonus he pays on every sale
	get tier() {

		return tierOf( this.orders.rep );

	}

	get saleBonus() {

		return TIERS[ this.tier ].bonus;

	}

	// what the stand pays for a fish (its value plus the reputation bonus)
	saleValue( f ) {

		return Math.round( f.value * ( 1 + this.saleBonus ) );

	}

	get saleTotal() {

		let v = 0;
		for ( const f of this.inventory ) v += this.saleValue( f );
		return v;

	}

	// sell the given fish ids (all when omitted); returns the money made
	sell( ids = null ) {

		const keep = [], sold = [];
		for ( const f of this.inventory ) ( ids === null || ids.includes( f.id ) ? sold : keep ).push( f );
		let total = 0;
		for ( const f of sold ) total += this.saleValue( f );
		this.inventory = keep;
		this.money += total;
		this.save();
		this.emit();
		return { total, count: sold.length };

	}

	release( id ) {

		this.inventory = this.inventory.filter( ( f ) => f.id !== id );
		this.save();
		this.emit();

	}

	// spend money (upgrade shop); false when it can't be afforded
	spend( amount ) {

		if ( amount > this.money ) return false;
		this.money -= amount;
		this.save();
		this.emit();
		return true;

	}

	// buy the next level of an upgrade track; returns the new level entry or null
	buy( key ) {

		if ( ! UPGRADES[ key ] ) return null;
		const next = nextLevel( this.upgrades, key );
		if ( ! next || next.cost > this.money ) return null;
		this.money -= next.cost;
		this.upgrades[ key ] = next.index;
		if ( key === 'fuel' ) this.fuel = null; // a new tank comes full
		this.save();
		this.emit();
		return next;

	}

	// hand in giver `id`'s current job (Quests.js): { quest, fish, reward, last } or null when it isn't ready
	completeQuest( id ) {

		const r = completeQuest( id, this.quests, this.inventory, this.legends );
		if ( ! r ) return null;
		const gone = new Set( r.fish.map( ( f ) => f.id ) );
		this.inventory = this.inventory.filter( ( f ) => ! gone.has( f.id ) );
		this.money += r.reward;
		this.save();
		this.emit();
		return r;

	}

	// hand Joe the fish for order `id`: { order, fish, reward, rep, tierUp } or null when the cooler
	// doesn't hold enough matching fish
	fillOrder( id ) {

		const r = fillOrder( this.orders, id, this.inventory );
		if ( ! r ) return null;
		const gone = new Set( r.fish.map( ( f ) => f.id ) );
		this.inventory = this.inventory.filter( ( f ) => ! gone.has( f.id ) );
		this.money += r.reward;
		fillBoard( this.orders, this.rng );
		this.save();
		this.emit();
		return r;

	}

	// turn an order down: Joe offers another one
	dropOrder( id ) {

		if ( ! dropOrder( this.orders, id ) ) return false;
		fillBoard( this.orders, this.rng );
		this.save();
		this.emit();
		return true;

	}

	get fuelL() {

		return this.fuel === null ? this.stats.fuelL : Math.min( this.fuel, this.stats.fuelL );

	}

	// burn litres; saved every few seconds (and when the boat stops), so a reload mid-trip keeps the level
	// ---- tournaments (Tournament.js)
	// pay the fee and start the one on offer; null when there is none or the money is short
	enterTournament() {

		const c = this.circuit;
		if ( c.active || ! c.offer ) return null;
		const fee = LEAGUES[ c.offer.league ].fee;
		if ( this.money < fee ) return null;
		this.money -= fee;
		const a = enter( c, this.rng );
		this.save();
		this.emit();
		return a;

	}

	withdrawTournament() {

		if ( ! withdraw( this.circuit ) ) return false;
		this.circuit.offer = makeOffer( this.circuit, this.rng );
		this.save();
		this.emit();
		return true;

	}

	// run the tournament clock (seconds of play); the result once it ends: the prize is paid and the
	// next one goes on offer
	tickTournament( dt ) {

		const c = this.circuit;
		if ( ! c.active ) return null;
		const r = tick( c, dt );
		if ( r ) {

			this.money += r.prize;
			c.offer = makeOffer( c, this.rng );
			this.save();
			this.emit();

		} else if ( this.now() - this._tourneySavedAt >= TOURNEY_SAVE_MS ) {

			this._tourneySavedAt = this.now();
			this.save();

		}

		return r;

	}

	burn( litres ) {

		this.fuel = Math.max( 0, this.fuelL - litres );
		if ( this.now() - this._fuelSavedAt >= FUEL_SAVE_MS ) this.save();
		return this.fuel;

	}

	refuelCost() {

		return Math.ceil( ( this.stats.fuelL - this.fuelL ) * FUEL_PRICE );

	}

	// fill up as far as the money goes; returns litres bought
	refuel() {

		const missing = this.stats.fuelL - this.fuelL;
		const litres = Math.min( missing, Math.floor( this.money / FUEL_PRICE ) );
		if ( litres <= 0 ) return 0;
		this.money -= Math.ceil( litres * FUEL_PRICE );
		this.fuel = this.fuelL + litres;
		if ( this.fuel >= this.stats.fuelL - 1e-3 ) this.fuel = null;
		this.save();
		this.emit();
		return litres;

	}

	onChange( fn ) {

		this.listeners.add( fn );
		return () => this.listeners.delete( fn );

	}

	emit() {

		for ( const fn of this.listeners ) fn( this );

	}

	toJSON() {

		return { v: SAVE_VERSION, money: this.money, inventory: this.inventory, log: this.log, upgrades: this.upgrades, fuel: this.fuel, orders: this.orders, claimed: this.claimed, legends: this.legends, quests: this.quests, circuit: this.circuit, nextId: this._nextId };

	}

	fromJSON( d ) {

		d = migrate( d );
		if ( ! d ) return false;
		this.money = Number.isFinite( d.money ) ? d.money : 0;
		this.inventory = Array.isArray( d.inventory ) ? d.inventory.filter( ( f ) => f && FISH[ f.species ] && Number.isFinite( f.kg ) ) : [];
		// saves from before lengths were recorded
		for ( const f of this.inventory ) if ( ! Number.isFinite( f.cm ) ) f.cm = Math.round( fishLengthCm( f.species, f.kg ) );
		this.log = d.log && typeof d.log === 'object' ? d.log : {};
		for ( const [ k, v ] of Object.entries( this.log ) ) if ( FISH[ k ] && v && v.bestKg > 0 && ! Number.isFinite( v.bestCm ) ) v.bestCm = Math.round( fishLengthCm( k, v.bestKg ) );
		this.upgrades = { ...defaultUpgrades(), ...( d.upgrades || {} ) };
		this.fuel = Number.isFinite( d.fuel ) ? d.fuel : null;
		// saves from before the orders start with a fresh board
		this.orders = boardFromJSON( d.orders );
		fillBoard( this.orders, this.rng );
		this.claimed = Array.isArray( d.claimed ) ? d.claimed.filter( ( id ) => MILESTONES.some( ( m ) => m.id === id ) ) : [];
		this.legends = legendsFromJSON( d.legends );
		this.quests = questsFromJSON( d.quests ); // saves from before the quests start at the first job
		this.circuit = circuitFromJSON( d.circuit );
		if ( ! this.circuit.active && ! this.circuit.offer ) this.circuit.offer = makeOffer( this.circuit, this.rng );
		this._nextId = Math.max( d.nextId | 0, ...this.inventory.map( ( f ) => f.id + 1 ), 1 );
		return true;

	}

	save() {

		this._fuelSavedAt = this.now();
		if ( ! this.storage || this.readOnly ) return;
		try {

			const json = JSON.stringify( this.toJSON() );
			if ( json === this._lastSaved ) return;
			// the previous save becomes the backup, so a save cut short (a crash, a full disk) costs one step, not the game
			if ( this._lastSaved ) this.storage.setItem( BACKUP_KEY, this._lastSaved );
			this.storage.setItem( SAVE_KEY, json );
			this._lastSaved = json;

		} catch ( e ) { /* storage full or blocked: keep playing */ }

	}

	// the save, else the backup; a save that can't be read is kept aside, a newer version's save is left alone
	load() {

		this.loadedFrom = null;
		if ( ! this.storage ) return false;
		const raw = this._read( SAVE_KEY );
		if ( raw ) {

			const d = parse( raw );
			if ( d && d.v > SAVE_VERSION ) {

				this.readOnly = true;
				return false;

			}

			if ( this.fromJSON( d ) ) {

				this.loadedFrom = 'save';
				this._lastSaved = raw;
				return true;

			}

			this._write( BROKEN_KEY, raw );

		}

		const bak = this._read( BACKUP_KEY );
		if ( bak && this.fromJSON( parse( bak ) ) ) {

			this.loadedFrom = 'backup';
			this.save();
			return true;

		}

		return false;

	}

	_read( key ) {

		try {

			return this.storage.getItem( key );

		} catch ( e ) {

			return null;

		}

	}

	_write( key, value ) {

		try {

			this.storage.setItem( key, value );

		} catch ( e ) { /* blocked */ }

	}

	reset() {

		this.money = 0;
		this.inventory = [];
		this.log = {};
		this.upgrades = defaultUpgrades();
		this.fuel = null;
		this.orders = newBoard();
		fillBoard( this.orders, this.rng );
		this.claimed = [];
		this.legends = {};
		this.quests = questsFromJSON( null );
		this.circuit = newCircuit();
		this.circuit.offer = makeOffer( this.circuit, this.rng );
		this.save();
		this.emit();

	}

}

function parse( raw ) {

	try {

		return JSON.parse( raw );

	} catch ( e ) {

		return null;

	}

}

// bring a parsed save up to SAVE_VERSION; null when it isn't a save, is from a newer version, or a step is missing
export function migrate( d ) {

	if ( ! d || typeof d !== 'object' || ! Number.isInteger( d.v ) || d.v < 1 || d.v > SAVE_VERSION ) return null;
	while ( d.v < SAVE_VERSION ) {

		const step = MIGRATIONS[ d.v ];
		if ( ! step ) return null;
		d = { ...step( d ), v: d.v + 1 };

	}

	return d;

}

function safeStorage() {

	try {

		return typeof localStorage !== 'undefined' ? localStorage : null;

	} catch ( e ) {

		return null;

	}

}
