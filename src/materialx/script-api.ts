// MaterialX material scripting: a minimal JavaScript syntax mapped 1:1 to a
// MaterialX document.
//
//   img = new Image();
//   img.file = "textures/wood.jpg";
//   s = new StandardSurface();
//   s.base_color = img.out;
//
// Node types are not hard-coded: `new Image()` looks up the `image` NodeDefs of
// the loaded MaterialX libraries when it runs, and its inputs/outputs come from
// the selected NodeDef. Polymorphic nodes take an optional output type or
// NodeDef name: `new Mix("float")`, `new Mix("ND_mix_color3_color3")`.
// A `surfacematerial` is added on export when the script defines none.

import { MATERIALX_DEFAULT_LIBRARY_FILES } from './libraries.ts';
import type { ResolvedGraph } from './graph.ts';

export type ScriptValue = number | boolean | string | readonly number[];

export interface ScriptPortDef {
  name: string;
  type: string;
  default?: ScriptValue;
  doc?: string;
  /** Allowed values of string inputs. */
  enum?: readonly string[];
  /** UI range from `uimin`/`uisoftmin` and `uimax`/`uisoftmax`. */
  min?: number;
  max?: number;
}

export interface ScriptNodeDef {
  /** NodeDef name, e.g. `ND_mix_color3`. */
  name: string;
  /** MaterialX node category, e.g. `mix`. */
  category: string;
  /** Class name used in scripts, e.g. `Mix`. */
  className: string;
  doc?: string;
  inputs: readonly ScriptPortDef[];
  outputs: readonly ScriptPortDef[];
}

/** MaterialX node type of a node instance: its output type, or `multioutput`. */
export function nodeType(def: ScriptNodeDef): string {
  return def.outputs.length === 1 ? def.outputs[0]!.type : 'multioutput';
}

/** `standard_surface` → `StandardSurface`; already capitalized categories are kept. */
export function scriptClassName(category: string): string {
  if (/^[A-Z]/.test(category)) return category.replace(/[^\w$]/g, '_');
  return category.split(/[_\W]+/).filter(Boolean).map(part => part[0]!.toUpperCase() + part.slice(1)).join('');
}

export class ScriptError extends Error {
  constructor(message: string, readonly line?: number) {
    super(message);
    this.name = 'ScriptError';
  }
}

const VECTOR_SIZE: Readonly<Record<string, number>> = {
  vector2: 2, color3: 3, vector3: 3, color4: 4, vector4: 4, matrix33: 9, matrix44: 16,
};

const VALUE_TYPES = new Set(['float', 'integer', 'boolean', 'string', 'filename', ...Object.keys(VECTOR_SIZE)]);

/** Whether inputs of `type` accept literal values (closures and shaders only accept connections). */
export function acceptsValue(type: string): boolean {
  return VALUE_TYPES.has(type);
}

/** Convert a script value to an input type; numbers broadcast to vectors and colors. */
export function coerceValue(value: unknown, type: string, label: string): ScriptValue {
  const size = VECTOR_SIZE[type];
  if (size) {
    if (typeof value === 'number' && Number.isFinite(value)) return new Array<number>(size).fill(value);
    if (Array.isArray(value) && value.length === size && value.every(v => typeof v === 'number' && Number.isFinite(v))) {
      return [...value] as number[];
    }
    throw new ScriptError(`${label} expects ${type}: a number or an array of ${size} numbers.`);
  }
  switch (type) {
    case 'float':
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      break;
    case 'integer':
      if (typeof value === 'number' && Number.isInteger(value)) return value;
      break;
    case 'boolean':
      if (typeof value === 'boolean') return value;
      break;
    case 'string':
    case 'filename':
      if (typeof value === 'string') return value;
      break;
    default:
      throw new ScriptError(`${label} (${type}) only accepts a connection, e.g. ${label} = node.out.`);
  }
  throw new ScriptError(`${label} expects ${type === 'filename' ? 'a string' : `a ${type}`}.`);
}

function parseValue(text: string, type: string, label: string): ScriptValue {
  if (VECTOR_SIZE[type]) {
    const components = text.split(',').map(part => Number(part.trim()));
    // A single component is broadcast, as for numbers assigned in scripts.
    return coerceValue(components.length === 1 ? components[0] : components, type, label);
  }
  if (type === 'float' || type === 'integer') return coerceValue(text.trim() === '' ? NaN : Number(text), type, label);
  if (type === 'boolean') return coerceValue(text === 'true' ? true : text === 'false' ? false : text, type, label);
  return coerceValue(text, type, label);
}

// ---------------------------------------------------------------------------
// Minimal XML reader (elements and attributes) shared by NodeDef and document parsing.

interface XmlElement {
  tag: string;
  attributes: Map<string, string>;
  children: XmlElement[];
}

const unescapeXml = (text: string): string => text
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

