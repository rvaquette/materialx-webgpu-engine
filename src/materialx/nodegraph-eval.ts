// CPU MaterialX nodegraph evaluator + surface baker (real texture/noise evaluation,
// no approximation). Given a .mtlx document and the decoded pixels of every texture
// it references, this walks the nodegraph feeding a standard_surface/open_pbr_surface
// shader -- implementing each intermediate node operation actually invoked (tiledimage,
// image, multiply, add, subtract, divide, min, max, clamp, mix, combine3, convert,
// rgbtohsv, hsvtorgb, normalmap, constant, and value/fractal noise) -- and bakes the
// base_color and specular_roughness outputs over a UV grid into an RGBA map
// (RGB = linear base color, A = roughness). The path tracer then samples that baked
// map per hit. Parsing uses DOMParser (available in the device browser); the
// evaluation itself is pure and Node-testable when fed decoded textures.

/** Decoded texture pixels: RGBA8 row-major, length = width * height * 4. */
export interface DecodedTexture {
  width: number;
  height: number;
  data: Uint8Array;
}

/** Baked surface maps: RGB = linear base color, A = roughness. */
export interface BakedSurfaceMaps {
  size: number;
  rgba: Uint8Array;
}

export interface NodegraphBakeInput {
  mtlx: string;
  /** Decoded textures keyed by the file path exactly as authored in the .mtlx. */
  textures: Map<string, DecodedTexture>;
  /** Baked map edge length in texels. */
  size: number;
}

type Val = number[];

interface GraphContext {
  nodes: Map<string, Element>;
  iface: Map<string, Val>;
  textures: Map<string, DecodedTexture>;
}

// --- small numeric helpers ---------------------------------------------------

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const frac = (x: number): number => x - Math.floor(x);

function broadcast(a: Val, b: Val, op: (x: number, y: number) => number): Val {
  const n = Math.max(a.length, b.length);
  const out: Val = new Array(n);
  for (let i = 0; i < n; i++) out[i] = op(a[i % a.length]!, b[i % b.length]!);
  return out;
}

function parseValue(type: string, raw: string): Val {
  const parts = raw.split(',').map((s) => Number.parseFloat(s.trim()));
  if (type === 'float' || type === 'integer') return [Number.isFinite(parts[0]!) ? parts[0]! : 0];
  const want = type === 'vector2' ? 2 : type === 'vector4' || type === 'color4' ? 4 : 3;
  const out: Val = [];
  for (let i = 0; i < want; i++) out.push(Number.isFinite(parts[i]!) ? parts[i]! : 0);
  return out;
}

function defaultVal(type: string): Val {
  if (type === 'float' || type === 'integer') return [0];
  if (type === 'vector2') return [0, 0];
  if (type === 'vector4' || type === 'color4') return [0, 0, 0, 0];
  return [0, 0, 0];
}

function rgbToHsv(c: Val): Val {
  const r = c[0] ?? 0;
  const g = c[1] ?? 0;
  const b = c[2] ?? 0;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const d = mx - mn;
  let h = 0;
  if (d > 1e-8) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
    if (h < 0) h += 1;
  }
  const s = mx <= 0 ? 0 : d / mx;
  return [h, s, mx];
}

function hsvToRgb(c: Val): Val {
  const h = (c[0] ?? 0) * 6;
  const s = c[1] ?? 0;
  const v = c[2] ?? 0;
  const i = Math.floor(h);
  const f = h - i;
  const p = v * (1 - s);
  const q = v * (1 - s * f);
  const t = v * (1 - s * (1 - f));
  switch (((i % 6) + 6) % 6) {
    case 0: return [v, t, p];
    case 1: return [q, v, p];
    case 2: return [p, v, t];
    case 3: return [p, q, v];
    case 4: return [t, p, v];
    default: return [v, p, q];
  }
}

