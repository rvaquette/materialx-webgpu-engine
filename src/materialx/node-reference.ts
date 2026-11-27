import coverageMarkdown from '../../docs/materialx-node-coverage.md?raw';
import conformanceMarkdown from '../../docs/conformance.md?raw';
import { acceptsValue, coerceValue, nodeType, type ScriptNodeDef, type ScriptValue, type ScriptLibrary } from './script-api.ts';
import { formatValue } from './script-editor.ts';

export const NODE_REFERENCE_EVENT = 'materialx-node-reference';

export interface NodeReferenceRequest {
  category: string;
  nodeDef?: string;
}

export interface NodeReferenceSupport {
  coverage: 'direct' | 'dependency' | 'not-in-corpus';
  implementation?: string;
  raster: string;
  pathTracing: string;
}

export interface NodeReferenceEntry {
  id: string;
  definition: ScriptNodeDef;
  support: NodeReferenceSupport;
}

export interface NodeReferenceExample {
  code: string;
  previewable: boolean;
}

const curatedInputs: Readonly<Record<string, Readonly<Record<string, ScriptValue>>>> = {
  add: { in1: 0.2, in2: 0.7 },
  chiang_hair_absorption_from_color: { color: [0.7, 0.35, 0.18] },
  chiang_hair_bsdf: {},
  chiang_hair_roughness: {},
  clamp: { in: 1.2, low: 0, high: 1 },
  combine3: { in1: 0.8, in2: 0.3, in3: 0.1 },
  constant: { value: [0.8, 0.25, 0.08] },
  convert: { in: 0.5 },
  deon_hair_absorption_from_melanin: { melanin: 0.35 },
  disney_principled: { base_color: [0.8, 0.3, 0.08], roughness: 0.28 },
  divide: { in1: 0.7, in2: 2 },
  dotproduct: { in1: [1, 0.2, 0], in2: [0.1, 0.8, 0.3] },
  extract: { in: [0.8, 0.3, 0.1], index: 0 },
  fractal3d: { octaves: 4, amplitude: 0.7 },
  gltf_colorimage: {},
  gltf_image: {},
  gltf_normalmap: {},
  gltf_pbr: { base_color: [0.8, 0.3, 0.08], metallic: 0.2, roughness: 0.35 },
  hextiledimage: {},
  hsvtorgb: { in: [0.08, 0.8, 0.9] },
  image: {},
  max: { in1: 0.2, in2: 0.7 },
  mix: { bg: [0.08, 0.16, 0.35], fg: [0.9, 0.32, 0.08], mix: 0.55 },
  multiply: { in1: 0.6, in2: 0.8 },
  normalmap: { in: [0.5, 0.5, 1], scale: 1 },
  open_pbr_surface: { base_color: [0.8, 0.3, 0.08], base_roughness: 0.28 },
  place2d: {},
  position: { space: 'object' },
  power: { in1: 0.5, in2: 2 },
  rgbtohsv: { in: [0.8, 0.3, 0.08] },
  separate3: { in: [0.8, 0.3, 0.08] },
  simple_hair: {},
  sin: { in: 1 },
  standard_surface: { base_color: [0.8, 0.3, 0.08], specular_roughness: 0.28 },
  subtract: { in1: 0.8, in2: 0.25 },
  surface: {},
  surfacematerial: {},
  texcoord: {},
  tiledimage: {},
  UsdPreviewSurface: { diffuseColor: [0.8, 0.3, 0.08], roughness: 0.28 },
};

function cells(line: string): string[] | undefined {
  if (!line.trimStart().startsWith('|')) return undefined;
  return line.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim());
}

function parseCoverage(): Map<string, { coverage: 'direct' | 'dependency'; implementation?: string }> {
  const result = new Map<string, { coverage: 'direct' | 'dependency'; implementation?: string }>();
  let section: 'direct' | 'dependency' | undefined;
  for (const line of coverageMarkdown.split(/\r?\n/)) {
    if (line.startsWith('## 2.')) { section = 'direct'; continue; }
    if (line.startsWith('## 3.')) { section = 'dependency'; continue; }
    if (line.startsWith('## ') && !line.startsWith('## 2.') && !line.startsWith('## 3.')) { section = undefined; continue; }
    const row = section ? cells(line) : undefined;
    if (!row || row.length < 2 || row[0] === 'Category' || /^[-\s]+$/.test(row[0]!)) continue;
    const category = row[0]!.replaceAll('`', '');
    const implementation = row[section === 'direct' ? 5 : 1]?.replaceAll('`', '');
    if (category) result.set(category, {
      coverage: section!,
      ...(implementation ? { implementation } : {}),
    });
  }
  return result;
}

