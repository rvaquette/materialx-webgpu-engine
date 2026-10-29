import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../scenes/pathtracer/', import.meta.url));
const number = value => {
  if (!Number.isFinite(value)) throw new Error(`Non-finite scene value: ${value}`);
  return String(Math.abs(value) < 1e-12 ? 0 : Number(value.toPrecision(12)));
};
const tuple = values => `(${values.map(number).join(', ')})`;
const sub = (a, b) => a.map((v, i) => v - b[i]);
const add = (a, b) => a.map((v, i) => v + b[i]);
const scale = (a, s) => a.map(v => v * s);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const length = a => Math.hypot(...a);
const unit = a => {
  if (length(a) < 1e-10) throw new Error(`Degenerate scene direction: ${a}`);
  return scale(a, 1 / length(a));
};
const identifier = name => name.replace(/[^A-Za-z0-9_]/g, '_').replace(/^(\d)/, '_$1');
const asset = path => `@./${path.replaceAll('\\', '/').replace(/^\.\//, '')}@`;
const matrix = (x, y, z, p) => `(${[...x, 0, ...y, 0, ...z, 0, ...p, 1]
  .reduce((rows, v, i) => { (rows[Math.floor(i / 4)] ??= []).push(v); return rows; }, [])
  .map(tuple).join(', ')})`;

export function sourceBlocks(text) {
  const clean = text.replace(/#.*|\/\/[^\n]*/g, '');
  return [...clean.matchAll(/^\s*(renderer|camera|mesh|gltf|light)\s*\{([^{}]*)\}/gm)].map(match => {
    const entries = match[2].split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => {
      const [, key, value] = /^(\S+)\s+(.*)$/.exec(line) ?? [];
      if (!key) throw new Error(`Invalid ${match[1]} line: ${line}`);
      return [key, value.trim()];
    });
    return { type: match[1], entries, values: Object.fromEntries(entries) };
  });
}

function vector(values, key, fallback) {
  if (values[key] === undefined) {
    if (fallback) return fallback;
    throw new Error(`Missing ${key}`);
  }
  const result = values[key].split(/\s+/).map(Number);
  if (result.length !== 3 || !result.every(Number.isFinite)) throw new Error(`Invalid ${key}: ${values[key]}`);
  return result;
}

function frame(position, target) {
  const z = unit(sub(position, target));
  const up = Math.abs(z[1]) > 0.999 ? [0, 0, 1] : [0, 1, 0];
  const x = unit(cross(up, z));
  return matrix(x, cross(z, x), z, position);
}

function transform(values, indent) {
  if (values.matrix) {
    const m = values.matrix.split(/\s+/).map(Number);
    if (m.length !== 16 || !m.every(Number.isFinite)) throw new Error('Invalid source matrix');
    return `${indent}matrix4d xformOp:transform = ${matrix([m[0], m[4], m[8]], [m[1], m[5], m[9]], [m[2], m[6], m[10]], [m[3], m[7], m[11]])}
${indent}uniform token[] xformOpOrder = ["xformOp:transform"]`;
  }
  const lines = [], order = [];
  for (const [key, type] of [['position', 'double3'], ['scale', 'float3']]) {
    if (values[key] === undefined) continue;
    const op = key === 'position' ? 'translate' : 'scale';
    lines.push(`${indent}${type} xformOp:${op} = ${tuple(vector(values, key))}`);
    order.push(`"xformOp:${op}"`);
  }
  if (order.length) lines.push(`${indent}uniform token[] xformOpOrder = [${order.join(', ')}]`);
  return lines.join('\n');
}

function emitter(name, emission, points, counts, indices) {
  const path = `/World/Lights/${name}_Material`;
  return `        def Material "${name}_Material"
        {
            token outputs:surface.connect = <${path}/Surface.outputs:surface>
            def Shader "Surface"
            {
                uniform token info:id = "UsdPreviewSurface"
                color3f inputs:diffuseColor = (0, 0, 0)
                int inputs:useSpecularWorkflow = 1
                color3f inputs:specularColor = (0, 0, 0)
                color3f inputs:emissiveColor = ${tuple(emission)}
                token outputs:surface
            }
        }
        def Mesh "${name}_Geometry"
        {
            point3f[] points = [${points.map(tuple).join(', ')}]
            int[] faceVertexCounts = [${counts.join(', ')}]
            int[] faceVertexIndices = [${indices.join(', ')}]
            uniform token subdivisionScheme = "none"
            rel material:binding = <${path}>
        }`;
}

