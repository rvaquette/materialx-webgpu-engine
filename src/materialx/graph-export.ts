import { AssetResolver } from '../assets/resolver.ts';
import type { TextureExportSource } from '../assets/images.ts';
import type { ResolvedGraph, ResolvedInput, ResolvedNode } from './graph.ts';
import type { BakedMap, BakedMaterialMaps } from './bake.ts';

const namePattern = /^[A-Za-z_][A-Za-z0-9_]*$/;
const framePattern = /\{(?:frame|0([1-9]\d*)frame)\}/g;
const tokenPattern = /\[([A-Za-z_][A-Za-z0-9_]*)\]/g;
const maxExportFiles = 10_000;
const normalizeSubstitutions = (value: string) => value.replace(/%3c/gi, '<').replace(/%3e/gi, '>')
  .replace(/%5b/gi, '[').replace(/%5d/gi, ']').replace(/%7b/gi, '{').replace(/%7d/gi, '}')
  .replace(/<udim>/gi, '<UDIM>');
const replaceTokens = (value: string, tokens: Readonly<Record<string, string>>) =>
  normalizeSubstitutions(value).replace(tokenPattern, (_, name: string) =>
    Object.hasOwn(tokens, name) ? tokens[name]! : `[${name}]`);
const escapeAttribute = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
  .replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\t/g, '&#9;').replace(/\n/g, '&#10;').replace(/\r/g, '&#13;');

interface PlannedTexture {
  source: string;
  path: string;
  tokens: Readonly<Record<string, string>>;
  exportTokens: Readonly<Record<string, string>>;
  udim: boolean;
  sequence: boolean;
  frames: Set<number>;
  location: string;
}

export type TextureSourceResolver = (file: string) => TextureExportSource | undefined;
const surfaceDefinitions = new Map([
  ['standard_surface', ['ND_standard_surface_surfaceshader', 'ND_standard_surface_surfaceshader_100']],
  ['open_pbr_surface', ['ND_open_pbr_surface_surfaceshader']],
]);
const proceduralVariants = new Map([
  ['add', ['float', 'color3', 'color3FA']],
  ['subtract', ['float', 'color3', 'color3FA']],
  ['multiply', ['float', 'color3', 'color3FA']],
  ['divide', ['float', 'color3', 'color3FA']],
  ['power', ['float', 'color3', 'color3FA']],
  ['absval', ['float', 'color3']],
  ['min', ['float', 'color3', 'color3FA']],
  ['max', ['float', 'color3', 'color3FA']],
  ['clamp', ['float', 'color3', 'color3FA']],
  ['mix', ['float', 'color3']],
  ['noise2d', ['float', 'color3', 'color3FA']],
  ['checkerboard', ['color3']],
  ['texcoord', ['vector2']],
  ['place2d', ['vector2']],
  ['rotate2d', ['vector2']],
]);

function isExportableProcedure(node: ResolvedNode): boolean {
  const definition = node.nodeDef;
  return !!definition && definition.nodeString === node.category && definition.type === node.type
    && (proceduralVariants.get(node.category)?.some(variant =>
      node.type === variant.replace(/FA$/, '') && definition.name === `ND_${node.category}_${variant}`) ?? false);
}

