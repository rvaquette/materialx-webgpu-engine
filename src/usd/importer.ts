// USDA composition adapter (plan section 8, T017). Parses the text USDA layers
// of the target corpus and composes them into a renderer-neutral SceneAsset:
// subLayers, over opinions, references (MaterialX recorded; binary deferred),
// inherits (tolerant of dangling __class_mtl__), payloads (deferred),
// material:binding with strength, xformOpOrder, subdivision/refinement tags and
// primvars. Binary crate (.usd PXR-USDC) geometry/camera/light payloads are not
// decoded here; they are a separate crate reader (docs/usd-import.md section 3).
// No asset path is silently remapped (REQ-013): unresolved inputs are reported.

import type { Diagnostic, DiagnosticSink } from '../core/diagnostics.ts';
import type {
  AttributeValue,
  MaterialBinding,
  MaterialXReference,
  MeshInfo,
  PrimAttribute,
  PrimReference,
  PrimRelationship,
  PrimSpecifier,
  PrimvarInfo,
  SceneAsset,
  StageInfo,
  XformOp,
} from '../scene/types.ts';

export class UsdImportError extends Error {
  override readonly name = 'UsdImportError';
}

/** Supplies the text of a USD layer by URI. Tests inject an in-memory map. */
export interface UsdLayerReader {
  read(uri: string): Promise<string>;
}

export interface UsdImportOptions {
  reader: UsdLayerReader;
  sink?: DiagnosticSink;
  /** Guards against pathological subLayer/reference cycles. */
  maxDepth?: number;
  /**
   * Follow payload and non-MaterialX reference arcs through the reader and graft
   * the composed external prims under the referencing prim (T049). When false
   * (default) these arcs are only recorded and reported as deferred.
   */
  resolveArcs?: boolean;
}

// --- Scanner -----------------------------------------------------------------

type TokenKind = 'punct' | 'string' | 'asset' | 'path' | 'word';
interface Token {
  kind: TokenKind;
  value: string;
}

const PUNCT = new Set(['{', '}', '(', ')', '[', ']', '=']);
const WORD_STOP = new Set([' ', '\t', '\r', '\n', '{', '}', '(', ')', '[', ']', '=', ',', '"', '@', '<', '#']);

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = source.length;
  while (i < n) {
    const c = source[i]!;
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n' || c === ',') {
      i += 1;
      continue;
    }
    if (c === '#') {
      while (i < n && source[i] !== '\n') i += 1;
      continue;
    }
    if (PUNCT.has(c)) {
      tokens.push({ kind: 'punct', value: c });
      i += 1;
      continue;
    }
    if (c === '"') {
      // Triple-quoted docstrings and plain strings.
      if (source[i + 1] === '"' && source[i + 2] === '"') {
        i += 3;
        const start = i;
        while (i < n && !(source[i] === '"' && source[i + 1] === '"' && source[i + 2] === '"')) i += 1;
        tokens.push({ kind: 'string', value: source.slice(start, i) });
        i += 3;
      } else {
        i += 1;
        let value = '';
        while (i < n && source[i] !== '"') {
          if (source[i] === '\\' && i + 1 < n) {
            i++;
            const escaped = source[i]!;
            value += escaped === 'n' ? '\n' : escaped === 't' ? '\t' : escaped;
          } else value += source[i];
          i++;
        }
        tokens.push({ kind: 'string', value });
        i += 1;
      }
      continue;
    }
    if (c === '@') {
      i += 1;
      const start = i;
      while (i < n && source[i] !== '@') i += 1;
      tokens.push({ kind: 'asset', value: source.slice(start, i) });
      i += 1;
      continue;
    }
    if (c === '<') {
      i += 1;
      const start = i;
      while (i < n && source[i] !== '>') i += 1;
      tokens.push({ kind: 'path', value: source.slice(start, i) });
      i += 1;
      continue;
    }
    const start = i;
    while (i < n && !WORD_STOP.has(source[i]!)) i += 1;
    // Keep an array-type suffix attached to the type word, e.g. `float2[]`.
    if (source[i] === '[' && source[i + 1] === ']') i += 2;
    tokens.push({ kind: 'word', value: source.slice(start, i) });
  }
  return tokens;
}

// --- Raw value model ---------------------------------------------------------

type RawValue =
  | { k: 'str'; v: string }
  | { k: 'num'; v: number }
  | { k: 'bool'; v: boolean }
  | { k: 'ident'; v: string }
  | { k: 'path'; v: string }
  | { k: 'ref'; asset?: string; path?: string }
  | { k: 'list'; items: RawValue[] }
  | { k: 'tuple'; items: RawValue[] }
  | { k: 'dict'; entries: Map<string, RawValue> };

interface LayerMetadata {
  defaultPrim?: string;
  upAxis?: string;
  metersPerUnit?: number;
  subLayers: string[];
}

