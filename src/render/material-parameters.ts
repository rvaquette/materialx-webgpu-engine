import { emitLayeredSurface } from '../compiler/surface-wgsl.ts';
import { hashString } from '../compiler/cache.ts';
import type { WgslUniformField } from '../compiler/wgsl.ts';
import { resolveSurface } from '../materialx/surface-graph.ts';
import type {
  ResolvedGraph, ResolvedInput, ResolvedNode, ResolvedNodeDefRef, ResolvedValueSource,
} from '../materialx/graph.ts';
import type { NormalizedSurfaceInput, ResolvedSurface } from '../materialx/surface-graph.ts';
import { assembleIrForwardShader } from './raster/ir-forward.ts';
import type { MaterialResource, SceneResources } from './scene-resources.ts';
import { extractDisplacement } from './graph-material-compiler.ts';
import { resolveVolume } from '../materialx/volume-graph.ts';
import { appendVolumeIr, evaluateVolumeIr, isSpatialVolumeIr } from '../compiler/volume-ir.ts';
import { IrModuleBuilder } from '../compiler/ir.ts';

export interface MaterialParameter {
  id: string;
  label: string;
  type: 'float' | 'integer' | 'boolean' | 'color3' | 'vector2' | 'vector3' | 'vector4';
  value: readonly number[];
  initial: readonly number[];
  min?: readonly number[];
  max?: readonly number[];
  /** Named values offered by the editor; validated like ordinary edits. */
  presets?: readonly { name: string; value: readonly number[] }[];
  /** Uniform edits are immediate; feature boundaries and topology rebuild. */
  update: 'uniform' | 'feature' | 'rebuild';
  uniform?: string;
  nodeId?: string;
  input: string;
  /** Surface input driven by a Constant inserted by the graph editor. */
  constantFor?: string;
  arithmeticFor?: { kind: EditableArithmeticNode; original: MaterialParameter; role?: 'fg' | 'mix' };
  /** While linked, this parameter retains the editor node and literal to restore on disconnect. */
  linkedSource?: string;
  /** Literal graph-node input exposed by the generic graph editor. */
  graphInput?: boolean;
  /** Hidden scene clock (current time code) read by a `time` or `frame` node. */
  clock?: boolean;
}

/** Hidden input carrying the scene clock into `time` / `frame` nodes (compiler/nodes.ts). */
export const CLOCK_INPUT = 'mx_frame';
const CLOCK_CATEGORIES = new Set(['time', 'frame']);

export interface MaterialGraphOutput {
  nodeId: string;
  output: string;
  type: string;
  label: string;
}

export interface MaterialNodeOutputChoice {
  nodeDef: ResolvedNodeDefRef;
  output: { name: string; type: string };
  label: string;
}

const numericTypes = new Set(['float', 'integer', 'boolean', 'color3', 'vector2', 'vector3', 'vector4']);

function isType(type: string): type is MaterialParameter['type'] { return numericTypes.has(type); }

type FeatureRule = 'positive' | 'positive-color' | 'coverage';

const POSITIVE_FEATURES: Partial<Record<ResolvedSurface['family'], ReadonlySet<string>>> = {
  standard_surface: new Set(['base', 'metalness', 'transmission', 'specular', 'subsurface', 'coat', 'sheen', 'thin_film_thickness', 'emission', 'transmission_dispersion']),
  open_pbr_surface: new Set(['base_weight', 'base_metalness', 'specular_weight', 'transmission_weight', 'subsurface_weight', 'coat_weight', 'fuzz_weight', 'thin_film_weight', 'emission_luminance', 'transmission_dispersion_scale']),
  gltf_pbr: new Set(['metallic', 'transmission', 'specular', 'dispersion', 'clearcoat', 'iridescence']),
  UsdPreviewSurface: new Set(['metallic', 'clearcoat']),
  disney_principled: new Set(['metallic', 'specTrans', 'specular', 'subsurface', 'sheen', 'clearcoat']),
};

function featureRule(surface: ResolvedSurface, name: string, type: MaterialParameter['type']): FeatureRule | undefined {
  if (POSITIVE_FEATURES[surface.family]?.has(name)) return 'positive';
  if (surface.family === 'standard_surface' && name === 'opacity') return 'coverage';
  if (surface.family === 'open_pbr_surface' && name === 'geometry_opacity') return 'coverage';
  if (surface.family === 'gltf_pbr' && (name === 'alpha' || name === 'alpha_cutoff')) return 'coverage';
  if (surface.family === 'UsdPreviewSurface' && (name === 'opacity' || name === 'opacityThreshold')) return 'coverage';
  if (type === 'color3' && (
    surface.family === 'gltf_pbr' && (name === 'sheen_color' || name === 'emissive')
    || surface.family === 'UsdPreviewSurface' && name === 'emissiveColor'
  )) return 'positive-color';
  return undefined;
}

function inputValue(inputs: ReadonlyMap<string, NormalizedSurfaceInput>, name: string, fallback: readonly number[]): readonly number[] {
  const source = inputs.get(name)?.source;
  return source?.kind === 'value' || source?.kind === 'default' ? source.value : fallback;
}

function setFeatureInput(
  inputs: Map<string, NormalizedSurfaceInput>,
  parameters: readonly MaterialParameter[],
  name: string,
  active: boolean,
  canonical: readonly number[],
): void {
  const input = inputs.get(name);
  const parameter = parameters.find(candidate => !candidate.nodeId && candidate.input === name && candidate.update === 'feature');
  if (!input || !parameter || input.source.kind === 'connection' || input.source.kind === 'geomprop') return;
  if (active && parameter.uniform !== undefined) inputs.set(name, { ...input, parameter: parameter.uniform });
  else {
    const { parameter: _parameter, ...literal } = input;
    inputs.set(name, { ...literal, source: { kind: 'value', value: canonical } });
  }
}

/** Keep feature controls literal at their inactive/opaque states, but uniform
 *  while a feature is active. Their editor values remain independent of the
 *  canonical shader input so edits inside a state do not rebuild pipelines. */
function applyFeatureStates(surface: ResolvedSurface, parameters: readonly MaterialParameter[]): ResolvedSurface {
  const inputs = new Map(surface.inputs);
  const values = new Map(parameters.filter(parameter => !parameter.nodeId).map(parameter => [parameter.input, parameter.value]));
  const value = (name: string, fallback: readonly number[]): readonly number[] =>
    values.get(name) ?? inputValue(inputs, name, fallback);

  for (const parameter of parameters) {
    if (parameter.nodeId || parameter.update !== 'feature') continue;
    const rule = featureRule(surface, parameter.input, parameter.type);
    if (rule === 'positive') {
      const current = value(parameter.input, parameter.initial);
      const active = current[0]! > 0;
      setFeatureInput(inputs, parameters, parameter.input, active, [0]);
    } else if (rule === 'positive-color') {
      const current = value(parameter.input, parameter.initial);
      const active = current.some(component => component > 0);
      setFeatureInput(inputs, parameters, parameter.input, active, [0, 0, 0]);
    }
  }

  const coverageInputs = surface.family === 'standard_surface' ? ['opacity']
    : surface.family === 'open_pbr_surface' ? ['geometry_opacity']
      : surface.family === 'gltf_pbr' ? ['alpha_mode', 'alpha', 'alpha_cutoff']
        : surface.family === 'UsdPreviewSurface' ? ['opacity', 'opacityThreshold'] : [];
  const dynamicCoverage = coverageInputs.some(name => {
    const input = inputs.get(name);
    return input && (input.source.kind !== 'value' && input.source.kind !== 'default'
      || input.parameter !== undefined && !values.has(name));
  });
  if (dynamicCoverage) {
    for (const name of coverageInputs) setFeatureInput(inputs, parameters, name, true, []);
    return { ...surface, inputs };
  }

  if (surface.family === 'standard_surface') {
    const opacity = value('opacity', [1, 1, 1]);
    const opaque = opacity.every(component => component >= 1);
    setFeatureInput(inputs, parameters, 'opacity', !opaque, [1, 1, 1]);
  } else if (surface.family === 'open_pbr_surface') {
    const opacity = value('geometry_opacity', [1])[0]!;
    setFeatureInput(inputs, parameters, 'geometry_opacity', opacity < 1, [1]);
  } else if (surface.family === 'gltf_pbr') {
    const mode = value('alpha_mode', [0])[0]!;
    const alpha = value('alpha', [1])[0]!;
    const cutoff = value('alpha_cutoff', [0.5])[0]!;
    const opaque = mode === 0 || (mode === 1 ? alpha >= cutoff : alpha >= 1);
    setFeatureInput(inputs, parameters, 'alpha', !opaque, [1]);
    setFeatureInput(inputs, parameters, 'alpha_cutoff', !opaque && mode === 1, [0.5]);
  } else if (surface.family === 'UsdPreviewSurface') {
    const opacity = value('opacity', [1])[0]!;
    const threshold = value('opacityThreshold', [0])[0]!;
    if (threshold <= 0) {
      setFeatureInput(inputs, parameters, 'opacity', opacity < 1, [1]);
      setFeatureInput(inputs, parameters, 'opacityThreshold', false, [0]);
    } else if (opacity >= threshold) {
      setFeatureInput(inputs, parameters, 'opacity', false, [1]);
      setFeatureInput(inputs, parameters, 'opacityThreshold', false, [0.5]);
    } else {
      setFeatureInput(inputs, parameters, 'opacity', true, [1]);
      setFeatureInput(inputs, parameters, 'opacityThreshold', true, [0]);
    }
  }
  return { ...surface, inputs };
}

