// MaterialX graph resolution and provenance. Walks a loaded Core document and
// produces a renderer-independent, TypeScript-owned resolved graph: per-node
// NodeDef/implementation selection, typed inputs (value / connection / interface
// / geomprop), declared colorspaces and units, and source provenance for
// diagnostics (plan sections 7.1, 7.2). No shader is generated here.
//
// Reads values into plain data; Embind object lifetime stays with the owner of
// the document (which releases the whole tree on delete). The exact Core binding
// method names are confirmed by a runtime smoke test, mirroring the WASM
// qualification in docs/dependencies.md.

import { defaultDiagnosticSink, type DiagnosticSink } from '../core/diagnostics.ts';
import type { MxElement } from './wasm.ts';

/** Embind vector surface (`size`/`get`). */
export interface MxVector<T> {
  size(): number;
  get(index: number): T;
}

export interface MxInput extends MxElement {
  getAttribute?(name: string): string;
  getDefaultGeomPropString?(): string;
  getType(): string;
  getValueString(): string;
  hasValue?(): boolean;
  getInterfaceName?(): string;
  getConnectedNode?(): MxNode | null;
  getInterfaceInput?(): MxInput | null;
  getOutputString?(): string;
  getNodeGraphString?(): string;
  getConnectedOutput?(): MxInput | null;
  getColorSpace?(): string;
  getUnit?(): string;
  getUnitType?(): string;
  getActiveSourceUri?(): string;
}

export interface MxNode extends MxElement {
  getType(): string;
  getCategory(): string;
  getInputs(): MxVector<MxInput> | MxInput[];
  getNodeDef?(target?: string): MxNodeDef | null;
  getActiveSourceUri?(): string;
}

export interface MxInterfaceElement extends MxElement {
  getCategory?(): string;
  getTarget?(): string;
  getFunction?(): string;
  getFile?(): string;
}

export interface MxNodeDef extends MxElement {
  getNodeString(): string;
  getType(): string;
  getNodeGroup?(): string;
  getVersionString?(): string;
  getImplementation?(target?: string): MxInterfaceElement | null;
  getActiveSourceUri?(): string;
  getActiveInputs?(): MxVector<MxInput> | MxInput[];
  getInputs?(): MxVector<MxInput> | MxInput[];
}

export interface Provenance {
  namePath: string;
  sourceUri?: string;
}

export type ResolvedValueSource =
  | { kind: 'value'; value: string; type: string }
  | { kind: 'connection'; nodeId: string; output?: string }
  | { kind: 'interface'; name: string }
  | { kind: 'default'; type: string };

export interface ResolvedInput {
  name: string;
  type: string;
  source: ResolvedValueSource;
  /** Preserve interface bindings even when their source resolves to a literal. */
  interfaceName?: string;
  /** Engine editor opt-in; when authored, only true inputs are shown for this graph. */
  editable?: boolean;
  /** Runtime uniform field assigned to an editable upstream input. */
  parameter?: string;
  min?: readonly number[];
  max?: readonly number[];
  /** Declared colorspace carried from the input; never inferred. */
  colorSpace?: string;
  unit?: string;
  unitType?: string;
  provenance: Provenance;
}

export type ResolvedImplementation =
  | { kind: 'nodegraph'; name: string }
  | { kind: 'sourcecode'; target?: string; function?: string }
  | { kind: 'unresolved' };

export interface ResolvedNodeDefRef {
  name: string;
  nodeString: string;
  type: string;
  nodeGroup?: string;
  version?: string;
  implementation: ResolvedImplementation;
  inputs?: readonly { name: string; type: string; value?: string; geomprop?: string }[];
}

export interface ResolvedNode {
  id: string;
  category: string;
  type: string;
  nodeDef?: ResolvedNodeDefRef;
  inputs: ResolvedInput[];
  provenance: Provenance;
}

export interface ResolvedTerminal {
  name: string;
  type: string;
  nodeId?: string;
  provenance: Provenance;
}

export interface ResolvedGraph {
  terminals: ResolvedTerminal[];
  nodes: Map<string, ResolvedNode>;
  /** Optional front/back/presence wrapper carried by a LamaSurface material. */
  lamaSurface?: { presence?: ResolvedInput; backNodeId?: string };
}

export interface GraphRoot {
  /** Terminal name, e.g. 'surfaceshader' / 'displacementshader' / 'volumeshader'. */
  name: string;
  type: string;
  /** Shader node connected to the terminal, or null when unconnected. */
  node: MxNode | null;
  /** Material-level LamaSurface inputs that are not shader-node terminals. */
  lamaSurface?: { presence?: ResolvedInput; backNode?: MxNode | null };
  provenance?: Provenance;
}

export interface ResolveGraphOptions {
  roots: readonly GraphRoot[];
  /** Shader target used for NodeDef/implementation selection policy. */
  target?: string;
  onDiagnostic?: DiagnosticSink;
  /** True when the renderer lowers this node category directly to WGSL, so a
   *  missing MaterialX implementation element is expected and not warned on. */
  isCovered?: (category: string) => boolean;
}

