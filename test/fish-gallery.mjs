// The catchable fish laid out on the sand, flank up, for a look at the models and skins.
//   node test/fish-gallery.mjs [outDir] [ids,comma,separated]   (default: the open-ocean fish)
import { setupLife } from './life-harness.mjs';
import * as E from '../src/engine/index.js';
import { WORLD } from '../src/world/WorldLayout.js';
import { FishProps } from '../src/world/fish/FishProps.js';
import { FISH, ZONE_FISH } from '../src/game/FishTable.js';

const out = process.argv[ 2 ] || '/tmp';
const ids = process.argv[ 3 ] ? process.argv[ 3 ].split( ',' ) : ZONE_FISH;
const rc = WORLD.reef.center;
const L = await setupLife( { W: 2400, H: 1350, ground: { center: [ rc.x, rc.z ], size: 200, res: 0.5 }, near: 0.05, sun: [ 0.2, 0.9, 0.3 ] } );

// a dry patch of sand
let bx = rc.x, bz = rc.z;
for ( let k = 0; k < 400 && L.terrain.heightAt( bx, bz ) < 1.2; k ++ ) { bx += 1; bz -= 0.6; }
const by = L.terrain.heightAt( bx, bz );
const props = new FishProps();
const fm = new E.Matrix4();
const COLS = 4, DX = 0.75, DZ = 0.42;
ids.forEach( ( id, i ) => {

	const model = FISH[ id ].model;
	const len = id === 'oarfish' ? 0.7 : 0.55;
	const x = ( i % COLS - ( COLS - 1 ) / 2 ) * DX, z = ( Math.floor( i / COLS ) - 1 ) * DZ;
	fm.makeRotationY( 0 ).setPosition( bx + x, by + 0.02 + FishProps.restHeight( model, len ), bz + z );
	props.add( 'whole', model, fm, 'side', len, { seed: i * 0.13, cloudy: 0.05, wet: 1, anchor: [ 0, 0, 0 ] } );

} );
L.scene.add( props.build() );
L.camera.position.set( bx, by + 2.3, bz + 0.5 );
L.camera.lookAt( bx, by, bz );
await L.run( 4 );
await L.save( `${ out }/fish-gallery.png` );
await L.exit();
