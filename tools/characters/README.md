# Characters

The vendors (Joe at the fish stand, Marta at the chandlery) are avatars from the
[Microsoft Rocketbox](https://github.com/microsoft/Microsoft-Rocketbox) library (MIT license,
`public/models/characters/LICENSE-Rocketbox.md`), converted offline to one GLB each
(`public/models/characters/joe.glb`, `marta.glb`): mesh (~7.5k triangles, 80-bone Bip01 skin),
1024² textures and the clips below. The players' avatars on the shared sea
(`player_m1`, `player_m2`, `player_f1`, `player_f2`: Male_Adult_01, Male_Adult_16, Female_Adult_17 and
Female_Adult_05) are built the same way with their own clips, and their portraits on the start screen
are `public/ui/avatars/<av>.jpg`.

    tools/characters/build.sh [workdir]      # fetch -> textures -> Blender -> public/models/characters/

- `fetch.sh`: one file from the Rocketbox repo (Git LFS media URL, raw fallback).
- `textures.sh`: the 2048² TGA maps to 1024² JPEG / PNG; the specular map becomes the roughness
  channel of an ORM texture (R 1, G roughness = 0.92 - 0.6 × specular, B metalness 0); the opacity
  map (hair, lashes) keeps its alpha.
- `convert.py` (Blender 4.2+, tested with 5.2, run in the background): imports the avatar, builds
  glTF-exportable materials (`body`, `head`, `opacity`), imports each clip FBX and retargets it by
  bone name in world space (the clips' skeleton rests with the arms down, the avatars in a T-pose,
  so local rotations can't be copied): every avatar bone copies its clip bone's world rotation
  (the pelvis also its position) and the result is baked, one NLA track per clip, exported as
  glTF animations.

- `inplace.py <glb> [clip ...]` (plain Python 3): takes the forward drift out of a clip's pelvis, so a
  root-motion clip (`motextr_xy`) walks on the spot; the game moves the character.

Without zsh or macOS Blender: `pip install bpy` (Blender as a Python module) works too,
`python3 convert.py -- <avatar.fbx> <texdir> <prefix> <out.glb> <clip.fbx ...>`; `textures.sh` falls
back to ImageMagick 6's `convert` where `magick` is missing.

Vendor clips (the in-place `motextr_static` versions, `m_` for men and `f_` for women): `idle_neutral_01`,
`idle_breathe_01`, `idle_look_around_01`, `gestic_talk_neutral_01`, `gestic_talk_relaxed_01`,
`wave_01`, `gestic_shrug_01`. Player clips: `idle_neutral_01`, `umbrella_idle_01` (the arm forward:
holding the rod), `cheer_01`, `wave_01` and `walk_neutral_01` (from `motextr_xy`, made in place).

Runtime: `engine/loaders/GLTF.js` (loadGLB) and `engine/render/Skinning.js` (SkinnedModel: clip
crossfades, GPU skinning, motion vectors, shadows); `game/Vendor.js` swaps the stand-in figure for
the character once it has loaded. `test/character-smoke.mjs <glb> <out.png> [clip]` renders one
headlessly.
