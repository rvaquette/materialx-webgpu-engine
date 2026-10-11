// T035c1 prebuild: load the standard shader ball with three.js GLTFLoader (which
// works under Node for geometry-only GLBs) and emit a deterministic JSON fixture
// the .ts tests import without touching node:fs. three.js owns the glTF parsing;
// this script only flattens the first mesh's attributes into plain arrays.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const here = dirname(fileURLToPath(import.meta.url));
const GLB = resolve(here, '../tests/fixtures/standard-shader-ball/neutral_objects.glb');
const OUT = resolve(here, '../tests/fixtures/shader-ball.json');

function parseGlb(arrayBuffer) {
  return new Promise((res, rej) => {
    new GLTFLoader().parse(arrayBuffer, '', (gltf) => res(gltf), (err) => rej(err));
  });
}

function round7(x) {
  // float32 has ~7 significant digits; trimming keeps the fixture compact and stable.
  return Number.parseFloat(x.toFixed(7));
}

const buf = readFileSync(GLB);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const gltf = await parseGlb(ab);

let mesh = null;
gltf.scene.traverse((o) => {
  if (o.isMesh && mesh === null) mesh = o;
});
if (!mesh) {
  throw new Error('no mesh found in GLB');
}

const geo = mesh.geometry;
const pos = geo.attributes.position;
const nrm = geo.attributes.normal;
const uv = geo.attributes.uv;
if (!pos || !nrm || !uv || !geo.index) {
  throw new Error('shader ball mesh missing position/normal/uv/index');
}

const positions = Array.from(pos.array, round7);
const normals = Array.from(nrm.array, round7);
const uvs = Array.from(uv.array, round7);
const indices = Array.from(geo.index.array);

const vertexCount = pos.count;
const fixture = {
  source: 'standard-shader-ball/neutral_objects.glb',
  loader: 'three.js GLTFLoader',
  name: mesh.name,
  vertexCount,
  indexCount: indices.length,
  positions,
  normals,
  uvs,
  indices,
};

writeFileSync(OUT, JSON.stringify(fixture));
console.log(`[shaderball] ${mesh.name}: ${vertexCount} verts, ${indices.length} indices -> ${OUT}`);