export function visibleMaterialParameters(material: MaterialResource, nodeId?: string): readonly MaterialParameter[] {
  const graph = material.surfaceGraph;
  const surfaceNode = graph?.nodes.get(material.resolvedSurface?.nodeId ?? '');
  const explicitSelection = [...(graph?.nodes.values() ?? [])].some(node =>
    node.inputs.some(input => input.editable !== undefined));
  return (material.parameters ?? []).filter(parameter => {
    const node = parameter.nodeId ? graph?.nodes.get(parameter.nodeId) : surfaceNode;
    if (nodeId !== undefined && node?.id !== nodeId) return false;
    const input = node?.inputs.find(input => input.name === parameter.input);
    if (input?.source.kind !== 'value' || input.interfaceName) return false;
    return parameter.constantFor !== undefined || parameter.arithmeticFor !== undefined || parameter.graphInput === true
      || (explicitSelection ? input.editable === true : !parameter.nodeId);
  });
}

type EditableArithmeticNode = 'add' | 'subtract' | 'multiply' | 'divide' | 'power' | 'min' | 'max' | 'mix';
export type EditableInputNode = 'constant' | EditableArithmeticNode;

export function editorArithmeticValue(
  parameter: MaterialParameter, parameters: readonly MaterialParameter[] = [],
): number[] | undefined {
  const arithmetic = parameter.arithmeticFor;
  if (!arithmetic) return undefined;
  if (arithmetic.kind === 'mix') {
    const nodeParameters = parameters.filter(candidate => candidate.nodeId === parameter.nodeId);
    const foreground = nodeParameters.find(candidate => candidate.input === 'fg');
    const factor = nodeParameters.find(candidate => candidate.input === 'mix');
    if (!foreground || !factor) throw new Error(`Entrées incomplètes pour le nœud Mix ${parameter.nodeId}.`);
    return arithmetic.original.value.map((background, index) =>
      background + (foreground.value[index]! - background) * factor.value[0]!);
  }
  const operand = parameter.value[0]!;
  return arithmetic.original.value.map(component => {
    switch (arithmetic.kind) {
      case 'add': return component + operand;
      case 'subtract': return component - operand;
      case 'multiply': return component * operand;
      case 'divide': return component / operand;
      case 'power': return component ** operand;
      case 'min': return Math.min(component, operand);
      case 'max': return Math.max(component, operand);
      case 'mix': throw new Error('Le nœud Mix nécessite ses deux paramètres.');
    }
  });
}

function arithmeticOperand(
  material: MaterialResource, nodeId: string, parameter: MaterialParameter,
  kind: EditableArithmeticNode,
): { min: number[]; max: number[]; initial: number } | undefined {
  if (kind === 'mix') {
    if (parameter.type !== 'float' && parameter.type !== 'color3') return undefined;
    const { min, max } = surfaceInputRange(material, parameter.input, parameter.type, parameter.min, parameter.max);
    return parameter.value.every((value, index) =>
      Number.isFinite(value) && Number.isFinite(min[index]) && Number.isFinite(max[index])
      && min[index]! <= value && value <= max[index]!)
      ? { min: [0], max: [1], initial: 0 } : undefined;
  }
  if (kind === 'multiply') {
    return parameter.value.every((component, index) =>
      Number.isFinite(component)
      && (parameter.min?.[index] ?? -Infinity) <= Math.min(0, component)
      && (parameter.max?.[index] ?? Infinity) >= Math.max(0, component))
      ? { min: [0], max: [1], initial: 1 } : undefined;
  }
  const definition = material.surfaceGraph?.nodes.get(nodeId)?.nodeDef?.inputs
    ?.find(input => input.name === parameter.input && input.type === parameter.type);
  if (parameter.type === 'color3') {
    if (kind !== 'add' && kind !== 'subtract' && kind !== 'min' && kind !== 'max') return undefined;
    const lowerOffsets: number[] = [];
    const upperOffsets: number[] = [];
    const componentMins: number[] = [];
    const componentMaxs: number[] = [];
    for (let index = 0; index < 3; index++) {
      const value = parameter.value[index]!;
      const min = parameter.min?.[index] ?? definition?.uiMinComponents?.[index] ?? -Infinity;
      const max = parameter.max?.[index] ?? definition?.uiMaxComponents?.[index] ?? Infinity;
      if (!Number.isFinite(min) || !Number.isFinite(max) || !(min <= value && value <= max) || min >= max) return undefined;
      componentMins.push(min);
      componentMaxs.push(max);
      if (kind === 'add' || kind === 'subtract') {
        lowerOffsets.push(kind === 'add' ? min - value : value - max);
        upperOffsets.push(kind === 'add' ? max - value : value - min);
      }
    }
    if (kind === 'min') {
      const minimum = Math.max(...componentMins);
      const maximum = Math.max(...parameter.value);
      return minimum < maximum ? { min: [minimum], max: [maximum], initial: maximum } : undefined;
    }
    if (kind === 'max') {
      const minimum = Math.min(...parameter.value);
      const maximum = Math.min(...componentMaxs);
      return minimum < maximum ? { min: [minimum], max: [maximum], initial: minimum } : undefined;
    }
    const min = Math.max(...lowerOffsets);
    const max = Math.min(...upperOffsets);
    return min <= 0 && max >= 0 && min < max ? { min: [min], max: [max], initial: 0 } : undefined;
  }
  if (parameter.type !== 'float') return undefined;
  const value = parameter.value[0]!;
  const min = parameter.min?.[0] ?? definition?.uiMin ?? -Infinity;
  const max = parameter.max?.[0] ?? definition?.uiMax ?? Infinity;
  if (!Number.isFinite(min) || !Number.isFinite(max) || !(min <= value && value <= max) || min >= max) return undefined;
  if (kind === 'divide') {
    if (min < 0 || max <= 0 || value < 0) return undefined;
    const lowerFactor = Math.max(1e-4, value / max);
    return lowerFactor < 1 ? { min: [lowerFactor], max: [1], initial: 1 } : undefined;
  }
  if (kind === 'power') {
    if (min < 0 || value <= 0 || max <= value) return undefined;
    if (value < 1 && max <= 1) {
      const lowerExponent = Math.max(0, Math.log(max) / Math.log(value));
      return Number.isFinite(lowerExponent) && lowerExponent >= 0 && lowerExponent < 1
        ? { min: [lowerExponent], max: [1], initial: 1 } : undefined;
    }
    if (value > 1) {
      const upperExponent = Math.log(max) / Math.log(value);
      return Number.isFinite(upperExponent) && upperExponent > 1
        ? { min: [1], max: [upperExponent], initial: 1 } : undefined;
    }
    return undefined;
  }
  if (kind === 'min' || kind === 'max') {
    return { min: [min], max: [max], initial: kind === 'min' ? max : min };
  }
  const low = kind === 'add' ? min - value : value - max;
  const high = kind === 'add' ? max - value : value - min;
  return Number.isFinite(low) && Number.isFinite(high) && low < high
    ? { min: [low], max: [high], initial: 0 } : undefined;
}