interface PrimSpec {
  specifier: PrimSpecifier;
  typeName?: string;
  name: string;
  metadata: Map<string, RawValue>;
  references: PrimReference[];
  payloads: PrimReference[];
  inherits: string[];
  apiSchemas: string[];
  kind?: string;
  attributes: Map<string, PrimAttribute>;
  relationships: Map<string, RawRelationship>;
  children: PrimSpec[];
  xformOpOrder?: string[];
  xformValues: Map<string, { typeName: string; value?: AttributeValue }>;
}

interface RawRelationship {
  name: string;
  targets: string[];
  strength?: string;
  purpose?: string;
}

interface LayerSpec {
  uri: string;
  metadata: LayerMetadata;
  prims: PrimSpec[];
}

// --- Parser ------------------------------------------------------------------

class Parser {
  private pos = 0;
  constructor(private readonly tokens: Token[], private readonly uri: string) {}

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private next(): Token {
    const t = this.tokens[this.pos];
    if (!t) throw new UsdImportError(`Unexpected end of USDA in ${this.uri}.`);
    this.pos += 1;
    return t;
  }

  private expectPunct(value: string): void {
    const t = this.next();
    if (t.kind !== 'punct' || t.value !== value) {
      throw new UsdImportError(`Expected '${value}' in ${this.uri}, got '${t.value}'.`);
    }
  }

  parseLayer(): LayerSpec {
    const metadata: LayerMetadata = { subLayers: [] };
    const first = this.peek();
    if (first && first.kind === 'punct' && first.value === '(') {
      this.parseLayerMetadata(metadata);
    }
    const prims: PrimSpec[] = [];
    while (this.peek()) {
      prims.push(this.parsePrim());
    }
    return { uri: this.uri, metadata, prims };
  }

  private parseLayerMetadata(meta: LayerMetadata): void {
    this.expectPunct('(');
    while (true) {
      const t = this.peek();
      if (!t) throw new UsdImportError(`Unterminated layer metadata in ${this.uri}.`);
      if (t.kind === 'punct' && t.value === ')') {
        this.next();
        break;
      }
      if (t.kind === 'string') {
        this.next();
        continue; // documentation string
      }
      const key = this.readMetadataKey();
      this.expectPunct('=');
      const value = this.parseValue();
      if (key === 'defaultPrim') meta.defaultPrim = asString(value);
      else if (key === 'upAxis') meta.upAxis = asString(value);
      else if (key === 'metersPerUnit') {
        const m = asNumber(value);
        if (m !== undefined) meta.metersPerUnit = m;
      } else if (key === 'subLayers') {
        for (const r of toReferences(value)) {
          if (r.assetPath !== undefined) meta.subLayers.push(r.assetPath);
        }
      }
    }
  }

  private readMetadataKey(): string {
    // Skip list-edit operators and collect the key identifier.
    let t = this.next();
    while (t.kind === 'word' && LIST_EDIT_OPS.has(t.value)) t = this.next();
    return t.value;
  }

  private parsePrim(): PrimSpec {
    const specTok = this.next();
    if (specTok.kind !== 'word' || !SPECIFIERS.has(specTok.value)) {
      throw new UsdImportError(`Expected prim specifier in ${this.uri}, got '${specTok.value}'.`);
    }
    const specifier = specTok.value as PrimSpecifier;
    let typeName: string | undefined;
    let name: string;
    const t = this.next();
    if (t.kind === 'word') {
      typeName = t.value;
      const nameTok = this.next();
      if (nameTok.kind !== 'string') {
        throw new UsdImportError(`Expected prim name string in ${this.uri}, got '${nameTok.value}'.`);
      }
      name = nameTok.value;
    } else if (t.kind === 'string') {
      name = t.value;
    } else {
      throw new UsdImportError(`Expected prim name in ${this.uri}, got '${t.value}'.`);
    }

    const prim: PrimSpec = {
      specifier,
      ...(typeName !== undefined ? { typeName } : {}),
      name,
      metadata: new Map(),
      references: [],
      payloads: [],
      inherits: [],
      apiSchemas: [],
      attributes: new Map(),
      relationships: new Map(),
      children: [],
      xformValues: new Map(),
    };

    const afterName = this.peek();
    if (afterName && afterName.kind === 'punct' && afterName.value === '(') {
      this.parsePrimMetadata(prim);
    }
    this.expectPunct('{');
    this.parsePrimBody(prim);
    return prim;
  }