export function exportSurfaceGraph(graph: ResolvedGraph, material: string) {
  const terminals = graph.terminals.filter(terminal => terminal.nodeId);
  const terminal = terminals[0];
  if (graph.lamaSurface || terminals.length !== 1 || terminal?.name !== 'surfaceshader' || terminal.type !== 'surfaceshader') {
    throw new Error('L’export prend uniquement en charge un terminal de surface, sans volume, déplacement ni assemblage LamaSurface.');
  }
  const root = graph.nodes.get(terminal.nodeId!);
  if (!root || root.type !== 'surfaceshader' || !root.nodeDef
    || !surfaceDefinitions.get(root.category)?.includes(root.nodeDef.name)) {
    throw new Error('L’export prend en charge les surfaces MaterialX standard_surface et open_pbr_surface, pas les shaders USD.');
  }
  const usedNames = new Set<string>();
  const names = new Map<string, string>();
  const visiting = new Set<string>();
  const lines: string[] = [];
  const textures = new Map<string, string>();
  const texturePlans = new Map<string, PlannedTexture>();
  const textureNames = new Set<string>();
  const tokenNames = new Map<string, string>();
  const outputTokens = new Map<string, string>();
  const interfaces = new Map<string, { name: string; type: string; binding: string; signature: string }>();
  function uniqueName(raw: string): string {
    const base = (raw.replace(/[^A-Za-z0-9_]/g, '_').replace(/^([0-9])/, '_$1')) || 'Material';
    let name = base;
    for (let suffix = 2; usedNames.has(name); suffix++) name = `${base}_${suffix}`;
    usedNames.add(name);
    return name;
  }
  const materialName = uniqueName(material);

  function texturePath(input: ResolvedInput, location: string): PlannedTexture {
    if (input.source.kind !== 'value') throw new Error(`Fichier de texture non résolu : ${location}.`);
    const raw = input.source.value;
    const url = raw && URL.canParse(raw, 'https://material-export.invalid/')
      ? new URL(raw, 'https://material-export.invalid/') : undefined;
    if (!url || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || /[$#]|%24|%23/i.test(raw)) {
      throw new Error(`Référence de texture non exportable : ${location}.`);
    }
    const template = normalizeSubstitutions(url.pathname);
    const unrecognized = template.replace(/<UDIM>/g, '').replace(framePattern, '').replace(tokenPattern, '');
    if (/[<>{}\[\]]/.test(unrecognized)
      || /[<>{}\[\]]|%3c|%3e|%5b|%5d|%7b|%7d/i.test(url.search + url.hash)) {
      throw new Error(`Substitution de texture non résolue : ${location}.`);
    }
    const tokens: Record<string, string> = Object.create(null);
    for (const match of template.matchAll(tokenPattern)) {
      const name = match[1]!;
      const value = input.filenameTokens && Object.hasOwn(input.filenameTokens, name) ? input.filenameTokens[name] : undefined;
      if (!value || !/^[A-Za-z0-9._-]+$/.test(value) || value === '.' || value === '..') {
        throw new Error(`Jeton de texture [${name}] non résolu ou non portable : ${location}.`);
      }
      tokens[name] = value;
    }
    const resolved = replaceTokens(template, tokens);
    const leaf = resolved.split('/').at(-1) ?? '';
    const extension = /\.(png|jpe?g|webp|exr|hdr|tiff?|tga|bmp)$/i.exec(leaf);
    if (!extension) throw new Error(`Format de texture non exportable : ${location}.`);
    const sequence = [...template.matchAll(framePattern)];
    if (sequence.some(match => match[1] !== undefined && Number(match[1]) > 16)) {
      throw new Error(`Précision de séquence non exportable : ${location}.`);
    }
    const udimCount = (template.match(/<UDIM>/g) ?? []).length;
    if (udimCount > 1) throw new Error(`Substitution UDIM répétée : ${location}.`);
    const tokenScope = (name: string) => input.filenameTokenScopes && Object.hasOwn(input.filenameTokenScopes, name)
      ? input.filenameTokenScopes[name]! : location;
    const tokenIdentities = Object.entries(tokens).sort().map(([name, value]) => [name, value, tokenScope(name)]);
    const key = `${URL.canParse(raw) ? 'absolute' : 'relative'}\0${normalizeSubstitutions(url.href)}\0${JSON.stringify(tokenIdentities)}`;
    const existing = texturePlans.get(key);
    if (existing) return existing;

    let path: string;
    const exportTokens: Record<string, string> = Object.create(null);
    if (udimCount || sequence.length || Object.keys(tokens).length) {
      const renamed = template.replace(tokenPattern, (_, name: string) => {
        const identity = `${tokenScope(name)}\0${name}\0${tokens[name]}`;
        let outputName = tokenNames.get(identity);
        if (!outputName) {
          outputName = uniqueName(name);
          tokenNames.set(identity, outputName);
          outputTokens.set(outputName, tokens[name]!);
        }
        exportTokens[outputName] = tokens[name]!;
        return `[${outputName}]`;
      });
      const segments = renamed.split('/');
      const first = segments.findIndex(segment => /<UDIM>|\{|\[/.test(segment));
      const suffix = segments.slice(first < 0 ? segments.length - 1 : first).map(segment =>
        segment.replace(/(<UDIM>|\{(?:frame|0[1-9]\d*frame)\}|\[[A-Za-z_][A-Za-z0-9_]*\])|[^A-Za-z0-9._-]/g,
          (match, placeholder: string | undefined) => placeholder ?? (/[A-Za-z0-9._-]/.test(match) ? match : '_')));
      if (suffix.some(segment => !segment || segment === '.' || segment === '..' || segment.length > 200)) {
        throw new Error(`Chemin de texture non portable : ${location}.`);
      }
      path = `textures/texture_${texturePlans.size + 1}/${suffix.join('/')}`;
    } else {
      const safeLeaf = leaf.replace(/[^A-Za-z0-9._-]/g, '_');
      const stem = safeLeaf.slice(0, extension.index).replace(/^[.-]+|[.]+$/g, '').slice(0, 100) || 'image';
      const base = /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(stem) ? `image_${stem}` : stem;
      const suffix = extension[0].toLowerCase();
      path = `textures/${base}${suffix}`;
      for (let i = 2; textureNames.has(path.toLowerCase()); i++) path = `textures/${base}_${i}${suffix}`;
      textureNames.add(path.toLowerCase());
    }
    const plan: PlannedTexture = {
      source: raw, path, tokens, exportTokens, udim: udimCount === 1, sequence: sequence.length > 0,
      frames: new Set(), location,
    };
    texturePlans.set(key, plan);
    const fetchRef = replaceTokens(raw, tokens);
    textures.set(URL.canParse(fetchRef) ? new URL(fetchRef).href : fetchRef, path);
    return plan;
  }

  function literal(input: ResolvedInput | undefined, location: string, seen = new Set<string>()): ResolvedInput {
    if (!input || input.source.kind === 'interface' || input.source.kind === 'default') {
      throw new Error(`Valeur de texture non résolue : ${location}.`);
    }
    if (input.source.kind === 'value') return input;
    const upstream = graph.nodes.get(input.source.nodeId);
    if (!upstream || seen.has(upstream.id) || upstream.category !== 'constant' || upstream.type !== input.type
      || (input.source.output !== undefined && input.source.output !== 'out')) {
      throw new Error(`Valeur de texture dynamique non résolue : ${location}.`);
    }
    seen.add(upstream.id);
    return literal(upstream.inputs.find(candidate => candidate.name === 'value'), location, seen);
  }

  function collectTextureInputs(node: ResolvedNode): void {
    const files = node.inputs.filter(input => input.type === 'filename' && /^file(?:[xyz])?$/.test(input.name));
    const requiredFile = ['image', 'tiledimage', 'hextiledimage', 'latlongimage'].includes(node.category)
      && node.nodeDef?.name === `ND_${node.category}_${node.type}`;
    if (requiredFile && !files.some(input => input.name === 'file')) {
      throw new Error(`Fichier de texture non résolu : ${node.id}.`);
    }
    for (const input of files) {
      if (input.source.kind === 'default' && !requiredFile) {
        if (node.nodeDef?.inputs?.find(definition => definition.name === input.name)?.value) {
          throw new Error(`Fichier de texture par défaut non exportable : ${node.id}.${input.name}.`);
        }
        continue;
      }
      const plan = texturePath(literal(input, `${node.id}.${input.name}`), `${node.id}.${input.name}`);
      if (!plan.sequence) continue;
      const range = literal(node.inputs.find(candidate => candidate.name === 'framerange'), `${node.id}.framerange`);
      if (range.source.kind !== 'value') throw new Error(`Plage de séquence non résolue : ${node.id}.`);
      const match = /^\s*(-?\d+)\s*-\s*(-?\d+)\s*$/.exec(range.source.value);
      const first = Number(match?.[1]);
      const last = Number(match?.[2]);
      if (!match || !Number.isSafeInteger(first) || !Number.isSafeInteger(last) || first > last
        || last - first + 1 > maxExportFiles) {
        throw new Error(`Plage de séquence invalide ou non bornée : ${node.id}.framerange.`);
      }
      for (let frame = first; frame <= last; frame++) plan.frames.add(frame);
      if (plan.frames.size > maxExportFiles) throw new Error(`Trop d’images dans la séquence : ${node.id}.`);
    }
  }

  function visit(id: string): string {
    if (visiting.has(id)) throw new Error(`Connexion cyclique : ${id}.`);
    const previous = names.get(id);
    if (previous !== undefined) return previous;
    const node = graph.nodes.get(id);
    if (!node) throw new Error(`Nœud connecté introuvable : ${id}.`);
    const isConstant = node.category === 'constant' && (node.type === 'float' || node.type === 'color3')
      && (!node.nodeDef || node.nodeDef.name === `ND_constant_${node.type}`);
    const hasNodeDef = node.nodeDef?.nodeString === node.category && node.nodeDef.type === node.type;
    if (!namePattern.test(node.category)
      || node !== root && !isConstant && !isExportableProcedure(node) && !hasNodeDef) {
      throw new Error(`Nœud non pris en charge par l’export : ${id} (${node.category}).`);
    }
    const name = uniqueName(id);
    names.set(id, name);
    visiting.add(id);
    collectTextureInputs(node);
    const inputs: string[] = [];
    for (const input of node.inputs) {
      const { source } = input;
      const location = `${id}.${input.name}`;
      if (source.kind === 'interface') throw new Error(`Interface non résolue : ${location}.`);
      if (source.kind === 'default') continue;
      const declaredType = isConstant ? (input.name === 'value' ? node.type : undefined)
        : node.nodeDef?.inputs?.find(definition => definition.name === input.name)?.type;
      if (!namePattern.test(input.name) || !namePattern.test(input.type) || input.type !== declaredType) {
        throw new Error(`Entrée non prise en charge : ${location} (${input.type}).`);
      }
      let binding: string;
      if (source.kind === 'connection') {
        const upstream = visit(source.nodeId);
        const upstreamNode = graph.nodes.get(source.nodeId)!;
        const outputName = source.output ?? 'out';
        const output = upstreamNode.nodeDef?.outputs?.find(candidate => candidate.name === outputName)
          ?? (!upstreamNode.nodeDef?.outputs?.length && outputName === 'out'
            ? { name: 'out', type: upstreamNode.type } : undefined);
        if (!output || output.type !== input.type) {
          throw new Error(`Connexion non prise en charge : ${location}.`);
        }
        binding = `nodename="${upstream}"${outputName === 'out' ? '' : ` output="${escapeAttribute(outputName)}"`}`;
      } else {
        const value = input.type === 'filename' ? texturePath(input, location).path : source.value;
        binding = `value="${escapeAttribute(value)}"`;
      }
      if (input.interfaceName) {
        const scope = id.includes('/') ? id.slice(0, id.lastIndexOf('/')) : '';
        const key = `${scope}\0${input.interfaceName}`;
        const signature = JSON.stringify([input.type, source, input.filenameTokens, input.filenameTokenScopes]);
        let parameter = interfaces.get(key);
        if (parameter && parameter.signature !== signature) {
          throw new Error(`Interface incohérente : ${location}.`);
        }
        if (!parameter) {
          parameter = { name: uniqueName(input.interfaceName), type: input.type, binding, signature };
          interfaces.set(key, parameter);
        }
        binding = `interfacename="${parameter.name}"`;
      }
      const metadata = [['colorspace', input.colorSpace], ['unit', input.unit], ['unittype', input.unitType]]
        .map(([key, value]) => value === undefined ? '' : ` ${key}="${escapeAttribute(value)}"`).join('');
      inputs.push(`    <input name="${input.name}" type="${input.type}" ${binding}${metadata} />`);
    }
    visiting.delete(id);
    const definition = node.nodeDef ? ` nodedef="${escapeAttribute(node.nodeDef.name)}"` : '';
    lines.push(`  <${node.category} name="${name}" type="${node.type}"${definition}>`, ...inputs, `  </${node.category}>`);
    return name;
  }

  const rootName = visit(root.id);
  for (const plan of texturePlans.values()) {
    if (plan.sequence && !plan.frames.size) throw new Error(`Plage de séquence non résolue : ${plan.location}.`);
  }
  const graphName = interfaces.size || outputTokens.size ? uniqueName('MaterialGraph') : undefined;
  const graphOutput = graphName ? uniqueName('surface_out') : undefined;
  const graphLines = graphName ? [
    `  <nodegraph name="${graphName}">`,
    ...[...outputTokens].map(([name, value]) => `    <token name="${name}" type="string" value="${escapeAttribute(value)}" />`),
    ...[...interfaces.values()].map(({ name, type, binding }) => `    <input name="${name}" type="${type}" ${binding} />`),
    ...lines.map(line => `  ${line}`),
    `    <output name="${graphOutput}" type="surfaceshader" nodename="${rootName}" />`,
    '  </nodegraph>',
  ] : lines;
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<materialx version="1.39" colorspace="lin_rec709">',
    ...graphLines,
    `  <surfacematerial name="${materialName}" type="material">`,
    graphName
      ? `    <input name="surfaceshader" type="surfaceshader" nodegraph="${graphName}" output="${graphOutput}" />`
      : `    <input name="surfaceshader" type="surfaceshader" nodename="${rootName}" />`,
    '  </surfacematerial>',
    '</materialx>',
    '',
  ].join('\n');
  return { filename: `${materialName}.mtlx`, xml, textures, texturePlans: [...texturePlans.values()] };
}

function expandFrame(value: string, frame: number): string {
  return normalizeSubstitutions(value).replace(framePattern, (_, width: string | undefined) => {
    if (!width) return String(frame);
    const digits = String(Math.abs(frame)).padStart(Math.max(0, Number(width) - (frame < 0 ? 1 : 0)), '0');
    return frame < 0 ? `-${digits}` : digits;
  });
}

export async function makeMaterialExport(
  graph: ResolvedGraph, material: string, fetchTexture = fetch, resolveSource?: TextureSourceResolver,
) {
  const { filename, xml, texturePlans } = exportSurfaceGraph(graph, material);
  if (!texturePlans.length) return { filename, blob: new Blob([xml], { type: 'application/xml;charset=utf-8' }) };

  const requests = new Map<string, { path: string; urls: string[]; plan: PlannedTexture }>();
  for (const plan of texturePlans) {
    const source = resolveSource?.(plan.source) ?? { urls: [plan.source] };
    if (!source.urls.length) throw new Error(`Fichiers originaux indisponibles : ${plan.location}.`);
    if (plan.sequence && source.urls.some(url => ![...normalizeSubstitutions(url).matchAll(framePattern)].length)) {
      throw new Error(`Référence de séquence originale indisponible : ${plan.location}.`);
    }

    const frames: (number | undefined)[] = plan.sequence ? [...plan.frames].sort((a, b) => a - b) : [undefined];
    for (const frame of frames) {
      const expand = (value: string, tokens: Readonly<Record<string, string>>) => {
        const replaced = replaceTokens(value, tokens);
        return frame === undefined ? replaced : expandFrame(replaced, frame);
      };
      const candidates = source.urls.map(url => expand(url, plan.tokens));
      const output = expand(plan.path, plan.exportTokens);
      const logical = expand(plan.source, plan.tokens);
      let tiles: readonly number[] = [];
      if (plan.udim) {
        if (candidates.some(url => !AssetResolver.hasUdim(url))) {
          throw new Error(`Référence UDIM originale indisponible : ${plan.location}.`);
        }
        tiles = resolveSource?.(logical)?.tiles
          ?? resolveSource?.(candidates[0]!)?.tiles
          ?? source.tiles ?? [];
        if (!tiles.length) throw new Error(`Aucune tuile UDIM inventoriée : ${plan.location}.`);
        if (new Set(tiles).size !== tiles.length || tiles.some(tile => !Number.isInteger(tile) || tile < 1001 || tile > 1999)) {
          throw new Error(`Inventaire UDIM invalide : ${plan.location}.`);
        }
      }
      for (const tile of plan.udim ? tiles : [undefined]) {
        const path = tile === undefined ? output : AssetResolver.expandUdim(output, tile);
        const urls = candidates.map(url => tile === undefined ? url : AssetResolver.expandUdim(url, tile));
        if (!/^textures\/[A-Za-z0-9._/-]+$/.test(path)
          || path.split('/').some(segment => !segment || segment === '.' || segment === '..'
            || segment.length > 255 || segment.endsWith('.')
            || /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(segment))) {
          throw new Error(`Chemin de texture non portable : ${plan.location}.`);
        }
        for (const candidate of urls) {
          if (!URL.canParse(candidate)) throw new Error(`URL de texture non résolue : ${plan.location}.`);
          const url = new URL(candidate);
          if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
            || /[<>{}\[\]]|%3c|%3e|%5b|%5d|%7b|%7d/i.test(url.pathname)) {
            throw new Error(`URL de texture non résolue : ${plan.location}.`);
          }
        }
        const key = path.toLowerCase();
        const previous = requests.get(key);
        if (previous && JSON.stringify(previous.urls) !== JSON.stringify(urls)) {
          throw new Error(`Collision de textures : ${path}.`);
        }
        if (!previous) requests.set(key, { path, urls, plan });
        if (requests.size > maxExportFiles) throw new Error('Trop de fichiers de texture pour cet export.');
      }
    }
  }

  const { zipSync, strToU8 } = await import('three/addons/libs/fflate.module.js');
  const files: Record<string, Uint8Array> = { [filename]: strToU8(xml) };
  const fetched = new Map<string, Uint8Array>();
  const selectedSources = new Map<PlannedTexture, number>();
  let remaining = 64 * 1024 * 1024;
  for (const { urls, path, plan } of requests.values()) {
    try {
      let response: Response | undefined;
      let selected = urls[0]!;
      let selectedIndex = selectedSources.get(plan);
      let bytes: Uint8Array | undefined;
      const indices = selectedIndex === undefined ? urls.map((_, index) => index) : [selectedIndex];
      for (const [position, index] of indices.entries()) {
        const url = urls[index]!;
        selected = url;
        selectedIndex = index;
        bytes = fetched.get(url);
        if (bytes) break;
        response = await fetchTexture(url);
        if (response.status !== 404 || position === indices.length - 1) break;
        await response.body?.cancel();
      }
      if (selectedIndex === undefined) throw new Error('aucune source disponible');
      if (bytes) {
        if (bytes.byteLength > remaining) throw new Error('limite totale de 64 Mio dépassée');
        remaining -= bytes.byteLength;
        selectedSources.set(plan, selectedIndex);
        files[path] = bytes;
        continue;
      }
      if (!response) throw new Error('aucune source disponible');
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`HTTP ${response.status}`);
      }
      if (!response.body || /\b(?:html|json)\b/i.test(response.headers.get('content-type') ?? '')) {
        await response.body?.cancel();
        throw new Error('la réponse n’est pas une image');
      }
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value.byteLength > remaining - size) {
            await reader.cancel();
            throw new Error('limite totale de 64 Mio dépassée');
          }
          size += value.byteLength;
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
      if (!size) throw new Error('fichier vide');
      bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      remaining -= size;
      selectedSources.set(plan, selectedIndex);
      fetched.set(selected, bytes);
      files[path] = bytes;
    } catch (error) {
      throw new Error(`Impossible d’inclure ${path} : ${error instanceof Error ? error.message : String(error)}.`);
    }
  }
  const zip = zipSync(files, { level: 0 });
  return { filename: filename.replace(/\.mtlx$/, '.zip'), blob: new Blob([zip], { type: 'application/zip' }) };
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length + 12);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  let crc = 0xffffffff;
  for (let i = 4; i < data.length + 8; i++) {
    crc ^= out[i]!;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  view.setUint32(data.length + 8, (crc ^ 0xffffffff) >>> 0);
  return out;
}