export function canInsertMaterialInputNode(
  material: MaterialResource, nodeId: string, inputName: string, kind: EditableInputNode,
): boolean {
  if (!canInsertMaterialConstant(material, nodeId, inputName)) return false;
  if (kind === 'constant') return true;
  const parameter = material.parameters?.find(candidate => !candidate.nodeId && candidate.input === inputName);
  return parameter !== undefined && arithmeticOperand(material, nodeId, parameter, kind) !== undefined;
}

export function canInsertMaterialConstant(material: MaterialResource, nodeId: string, inputName: string): boolean {
  const surface = material.resolvedSurface;
  const graph = material.surfaceGraph;
  const input = graph?.nodes.get(nodeId)?.inputs.find(input => input.name === inputName);
  const normalized = surface?.inputs.get(inputName);
  return surface?.nodeId === nodeId && !surface.backNodeId && !graph?.lamaSurface
    && input?.source.kind === 'value' && !input.defaulted && !input.colorSpace && !input.unit && !input.unitType
    && normalized?.source.kind === 'value' && normalized.type === input.type
    && visibleMaterialParameters(material, nodeId).some(parameter => parameter.input === inputName && !parameter.nodeId
      && parameter.update === 'uniform' && parameter.uniform === normalized.parameter
      && (parameter.type === 'float' || parameter.type === 'color3'));
}

function outputsOf(node: Pick<ResolvedNode, 'type' | 'nodeDef'>): readonly { name: string; type: string }[] {
  return node.nodeDef?.outputs?.length ? node.nodeDef.outputs : [{ name: 'out', type: node.type }];
}

function outputsOfDefinition(definition: ResolvedNodeDefRef): readonly { name: string; type: string }[] {
  return definition.outputs?.length ? definition.outputs : [{ name: 'out', type: definition.type }];
}

export function compatibleNodeOutputChoices(
  definitions: readonly ResolvedNodeDefRef[], inputType: string,
): MaterialNodeOutputChoice[] {
  return definitions.flatMap(nodeDef => outputsOfDefinition(nodeDef)
    .filter(output => output.type === inputType)
    .map(output => ({
      nodeDef, output,
      label: `${nodeDef.nodeString} · ${output.name} (${output.type})`,
    })));
}

function createsGraphCycle(graph: ResolvedGraph, targetId: string, sourceId: string): boolean {
  const pending = [sourceId];
  const visited = new Set<string>();
  while (pending.length) {
    const current = pending.pop()!;
    if (current === targetId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const input of graph.nodes.get(current)?.inputs ?? []) {
      if (input.source.kind === 'connection') pending.push(input.source.nodeId);
    }
  }
  return false;
}

export function compatibleMaterialGraphOutputs(
  material: MaterialResource, targetId: string, inputName: string,
): MaterialGraphOutput[] {
  const graph = material.surfaceGraph;
  const node = graph?.nodes.get(targetId);
  const target = node?.inputs.find(input => input.name === inputName) ?? node?.nodeDef?.inputs?.find(input => input.name === inputName);
  if (!graph || !target) return [];
  return [...graph.nodes.values()].flatMap(node => {
    if (createsGraphCycle(graph, targetId, node.id)) return [];
    return outputsOf(node).filter(output => output.type === target.type).map(output => ({
      nodeId: node.id, output: output.name, type: output.type,
      label: `${node.id} · ${output.name} (${output.type})`,
    }));
  });
}

function literalForType(type: string): string | undefined {
  if (type === 'boolean') return 'false';
  const count = type === 'color3' || type === 'vector3' ? 3
    : type === 'color4' || type === 'vector4' ? 4 : type === 'vector2' ? 2 : 1;
  return ['float', 'integer', 'color3', 'color4', 'vector2', 'vector3', 'vector4'].includes(type)
    ? Array(count).fill('0').join(', ') : undefined;
}

function graphParameterValues(type: MaterialParameter['type'], value: string): number[] {
  if (type === 'boolean') {
    if (value === 'true') return [1];
    if (value === 'false') return [0];
  }
  return value.trim().split(/[,\s]+/).map(Number);
}

function surfaceFromEditedGraph(graph: ResolvedGraph): ResolvedSurface {
  const surface = resolveSurface(graph);
  if (!surface) throw new Error('Le graphe modifié ne contient plus une surface MaterialX valide.');
  return surface;
}

/**
 * `material` whose node `nodeId` has `inputName`: an input of its NodeDef that the document does not
 * author is added with the NodeDef default, so the editor can set, link or feed any NodeDef input.
 */
function withDefinitionInput(material: MaterialResource, nodeId: string, inputName: string): MaterialResource {
  const graph = material.surfaceGraph;
  const node = graph?.nodes.get(nodeId);
  if (!graph || !node || node.inputs.some(input => input.name === inputName)) return material;
  const definition = node.nodeDef?.inputs?.find(input => input.name === inputName);
  if (!definition) return material;
  const value = definition.geomprop === undefined ? definition.value ?? literalForType(definition.type) : undefined;
  const input: ResolvedInput = {
    name: definition.name, type: definition.type,
    source: value !== undefined ? { kind: 'value', type: definition.type, value } : { kind: 'default', type: definition.type },
    provenance: { namePath: `${node.provenance.namePath}/${definition.name}` },
  };
  const nodes = new Map(graph.nodes).set(nodeId, { ...node, inputs: [...node.inputs, input] });
  return { ...material, surfaceGraph: { ...graph, nodes } };
}

/** Connect a typed graph output to an input; a null source restores the prior binding. */
export function changeMaterialGraphInputLink(
  material: MaterialResource, targetId: string, inputName: string, sourceId: string | null, outputName = 'out',
): MaterialResource {
  if (sourceId !== null) material = withDefinitionInput(material, targetId, inputName);
  const graph = material.surfaceGraph;
  const parameters = material.parameters ?? [];
  const target = graph?.nodes.get(targetId);
  const input = target?.inputs.find(candidate => candidate.name === inputName);
  if (!graph || !target || !input) throw new Error('Port d’entrée introuvable.');
  const parameter = parameters.find(candidate =>
    candidate.nodeId === targetId && candidate.input === inputName
    || targetId === material.resolvedSurface?.nodeId && !candidate.nodeId && candidate.input === inputName);
  let replacement: ResolvedInput;
  let linkedSource: string | undefined;
  if (sourceId !== null) {
    const upstream = graph.nodes.get(sourceId);
    const output = upstream && outputsOf(upstream).find(candidate => candidate.name === outputName);
    if (!upstream || !output || output.type !== input.type || createsGraphCycle(graph, targetId, sourceId)) {
      throw new Error('Connexion impossible : ports incompatibles ou cycle détecté.');
    }
    if (input.source.kind === 'connection' && input.source.nodeId === sourceId && (input.source.output ?? 'out') === outputName) {
      return material;
    }
    const { parameter: originalParameter, ...unparameterized } = input;
    replacement = {
      ...unparameterized,
      source: { kind: 'connection', nodeId: sourceId, ...(outputName !== 'out' ? { output: outputName } : {}) },
      editorOriginalSource: input.editorOriginalSource ?? input.source,
      ...(input.editorOriginalParameter !== undefined ? { editorOriginalParameter: input.editorOriginalParameter }
        : originalParameter !== undefined ? { editorOriginalParameter: originalParameter } : {}),
    };
    linkedSource = sourceId;
  } else {
    const originalSource = input.editorOriginalSource;
    if (!originalSource && !parameter?.linkedSource) throw new Error('Cette connexion ne peut pas être retirée.');
    const { editorOriginalSource: _originalSource, editorOriginalParameter, ...rest } = input;
    const restoredSource: ResolvedValueSource = originalSource
      ?? { kind: 'value', type: parameter!.type, value: parameter!.value.join(', ') };
    replacement = {
      ...rest, source: restoredSource,
      ...(editorOriginalParameter !== undefined ? { parameter: editorOriginalParameter } : {}),
    };
  }
  const nodes = new Map(graph.nodes);
  nodes.set(targetId, {
    ...target,
    inputs: target.inputs.map(candidate => candidate === input ? replacement : candidate),
  });
  const updatedGraph = { ...graph, nodes };
  const updatedParameters = parameters.map(candidate => {
    if (candidate !== parameter) return candidate;
    if (linkedSource !== undefined) return { ...candidate, linkedSource };
    const { linkedSource: _source, ...rest } = candidate;
    return rest;
  });
  return compileEditableMaterial({
    ...material, surfaceGraph: updatedGraph, resolvedSurface: surfaceFromEditedGraph(updatedGraph),
    parameters: updatedParameters,
  });
}

