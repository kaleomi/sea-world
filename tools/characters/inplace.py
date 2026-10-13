#!/usr/bin/env python3
"""Make a clip walk on the spot: the motextr_xy clips move the pelvis forward (root motion) and the
game moves the character itself, so the steady drift of the pelvis is taken out (its sway stays).
Rewrites the GLB in place.
    python3 tools/characters/inplace.py <file.glb> [clip ...]     (default clip: walk_neutral_01)"""
import json, struct, sys

def inplace(path, clips):
	d = bytearray(open(path, 'rb').read())
	n = struct.unpack('<I', d[12:16])[0]
	g = json.loads(d[20:20 + n])
	base = 20 + n + 8  # the BIN chunk's data
	done = []
	for a in g.get('animations', []):
		if a['name'] not in clips:
			continue
		for c in a['channels']:
			t = c['target']
			if t['path'] != 'translation' or g['nodes'][t['node']].get('name') != 'Bip01 Pelvis':
				continue
			acc = g['accessors'][a['samplers'][c['sampler']]['output']]
			bv = g['bufferViews'][acc['bufferView']]
			off, k = base + bv.get('byteOffset', 0) + acc.get('byteOffset', 0), acc['count']
			v = list(struct.unpack_from('<%df' % (3 * k), d, off))
			for axis in range(3):
				a0, a1 = v[axis], v[3 * (k - 1) + axis]
				for i in range(k):
					v[3 * i + axis] -= (a1 - a0) * i / max(1, k - 1)
			struct.pack_into('<%df' % (3 * k), d, off, *v)
			acc.pop('min', None); acc.pop('max', None)
			done.append(a['name'])
	if done:
		js = json.dumps(g, separators=(',', ':')).encode()
		js += b' ' * ((4 - len(js) % 4) % 4)
		out = d[:12] + struct.pack('<I', len(js)) + b'JSON' + js + d[20 + n:]
		struct.pack_into('<I', out, 8, len(out))
		open(path, 'wb').write(out)
	print(path, 'in place:', ', '.join(done) or 'nothing')

if __name__ == '__main__':
	inplace(sys.argv[1], set(sys.argv[2:]) or {'walk_neutral_01'})
