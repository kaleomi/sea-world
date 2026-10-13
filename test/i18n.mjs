// i18n unit tests: the dictionary, the t() lookup and its {placeholder} filling.
// Plain node, no DOM: src/i18n/index.js guards every window/document access.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { t, getLocale, setLocale, has, LOCALES } from '../src/i18n/index.js';
import { ZH_CN } from '../src/i18n/zh-CN.js';
import { BOATS } from '../src/game/Boats.js';
import { FISH } from '../src/game/FishTable.js';
import { UPGRADES } from '../src/game/Gear.js';
import { WEATHER, WEATHER_IDS } from '../src/weather/WeatherState.js';

const here = dirname( fileURLToPath( import.meta.url ) );
let pass = 0, fail = 0;

function ok( cond, name ) {

	if ( cond ) { pass ++; console.log( `  ok   ${ name }` ); }
	else { fail ++; console.error( `  FAIL ${ name }` ); }

}

console.log( 'i18n' );

// ── locale plumbing ─────────────────────────────────────────────────────────
ok( getLocale() === 'zh-CN', 'zh-CN is the default locale' );
ok( 'en' in LOCALES && 'zh-CN' in LOCALES, 'both locales are registered' );
ok( LOCALES.en.table === null, 'the English locale is the identity (no table)' );

// ── lookup ──────────────────────────────────────────────────────────────────
ok( t( 'Wind speed' ) === '风速', 'a known key is translated' );
ok( t( 'No such string here' ) === 'No such string here', 'an unknown key falls back to English' );
ok( t( '' ) === '', 'the empty string passes through' );
ok( t( null ) === null && t( undefined ) === undefined, 'null and undefined pass through' );
ok( t( 12 ) === 12, 'numbers are not touched' );
ok( has( 'Shadows' ) && ! has( 'Definitely not a key' ), 'has() reports whether a key is translated' );

// ── placeholders ────────────────────────────────────────────────────────────
ok( t( 'Sold {n} fish for ${v}', { n: 3, v: 120 } ) === '卖出 3 条鱼，得 $120', 'placeholders are filled after lookup' );
ok( t( 'Your best: {kg} kg · {cm} cm', { kg: '4.20', cm: 71 } ) === '你的最好成绩：4.20 公斤 · 71 厘米', 'units stay put, values are substituted' );
ok( t( 'Sold {n} fish for ${v}', {} ) === '卖出 {n} 条鱼，得 ${v}', 'a missing variable leaves the placeholder visible' );
ok( t( 'Reset {x}', { x: '风速' } ) === '重置 风速', 'placeholders work on already-translated fragments' );

// ── round trip to English ───────────────────────────────────────────────────
setLocale( 'en' );
ok( t( 'Wind speed' ) === 'Wind speed', 'setLocale( en ) gives the source strings back' );
setLocale( 'zh-CN' );
ok( t( 'Wind speed' ) === '风速', 'and back to Chinese' );
setLocale( 'klingon' );
ok( getLocale() === 'en', 'an unknown locale falls back to English, not to a half table' );
setLocale( 'zh-CN' );

