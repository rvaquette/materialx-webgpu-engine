// Builds a standalone USDA scene (plus OpenPBR MaterialX documents) from the
// GLSL-PathTracer `.scene` + .obj corpus of test_material_disney_gold. The
// GLSL-PathTracer "disney gold" material is re-expressed with MaterialX
// open_pbr_surface (base_metalness = 1, metallic F0 = base_color). Geometry,
// camera and lights are converted to native USD prims so the result is a
// self-contained .usda readable by the engine importer (no .usdc crate).
//
// Usage: node scripts/build-disney-gold-scene.mjs
//
// Inputs are read from the external corpus; outputs are written inside the
// project so it stays independent of the reference assets.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');

const SCENE_SRC = 'D:/WebGL2/GLSL-PathTracer-JS/scenes/pathtracer/test_material_disney_gold.scene';
const SCENE_DIR = 'D:/WebGL2/GLSL-PathTracer-JS/scenes/pathtracer';
const OUT_DIR = join(projectRoot, 'scenes', 'test_material_disney_gold');

// --- tiny vec3 helpers -------------------------------------------------------
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

// --- .scene parser -----------------------------------------------------------
function parseScene(text) {
  const scene = { renderer: {}, camera: {}, materials: {}, meshes: [], lights: [] };
  const lines = text.split(/\r?\n/);
  let i = 0;
  const readBlock = () => {
    const body = {};
    // expect '{' on current or next lines
    while (i < lines.length && lines[i].trim() !== '{') i++;
    i++; // skip '{'
    while (i < lines.length && lines[i].trim() !== '}') {
      const parts = lines[i].trim().split(/\s+/).filter(Boolean);
      if (parts.length) body[parts[0]] = parts.slice(1);
      i++;
    }
    i++; // skip '}'
    return body;
  };
  while (i < lines.length) {
    const head = lines[i].trim();
    if (head === 'renderer') { i++; scene.renderer = readBlock(); }
    else if (head === 'camera') { i++; scene.camera = readBlock(); }
    else if (head.startsWith('material ')) {
      const name = head.split(/\s+/)[1];
      i++;
      scene.materials[name] = readBlock();
    } else if (head === 'mesh') { i++; scene.meshes.push(readBlock()); }
    else if (head === 'light') { i++; scene.lights.push(readBlock()); }
    else i++;
  }
  return scene;
}

// --- .obj parser (points + faceVarying normals/uv) ---------------------------
function parseObj(text) {
  const v = [];
  const vt = [];
  const vn = [];
  const faces = []; // array of arrays of {v, t, n} (0-based)
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    const tag = parts[0];
    if (tag === 'v') v.push([+parts[1], +parts[2], +parts[3]]);
    else if (tag === 'vt') vt.push([+parts[1], +parts[2]]);
    else if (tag === 'vn') vn.push([+parts[1], +parts[2], +parts[3]]);
    else if (tag === 'f') {
      const corners = parts.slice(1).map((p) => {
        const [vi, ti, ni] = p.split('/');
        return {
          v: vi ? +vi - 1 : -1,
          t: ti ? +ti - 1 : -1,
          n: ni ? +ni - 1 : -1,
        };
      });
      faces.push(corners);
    }
  }
  return { v, vt, vn, faces };
}

function objToUsdMesh(obj) {
  const points = obj.v;
  const faceVertexCounts = [];
  const faceVertexIndices = [];
  const normals = []; // faceVarying
  const st = []; // faceVarying
  let hasN = false;
  let hasT = false;
  for (const face of obj.faces) {
    faceVertexCounts.push(face.length);
    for (const c of face) {
      faceVertexIndices.push(c.v);
      if (c.n >= 0 && obj.vn[c.n]) { normals.push(obj.vn[c.n]); hasN = true; } else normals.push([0, 0, 0]);
      if (c.t >= 0 && obj.vt[c.t]) { st.push(obj.vt[c.t]); hasT = true; } else st.push([0, 0]);
    }
  }
  return {
    points,
    faceVertexCounts,
    faceVertexIndices,
    normals: hasN ? normals : null,
    st: hasT ? st : null,
  };
}

// --- USDA emitters -----------------------------------------------------------
const f = (n) => {
  const r = Math.round(n * 1e6) / 1e6;
  return Object.is(r, -0) ? '0' : String(r);
};
const vec3Arr = (arr) => arr.map((p) => `(${f(p[0])}, ${f(p[1])}, ${f(p[2])})`).join(', ');
const vec2Arr = (arr) => arr.map((p) => `(${f(p[0])}, ${f(p[1])})`).join(', ');
const intArr = (arr) => arr.join(', ');