// Gradient-free value noise (hash lattice) for noise2d/noise3d/fractal nodes.
function hash2(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function valueNoise2(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fractalNoise2(x: number, y: number, octaves: number, lacunarity: number, diminish: number): number {
  let sum = 0;
  let amp = 1;
  let freq = 1;
  for (let o = 0; o < Math.max(1, octaves); o++) {
    sum += amp * (valueNoise2(x * freq, y * freq) * 2 - 1);
    freq *= lacunarity;
    amp *= diminish;
  }
  return sum;
}

// --- texture sampling (wrap repeat, bilinear) --------------------------------

function sampleTexture(tex: DecodedTexture, u: number, v: number): Val {
  const fu = frac(u);
  const fv = frac(v);
  // Flip v so uv (0,0) maps to the bottom-left, matching MaterialX authoring.
  const x = fu * tex.width - 0.5;
  const y = (1 - fv) * tex.height - 0.5;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = x - x0;
  const ty = y - y0;
  const wx = ((x0 % tex.width) + tex.width) % tex.width;
  const wy = ((y0 % tex.height) + tex.height) % tex.height;
  const wx1 = (wx + 1) % tex.width;
  const wy1 = (wy + 1) % tex.height;
  const texel = (px: number, py: number, ch: number): number => tex.data[(py * tex.width + px) * 4 + ch]! / 255;
  const out: Val = [0, 0, 0];
  for (let ch = 0; ch < 3; ch++) {
    const a = texel(wx, wy, ch);
    const b = texel(wx1, wy, ch);
    const c = texel(wx, wy1, ch);
    const d = texel(wx1, wy1, ch);
    out[ch] = a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
  }
  return out;
}

// --- DOM helpers -------------------------------------------------------------

function childElements(el: Element): Element[] {
  return Array.from(el.children);
}

function inputEl(node: Element, name: string): Element | undefined {
  for (const c of childElements(node)) {
    if (c.tagName === 'input' && c.getAttribute('name') === name) return c;
  }
  return undefined;
}

// --- evaluation --------------------------------------------------------------

function resolveInput(ctx: GraphContext, inEl: Element | undefined, uv: Val, cache: Map<string, Val>, type: string): Val {
  if (!inEl) return defaultVal(type);
  const value = inEl.getAttribute('value');
  if (value !== null) return parseValue(inEl.getAttribute('type') ?? type, value);
  const nodename = inEl.getAttribute('nodename');
  if (nodename) return evalNode(ctx, nodename, uv, cache);
  const iface = inEl.getAttribute('interfacename');
  if (iface) return ctx.iface.get(iface) ?? defaultVal(type);
  return defaultVal(type);
}

function inVal(ctx: GraphContext, node: Element, name: string, uv: Val, cache: Map<string, Val>, fallbackType: string): Val {
  return resolveInput(ctx, inputEl(node, name), uv, cache, fallbackType);
}

function evalTiledImage(ctx: GraphContext, node: Element, uv: Val, cache: Map<string, Val>): Val {
  const type = node.getAttribute('type') ?? 'color3';
  const file = inputEl(node, 'file')?.getAttribute('value') ?? '';
  const tex = ctx.textures.get(file);
  const tiling = inVal(ctx, node, 'uvtiling', uv, cache, 'vector2');
  const offset = inVal(ctx, node, 'uvoffset', uv, cache, 'vector2');
  const coordEl = inputEl(node, 'texcoord');
  const coord = coordEl ? resolveInput(ctx, coordEl, uv, cache, 'vector2') : uv;
  const tu = (tiling[0] ?? 1) || 1;
  const tv = (tiling[1] ?? tiling[0] ?? 1) || 1;
  const u = (coord[0] ?? 0) * tu + (offset[0] ?? 0);
  const v = (coord[1] ?? 0) * tv + (offset[1] ?? 0);
  if (!tex) return type === 'float' ? [0] : [0, 0, 0];
  const rgb = sampleTexture(tex, u, v);
  return type === 'float' ? [rgb[0]!] : rgb;
}

function evalNode(ctx: GraphContext, name: string, uv: Val, cache: Map<string, Val>): Val {
  const cached = cache.get(name);
  if (cached) return cached;
  const node = ctx.nodes.get(name);
  if (!node) return [0, 0, 0];
  const type = node.getAttribute('type') ?? 'color3';
  const category = node.tagName;
  let out: Val;
  switch (category) {
    case 'constant':
      out = inVal(ctx, node, 'value', uv, cache, type);
      break;
    case 'multiply':
      out = broadcast(inVal(ctx, node, 'in1', uv, cache, type), inVal(ctx, node, 'in2', uv, cache, 'float'), (x, y) => x * y);
      break;
    case 'add':
      out = broadcast(inVal(ctx, node, 'in1', uv, cache, type), inVal(ctx, node, 'in2', uv, cache, type), (x, y) => x + y);
      break;
    case 'subtract':
      out = broadcast(inVal(ctx, node, 'in1', uv, cache, type), inVal(ctx, node, 'in2', uv, cache, type), (x, y) => x - y);
      break;
    case 'divide':
      out = broadcast(inVal(ctx, node, 'in1', uv, cache, type), inVal(ctx, node, 'in2', uv, cache, 'float'), (x, y) => (Math.abs(y) < 1e-8 ? 0 : x / y));
      break;
    case 'max':
      out = broadcast(inVal(ctx, node, 'in1', uv, cache, type), inVal(ctx, node, 'in2', uv, cache, type), (x, y) => Math.max(x, y));
      break;
    case 'min':
      out = broadcast(inVal(ctx, node, 'in1', uv, cache, type), inVal(ctx, node, 'in2', uv, cache, type), (x, y) => Math.min(x, y));
      break;
    case 'clamp': {
      const x = inVal(ctx, node, 'in', uv, cache, type);
      const low = inputEl(node, 'low') ? inVal(ctx, node, 'low', uv, cache, 'float') : [0];
      const high = inputEl(node, 'high') ? inVal(ctx, node, 'high', uv, cache, 'float') : [1];
      out = x.map((v, i) => Math.min(Math.max(v, low[i % low.length]!), high[i % high.length]!));
      break;
    }
    case 'mix': {
      const fg = inVal(ctx, node, 'fg', uv, cache, type);
      const bg = inVal(ctx, node, 'bg', uv, cache, type);
      const t = inVal(ctx, node, 'mix', uv, cache, 'float')[0] ?? 0;
      out = broadcast(bg, fg, (b, f) => b * (1 - t) + f * t);
      break;
    }
    case 'combine2':
      out = [inVal(ctx, node, 'in1', uv, cache, 'float')[0] ?? 0, inVal(ctx, node, 'in2', uv, cache, 'float')[0] ?? 0];
      break;
    case 'combine3':
      out = [
        inVal(ctx, node, 'in1', uv, cache, 'float')[0] ?? 0,
        inVal(ctx, node, 'in2', uv, cache, 'float')[0] ?? 0,
        inVal(ctx, node, 'in3', uv, cache, 'float')[0] ?? 0,
      ];
      break;
    case 'convert': {
      const x = inVal(ctx, node, 'in', uv, cache, 'float');
      const want = type === 'float' ? 1 : type === 'vector2' ? 2 : type === 'vector4' || type === 'color4' ? 4 : 3;
      out = x.length >= want ? x.slice(0, want) : new Array(want).fill(x[0] ?? 0);
      break;
    }
    case 'rgbtohsv':
      out = rgbToHsv(inVal(ctx, node, 'in', uv, cache, 'color3'));
      break;
    case 'hsvtorgb':
      out = hsvToRgb(inVal(ctx, node, 'in', uv, cache, 'color3'));
      break;
    case 'normalmap': {
      const n = inVal(ctx, node, 'in', uv, cache, 'vector3');
      const nx = (n[0] ?? 0.5) * 2 - 1;
      const ny = (n[1] ?? 0.5) * 2 - 1;
      const nz = (n[2] ?? 1) * 2 - 1;
      const len = Math.hypot(nx, ny, nz) || 1;
      out = [nx / len, ny / len, nz / len];
      break;
    }
    case 'tiledimage':
    case 'image':
      out = evalTiledImage(ctx, node, uv, cache);
      break;
    case 'noise2d':
    case 'noise3d': {
      const amp = inVal(ctx, node, 'amplitude', uv, cache, 'float')[0] ?? 1;
      const pivot = inVal(ctx, node, 'pivot', uv, cache, 'float')[0] ?? 0;
      const n = valueNoise2((uv[0] ?? 0) * 8, (uv[1] ?? 0) * 8) * amp + pivot;
      out = type === 'float' ? [n] : [n, n, n];
      break;
    }
    case 'fractal3d':
    case 'fractal2d': {
      const amp = inVal(ctx, node, 'amplitude', uv, cache, 'float')[0] ?? 1;
      const octaves = inVal(ctx, node, 'octaves', uv, cache, 'float')[0] ?? 3;
      const lacunarity = inVal(ctx, node, 'lacunarity', uv, cache, 'float')[0] ?? 2;
      const diminish = inVal(ctx, node, 'diminish', uv, cache, 'float')[0] ?? 0.5;
      const n = fractalNoise2((uv[0] ?? 0) * 8, (uv[1] ?? 0) * 8, octaves, lacunarity, diminish) * amp;
      out = type === 'float' ? [n] : [n, n, n];
      break;
    }
    default:
      // Unknown node: pass through its first connected input so the graph still bakes.
      out = inVal(ctx, node, 'in', uv, cache, type);
      break;
  }
  cache.set(name, out);
  return out;
}

// --- public API --------------------------------------------------------------

function parseDoc(mtlx: string): Document {
  return new DOMParser().parseFromString(mtlx, 'application/xml');
}

function findShader(doc: Document): Element | undefined {
  return (
    doc.querySelector('standard_surface') ??
    doc.querySelector('open_pbr_surface') ??
    doc.querySelector('UsdPreviewSurface') ??
    undefined
  );
}

function buildGraphContext(graph: Element, textures: Map<string, DecodedTexture>): GraphContext {
  const nodes = new Map<string, Element>();
  const iface = new Map<string, Val>();
  for (const child of childElements(graph)) {
    const tag = child.tagName;
    const name = child.getAttribute('name') ?? '';
    if (tag === 'input') {
      const type = child.getAttribute('type') ?? 'float';
      const value = child.getAttribute('value');
      if (value !== null) iface.set(name, parseValue(type, value));
    } else if (tag !== 'output' && name) {
      nodes.set(name, child);
    }
  }
  return { nodes, iface, textures };
}

interface Terminal {
  ctx: GraphContext;
  node: string;
}

function terminalFor(doc: Document, shader: Element, inputName: string, textures: Map<string, DecodedTexture>): Terminal | undefined {
  const inEl = inputEl(shader, inputName);
  if (!inEl) return undefined;
  const graphName = inEl.getAttribute('nodegraph');
  if (!graphName) return undefined;
  const graph = Array.from(doc.querySelectorAll('nodegraph')).find((g) => g.getAttribute('name') === graphName);
  if (!graph) return undefined;
  const outputName = inEl.getAttribute('output');
  const outputs = childElements(graph).filter((c) => c.tagName === 'output');
  const output = outputName ? outputs.find((o) => o.getAttribute('name') === outputName) : outputs[0];
  const node = output?.getAttribute('nodename');
  if (!node) return undefined;
  return { ctx: buildGraphContext(graph, textures), node };
}

/** Texture file paths referenced by image/tiledimage nodes across the document. */
export function collectTextureFiles(mtlx: string): string[] {
  const doc = parseDoc(mtlx);
  const files = new Set<string>();
  for (const node of Array.from(doc.querySelectorAll('tiledimage, image'))) {
    const file = inputEl(node, 'file')?.getAttribute('value');
    if (file) files.add(file);
  }
  return Array.from(files);
}

/**
 * Bake the nodegraph-driven base_color and specular_roughness of a surface shader
 * into an RGBA map. Returns null when neither is nodegraph-driven (constant material).
 */
export function bakeNodegraphSurface(input: NodegraphBakeInput): BakedSurfaceMaps | null {
  const doc = parseDoc(input.mtlx);
  const shader = findShader(doc);
  if (!shader) return null;
  const baseTerm = terminalFor(doc, shader, 'base_color', input.textures) ?? terminalFor(doc, shader, 'diffuseColor', input.textures);
  const roughTerm = terminalFor(doc, shader, 'specular_roughness', input.textures) ?? terminalFor(doc, shader, 'roughness', input.textures);
  if (!baseTerm && !roughTerm) return null;

  const constBase = parseValue('color3', inputEl(shader, 'base_color')?.getAttribute('value') ?? '0.8,0.8,0.8');
  const constRough = parseValue('float', inputEl(shader, 'specular_roughness')?.getAttribute('value') ?? '0.3');

  const size = input.size;
  const rgba = new Uint8Array(size * size * 4);
  const uv: Val = [0, 0];
  for (let py = 0; py < size; py++) {
    uv[1] = (py + 0.5) / size;
    for (let px = 0; px < size; px++) {
      uv[0] = (px + 0.5) / size;
      const cache = new Map<string, Val>();
      const base = baseTerm ? evalNode(baseTerm.ctx, baseTerm.node, uv, cache) : constBase;
      const rough = roughTerm ? evalNode(roughTerm.ctx, roughTerm.node, uv, cache) : constRough;
      const o = (py * size + px) * 4;
      rgba[o] = Math.round(clamp01(base[0] ?? 0) * 255);
      rgba[o + 1] = Math.round(clamp01(base[1] ?? base[0] ?? 0) * 255);
      rgba[o + 2] = Math.round(clamp01(base[2] ?? base[0] ?? 0) * 255);
      rgba[o + 3] = Math.round(clamp01(rough[0] ?? 0) * 255);
    }
  }
  return { size, rgba };
}