function toArray<T>(v: MxVector<T> | T[]): T[] {
  if (Array.isArray(v)) return v;
  const out: T[] = [];
  for (let i = 0; i < v.size(); i++) out.push(v.get(i));
  return out;
}

function nonEmpty(value: string | undefined): string | undefined {
  return value !== undefined && value !== '' ? value : undefined;
}

function parseUiLimit(value: string | undefined, type: string, attribute: string, namePath: string): number[] | undefined {
  const raw = nonEmpty(value);
  if (raw === undefined) return undefined;
  const size = type === 'color3' ? 3 : type.startsWith('vector') ? Number(type.at(-1)) : 1;
  const values = raw.split(/[\s,]+/).filter(Boolean).map(Number);
  if (values.length !== size || !values.every(Number.isFinite)) {
    throw new Error(`Invalid ${attribute} at ${namePath}: expected ${size} finite value(s).`);
  }
  return values;
}

function provenanceOf(el: { getNamePath(): string; getActiveSourceUri?(): string }): Provenance {
  const sourceUri = nonEmpty(el.getActiveSourceUri?.());
  return sourceUri !== undefined ? { namePath: el.getNamePath(), sourceUri } : { namePath: el.getNamePath() };
}

function classifyImplementation(el: MxInterfaceElement): ResolvedImplementation {
  if (el.getCategory?.() === 'nodegraph') {
    return { kind: 'nodegraph', name: el.getName() };
  }
  const target = nonEmpty(el.getTarget?.());
  const fn = nonEmpty(el.getFunction?.());
  return {
    kind: 'sourcecode',
    ...(target !== undefined ? { target } : {}),
    ...(fn !== undefined ? { function: fn } : {}),
  };
}

function resolveInput(input: MxInput): { resolved: ResolvedInput; connected: MxNode | null } {
  const name = input.getName();
  const type = input.getType();
  const provenance = provenanceOf(input);
  const colorSpace = nonEmpty(input.getColorSpace?.());
  const unit = nonEmpty(input.getUnit?.());
  const unitType = nonEmpty(input.getUnitType?.());
  const editable = nonEmpty(input.getAttribute?.('engine_editable'));
  if (editable !== undefined && editable !== 'true' && editable !== 'false') {
    throw new Error(`Invalid engine_editable at ${provenance.namePath}: expected true or false.`);
  }
  const min = parseUiLimit(input.getAttribute?.('uimin'), type, 'uimin', provenance.namePath);
  const max = parseUiLimit(input.getAttribute?.('uimax'), type, 'uimax', provenance.namePath);
  if (min && max && min.some((value, index) => value > max[index]!)) {
    throw new Error(`Invalid UI range at ${provenance.namePath}: uimin must not exceed uimax.`);
  }

  let source: ResolvedValueSource;
  let connected: MxNode | null = null;

  const interfaceName = nonEmpty(input.getInterfaceName?.());
  const connectedNode = input.getConnectedNode?.() ?? null;
  const valueString = input.getValueString();
  const hasValue = input.hasValue ? input.hasValue() : valueString !== '';

  if (interfaceName !== undefined) {
    // Resolve the nodegraph interface binding to the concrete value/connection
    // it forwards (Core exposes Input::getInterfaceInput) so inner nodes never
    // carry an unresolved 'interface' source into IR lowering. Fall back to the
    // interface marker when the binding can't be read (e.g. mocked inputs).
    const iface = input.getInterfaceInput?.() ?? null;
    const ifaceConnected = iface?.getConnectedNode?.() ?? null;
    if (ifaceConnected) {
      connected = ifaceConnected;
      const output = nonEmpty(iface?.getOutputString?.());
      source = output !== undefined
        ? { kind: 'connection', nodeId: ifaceConnected.getNamePath(), output }
        : { kind: 'connection', nodeId: ifaceConnected.getNamePath() };
    } else if (iface) {
      const ifaceValue = iface.getValueString();
      const ifaceHasValue = iface.hasValue ? iface.hasValue() : ifaceValue !== '';
      source = ifaceHasValue
        ? { kind: 'value', value: ifaceValue, type }
        : { kind: 'interface', name: interfaceName };
    } else {
      source = { kind: 'interface', name: interfaceName };
    }
  } else if (connectedNode) {
    connected = connectedNode;
    // A nodegraph connection names the graph <output>; the upstream node output
    // (e.g. separate2.outy) is the output string carried by that graph output.
    const viaGraph = nonEmpty(input.getNodeGraphString?.()) !== undefined;
    const output = viaGraph
      ? nonEmpty(input.getConnectedOutput?.()?.getOutputString?.())
      : nonEmpty(input.getOutputString?.());
    source = output !== undefined
      ? { kind: 'connection', nodeId: connectedNode.getNamePath(), output }
      : { kind: 'connection', nodeId: connectedNode.getNamePath() };
  } else if (hasValue) {
    source = { kind: 'value', value: valueString, type };
  } else {
    source = { kind: 'default', type };
  }

  return {
    resolved: {
      name,
      type,
      source,
      ...(interfaceName !== undefined ? { interfaceName } : {}),
      ...(editable !== undefined ? { editable: editable === 'true' } : {}),
      ...(min !== undefined ? { min } : {}),
      ...(max !== undefined ? { max } : {}),
      ...(colorSpace !== undefined ? { colorSpace } : {}),
      ...(unit !== undefined ? { unit } : {}),
      ...(unitType !== undefined ? { unitType } : {}),
      provenance,
    },
    connected,
  };
}