/** Update a literal of any MaterialX value type on an unparameterized graph input. */
export function changeMaterialGraphInputValue(
  material: MaterialResource, targetId: string, inputName: string, value: string,
): MaterialResource {
  material = withDefinitionInput(material, targetId, inputName);
  const graph = material.surfaceGraph;
  const node = graph?.nodes.get(targetId);
  const input = node?.inputs.find(candidate => candidate.name === inputName);
  if (!graph || !node || !input || input.parameter !== undefined
    || input.source.kind !== 'value' && input.source.kind !== 'default') {
    throw new Error('Seule une entrée littérale non paramétrée peut être modifiée ici.');
  }
  if (input.type === 'filename') throw new Error('Une entrée filename ne peut être modifiée sans recharger les textures.');
  if (input.source.kind === 'value' && input.source.value === value) return material;
  const nodes = new Map(graph.nodes);
  nodes.set(targetId, {
    ...node,
    inputs: node.inputs.map(candidate => candidate === input
      ? { ...candidate, source: { kind: 'value', type: input.type, value } } : candidate),
  });
  const updatedGraph = { ...graph, nodes };
  return compileEditableMaterial({
    ...material, surfaceGraph: updatedGraph, resolvedSurface: surfaceFromEditedGraph(updatedGraph),
  });
}

/** Add any catalogued NodeDef whose output type matches the selected graph input. */
export function addMaterialNodeFromDefinition(
  material: MaterialResource, targetId: string, inputName: string,
  definitionName: string, outputName: string, definitions: readonly ResolvedNodeDefRef[],
): MaterialResource {
  const definition = definitions.find(candidate => candidate.name === definitionName);
  if (!definition) throw new Error(`NodeDef MaterialX introuvable : ${definitionName}.`);
  material = withDefinitionInput(material, targetId, inputName);
  const targetInput = material.surfaceGraph?.nodes.get(targetId)?.inputs.find(input => input.name === inputName);
  if (!targetInput || !outputsOfDefinition(definition).some(output =>
    output.name === outputName && output.type === targetInput.type)) {
    throw new Error('Le type de sortie du NodeDef ne correspond pas au port sélectionné.');
  }
  const sourceToPreserve = targetInput.source.kind === 'value' || targetInput.source.kind === 'connection'
    ? targetInput.source : undefined;
  const seedInput = sourceToPreserve
    ? definition.inputs?.find(input => input.type === targetInput.type && input.geomprop === undefined)
    : undefined;
  const { material: withNode, nodeId } = insertDefinitionNode(material, definition,
    seedInput && sourceToPreserve ? { input: seedInput.name, source: sourceToPreserve } : undefined);
  return changeMaterialGraphInputLink(withNode, targetId, inputName, nodeId, outputName);
}

/**
 * Add a NodeDef whose input `inputName` is fed by `sourceId.outputName` (a node downstream of an
 * output). Until it is connected further, the new node does not change the surface.
 */
export function addMaterialNodeDownstream(
  material: MaterialResource, sourceId: string, outputName: string,
  definitionName: string, inputName: string, definitions: readonly ResolvedNodeDefRef[],
): MaterialResource {
  const definition = definitions.find(candidate => candidate.name === definitionName);
  if (!definition) throw new Error(`NodeDef MaterialX introuvable : ${definitionName}.`);
  const source = material.surfaceGraph?.nodes.get(sourceId);
  const output = source && outputsOf(source).find(candidate => candidate.name === outputName);
  if (!output || !definition.inputs?.some(input => input.name === inputName && input.type === output.type)) {
    throw new Error('Le type d’entrée du NodeDef ne correspond pas à la sortie sélectionnée.');
  }
  const { material: withNode, nodeId } = insertDefinitionNode(material, definition);
  return changeMaterialGraphInputLink(withNode, nodeId, inputName, sourceId, outputName);
}

/** NodeDef inputs whose type matches `type`, to feed them from an output of that type. */
export function compatibleNodeInputChoices(
  definitions: readonly ResolvedNodeDefRef[], type: string,
): { nodeDef: ResolvedNodeDefRef; input: string; label: string }[] {
  return definitions.flatMap(nodeDef => (nodeDef.inputs ?? [])
    .filter(input => input.type === type && input.geomprop === undefined)
    .map(input => ({ nodeDef, input: input.name, label: `${nodeDef.nodeString} · ${input.name} (${input.type})` })));
}

/** Adds a node of `definition` with its default inputs (one may be `seed`ed); returns its id. */
function insertDefinitionNode(
  material: MaterialResource, definition: ResolvedNodeDefRef, seed?: { input: string; source: ResolvedValueSource },
): { material: MaterialResource; nodeId: string } {
  const graph = material.surfaceGraph!;
  let suffix = 1;
  while (graph.nodes.has(`editor_node_${suffix}`)) suffix++;
  const nodeId = `editor_node_${suffix}`;
  const parameters = [...(material.parameters ?? [])];
  const seedInput = seed && { name: seed.input };
  const sourceToPreserve = seed?.source;
  const inputs = (definition.inputs ?? []).map(input => {
    const seeded = input.name === seedInput?.name ? sourceToPreserve : undefined;
    const value = seeded?.kind === 'value' ? seeded.value : input.value ?? literalForType(input.type);
    const source: ResolvedValueSource = seeded
      ? seeded : value !== undefined ? { kind: 'value', type: input.type, value } : { kind: 'default', type: input.type };
    const editable = source.kind === 'value' && isType(input.type);
    const baseInput: ResolvedInput = {
      name: input.name, type: input.type, source, provenance: { namePath: `${nodeId}/${input.name}` },
      ...(input.geomprop !== undefined ? { source: { kind: 'default', type: input.type } as const } : {}),
      ...(editable ? { editable: true } : {}),
      ...(input.uiMin !== undefined ? { min: [input.uiMin] } : {}),
      ...(input.uiMax !== undefined ? { max: [input.uiMax] } : {}),
      ...(input.uiMinComponents !== undefined ? { min: input.uiMinComponents } : {}),
      ...(input.uiMaxComponents !== undefined ? { max: input.uiMaxComponents } : {}),
    };
    if (!editable || value === undefined) return baseInput;
    const type = input.type as MaterialParameter['type'];
    const values = graphParameterValues(type, value);
    const uniform = UNIFORM_TYPES.has(type) ? `parameter_${parameters.length}` : undefined;
    const parameter: MaterialParameter = {
      id: JSON.stringify([nodeId, input.name]), label: `${nodeId} / ${input.name}`, type,
      value: values, initial: values, update: uniform ? 'uniform' : 'rebuild', nodeId, input: input.name,
      graphInput: true,
      ...(uniform !== undefined ? { uniform } : {}),
      ...(baseInput.min !== undefined ? { min: baseInput.min } : {}),
      ...(baseInput.max !== undefined ? { max: baseInput.max } : {}),
    };
    parameterValues(parameter, values);
    parameters.push(parameter);
    return { ...baseInput, ...(uniform !== undefined ? { parameter: uniform } : {}) };
  });
  const node: ResolvedNode = {
    id: nodeId, category: definition.nodeString, type: definition.type,
    nodeDef: definition, inputs, provenance: { namePath: nodeId },
  };
  const nodes = new Map(graph.nodes).set(nodeId, node);
  return { material: { ...material, surfaceGraph: { ...graph, nodes }, parameters }, nodeId };
}

function surfaceInputRange(
  material: MaterialResource, input: string, type: MaterialParameter['type'],
  authoredMin?: readonly number[], authoredMax?: readonly number[],
): { min: number[]; max: number[] } {
  const definition = material.surfaceGraph?.nodes.get(material.resolvedSurface?.nodeId ?? '')?.nodeDef?.inputs
    ?.find(candidate => candidate.name === input && candidate.type === type);
  const componentMin = type === 'color3' ? definition?.uiMinComponents : undefined;
  const componentMax = type === 'color3' ? definition?.uiMaxComponents : undefined;
  const scalarMin = type === 'float' ? definition?.uiMin : undefined;
  const scalarMax = type === 'float' ? definition?.uiMax : undefined;
  const count = type === 'color3' ? 3 : 1;
  return {
    min: Array.from({ length: count }, (_, index) => authoredMin?.[index] ?? componentMin?.[index] ?? scalarMin ?? -Infinity),
    max: Array.from({ length: count }, (_, index) => authoredMax?.[index] ?? componentMax?.[index] ?? scalarMax ?? Infinity),
  };
}