function parseConformance(): Map<string, { raster: string; pathTracing: string }> {
  const result = new Map<string, { raster: string; pathTracing: string }>();
  for (const line of conformanceMarkdown.split(/\r?\n/)) {
    const row = cells(line);
    if (!row || row.length < 4 || !row[0]!.startsWith('`')) continue;
    const category = row[0]!.replaceAll('`', '');
    if (category && row[2] && row[3]) result.set(category, { raster: row[2]!, pathTracing: row[3]! });
  }
  return result;
}

let coverage: ReturnType<typeof parseCoverage> | undefined;
let conformance: ReturnType<typeof parseConformance> | undefined;

export function nodeReferenceEntries(library: ScriptLibrary): NodeReferenceEntry[] {
  // Raw Markdown can be initialized by a different production chunk after this module.
  const coverageIndex = coverage ??= parseCoverage();
  const conformanceIndex = conformance ??= parseConformance();
  const entries = library.classNames.flatMap(className => {
    const category = library.categoryOf(className);
    if (!category) return [];
    return library.variants(category).map(definition => {
      const source = coverageIndex.get(definition.category);
      const support = conformanceIndex.get(definition.category);
      const coverageKind: NodeReferenceSupport['coverage'] = source?.coverage ?? 'not-in-corpus';
      return {
        id: definition.name,
        definition,
        support: {
          coverage: coverageKind,
          ...(source?.implementation ? { implementation: source.implementation } : {}),
          raster: support?.raster ?? 'not indexed',
          pathTracing: support?.pathTracing ?? 'not indexed',
        },
      };
    });
  });
  return entries.sort((a, b) => a.definition.category.localeCompare(b.definition.category)
    || nodeType(a.definition).localeCompare(nodeType(b.definition))
    || a.definition.name.localeCompare(b.definition.name));
}

export function nodeReferenceSignature(definition: ScriptNodeDef, library: ScriptLibrary): string {
  const argument = library.variantArgument(definition);
  return `new ${definition.className}(${argument === undefined ? '' : JSON.stringify(argument)})`;
}

function instantiate(definition: ScriptNodeDef, library: ScriptLibrary, variable: string): string {
  return `${variable} = ${nodeReferenceSignature(definition, library)};`;
}

function assignmentLines(definition: ScriptNodeDef): string[] {
  const authored = curatedInputs[definition.category];
  if (!authored) return [];
  const lines: string[] = [];
  for (const [name, value] of Object.entries(authored)) {
    const input = definition.inputs.find(port => port.name === name);
    if (!input || !acceptsValue(input.type)) continue;
    const compatible = Array.isArray(value)
      ? /^(?:vector|color)\d$/.test(input.type) && Number(input.type.at(-1)) === value.length
      : typeof value === 'number' ? input.type === 'float' || input.type === 'integer' && Number.isInteger(value)
        : typeof value === 'boolean' ? input.type === 'boolean' : input.type === 'string';
    if (compatible) {
      lines.push(`sample.${name} = ${formatValue(coerceValue(value, input.type, `${definition.category}.${name}`))};`);
    }
  }
  return lines;
}

function surfaceInput(definition: ScriptNodeDef, type: string): ScriptNodeDef['inputs'][number] | undefined {
  const preferred: Record<string, readonly string[]> = {
    color3: ['base_color', 'emission_color'],
    float: ['specular_roughness', 'base', 'metalness', 'opacity'],
    vector3: ['normal', 'coat_normal'],
    boolean: ['thin_walled'],
  };
  return definition.inputs.find(input => input.type === type && preferred[type]?.includes(input.name))
    ?? definition.inputs.find(input => input.type === type);
}