const escapeXml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function parseXml(xml: string): XmlElement {
  const root: XmlElement = { tag: '#document', attributes: new Map(), children: [] };
  const stack = [root];
  const body = xml.replace(/<!--[\s\S]*?-->/g, '').replace(/<\?[\s\S]*?\?>/g, '').replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '');
  for (const match of body.matchAll(/<\s*(\/)?\s*([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/)?\s*>/g)) {
    const [, closing, tag, attributeText, selfClosing] = match;
    if (closing) {
      if (stack.length < 2 || stack.at(-1)!.tag !== tag) throw new ScriptError(`Invalid XML: unexpected </${tag}>.`);
      stack.pop();
      continue;
    }
    const attributes = new Map<string, string>();
    for (const [, key, double, single] of (attributeText ?? '').matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      attributes.set(key!, unescapeXml(double ?? single ?? ''));
    }
    const element: XmlElement = { tag: tag!, attributes, children: [] };
    stack.at(-1)!.children.push(element);
    if (!selfClosing) stack.push(element);
  }
  if (stack.length !== 1) throw new ScriptError(`Invalid XML: <${stack.at(-1)!.tag}> is not closed.`);
  return root;
}

function materialxRoot(xml: string): XmlElement {
  const root = parseXml(xml).children.find(element => element.tag.toLowerCase() === 'materialx');
  if (!root) throw new ScriptError('Not a MaterialX document: <materialx> root is missing.');
  return root;
}

// ---------------------------------------------------------------------------
// NodeDef library

/** Output types tried, in order, when a polymorphic node is created without a type. */
const TYPE_PREFERENCE = ['color3', 'float', 'vector3', 'color4', 'vector2', 'vector4', 'integer', 'boolean'];

export class ScriptLibrary {
  readonly #byCategory = new Map<string, ScriptNodeDef[]>();
  readonly #byClass = new Map<string, string>();
  readonly #byName = new Map<string, ScriptNodeDef>();

