// Generates the deterministic priority-6 control scenes under scenes/bench:
//   node scripts/generate-effect-scenes.mjs
import { mkdir, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import { writeNanoVdb } from '../src/assets/nanovdb.ts';

/** Small deterministic PRNG (mulberry32). */
function random(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const f = value => Number(value.toFixed(4));
const tuple = values => `(${values.map(f).join(', ')})`;
const list = items => `[${items.join(', ')}]`;

const looks = (extra = '') => `    def Scope "Looks"
    {
        def Material "white" (
            prepend references = @../pathtracer/test_veach.mtlx@</MaterialX/Materials/white>
        )
        {
        }
        def Material "hair" (
            prepend references = @../mtlx-library/Examples/SimpleHair/simple_hair_default.mtlx@</MaterialX/Materials/simple_hair_default>
        )
        {
        }
        def Material "metal" (
            prepend references = @../pathtracer/test_veach.mtlx@</MaterialX/Materials/metal_2>
        )
        {
        }
${extra ? `        def Material "${extra}" (
            prepend references = @./volumes/${extra}.mtlx@</MaterialX/Materials/${extra}>
        )
        {
        }
` : ''}    }`;
const LOOKS = looks();

function stage(doc, body, { camera = [0, 2.2, 7], rotateX = -12, focal = 35, end } = {}) {
  return `#usda 1.0
(
    defaultPrim = "World"
    metersPerUnit = 1
    upAxis = "Y"
${end ? `    startTimeCode = 0\n    endTimeCode = ${end}\n    timeCodesPerSecond = 24\n` : ''}    doc = "${doc}"
)

def Xform "World"
{
    custom string pathtracer:sourceScene = "effects"
    custom int pathtracer:maxDepth = 12

    def Camera "Camera"
    {
        double3 xformOp:translate = ${tuple(camera)}
        float xformOp:rotateX = ${rotateX}
        uniform token[] xformOpOrder = ["xformOp:translate", "xformOp:rotateX"]
        float focalLength = ${focal}
        float horizontalAperture = 36
        float verticalAperture = 36
        float2 clippingRange = (0.01, 1000)
    }

${body}
}
`;
}

const FLOOR = `    def Mesh "Floor"
    {
        int[] faceVertexCounts = [4]
        int[] faceVertexIndices = [0, 1, 2, 3]
        point3f[] points = [(-10, 0, 10), (10, 0, 10), (10, 0, -10), (-10, 0, -10)]
        rel material:binding = </World/Looks/white>
    }`;

const KEY_LIGHT = `    def SphereLight "Key"
    {
        double3 xformOp:translate = (-3, 6, 4)
        uniform token[] xformOpOrder = ["xformOp:translate"]
        color3f inputs:color = (1, 0.95, 0.9)
        float inputs:intensity = 40
        bool inputs:normalize = false
        float inputs:radius = 0.6
    }`;

/** Hair patch, fur ball, particle cloud and an instanced crowd. */
function hairScene() {
  const rand = random(7);
  // Hair: a 1.6 x 1.6 patch of curly B-spline strands.
  const counts = [], points = [];
  for (let i = 0; i < 900; i++) {
    const x = -2.6 + rand() * 1.6, z = -0.8 + rand() * 1.6;
    const height = 1.2 + rand() * 0.5, phase = rand() * Math.PI * 2;
    counts.push(5);
    for (let k = 0; k < 5; k++) {
      const t = k / 4;
      points.push(tuple([x + 0.12 * Math.sin(phase + t * 5) * t, t * height, z + 0.12 * Math.cos(phase + t * 5) * t + 0.25 * t * t]));
    }
  }
  // Fur: short linear strands along the normals of a sphere.
  const furCounts = [], furPoints = [];
  for (let i = 0; i < 2500; i++) {
    const u = rand() * 2 - 1, a = rand() * Math.PI * 2, r = Math.sqrt(1 - u * u);
    const n = [r * Math.cos(a), u, r * Math.sin(a)];
    const center = [0.2, 0.75, 0];
    furCounts.push(2);
    furPoints.push(tuple(center.map((c, k) => c + 0.6 * n[k])), tuple(center.map((c, k) => c + 0.75 * n[k])));
  }
  // Particles: a drifting cloud.
  const particles = [], widths = [];
  for (let i = 0; i < 300; i++) {
    particles.push(tuple([1.6 + rand() * 1.2, 0.3 + rand() * 2, -0.6 + rand() * 1.2]));
    widths.push(f(0.03 + rand() * 0.06));
  }
  // Instancer: a ring of rotating cubes, positions animated over 48 frames.
  const ring = time => Array.from({ length: 12 }, (_, i) => {
    const a = (i / 12 + time / 96) * Math.PI * 2;
    return tuple([Math.cos(a) * 3.6, 0.25, Math.sin(a) * 3.6 - 1.5]);
  });
  const orientations = Array.from({ length: 12 }, (_, i) => {
    const a = i * 0.5;
    return tuple([Math.cos(a / 2), 0, Math.sin(a / 2), 0]);
  });
  const body = `${LOOKS}

${FLOOR}

    def BasisCurves "Hair"
    {
        uniform token type = "cubic"
        uniform token basis = "bspline"
        uniform token wrap = "pinned"
        int[] curveVertexCounts = ${list(counts)}
        point3f[] points = ${list(points)}
        float[] widths = [0.012]
        rel material:binding = </World/Looks/hair>
    }

    def BasisCurves "Fur"
    {
        uniform token type = "linear"
        int[] curveVertexCounts = ${list(furCounts)}
        point3f[] points = ${list(furPoints)}
        float[] widths = [0.01]
        rel material:binding = </World/Looks/hair>
    }

    def Points "FurCore"
    {
        point3f[] points = [(0.2, 0.75, 0)]
        float[] widths = [1.2]
        rel material:binding = </World/Looks/white>
    }

    def Points "Particles"
    {
        point3f[] points = ${list(particles)}
        float[] widths = ${list(widths)}
        rel material:binding = </World/Looks/metal>
    }

    def PointInstancer "Crowd"
    {
        rel prototypes = [</World/Crowd/Prototypes/Cube>]
        int[] protoIndices = ${list(Array(12).fill(0))}
        point3f[] positions.timeSamples = { 0: ${list(ring(0))}, 48: ${list(ring(48))} }
        quath[] orientations = ${list(orientations)}
        float3[] scales = ${list(Array(12).fill('(0.5, 0.5, 0.5)'))}
        def Scope "Prototypes"
        {
            def Mesh "Cube"
            {
                int[] faceVertexCounts = [4, 4, 4, 4, 4, 4]
                int[] faceVertexIndices = [0, 2, 3, 1, 4, 5, 7, 6, 0, 1, 5, 4, 2, 6, 7, 3, 0, 4, 6, 2, 1, 3, 7, 5]
                point3f[] points = [(-0.5, -0.5, -0.5), (0.5, -0.5, -0.5), (-0.5, 0.5, -0.5), (0.5, 0.5, -0.5), (-0.5, -0.5, 0.5), (0.5, -0.5, 0.5), (-0.5, 0.5, 0.5), (0.5, 0.5, 0.5)]
                rel material:binding = </World/Looks/white>
            }
        }
    }

    def Scope "Lights"
    {
${KEY_LIGHT.replace(/^/gm, '    ')}
    }`;
  return stage('Priority-6 control: curly hair and fur (BasisCurves, Chiang hair), particles (Points) and an animated PointInstancer.',
    body, { camera: [0, 2.2, 7.5], end: 48 });
}

/** Smooth 3D value noise in [0, 1] (deterministic). */
function noise3(seed) {
  const hash = (x, y, z) => {
    let h = (x * 374761393 + y * 668265263 + z * 1274126177 + seed * 1442695041) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const smooth = t => t * t * (3 - 2 * t);
  const value = (x, y, z) => {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const [u, v, w] = [smooth(x - xi), smooth(y - yi), smooth(z - zi)];
    let result = 0;
    for (let c = 0; c < 8; c++) {
      const dx = c & 1, dy = (c >> 1) & 1, dz = (c >> 2) & 1;
      result += hash(xi + dx, yi + dy, zi + dz) * (dx ? u : 1 - u) * (dy ? v : 1 - v) * (dz ? w : 1 - w);
    }
    return result;
  };
  return (x, y, z) => {
    let sum = 0, amplitude = 0.5, frequency = 1;
    for (let octave = 0; octave < 4; octave++) {
      sum += amplitude * value(x * frequency, y * frequency, z * frequency);
      amplitude *= 0.5; frequency *= 2;
    }
    return sum / 0.9375;
  };
}

/** Dense field from f(x, y, z) in [0, 1]^3, written as a ZIP-compressed .nvdb. */
async function writeField(path, name, dims, voxelSize, origin, f) {
  const values = new Float32Array(dims[0] * dims[1] * dims[2]);
  for (let k = 0; k < dims[2]; k++) for (let j = 0; j < dims[1]; j++) for (let i = 0; i < dims[0]; i++) {
    values[(k * dims[1] + j) * dims[0] + i] = Math.max(0, f((i + 0.5) / dims[0], (j + 0.5) / dims[1], (k + 0.5) / dims[2]));
  }
  const file = writeNanoVdb(name, dims, values, { voxelSize, origin });
  const view = new DataView(file.buffer);
  const head = 16 + 176 + view.getUint32(16 + 136, true);
  const grid = deflateSync(file.subarray(head), { level: 9 });
  const zipped = new Uint8Array(head + 8 + grid.length);
  zipped.set(file.subarray(0, head));
  const out = new DataView(zipped.buffer);
  out.setUint16(14, 1, true);
  out.setBigUint64(16 + 8, BigInt(8 + grid.length), true);
  out.setBigUint64(head, BigInt(grid.length), true);
  zipped.set(grid, head + 8);
  await writeFile(new URL(`../scenes/bench/${path}`, import.meta.url), zipped);
}

const volumeField = (name, file) => `        def OpenVDBAsset "${name}"
        {
            asset filePath = @./volumes/${file}@
            token fieldName = "${name}"
        }`;

async function volumeScene() {
  await mkdir(new URL('../scenes/bench/volumes', import.meta.url), { recursive: true });
  const cloudNoise = noise3(3), smokeNoise = noise3(11), fireNoise = noise3(5), puffNoise = noise3(17);
  // Cloud: a cluster of soft blobs carved by noise.
  const blobs = [[0.5, 0.45, 0.5, 0.32], [0.3, 0.4, 0.45, 0.22], [0.7, 0.42, 0.55, 0.24], [0.52, 0.62, 0.48, 0.2]];
  await writeField('volumes/cloud.nvdb', 'density', [72, 40, 56], 0.05, [-1.8, 0, -1.4], (x, y, z) => {
    let d = 0;
    for (const [cx, cy, cz, r] of blobs) d = Math.max(d, 1 - Math.hypot((x - cx) * 1.8, (y - cy) * 1.8 * 40 / 72, (z - cz) * 1.8 * 56 / 72) / r);
    return 8 * Math.max(0, d - 0.45 * (1 - cloudNoise(x * 6, y * 6, z * 6)));
  });
  // Smoke: a rising column that widens and thins.
  await writeField('volumes/smoke.nvdb', 'density', [32, 64, 32], 0.05, [-0.8, 0, -0.8], (x, y, z) => {
    const swirl = 0.08 * Math.sin(y * 9);
    const radius = 0.12 + 0.3 * y;
    const r = Math.hypot(x - 0.5 - swirl, z - 0.5) / radius;
    return 4 * Math.max(0, 1 - r) * (1 - 0.6 * y) * (0.4 + smokeNoise(x * 5, y * 8, z * 5));
  });
  // Fire: density and a normalized temperature, hottest at the base of the core.
  const flame = (x, y, z) => {
    const r = Math.hypot(x - 0.5, z - 0.5) / (0.28 * (1 - 0.7 * y) + 0.02);
    return Math.max(0, 1 - r) * Math.max(0, 1 - y) * (0.6 + 0.8 * fireNoise(x * 6, y * 10 - 3, z * 6));
  };
  await writeField('volumes/fire_density.nvdb', 'density', [24, 40, 24], 0.04, [-0.48, 0, -0.48], (x, y, z) => 2.5 * flame(x, y, z));
  await writeField('volumes/fire_temperature.nvdb', 'temperature', [24, 40, 24], 0.04, [-0.48, 0, -0.48],
    (x, y, z) => Math.min(1.4, 1.6 * flame(x, y, z) * (1.2 - 0.6 * y)));
  // Puff: one small noisy ball, instanced by a PointInstancer.
  await writeField('volumes/puff.nvdb', 'density', [24, 24, 24], 0.03, [-0.36, -0.36, -0.36], (x, y, z) =>
    8 * Math.max(0, 1 - Math.hypot(x - 0.5, y - 0.5, z - 0.5) / 0.45) * puffNoise(x * 5, y * 5, z * 5));
  const puffs = [[-2.6, 0.5, 1.4], [-1.9, 0.9, 1.9], [-1.2, 0.45, 1.6], [-2.2, 1.4, 1.1], [-1.5, 1.2, 1.2]];
  const body = `${looks('smoke')}

${FLOOR}

    def Volume "Cloud"
    {
        rel field:density = </World/Cloud/density>
        double3 xformOp:translate = (-0.4, 1.2, -1.2)
        uniform token[] xformOpOrder = ["xformOp:translate"]
${volumeField('density', 'cloud.nvdb')}
    }

    def Volume "Smoke"
    {
        rel field:density = </World/Smoke/density>
        rel material:binding = </World/Looks/smoke>
        double3 xformOp:translate = (2.2, 0, -0.2)
        uniform token[] xformOpOrder = ["xformOp:translate"]
${volumeField('density', 'smoke.nvdb')}
    }

    def Volume "Fire"
    {
        rel field:density = </World/Fire/density>
        rel field:temperature = </World/Fire/temperature>
        double3 xformOp:translate = (0.9, 0, 1.4)
        float3 xformOp:scale = (1.8, 1.8, 1.8)
        uniform token[] xformOpOrder = ["xformOp:translate", "xformOp:scale"]
        def OpenVDBAsset "density"
        {
            asset filePath = @./volumes/fire_density.nvdb@
            token fieldName = "density"
        }
        def OpenVDBAsset "temperature"
        {
            asset filePath = @./volumes/fire_temperature.nvdb@
            token fieldName = "temperature"
        }
    }

    def PointInstancer "Puffs"
    {
        rel prototypes = [</World/Puffs/Prototypes/Puff>]
        int[] protoIndices = ${list(puffs.map(() => 0))}
        point3f[] positions = ${list(puffs.map(tuple))}
        def Scope "Prototypes"
        {
            def Volume "Puff"
            {
                rel field:density = </World/Puffs/Prototypes/Puff/density>
${volumeField('density', 'puff.nvdb').replace(/^/gm, '        ')}
            }
        }
    }

    def Scope "Lights"
    {
${KEY_LIGHT.replace(/^/gm, '    ')}
        def DistantLight "Sun"
        {
            float xformOp:rotateX = -50
            float xformOp:rotateY = 30
            uniform token[] xformOpOrder = ["xformOp:rotateY", "xformOp:rotateX"]
            float inputs:intensity = 0.6
            float inputs:angle = 1
        }
    }`;
  await writeFile(new URL('../scenes/bench/volumes/smoke.mtlx', import.meta.url), `<?xml version="1.0"?>
<materialx version="1.39" colorspace="lin_rec709">
  <geompropvalue name="density" type="float">
    <input name="geomprop" type="string" value="density" />
  </geompropvalue>
  <multiply name="scattering" type="vector3">
    <input name="in1" type="vector3" value="0.35, 0.33, 0.3" />
    <input name="in2" type="float" nodename="density" />
  </multiply>
  <multiply name="absorption" type="vector3">
    <input name="in1" type="vector3" value="0.9, 0.9, 0.9" />
    <input name="in2" type="float" nodename="density" />
  </multiply>
  <anisotropic_vdf name="vdf" type="VDF">
    <input name="absorption" type="vector3" nodename="absorption" />
    <input name="scattering" type="vector3" nodename="scattering" />
    <input name="anisotropy" type="float" value="0.3" />
  </anisotropic_vdf>
  <volume name="volume_shader" type="volumeshader">
    <input name="vdf" type="VDF" nodename="vdf" />
  </volume>
  <surfacematerial name="smoke" type="material">
    <input name="volumeshader" type="volumeshader" nodename="volume_shader" />
  </surfacematerial>
</materialx>
`);
  return stage('Priority-6 control: NanoVDB volumes - cloud (default material), smoke (MaterialX field material), fire (density and temperature), instanced puffs.',
    body, { camera: [0, 1.8, 7.5], rotateX: -8 });
}

/** A homogeneous fog box enclosing the camera, lit through an opening. */
function fogScene() {
  const body = `${looks('fog')}

${FLOOR}

    def Mesh "FogBox"
    {
        int[] faceVertexCounts = [4, 4, 4, 4, 4, 4]
        int[] faceVertexIndices = [0, 2, 3, 1, 4, 5, 7, 6, 0, 1, 5, 4, 2, 6, 7, 3, 0, 4, 6, 2, 1, 3, 7, 5]
        point3f[] points = [(-8, 0.01, -8), (8, 0.01, -8), (-8, 6, -8), (8, 6, -8), (-8, 0.01, 10), (8, 0.01, 10), (-8, 6, 10), (8, 6, 10)]
        rel material:binding = </World/Looks/fog>
    }

    def Mesh "Pillars"
    {
        int[] faceVertexCounts = [4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4]
        int[] faceVertexIndices = [0, 2, 3, 1, 4, 5, 7, 6, 0, 1, 5, 4, 2, 6, 7, 3, 0, 4, 6, 2, 1, 3, 7, 5, 8, 10, 11, 9, 12, 13, 15, 14, 8, 9, 13, 12, 10, 14, 15, 11, 8, 12, 14, 10, 9, 11, 15, 13]
        point3f[] points = [(-1.6, 0, -1.4), (-1.0, 0, -1.4), (-1.6, 3.5, -1.4), (-1.0, 3.5, -1.4), (-1.6, 0, -0.8), (-1.0, 0, -0.8), (-1.6, 3.5, -0.8), (-1.0, 3.5, -0.8), (1.0, 0, -1.4), (1.6, 0, -1.4), (1.0, 3.5, -1.4), (1.6, 3.5, -1.4), (1.0, 0, -0.8), (1.6, 0, -0.8), (1.0, 3.5, -0.8), (1.6, 3.5, -0.8)]
        rel material:binding = </World/Looks/white>
    }

    def Scope "Lights"
    {
        def SphereLight "Lamp"
        {
            double3 xformOp:translate = (0, 3.2, -3.5)
            uniform token[] xformOpOrder = ["xformOp:translate"]
            color3f inputs:color = (1, 0.85, 0.6)
            float inputs:intensity = 60
            bool inputs:normalize = false
            float inputs:radius = 0.25
        }
    }`;
  return stage('Priority-6 control: homogeneous fog enclosing the camera, lit by a lamp behind two pillars (light shafts).',
    body, { camera: [0, 1.6, 6], rotateX: -4 });
}

/** Dispersive prism lit through a slit (caustic on the floor) and backlit subsurface slabs at three scales. */
function opticsScene() {
  const mat = name => `        def Material "${name}" (
            prepend references = @./effects.mtlx@</MaterialX/Materials/${name}>
        )
        {
        }
`;
  const cube = (name, center, size, material) => {
    const [x, y, z] = center, [hx, hy, hz] = size.map(value => value / 2);
    const points = [];
    for (let corner = 0; corner < 8; corner++) points.push(tuple([x + (corner & 1 ? hx : -hx), y + (corner & 2 ? hy : -hy), z + (corner & 4 ? hz : -hz)]));
    return `    def Mesh "${name}"
    {
        int[] faceVertexCounts = [4, 4, 4, 4, 4, 4]
        int[] faceVertexIndices = [0, 2, 3, 1, 4, 5, 7, 6, 0, 1, 5, 4, 2, 6, 7, 3, 0, 4, 6, 2, 1, 3, 7, 5]
        point3f[] points = ${list(points)}
        rel material:binding = </World/Looks/${material}>
    }`;
  };
  // Equilateral prism along Z: apex up, base on the floor.
  const side = 1.2, height = side * Math.sqrt(3) / 2, depth = 1.6, px = -1.4;
  const tri = [[px - side / 2, 0.02], [px + side / 2, 0.02], [px, 0.02 + height]];
  const prismPoints = [...tri.map(([x, y]) => tuple([x, y, -depth / 2])), ...tri.map(([x, y]) => tuple([x, y, depth / 2]))];
  const body = `${looks().replace(/\n    }$/, '\n' + ['prism', 'sss_fine', 'sss_medium', 'sss_coarse'].map(mat).join('') + '    }')}

${FLOOR.replace('/World/Looks/white', '/World/Looks/white')}

    def Mesh "Prism"
    {
        int[] faceVertexCounts = [3, 3, 4, 4, 4]
        int[] faceVertexIndices = [0, 2, 1, 3, 4, 5, 0, 1, 4, 3, 1, 2, 5, 4, 2, 0, 3, 5]
        point3f[] points = ${list(prismPoints)}
        rel material:binding = </World/Looks/prism>
    }

    def Mesh "Mask"
    {
        int[] faceVertexCounts = [4, 4, 4, 4]
        int[] faceVertexIndices = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]
        point3f[] points = [(-3.2, 0, -3), (-3.2, 0, 3), (-3.2, 0.45, 3), (-3.2, 0.45, -3), (-3.2, 0.6, -3), (-3.2, 0.6, 3), (-3.2, 3, 3), (-3.2, 3, -3), (-3.2, 0.45, -3), (-3.2, 0.45, -0.6), (-3.2, 0.6, -0.6), (-3.2, 0.6, -3), (-3.2, 0.45, 0.6), (-3.2, 0.45, 3), (-3.2, 0.6, 3), (-3.2, 0.6, 0.6)]
        rel material:binding = </World/Looks/white>
    }

${cube('SubsurfaceFine', [0.9, 0.4, 0.9], [0.7, 0.8, 0.12], 'sss_fine')}

${cube('SubsurfaceMedium', [1.9, 0.4, 0.9], [0.7, 0.8, 0.12], 'sss_medium')}

${cube('SubsurfaceCoarse', [2.9, 0.4, 0.9], [0.7, 0.8, 0.12], 'sss_coarse')}

    def Scope "Lights"
    {
        def SphereLight "Beam"
        {
            double3 xformOp:translate = (-5.5, 0.75, 0)
            uniform token[] xformOpOrder = ["xformOp:translate"]
            color3f inputs:color = (1, 1, 1)
            float inputs:intensity = 60
            bool inputs:normalize = false
            float inputs:radius = 0.25
        }
${[0.9, 1.9, 2.9].map((x, index) => `        def SphereLight "Back${index}"
        {
            double3 xformOp:translate = (${x}, 0.2, 0.2)
            uniform token[] xformOpOrder = ["xformOp:translate"]
            color3f inputs:color = (1, 0.95, 0.9)
            float inputs:intensity = 200
            bool inputs:normalize = false
            float inputs:radius = 0.12
        }`).join('\n')}
        def SphereLight "Fill"
        {
            double3 xformOp:translate = (2, 4, 5)
            uniform token[] xformOpOrder = ["xformOp:translate"]
            color3f inputs:color = (0.9, 0.95, 1)
            float inputs:intensity = 2
            bool inputs:normalize = false
            float inputs:radius = 1
        }
    }`;
  return stage('Priority-6 control: dispersive prism caustic through a slit (spectral dispersion) and backlit subsurface slabs from millimetre to decimetre scale.',
    body, { camera: [0.2, 3.6, 6.5], rotateX: -28 });
}

await writeFile(new URL('../scenes/bench/hair_particles.usda', import.meta.url), hairScene());
await writeFile(new URL('../scenes/bench/optics.usda', import.meta.url), opticsScene());
await writeFile(new URL('../scenes/bench/volumes.usda', import.meta.url), await volumeScene());
await writeFile(new URL('../scenes/bench/volumes/fog.mtlx', import.meta.url), `<?xml version="1.0"?>
<materialx version="1.39" colorspace="lin_rec709">
  <anisotropic_vdf name="vdf" type="VDF">
    <input name="absorption" type="vector3" value="0.01, 0.01, 0.01" />
    <input name="scattering" type="vector3" value="0.06, 0.06, 0.06" />
    <input name="anisotropy" type="float" value="0.4" />
  </anisotropic_vdf>
  <volume name="volume_shader" type="volumeshader">
    <input name="vdf" type="VDF" nodename="vdf" />
  </volume>
  <surfacematerial name="fog" type="material">
    <input name="volumeshader" type="volumeshader" nodename="volume_shader" />
  </surfacematerial>
</materialx>
`);
await writeFile(new URL('../scenes/bench/fog.usda', import.meta.url), fogScene());
console.log('Wrote scenes/bench/{hair_particles,volumes,fog}.usda and scenes/bench/volumes/*');