function connectableSurface(
  definition: ScriptNodeDef, library: ScriptLibrary,
): { lines: string[]; materialExpression: string } | undefined {
  const output = definition.outputs[0];
  if (!output) return undefined;
  const source = `sample.${output.name}`;
  const material = library.variants('surfacematerial').find(candidate => candidate.outputs.some(port => port.type === 'material'));
  if (!material) return undefined;
  const materialSurface = material.inputs.find(port => port.name === 'surfaceshader');
  if (!materialSurface) return undefined;

  if (output.type === 'material') return { lines: [], materialExpression: 'sample' };
  if (output.type === materialSurface.type) {
    return { lines: [instantiate(material, library, 'previewMaterial'), `previewMaterial.${materialSurface.name} = ${source};`],
      materialExpression: 'previewMaterial' };
  }

  const materialInput = material.inputs.find(port => port.type === output.type && port.name !== materialSurface.name);
  const surface = library.variants('standard_surface').find(candidate => candidate.outputs.some(port => port.type === materialSurface.type));
  if (materialInput && surface) {
    return {
      lines: [instantiate(surface, library, 'previewSurface'), instantiate(material, library, 'previewMaterial'),
        `previewMaterial.${materialSurface.name} = previewSurface.${surface.outputs[0]!.name};`,
        `previewMaterial.${materialInput.name} = ${source};`],
      materialExpression: 'previewMaterial',
    };
  }

  const dataSurface = surface && surfaceInput(surface, output.type);
  if (surface && dataSurface) {
    return {
      lines: [instantiate(surface, library, 'previewSurface'), `previewSurface.${dataSurface.name} = ${source};`,
        instantiate(material, library, 'previewMaterial'),
        `previewMaterial.${materialSurface.name} = previewSurface.${surface.outputs[0]!.name};`],
      materialExpression: 'previewMaterial',
    };
  }

  const closureSurface = library.variants('surface').find(candidate =>
    candidate.inputs.some(input => input.type === output.type)
      && candidate.outputs.some(port => port.type === materialSurface.type));
  const closureInput = closureSurface?.inputs.find(input => input.type === output.type);
  if (closureSurface && closureInput) {
    return {
      lines: [instantiate(closureSurface, library, 'previewSurface'),
        `previewSurface.${closureInput.name} = ${source};`, instantiate(material, library, 'previewMaterial'),
        `previewMaterial.${materialSurface.name} = previewSurface.${closureSurface.outputs[0]!.name};`],
      materialExpression: 'previewMaterial',
    };
  }

  const convert = surface && library.variants('convert').find(candidate =>
    candidate.inputs.some(input => input.type === output.type)
      && candidate.outputs.some(port => surfaceInput(surface, port.type) !== undefined));
  const convertInput = convert?.inputs.find(input => input.type === output.type);
  const convertOutput = surface && convert?.outputs.find(port => surfaceInput(surface, port.type) !== undefined);
  const convertedInput = convertOutput && surface ? surfaceInput(surface, convertOutput.type) : undefined;
  if (surface && convert && convertInput && convertOutput && convertedInput) {
    return {
      lines: [instantiate(convert, library, 'previewConvert'), `previewConvert.${convertInput.name} = ${source};`,
        instantiate(surface, library, 'previewSurface'), `previewSurface.${convertedInput.name} = previewConvert.${convertOutput.name};`,
        instantiate(material, library, 'previewMaterial'),
        `previewMaterial.${materialSurface.name} = previewSurface.${surface.outputs[0]!.name};`],
      materialExpression: 'previewMaterial',
    };
  }
  return undefined;
}

export function nodeReferenceExample(definition: ScriptNodeDef, library: ScriptLibrary): NodeReferenceExample {
  const lines = [
    `// MaterialX ${definition.category} (${definition.name})`,
    instantiate(definition, library, 'sample'),
    ...assignmentLines(definition),
  ];
  const connection = connectableSurface(definition, library);
  if (connection) lines.push(...connection.lines, 'previewSphere = new Sphere();', `previewSphere.material = ${connection.materialExpression};`);
  else lines.push(
    '// Cette sortie n’a pas de connexion directe vers un shader de surface.',
    instantiate(library.resolve('standard_surface'), library, 'previewSurface'),
    instantiate(library.resolve('surfacematerial'), library, 'previewMaterial'),
    `previewMaterial.surfaceshader = previewSurface.${library.resolve('standard_surface').outputs[0]!.name};`,
    'previewSphere = new Sphere();',
    'previewSphere.material = previewMaterial;',
  );
  return { code: lines.join('\n'), previewable: connection !== undefined };
}

export function requestNodeReference(category: string, nodeDef?: string): void {
  document.dispatchEvent(new CustomEvent<NodeReferenceRequest>(NODE_REFERENCE_EVENT, {
    detail: { category, ...(nodeDef ? { nodeDef } : {}) },
  }));
}
