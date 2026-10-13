// ─────────────────────────────────────────────────────────────────────────────
// i18n for Tidewater.
//
// The source language is English: every user-visible string in the code stays in
// English and acts as its own dictionary key. A locale is a plain
// { 'English string': 'translated string' } map, so:
//
//   t( 'Wind speed' )                      → '风速'
//   t( 'Sold {n} fish for ${v}', { n: 3, v: 120 } ) → '卖出 3 条鱼，得 $120'
//   t( 'anything not in the dictionary' )  → unchanged
//
// Missing entries fall through to English, so a partial translation never breaks
// the UI. `en` is the identity locale (no table) — setLocale( 'en' ) gives the
// original game back.
//
// The locale is picked once at load: ?lang=xx in the URL, else localStorage
// 'tidewater.lang', else the default below. The settings panel (Camera → Interface
// → Language) writes it and reloads, because the panel, the HUD and the guide are
// built once at startup with the strings already in them.
//
// One gap: the loading screen in index.html is static markup shown before any
// module runs, so it is Chinese regardless of ?lang=. Everything after it follows
// the locale.
// ─────────────────────────────────────────────────────────────────────────────

import { ZH_CN } from './zh-CN.js';

export const LOCALES = {
	en: { id: 'en', name: 'English', table: null },
	'zh-CN': { id: 'zh-CN', name: '简体中文', table: ZH_CN },
};

export const DEFAULT_LOCALE = 'zh-CN';

const KEY = 'tidewater.lang';
const PLACEHOLDER = /\{(\w+)\}/g;

let id = DEFAULT_LOCALE;
let table = LOCALES[ DEFAULT_LOCALE ].table;

function read() {

	try {

		const q = new URLSearchParams( globalThis.location?.search ?? '' ).get( 'lang' );
		if ( q && LOCALES[ q ] ) return q;
		const s = globalThis.localStorage?.getItem( KEY );
		if ( s && LOCALES[ s ] ) return s;

	} catch ( e ) { /* no DOM (node tests): keep the default */ }

	return DEFAULT_LOCALE;

}

export function setLocale( next ) {

	const l = LOCALES[ next ] ? next : 'en';
	id = l;
	table = LOCALES[ l ].table;
	try {

		if ( globalThis.document ) globalThis.document.documentElement.lang = l;
		if ( globalThis.localStorage ) globalThis.localStorage.setItem( KEY, l );

	} catch ( e ) { /* ignore */ }

	return id;

}

export function getLocale() {

	return id;

}

// Translate `s`. `vars` fills {name} placeholders (after lookup, so translations
// may reorder them). Non-strings pass through; unknown keys fall back to English.
export function t( s, vars ) {

	if ( s == null || typeof s === 'number' || typeof s === 'boolean' ) return s;
	const raw = typeof s === 'string' ? s : String( s );
	let out = raw;
	if ( table !== null ) {

		const hit = table[ raw ];
		if ( hit !== undefined ) out = hit;

	}

	if ( vars !== undefined ) out = out.replace( PLACEHOLDER, ( m, k ) => ( k in vars ? String( vars[ k ] ) : m ) );
	return out;

}

// True when the current locale has its own entry for `s` (useful in tests and for
// spotting untranslated strings).
export function has( s ) {

	return table !== null && table[ s ] !== undefined;

}

export const _ = t;

setLocale( read() );