function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
  const output = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function encodeBakedPng(
  map: BakedMap,
  width: number,
  height: number,
  zlibSync: typeof import('three/addons/libs/fflate.module.js').zlibSync,
  options: { srgb?: boolean; heightRange?: readonly [number, number] } = {},
): Uint8Array {
  const colorType = map.channels === 1 ? 0 : map.channels === 3 ? 2 : 6;
  const rowLength = width * map.channels;
  const raw = new Uint8Array(height * (rowLength + 1));
  const [heightMin, heightMax] = options.heightRange ?? [0, 0];
  for (let y = 0; y < height; y++) {
    const row = y * (rowLength + 1);
    raw[row] = 0;
    for (let x = 0; x < rowLength; x++) {
      const source = y * rowLength + x;
      let value = map.data[source] ?? 0;
      if (options.heightRange && heightMax > heightMin) value = (value - heightMin) / (heightMax - heightMin);
      if (options.srgb && x % 4 < 3) {
        value = value <= 0.0031308 ? value * 12.92 : 1.055 * Math.pow(Math.max(0, value), 1 / 2.4) - 0.055;
      }
      raw[row + 1 + x] = Math.round(Math.min(1, Math.max(0, value)) * 255);
    }
  }
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = 8;
  header[9] = colorType;
  return concatBytes([
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlibSync(raw)),
    pngChunk('IEND', new Uint8Array()),
  ]);
}