  /**
   * `defs` are the selectable variants; `versions` are older NodeDef versions, only resolved by
   * explicit NodeDef name (e.g. documents pinning `ND_standard_surface_surfaceshader_100`).
   */
  constructor(defs: Iterable<ScriptNodeDef>, versions: Iterable<ScriptNodeDef> = []) {
    for (const def of versions) this.#byName.set(def.name, def);
    for (const def of defs) {
      this.#byName.set(def.name, def);
      const variants = this.#byCategory.get(def.category) ?? [];
      variants.push(def);
      this.#byCategory.set(def.category, variants);
      if (!this.#byClass.has(def.className)) this.#byClass.set(def.className, def.category);
    }
    const rank = (def: ScriptNodeDef): number => {
      const index = TYPE_PREFERENCE.indexOf(nodeType(def));
      return index < 0 ? TYPE_PREFERENCE.length : index;
    };
    for (const variants of this.#byCategory.values()) {
      variants.sort((a, b) => rank(a) - rank(b) || a.name.length - b.name.length || a.name.localeCompare(b.name));
    }
  }

  /** Script class names, sorted. */
  get classNames(): string[] {
    return [...this.#byClass.keys()].sort((a, b) => a.localeCompare(b));
  }

  /** Category for a script class name (`Mix`). */
  categoryOf(className: string): string | undefined {
    return this.#byClass.get(className);
  }

  variants(category: string): readonly ScriptNodeDef[] {
    return this.#byCategory.get(category) ?? [];
  }

  /** NodeDef for `category`: by NodeDef name, by output type, or the preferred variant. */
  resolve(category: string, variant?: string): ScriptNodeDef {
    const variants = this.variants(category);
    if (!variants.length) throw new ScriptError(`Unknown node type "${category}".`);
    if (variant === undefined) return variants[0]!;
    const named = this.#byName.get(variant);
    const def = variant.startsWith('ND_')
      ? (named?.category === category ? named : undefined)
      : variants.find(candidate => nodeType(candidate) === variant);
    if (!def) {
      const types = [...new Set(variants.map(nodeType))].join(', ');
      throw new ScriptError(`${scriptClassName(category)} has no variant "${variant}". Types: ${types}.`);
    }
    return def;
  }

  /** Argument for `new Class(...)` that selects `def`, or `undefined` for the preferred variant. */
  variantArgument(def: ScriptNodeDef): string | undefined {
    const variants = this.variants(def.category);
    if (variants[0] === def) return undefined;
    return variants.find(candidate => nodeType(candidate) === nodeType(def)) === def ? nodeType(def) : def.name;
  }

  /** Read every `<nodedef>` of MaterialX library documents, resolving `inherit` and versions. */
  static fromXml(texts: Iterable<string>): ScriptLibrary {
    const elements = new Map<string, XmlElement>();
    for (const text of texts) {
      for (const element of materialxRoot(text).children) {
        const name = element.attributes.get('name');
        if (element.tag === 'nodedef' && name && element.attributes.get('node')) elements.set(name, element);
      }
    }
    const ports = (element: XmlElement, tag: 'input' | 'output', seen = new Set<string>()): Map<string, ScriptPortDef> => {
      const parentName = element.attributes.get('inherit');
      const parent = parentName && !seen.has(parentName) ? elements.get(parentName) : undefined;
      const result = parent ? ports(parent, tag, new Set([...seen, parentName!])) : new Map<string, ScriptPortDef>();
      for (const child of element.children) {
        const name = child.attributes.get('name');
        const type = child.attributes.get('type');
        if (child.tag !== tag || !name || !type) continue;
        const port: ScriptPortDef = { name, type };
        const value = child.attributes.get(tag === 'input' ? 'value' : 'default');
        if (value !== undefined && acceptsValue(type)) {
          try { port.default = parseValue(value, type, name); } catch { /* keep the port without a default */ }
        }
        const doc = child.attributes.get('doc');
        if (doc) port.doc = doc;
        const options = child.attributes.get('enum');
        if (options && (type === 'string' || type === 'filename')) port.enum = options.split(',').map(option => option.trim());
        const min = Number(child.attributes.get('uimin') ?? child.attributes.get('uisoftmin') ?? NaN);
        const max = Number(child.attributes.get('uimax') ?? child.attributes.get('uisoftmax') ?? NaN);
        if (Number.isFinite(min)) port.min = min;
        if (Number.isFinite(max)) port.max = max;
        result.set(name, port);
      }
      return result;
    };
    // Keep only the default version when a node declares several versions.
    const defaults = new Set<string>();
    for (const element of elements.values()) {
      if (element.attributes.get('isdefaultversion') === 'true') defaults.add(element.attributes.get('node')!);
    }
    const defs: ScriptNodeDef[] = [];
    const versions: ScriptNodeDef[] = [];
    for (const [name, element] of elements) {
      const category = element.attributes.get('node')!;
      const outputs = [...ports(element, 'output').values()];
      const legacyType = element.attributes.get('type');
      if (!outputs.length && legacyType) outputs.push({ name: 'out', type: legacyType });
      if (!outputs.length) continue;
      const doc = element.attributes.get('doc');
      const def: ScriptNodeDef = {
        name, category, className: scriptClassName(category),
        inputs: [...ports(element, 'input').values()], outputs,
        ...(doc ? { doc } : {}),
      };
      const olderVersion = defaults.has(category) && element.attributes.has('version') &&
        element.attributes.get('isdefaultversion') !== 'true';
      (olderVersion ? versions : defs).push(def);
    }
    return new ScriptLibrary(defs, versions);
  }
}

/** Library documents containing NodeDefs (targets and nodegraph implementations are skipped). */
export const SCRIPT_LIBRARY_FILES: readonly string[] = MATERIALX_DEFAULT_LIBRARY_FILES
  .filter(file => !file.startsWith('targets/') && !file.endsWith('_ng.mtlx'));

/** Fetch the MaterialX libraries under `rootUrl` and read their NodeDefs. */
export async function loadScriptLibrary(
  rootUrl: string, fetchText: (url: string) => Promise<string> = async (url) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
    return response.text();
  },
): Promise<ScriptLibrary> {
  const base = rootUrl.replace(/\/+$/, '');
  return ScriptLibrary.fromXml(await Promise.all(SCRIPT_LIBRARY_FILES.map(file => fetchText(`${base}/${file}`))));
}

// ---------------------------------------------------------------------------
// Graph

export interface ScriptNode {
  name: string;
  def: ScriptNodeDef;
  /** Assigned inputs in assignment order. */
  inputs: Map<string, ScriptInput>;
  /** MaterialX `colorspace` attribute, e.g. `srgb_texture` for color textures. */
  colorspace?: string;
}

export type ScriptInput = { value: ScriptValue } | { node: ScriptNode; output: string };

export interface ScriptGraph {
  nodes: ScriptNode[];
}

/** Standard MaterialX color spaces, offered for the `colorspace` node attribute. */
export const MATERIALX_COLORSPACES: readonly string[] = [
  'srgb_texture', 'lin_rec709', 'g22_rec709', 'g18_rec709', 'acescg', 'lin_ap1', 'g22_ap1', 'g18_ap1',
  'lin_srgb', 'adobergb', 'lin_adobergb', 'srgb_displayp3', 'lin_displayp3',
];

/** Whether `name` is the node's `colorspace` attribute rather than one of its inputs. */
export function isColorspaceAttribute(def: ScriptNodeDef, name: string): boolean {
  return name === 'colorspace' && !def.inputs.some(port => port.name === name);
}

function inputDef(node: ScriptNode, name: string): ScriptPortDef {
  const input = node.def.inputs.find(port => port.name === name);
  if (!input) {
    throw new ScriptError(`${node.def.className} (${node.def.name}) has no input "${name}". Inputs: ${node.def.inputs.map(port => port.name).join(', ')}.`);
  }
  return input;
}

const OUTPUT = Symbol('scriptOutput');
interface OutputRef { readonly [OUTPUT]: { node: ScriptNode; output: ScriptPortDef } }

function outputRef(node: ScriptNode, output: ScriptPortDef): OutputRef {
  return Object.freeze({ [OUTPUT]: { node, output }, toString: () => `${node.name}.${output.name}` });
}

function connect(node: ScriptNode, name: string, source: ScriptNode, output: ScriptPortDef): void {
  const input = inputDef(node, name);
  if (output.type !== input.type) {
    throw new ScriptError(`${node.name}.${name} expects ${input.type} but ${source.name}.${output.name} is ${output.type}.`);
  }
  node.inputs.set(name, { node: source, output: output.name });
}

/** Line of the failing statement in a script run by `runScript`, when the engine reports it. */
function errorLine(error: unknown): number | undefined {
  const match = /<anonymous>:(\d+):\d+/.exec(error instanceof Error ? error.stack ?? '' : '');
  // `new Function` adds two header lines and the `with` wrapper one more.
  return match ? Math.max(1, Number(match[1]) - 3) : undefined;
}

const DECLARATION = /\b(?:const|let|var)\s+(?=[A-Za-z_$][\w$]*\s*=)/g;

/** Execute a material script, creating nodes from `library` as they are instantiated. */
export function runScript(code: string, library: ScriptLibrary): ScriptGraph {
  const graph: ScriptGraph = { nodes: [] };
  const handles = new WeakMap<object, ScriptNode>();
  const nodeOf = (value: unknown): ScriptNode | undefined =>
    typeof value === 'object' && value !== null ? handles.get(value) : undefined;
  const pending = new Set<ScriptNode>();
  const used = new Set<string>();

  const nameNode = (node: ScriptNode, name: string): void => {
    let unique = name;
    for (let i = 2; used.has(unique); i++) unique = `${name}_${i}`;
    used.add(unique);
    node.name = unique;
    pending.delete(node);
  };

  const assign = (node: ScriptNode, name: string, value: unknown): void => {
    const ref = (value as Partial<OutputRef> | null)?.[OUTPUT];
    if (ref) return connect(node, name, ref.node, ref.output);
    const source = nodeOf(value);
    if (source) {
      if (source.def.outputs.length !== 1) {
        throw new ScriptError(`${source.name} has several outputs; use ${source.name}.${source.def.outputs[0]!.name} or another output.`);
      }
      return connect(node, name, source, source.def.outputs[0]!);
    }
    const input = inputDef(node, name);
    node.inputs.set(name, { value: coerceValue(value, input.type, `${node.name}.${name}`) });
  };

  const createHandle = (def: ScriptNodeDef): object => {
    const node: ScriptNode = { name: def.category, def, inputs: new Map() };
    graph.nodes.push(node);
    pending.add(node);
    const handle: object = new Proxy(Object.create(null) as object, {
      get: (_target, key) => {
        if (typeof key !== 'string') return undefined;
        if (key === 'toString') return () => node.name;
        if (isColorspaceAttribute(def, key)) return node.colorspace;
        const output = def.outputs.find(port => port.name === key);
        if (output && !def.inputs.some(port => port.name === key)) return outputRef(node, output);
        const input = node.inputs.get(inputDef(node, key).name);
        if (!input) return undefined;
        if ('node' in input) return outputRef(input.node, input.node.def.outputs.find(port => port.name === input.output)!);
        return input.value;
      },
      set: (_target, key, value) => {
        if (typeof key !== 'string') return false;
        if (isColorspaceAttribute(def, key)) {
          if (typeof value !== 'string') throw new ScriptError(`${node.name}.colorspace expects a color space name.`);
          node.colorspace = value;
          return true;
        }
        if (def.outputs.some(port => port.name === key) && !def.inputs.some(port => port.name === key)) {
          throw new ScriptError(`${node.name}.${key} is an output and cannot be assigned.`);
        }
        assign(node, key, value);
        return true;
      },
    });
    handles.set(handle, node);
    return handle;
  };

  const classes = new Map<string, unknown>();
  const classFor = (identifier: string): unknown => {
    if (classes.has(identifier)) return classes.get(identifier);
    const category = library.categoryOf(identifier);
    const create = category === undefined ? undefined : function (this: unknown, variant?: unknown): object {
      if (!new.target) throw new ScriptError(`Use "new ${identifier}()".`);
      if (variant !== undefined && typeof variant !== 'string') throw new ScriptError(`new ${identifier}(type) expects a type name.`);
      return createHandle(library.resolve(category, variant));
    };
    classes.set(identifier, create);
    return create;
  };

  const variables = new Map<string, unknown>();
  const scope = new Proxy(Object.create(null) as object, {
    has: (_target, key) => typeof key === 'string' &&
      (variables.has(key) || classFor(key) !== undefined || !(key in globalThis)),
    get: (_target, key) => {
      if (typeof key !== 'string') return undefined;
      if (variables.has(key)) return variables.get(key);
      const create = classFor(key);
      if (create) return create;
      throw new ScriptError(`${key} is not defined.`);
    },
    set: (_target, key, value) => {
      if (typeof key !== 'string') return false;
      if (classFor(key)) throw new ScriptError(`${key} is a node type and cannot be reassigned.`);
      variables.set(key, value);
      const node = nodeOf(value);
      if (node && pending.has(node)) nameNode(node, key);
      return true;
    },
  });

  let run: (scope: object) => void;
  try {
    run = new Function('scope', `with (scope) {\n${code.replace(DECLARATION, '')}\n}`) as (scope: object) => void;
  } catch (error) {
    throw new ScriptError(`Syntax error: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    run(scope);
  } catch (error) {
    throw new ScriptError(error instanceof Error ? error.message : String(error), errorLine(error));
  }
  for (const node of [...pending]) nameNode(node, node.def.category);
  return graph;
}

// ---------------------------------------------------------------------------
// XML and script generation

const formatNumber = (value: number): string => String(Number(value.toPrecision(6)));

function formatXmlValue(value: ScriptValue): string {
  if (Array.isArray(value)) return value.map(formatNumber).join(', ');
  if (typeof value === 'number') return formatNumber(value);
  return String(value);
}

/** Nodes with a `surfacematerial` bound to the last surface shader when none exists. */
function withMaterial(graph: ScriptGraph, library: ScriptLibrary): ScriptNode[] {
  if (graph.nodes.some(node => node.def.outputs.some(port => port.type === 'material'))) return graph.nodes;
  const shader = [...graph.nodes].reverse().find(node => nodeType(node.def) === 'surfaceshader');
  if (!shader || !library.variants('surfacematerial').length) return graph.nodes;
  const names = new Set(graph.nodes.map(node => node.name));
  let name = 'material';
  for (let i = 2; names.has(name); i++) name = `material_${i}`;
  const material: ScriptNode = { name, def: library.resolve('surfacematerial'), inputs: new Map() };
  connect(material, 'surfaceshader', shader, shader.def.outputs[0]!);
  return [...graph.nodes, material];
}

export interface ToXmlOptions {
  /** Prefix for relative texture paths (MaterialX `fileprefix`). */
  filePrefix?: string;
}

export function toXml(graph: ScriptGraph, library: ScriptLibrary, options: ToXmlOptions = {}): string {
  const prefix = options.filePrefix ? ` fileprefix="${escapeXml(options.filePrefix)}"` : '';
  const lines = ['<?xml version="1.0"?>', `<materialx version="1.39"${prefix}>`];
  for (const node of withMaterial(graph, library)) {
    const preferred = library.variantArgument(node.def) === undefined && nodeType(node.def) !== 'multioutput';
    // The engine (like MaterialX getColorSpace) reads the color space declared on the file input itself.
    const fileInputs = [...node.inputs].filter(([name, input]) => 'value' in input && inputDef(node, name).type === 'filename');
    const colorspace = node.colorspace ? ` colorspace="${escapeXml(node.colorspace)}"` : '';
    const open = `  <${node.def.category} name="${escapeXml(node.name)}" type="${nodeType(node.def)}"${preferred ? '' : ` nodedef="${node.def.name}"`}${fileInputs.length ? '' : colorspace}`;
    if (!node.inputs.size) {
      lines.push(`${open} />`);
      continue;
    }
    lines.push(`${open}>`);
    for (const [name, input] of node.inputs) {
      const type = inputDef(node, name).type;
      const source = 'node' in input
        ? `nodename="${escapeXml(input.node.name)}"${input.node.def.outputs.length > 1 ? ` output="${input.output}"` : ''}`
        : `value="${escapeXml(formatXmlValue(input.value))}"${type === 'filename' ? colorspace : ''}`;
      lines.push(`    <input name="${name}" type="${type}" ${source} />`);
    }
    lines.push(`  </${node.def.category}>`);
  }
  lines.push('</materialx>', '');
  return lines.join('\n');
}

/** NodeDef of a node: its explicit NodeDef when the library has it, else the variant matching its type and inputs. */
function matchNodeDef(
  library: ScriptLibrary, category: string, type: string | undefined, inputs: readonly { name: string; type?: string | undefined }[],
  explicit: string | undefined, label: string,
): ScriptNodeDef {
  if (explicit) {
    try { return library.resolve(category, explicit); } catch { /* engine-specific NodeDef: match below */ }
  }
  const variants = library.variants(category);
  if (!variants.length) throw new ScriptError(`Unknown node type <${category}>.`);
  const matches = variants.filter(def => (!type || nodeType(def) === type) && inputs.every((input) => {
    const port = def.inputs.find(candidate => candidate.name === input.name);
    return port && (!input.type || port.type === input.type);
  }));
  if (!matches.length) throw new ScriptError(`No ${category} NodeDef matches node "${label}".`);
  return matches[0]!;
}

/** NodeDef of a document node: explicit `nodedef`, else the variant matching its type and input types. */
function documentNodeDef(element: XmlElement, library: ScriptLibrary): ScriptNodeDef {
  const explicit = element.attributes.get('nodedef');
  if (explicit) return library.resolve(element.tag, explicit);
  const inputs = element.children.map(child => ({ name: child.attributes.get('name') ?? '', type: child.attributes.get('type') }));
  return matchNodeDef(library, element.tag, element.attributes.get('type'), inputs, undefined, element.attributes.get('name') ?? '');
}

/** MaterialX elements that do not describe shading nodes (geometry bindings, layout, metadata). */
const IGNORED_ELEMENTS = new Set([
  'look', 'lookgroup', 'materialassign', 'collection', 'geominfo', 'geomprop', 'propertyset', 'propertysetassign',
  'variantset', 'variantassign', 'visibility', 'backdrop', 'token', 'unitdef', 'unittypedef', 'typedef',
]);
const UNSUPPORTED_ELEMENTS = new Set(['nodedef', 'implementation', 'xi:include', 'attributedef', 'targetdef']);

/** A `<materialx>` document or `<nodegraph>`: the naming scope of nodes, outputs and interface inputs. */
interface DocumentScope {
  path: string;
  parent?: DocumentScope;
  filePrefix: string;
  nodes: Map<string, ScriptNode>;
  graphs: Map<string, DocumentScope>;
  outputs: Map<string, XmlElement>;
  interface: Map<string, XmlElement>;
}

type ResolvedSource = { value: string; filePrefix: string } | { node: ScriptNode; output: ScriptPortDef };

const isAbsoluteFile = (file: string): boolean => /^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(file);

/**
 * Read a MaterialX document whose nodes are defined by `library`. Node graphs are flattened:
 * their nodes join the script, graph outputs connect to the node behind them, and interface
 * inputs are replaced by the value or connection they receive.
 */
export function fromXml(xml: string, library: ScriptLibrary): ScriptGraph {
  const graph: ScriptGraph = { nodes: [] };
  const pending: Array<{ node: ScriptNode; element: XmlElement; scope: DocumentScope; localName: string }> = [];
  const prefixOf = (element: XmlElement, inherited: string): string => element.attributes.get('fileprefix') ?? inherited;

  const collect = (element: XmlElement, scope: DocumentScope): void => {
    for (const child of element.children) {
      const name = child.attributes.get('name');
      if (IGNORED_ELEMENTS.has(child.tag)) continue;
      if (UNSUPPORTED_ELEMENTS.has(child.tag)) throw new ScriptError(`<${child.tag}> is not supported by material scripts.`);
      if (!name) throw new ScriptError(`<${child.tag}> has no name.`);
      if (child.tag === 'output') {
        scope.outputs.set(name, child);
      } else if (child.tag === 'input') {
        if (!scope.parent) throw new ScriptError(`Document-level <input> "${name}" is not supported.`);
        scope.interface.set(name, child);
      } else if (child.tag === 'nodegraph') {
        if (child.attributes.has('nodedef')) throw new ScriptError(`Node graph "${name}" implements a NodeDef and is not supported.`);
        if (scope.graphs.has(name) || scope.nodes.has(name)) throw new ScriptError(`Duplicate name "${name}".`);
        const graphScope: DocumentScope = {
          path: scope.path ? `${scope.path}_${name}` : name, parent: scope, filePrefix: prefixOf(child, scope.filePrefix),
          nodes: new Map(), graphs: new Map(), outputs: new Map(), interface: new Map(),
        };
        scope.graphs.set(name, graphScope);
        collect(child, graphScope);
      } else {
        if (scope.nodes.has(name) || scope.graphs.has(name)) throw new ScriptError(`Duplicate node name "${name}".`);
        const node: ScriptNode = { name, def: documentNodeDef(child, library), inputs: new Map() };
        const colorspace = child.attributes.get('colorspace');
        if (colorspace) node.colorspace = colorspace;
        scope.nodes.set(name, node);
        graph.nodes.push(node);
        pending.push({ node, element: child, scope, localName: name });
      }
    }
  };
  const root = materialxRoot(xml);
  const document: DocumentScope = {
    path: '', filePrefix: prefixOf(root, ''), nodes: new Map(), graphs: new Map(), outputs: new Map(), interface: new Map(),
  };
  collect(root, document);

  // Flattened nodes keep their name unless another node already uses it.
  const used = new Set(pending.filter(item => !item.scope.parent).map(item => item.localName));
  for (const { node, scope, localName } of pending) {
    if (!scope.parent) continue;
    let name = used.has(localName) ? `${scope.path}_${localName}` : localName;
    const base = name;
    for (let i = 2; used.has(name); i++) name = `${base}_${i}`;
    used.add(name);
    node.name = name;
  }

  const describe = (scope: DocumentScope, name: string): string => scope.path ? `${scope.path}/${name}` : name;
  const graphOutput = (scope: DocumentScope, graphName: string, outputName: string | undefined, label: string): ResolvedSource | undefined => {
    const target = scope.graphs.get(graphName);
    if (!target) throw new ScriptError(`${label} references unknown node graph "${graphName}".`);
    const outputs = [...target.outputs.values()];
    const output = outputName !== undefined ? target.outputs.get(outputName) : outputs.length === 1 ? outputs[0] : undefined;
    if (!output) throw new ScriptError(`${label} references unknown output "${graphName}.${outputName ?? ''}".`);
    return resolve(output, target, label);
  };
  // Source of an input or output element in `scope`: a value, a node output, or nothing (NodeDef default).
  const resolve = (element: XmlElement, scope: DocumentScope, label: string): ResolvedSource | undefined => {
    const attributes = element.attributes;
    const nodeName = attributes.get('nodename');
    const graphName = attributes.get('nodegraph');
    const interfaceName = attributes.get('interfacename');
    if (nodeName !== undefined) {
      const node = scope.nodes.get(nodeName);
      if (node) {
        const outputName = attributes.get('output');
        const output = outputName ? node.def.outputs.find(port => port.name === outputName) : node.def.outputs[0];
        if (!output) throw new ScriptError(`${label} references unknown output "${nodeName}.${outputName ?? ''}".`);
        return { node, output };
      }
      // MaterialX 1.38 documents reference sibling node graphs through `nodename`.
      if (scope.graphs.has(nodeName)) return graphOutput(scope, nodeName, attributes.get('output'), label);
      throw new ScriptError(`${label} references unknown node "${describe(scope, nodeName)}".`);
    }
    if (graphName !== undefined) return graphOutput(scope, graphName, attributes.get('output'), label);
    if (interfaceName !== undefined) {
      const input = scope.interface.get(interfaceName);
      if (!input || !scope.parent) throw new ScriptError(`${label} references unknown interface input "${describe(scope, interfaceName)}".`);
      const value = input.attributes.get('value');
      if (value !== undefined && !input.attributes.has('nodename') && !input.attributes.has('nodegraph') && !input.attributes.has('interfacename')) {
        return { value, filePrefix: prefixOf(input, scope.filePrefix) };
      }
      return resolve(input, scope.parent, label);
    }
    const value = attributes.get('value');
    if (value === undefined) return undefined;
    return { value, filePrefix: prefixOf(element, scope.filePrefix) };
  };

  for (const { node, element, scope } of pending) {
    const nodePrefix = prefixOf(element, scope.filePrefix);
    for (const child of element.children) {
      if (child.tag !== 'input') throw new ScriptError(`<${child.tag}> in ${node.name} is not supported by material scripts.`);
      const inputName = child.attributes.get('name') ?? '';
      const input = inputDef(node, inputName);
      const label = `${node.name}.${inputName}`;
      const source = resolve(child, { ...scope, filePrefix: nodePrefix }, label);
      if (!source) continue;
      if ('node' in source) {
        connect(node, inputName, source.node, source.output);
        continue;
      }
      // An empty value on a shader or closure input only declares it, unconnected.
      if (!acceptsValue(input.type) && source.value === '') continue;
      let value = parseValue(source.value, input.type, label);
      if (input.type === 'filename' && typeof value === 'string' && value && !isAbsoluteFile(value)) value = source.filePrefix + value;
      node.inputs.set(inputName, { value });
      const colorspace = child.attributes.get('colorspace');
      // A texture's color space travels with the image node in scripts.
      if (colorspace && input.type === 'filename' && !node.colorspace) node.colorspace = colorspace;
    }
  }
  return graph;
}

/**
 * Script graph of a material as resolved by the engine (`MaterialResource.surfaceGraph`): node graphs
 * are already flattened, texture paths are absolute and edited parameters hold their current value.
 * A `surfacematerial` named `materialName` binds the graph terminals.
 */
export function fromResolvedGraph(resolved: ResolvedGraph, library: ScriptLibrary, materialName = 'material'): ScriptGraph {
  if (resolved.lamaSurface) throw new ScriptError('LamaSurface materials cannot be converted to a script.');
  const graph: ScriptGraph = { nodes: [] };
  const byId = new Map<string, ScriptNode>();
  const leaf = (id: string): string => id.split('/').filter(Boolean).at(-1) ?? id;
  const leafCounts = new Map<string, number>();
  for (const id of resolved.nodes.keys()) leafCounts.set(leaf(id), (leafCounts.get(leaf(id)) ?? 0) + 1);
  const used = new Set<string>();
  const unique = (raw: string): string => {
    const base = raw.replace(/[^\w]/g, '_') || 'node';
    let name = base;
    for (let i = 2; used.has(name); i++) name = `${base}_${i}`;
    used.add(name);
    return name;
  };
  for (const [id, node] of resolved.nodes) {
    const def = matchNodeDef(library, node.category, node.type,
      node.inputs.map(input => ({ name: input.name, type: input.type })), node.nodeDef?.name, id);
    const name = unique(leafCounts.get(leaf(id))! > 1 ? id.replace(/^\/+/, '') : leaf(id));
    const scriptNode: ScriptNode = { name, def, inputs: new Map() };
    byId.set(id, scriptNode);
    graph.nodes.push(scriptNode);
  }
  for (const [id, node] of resolved.nodes) {
    const scriptNode = byId.get(id)!;
    for (const input of node.inputs) {
      const label = `${scriptNode.name}.${input.name}`;
      const source = input.source;
      if (source.kind === 'connection') {
        const upstream = byId.get(source.nodeId);
        if (!upstream) throw new ScriptError(`${label} references unknown node "${source.nodeId}".`);
        const output = source.output ? upstream.def.outputs.find(port => port.name === source.output) : upstream.def.outputs[0];
        if (!output) throw new ScriptError(`${label} references unknown output "${upstream.name}.${source.output ?? ''}".`);
        connect(scriptNode, input.name, upstream, output);
      } else if (source.kind === 'value' && !input.defaulted) {
        const type = inputDef(scriptNode, input.name).type;
        if (!acceptsValue(type) && source.value === '') continue;
        scriptNode.inputs.set(input.name, { value: parseValue(source.value, type, label) });
        if (input.colorSpace && type === 'filename' && !scriptNode.colorspace) scriptNode.colorspace = input.colorSpace;
      }
    }
  }
  const terminals = resolved.terminals.filter(terminal => terminal.nodeId);
  if (terminals.length && library.variants('surfacematerial').length) {
    const material: ScriptNode = { name: unique(materialName), def: library.resolve('surfacematerial'), inputs: new Map() };
    for (const terminal of terminals) {
      const upstream = byId.get(terminal.nodeId!);
      if (!upstream) throw new ScriptError(`Material terminal ${terminal.name} references unknown node "${terminal.nodeId}".`);
      if (!material.def.inputs.some(port => port.name === terminal.name)) {
        throw new ScriptError(`Material terminal "${terminal.name}" cannot be bound by a surfacematerial.`);
      }
      connect(material, terminal.name, upstream, upstream.def.outputs[0]!);
    }
    graph.nodes.push(material);
  }
  return graph;
}

const RESERVED = new Set([
  'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do', 'else', 'export',
  'extends', 'false', 'finally', 'for', 'function', 'if', 'import', 'in', 'instanceof', 'let', 'new', 'null', 'return',
  'super', 'switch', 'this', 'throw', 'true', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield', 'await',
  'enum', 'static', 'implements', 'interface', 'package', 'private', 'protected', 'public', 'undefined', 'NaN', 'Infinity',
]);

function formatScriptValue(value: ScriptValue): string {
  if (Array.isArray(value)) return `[${value.map(formatNumber).join(', ')}]`;
  if (typeof value === 'number') return formatNumber(value);
  return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

/** Generate the script that rebuilds `graph`, ordering nodes after their sources. */
export function toScript(graph: ScriptGraph, library: ScriptLibrary): string {
  const names = new Map<ScriptNode, string>();
  const used = new Set<string>();
  for (const node of graph.nodes) {
    let name = node.name.replace(/[^\w$]/g, '_').replace(/^(?=\d)/, '_');
    if (RESERVED.has(name) || library.categoryOf(name) !== undefined) name = `${name}_`;
    const base = name;
    for (let i = 2; used.has(name); i++) name = `${base}_${i}`;
    used.add(name);
    names.set(node, name);
  }
  const ordered: ScriptNode[] = [];
  const state = new Map<ScriptNode, 'visiting' | 'done'>();
  const visit = (node: ScriptNode): void => {
    if (state.get(node) === 'done') return;
    if (state.get(node) === 'visiting') throw new ScriptError(`Cycle through node "${node.name}".`);
    state.set(node, 'visiting');
    for (const input of node.inputs.values()) if ('node' in input) visit(input.node);
    state.set(node, 'done');
    ordered.push(node);
  };
  graph.nodes.forEach(visit);
  return ordered.map((node) => {
    const name = names.get(node)!;
    const variant = library.variantArgument(node.def);
    const lines = [`${name} = new ${node.def.className}(${variant === undefined ? '' : JSON.stringify(variant)});`];
    if (node.colorspace) lines.push(`${name}.colorspace = ${JSON.stringify(node.colorspace)};`);
    for (const [input, value] of node.inputs) {
      lines.push(`${name}.${input} = ${'node' in value ? `${names.get(value.node)!}.${value.output}` : formatScriptValue(value.value)};`);
    }
    return lines.join('\n');
  }).join('\n\n') + '\n';
}