function editorOutputRange(
  material: MaterialResource, parameter: MaterialParameter,
): { min: number[]; max: number[] } | undefined {
  const arithmetic = parameter.arithmeticFor;
  if (!arithmetic) return parameter.constantFor !== undefined
    ? surfaceInputRange(material, parameter.constantFor, parameter.type, parameter.min, parameter.max)
    : undefined;
  if (arithmetic.kind === 'mix') {
    return surfaceInputRange(
      material, arithmetic.original.input, arithmetic.original.type, arithmetic.original.min, arithmetic.original.max,
    );
  }
  const operandMin = parameter.min?.[0] ?? -Infinity;
  const operandMax = parameter.max?.[0] ?? Infinity;
  const min: number[] = [];
  const max: number[] = [];
  for (let index = 0; index < arithmetic.original.value.length; index++) {
    const sourceMin = arithmetic.original.value[index]!;
    const sourceMax = sourceMin;
    if (arithmetic.kind === 'min') {
      min.push(Math.min(sourceMin, operandMin));
      max.push(Math.min(sourceMax, operandMax));
    } else if (arithmetic.kind === 'max') {
      min.push(Math.max(sourceMin, operandMin));
      max.push(Math.max(sourceMax, operandMax));
    } else if (arithmetic.kind === 'add') {
      min.push(sourceMin + operandMin);
      max.push(sourceMax + operandMax);
    } else if (arithmetic.kind === 'subtract') {
      min.push(sourceMin - operandMax);
      max.push(sourceMax - operandMin);
    } else if (arithmetic.kind === 'divide' && operandMin > 0 && sourceMin >= 0) {
      min.push(sourceMin / operandMax);
      max.push(sourceMax / operandMin);
    } else if (arithmetic.kind === 'power' && sourceMin > 0) {
      const endpoints = [sourceMin ** operandMin, sourceMin ** operandMax];
      min.push(Math.min(...endpoints));
      max.push(Math.max(...endpoints));
    } else if ([sourceMin, sourceMax, operandMin, operandMax].every(Number.isFinite)) {
      const products = [sourceMin * operandMin, sourceMin * operandMax, sourceMax * operandMin, sourceMax * operandMax];
      min.push(Math.min(...products));
      max.push(Math.max(...products));
    } else {
      min.push(-Infinity);
      max.push(Infinity);
    }
  }
  return { min, max };
}

export function materialConstantSources(material: MaterialResource, nodeId: string, input: string): string[] {
  const parameters = material.parameters ?? [];
  const target = parameters.find(parameter => !parameter.nodeId && parameter.input === input);
  if (!target || (!canInsertMaterialConstant(material, nodeId, input)
    && !secondaryEditorSource(material, nodeId, input, target))) return [];
  return [...new Set(parameters.flatMap(source => {
    const node = source.nodeId ? material.surfaceGraph?.nodes.get(source.nodeId) : undefined;
    const output = source.constantFor !== undefined ? source.value : editorArithmeticValue(source, parameters);
    const range = editorOutputRange(material, source);
    const targetRange = surfaceInputRange(material, target.input, target.type, target.min, target.max);
    if (!source.nodeId || !node || (source.constantFor === undefined && source.arithmeticFor === undefined)
      || source.nodeId === target.linkedSource || source.type !== target.type || node.type !== target.type || !output || !range
      || output.some((value, index) => !Number.isFinite(value)
        || value < targetRange.min[index]! || value > targetRange.max[index]!)
      || range.min.some(Number.isNaN) || range.max.some(Number.isNaN)
      || targetRange.min.some((min, index) => range.min[index]! < min)
      || targetRange.max.some((max, index) => range.max[index]! > max)) return [];
    return [source.nodeId];
  }))];
}

function secondaryEditorSource(material: MaterialResource, nodeId: string, input: string, target: MaterialParameter) {
  const surface = material.resolvedSurface;
  const authored = material.surfaceGraph?.nodes.get(nodeId)?.inputs.find(candidate => candidate.name === input)?.source;
  const resolved = surface?.inputs.get(input)?.source;
  const source = target.linkedSource;
  return source && surface?.nodeId === nodeId && authored?.kind === 'connection' && authored.nodeId === source
    && resolved?.kind === 'connection' && resolved.nodeId === source ? source : undefined;
}

export function changeMaterialConstantLink(
  material: MaterialResource, nodeId: string, input: string, sourceId: string | null,
): MaterialResource {
  const { surfaceGraph: graph, resolvedSurface: surface, parameters } = material;
  const root = graph?.nodes.get(nodeId);
  const authored = root?.inputs.find(candidate => candidate.name === input);
  const normalized = surface?.inputs.get(input);
  const target = parameters?.find(parameter => !parameter.nodeId && parameter.input === input);
  if (!graph || !surface || surface.nodeId !== nodeId || !parameters || !root || !authored || !normalized || !target?.uniform) {
    throw new Error('Entrée de surface non éditable.');
  }
  const inputs = new Map(surface.inputs);
  let replacement: MaterialParameter;
  let binding: typeof authored.source;
  const previous = secondaryEditorSource(material, nodeId, input, target);
  if (sourceId !== null) {
    if (sourceId === previous) return material;
    if (!materialConstantSources(material, nodeId, input).includes(sourceId)) throw new Error('Nœud éditeur incompatible avec cette entrée.');
    binding = { kind: 'connection', nodeId: sourceId };
    const { parameter: _uniform, ...entry } = normalized;
    inputs.set(input, { ...entry, source: binding });
    replacement = { ...target, linkedSource: sourceId };
  } else {
    if (!previous) {
      throw new Error('Ce lien ne peut pas être retiré.');
    }
    binding = { kind: 'value', type: target.type, value: target.value.join(', ') };
    inputs.set(input, { ...normalized, parameter: target.uniform, source: { kind: 'value', value: target.value } });
    const { linkedSource: _link, ...entry } = target;
    replacement = entry;
  }
  const nodes = new Map(graph.nodes);
  nodes.set(nodeId, { ...root, inputs: root.inputs.map(candidate => candidate === authored ? { ...candidate, source: binding } : candidate) });
  return compileEditableMaterial({
    ...material, surfaceGraph: { ...graph, nodes }, resolvedSurface: { ...surface, inputs },
    parameters: parameters.map(parameter => parameter === target ? replacement : parameter),
  });
}