  private parsePrimMetadata(prim: PrimSpec): void {
    this.expectPunct('(');
    while (true) {
      const t = this.peek();
      if (!t) throw new UsdImportError(`Unterminated prim metadata in ${this.uri}.`);
      if (t.kind === 'punct' && t.value === ')') {
        this.next();
        break;
      }
      if (t.kind === 'string') {
        this.next();
        continue;
      }
      const key = this.readMetadataKey();
      this.expectPunct('=');
      const value = this.parseValue();
      if (key === 'references') prim.references.push(...toReferences(value));
      else if (key === 'payload') prim.payloads.push(...toReferences(value));
      else if (key === 'inherits') {
        for (const r of toReferences(value)) if (r.primPath !== undefined) prim.inherits.push(r.primPath);
      } else if (key === 'apiSchemas') prim.apiSchemas.push(...toStringList(value));
      else if (key === 'kind') prim.kind = asString(value);
      else prim.metadata.set(key, value);
    }
  }

  private parsePrimBody(prim: PrimSpec): void {
    while (true) {
      const t = this.peek();
      if (!t) throw new UsdImportError(`Unterminated prim body in ${this.uri}.`);
      if (t.kind === 'punct' && t.value === '}') {
        this.next();
        break;
      }
      if (t.kind === 'word' && SPECIFIERS.has(t.value)) {
        prim.children.push(this.parsePrim());
        continue;
      }
      this.parseMember(prim);
    }
  }

  private parseMember(prim: PrimSpec): void {
    // Collect leading qualifiers (custom/uniform/varying) and the declared type.
    const words: string[] = [];
    while (true) {
      const t = this.peek();
      if (!t) throw new UsdImportError(`Unterminated member in ${this.uri}.`);
      if (t.kind === 'word') {
        words.push(t.value);
        this.next();
        if (t.value === 'rel') {
          this.parseRelationship(prim);
          return;
        }
        if (words.filter(word => !['custom', 'uniform', 'varying', 'config'].includes(word)).length >= 2) break;
        // The member name is the last word; stop once an '=' or '(' follows.
        const nxt = this.peek();
        if (nxt && nxt.kind === 'punct' && (nxt.value === '=' || nxt.value === '(')) break;
        continue;
      }
      break;
    }
    this.parseAttribute(prim, words);
  }

  private parseRelationship(prim: PrimSpec): void {
    const nameTok = this.next();
    const name = nameTok.value;
    let strength: string | undefined;
    let purpose: string | undefined;
    const afterName = this.peek();
    if (afterName && afterName.kind === 'punct' && afterName.value === '(') {
      const relMeta = this.parseInlineMetadata();
      const s = relMeta.get('bindMaterialAs');
      if (s) strength = asString(s);
      const p = relMeta.get('materialPurpose') ?? relMeta.get('purpose');
      if (p) purpose = asString(p);
    }
    const targets: string[] = [];
    const eq = this.peek();
    if (eq && eq.kind === 'punct' && eq.value === '=') {
      this.next();
      const value = this.parseValue();
      for (const r of toReferences(value)) if (r.primPath !== undefined) targets.push(r.primPath);
    }
    if (this.peek()?.value === '(') {
      const meta = this.parseInlineMetadata();
      const s = meta.get('bindMaterialAs');
      if (s) strength = asString(s);
      const p = meta.get('materialPurpose') ?? meta.get('purpose');
      if (p) purpose = asString(p);
    }
    prim.relationships.set(name, {
      name,
      targets,
      ...(strength !== undefined ? { strength } : {}),
      ...(purpose !== undefined ? { purpose } : {}),
    });
  }

  private parseAttribute(prim: PrimSpec, words: string[]): void {
    // words = [...qualifiers, typeName, memberName]; typeName may carry [].
    if (words.length < 2) {
      throw new UsdImportError(`Malformed attribute near '${words.join(' ')}' in ${this.uri}: ${
        this.tokens.slice(Math.max(0, this.pos - 8), this.pos + 8).map(token => token.value).join(' ')
      }`);
    }
    const name = words[words.length - 1]!;
    const typeName = words[words.length - 2]!;
    let interpolation: string | undefined;
    const readMeta = () => {
      const attrMeta = this.parseInlineMetadata();
      const interp = attrMeta.get('interpolation');
      if (interp && interpolation === undefined) interpolation = asString(interp);
    };
    // Metadata may appear before the value (declaration-only form) ...
    const afterName = this.peek();
    if (afterName && afterName.kind === 'punct' && afterName.value === '(') {
      readMeta();
    }
    let value: AttributeValue | undefined;
    const eq = this.peek();
    if (eq && eq.kind === 'punct' && eq.value === '=') {
      this.next();
      const raw = this.parseValue();
      value = toAttributeValue(raw);
      // ... or after the value: `type name = [...] ( interpolation = "vertex" )`.
      const afterValue = this.peek();
      if (afterValue && afterValue.kind === 'punct' && afterValue.value === '(') {
        readMeta();
      }
    }

    if (name === 'xformOpOrder') {
      prim.xformOpOrder = value !== undefined ? toStringArray(value) : [];
      return;
    }
    if (name.startsWith('xformOp:')) {
      prim.xformValues.set(name, { typeName, ...(value !== undefined ? { value } : {}) });
      return;
    }
    prim.attributes.set(name, {
      name,
      typeName,
      ...(typeName === 'asset' ? { sourceLayer: this.uri } : {}),
      ...(value !== undefined ? { value } : {}),
      ...(interpolation !== undefined ? { interpolation } : {}),
    });
  }