function emitMeshPrim(name, usd, materialName, indent) {
  const pad = '    '.repeat(indent);
  const pad1 = '    '.repeat(indent + 1);
  const out = [];
  out.push(`${pad}def Mesh "${name}" (`);
  out.push(`${pad1}prepend apiSchemas = ["MaterialBindingAPI"]`);
  out.push(`${pad})`);
  out.push(`${pad}{`);
  out.push(`${pad1}point3f[] points = [${vec3Arr(usd.points)}]`);
  out.push(`${pad1}int[] faceVertexCounts = [${intArr(usd.faceVertexCounts)}]`);
  out.push(`${pad1}int[] faceVertexIndices = [${intArr(usd.faceVertexIndices)}]`);
  if (usd.normals) {
    out.push(`${pad1}normal3f[] normals (`);
    out.push(`${pad1}    interpolation = "faceVarying"`);
    out.push(`${pad1}) = [${vec3Arr(usd.normals)}]`);
  }
  if (usd.st) {
    out.push(`${pad1}texCoord2f[] primvars:st (`);
    out.push(`${pad1}    interpolation = "faceVarying"`);
    out.push(`${pad1}) = [${vec2Arr(usd.st)}]`);
  }
  out.push(`${pad1}uniform token subdivisionScheme = "none"`);
  out.push(`${pad1}rel material:binding = </World/Looks/${materialName}>`);
  out.push(`${pad}}`);
  return out.join('\n');
}

function lookAtRowMajor(eye, target, up) {
  const z = norm(sub(eye, target)); // camera +Z points back toward eye
  const x = norm(cross(up, z));
  const y = cross(z, x);
  // Row-major, row-vector USD convention: translation in the last row.
  return [
    [x[0], x[1], x[2], 0],
    [y[0], y[1], y[2], 0],
    [z[0], z[1], z[2], 0],
    [eye[0], eye[1], eye[2], 1],
  ];
}

const matrixLiteral = (m) => `( ${m.map((r) => `(${r.map(f).join(', ')})`).join(', ')} )`;

function emitCamera(scene, indent) {
  const pad = '    '.repeat(indent);
  const pad1 = '    '.repeat(indent + 1);
  const eye = scene.camera.position.map(Number);
  const target = scene.camera.lookat.map(Number);
  const fovDeg = Number(scene.camera.fov?.[0] ?? 45);
  const verticalAperture = 15.2908;
  const horizontalAperture = 20.955;
  const focalLength = verticalAperture / (2 * Math.tan((fovDeg * Math.PI) / 180 / 2));
  const m = lookAtRowMajor(eye, target, [0, 1, 0]);
  return [
    `${pad}def Camera "mainCamera"`,
    `${pad}{`,
    `${pad1}float focalLength = ${f(focalLength)}`,
    `${pad1}float horizontalAperture = ${f(horizontalAperture)}`,
    `${pad1}float verticalAperture = ${f(verticalAperture)}`,
    `${pad1}float2 clippingRange = (0.1, 10000)`,
    `${pad1}token projection = "perspective"`,
    `${pad1}matrix4d xformOp:transform = ${matrixLiteral(m)}`,
    `${pad1}uniform token[] xformOpOrder = ["xformOp:transform"]`,
    `${pad}}`,
  ].join('\n');
}

function emitLights(scene, indent) {
  const pad = '    '.repeat(indent);
  const pad1 = '    '.repeat(indent + 1);
  const out = [];
  let n = 0;
  for (const light of scene.lights) {
    const type = light.type?.[0];
    const emission = (light.emission ?? ['1', '1', '1']).map(Number);
    const intensity = Math.max(...emission) || 1;
    const color = emission.map((c) => (intensity > 0 ? c / intensity : 0));
    const colorLit = `(${color.map(f).join(', ')})`;
    if (type === 'sphere') {
      const p = light.position.map(Number);
      const radius = Number(light.radius?.[0] ?? 1);
      out.push(
        `${pad}def SphereLight "light_${n}"`,
        `${pad}{`,
        `${pad1}color3f inputs:color = ${colorLit}`,
        `${pad1}float inputs:intensity = ${f(intensity)}`,
        `${pad1}float inputs:radius = ${f(radius)}`,
        `${pad1}bool inputs:normalize = true`,
        `${pad1}matrix4d xformOp:transform = ${matrixLiteral([
          [1, 0, 0, 0],
          [0, 1, 0, 0],
          [0, 0, 1, 0],
          [p[0], p[1], p[2], 1],
        ])}`,
        `${pad1}uniform token[] xformOpOrder = ["xformOp:transform"]`,
        `${pad}}`,
      );
    } else if (type === 'quad') {
      // GLSL-PathTracer quad: p0 = position, e1 = v1 - p0, e2 = v2 - p0.
      const p0 = light.position.map(Number);
      const v1 = light.v1.map(Number);
      const v2 = light.v2.map(Number);
      const e1 = sub(v1, p0);
      const e2 = sub(v2, p0);
      const width = len(e2);
      const height = len(e1);
      const center = [p0[0] + (e1[0] + e2[0]) / 2, p0[1] + (e1[1] + e2[1]) / 2, p0[2] + (e1[2] + e2[2]) / 2];
      const xAxis = norm(e2); // local +X -> width
      const yAxis = norm(e1); // local +Y -> height
      const zAxis = norm(cross(xAxis, yAxis)); // local +Z = emission axis (RectLight emits -Z)
      out.push(
        `${pad}def RectLight "light_${n}"`,
        `${pad}{`,
        `${pad1}color3f inputs:color = ${colorLit}`,
        `${pad1}float inputs:intensity = ${f(intensity)}`,
        `${pad1}float inputs:width = ${f(width)}`,
        `${pad1}float inputs:height = ${f(height)}`,
        `${pad1}bool inputs:normalize = true`,
        `${pad1}matrix4d xformOp:transform = ${matrixLiteral([
          [xAxis[0], xAxis[1], xAxis[2], 0],
          [yAxis[0], yAxis[1], yAxis[2], 0],
          [zAxis[0], zAxis[1], zAxis[2], 0],
          [center[0], center[1], center[2], 1],
        ])}`,
        `${pad1}uniform token[] xformOpOrder = ["xformOp:transform"]`,
        `${pad}}`,
      );
    }
    n++;
  }
  return out.join('\n');
}