/** Insert an editor node in place of a surface literal, or fold it back into its input. */
export function changeMaterialConstant(
  material: MaterialResource, nodeId: string, inputName: string, insert: boolean, kind: EditableInputNode = 'constant',
): MaterialResource {
  const graph = material.surfaceGraph;
  const surface = material.resolvedSurface;
  if (!graph || !surface) throw new Error('Graphe de surface non éditable.');
  const parameters = material.parameters ?? [];
  const parameter = insert
    ? parameters.find(parameter => !parameter.nodeId && parameter.input === inputName)
    : parameters.find(parameter => parameter.nodeId === nodeId && parameter.input === inputName
      && (kind === 'constant' ? parameter.constantFor !== undefined : parameter.arithmeticFor?.kind === kind));
  if (!parameter || !parameter.uniform || (insert && !canInsertMaterialInputNode(material, nodeId, inputName, kind))) {
    throw new Error('Cette entrée ne permet pas cette modification de structure.');
  }
  const nodes = new Map(graph.nodes);
  const inputs = new Map(surface.inputs);
  const root = nodes.get(surface.nodeId)!;
  const original = parameter.arithmeticFor?.original;
  const destination = original?.input ?? parameter.constantFor ?? inputName;
  const authored = root.inputs.find(input => input.name === destination)!;
  const resolved = inputs.get(destination)!;
  const literal = { kind: 'value' as const, type: parameter.type, value: parameter.value.join(', ') };
  let replacements: MaterialParameter[];
  if (insert) {
    let id = `${destination}_${kind}`;
    for (let suffix = 2; nodes.has(id); suffix++) id = `${destination}_${kind}_${suffix}`;
    const source = { kind: 'connection' as const, nodeId: id };
    const { parameter: _uniform, ...normalized } = resolved;
    inputs.set(destination, { ...normalized, source });
    nodes.set(root.id, { ...root, inputs: root.inputs.map(input => input === authored ? { ...input, source } : input) });
    if (kind === 'mix') {
      const { min, max } = surfaceInputRange(material, destination, parameter.type, parameter.min, parameter.max);
      const foreground = [...max];
      const uniformNames = new Set(parameters.flatMap(current => current.uniform ? [current.uniform] : []));
      let uniformIndex = parameters.length;
      while (uniformNames.has(`parameter_${uniformIndex}`)) uniformIndex++;
      const mixUniform = `parameter_${uniformIndex}`;
      nodes.set(id, {
        id, category: 'mix', type: parameter.type, provenance: { namePath: id },
        nodeDef: { name: `ND_mix_${parameter.type}`, nodeString: 'mix', type: parameter.type,
          implementation: { kind: 'unresolved' },
          inputs: [{ name: 'bg', type: parameter.type }, { name: 'fg', type: parameter.type }, { name: 'mix', type: 'float' }] },
        inputs: [
          { name: 'bg', type: parameter.type, source: literal, provenance: { namePath: `${id}/bg` } },
          { name: 'fg', type: parameter.type, source: { kind: 'value', type: parameter.type, value: foreground.join(', ') },
            parameter: parameter.uniform, provenance: { namePath: `${id}/fg` } },
          { name: 'mix', type: 'float', source: { kind: 'value', type: 'float', value: '0' },
            parameter: mixUniform, provenance: { namePath: `${id}/mix` } },
        ],
      });
      replacements = [
        {
          id: `node:${id}/fg`, label: `${id} / fg`, type: parameter.type, value: foreground, initial: foreground,
          min, max, update: 'uniform', uniform: parameter.uniform, nodeId: id, input: 'fg',
          arithmeticFor: { kind, original: parameter, role: 'fg' },
        },
        {
          id: `node:${id}/mix`, label: `${id} / mix`, type: 'float', value: [0], initial: [0], min: [0], max: [1],
          update: 'uniform', uniform: mixUniform, nodeId: id, input: 'mix',
          arithmeticFor: { kind, original: parameter, role: 'mix' },
        },
      ];
    } else if (kind !== 'constant') {
      const type = parameter.type;
      const { initial: neutral, min, max } = arithmeticOperand(material, nodeId, parameter, kind)!;
      nodes.set(id, {
        id, category: kind, type, provenance: { namePath: id },
        nodeDef: { name: `ND_${kind}_${type === 'color3' ? 'color3FA' : 'float'}`, nodeString: kind, type,
          implementation: { kind: 'unresolved' }, inputs: [{ name: 'in1', type }, { name: 'in2', type: 'float' }] },
        inputs: [
          { name: 'in1', type, source: literal, provenance: { namePath: `${id}/in1` } },
          { name: 'in2', type: 'float', source: { kind: 'value', type: 'float', value: String(neutral) },
            parameter: parameter.uniform, provenance: { namePath: `${id}/in2` } },
        ],
      });
      replacements = [{
        id: `node:${id}/in2`, label: `${id} / in2`, type: 'float', value: [neutral], initial: [neutral], min, max,
        update: 'uniform', uniform: parameter.uniform, nodeId: id, input: 'in2', arithmeticFor: { kind, original: parameter },
      }];
    } else {
      nodes.set(id, {
        id, category: kind, type: parameter.type, provenance: { namePath: id },
        inputs: [{ name: 'value', type: parameter.type, source: literal, parameter: parameter.uniform,
          provenance: { namePath: `${id}/value` } }],
      });
      replacements = [{ ...parameter, nodeId: id, input: 'value', constantFor: destination, label: `${id} / value` }];
    }
  } else {
    // Refuse to remove a node if a future editor operation has wired it elsewhere.
    const consumers = [...nodes.values()].flatMap(node => node.inputs.filter(input =>
      input.source.kind === 'connection' && input.source.nodeId === nodeId));
    if (consumers.length !== 1 || consumers[0] !== authored || graph.terminals.some(terminal => terminal.nodeId === nodeId)) {
      throw new Error('Ce nœud est utilisé ailleurs dans le graphe.');
    }
    const value = editorArithmeticValue(parameter, parameters) ?? parameter.value;
    inputs.set(destination, { ...resolved, parameter: original?.uniform ?? parameter.uniform, source: { kind: 'value', value } });
    nodes.set(root.id, { ...root, inputs: root.inputs.map(input => input === authored
      ? { ...input, source: { ...literal, type: original?.type ?? parameter.type, value: value.join(', ') } } : input) });
    nodes.delete(nodeId);
    if (original) replacements = [{ ...original, value }];
    else {
      const { nodeId: _node, constantFor: _destination, ...rest } = parameter;
      replacements = [{ ...rest, input: destination, label: destination }];
    }
  }
  const updatedParameters = insert
    ? parameters.flatMap(current => current === parameter ? replacements : [current])
    : (() => {
      const removed = parameters.filter(current => current.nodeId === nodeId
        && (kind === 'constant' ? current.constantFor !== undefined : current.arithmeticFor?.kind === kind));
      const firstIndex = parameters.findIndex(current => removed.includes(current));
      if (firstIndex < 0) throw new Error(`Paramètres d'édition introuvables pour le nœud ${nodeId}.`);
      const remaining = parameters.filter(current => !removed.includes(current));
      remaining.splice(firstIndex, 0, ...replacements);
      return remaining;
    })();
  return compileEditableMaterial({
    ...material, surfaceGraph: { ...graph, nodes }, resolvedSurface: { ...surface, inputs },
    parameters: updatedParameters,
  });
}

/** Authored preset names across parameters, in first-seen order. */
export function parameterPresetNames(parameters: readonly MaterialParameter[]): string[] {
  return [...new Set(parameters.flatMap(parameter => parameter.presets?.map(preset => preset.name) ?? []))];
}

/** One preset name applies to every parameter declaring it, e.g. LamaSSS Color and Radius together. */
export function parameterPresetChanges(parameters: readonly MaterialParameter[], name: string): Map<string, readonly number[]> {
  return new Map(parameters.flatMap(parameter => {
    const preset = parameter.presets?.find(candidate => candidate.name === name);
    return preset ? [[parameter.id, [...preset.value]] as const] : [];
  }));
}

/** Preset whose values all match `value(parameter)`, if any. */
export function activeParameterPreset(
  parameters: readonly MaterialParameter[], value: (parameter: MaterialParameter) => readonly number[],
): string | undefined {
  const tolerance = 1e-5;
  return parameterPresetNames(parameters).find(name => [...parameterPresetChanges(parameters, name)].every(([id, preset]) => {
    const parameter = parameters.find(candidate => candidate.id === id)!;
    const current = value(parameter);
    return preset.every((component, i) => Math.abs(component - current[i]!) <= tolerance * Math.max(1, Math.abs(component)));
  }));
}

export function parameterValues(parameter: MaterialParameter, values: readonly number[]): number[] {
  const size = parameter.type === 'color3' ? 3 : parameter.type.startsWith('vector') ? Number(parameter.type.at(-1)) : 1;
  if (values.length !== size || !values.every(Number.isFinite)) throw new Error(`Invalid value for ${parameter.label}`);
  if (parameter.min?.some((minimum, index) => values[index]! < minimum)) throw new Error(`${parameter.label} is below its minimum.`);
  if (parameter.max?.some((maximum, index) => values[index]! > maximum)) throw new Error(`${parameter.label} is above its maximum.`);
  if (parameter.type === 'integer' && !Number.isInteger(values[0])) throw new Error(`${parameter.label} requires an integer.`);
  if (parameter.type === 'boolean' && values[0] !== 0 && values[0] !== 1) throw new Error(`${parameter.label} requires a boolean.`);
  return [...values];
}

/** `editor`: per-instance copies honouring `editable` selections (viewer).
 *  `uniform`: shared per material; every reachable float/color/vector literal,
 *  including unauthored nodedef defaults, moves to the parameter buffer so
 *  materials differing only by values compile to identical WGSL. */