  private parseInlineMetadata(): Map<string, RawValue> {
    this.expectPunct('(');
    const map = new Map<string, RawValue>();
    while (true) {
      const t = this.peek();
      if (!t) throw new UsdImportError(`Unterminated inline metadata in ${this.uri}.`);
      if (t.kind === 'punct' && t.value === ')') {
        this.next();
        break;
      }
      if (t.kind === 'string') {
        this.next();
        continue;
      }
      const key = this.readMetadataKey();
      this.expectPunct('=');
      map.set(key, this.parseValue());
    }
    return map;
  }

  private parseValue(): RawValue {
    const t = this.next();
    if (t.kind === 'string') return { k: 'str', v: t.value };
    if (t.kind === 'path') return { k: 'path', v: t.value };
    if (t.kind === 'asset') {
      const nxt = this.peek();
      if (nxt && nxt.kind === 'path') {
        this.next();
        return { k: 'ref', asset: t.value, path: nxt.value };
      }
      return { k: 'ref', asset: t.value };
    }
    if (t.kind === 'punct' && t.value === '[') return this.parseList(']');
    if (t.kind === 'punct' && t.value === '(') return this.parseList(')', true);
    if (t.kind === 'punct' && t.value === '{') {
      const entries = new Map<string, RawValue>();
      while (this.peek()?.value !== '}') {
        let key = this.next();
        while (this.peek()?.value !== '=') key = this.next();
        this.expectPunct('=');
        entries.set(key.value, this.parseValue());
      }
      this.expectPunct('}');
      return { k: 'dict', entries };
    }
    // word: number, bool, or identifier
    if (t.value === 'true') return { k: 'bool', v: true };
    if (t.value === 'false') return { k: 'bool', v: false };
    const num = Number(t.value);
    if (t.value !== '' && !Number.isNaN(num)) return { k: 'num', v: num };
    return { k: 'ident', v: t.value };
  }

  private parseList(close: string, tuple = false): RawValue {
    const items: RawValue[] = [];
    while (true) {
      const t = this.peek();
      if (!t) throw new UsdImportError(`Unterminated list in ${this.uri}.`);
      if (t.kind === 'punct' && t.value === close) {
        this.next();
        break;
      }
      items.push(this.parseValue());
    }
    return tuple ? { k: 'tuple', items } : { k: 'list', items };
  }
}

const SPECIFIERS = new Set(['def', 'over', 'class']);
const LIST_EDIT_OPS = new Set(['prepend', 'append', 'add', 'delete', 'reorder']);

// --- Raw value converters ----------------------------------------------------

function asString(v: RawValue): string {
  if (v.k === 'str' || v.k === 'ident') return v.v;
  if (v.k === 'path') return v.v;
  if (v.k === 'num') return String(v.v);
  if (v.k === 'bool') return String(v.v);
  if (v.k === 'ref') return v.asset ?? v.path ?? '';
  return '';
}

function asNumber(v: RawValue): number | undefined {
  return v.k === 'num' ? v.v : undefined;
}

function toReferences(v: RawValue): PrimReference[] {
  const out: PrimReference[] = [];
  const push = (item: RawValue): void => {
    if (item.k === 'ref') {
      out.push({
        ...(item.asset !== undefined ? { assetPath: item.asset } : {}),
        ...(item.path !== undefined ? { primPath: item.path } : {}),
        isMaterialX: item.asset !== undefined && item.asset.toLowerCase().endsWith('.mtlx'),
      });
    } else if (item.k === 'path') {
      out.push({ primPath: item.v, isMaterialX: false });
    }
  };
  if (v.k === 'list') v.items.forEach(push);
  else push(v);
  return out;
}

function toStringList(v: RawValue): string[] {
  if (v.k === 'list') return v.items.map(asString);
  return [asString(v)];
}

function toStringArray(v: AttributeValue): string[] {
  if (Array.isArray(v)) return (v as readonly unknown[]).map((x) => String(x));
  return [String(v)];
}

function toAttributeValue(v: RawValue): AttributeValue {
  if (v.k === 'dict') throw new UsdImportError('Dictionary-valued attributes are not supported.');
  if (v.k === 'str' || v.k === 'ident' || v.k === 'path') return v.k === 'ident' ? v.v : (v as { v: string }).v;
  if (v.k === 'num') return v.v;
  if (v.k === 'bool') return v.v;
  if (v.k === 'ref') return v.asset ?? v.path ?? '';
  // list/tuple: flatten numerically when possible, else collect strings.
  const nums: number[] = [];
  const strs: string[] = [];
  let numeric = true;
  const walk = (node: RawValue): void => {
    if (node.k === 'num') {
      nums.push(node.v);
      strs.push(String(node.v));
    } else if (node.k === 'list' || node.k === 'tuple') {
      node.items.forEach(walk);
    } else {
      numeric = false;
      strs.push(asString(node));
    }
  };
  walk(v);
  return numeric ? nums : strs;
}