function safeMaterialName(name: string): string {
  const normalized = name.replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'BakedMaterial';
  return /^[A-Za-z_]/.test(normalized) ? normalized : `M_${normalized}`;
}

/** Creates a portable ZIP containing a baked MaterialX material and its five maps. */
export async function makeBakedMaterialExport(
  baked: BakedMaterialMaps,
  name: string,
): Promise<{ filename: string; blob: Blob }> {
  const { zipSync, strToU8, zlibSync } = await import('three/addons/libs/fflate.module.js');
  const png = (map: BakedMap, options?: { srgb?: boolean; heightRange?: readonly [number, number] }) =>
    encodeBakedPng(map, baked.width, baked.height, zlibSync, options);
  const material = safeMaterialName(name);
  const heightDelta = baked.heightRange[1] - baked.heightRange[0];
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<materialx version="1.39" colorspace="lin_rec709">',
    '  <image name="base_color_map" type="color3" colorspace="srgb_texture"><input name="file" type="filename" value="textures/baseColor.png" /></image>',
    '  <image name="roughness_map" type="float"><input name="file" type="filename" value="textures/roughness.png" /></image>',
    '  <image name="metalness_map" type="float"><input name="file" type="filename" value="textures/metalness.png" /></image>',
    '  <image name="normal_image" type="vector3"><input name="file" type="filename" value="textures/normal.png" /></image>',
    '  <normalmap name="normal_map" type="vector3"><input name="in" type="vector3" nodename="normal_image" /></normalmap>',
    '  <image name="height_map" type="float"><input name="file" type="filename" value="textures/height.png" /></image>',
    `  <multiply name="height_scaled" type="float"><input name="in1" type="float" nodename="height_map" /><input name="in2" type="float" value="${heightDelta}" /></multiply>`,
    `  <add name="height_offset" type="float"><input name="in1" type="float" nodename="height_scaled" /><input name="in2" type="float" value="${baked.heightRange[0]}" /></add>`,
    '  <standard_surface name="surface" type="surfaceshader">',
    '    <input name="base_color" type="color3" nodename="base_color_map" />',
    '    <input name="specular_roughness" type="float" nodename="roughness_map" />',
    '    <input name="metalness" type="float" nodename="metalness_map" />',
    '    <input name="normal" type="vector3" nodename="normal_map" />',
    '  </standard_surface>',
    '  <displacement name="displacement_shader" type="displacementshader"><input name="displacement" type="float" nodename="height_offset" /></displacement>',
    `  <surfacematerial name="${material}" type="material"><input name="surfaceshader" type="surfaceshader" nodename="surface" /><input name="displacementshader" type="displacementshader" nodename="displacement_shader" /></surfacematerial>`,
    '</materialx>',
    '',
  ].join('\n');
  const files = {
    [`${material}.mtlx`]: strToU8(xml),
    'textures/baseColor.png': png(baked.baseColor, { srgb: true }),
    'textures/roughness.png': png(baked.roughness),
    'textures/metalness.png': png(baked.metalness),
    'textures/normal.png': png(baked.normal),
    'textures/height.png': png(baked.heightMap, { heightRange: baked.heightRange }),
  };
  return { filename: `${material}.baked.zip`, blob: new Blob([zipSync(files, { level: 6 })], { type: 'application/zip' }) };
}