function resolveNodeDef(node: MxNode, target: string | undefined, diag: DiagnosticSink, isCovered?: (category: string) => boolean): ResolvedNodeDefRef | undefined {
  // The Core Embind binding types target as std::string; passing undefined trips
  // "Cannot pass non-string to std::string". MaterialX treats "" as "any target".
  const targetArg = target ?? '';
  const nodeDef = node.getNodeDef?.(targetArg) ?? null;
  if (!nodeDef) {
    diag({
      level: 'warning',
      message: `Unresolved NodeDef for node '${node.getCategory()}' (${node.getNamePath()}).`,
      detail: { node: node.getNamePath() },
    });
    return undefined;
  }

  const impl = nodeDef.getImplementation?.(targetArg) ?? null;
  const implementation: ResolvedImplementation = impl
    ? classifyImplementation(impl)
    : { kind: 'unresolved' };
  // Builtin math/procedural leaves carry no MaterialX implementation element;
  // they are lowered directly to WGSL, so only warn when the renderer does not
  // cover the category.
  if (!impl && !(isCovered?.(node.getCategory()) ?? false)) {
    diag({
      level: 'warning',
      message: `NodeDef '${nodeDef.getName()}' has no implementation for target '${target ?? '<any>'}'; explicit WGSL lowering required.`,
      detail: { nodeDef: nodeDef.getName() },
    });
  }

  const nodeGroup = nonEmpty(nodeDef.getNodeGroup?.());
  const version = nonEmpty(nodeDef.getVersionString?.());
  const inputs = toArray(nodeDef.getActiveInputs?.() ?? nodeDef.getInputs?.() ?? []).map((input) => {
    const value = nonEmpty(input.getValueString());
    const geomprop = nonEmpty(input.getDefaultGeomPropString?.());
    return {
      name: input.getName(),
      type: input.getType(),
      ...(value !== undefined ? { value } : {}),
      ...(geomprop !== undefined ? { geomprop } : {}),
    };
  });
  return {
    name: nodeDef.getName(),
    nodeString: nodeDef.getNodeString(),
    type: nodeDef.getType(),
    ...(nodeGroup !== undefined ? { nodeGroup } : {}),
    ...(version !== undefined ? { version } : {}),
    ...(inputs.length > 0 ? { inputs } : {}),
    implementation,
  };
}

/** Resolve the subgraphs reachable from each terminal into a plain graph. */
export function resolveGraph(options: ResolveGraphOptions): ResolvedGraph {
  const diag = options.onDiagnostic ?? defaultDiagnosticSink;
  const nodes = new Map<string, ResolvedNode>();
  const terminals: ResolvedTerminal[] = [];
  const stack: MxNode[] = [];
  let lamaSurface: ResolvedGraph['lamaSurface'];

  for (const root of options.roots) {
    const terminal: ResolvedTerminal = {
      name: root.name,
      type: root.type,
      ...(root.node ? { nodeId: root.node.getNamePath() } : {}),
      provenance: root.provenance ?? (root.node ? provenanceOf(root.node) : { namePath: root.name }),
    };
    terminals.push(terminal);
    if (root.node) stack.push(root.node);
    if (root.lamaSurface) {
      lamaSurface = {
        ...(root.lamaSurface.presence ? { presence: root.lamaSurface.presence } : {}),
        ...(root.lamaSurface.backNode ? { backNodeId: root.lamaSurface.backNode.getNamePath() } : {}),
      };
      if (root.lamaSurface.backNode) stack.push(root.lamaSurface.backNode);
    }
  }

  while (stack.length > 0) {
    const node = stack.pop() as MxNode;
    const id = node.getNamePath();
    if (nodes.has(id)) continue; // dedupe + cycle guard

    const resolvedInputs: ResolvedInput[] = [];
    for (const input of toArray(node.getInputs())) {
      const { resolved, connected } = resolveInput(input);
      resolvedInputs.push(resolved);
      if (connected) stack.push(connected);
    }

    const nodeDef = resolveNodeDef(node, options.target, diag, options.isCovered);
    nodes.set(id, {
      id,
      category: node.getCategory(),
      type: node.getType(),
      ...(nodeDef ? { nodeDef } : {}),
      inputs: resolvedInputs,
      provenance: provenanceOf(node),
    });
  }

  return { terminals, nodes, ...(lamaSurface ? { lamaSurface } : {}) };
}