type ParameterPolicy = 'editor' | 'uniform';

const UNIFORM_TYPES = new Set(['float', 'color3', 'vector2', 'vector3', 'vector4']);

/** Nodes feeding the surface through connections; unrelated graph nodes (e.g. volume) keep literals. */
function reachableNodes(material: MaterialResource): Set<string> {
  const graph = material.surfaceGraph!;
  const surface = material.resolvedSurface!;
  const pending = [surface.nodeId, ...(surface.backNodeId ? [surface.backNodeId] : [])];
  for (const input of surface.inputs.values()) if (input.source.kind === 'connection') pending.push(input.source.nodeId);
  for (const terminal of graph.terminals) {
    if (terminal.name === 'displacementshader' && terminal.nodeId) pending.push(terminal.nodeId);
  }
  const seen = new Set<string>();
  while (pending.length) {
    const id = pending.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const input of graph.nodes.get(id)?.inputs ?? []) if (input.source.kind === 'connection') pending.push(input.source.nodeId);
  }
  return seen;
}

function reachableDisplacementNodes(material: MaterialResource): Set<string> {
  const graph = material.surfaceGraph!;
  const pending = graph.terminals
    .filter(terminal => terminal.name === 'displacementshader' && terminal.nodeId)
    .map(terminal => terminal.nodeId!);
  const seen = new Set<string>();
  while (pending.length) {
    const id = pending.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const input of graph.nodes.get(id)?.inputs ?? []) {
      if (input.source.kind === 'connection') pending.push(input.source.nodeId);
    }
  }
  return seen;
}

/** Give each object independent values even when its original material is shared. */
export function editableSceneMaterials(resources: SceneResources): SceneResources {
  const materials = new Map(resources.materials);
  const instances = resources.instances.map(instance => {
    const material = instance.materialKey ? materials.get(instance.materialKey) : undefined;
    if (!material?.resolvedSurface || !material.surfaceGraph) return instance;
    const key = `${instance.materialKey}::editor::${instance.primPath}`;
    materials.set(key, parameterizeMaterial({ ...material, unitKey: key, boundPrims: [instance.primPath] }, 'editor'));
    return { ...instance, materialKey: key };
  });
  const used = new Set(instances.map(instance => instance.materialKey));
  for (const key of materials.keys()) if (!used.has(key)) materials.delete(key);
  return { ...resources, instances, materials };
}

/** Parameter-buffer mode: material values live in a uniform buffer instead of WGSL literals. */
export function uniformSceneMaterials(resources: SceneResources): SceneResources {
  const materials = new Map(resources.materials);
  for (const key of new Set(resources.instances.map(instance => instance.materialKey))) {
    const material = key ? materials.get(key) : undefined;
    if (key && material?.resolvedSurface && material.surfaceGraph) materials.set(key, parameterizeMaterial(material, 'uniform'));
  }
  return { ...resources, materials };
}

function parameterizeMaterial(material: MaterialResource, policy: ParameterPolicy): MaterialResource {
  {
    if (!material.resolvedSurface || !material.surfaceGraph) throw new Error('Missing editable material graph.');
    const parameters: MaterialParameter[] = [];
    let inputs = new Map(material.resolvedSurface.inputs);
    const surfaceNode = material.surfaceGraph.nodes.get(material.resolvedSurface.nodeId);
    const explicitSelection = policy === 'editor' && [...material.surfaceGraph.nodes.values()].some(node =>
      node.inputs.some(input => input.editable !== undefined));
    const reachable = policy === 'uniform' ? reachableNodes(material) : undefined;
    for (const [name, input] of inputs) {
      if (input.type === 'BSDF' || input.type === 'EDF') continue;
      const authored = surfaceNode?.inputs.find(candidate => candidate.name === name);
      if (authored?.interfaceName || authored?.source.kind === 'interface' || authored?.source.kind === 'connection') continue;
      if (input.source.kind !== 'value' && input.source.kind !== 'default') continue;
      const uniform = `parameter_${parameters.length}`;
      const rebuild = input.type === 'boolean' || input.type === 'integer'
        || explicitSelection && authored?.editable !== true;
      const feature = featureRule(material.resolvedSurface, name, input.type);
      parameters.push({
        id: `surface:${name}`, label: name, type: input.type, input: name,
        value: [...input.source.value], initial: [...input.source.value],
        ...(authored?.min !== undefined ? { min: authored.min } : {}),
        ...(authored?.max !== undefined ? { max: authored.max } : {}),
        ...(authored?.presets !== undefined ? { presets: authored.presets } : {}),
        update: rebuild ? 'rebuild' : feature ? 'feature' : 'uniform', ...(!rebuild ? { uniform } : {}),
      });
      for (const preset of authored?.presets ?? []) parameterValues(parameters.at(-1)!, preset.value);
      if (!rebuild && !feature) inputs.set(name, { ...input, parameter: uniform });
    }
    // Expose literal inputs of reachable upstream nodes; connections remain intact.
    const graphNodes = new Map(material.surfaceGraph.nodes);
    const rootId = material.resolvedSurface.nodeId;
    const root = graphNodes.get(rootId);
    if (root && material.resolvedSurface.backNodeId === rootId) {
      // The back closure re-reads the root node from the graph: share the front uniforms.
      const linked = parameters.filter(parameter => parameter.update === 'uniform' && parameter.uniform);
      const inputsWithParameters = root.inputs.map(input => {
        const parameter = linked.find(candidate => candidate.input === input.name);
        return parameter && input.source.kind === 'value' ? { ...input, parameter: parameter.uniform! } : input;
      });
      for (const parameter of linked) {
        const resolved = inputs.get(parameter.input);
        if (root.inputs.some(input => input.name === parameter.input) || resolved?.source.kind !== 'default') continue;
        inputsWithParameters.push({
          name: parameter.input, type: parameter.type,
          source: { kind: 'value', type: parameter.type, value: parameter.initial.join(', ') },
          parameter: parameter.uniform!, defaulted: true, provenance: { namePath: `${rootId}/${parameter.input}` },
        });
      }
      graphNodes.set(rootId, { ...root, inputs: inputsWithParameters });
    }
    for (const [nodeId, node] of material.surfaceGraph.nodes) {
      if (nodeId === rootId) continue;
      if (reachable && !reachable.has(nodeId)) continue;
      const inputs = [
        ...node.inputs,
        ...(node.nodeDef?.inputs ?? []).filter(input => input.value !== undefined && !input.geomprop && !node.inputs.some(authored => authored.name === input.name))
          .map(input => ({
            ...input, source: { kind: 'value' as const, type: input.type, value: input.value! },
          })),
      ];
      for (const input of inputs) {
        if ('interfaceName' in input && input.interfaceName) continue;
        if (input.source.kind !== 'value' || !isType(input.type)) continue;
        const editable = 'editable' in input ? input.editable : undefined;
        const min = 'min' in input ? input.min : undefined;
        const max = 'max' in input ? input.max : undefined;
        const presets = 'presets' in input ? input.presets : undefined;
        const values = input.source.value.trim() === 'true' ? [1] : input.source.value.trim() === 'false' ? [0]
          : input.source.value.split(',').map(Number);
        const promoted = policy === 'uniform' ? UNIFORM_TYPES.has(input.type)
          : editable === true && (input.type === 'float' || input.type === 'color3');
        const uniform = promoted ? `parameter_${parameters.length}` : undefined;
        const parameter: MaterialParameter = {
          id: JSON.stringify([nodeId, input.name]), label: `${nodeId} / ${input.name}`, type: input.type,
          value: values, initial: [...values], update: uniform ? 'uniform' : 'rebuild', nodeId, input: input.name,
          ...(uniform ? { uniform } : {}),
          ...(min !== undefined ? { min } : {}),
          ...(max !== undefined ? { max } : {}),
          ...(presets !== undefined ? { presets } : {}),
        };
        parameterValues(parameter, values);
        for (const preset of presets ?? []) parameterValues(parameter, preset.value);
        parameters.push(parameter);
        if (uniform) {
          const current = graphNodes.get(nodeId)!;
          const authored = current.inputs.some(candidate => candidate.name === input.name);
          graphNodes.set(nodeId, {
            ...current,
            inputs: authored
              ? current.inputs.map(candidate => candidate.name === input.name ? { ...candidate, parameter: uniform } : candidate)
              : [...current.inputs, {
                name: input.name, type: input.type, source: input.source, parameter: uniform, defaulted: true,
                provenance: { namePath: `${nodeId}/${input.name}` },
              }],
          });
        }
      }
    }
    // Scene clock: time/frame nodes drive surface uniforms or displacement rebuilds.
    const surfaceNodes = reachableNodes(material);
    const displacementNodes = reachableDisplacementNodes(material);
    for (const [nodeId, node] of graphNodes) {
      if (!CLOCK_CATEGORIES.has(node.category) || !surfaceNodes.has(nodeId)
        || node.inputs.some(input => input.name === CLOCK_INPUT)) continue;
      const uniform = `parameter_${parameters.length}`;
      parameters.push({
        id: `clock:${nodeId}`, label: `${nodeId} / time code`, type: 'float', value: [0], initial: [0],
        update: displacementNodes.has(nodeId) ? 'rebuild' : 'uniform', uniform, nodeId, input: CLOCK_INPUT, clock: true,
      });
      graphNodes.set(nodeId, { ...node, inputs: [...node.inputs, {
        name: CLOCK_INPUT, type: 'float', source: { kind: 'value', type: 'float', value: '0' }, parameter: uniform,
        defaulted: true, provenance: { namePath: `${nodeId}/${CLOCK_INPUT}` },
      }] });
    }
    const surface = applyFeatureStates({ ...material.resolvedSurface, inputs }, parameters);
    const surfaceGraph: ResolvedGraph = { ...material.surfaceGraph, nodes: graphNodes };
    return compileEditableMaterial({ ...material, surfaceGraph, resolvedSurface: surface, parameters });
  }
}

