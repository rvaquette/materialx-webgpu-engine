import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../scenes/pathtracer/', import.meta.url));
export const defaultLibraryRoot = process.env.MX_LIB_ROOT ?? 'D:\\WebGL2\\MaterialX\\MaterialX-rva\\libraries';
const attributesOf = text => Object.fromEntries([...text.matchAll(/(\w+)="([^"]*)"/g)].map(item => [item[1], item[2]]));

export function surfaceDefaults(libraryRoot) {
  const defaults = new Map();
  for (const family of ['standard_surface', 'open_pbr_surface']) {
    const text = readFileSync(join(libraryRoot, 'bxdf', `${family}.mtlx`), 'utf8');
    const definitions = new Map([...text.matchAll(/<nodedef\b([^>]*)>([\s\S]*?)<\/nodedef>/g)]
      .map(match => {
        const attrs = attributesOf(match[1]);
        return [attrs.name, { attrs, body: match[2] }];
      }));
    const active = new Set();
    const resolveInputs = name => {
      const definition = definitions.get(name);
      if (!definition || active.has(name)) throw new Error(`Invalid NodeDef inheritance: ${name}`);
      active.add(name);
      const inputs = definition.attrs.inherit ? resolveInputs(definition.attrs.inherit) : new Map();
      for (const match of definition.body.matchAll(/<input\b([^>]*)\/>/g)) {
        const attrs = attributesOf(match[1]);
        inputs.delete(attrs.name);
        if (attrs.value !== undefined && !attrs.defaultgeomprop) inputs.set(attrs.name, { type: attrs.type, value: attrs.value });
      }
      active.delete(name);
      return inputs;
    };
    for (const [name, definition] of definitions) {
      if (definition.attrs.node !== family) continue;
      const inputs = resolveInputs(name);
      defaults.set(name, inputs);
      defaults.set(`${family}:${definition.attrs.version}`, inputs);
      if (definition.attrs.isdefaultversion === 'true') defaults.set(family, inputs);
    }
    if (!defaults.has(family)) throw new Error(`Missing default NodeDef for ${family}`);
  }
  return defaults;
}

function equivalent(a, b, type) {
  if (type === 'boolean') {
    const valid = ['true', 'false', '1', '0'];
    return valid.includes(a) && valid.includes(b) && (a === 'true' || a === '1') === (b === 'true' || b === '1');
  }
  if (!['float', 'integer', 'color3', 'color4', 'vector2', 'vector3', 'vector4'].includes(type)) return a === b;
  const number = value => /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim()) ? Number(value) : NaN;
  const left = a.split(',').map(number);
  const right = b.split(',').map(number);
  return left.length === right.length && left.every((value, index) =>
    Number.isFinite(value) && Number.isFinite(right[index]) && value === right[index]);
}

export function simplifyMaterialXml(xml, defaults) {
  let removed = 0;
  const text = xml.replace(/<(standard_surface|open_pbr_surface)\b([^>]*)>([\s\S]*?)<\/\1>/g,
    (element, family, attributes, body) => {
      const surface = attributesOf(attributes);
      const definition = defaults.get(surface.nodedef ?? (surface.version ? `${family}:${surface.version}` : family));
      if (!definition) return element;
      const simplified = body.replace(/^[ \t]*<input\b([^>]*)\/>[ \t]*\r?\n/gm, (input, raw) => {
        const attrs = attributesOf(raw);
        if (Object.keys(attrs).some(key => !['name', 'type', 'value'].includes(key))) return input;
        const fallback = definition.get(attrs.name);
        if (attrs.value !== undefined && fallback?.type === attrs.type && equivalent(attrs.value, fallback.value, attrs.type)) {
          removed++;
          return '';
        }
        return input;
      });
      return `<${family}${attributes}>${simplified}</${family}>`;
    });
  return { text, removed };
}

export function simplifyPathtracerMaterials(libraryRoot, outputRoot = root, apply = false) {
  const defaults = surfaceDefaults(libraryRoot);
  return readdirSync(outputRoot).filter(name => name.endsWith('.mtlx')).sort().map(file => {
    const path = join(outputRoot, file);
    const xml = readFileSync(path, 'utf8');
    const result = simplifyMaterialXml(xml, defaults);
    if (apply && result.removed) writeFileSync(path, result.text);
    return { file, removed: result.removed };
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).some(arg => arg !== '--apply')) throw new Error('Usage: node scripts/simplify-pathtracer-materials.mjs [--apply]');
  const reports = simplifyPathtracerMaterials(defaultLibraryRoot, root, process.argv.includes('--apply'));
  for (const report of reports) console.log(`${report.file}: ${report.removed} default inputs removed${process.argv.includes('--apply') ? '' : ' (dry run)'}`);
  console.log(`Total: ${reports.reduce((sum, report) => sum + report.removed, 0)} inputs.`);
}
