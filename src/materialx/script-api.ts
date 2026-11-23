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

import { parse as parseJavaScript, type Node as AcornNode } from 'acorn';
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

function serializeXml(element: XmlElement, indent = ''): string {
  const attributes = [...element.attributes].map(([key, value]) => ` ${key}="${escapeXml(value)}"`).join('');
  if (!element.children.length) return `${indent}<${element.tag}${attributes} />`;
  return [
    `${indent}<${element.tag}${attributes}>`,
    ...element.children.map(child => serializeXml(child, `${indent}  `)),
    `${indent}</${element.tag}>`,
  ].join('\n');
}

async function fetchTextOrThrow(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  return response.text();
}

/**
 * Replace the `<xi:include>` elements of a MaterialX document by the elements of the included
 * documents (recursively, each document once). Included `fileprefix`es become absolute so their
 * textures still resolve against the included file's directory.
 */
export async function inlineIncludes(
  xml: string, baseUrl: string, fetchText: (url: string) => Promise<string> = fetchTextOrThrow,
): Promise<string> {
  if (!/<xi:include\b/.test(xml)) return xml;
  const root = materialxRoot(xml);
  const visited = new Set<string>([new URL(baseUrl).href]);
  const absolutePrefixes = (element: XmlElement, directory: string): XmlElement => {
    const attributes = new Map(element.attributes);
    const prefix = attributes.get('fileprefix');
    if (prefix !== undefined) attributes.set('fileprefix', new URL(prefix, directory).href);
    return { ...element, attributes, children: element.children.map(child => absolutePrefixes(child, directory)) };
  };
  const expand = async (element: XmlElement, base: string): Promise<XmlElement[]> => {
    const children: XmlElement[] = [];
    for (const child of element.children) {
      if (child.tag !== 'xi:include') {
        children.push(child);
        continue;
      }
      const href = child.attributes.get('href');
      if (!href) throw new ScriptError('<xi:include> has no href.');
      const url = new URL(href, base).href;
      // MaterialX reads a document once; this also stops include cycles.
      if (visited.has(url)) continue;
      visited.add(url);
      const included = materialxRoot(await fetchText(url));
      const directory = new URL('.', url).href;
      const inherited = new URL(included.attributes.get('fileprefix') ?? '', directory).href;
      for (const element of await expand(included, url)) {
        const absolute = absolutePrefixes(element, directory);
        if (!absolute.attributes.has('fileprefix') && element.tag !== 'xi:include') absolute.attributes.set('fileprefix', inherited);
        children.push(absolute);
      }
    }
    return children;
  };
  const inlined: XmlElement = { ...root, attributes: new Map(root.attributes), children: await expand(root, baseUrl) };
  inlined.attributes.delete('xmlns:xi');
  return `<?xml version="1.0"?>\n${serializeXml(inlined)}\n`;
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
    const { defs, versions } = readNodeDefs(elements);
    return new ScriptLibrary(defs, versions);
  }
}

/** ScriptNodeDefs of `<nodedef>` elements by name, resolving `inherit`; older versions are returned apart. */
function readNodeDefs(elements: ReadonlyMap<string, XmlElement>): { defs: ScriptNodeDef[]; versions: ScriptNodeDef[] } {
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
  return { defs, versions };
}

/** Library documents containing NodeDefs (targets and nodegraph implementations are skipped). */
export const SCRIPT_LIBRARY_FILES: readonly string[] = MATERIALX_DEFAULT_LIBRARY_FILES
  .filter(file => !file.startsWith('targets/') && !file.endsWith('_ng.mtlx'));