function compileGraphVolume(graph: ResolvedGraph) {
  const volume = resolveVolume(graph);
  if (!volume) return undefined;
  const builder = new IrModuleBuilder();
  appendVolumeIr(volume, builder, graph);
  const volumeIr = builder.build();
  return { volumeIr, volumeMedium: isSpatialVolumeIr(volumeIr) ? undefined : evaluateVolumeIr(volumeIr) };
}

export function compileEditableMaterial(material: MaterialResource): MaterialResource {
  const graph = material.surfaceGraph;
  if (!graph || !material.resolvedSurface) throw new Error('Missing editable material graph.');
  const displacement = graph.terminals.some(terminal => terminal.name === 'displacementshader')
    ? extractDisplacement(graph) : material.displacement;
  const graphHasVolume = graph.terminals.some(terminal => terminal.type === 'volumeshader');
  const volume = graphHasVolume ? compileGraphVolume(graph) : undefined;
  const volumeIr = graphHasVolume ? volume?.volumeIr : material.volumeIr;
  const volumeMedium = graphHasVolume ? volume?.volumeMedium : material.volumeMedium;
  const { displacement: _displacement, volumeIr: _volumeIr, volumeMedium: _volumeMedium, ...rest } = material;
  const surfaceModule = emitLayeredSurface(graph, material.resolvedSurface);
  const sceneShader = assembleIrForwardShader(surfaceModule, { displacement: displacement !== undefined });
  return {
    ...rest, ...(displacement ? { displacement } : {}), ...(volumeIr ? { volumeIr } : {}),
    ...(volumeMedium ? { volumeMedium } : {}), surfaceModule, sceneShader,
    variant: { ...material.variant, pipelineKey: hashString(sceneShader.code) },
  };
}

export function changeMaterialParameters(
  material: MaterialResource, changes: ReadonlyMap<string, readonly number[]>,
): MaterialResource {
  if (!material.resolvedSurface || !material.surfaceGraph || !material.parameters) throw new Error('Material has no editable parameters.');
  const rootNodeId = material.resolvedSurface.nodeId;
  const inputs = new Map(material.resolvedSurface.inputs);
  const nodes = new Map(material.surfaceGraph.nodes);
  for (const id of changes.keys()) if (!material.parameters.some(parameter => parameter.id === id)) throw new Error(`Unknown parameter: ${id}`);
  const parameters = material.parameters.map(parameter => {
    const change = changes.get(parameter.id);
    if (!change) return parameter;
    if (parameter.linkedSource) throw new Error(`Entrée connectée : ${parameter.input}.`);
    const value = parameterValues(parameter, change);
    if (parameter.nodeId) {
      const node = nodes.get(parameter.nodeId)!;
      const replacement = {
        name: parameter.input, type: parameter.type,
        source: { kind: 'value' as const, type: parameter.type, value: parameter.type === 'boolean' ? String(value[0] === 1) : value.join(', ') },
        provenance: { namePath: `${parameter.nodeId}/${parameter.input}` },
      };
      nodes.set(parameter.nodeId, {
        ...node, inputs: node.inputs.some(input => input.name === parameter.input)
          ? node.inputs.map(input => input.name === parameter.input ? { ...input, source: replacement.source } : input)
          : [...node.inputs, replacement],
      });
    } else {
      const input = inputs.get(parameter.input)!;
      inputs.set(parameter.input, { ...input, source: { kind: 'value', value } });
      const root = nodes.get(rootNodeId);
      if (root?.inputs.some(candidate => candidate.name === parameter.input)) {
        const source = {
          kind: 'value' as const, type: parameter.type,
          value: parameter.type === 'boolean' ? String(value[0] === 1) : value.join(', '),
        };
        nodes.set(root.id, {
          ...root,
          inputs: root.inputs.map(candidate => candidate.name === parameter.input ? { ...candidate, source } : candidate),
        });
      }
    }
    return { ...parameter, value };
  });
  const surface = applyFeatureStates({ ...material.resolvedSurface, inputs }, parameters);
  const graph: ResolvedGraph = { ...material.surfaceGraph, nodes };
  // Displacement amplitude lives outside the surface shader.
  const displacement = material.displacement ? extractDisplacement(graph) : undefined;
  let volumeMedium = material.volumeMedium;
  let volumeIr = material.volumeIr;
  if (volumeMedium || volumeIr) {
    const volume = compileGraphVolume(graph);
    if (!volume) throw new Error('Missing volumeshader in edited material.');
    volumeIr = volume.volumeIr;
    volumeMedium = volume.volumeMedium;
  }
  return {
    ...material, parameters, resolvedSurface: surface, surfaceGraph: graph,
    ...(volumeIr ? { volumeIr, volumeMedium } : {}),
    ...(displacement ? { displacement } : {}),
  };
}

/** WGSL uniform layout: vec3 aligns to 16 but occupies 12 bytes; structs round to 16. */
export function packParameterUniforms(
  fields: readonly WgslUniformField[], valueFor: (field: WgslUniformField) => readonly number[],
): ArrayBuffer {
  const slots: Array<{ field: WgslUniformField; offset: number; count: number }> = [];
  let size = 0;
  for (const field of fields) {
    const match = /^(f32|i32|u32|vec([234])<f32>|vec([234])f)$/.exec(field.wgslType);
    if (!match) throw new Error(`Unsupported parameter uniform type: ${field.wgslType}`);
    const count = Number(match[2] ?? match[3] ?? 1);
    const alignment = count === 3 ? 16 : count * 4;
    size = Math.ceil(size / alignment) * alignment;
    slots.push({ field, offset: size, count });
    size += count * 4;
  }
  const buffer = new ArrayBuffer(Math.max(16, Math.ceil(size / 16) * 16));
  const view = new DataView(buffer);
  for (const { field, offset, count } of slots) {
    const value = valueFor(field);
    if (value.length !== count || !value.every(Number.isFinite)) throw new Error(`Invalid uniform: ${field.name}`);
    for (let i = 0; i < count; i++) {
      if (field.wgslType === 'i32') view.setInt32(offset + i * 4, value[i]!, true);
      else if (field.wgslType === 'u32') view.setUint32(offset + i * 4, value[i]!, true);
      else view.setFloat32(offset + i * 4, value[i]!, true);
    }
  }
  return buffer;
}

export function materialUniformData(material: MaterialResource): ArrayBuffer {
  return packParameterUniforms(material.surfaceModule?.uniforms ?? [], field => {
    const parameter = material.parameters?.find(parameter => parameter.uniform === field.name);
    if (!parameter) throw new Error(`Missing material parameter: ${field.name}`);
    return parameter.value;
  });
}