// --- Path resolution ---------------------------------------------------------

function resolveRelative(baseUri: string, rel: string): string {
  if (/^https?:\/\//i.test(baseUri)) return new URL(rel, baseUri).href;
  if (/^[a-z]+:\/\//i.test(rel) || rel.startsWith('/')) return rel;
  const slash = baseUri.lastIndexOf('/');
  const baseDir = slash >= 0 ? baseUri.slice(0, slash + 1) : '';
  const segments = (baseDir + rel).split('/');
  const stack: string[] = [];
  for (const seg of segments) {
    if (seg === '' && stack.length > 0) continue;
    if (seg === '.') continue;
    if (seg === '..') {
      if (stack.length > 0) stack.pop();
      continue;
    }
    stack.push(seg);
  }
  return stack.join('/');
}

// --- Composition -------------------------------------------------------------

interface MutablePrim {
  path: string;
  name: string;
  specifier: PrimSpecifier;
  typeName?: string;
  kind?: string;
  apiSchemas: string[];
  inherits: string[];
  references: PrimReference[];
  payloads: PrimReference[];
  attributes: Map<string, PrimAttribute>;
  relationships: Map<string, PrimRelationship>;
  xformOps: XformOp[];
  children: string[];
  materialBinding?: MaterialBinding;
  mesh?: MeshInfo;
}

/** A payload/reference arc recorded for optional T049 graft resolution. */
interface ArcSource {
  kind: 'reference' | 'payload';
  /** Layer that authored the arc, for relative asset resolution. */
  layerUri: string;
  assetPath: string;
  /** Target prim path inside the external layer; defaults to its defaultPrim. */
  primPath?: string;
}

interface Composition {
  prims: Map<string, MutablePrim>;
  roots: string[];
  materials: MaterialXReference[];
  /** Non-MaterialX payload/reference arcs by referencing prim path. */
  arcs: Map<string, ArcSource[]>;
}

function buildXformOps(spec: PrimSpec): XformOp[] {
  const order = spec.xformOpOrder;
  const ops: XformOp[] = [];
  const names = order ?? [...spec.xformValues.keys()];
  for (const entry of names) {
    const invert = entry.startsWith('!invert!');
    const op = invert ? entry.slice('!invert!'.length) : entry;
    const found = spec.xformValues.get(op);
    ops.push({
      op,
      typeName: found?.typeName ?? 'token',
      ...(found?.value !== undefined ? { value: found.value } : {}),
      invert,
    });
  }
  return ops;
}

function buildMesh(spec: PrimSpec): MeshInfo | undefined {
  const primvars: PrimvarInfo[] = [];
  for (const attr of spec.attributes.values()) {
    if (attr.name.startsWith('primvars:')) {
      primvars.push({
        name: attr.name.slice('primvars:'.length),
        typeName: attr.typeName,
        ...(attr.interpolation !== undefined ? { interpolation: attr.interpolation } : {}),
      });
    }
  }
  const scheme = spec.attributes.get('subdivisionScheme');
  const level = spec.attributes.get('refinementLevel');
  const override = spec.attributes.get('refinementEnableOverride');
  const isMesh = spec.typeName === 'Mesh' || scheme !== undefined || primvars.length > 0;
  if (!isMesh) return undefined;
  return {
    ...(scheme?.value !== undefined ? { subdivisionScheme: String(scheme.value) } : {}),
    ...(typeof level?.value === 'number' ? { refinementLevel: level.value } : {}),
    ...(typeof override?.value === 'boolean' ? { refinementEnableOverride: override.value } : {}),
    primvars,
  };
}

function materialBindingOf(spec: PrimSpec): MaterialBinding | undefined {
  const rel = spec.relationships.get('material:binding');
  if (!rel || rel.targets.length === 0) return undefined;
  const target = rel.targets[0]!;
  const strength = rel.strength;
  return {
    target,
    ...(strength === 'weakerThanDescendants' || strength === 'strongerThanDescendants'
      ? { strength }
      : {}),
    ...(rel.purpose !== undefined ? { purpose: rel.purpose } : {}),
  };
}

class Composer {
  readonly comp: Composition = { prims: new Map(), roots: [], materials: [], arcs: new Map() };

  constructor(
    private readonly emit: (d: Diagnostic) => void,
    private readonly resolveArcsFlag: boolean,
  ) {}

  mergeLayer(layer: LayerSpec): void {
    for (const spec of layer.prims) {
      this.mergePrim(spec, '', layer.uri);
    }
  }

  private mergePrim(spec: PrimSpec, parentPath: string, layerUri: string): void {
    const path = `${parentPath}/${spec.name}`;
    let prim = this.comp.prims.get(path);
    if (!prim) {
      prim = {
        path,
        name: spec.name,
        specifier: spec.specifier,
        apiSchemas: [],
        inherits: [],
        references: [],
        payloads: [],
        attributes: new Map(),
        relationships: new Map(),
        xformOps: [],
        children: [],
      };
      this.comp.prims.set(path, prim);
      if (parentPath === '') this.comp.roots.push(path);
      else this.attachChild(parentPath, path);
    }

    // Specifier: a def anywhere wins over over/class.
    if (spec.specifier === 'def') prim.specifier = 'def';

    // First (strongest) writer wins for scalar facts.
    if (prim.typeName === undefined && spec.typeName !== undefined) prim.typeName = spec.typeName;
    if (prim.kind === undefined && spec.kind !== undefined) prim.kind = spec.kind;

    for (const s of spec.apiSchemas) if (!prim.apiSchemas.includes(s)) prim.apiSchemas.push(s);
    for (const s of spec.inherits) if (!prim.inherits.includes(s)) prim.inherits.push(s);

    for (const ref of spec.references) this.addReference(prim, prim.references, ref, path, layerUri);
    for (const pl of spec.payloads) this.addPayload(prim.payloads, pl, layerUri, path);

    for (const [name, attr] of spec.attributes) if (!prim.attributes.has(name)) prim.attributes.set(name, attr);
    for (const [name, rel] of spec.relationships) {
      if (!prim.relationships.has(name)) prim.relationships.set(name, { name: rel.name, targets: rel.targets });
    }

    if (prim.xformOps.length === 0) {
      const ops = buildXformOps(spec);
      if (ops.length > 0) prim.xformOps = ops;
    }
    if (prim.materialBinding === undefined) {
      const binding = materialBindingOf(spec);
      if (binding) prim.materialBinding = binding;
    }
    if (prim.mesh === undefined) {
      const mesh = buildMesh(spec);
      if (mesh) prim.mesh = mesh;
    }

    for (const child of spec.children) this.mergePrim(child, path, layerUri);
  }

  private attachChild(parentPath: string, childPath: string): void {
    const parent = this.comp.prims.get(parentPath);
    if (!parent) return;
    if (!parent.children.includes(childPath)) parent.children.push(childPath);
  }

  private addReference(
    prim: MutablePrim,
    bucket: PrimReference[],
    ref: PrimReference,
    path: string,
    layerUri: string,
  ): void {
    bucket.push(ref);
    if (ref.isMaterialX && ref.assetPath !== undefined && ref.primPath !== undefined) {
      const segs = ref.primPath.split('/').filter((x) => x.length > 0);
      const materialName = segs[segs.length - 1] ?? ref.primPath;
      this.comp.materials.push({
        primPath: path,
        assetPath: ref.assetPath,
        authoringLayer: layerUri,
        referencedPrimPath: ref.primPath,
        materialName,
      });
    } else if (ref.assetPath !== undefined) {
      this.recordArc(path, {
        kind: 'reference',
        layerUri,
        assetPath: ref.assetPath,
        ...(ref.primPath !== undefined ? { primPath: ref.primPath } : {}),
      });
      if (!this.resolveArcsFlag) {
        this.emit({
          level: 'info',
          message: `Non-MaterialX reference deferred to crate reader: ${ref.assetPath}`,
          detail: { prim: prim.path },
        });
      }
    }
  }

  private addPayload(
    bucket: PrimReference[],
    payload: PrimReference,
    layerUri: string,
    path: string,
  ): void {
    bucket.push(payload);
    if (payload.assetPath !== undefined) {
      this.recordArc(path, {
        kind: 'payload',
        layerUri,
        assetPath: payload.assetPath,
        ...(payload.primPath !== undefined ? { primPath: payload.primPath } : {}),
      });
      if (!this.resolveArcsFlag) {
        this.emit({
          level: 'info',
          message: `Payload deferred (loaded on demand): ${resolveRelative(layerUri, payload.assetPath)}`,
        });
      }
    }
  }

  private recordArc(primPath: string, arc: ArcSource): void {
    const list = this.comp.arcs.get(primPath);
    if (list) list.push(arc);
    else this.comp.arcs.set(primPath, [arc]);
  }
}

// --- Public entry ------------------------------------------------------------

interface ComposedTree {
  composition: Composition;
  metadata: LayerMetadata;
  /** Entry subLayer URIs resolved in strength order (strongest first). */
  resolvedSubLayers: string[];
}

/** Compose a layer and its subLayers (no arc following) into one Composition. */
async function composeLayerTree(
  entryUri: string,
  reader: UsdLayerReader,
  emit: (d: Diagnostic) => void,
  maxDepth: number,
  visited: Set<string>,
  resolveArcsFlag: boolean,
): Promise<ComposedTree> {
  const composer = new Composer(emit, resolveArcsFlag);

  // Depth-first over subLayers yields strongest-first order; merge accordingly.
  const visit = async (uri: string, depth: number): Promise<void> => {
    if (visited.has(uri)) {
      emit({ level: 'warning', message: `Skipping already-composed layer (cycle guard): ${uri}` });
      return;
    }
    if (depth > maxDepth) {
      throw new UsdImportError(`USDA subLayer depth exceeded ${maxDepth} at ${uri}.`);
    }
    visited.add(uri);

    let text: string;
    try {
      text = await reader.read(uri);
    } catch (cause) {
      emit({ level: 'error', message: `Cannot read USD layer: ${uri}`, detail: cause });
      return;
    }
    if (text.startsWith('PXR-USDC')) {
      emit({ level: 'info', message: `Binary crate layer deferred to crate reader: ${uri}` });
      return;
    }

    let layer: LayerSpec;
    try {
      layer = new Parser(tokenize(text), uri).parseLayer();
    } catch (cause) {
      emit({ level: 'error', message: `Failed to parse USDA layer: ${uri}`, detail: cause });
      return;
    }

    composer.mergeLayer(layer);
    for (const rel of layer.metadata.subLayers) {
      await visit(resolveRelative(uri, rel), depth + 1);
    }
  };

  let rootLayer: LayerSpec;
  try {
    const text = await reader.read(entryUri);
    if (text.startsWith('PXR-USDC')) {
      throw new UsdImportError(`Entry stage must be a text USDA layer, got binary crate: ${entryUri}.`);
    }
    rootLayer = new Parser(tokenize(text), entryUri).parseLayer();
  } catch (cause) {
    if (cause instanceof UsdImportError) throw cause;
    throw new UsdImportError(`Cannot read entry stage ${entryUri}: ${String(cause)}`);
  }

  visited.add(entryUri);
  composer.mergeLayer(rootLayer);
  const resolvedSubLayers = rootLayer.metadata.subLayers.map((p) => resolveRelative(entryUri, p));
  for (const rel of rootLayer.metadata.subLayers) {
    await visit(resolveRelative(entryUri, rel), 1);
  }

  return { composition: composer.comp, metadata: rootLayer.metadata, resolvedSubLayers };
}

/** Fill only the gaps of `dst` from `src` (graft arcs are weaker than local opinions). */
function mergeWeakPrim(dst: MutablePrim, src: MutablePrim): void {
  if (dst.typeName === undefined && src.typeName !== undefined) dst.typeName = src.typeName;
  if (dst.kind === undefined && src.kind !== undefined) dst.kind = src.kind;
  for (const s of src.apiSchemas) if (!dst.apiSchemas.includes(s)) dst.apiSchemas.push(s);
  for (const s of src.inherits) if (!dst.inherits.includes(s)) dst.inherits.push(s);
  for (const [name, attr] of src.attributes) if (!dst.attributes.has(name)) dst.attributes.set(name, attr);
  for (const [name, rel] of src.relationships) if (!dst.relationships.has(name)) dst.relationships.set(name, rel);
  if (dst.xformOps.length === 0 && src.xformOps.length > 0) dst.xformOps = [...src.xformOps];
  if (dst.materialBinding === undefined && src.materialBinding !== undefined) dst.materialBinding = src.materialBinding;
  if (dst.mesh === undefined && src.mesh !== undefined) dst.mesh = src.mesh;
}

/** Clone `src` at `newPath`; children are re-attached by the graft traversal. */
function cloneRebasedPrim(src: MutablePrim, newPath: string): MutablePrim {
  return {
    path: newPath,
    name: src.name,
    specifier: src.specifier,
    ...(src.typeName !== undefined ? { typeName: src.typeName } : {}),
    ...(src.kind !== undefined ? { kind: src.kind } : {}),
    apiSchemas: [...src.apiSchemas],
    inherits: [...src.inherits],
    references: [...src.references],
    payloads: [...src.payloads],
    attributes: new Map(src.attributes),
    relationships: new Map(src.relationships),
    xformOps: [...src.xformOps],
    children: [],
    ...(src.materialBinding !== undefined ? { materialBinding: src.materialBinding } : {}),
    ...(src.mesh !== undefined ? { mesh: src.mesh } : {}),
  };
}

/** Graft the `srcRootPath` subtree of `src` under `targetPrim` in `dst`. */
function graftComposition(
  dst: Composition,
  targetPrim: MutablePrim,
  src: Composition,
  srcRootPath: string,
  emit: (d: Diagnostic) => void,
): void {
  const srcRoot = src.prims.get(srcRootPath);
  if (!srcRoot) {
    emit({ level: 'warning', message: `Arc target prim not found: ${srcRootPath}` });
    return;
  }
  const rebase = (p: string): string => targetPrim.path + p.slice(srcRootPath.length);
  const stack: string[] = [srcRootPath];
  while (stack.length > 0) {
    const sp = stack.pop()!;
    const sPrim = src.prims.get(sp);
    if (!sPrim) continue;
    const dp = rebase(sp);
    let dPrim: MutablePrim;
    if (sp === srcRootPath) {
      dPrim = targetPrim;
      mergeWeakPrim(dPrim, sPrim);
    } else {
      const existing = dst.prims.get(dp);
      if (existing) {
        dPrim = existing;
        mergeWeakPrim(dPrim, sPrim);
      } else {
        dPrim = cloneRebasedPrim(sPrim, dp);
        dst.prims.set(dp, dPrim);
      }
    }
    for (const cp of sPrim.children) {
      const dcp = rebase(cp);
      if (!dPrim.children.includes(dcp)) dPrim.children.push(dcp);
      stack.push(cp);
    }
  }
  for (const m of src.materials) {
    if (m.primPath === srcRootPath || m.primPath.startsWith(`${srcRootPath}/`)) {
      dst.materials.push({ ...m, primPath: targetPrim.path + m.primPath.slice(srcRootPath.length) });
    }
  }
}

/** Resolve payload/reference arcs by composing their layers and grafting them. */
async function resolveArcGraph(
  root: Composition,
  reader: UsdLayerReader,
  emit: (d: Diagnostic) => void,
  maxDepth: number,
  chain: Set<string>,
): Promise<void> {
  for (const [primPath, arcs] of [...root.arcs]) {
    const target = root.prims.get(primPath);
    if (!target) continue;
    // References are stronger than payloads: graft references first.
    const ordered = [...arcs].sort((a, b) => (a.kind === 'reference' ? 0 : 1) - (b.kind === 'reference' ? 0 : 1));
    for (const arc of ordered) {
      const layerUri = resolveRelative(arc.layerUri, arc.assetPath);
      if (chain.has(layerUri)) {
        emit({
          level: 'warning',
          message: `Arc cycle guard: skipping ${arc.kind} to ${layerUri}`,
          detail: { prim: primPath },
        });
        continue;
      }
      let sub: ComposedTree;
      try {
        sub = await composeLayerTree(layerUri, reader, emit, maxDepth, new Set(), true);
      } catch (cause) {
        emit({ level: 'warning', message: `Arc layer unavailable (${arc.kind}): ${layerUri}`, detail: cause });
        continue;
      }
      await resolveArcGraph(sub.composition, reader, emit, maxDepth, new Set([...chain, layerUri]));
      const srcRootPath =
        arc.primPath ??
        (sub.metadata.defaultPrim !== undefined ? `/${sub.metadata.defaultPrim}` : sub.composition.roots[0]);
      if (srcRootPath === undefined) {
        emit({ level: 'warning', message: `Arc target has no default prim: ${layerUri}`, detail: { prim: primPath } });
        continue;
      }
      graftComposition(root, target, sub.composition, srcRootPath, emit);
      emit({
        level: 'info',
        message: `Composed ${arc.kind} arc: ${layerUri}${arc.primPath ?? ''} -> ${primPath}`,
      });
    }
  }
}

export async function importUsdStage(entryUri: string, options: UsdImportOptions): Promise<SceneAsset> {
  const emit = options.sink ?? (() => undefined);
  const maxDepth = options.maxDepth ?? 32;
  const resolveArcsFlag = options.resolveArcs ?? false;
  const visited = new Set<string>();

  const tree = await composeLayerTree(entryUri, options.reader, emit, maxDepth, visited, resolveArcsFlag);

  if (resolveArcsFlag) {
    await resolveArcGraph(tree.composition, options.reader, emit, maxDepth, new Set([entryUri]));
  }

  const stage: StageInfo = {
    ...(tree.metadata.defaultPrim !== undefined ? { defaultPrim: tree.metadata.defaultPrim } : {}),
    ...(tree.metadata.upAxis !== undefined ? { upAxis: tree.metadata.upAxis } : {}),
    ...(tree.metadata.metersPerUnit !== undefined ? { metersPerUnit: tree.metadata.metersPerUnit } : {}),
    subLayers: tree.resolvedSubLayers,
  };

  // Report dangling inherits (e.g. the undefined __class_mtl__ classes): tolerated.
  for (const prim of tree.composition.prims.values()) {
    for (const target of prim.inherits) {
      if (!tree.composition.prims.has(target)) {
        emit({
          level: 'info',
          message: `Dangling inherit ignored: ${target}`,
          detail: { prim: prim.path },
        });
      }
    }
  }

  return {
    entry: entryUri,
    stage,
    prims: tree.composition.prims,
    roots: tree.composition.roots,
    materials: tree.composition.materials,
  };
}