export function repairStage(stage, source) {
  const blocks = sourceBlocks(source);
  const render = blocks.find(block => block.type === 'renderer')?.values ?? {};
  const cameras = blocks.filter(block => block.type === 'camera');
  if (cameras.length !== 1) throw new Error(`Expected one source camera, got ${cameras.length}`);
  const camera = cameras[0].values;
  let position = vector(camera, 'position', [0, 0, 0]), target = vector(camera, 'lookat', [0, 0, 0]);
  if (camera.matrix) {
    const m = camera.matrix.split(/\s+/).map(Number);
    if (m.length !== 16 || !m.every(Number.isFinite)) throw new Error('Invalid camera matrix');
    position = [m[3], m[7], m[11]];
    // Source camera matrices use +Z forward; USD cameras look along local -Z.
    target = add(position, [m[2], m[6], m[10]]);
  }
  const resolution = (render.resolution ?? '1280 720').split(/\s+/).map(Number);
  const fov = Number(camera.fov ?? 45);
  if (resolution.length !== 2 || resolution.some(v => !(v > 0)) || !(fov > 0 && fov < 180)) throw new Error('Invalid source camera projection');
  const aperture = 100 * Math.tan(fov * Math.PI / 360);
  const cameraText = `    def Camera "Camera"
    {
        matrix4d xformOp:transform = ${frame(position, target)}
        uniform token[] xformOpOrder = ["xformOp:transform"]
        token projection = "perspective"
        float focalLength = 50
        float horizontalAperture = ${number(aperture)}
        float verticalAperture = ${number(aperture * resolution[1] / resolution[0])}
        float2 clippingRange = (0.001, 1000000)
        custom point3f pathtracer:lookAt = ${tuple(target)}
        custom float pathtracer:fov = ${number(fov)}
${camera.focaldist ? `        float focusDistance = ${number(Number(camera.focaldist))}\n` : ''}${camera.aperture ? `        custom float pathtracer:aperture = ${number(Number(camera.aperture))}\n` : ''}    }`;
  const looks = /    def Scope "Looks"\s*\{[\s\S]*?\n    \}/.exec(stage)?.[0];
  if (!looks) throw new Error('Missing Looks scope');
  const materials = new Set([...looks.matchAll(/def Material "([^"]+)"/g)].map(match => match[1]));
  const binding = name => {
    const id = name ? identifier(name) : 'DefaultMaterial';
    if (!materials.has(id)) throw new Error(`Undefined source material ${name ?? id}`);
    return `            rel material:binding = </World/Looks/${id}>`;
  };
  const usedNames = new Set();
  const meshes = [];
  for (const block of blocks.filter(block => block.type === 'mesh' || block.type === 'gltf')) {
    const v = block.values;
    if (!v.file) throw new Error('Missing geometry filename');
    const selections = block.entries.filter(([key]) => key === 'object').map(([, value]) => {
      const parts = value.split(/\s+/);
      return { object: parts.slice(0, -1).join(' '), material: parts.at(-1) };
    });
    for (const selection of selections.length ? selections : [{ material: v.material }]) {
      let name = identifier(selection.object ?? v.name ?? basename(v.file).replace(/\.[^.]+$/, ''));
      const base = name;
      for (let i = 2; usedNames.has(name); i++) name = `${base}_${i}`;
      usedNames.add(name);
      meshes.push(`        def Mesh "${name}"
        {
            custom asset engine:geometry:file = ${asset(v.file)}
${selection.object ? `            custom string engine:geometry:object = ${JSON.stringify(selection.object)}\n` : ''}${transform(v, '            ')}
${binding(selection.material)}
        }`);
    }
  }
  const lights = [];
  if (render.envmapfile) {
    lights.push(`        def DomeLight "Environment"
        {
            asset inputs:texture:file = ${asset(render.envmapfile)}
${render.envmapirradiancefile ? `            asset inputs:texture:irradianceFile = ${asset(render.envmapirradiancefile)}\n` : ''}            float inputs:intensity = ${number(Number(render.envmapintensity ?? 1))}
            color3f inputs:color = (1, 1, 1)
${render.envmaprotation ? `            float xformOp:rotateY = ${number(Number(render.envmaprotation))}\n            uniform token[] xformOpOrder = ["xformOp:rotateY"]\n` : ''}        }`);
  }
  let lightIndex = 0;
  for (const block of blocks.filter(block => block.type === 'light')) {
    const v = block.values, p = vector(v, 'position', [0, 0, 0]);
    const emission = vector(v, 'emission', [1, 1, 1]);
    if (emission.some(value => value < 0)) throw new Error('Negative light emission');
    const intensity = Math.max(...emission);
    const color = intensity > 0 ? scale(emission, 1 / intensity) : [1, 1, 1];
    let type, attributes, xform, points, counts, indices;
    if (v.type === 'quad') {
      const u = sub(vector(v, 'v1'), p), w = sub(vector(v, 'v2'), p);
      type = 'RectLight';
      xform = matrix(unit(u), scale(unit(w), -1), scale(unit(cross(u, w)), -1), add(p, scale(add(u, w), 0.5)));
      attributes = `            float inputs:width = ${number(length(u))}\n            float inputs:height = ${number(length(w))}`;
      points = [p, add(p, u), add(p, add(u, w)), add(p, w)];
      counts = [4];
      indices = [0, 1, 2, 3];
    } else if (v.type === 'sphere') {
      type = 'SphereLight';
      xform = frame(p, add(p, [0, 0, -1]));
      attributes = `            float inputs:radius = ${number(Number(v.radius ?? 1))}`;
      const radius = Number(v.radius ?? 1);
      if (!(radius > 0)) throw new Error('Invalid source light radius');
      points = [];
      counts = [];
      indices = [];
      const rings = 12, segments = 24;
      points.push(add(p, [0, radius, 0]));
      for (let ring = 1; ring < rings; ring++) {
        const theta = Math.PI * ring / rings;
        for (let segment = 0; segment < segments; segment++) {
          const phi = 2 * Math.PI * segment / segments;
          points.push(add(p, scale([Math.sin(theta) * Math.cos(phi), Math.cos(theta), Math.sin(theta) * Math.sin(phi)], radius)));
        }
      }
      const bottom = points.length;
      points.push(add(p, [0, -radius, 0]));
      for (let segment = 0; segment < segments; segment++) {
        const next = (segment + 1) % segments;
        counts.push(3, 3);
        indices.push(0, 1 + next, 1 + segment, bottom, 1 + (rings - 2) * segments + segment, 1 + (rings - 2) * segments + next);
        for (let ring = 0; ring < rings - 2; ring++) {
          const a = 1 + ring * segments + segment, b = 1 + ring * segments + next;
          counts.push(4);
          indices.push(a, b, b + segments, a + segments);
        }
      }
    } else if (v.type === 'distant') {
      type = 'DistantLight';
      xform = frame(p, [0, 0, 0]);
      attributes = '            float inputs:angle = 0';
    } else throw new Error(`Unsupported source light ${v.type}`);
    const name = `Light_${String(++lightIndex).padStart(3, '0')}`;
    lights.push(`        def ${type} "${name}"
        {
            matrix4d xformOp:transform = ${xform}
            uniform token[] xformOpOrder = ["xformOp:transform"]
            color3f inputs:color = ${tuple(color)}
            float inputs:intensity = ${number(intensity)}
            bool inputs:normalize = false
${attributes}
        }`);
    // Analytic lights are imported as directional approximations by this engine.
    // Matching emissive geometry also makes finite lights reachable by BSDF rays.
    if (points) lights.push(emitter(name, emission, points, counts, indices));
  }
  const header = stage.slice(0, stage.indexOf('    def Camera'));
  return `${header}${cameraText}

${looks}

    def Scope "Geometry"
    {
${meshes.join('\n')}
    }

    def Scope "Lights"
    {
${lights.join('\n')}
    }
}
`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const write = process.argv.includes('--write');
  let changed = 0;
  for (const file of readdirSync(ROOT).filter(file => file.endsWith('.usda')).sort()) {
    const path = join(ROOT, file), before = readFileSync(path, 'utf8');
    const after = repairStage(before, readFileSync(path.replace(/\.usda$/, '.scene'), 'utf8'));
    if (after !== before) {
      changed++;
      if (write) writeFileSync(path, after);
      else console.log(`Needs repair: ${file}`);
    }
  }
  console.log(`${changed} stages ${write ? 'repaired' : 'need repair'}.`);
  if (!write && changed) process.exitCode = 1;
}