/** Fetch the MaterialX libraries under `rootUrl` and read their NodeDefs. */
export async function loadScriptLibrary(
  rootUrl: string, fetchText: (url: string) => Promise<string> = fetchTextOrThrow,
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
/** A comparison involving node outputs, turned into a node where it is used. */
const COMPARISON = Symbol('scriptComparison');
interface Comparison { readonly [COMPARISON]: { operator: string; left: unknown; right: unknown } }

function outputRef(node: ScriptNode, output: ScriptPortDef): OutputRef {
  const ref = { [OUTPUT]: { node, output }, toString: () => `${node.name}.${output.name}` };
  // Assigning a property of an output would otherwise be silently ignored.
  return new Proxy(ref, {
    set: (_target, key) => {
      throw new ScriptError(`${node.name}.${output.name} is a node output: "${String(key)}" must be set on ${node.name} itself.`);
    },
  }) as OutputRef;
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

type AstNode = AcornNode & Record<string, unknown>;
const isAstNode = (value: unknown): value is AstNode =>
  typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string' &&
  typeof (value as { start?: unknown }).start === 'number';
const ARITHMETIC = new Set(['+', '-', '*', '/', '%', '**']);
const COMPARISONS = new Set(['>', '>=', '<', '<=', '==', '===', '!=', '!==']);

/**
 * Rewrite a script for `runScript`: arithmetic operators become `__mx.op(...)` calls (which build
 * math nodes when an operand is a node output) and `const`/`let`/`var` are dropped so assignments
 * name their nodes. Lines are preserved, so error lines still match the source.
 */
export function transformScript(code: string): string {
  let program: AstNode;
  try {
    program = parseJavaScript(code, {
      ecmaVersion: 'latest', sourceType: 'script', allowAwaitOutsideFunction: true, allowReturnOutsideFunction: true, locations: true,
    }) as unknown as AstNode;
  } catch (error) {
    const line = (error as { loc?: { line?: number } }).loc?.line;
    throw new ScriptError(`Syntax error: ${error instanceof Error ? error.message.replace(/ \(\d+:\d+\)$/, '') : String(error)}`, line);
  }
  const loopHeads = new Set<unknown>();
  const statementTests = new Set<unknown>();
  const children = (node: AstNode): AstNode[] => Object.entries(node)
    .filter(([key]) => key !== 'loc')
    .flatMap(([, value]) => Array.isArray(value) ? value.filter(isAstNode) : isAstNode(value) ? [value] : [])
    .sort((a, b) => a.start - b.start);
  const containsAwait = (node: AstNode): boolean => node.type === 'AwaitExpression' ||
    (!/Function/.test(node.type) && children(node).some(containsAwait));
  const emitFrom = (node: AstNode, start: number): string => {
    let text = '';
    let position = start;
    for (const child of children(node)) {
      if (child.start < start) continue;
      text += code.slice(position, child.start) + emit(child);
      position = child.end;
    }
    return text + code.slice(position, node.end);
  };
  const emit = (node: AstNode): string => {
    if (statementTests.delete(node)) return `__mx.test(${emit(node)})`;
    const operator = node['operator'] as string | undefined;
    if (node.type === 'BinaryExpression' && ARITHMETIC.has(operator!)) {
      return `__mx.op(${JSON.stringify(operator)}, ${emit(node['left'] as AstNode)}, ${emit(node['right'] as AstNode)})`;
    }
    if (node.type === 'BinaryExpression' && COMPARISONS.has(operator!)) {
      return `__mx.cmp(${JSON.stringify(operator!.replace(/^(==|!=)=$/, '$1'))}, ${emit(node['left'] as AstNode)}, ${emit(node['right'] as AstNode)})`;
    }
    if (node.type === 'UnaryExpression' && operator === '-') return `__mx.neg(${emit(node['argument'] as AstNode)})`;
    if (node.type === 'UnaryExpression' && operator === '!') return `__mx.not(${emit(node['argument'] as AstNode)})`;
    // Branches become thunks so plain values keep JavaScript's lazy evaluation; `await` cannot cross them.
    if (node.type === 'LogicalExpression' && (operator === '&&' || operator === '||') && !containsAwait(node['right'] as AstNode)) {
      return `__mx.${operator === '&&' ? 'and' : 'or'}(${emit(node['left'] as AstNode)}, () => (${emit(node['right'] as AstNode)}))`;
    }
    if (node.type === 'ConditionalExpression' && !containsAwait(node['consequent'] as AstNode) && !containsAwait(node['alternate'] as AstNode)) {
      return `__mx.cond(${emit(node['test'] as AstNode)}, () => (${emit(node['consequent'] as AstNode)}), () => (${emit(node['alternate'] as AstNode)}))`;
    }
    if (node.type === 'AssignmentExpression' && operator !== '=' && ARITHMETIC.has(operator!.slice(0, -1))) {
      const target = emit(node['left'] as AstNode);
      return `${target} = __mx.op(${JSON.stringify(operator!.slice(0, -1))}, ${target}, ${emit(node['right'] as AstNode)})`;
    }
    // Statement conditions are evaluated while the script runs: reject per-pixel values there.
    if (['IfStatement', 'WhileStatement', 'DoWhileStatement', 'ForStatement'].includes(node.type) && isAstNode(node['test'])) {
      statementTests.add(node['test']);
    }
    if (node.type === 'ForStatement') loopHeads.add(node['init']);
    if (node.type === 'ForInStatement' || node.type === 'ForOfStatement') loopHeads.add(node['left']);
    const declarations = node['declarations'] as AstNode[] | undefined;
    if (node.type === 'VariableDeclaration' && !loopHeads.has(node) &&
        declarations!.every(declarator => declarator['init'] && (declarator['id'] as AstNode).type === 'Identifier')) {
      return emitFrom(node, declarations![0]!.start);
    }
    return emitFrom(node, node.start);
  };
  return emit(program);
}

const OPERATOR_NODES: Readonly<Record<string, string>> = {
  '+': 'add', '-': 'subtract', '*': 'multiply', '/': 'divide', '%': 'modulo', '**': 'power',
};
const COMMUTATIVE = new Set(['add', 'multiply', 'min', 'max']);
/** `Math` functions that build MaterialX nodes when an argument is a node output. */
export const MATH_NODES: Readonly<Record<string, string>> = {
  sin: 'sin', cos: 'cos', tan: 'tan', asin: 'asin', acos: 'acos', atan2: 'atan2', abs: 'absval', floor: 'floor',
  ceil: 'ceil', round: 'round', sqrt: 'sqrt', exp: 'exp', log: 'ln', pow: 'power', min: 'min', max: 'max', sign: 'sign',
};

/** Path-tracing views selectable with `render.view` (src/render/pathtracing/display.ts). */
export const RENDER_VIEWS = ['beauty', 'albedo', 'normal', 'depth', 'variance', 'emission', 'transmission'] as const;

export interface RenderSetting {
  doc: string;
  values?: readonly (string | number)[];
  kind?: 'boolean' | 'number' | 'integer';
  min?: number;
  max?: number;
}

/** Render settings scripts can read and write through `render.<name>`, with their allowed values. */
export const RENDER_SETTINGS: Readonly<Record<string, RenderSetting>> = {
  backend: { doc: 'Moteur de rendu', values: ['raster', 'pathtracing', 'disney'] },
  resolution: { doc: 'Résolution du rendu', values: [128, 256, 512, 1024, '1024x768'] },
  depth: { doc: 'Profondeur du path tracing (0 à 64)', kind: 'integer', min: 0, max: 64 },
  quality: { doc: 'Qualité raster', values: ['interactive', 'reference'] },
  environment: { doc: 'Éclairage par l’environnement', kind: 'boolean' },
  denoise: { doc: 'Débruitage du path tracing', kind: 'boolean' },
  exposure: { doc: 'Exposition (EV)', kind: 'number' },
  tonemap: { doc: 'Tonemapping', values: ['none', 'reinhard', 'acesFilmic'] },
  view: { doc: 'Affichage du path tracing (rendu final ou AOV)', values: RENDER_VIEWS },
  adaptive: { doc: 'Échantillonnage adaptatif', kind: 'boolean' },
  noiseTarget: { doc: 'Cible de bruit relative (0,005 à 0,25)', kind: 'number', min: 0.005, max: 0.25 },
  stopOnConvergence: { doc: 'Arrêt automatique à la cible de bruit', kind: 'boolean' },
  timeBudget: { doc: 'Budget de temps actif en secondes (0 : illimité)', kind: 'number', min: 0 },
  paused: { doc: 'Pause de l’accumulation', kind: 'boolean' },
  compare: { doc: 'Comparaison brut/débruité (en pause, débruitage actif)', kind: 'boolean' },
  temporalHistory: { doc: 'Échantillons gardés après un changement dynamique (0 : relance)', kind: 'integer', min: 0 },
  memoryBudget: { doc: 'Budget mémoire GPU en Mio (0 : sans budget)', kind: 'number', min: 0 },
};

function checkRenderSetting(name: string, value: unknown): void {
  const setting = RENDER_SETTINGS[name];
  if (!setting) throw new ScriptError(`Unknown render setting "${name}". Settings: ${Object.keys(RENDER_SETTINGS).join(', ')}.`);
  const numeric = setting.kind === 'number' || setting.kind === 'integer';
  const valid = setting.values ? setting.values.includes(value as string | number)
    : setting.kind === 'boolean' ? typeof value === 'boolean'
      : typeof value === 'number' && Number.isFinite(value) && (setting.kind !== 'integer' || Number.isInteger(value)) &&
        (setting.min === undefined || value >= setting.min) && (setting.max === undefined || value <= setting.max);
  if (!valid) {
    const range = setting.min !== undefined && setting.max !== undefined ? ` from ${setting.min} to ${setting.max}`
      : setting.min !== undefined ? ` >= ${setting.min}` : '';
    const expected = setting.values ? setting.values.map(option => JSON.stringify(option)).join(', ')
      : numeric ? `${setting.kind === 'integer' ? 'an integer' : 'a number'}${range}` : `a ${setting.kind}`;
    throw new ScriptError(`render.${name} expects ${expected}.`);
  }
}

function finiteNumbers(value: unknown, length: number | undefined, label: string): number[] {
  if (!Array.isArray(value) || value.length === 0 || (length !== undefined && value.length !== length) ||
      !value.every(component => typeof component === 'number' && Number.isFinite(component))) {
    throw new ScriptError(`${label} expects ${length === undefined ? 'an array of' : length} finite numbers.`);
  }
  return [...value as number[]];
}

function objectPath(signature: string, value: unknown): string {
  if (typeof value !== 'string' || !value) throw new ScriptError(`${signature} expects a scene path.`);
  return value;
}

function lightChanges(value: unknown): ScriptLightChanges {
  if (typeof value !== 'object' || value === null) throw new ScriptError('setLight(light, changes) expects { intensity, exposure, color, transform }.');
  const { intensity, exposure, color, transform, ...extra } = value as Record<string, unknown>;
  if (Object.keys(extra).length) throw new ScriptError(`setLight: unknown fields ${Object.keys(extra).join(', ')}. Fields: intensity, exposure, color, transform.`);
  const scalar = (name: string, number: unknown): number => {
    if (typeof number !== 'number' || !Number.isFinite(number)) throw new ScriptError(`setLight ${name} expects a finite number.`);
    return number;
  };
  return {
    ...(intensity !== undefined ? { intensity: scalar('intensity', intensity) } : {}),
    ...(exposure !== undefined ? { exposure: scalar('exposure', exposure) } : {}),
    ...(color !== undefined ? { color: finiteNumbers(color, 3, 'setLight color') } : {}),
    ...(transform !== undefined ? { transform: finiteNumbers(transform, 16, 'setLight transform') } : {}),
  };
}

/**
 * Column-major 4x4 matrix of `{ translate, rotate, scale }`: scale, then rotations about X, Y
 * and Z in degrees, then translation.
 */
export function transformMatrix(spec: unknown): number[] {
  if (typeof spec !== 'object' || spec === null) throw new ScriptError('transform({ translate, rotate, scale }) expects an object.');
  const { translate, rotate, scale, ...extra } = spec as Record<string, unknown>;
  if (Object.keys(extra).length) throw new ScriptError(`transform: unknown fields ${Object.keys(extra).join(', ')}. Fields: translate, rotate, scale.`);
  const [tx, ty, tz] = translate === undefined ? [0, 0, 0] : finiteNumbers(translate, 3, 'transform translate');
  const [ax, ay, az] = (rotate === undefined ? [0, 0, 0] : finiteNumbers(rotate, 3, 'transform rotate')).map(degrees => degrees * Math.PI / 180);
  const [sx, sy, sz] = scale === undefined ? [1, 1, 1]
    : typeof scale === 'number' ? finiteNumbers([scale, scale, scale], 3, 'transform scale') : finiteNumbers(scale, 3, 'transform scale');
  const [cx, cy, cz] = [Math.cos(ax!), Math.cos(ay!), Math.cos(az!)];
  const [nx, ny, nz] = [Math.sin(ax!), Math.sin(ay!), Math.sin(az!)];
  // R = Rz * Ry * Rx, columns scaled by S.
  return [
    cy * cz * sx!, cy * nz * sx!, 0 - ny * sx!, 0,
    (nx * ny * cz - cx * nz) * sy!, (nx * ny * nz + cx * cz) * sy!, nx * cy * sy!, 0,
    (cx * ny * cz + nx * nz) * sz!, (cx * ny * nz - nx * cz) * sz!, cx * cy * sz!, 0,
    tx!, ty!, tz!, 1,
  ];
}

/** Path-tracing progress and resources reported by `stats()`. */
export interface ScriptStats {
  backend: string;
  /** Backend actually drawing the frames (raster after a fallback). */
  drawnBy: string;
  fallback?: string;
  pathTracer: string;
  samples: number;
  adaptive: boolean;
  paused: boolean;
  elapsed?: number;
  stopReason?: string;
  samplesPerSecond?: number;
  noise?: number;
  maxNoise?: number;
  variance?: number;
  remaining?: number;
  budgetRemaining?: number;
  time: number;
  warnings: number;
  gpuMemory: { total: number; peak: number; textures: number; buffers: number; budget?: number; textureLimit: number };
}

export interface ScriptLightChanges {
  intensity?: number;
  exposure?: number;
  color?: readonly number[];
  transform?: readonly number[];
}

/** Viewer operations available to scripts; without a host, `runScript` only validates them. */
export interface ScriptHost {
  loadScene(entry: string): Promise<void>;
  objects(): readonly string[];
  renderSettings(): Readonly<Record<string, unknown>>;
  setRenderSetting(name: string, value: unknown): Promise<void>;
  /** Bind a MaterialX document (generated `xml`, or a document `url`) to an object. */
  assignMaterial(objectPath: string, material: { xml: string } | { url: string }): Promise<void>;
  /** Restart rendering; with `samples`, resolve once that many samples are accumulated. Returns the sample count. */
  render(samples?: number): Promise<number>;
  /** Save the displayed render as a PNG image. */
  saveImage(name: string): Promise<void>;
  /** Save a text document (e.g. a MaterialX file). */
  saveText(name: string, text: string): Promise<void>;
  /** Material of an object as resolved by the engine. */
  objectMaterial(objectPath: string): { graph: ResolvedGraph; name: string } | undefined;
  /** Progress of the current render (queries answer during validation too); undefined before the viewer is ready. */
  stats(): ScriptStats | undefined;
  /** Resolve once the path tracer stops on convergence or on its time budget. */
  waitForStop(timeoutSeconds: number): Promise<void>;
  /** Render `samples` path-traced samples, spread over a shutter interval when given, and save them as a PNG. */
  capture(name: string, options: { samples: number; shutter?: { open: number; close: number; steps?: number } }): Promise<void>;
  /** Save the selected path-tracing AOV as a 32-bit float PFM. */
  saveAov(name: string): Promise<void>;
  /** Save the diagnostics journal as JSON. */
  saveDiagnostics(name: string): Promise<void>;
  diagnostics(): readonly { level: string; code?: string; message: string }[];
  capabilities(): unknown;
  timeline(): { start: number; end: number; fps: number } | undefined;
  time(): number;
  setTime(time: number): Promise<void>;
  setTransform(objectPath: string, matrix?: readonly number[]): Promise<void>;
  setVisibility(objectPath: string, visible?: boolean): Promise<void>;
  lights(): readonly { path: string; type: string }[];
  setLight(lightPath: string, changes?: ScriptLightChanges): Promise<void>;
  /** Field of view in degrees (vertical). */
  setCamera(camera: { eye: readonly number[]; target: readonly number[]; fov?: number }): Promise<void>;
  variants(): readonly { path: string; set: string; variants: readonly string[]; selection?: string }[];
  setVariant(path: string, set: string, variant: string): Promise<void>;
  materialParameters(objectPath: string): readonly { id: string; label: string; type: string; value: readonly number[]; min?: readonly number[]; max?: readonly number[] }[];
  setMaterialParameters(objectPath: string, values: ReadonlyMap<string, readonly number[]>): Promise<void>;
  log?(message: string): void;
}

export interface RunScriptOptions {
  host?: ScriptHost;
  /** Validate viewer operations without performing them; the host still answers queries (objects, materials). */
  dryRun?: boolean;
  /** Base of relative scene, document and texture URLs (the page by default). */
  baseUrl?: string;
  /** `fileprefix` of documents generated for `assign`. */
  filePrefix?: string;
  fetchText?: (url: string) => Promise<string>;
}

export interface ScriptRun extends ScriptGraph {
  /** Number of viewer operations (`scene`, `assign`, `render`, `save`, settings) the script requested. */
  viewerCommands: number;
  /** Messages written with `log(...)`. */
  logs: string[];
}

const SCRIPT_GLOBALS = new Set(['__mx', 'Math', 'scene', 'objects', 'render', 'assign', 'load', 'save', 'log', 'check', 'node', 'material',
  'stats', 'converge', 'capture', 'diagnostics', 'capabilities', 'timeline', 'time', 'setTime', 'transform', 'setTransform',
  'setVisibility', 'lights', 'setLight', 'setCamera', 'variants', 'setVariant', 'materialParameters', 'setMaterialParameters']);
/** Globals that are also natural node names: assigning them shadows the function. */
const SHADOWABLE_GLOBALS = new Set(['material', 'node', 'time', 'transform', 'capture']);
// eslint-disable-next-line @typescript-eslint/no-empty-function
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (...args: string[]) => (scope: object) => Promise<void>;

/**
 * Execute a material script, creating nodes from `library` as they are instantiated. Arithmetic on
 * node outputs and `Math` functions build math nodes; `scene`, `render`, `assign` and `load` drive
 * the viewer through `options.host`.
 */
export async function runScript(code: string, library: ScriptLibrary, options: RunScriptOptions = {}): Promise<ScriptRun> {
  const graph: ScriptRun = { nodes: [], viewerCommands: 0, logs: [] };
  // Queries (objects, renderSettings, objectMaterial) use the host even in dry runs; actions do not.
  const queries = options.host;
  const host = options.dryRun ? undefined : options.host;
  const baseUrl = options.baseUrl ?? (typeof document === 'undefined' ? 'http://localhost/' : document.baseURI);
  const fetchText = options.fetchText ?? fetchTextOrThrow;
  const handles = new WeakMap<object, ScriptNode>();
  const handlesByNode = new Map<ScriptNode, object>();
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

  /** The output a value designates: an output reference, a single-output node, or a comparison (as a boolean node). */
  const sourceOf = (value: unknown): { node: ScriptNode; output: ScriptPortDef } | undefined => {
    const ref = (value as Partial<OutputRef> | null)?.[OUTPUT];
    if (ref) return ref;
    const comparison = comparisonOf(value);
    if (comparison) return materialize(comparison)[OUTPUT];
    const node = nodeOf(value);
    if (!node) return undefined;
    if (node.def.outputs.length !== 1) {
      throw new ScriptError(`${node.name} has several outputs; use ${node.name}.${node.def.outputs[0]!.name} or another output.`);
    }
    return { node, output: node.def.outputs[0]! };
  };

  const assign = (node: ScriptNode, name: string, value: unknown): void => {
    const source = sourceOf(value);
    if (source) return connect(node, name, source.node, source.output);
    const input = inputDef(node, name);
    node.inputs.set(name, { value: coerceValue(value, input.type, `${node.name}.${name}`) });
  };

  const handleFor = (node: ScriptNode): object => {
    const existing = handlesByNode.get(node);
    if (existing) return existing;
    const def = node.def;
    const handle: object = new Proxy(Object.create(null) as object, {
      get: (_target, key) => {
        // `then` is probed when a handle is returned from an async function (e.g. load()).
        if (typeof key !== 'string' || key === 'then') return undefined;
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
    handlesByNode.set(node, handle);
    return handle;
  };

  const createNode = (def: ScriptNodeDef): ScriptNode => {
    const node: ScriptNode = { name: def.category, def, inputs: new Map() };
    graph.nodes.push(node);
    pending.add(node);
    return node;
  };

  // --- Math nodes -----------------------------------------------------------
  const isNodeValue = (value: unknown): boolean => comparisonOf(value) !== undefined || sourceOf(value) !== undefined;

  // --- Conditions -------------------------------------------------------------
  const comparisonOf = (value: unknown): Comparison[typeof COMPARISON] | undefined =>
    (value as Partial<Comparison> | null)?.[COMPARISON];
  const materialized = new Map<Comparison[typeof COMPARISON], OutputRef>();
  /** A comparison as its boolean node output, created now so nodes follow the reading order. */
  const asValue = (value: unknown): unknown => {
    const comparison = comparisonOf(value);
    return comparison ? materialize(comparison) : value;
  };
  /** A comparison used as a value becomes a boolean node (once). */
  const materialize = (comparison: Comparison[typeof COMPARISON]): OutputRef => {
    let ref = materialized.get(comparison);
    if (ref) return ref;
    const { operator, left, right } = comparison;
    ref = operator === '>' ? conditionalNode('ifgreater', left, right)
      : operator === '<' ? conditionalNode('ifgreater', right, left)
        : operator === '>=' ? conditionalNode('ifgreatereq', left, right)
          : operator === '<=' ? conditionalNode('ifgreatereq', right, left)
            : operator === '==' ? conditionalNode('ifequal', left, right)
              : logicNode('not', [conditionalNode('ifequal', left, right)]);
    materialized.set(comparison, ref);
    return ref;
  };
  const scalarType = (value: unknown): string | undefined => {
    const ref = (value as Partial<OutputRef> | null)?.[OUTPUT] ?? (nodeOf(value) || comparisonOf(value) ? sourceOf(value) : undefined);
    if (ref) return ref.output.type;
    return typeof value === 'number' ? 'float' : typeof value === 'boolean' ? 'boolean' : undefined;
  };
  /** ifgreater/ifgreatereq/ifequal comparing `value1` with `value2`; without branches it outputs a boolean. */
  const conditionalNode = (category: string, value1: unknown, value2: unknown, branches?: [unknown, unknown]): OutputRef => {
    const valueTypes = [value1, value2].map(scalarType);
    const nodeValueType = [value1, value2].map(value => isNodeValue(value) ? scalarType(value) : undefined).find(Boolean);
    const valueType = nodeValueType ?? valueTypes.find(Boolean);
    if (!valueType || !['float', 'integer', 'boolean'].includes(valueType)) {
      throw new ScriptError(`Comparisons apply to float, integer or boolean values, not ${valueType ?? 'this value'}.`);
    }
    let outputType = 'boolean';
    if (branches) {
      const branchNodeType = branches.map(branch => sourceOf(branch)?.output.type).find(Boolean);
      outputType = branchNodeType ?? branches.map(branch => literalType(branch)).find(type => type && type !== 'float') ??
        branches.map(branch => literalType(branch)).find(Boolean) ?? '';
      if (!outputType) throw new ScriptError('condition ? a : b selects numbers, arrays or node outputs.');
    }
    const portType = (def: ScriptNodeDef, name: string): string | undefined => def.inputs.find(port => port.name === name)?.type;
    const def = library.variants(category).find(candidate => nodeType(candidate) === outputType &&
      portType(candidate, 'value1') === valueType && (!branches || portType(candidate, 'in1') === outputType));
    if (!def) throw new ScriptError(`No ${category} NodeDef compares ${valueType} values to select ${outputType}.`);
    const node = createNode(def);
    assign(node, 'value1', value1);
    assign(node, 'value2', value2);
    if (branches) {
      assign(node, 'in1', branches[0]);
      assign(node, 'in2', branches[1]);
    }
    return outputRef(node, def.outputs[0]!);
  };
  const logicNode = (category: string, args: unknown[]): OutputRef => {
    const def = library.variants(category)[0];
    if (!def) throw new ScriptError(`The MaterialX library has no "${category}" node.`);
    const node = createNode(def);
    args.forEach((value, i) => assign(node, def.inputs[i]!.name, value));
    return outputRef(node, def.outputs[0]!);
  };
  const literalType = (value: unknown, preferred?: string): string | undefined => {
    if (typeof value === 'number') return 'float';
    if (!Array.isArray(value) || !value.every(component => typeof component === 'number')) return undefined;
    const size = value.length;
    if (preferred && VECTOR_SIZE[preferred] === size) return preferred;
    return size === 2 ? 'vector2' : size === 3 ? 'color3' : size === 4 ? 'color4' : undefined;
  };
  const mathNode = (category: string, args: unknown[]): OutputRef => {
    if (!library.variants(category).length) throw new ScriptError(`The MaterialX library has no "${category}" node.`);
    if ((category === 'min' || category === 'max') && args.length > 2) {
      return args.slice(1).reduce<OutputRef>((left, right) => mathNode(category, [left, right]), mathNode(category, args.slice(0, 2)));
    }
    const nodeTypes = args.map(arg => sourceOf(arg)?.output.type);
    const target = nodeTypes.find(type => type && type !== 'float') ??
      args.map(arg => literalType(arg)).find(type => type && type !== 'float') ?? 'float';
    const types = args.map((arg, i) => nodeTypes[i] ?? literalType(arg, target));
    if (types.some(type => !type)) throw new ScriptError(`${category} only combines numbers, arrays and node outputs.`);
    const accepts = (port: ScriptPortDef | undefined, i: number): boolean => !!port &&
      (port.type === types[i] || (nodeTypes[i] === undefined && (types[i] === 'float' || port.type === target) && VECTOR_SIZE[port.type] !== undefined && literalType(args[i], port.type) === port.type) ||
        (nodeTypes[i] === undefined && types[i] === 'float' && (port.type === 'float' || VECTOR_SIZE[port.type] !== undefined)));
    const find = (values: unknown[]): ScriptNodeDef | undefined => library.variants(category)
      .filter(def => nodeType(def) === target && def.inputs.length >= values.length)
      .find(def => values.every((_, i) => {
        const port = def.inputs[i];
        return nodeTypes[i] !== undefined ? port?.type === nodeTypes[i] : accepts(port, i);
      }));
    let values = args;
    let def = find(values);
    if (!def && COMMUTATIVE.has(category) && args.length === 2) {
      // Same operation with operands exchanged (e.g. a float times a color uses ND_multiply_color3FA).
      const swap = (): void => {
        values = [values[1], values[0]];
        [nodeTypes[0], nodeTypes[1]] = [nodeTypes[1], nodeTypes[0]];
        [types[0], types[1]] = [types[1], types[0]];
      };
      swap();
      def = find(values);
      if (!def) swap();
    }
    if (!def) {
      // A float node output used with vectors goes through a convert node.
      values = values.map((value, i) => {
        if (nodeTypes[i] !== 'float' || target === 'float') return value;
        const convert = library.variants('convert').find(candidate => nodeType(candidate) === target && candidate.inputs[0]?.type === 'float');
        if (!convert) return value;
        const node = createNode(convert);
        assign(node, convert.inputs[0]!.name, value);
        nodeTypes[i] = target;
        types[i] = target;
        return outputRef(node, convert.outputs[0]!);
      });
      def = find(values);
    }
    if (!def) throw new ScriptError(`No ${category} NodeDef combines ${types.join(' and ')}.`);
    const node = createNode(def);
    values.forEach((value, i) => assign(node, def!.inputs[i]!.name, value));
    return outputRef(node, def.outputs[0]!);
  };
  const componentwise = (a: unknown, b: unknown, apply: (x: number, y: number) => number): unknown => {
    if (Array.isArray(a) || Array.isArray(b)) {
      const size = Array.isArray(a) ? a.length : (b as unknown[]).length;
      if (Array.isArray(a) && Array.isArray(b) && a.length !== b.length) throw new ScriptError('Arrays of different sizes cannot be combined.');
      return Array.from({ length: size }, (_, i) =>
        apply(Array.isArray(a) ? a[i] as number : a as number, Array.isArray(b) ? b[i] as number : b as number));
    }
    return apply(a as number, b as number);
  };
  const arithmetic: Record<string, (x: number, y: number) => number> = {
    '+': (x, y) => x + y, '-': (x, y) => x - y, '*': (x, y) => x * y, '/': (x, y) => x / y, '%': (x, y) => x % y, '**': (x, y) => x ** y,
  };
  const mx = {
    op: (operator: string, a: unknown, b: unknown): unknown => {
      if (isNodeValue(a) || isNodeValue(b)) return mathNode(OPERATOR_NODES[operator]!, [a, b]);
      if (operator === '+' && (typeof a === 'string' || typeof b === 'string')) return String(a) + String(b);
      if (Array.isArray(a) || Array.isArray(b)) return componentwise(a, b, arithmetic[operator]!);
      return arithmetic[operator]!(a as number, b as number);
    },
    neg: (a: unknown): unknown => {
      if (isNodeValue(a)) return mathNode('multiply', [a, -1]);
      return Array.isArray(a) ? a.map(component => -component) : -(a as number);
    },
    cmp: (operator: string, left: unknown, right: unknown): unknown => {
      if (isNodeValue(left) || isNodeValue(right)) {
        const comparison: Comparison = Object.freeze({ [COMPARISON]: { operator, left, right } });
        return comparison;
      }
      const [a, b] = [left as number, right as number];
      switch (operator) {
        case '>': return a > b;
        case '>=': return a >= b;
        case '<': return a < b;
        case '<=': return a <= b;
        case '==': return a === b;
        default: return a !== b;
      }
    },
    cond: (test: unknown, consequent: () => unknown, alternate: () => unknown): unknown => {
      const comparison = comparisonOf(test);
      if (comparison) {
        const { operator, left, right } = comparison;
        const [a, b] = [consequent(), alternate()];
        // ifgreater/ifgreatereq/ifequal output in1 when value1 >, >= or == value2, else in2.
        if (operator === '>') return conditionalNode('ifgreater', left, right, [a, b]);
        if (operator === '<') return conditionalNode('ifgreater', right, left, [a, b]);
        if (operator === '>=') return conditionalNode('ifgreatereq', left, right, [a, b]);
        if (operator === '<=') return conditionalNode('ifgreatereq', right, left, [a, b]);
        return conditionalNode('ifequal', left, right, operator === '==' ? [a, b] : [b, a]);
      }
      const source = sourceOf(test);
      if (source) {
        if (source.output.type !== 'boolean') {
          throw new ScriptError(`condition ? a : b needs a comparison or a boolean output, not ${source.output.type}.`);
        }
        return conditionalNode('ifequal', test, true, [consequent(), alternate()]);
      }
      return test ? consequent() : alternate();
    },
    and: (left: unknown, right: () => unknown): unknown => isNodeValue(left) ? logicNode('and', [asValue(left), right()]) : left && right(),
    or: (left: unknown, right: () => unknown): unknown => isNodeValue(left) ? logicNode('or', [asValue(left), right()]) : left || right(),
    not: (value: unknown): unknown => isNodeValue(value) ? logicNode('not', [value]) : !value,
    test: (value: unknown): unknown => {
      if (comparisonOf(value) || nodeOf(value) || (value as Partial<OutputRef> | null)?.[OUTPUT]) {
        throw new ScriptError('A condition on node outputs is evaluated per pixel: use condition ? a : b instead of if, while or for.');
      }
      return value;
    },
  };
  const math = new Proxy(Math, {
    get: (target, key) => {
      const value = Reflect.get(target, key) as unknown;
      const category = typeof key === 'string' ? MATH_NODES[key] : undefined;
      if (!category || typeof value !== 'function') return value;
      return (...args: unknown[]) => args.some(isNodeValue) ? mathNode(category, args) : (value as (...values: unknown[]) => unknown)(...args);
    },
  });

  // --- Viewer -----------------------------------------------------------------
  let queue: Promise<void> = Promise.resolve();
  const settings = new Map<string, unknown>();
  const command = (): void => { graph.viewerCommands++; };
  // A dry run does not load the scene requested by `scene()`: scene queries then answer as for an empty scene.
  let sceneRequested = false;
  const sceneQueries = (): ScriptHost | undefined => (host || !sceneRequested ? queries : undefined);
  let scriptedTime: number | undefined;
  /**
   * Queue a viewer action after the previous ones; awaiting it is optional. A failure the script
   * does not await stops the following viewer commands; an awaited one is the script's to handle.
   */
  const action = (run: (target: ScriptHost) => Promise<void>): PromiseLike<void> => {
    command();
    let observed = false;
    const next = queue.then(() => (host ? run(host) : undefined));
    queue = next.catch((error: unknown) => { if (!observed) throw error; });
    // A plain thenable: `await` calls its `then`, which tells whether the script observes the result.
    return {
      then: (onFulfilled, onRejected) => {
        observed = true;
        return next.then(onFulfilled, onRejected);
      },
    };
  };
  const upstream = (root: ScriptNode): ScriptNode[] => {
    const seen = new Set<ScriptNode>();
    const visit = (node: ScriptNode): void => {
      if (seen.has(node)) return;
      seen.add(node);
      for (const input of node.inputs.values()) if ('node' in input) visit(input.node);
    };
    visit(root);
    return graph.nodes.filter(node => seen.has(node));
  };
  const materialDocument = (material: unknown): { xml: string } | { url: string } => {
    if (typeof material === 'string') return { url: new URL(material, baseUrl).href };
    const source = sourceOf(material);
    if (!source || (source.output.type !== 'surfaceshader' && source.output.type !== 'material')) {
      throw new ScriptError('assign(object, material) expects a surface shader, a material node or a .mtlx path.');
    }
    const nodes = upstream(source.node);
    for (const node of nodes) if (pending.has(node)) nameNode(node, node.def.category);
    return { xml: toXml({ nodes }, library, options.filePrefix ? { filePrefix: options.filePrefix } : {}) };
  };
  const renderFunction = new Proxy(async function render(samples?: unknown): Promise<number> {
    if (samples !== undefined && !(Number.isInteger(samples) && (samples as number) > 0)) {
      throw new ScriptError('render(samples) expects a positive integer.');
    }
    command();
    await queue;
    return host ? host.render(samples as number | undefined) : 0;
  }, {
    get: (target, key) => {
      if (typeof key !== 'string' || !(key in RENDER_SETTINGS)) return Reflect.get(target, key) as unknown;
      return settings.has(key) ? settings.get(key) : queries?.renderSettings()[key];
    },
    set: (_target, key, value) => {
      if (typeof key !== 'string') return false;
      checkRenderSetting(key, value);
      settings.set(key, value);
      command();
      if (host) queue = queue.then(() => host.setRenderSetting(key, value));
      return true;
    },
  });
  /** Add nodes read from a document or an object material to the script; returns the material handle. */
  const importNodes = (nodes: readonly ScriptNode[], label: string): object => {
    for (const node of nodes) {
      nameNode(node, node.name);
      graph.nodes.push(node);
    }
    const material = nodes.find(node => nodeType(node.def) === 'material') ??
      [...nodes].reverse().find(node => nodeType(node.def) === 'surfaceshader');
    if (!material) throw new ScriptError(`${label} has no surface material.`);
    return handleFor(material);
  };
  const viewer: Record<string, unknown> = {
    scene: async (entry: unknown): Promise<void> => {
      if (typeof entry !== 'string' || !entry) throw new ScriptError('scene(entry) expects a scene path.');
      command();
      sceneRequested = true;
      scriptedTime = undefined;
      await queue;
      await host?.loadScene(entry);
    },
    objects: (): string[] => [...sceneQueries()?.objects() ?? []],
    render: renderFunction,
    assign: async (object: unknown, material: unknown): Promise<void> => {
      if (typeof object !== 'string' || !object) throw new ScriptError('assign(object, material) expects an object path.');
      const document = materialDocument(material);
      command();
      await queue;
      await host?.assignMaterial(object, document);
    },
    load: async (path: unknown): Promise<object> => {
      if (typeof path !== 'string' || !path) throw new ScriptError('load(path) expects a .mtlx path.');
      const url = new URL(path, baseUrl).href;
      const loaded = fromXml(await inlineIncludes(await fetchText(url), url, fetchText), library);
      for (const node of loaded.nodes) {
        for (const [name, input] of node.inputs) {
          if ('value' in input && typeof input.value === 'string' && input.value && inputDef(node, name).type === 'filename' &&
              !isAbsoluteFile(input.value)) {
            node.inputs.set(name, { value: new URL(input.value, url).href });
          }
        }
      }
      return importNodes(loaded.nodes, path);
    },
    material: (object: unknown): object => {
      if (typeof object !== 'string' || !object) throw new ScriptError('material(object) expects an object path.');
      if (!queries) throw new ScriptError('material(object) needs the viewer.');
      const current = queries.objectMaterial(object);
      if (!current) throw new ScriptError(`${object} has no MaterialX material.`);
      return importNodes(fromResolvedGraph(current.graph, library, current.name).nodes, object);
    },
    node: (name: unknown): object => {
      const node = graph.nodes.find(candidate => candidate.name === name && !pending.has(candidate));
      if (!node) {
        const names = graph.nodes.filter(candidate => !pending.has(candidate)).map(candidate => candidate.name);
        throw new ScriptError(`No node named "${String(name)}". Nodes: ${names.join(', ') || 'none'}.`);
      }
      return handleFor(node);
    },
    save: async (name: unknown, material?: unknown): Promise<void> => {
      if (typeof name !== 'string' || !name || /(^|[\\/])\.\.([\\/]|$)/.test(name)) {
        throw new ScriptError('save(name) expects a file name, e.g. save("render.png") or save("material.mtlx", surface).');
      }
      const document = material === undefined ? undefined : materialDocument(material);
      if (document && !('xml' in document)) throw new ScriptError('save(name, material) expects a material of the script.');
      if (!document && !/\.(png|pfm|json)$/i.test(name)) {
        throw new ScriptError('save(name) writes the render (.png), the selected AOV (.pfm) or the diagnostics (.json).');
      }
      command();
      await queue;
      if (document) await host?.saveText(name, document.xml);
      else if (/\.pfm$/i.test(name)) await host?.saveAov(name);
      else if (/\.json$/i.test(name)) await host?.saveDiagnostics(name);
      else await host?.saveImage(name);
    },
    stats: (): ScriptStats => {
      const stats = queries?.stats();
      const backend = String(settings.get('backend') ?? 'raster');
      return stats ? { ...stats, gpuMemory: { ...stats.gpuMemory } } : {
        backend, drawnBy: backend, pathTracer: 'idle',
        samples: 0, adaptive: false, paused: false, time: scriptedTime ?? 0, warnings: 0,
        gpuMemory: { total: 0, peak: 0, textures: 0, buffers: 0, textureLimit: 0 },
      };
    },
    converge: async (timeout: unknown = 600): Promise<ScriptStats> => {
      if (typeof timeout !== 'number' || !(timeout > 0)) throw new ScriptError('converge(seconds) expects a positive time limit.');
      command();
      await queue;
      await host?.waitForStop(timeout);
      return (viewer['stats'] as () => ScriptStats)();
    },
    capture: async (name: unknown, options: unknown): Promise<void> => {
      if (typeof name !== 'string' || !/\.png$/i.test(name) || /(^|[\\/])\.\.([\\/]|$)/.test(name)) {
        throw new ScriptError('capture(name, { samples }) expects a .png file name.');
      }
      const { samples, shutter, steps, ...extra } = (options ?? {}) as Record<string, unknown>;
      if (Object.keys(extra).length) throw new ScriptError(`capture: unknown options ${Object.keys(extra).join(', ')}. Options: samples, shutter, steps.`);
      if (!(Number.isInteger(samples) && (samples as number) > 0)) throw new ScriptError('capture(name, { samples }) expects a positive integer of samples.');
      let interval: { open: number; close: number; steps?: number } | undefined;
      if (shutter !== undefined) {
        const [open, close] = finiteNumbers(shutter, 2, 'capture shutter');
        if (close! < open!) throw new ScriptError('capture shutter expects [open, close] with open <= close.');
        if (steps !== undefined && !(Number.isInteger(steps) && (steps as number) > 0)) throw new ScriptError('capture steps expects a positive integer.');
        interval = { open: open!, close: close!, ...(steps !== undefined ? { steps: steps as number } : {}) };
      } else if (steps !== undefined) throw new ScriptError('capture steps needs a shutter.');
      command();
      await queue;
      await host?.capture(name, { samples: samples as number, ...(interval ? { shutter: interval } : {}) });
    },
    diagnostics: (): { level: string; code?: string; message: string }[] =>
      (queries?.diagnostics() ?? []).map(record => ({ ...record })),
    capabilities: (): unknown => queries?.capabilities(),
    timeline: (): { start: number; end: number; fps: number } | undefined => {
      const timeline = sceneQueries()?.timeline();
      return timeline ? { ...timeline } : undefined;
    },
    time: (): number => scriptedTime ?? sceneQueries()?.time() ?? 0,
    setTime: (time: unknown): PromiseLike<void> => {
      if (typeof time !== 'number' || !Number.isFinite(time)) throw new ScriptError('setTime(time) expects a finite time code.');
      scriptedTime = time;
      return action(target => target.setTime(time));
    },
    transform: (spec: unknown): number[] => transformMatrix(spec),
    setTransform: (object: unknown, matrix?: unknown): PromiseLike<void> => {
      const path = objectPath('setTransform(object, matrix)', object);
      const values = matrix === undefined ? undefined : finiteNumbers(matrix, 16, 'setTransform matrix');
      return action(target => target.setTransform(path, values));
    },
    setVisibility: (object: unknown, visible?: unknown): PromiseLike<void> => {
      const path = objectPath('setVisibility(object, visible)', object);
      if (visible !== undefined && typeof visible !== 'boolean') throw new ScriptError('setVisibility(object, visible) expects a boolean.');
      return action(target => target.setVisibility(path, visible));
    },
    lights: (): { path: string; type: string }[] => (sceneQueries()?.lights() ?? []).map(light => ({ ...light })),
    setLight: (light: unknown, changes?: unknown): PromiseLike<void> => {
      const path = objectPath('setLight(light, changes)', light);
      const parsed = changes === undefined ? undefined : lightChanges(changes);
      return action(target => target.setLight(path, parsed));
    },
    setCamera: (camera: unknown): PromiseLike<void> => {
      const { eye, target: aim, fov, ...extra } = (camera ?? {}) as Record<string, unknown>;
      if (Object.keys(extra).length) throw new ScriptError(`setCamera: unknown fields ${Object.keys(extra).join(', ')}. Fields: eye, target, fov.`);
      if (fov !== undefined && !(typeof fov === 'number' && fov > 0 && fov < 180)) throw new ScriptError('setCamera fov expects degrees in (0, 180).');
      const placed = { eye: finiteNumbers(eye, 3, 'setCamera eye'), target: finiteNumbers(aim, 3, 'setCamera target'),
        ...(fov !== undefined ? { fov: fov as number } : {}) };
      return action(target => target.setCamera(placed));
    },
    variants: (): { path: string; set: string; variants: string[]; selection?: string }[] =>
      (sceneQueries()?.variants() ?? []).map(set => ({ ...set, variants: [...set.variants] })),
    setVariant: (path: unknown, set: unknown, variant: unknown): PromiseLike<void> => {
      if (typeof path !== 'string' || typeof set !== 'string' || typeof variant !== 'string' || !path || !set || !variant) {
        throw new ScriptError('setVariant(path, set, variant) expects three names.');
      }
      return action(target => target.setVariant(path, set, variant));
    },
    materialParameters: (object: unknown) => {
      const path = objectPath('materialParameters(object)', object);
      return (sceneQueries()?.materialParameters(path) ?? []).map(parameter => ({ ...parameter, value: [...parameter.value] }));
    },
    setMaterialParameters: (object: unknown, values: unknown): PromiseLike<void> => {
      const path = objectPath('setMaterialParameters(object, values)', object);
      if (typeof values !== 'object' || values === null || Array.isArray(values)) {
        throw new ScriptError('setMaterialParameters(object, values) expects { id: value }.');
      }
      const changes = new Map(Object.entries(values).map(([id, value]): [string, number[]] => [id,
        typeof value === 'boolean' ? [value ? 1 : 0] : typeof value === 'number' ? finiteNumbers([value], 1, `parameter ${id}`)
          : finiteNumbers(value, undefined, `parameter ${id}`)]));
      return action(target => target.setMaterialParameters(path, changes));
    },
    log: (...values: unknown[]): void => {
      const message = values.map(value => typeof value === 'string' ? value
        : (value as Partial<OutputRef> | null)?.[OUTPUT] || nodeOf(value) ? String(value) : JSON.stringify(value)).join(' ');
      graph.logs.push(message);
      queries?.log?.(message);
    },
    // Validation runs (dry runs) do not load scenes: their checks would be meaningless.
    check: (condition: unknown, message: unknown): void => {
      if (typeof message !== 'string' || !message) throw new ScriptError('check(condition, message) expects a message.');
      if (options.dryRun) return;
      if (!condition) throw new ScriptError(`Check failed: ${message}`);
      (viewer['log'] as (text: string) => void)(`OK  ${message}`);
    },
  };

  // --- Scope ------------------------------------------------------------------
  const classes = new Map<string, unknown>();
  const classFor = (identifier: string): unknown => {
    if (classes.has(identifier)) return classes.get(identifier);
    const category = library.categoryOf(identifier);
    const create = category === undefined ? undefined : function (this: unknown, variant?: unknown): object {
      if (!new.target) throw new ScriptError(`Use "new ${identifier}()".`);
      if (variant !== undefined && typeof variant !== 'string') throw new ScriptError(`new ${identifier}(type) expects a type name.`);
      return handleFor(createNode(library.resolve(category, variant)));
    };
    classes.set(identifier, create);
    return create;
  };

  const variables = new Map<string, unknown>();
  const scope = new Proxy(Object.create(null) as object, {
    has: (_target, key) => typeof key === 'string' &&
      (variables.has(key) || SCRIPT_GLOBALS.has(key) || classFor(key) !== undefined || !(key in globalThis)),
    get: (_target, key) => {
      if (typeof key !== 'string') return undefined;
      if (key === Symbol.unscopables as unknown) return undefined;
      if (variables.has(key)) return variables.get(key);
      if (key === '__mx') return mx;
      if (key === 'Math') return math;
      if (key in viewer) return viewer[key];
      const create = classFor(key);
      if (create) return create;
      throw new ScriptError(`${key} is not defined.`);
    },
    set: (_target, key, value) => {
      if (typeof key !== 'string') return false;
      // `material`, `node`... are also the natural names of nodes; assigning them shadows the functions.
      if (SCRIPT_GLOBALS.has(key) && !SHADOWABLE_GLOBALS.has(key)) throw new ScriptError(`${key} is reserved by material scripts.`);
      if (classFor(key)) throw new ScriptError(`${key} is a node type and cannot be reassigned.`);
      variables.set(key, value);
      const node = nodeOf(value) ?? (value as Partial<OutputRef> | null)?.[OUTPUT]?.node;
      if (node && pending.has(node)) nameNode(node, key);
      return true;
    },
  });

  const body = transformScript(code);
  let run: (scope: object) => Promise<void>;
  try {
    run = new AsyncFunction('scope', `with (scope) {\n${body}\n}`);
  } catch (error) {
    throw new ScriptError(`Syntax error: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    await run(scope);
    await queue;
  } catch (error) {
    if (error instanceof ScriptError && error.line !== undefined) throw error;
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
  const inputs = element.children.filter(child => child.tag === 'input')
    .map(child => ({ name: child.attributes.get('name') ?? '', type: child.attributes.get('type') }));
  return matchNodeDef(library, element.tag, element.attributes.get('type'), inputs, undefined, element.attributes.get('name') ?? '');
}

/** MaterialX elements that do not describe shading nodes (geometry bindings, layout, metadata). */
const IGNORED_ELEMENTS = new Set([
  'look', 'lookgroup', 'materialassign', 'collection', 'geominfo', 'geomprop', 'propertyset', 'propertysetassign',
  'variantset', 'variantassign', 'visibility', 'backdrop', 'token', 'unitdef', 'unittypedef', 'typedef',
  'attributedef', 'targetdef', 'nodedef', 'implementation',
]);

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
 * Read a MaterialX document whose nodes are defined by `library` or by the document's own NodeDefs.
 * Node graphs are flattened: their nodes join the script, graph outputs connect to the node behind
 * them, and interface inputs are replaced by the value or connection they receive. A node of a
 * document NodeDef is replaced by the nodes of its nodegraph implementation, fed by the node's
 * inputs or the NodeDef defaults. `<xi:include>` must be inlined first (`inlineIncludes`).
 */
export function fromXml(xml: string, library: ScriptLibrary): ScriptGraph {
  const graph: ScriptGraph = { nodes: [] };
  const pending: Array<{ node: ScriptNode; element: XmlElement; scope: DocumentScope; localName: string }> = [];
  const prefixOf = (element: XmlElement, inherited: string): string => element.attributes.get('fileprefix') ?? inherited;
  const root = materialxRoot(xml);

  // Document NodeDefs, by category, and their nodegraph implementations.
  const nodeDefElements = new Map<string, XmlElement>();
  const implementations = new Map<string, XmlElement>();
  for (const child of root.children) {
    const name = child.attributes.get('name');
    if (child.tag === 'nodedef' && name && child.attributes.get('node')) nodeDefElements.set(name, child);
    const implemented = child.attributes.get('nodedef');
    if (child.tag === 'nodegraph' && implemented) implementations.set(implemented, child);
  }
  const customDefs = readNodeDefs(nodeDefElements);
  const custom = new Map<string, ScriptNodeDef[]>();
  for (const def of [...customDefs.defs, ...customDefs.versions]) custom.set(def.category, [...(custom.get(def.category) ?? []), def]);
  const customDef = (element: XmlElement): ScriptNodeDef | undefined => {
    const candidates = custom.get(element.tag);
    if (!candidates) return undefined;
    const explicit = element.attributes.get('nodedef');
    const type = element.attributes.get('type');
    return explicit ? candidates.find(def => def.name === explicit)
      : candidates.find(def => !type || nodeType(def) === type) ?? candidates[0];
  };

  const newScope = (name: string, parent: DocumentScope, filePrefix: string): DocumentScope => ({
    path: parent.path ? `${parent.path}_${name}` : name, parent, filePrefix,
    nodes: new Map(), graphs: new Map(), outputs: new Map(), interface: new Map(),
  });
  const collect = (element: XmlElement, scope: DocumentScope, expanding: readonly string[]): void => {
    for (const child of element.children) {
      const name = child.attributes.get('name');
      if (IGNORED_ELEMENTS.has(child.tag)) continue;
      if (child.tag === 'xi:include') {
        throw new ScriptError(`<xi:include href="${child.attributes.get('href') ?? ''}"> must be inlined before reading the document.`);
      }
      if (!name) throw new ScriptError(`<${child.tag}> has no name.`);
      if (child.tag === 'output') {
        scope.outputs.set(name, child);
      } else if (child.tag === 'input') {
        if (!scope.parent) throw new ScriptError(`Document-level <input> "${name}" is not supported.`);
        scope.interface.set(name, child);
      } else if (child.tag === 'nodegraph') {
        // NodeDef implementations are expanded where their nodes are used.
        if (child.attributes.has('nodedef')) continue;
        if (scope.graphs.has(name) || scope.nodes.has(name)) throw new ScriptError(`Duplicate name "${name}".`);
        const graphScope = newScope(name, scope, prefixOf(child, scope.filePrefix));
        scope.graphs.set(name, graphScope);
        collect(child, graphScope, expanding);
      } else if (customDef(child)) {
        if (scope.nodes.has(name) || scope.graphs.has(name)) throw new ScriptError(`Duplicate node name "${name}".`);
        const def = customDef(child)!;
        if (expanding.includes(def.name)) throw new ScriptError(`NodeDef "${def.name}" is implemented recursively.`);
        const implementation = implementations.get(def.name);
        if (!implementation) throw new ScriptError(`NodeDef "${def.name}" has no nodegraph implementation in the document.`);
        const instance = newScope(name, scope, prefixOf(child, scope.filePrefix));
        scope.graphs.set(name, instance);
        collect(implementation, instance, [...expanding, def.name]);
        for (const input of child.children.filter(element => element.tag === 'input')) {
          const inputName = input.attributes.get('name') ?? '';
          if (!def.inputs.some(port => port.name === inputName)) {
            throw new ScriptError(`${def.category} (${def.name}) has no input "${inputName}".`);
          }
        }
        for (const port of def.inputs) {
          const authored = child.children.find(input => input.tag === 'input' && input.attributes.get('name') === port.name);
          const declared = new Map([['name', port.name], ['type', port.type]]);
          if (port.default !== undefined) declared.set('value', formatXmlValue(port.default));
          // Without a usable default, the implementation node keeps its own default.
          instance.interface.set(port.name, authored ?? { tag: 'input', children: [], attributes: declared });
        }
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
  const document: DocumentScope = {
    path: '', filePrefix: prefixOf(root, ''), nodes: new Map(), graphs: new Map(), outputs: new Map(), interface: new Map(),
  };
  collect(root, document, []);

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
      // Multi-output nodes may declare their outputs; connections name them explicitly.
      if (child.tag === 'output') continue;
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
    // Engine-materialized defaults do not identify the authored NodeDef variant.
    const authored = node.inputs.filter(input => !input.defaulted && (input.source.kind === 'value' || input.source.kind === 'connection'));
    const def = matchNodeDef(library, node.category, node.type,
      authored.map(input => ({ name: input.name, type: input.type })), node.nodeDef?.name, id);
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
    if (RESERVED.has(name) || (SCRIPT_GLOBALS.has(name) && !SHADOWABLE_GLOBALS.has(name)) ||
        library.categoryOf(name) !== undefined) name = `${name}_`;
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
