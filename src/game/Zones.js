// Ocean zones: the farther from the home island, the deeper the sea and the rarer (and dearer) the fish.
//
//   shallows  浅滩    water under 6 m, along any beach
//   coastal   次浅海  the shelves round the islands (6–40 m) and the open water within 2 km of home
//   offshore  半深海  open water 2–4 km out: the ring the outer islands sit in
//   deep      深海    open water beyond 4 km
//   trench    海沟    a long arc north-east of home, 5–5.9 km out: the deepest water there is
//
// The terrain itself stays a flat 90 m floor out there (nobody sees it); chartDepth() is what the fish
// finder reads, and the zone weights feed the bite tables (Bites.habitatAt keys offshore / abyss /
// trench). Pure functions, no engine imports, so the tests, the HUD and both maps share them.

export const ZONES = [
	{ id: 'shallows', name: 'Shallows', color: '#2f7f95' },
	{ id: 'coastal', name: 'Coastal waters', color: '#0e3156' },
	{ id: 'offshore', name: 'Offshore waters', color: '#0a2242' },
	{ id: 'deep', name: 'Deep sea', color: '#05152b' },
	{ id: 'trench', name: 'The Trench', color: '#1a1042' },
];
export const ZONE_BY_ID = Object.fromEntries( ZONES.map( ( z ) => [ z.id, z ] ) );

export const SHALLOW_M = 6; // shallower than this: the shallows
export const SHELF_M = 40; // shallower than this (and not the shallows): coastal, wherever it is
export const COASTAL_R = 2000; // open water within this distance of home is coastal
export const DEEP_R = 4000; // ... beyond this, the deep sea
const BLEND = 300; // m over which one open-water zone fades into the next
// the trench: an arc round home, centred on `angle` (atan2( z, x ); -z is north), r0..r1 from home
export const TRENCH = { angle: - 0.96, half: 0.4, r0: 5000, r1: 5900 };
const TRENCH_EDGE = 150; // m (radial) / TRENCH_EDGE / r (angular) of its soft walls

function smooth( e0, e1, x ) {

	const t = Math.min( 1, Math.max( 0, ( x - e0 ) / ( e1 - e0 ) ) );
	return t * t * ( 3 - 2 * t );

}

// 0..1: how much (x, z) is in the trench
export function trenchWeight( x, z ) {

	const r = Math.hypot( x, z );
	if ( r < TRENCH.r0 - TRENCH_EDGE || r > TRENCH.r1 + TRENCH_EDGE ) return 0;
	let da = Math.atan2( z, x ) - TRENCH.angle;
	da = Math.atan2( Math.sin( da ), Math.cos( da ) );
	const ea = TRENCH_EDGE / r;
	const radial = smooth( TRENCH.r0 - TRENCH_EDGE, TRENCH.r0 + TRENCH_EDGE, r ) * ( 1 - smooth( TRENCH.r1 - TRENCH_EDGE, TRENCH.r1 + TRENCH_EDGE, r ) );
	return radial * ( 1 - smooth( TRENCH.half - ea, TRENCH.half + ea, Math.abs( da ) ) );

}

// how much open water at (x, z) belongs to each zone: { coastal, offshore, deep, trench }, summing to 1
export function openZoneWeights( x, z ) {

	const r = Math.hypot( x, z );
	const out = smooth( COASTAL_R - BLEND, COASTAL_R + BLEND, r );
	const far = smooth( DEEP_R - BLEND, DEEP_R + BLEND, r );
	const trench = trenchWeight( x, z ) * far;
	return { coastal: 1 - out, offshore: out - far, deep: far - trench, trench };

}

// the zone (x, z) is in, given the water depth there (m)
export function zoneAt( x, z, depth ) {

	if ( depth < SHALLOW_M ) return 'shallows';
	if ( depth < SHELF_M ) return 'coastal';
	const w = openZoneWeights( x, z );
	let best = 'coastal';
	for ( const k in w ) if ( w[ k ] > w[ best ] ) best = k;
	return best;

}

// the depth a chart (and the fish finder) gives for (x, z): the real depth on the shelves, the open
// sea's depth out there (90 m near home, a few hundred among the outer islands, over a kilometre in
// the deep sea, about 8 km in the trench)
export function chartDepth( x, z, depth ) {

	if ( depth < SHELF_M ) return depth;
	const r = Math.hypot( x, z );
	let open = 90 + 260 * smooth( 1800, 4000, r ) + 900 * smooth( 3800, 4600, r ) + Math.min( 800, Math.max( 0, r - 4600 ) * 0.5 );
	open += 6400 * trenchWeight( x, z );
	return depth + ( Math.max( depth, open ) - depth ) * smooth( SHELF_M, 85, depth );

}

// add the open-ocean habitat weights to a Bites.habitatAt result for (x, z, depth): offshore, abyss
// (the deep sea) and trench. Farther out the coastal 'deep' fish (snapper, blackfin, mahi) thin out.
export function zoneHabitat( h, x, z, depth ) {

	const open = smooth( 30, 60, depth );
	const w = openZoneWeights( x, z );
	h.offshore = open * w.offshore;
	h.abyss = open * w.deep;
	h.trench = open * w.trench;
	h.deep = ( h.deep || 0 ) * ( 1 - open * ( 0.85 * w.deep + w.trench ) );
	return h;

}

// paint the open-water zones onto a 2D canvas (world map): X( x ) / Y( z ) map world metres to
// canvas pixels, s is pixels per metre. Islands (baked separately) are drawn on top.
export function paintZones( ctx, X, Y, s, W, H ) {

	const cx = X( 0 ), cy = Y( 0 );
	ctx.fillStyle = ZONE_BY_ID.deep.color;
	ctx.fillRect( 0, 0, W, H );
	// the trench: an annular sector
	ctx.beginPath();
	ctx.arc( cx, cy, TRENCH.r1 * s, TRENCH.angle - TRENCH.half, TRENCH.angle + TRENCH.half );
	ctx.arc( cx, cy, TRENCH.r0 * s, TRENCH.angle + TRENCH.half, TRENCH.angle - TRENCH.half, true );
	ctx.closePath();
	ctx.fillStyle = ZONE_BY_ID.trench.color;
	ctx.fill();
	ctx.strokeStyle = 'rgba(170, 140, 255, 0.6)';
	ctx.lineWidth = 1.5;
	ctx.setLineDash( [] );
	ctx.stroke();
	const disc = ( r, color ) => {

		ctx.beginPath();
		ctx.arc( cx, cy, r * s, 0, Math.PI * 2 );
		ctx.fillStyle = color;
		ctx.fill();

	};
	disc( DEEP_R, ZONE_BY_ID.offshore.color );
	disc( COASTAL_R, ZONE_BY_ID.coastal.color );
	// dashed boundaries
	ctx.setLineDash( [ 6, 6 ] );
	ctx.lineWidth = 1;
	ctx.strokeStyle = 'rgba(190, 220, 255, 0.28)';
	for ( const r of [ COASTAL_R, DEEP_R ] ) {

		ctx.beginPath();
		ctx.arc( cx, cy, r * s, 0, Math.PI * 2 );
		ctx.stroke();

	}

	ctx.setLineDash( [] );

}

// where to write each open-water zone's name on the map (world x, z), in gaps between the islands
export const ZONE_LABELS = [
	{ id: 'coastal', x: 1150, z: 1150 },
	{ id: 'offshore', x: 2400, z: - 2500 },
	{ id: 'deep', x: - 1500, z: - 4700 },
	{ id: 'trench', x: Math.cos( TRENCH.angle ) * 5450, z: Math.sin( TRENCH.angle ) * 5450 },
];
