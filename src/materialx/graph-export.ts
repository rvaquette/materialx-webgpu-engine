import type { ResolvedGraph, ResolvedNode } from './graph.ts';

const namePattern = /^[A-Za-z_][A-Za-z0-9_]*$/;
const escapeAttribute = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
  .replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\t/g, '&#9;').replace(/\n/g, '&#10;').replace(/\r/g, '&#13;');
const surfaceDefinitions = new Map([
  ['standard_surface', ['ND_standard_surface_surfaceshader', 'ND_standard_surface_surfaceshader_100']],
  ['open_pbr_surface', ['ND_open_pbr_surface_surfaceshader']],
]);
const literalTypes = new Set(['float', 'integer', 'boolean', 'color3', 'color4', 'vector2', 'vector3', 'vector4']);
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
  const textureNames = new Set<string>();
  function texturePath(raw: string, location: string): string {
    const url = URL.canParse(raw) ? new URL(raw) : undefined;
    const leaf = url?.pathname.split('/').at(-1)?.replace(/[^A-Za-z0-9._-]/g, '_') ?? '';
    const extension = /\.(png|jpe?g|webp|exr|hdr|tiff?|tga|bmp)$/i.exec(leaf);
    if (!url || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || !extension
      || /[<>]|%3c|%3e|\$|%24|#+/i.test(raw)) {
      throw new Error(`Texture statique non exportable : ${location}.`);
    }
    const existing = textures.get(url.href);
    if (existing) return existing;
    const stem = leaf.slice(0, extension.index).replace(/^[.-]+|[.]+$/g, '').slice(0, 100) || 'image';
    const base = /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(stem) ? `image_${stem}` : stem;
    const suffix = extension[0].toLowerCase();
    let path = `textures/${base}${suffix}`;
    for (let i = 2; textureNames.has(path.toLowerCase()); i++) path = `textures/${base}_${i}${suffix}`;
    textureNames.add(path.toLowerCase());
    textures.set(url.href, path);
    return path;
  }
  function uniqueName(raw: string): string {
    const base = (raw.replace(/[^A-Za-z0-9_]/g, '_').replace(/^([0-9])/, '_$1')) || 'Material';
    let name = base;
    for (let suffix = 2; usedNames.has(name); suffix++) name = `${base}_${suffix}`;
    usedNames.add(name);
    return name;
  }
  const materialName = uniqueName(material);

  function visit(id: string): string {
    if (visiting.has(id)) throw new Error(`Connexion cyclique : ${id}.`);
    const previous = names.get(id);
    if (previous !== undefined) return previous;
    const node = graph.nodes.get(id);
    if (!node) throw new Error(`Nœud connecté introuvable : ${id}.`);
    const isConstant = node.category === 'constant' && (node.type === 'float' || node.type === 'color3')
      && (!node.nodeDef || node.nodeDef.name === `ND_constant_${node.type}`);
    const isImage = node.category === 'image' && (node.type === 'float' || node.type === 'color3')
      && node.nodeDef?.name === `ND_image_${node.type}` && node.nodeDef.type === node.type;
    if (node !== root && !isConstant && !isImage && !isExportableProcedure(node)) {
      throw new Error(`Nœud non pris en charge par l’export : ${id} (${node.category}).`);
    }
    if (isImage && node.inputs.find(input => input.name === 'file')?.source.kind !== 'value') {
      throw new Error(`Fichier de texture non résolu : ${id}.`);
    }
    const name = uniqueName(id);
    names.set(id, name);
    visiting.add(id);
    const inputs: string[] = [];
    for (const input of node.inputs) {
      const { source } = input;
      const location = `${id}.${input.name}`;
      if (input.interfaceName || source.kind === 'interface') throw new Error(`Interface non exportable : ${location}.`);
      if (source.kind === 'default') continue;
      const declaredType = isConstant ? (input.name === 'value' ? node.type : undefined)
        : node.nodeDef?.inputs?.find(definition => definition.name === input.name)?.type;
      const imageLiteral = isImage && source.kind === 'value' && (
        input.type === 'filename' && input.name === 'file'
        || input.type === 'string' && ['layer', 'uaddressmode', 'vaddressmode', 'filtertype'].includes(input.name)
      );
      if (!namePattern.test(input.name) || (!literalTypes.has(input.type) && !imageLiteral) || input.type !== declaredType
        || isImage && /^(framerange|frameoffset|frameendaction)$/.test(input.name)) {
        throw new Error(`Entrée non prise en charge : ${location} (${input.type}).`);
      }
      let binding: string;
      if (source.kind === 'connection') {
        const upstream = visit(source.nodeId);
        if (graph.nodes.get(source.nodeId)?.type !== input.type || (source.output !== undefined && source.output !== 'out')) {
          throw new Error(`Connexion non prise en charge : ${location}.`);
        }
        binding = `nodename="${upstream}"`;
      } else {
        const value = input.type === 'filename' ? texturePath(source.value, location) : source.value;
        binding = `value="${escapeAttribute(value)}"`;
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
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<materialx version="1.39" colorspace="lin_rec709">',
    ...lines,
    `  <surfacematerial name="${materialName}" type="material">`,
    `    <input name="surfaceshader" type="surfaceshader" nodename="${rootName}" />`,
    '  </surfacematerial>',
    '</materialx>',
    '',
  ].join('\n');
  return { filename: `${materialName}.mtlx`, xml, textures };
}

export async function makeMaterialExport(graph: ResolvedGraph, material: string, fetchTexture = fetch) {
  const { filename, xml, textures } = exportSurfaceGraph(graph, material);
  if (!textures.size) return { filename, blob: new Blob([xml], { type: 'application/xml;charset=utf-8' }) };

  const { zipSync, strToU8 } = await import('three/addons/libs/fflate.module.js');
  const files: Record<string, Uint8Array> = { [filename]: strToU8(xml) };
  let remaining = 64 * 1024 * 1024;
  for (const [url, path] of textures) {
    try {
      const response = await fetchTexture(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
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
          if (value.byteLength > remaining) {
            await reader.cancel();
            throw new Error('limite totale de 64 Mio dépassée');
          }
          remaining -= value.byteLength;
          size += value.byteLength;
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
      if (!size) throw new Error('fichier vide');
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      files[path] = bytes;
    } catch (error) {
      throw new Error(`Impossible d’inclure ${path} : ${error instanceof Error ? error.message : String(error)}.`);
    }
  }
  const zip = zipSync(files, { level: 0 });
  return { filename: filename.replace(/\.mtlx$/, '.zip'), blob: new Blob([zip], { type: 'application/zip' }) };
}
