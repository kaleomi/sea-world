import { AVATARS, MAX_NAME, cleanName } from './Protocol.js';
import { loadProfile } from './Multiplayer.js';
import { t } from '../i18n/index.js';

// The start screen's "who are you": a name and one of the avatars (public/ui/avatars/<av>.jpg), filled
// in from the last game. main.js reads it when the player starts and goes online with it.
//   const prof = mountProfile( ui.startEl.querySelector( '.tw-start-inner' ), beforeEl );  prof.get() -> { name, av }
const CSS = /* css */`
.np-profile { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 14px 18px 16px; border-radius: 16px;
	background: rgba(8, 14, 22, 0.5); border: 1px solid rgba(255,255,255,0.1); backdrop-filter: blur(10px) saturate(1.2); -webkit-backdrop-filter: blur(10px) saturate(1.2);
	cursor: default; pointer-events: auto; }
.np-profile label { font-size: 13px; color: var(--tw-ink-2, #cfd8dc); text-shadow: 0 1px 2px rgba(0,0,0,0.6); }
.np-profile input { width: 240px; padding: 9px 14px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.25); outline: none; text-align: center;
	font: 600 16px var(--tw-font, system-ui); color: #fff; background: rgba(8, 18, 26, 0.75); }
.np-profile input:focus { border-color: var(--tw-aqua, #5fd3cf); }
.np-avatars { display: flex; gap: 10px; }
.np-avatars button { width: 64px; height: 84px; padding: 0; border-radius: 12px; overflow: hidden; border: 2px solid rgba(255,255,255,0.15); background: rgba(255,255,255,0.06);
	cursor: pointer; transition: border-color 150ms, transform 150ms; }
.np-avatars button img { width: 100%; height: 100%; object-fit: cover; display: block; }
.np-avatars button:hover { transform: translateY(-2px); }
.np-avatars button.is-on { border-color: var(--tw-aqua, #5fd3cf); box-shadow: 0 0 0 3px rgba(95, 211, 207, 0.35); }
`;

export function mountProfile( parent, before = null ) {

	const style = document.createElement( 'style' );
	style.textContent = CSS;
	document.head.append( style );
	const base = ( import.meta.env && import.meta.env.BASE_URL ) || '/';
	const saved = loadProfile();
	let av = saved.av;
	const el = document.createElement( 'div' );
	el.className = 'np-profile';
	el.innerHTML = `<label>${ t( 'Your name at sea' ) }</label><input type="text" maxlength="${ MAX_NAME }" autocomplete="off" spellcheck="false">
		<div class="np-avatars">${ AVATARS.map( ( a ) => `<button type="button" data-av="${ a }" title="${ t( 'Choose this look' ) }"><img src="${ base }ui/avatars/${ a }.jpg" alt=""></button>` ).join( '' ) }</div>`;
	const input = el.querySelector( 'input' );
	input.value = saved.name;
	input.placeholder = t( 'Type a name' );
	const pick = ( a ) => {

		av = a;
		for ( const b of el.querySelectorAll( '[data-av]' ) ) b.classList.toggle( 'is-on', b.dataset.av === a );

	};
	for ( const b of el.querySelectorAll( '[data-av]' ) ) b.addEventListener( 'click', () => pick( b.dataset.av ) );
	pick( av );
	parent.insertBefore( el, before );
	return {
		el,
		get: () => ( { name: cleanName( input.value ) || `${ t( 'Sailor' ) } ${ 100 + Math.floor( Math.random() * 900 ) }`, av } ),
	};

}