// ── dictionary hygiene ──────────────────────────────────────────────────────
// A literal scan, because a duplicated key in an object literal is silently
// dropped by JS — the tests above would still pass with the wrong translation.
const src = readFileSync( join( here, '../src/i18n/zh-CN.js' ), 'utf8' );
const body = src.slice( src.indexOf( 'export const ZH_CN' ) );
const keys = [ ...body.matchAll( /^\t(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")\s*:/gm ) ]
	.map( ( m ) => ( m[ 1 ] !== undefined ? m[ 1 ] : m[ 2 ] ).replace( /\\'/g, '\'' ).replace( /\\\\/g, '\\' ) );
const dupes = keys.filter( ( k, i ) => keys.indexOf( k ) !== i );
ok( dupes.length === 0, `no duplicate keys${ dupes.length ? ` (${ [ ...new Set( dupes ) ].join( ', ' ) })` : '' }` );
ok( keys.length > 250, `the dictionary covers the UI (${ keys.length } keys)` );

// Strings that are all placeholders and punctuation keep their source form on purpose.
const IDENTICAL_OK = new Set( [ '{s} · {done} / {total}' ] );
const identity = keys.filter( ( k ) => ZH_CN[ k ] === k && ! IDENTICAL_OK.has( k ) );
ok( identity.length === 0, `no key translates to itself${ identity.length ? ` (${ identity.join( ', ' ) })` : '' }` );

// ── the data tables the UI shows ────────────────────────────────────────────
const missingFish = Object.values( FISH ).map( ( f ) => f.name ).filter( ( n ) => ! has( n ) );
ok( missingFish.length === 0, `every fish species is translated${ missingFish.length ? ` (missing: ${ missingFish.join( ', ' ) })` : '' }` );

const gearNames = [];
for ( const track of [ ...Object.values( UPGRADES ), ...Object.values( BOATS ).flatMap( ( b ) => Object.values( b.tracks ) ) ] ) {

	gearNames.push( track.name );
	for ( const lv of track.levels ) gearNames.push( lv.label );

}

for ( const b of Object.values( BOATS ) ) gearNames.push( b.name, b.blurb );

const missingGear = gearNames.filter( ( n ) => ! has( n ) );
ok( missingGear.length === 0, `every gear track and level is translated${ missingGear.length ? ` (missing: ${ missingGear.join( ', ' ) })` : '' }` );

const missingWeather = WEATHER_IDS.map( ( k ) => WEATHER[ k ].label ).filter( ( n ) => ! has( n ) );
ok( missingWeather.length === 0, `every weather preset is translated${ missingWeather.length ? ` (missing: ${ missingWeather.join( ', ' ) })` : '' }` );

// ── keys that must not collide ──────────────────────────────────────────────
// 'Storm' is a sea-state preset and used to be the storm weather's label too;
// the weather one was renamed so each gets its own translation.
ok( t( 'Storm' ) === '风暴' && t( 'Thunderstorm' ) === '雷暴', 'the sea state and the weather storm do not collide' );
ok( t( 'Rain' ) === '阵雨' && t( 'Rainfall' ) === '雨量', 'the weather preset and the rain slider do not collide' );
ok( t( 'Conditions' ) === '海况' && t( 'Weather conditions' ) === '天气状况', 'the two preset groups are distinct' );

// ── completeness ────────────────────────────────────────────────────────────
// Every literal handed to the panel as a label / tooltip must be in the table,
// otherwise a new control silently ships in English.
const UI_FILES = [
	'src/ui/AppUI.js', 'src/ui/UI.js', 'src/game/GameHUD.js',
	'src/game/Guide.js', 'src/game/Game.js', 'src/game/Minimap.js',
];
const SYMBOL_ONLY = /^[^A-Za-z]*$|^\d+x$/; // '2x', '16x', '—', …

for ( const rel of UI_FILES ) {

	const text = readFileSync( join( here, '..', rel ), 'utf8' )
		.replace( /^\s*\/\/.*$/gm, '' ); // drop line comments
	const missing = new Set();
	for ( const m of text.matchAll( /(?:label|text|tooltip)\s*:\s*'((?:[^'\\]|\\.)*)'/g ) ) {

		const v = m[ 1 ].replace( /\\'/g, '\'' );
		if ( ! has( v ) && ! SYMBOL_ONLY.test( v ) ) missing.add( v );

	}

	ok( missing.size === 0, `${ rel }: every label and tooltip is translated${ missing.size ? ` (missing: ${ [ ...missing ].join( ' | ' ) })` : '' }` );

}

console.log( `\n${ pass } passed, ${ fail } failed` );
if ( fail ) process.exit( 1 );
