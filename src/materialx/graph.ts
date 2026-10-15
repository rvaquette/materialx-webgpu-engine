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
  getType(): string;
  getValueString(): string;
  hasValue?(): boolean;
  getInterfaceName?(): string;
  getConnectedNode?(): MxNode | null;
  getInterfaceInput?(): MxInput | null;
  getOutputString?(): string;
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
}

export interface GraphRoot {
  /** Terminal name, e.g. 'surfaceshader' / 'displacementshader' / 'volumeshader'. */
  name: string;
  type: string;
  /** Shader node connected to the terminal, or null when unconnected. */
  node: MxNode | null;
  provenance?: Provenance;
}

export interface ResolveGraphOptions {
  roots: readonly GraphRoot[];
  /** Shader target used for NodeDef/implementation selection policy. */
  target?: string;
  onDiagnostic?: DiagnosticSink;
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
    const output = nonEmpty(input.getOutputString?.());
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
      ...(colorSpace !== undefined ? { colorSpace } : {}),
      ...(unit !== undefined ? { unit } : {}),
      ...(unitType !== undefined ? { unitType } : {}),
      provenance,
    },
    connected,
  };
}

function resolveNodeDef(node: MxNode, target: string | undefined, diag: DiagnosticSink): ResolvedNodeDefRef | undefined {
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
  if (!impl) {
    diag({
      level: 'warning',
      message: `NodeDef '${nodeDef.getName()}' has no implementation for target '${target ?? '<any>'}'; explicit WGSL lowering required.`,
      detail: { nodeDef: nodeDef.getName() },
    });
  }

  const nodeGroup = nonEmpty(nodeDef.getNodeGroup?.());
  const version = nonEmpty(nodeDef.getVersionString?.());
  return {
    name: nodeDef.getName(),
    nodeString: nodeDef.getNodeString(),
    type: nodeDef.getType(),
    ...(nodeGroup !== undefined ? { nodeGroup } : {}),
    ...(version !== undefined ? { version } : {}),
    implementation,
  };
}

/** Resolve the subgraphs reachable from each terminal into a plain graph. */
export function resolveGraph(options: ResolveGraphOptions): ResolvedGraph {
  const diag = options.onDiagnostic ?? defaultDiagnosticSink;
  const nodes = new Map<string, ResolvedNode>();
  const terminals: ResolvedTerminal[] = [];
  const stack: MxNode[] = [];

  for (const root of options.roots) {
    const terminal: ResolvedTerminal = {
      name: root.name,
      type: root.type,
      ...(root.node ? { nodeId: root.node.getNamePath() } : {}),
      provenance: root.provenance ?? (root.node ? provenanceOf(root.node) : { namePath: root.name }),
    };
    terminals.push(terminal);
    if (root.node) stack.push(root.node);
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

    const nodeDef = resolveNodeDef(node, options.target, diag);
    nodes.set(id, {
      id,
      category: node.getCategory(),
      type: node.getType(),
      ...(nodeDef ? { nodeDef } : {}),
      inputs: resolvedInputs,
      provenance: provenanceOf(node),
    });
  }

  return { terminals, nodes };
}