// --- OpenPBR MaterialX from a GLSL-PathTracer material -----------------------
function emitMtlx(name, mat) {
  const color = (mat.color ?? ['0.8', '0.8', '0.8']).map(Number);
  const roughness = Number(mat.roughness?.[0] ?? 0.5);
  const metallic = Number(mat.metallic?.[0] ?? 0);
  const specular = Number(mat.specular?.[0] ?? 1);
  const lines = [
    '<?xml version="1.0"?>',
    '<materialx version="1.39" colorspace="lin_rec709">',
    `  <surfacematerial name="${name}" type="material">`,
    `    <input name="surfaceshader" type="surfaceshader" nodename="${name}_surface" />`,
    '  </surfacematerial>',
    `  <open_pbr_surface name="${name}_surface" type="surfaceshader">`,
    `    <input name="base_color" type="color3" value="${f(color[0])}, ${f(color[1])}, ${f(color[2])}" />`,
    `    <input name="base_metalness" type="float" value="${f(metallic)}" />`,
    `    <input name="specular_weight" type="float" value="${f(specular)}" />`,
    `    <input name="specular_roughness" type="float" value="${f(roughness)}" />`,
    '  </open_pbr_surface>',
    '</materialx>',
    '',
  ];
  return lines.join('\n');
}

function emitMaterialPrim(name, indent) {
  const pad = '    '.repeat(indent);
  return [
    `${pad}def Material "${name}" (`,
    `${pad}    prepend references = @./${name}.mtlx@</MaterialX/Materials/${name}>`,
    `${pad})`,
    `${pad}{`,
    `${pad}}`,
  ].join('\n');
}

// --- main --------------------------------------------------------------------
function main() {
  const scene = parseScene(readFileSync(SCENE_SRC, 'utf8'));
  mkdirSync(OUT_DIR, { recursive: true });

  // Materials -> OpenPBR .mtlx
  const materialNames = Object.keys(scene.materials);
  for (const name of materialNames) {
    writeFileSync(join(OUT_DIR, `${name}.mtlx`), emitMtlx(name, scene.materials[name]));
  }

  // Meshes
  const meshPrims = [];
  for (const mesh of scene.meshes) {
    const objPath = join(SCENE_DIR, mesh.file[0].replace(/\\/g, '/'));
    const obj = parseObj(readFileSync(objPath, 'utf8'));
    const usd = objToUsdMesh(obj);
    meshPrims.push(emitMeshPrim(mesh.name[0], usd, mesh.material[0], 2));
  }

  // Looks scope
  const looks = materialNames.map((n) => emitMaterialPrim(n, 2)).join('\n');

  const doc = [];
  doc.push('#usda 1.0');
  doc.push('(');
  doc.push('    defaultPrim = "World"');
  doc.push('    metersPerUnit = 1');
  doc.push('    upAxis = "Y"');
  doc.push('    doc = "test_material_disney_gold converted to OpenPBR MaterialX (from GLSL-PathTracer .scene)"');
  doc.push(')');
  doc.push('');
  doc.push('def Xform "World"');
  doc.push('{');
  doc.push('    def Scope "Looks"');
  doc.push('    {');
  doc.push(looks);
  doc.push('    }');
  doc.push('');
  doc.push('    def Scope "Geometry"');
  doc.push('    {');
  doc.push(meshPrims.join('\n\n'));
  doc.push('    }');
  doc.push('');
  doc.push('    def Scope "Cameras"');
  doc.push('    {');
  doc.push(emitCamera(scene, 2));
  doc.push('    }');
  doc.push('');
  doc.push('    def Scope "Lights"');
  doc.push('    {');
  doc.push(emitLights(scene, 2));
  doc.push('    }');
  doc.push('}');
  doc.push('');

  const outUsda = join(OUT_DIR, 'test_material_disney_gold.usda');
  writeFileSync(outUsda, doc.join('\n'));

  console.log(`Wrote ${outUsda}`);
  for (const name of materialNames) console.log(`Wrote ${join(OUT_DIR, `${name}.mtlx`)}`);
  console.log(`Meshes: ${scene.meshes.map((m) => m.name[0]).join(', ')}`);
  console.log(`Lights: ${scene.lights.length}  Materials: ${materialNames.length}`);
}

main();
