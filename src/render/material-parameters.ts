import { emitLayeredSurface } from '../compiler/surface-wgsl.ts';
import { hashString } from '../compiler/cache.ts';
import type { WgslUniformField } from '../compiler/wgsl.ts';
import type { ResolvedGraph } from '../materialx/graph.ts';
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
  /** While linked, this parameter retains the literal to restore on disconnect. */
  linkedConstant?: string;
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
      setFeatureInput(inputs, parameters, 'opacity', true, [1]);
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
    return parameter.constantFor !== undefined || (explicitSelection ? input.editable === true : !parameter.nodeId);
  });
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

export function materialConstantSources(material: MaterialResource, nodeId: string, input: string): string[] {
  if (!canInsertMaterialConstant(material, nodeId, input)) return [];
  const target = material.parameters!.find(parameter => !parameter.nodeId && parameter.input === input)!;
  return material.parameters!.flatMap(source => {
    if (!source.nodeId || source.constantFor === undefined || source.type !== target.type
      || target.min?.some((min, index) => (source.min?.[index] ?? -Infinity) < min)
      || target.max?.some((max, index) => (source.max?.[index] ?? Infinity) > max)) return [];
    return [source.nodeId];
  });
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
  if (sourceId !== null) {
    if (!materialConstantSources(material, nodeId, input).includes(sourceId)) throw new Error('Constant incompatible avec cette entrée.');
    binding = { kind: 'connection', nodeId: sourceId };
    const { parameter: _uniform, ...entry } = normalized;
    inputs.set(input, { ...entry, source: binding });
    replacement = { ...target, linkedConstant: sourceId };
  } else {
    if (!target.linkedConstant || authored.source.kind !== 'connection' || authored.source.nodeId !== target.linkedConstant) {
      throw new Error('Ce lien ne peut pas être retiré.');
    }
    binding = { kind: 'value', type: target.type, value: target.value.join(', ') };
    inputs.set(input, { ...normalized, parameter: target.uniform, source: { kind: 'value', value: target.value } });
    const { linkedConstant: _link, ...entry } = target;
    replacement = entry;
  }
  const nodes = new Map(graph.nodes);
  nodes.set(nodeId, { ...root, inputs: root.inputs.map(candidate => candidate === authored ? { ...candidate, source: binding } : candidate) });
  return compileEditableMaterial({
    ...material, surfaceGraph: { ...graph, nodes }, resolvedSurface: { ...surface, inputs },
    parameters: parameters.map(parameter => parameter === target ? replacement : parameter),
  });
}

/** Insert a Constant in place of a surface literal, or fold an editor Constant back into its input. */
export function changeMaterialConstant(
  material: MaterialResource, nodeId: string, inputName: string, insert: boolean,
): MaterialResource {
  const graph = material.surfaceGraph;
  const surface = material.resolvedSurface;
  if (!graph || !surface) throw new Error('Graphe de surface non éditable.');
  const parameters = material.parameters ?? [];
  const parameter = insert
    ? parameters.find(parameter => !parameter.nodeId && parameter.input === inputName)
    : parameters.find(parameter => parameter.nodeId === nodeId && parameter.input === inputName && parameter.constantFor !== undefined);
  if (!parameter || !parameter.uniform || (insert && !canInsertMaterialConstant(material, nodeId, inputName))) {
    throw new Error('Cette entrée ne permet pas cette modification de structure.');
  }
  const nodes = new Map(graph.nodes);
  const inputs = new Map(surface.inputs);
  const root = nodes.get(surface.nodeId)!;
  const destination = parameter.constantFor ?? inputName;
  const authored = root.inputs.find(input => input.name === destination)!;
  const resolved = inputs.get(destination)!;
  const literal = { kind: 'value' as const, type: parameter.type, value: parameter.value.join(', ') };
  let replacement: MaterialParameter;
  if (insert) {
    let id = `${destination}_constant`;
    for (let suffix = 2; nodes.has(id); suffix++) id = `${destination}_constant_${suffix}`;
    const source = { kind: 'connection' as const, nodeId: id };
    const { parameter: _uniform, ...normalized } = resolved;
    inputs.set(destination, { ...normalized, source });
    nodes.set(root.id, { ...root, inputs: root.inputs.map(input => input === authored ? { ...input, source } : input) });
    nodes.set(id, {
      id, category: 'constant', type: parameter.type, provenance: { namePath: id },
      inputs: [{ name: 'value', type: parameter.type, source: literal, parameter: parameter.uniform,
        provenance: { namePath: `${id}/value` } }],
    });
    replacement = { ...parameter, nodeId: id, input: 'value', constantFor: destination, label: `${id} / value` };
  } else {
    // Refuse to remove a node if a future editor operation has wired it elsewhere.
    const consumers = [...nodes.values()].flatMap(node => node.inputs.filter(input =>
      input.source.kind === 'connection' && input.source.nodeId === nodeId));
    if (consumers.length !== 1 || consumers[0] !== authored || graph.terminals.some(terminal => terminal.nodeId === nodeId)) {
      throw new Error('Ce nœud Constant est utilisé ailleurs dans le graphe.');
    }
    inputs.set(destination, { ...resolved, parameter: parameter.uniform, source: { kind: 'value', value: parameter.value } });
    nodes.set(root.id, { ...root, inputs: root.inputs.map(input => input === authored ? { ...input, source: literal } : input) });
    nodes.delete(nodeId);
    const { nodeId: _node, constantFor: _destination, ...rest } = parameter;
    replacement = { ...rest, input: destination, label: destination };
  }
  return compileEditableMaterial({
    ...material, surfaceGraph: { ...graph, nodes }, resolvedSurface: { ...surface, inputs },
    parameters: parameters.map(current => current === parameter ? replacement : current),
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
  const seen = new Set<string>();
  while (pending.length) {
    const id = pending.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const input of graph.nodes.get(id)?.inputs ?? []) if (input.source.kind === 'connection') pending.push(input.source.nodeId);
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
    const surface = applyFeatureStates({ ...material.resolvedSurface, inputs }, parameters);
    const surfaceGraph: ResolvedGraph = { ...material.surfaceGraph, nodes: graphNodes };
    return compileEditableMaterial({ ...material, surfaceGraph, resolvedSurface: surface, parameters });
  }
}

export function compileEditableMaterial(material: MaterialResource): MaterialResource {
  if (!material.surfaceGraph || !material.resolvedSurface) throw new Error('Missing editable material graph.');
  const surfaceModule = emitLayeredSurface(material.surfaceGraph, material.resolvedSurface);
  const sceneShader = assembleIrForwardShader(surfaceModule, { displacement: material.displacement !== undefined });
  return { ...material, surfaceModule, sceneShader, variant: { ...material.variant, pipelineKey: hashString(sceneShader.code) } };
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
    if (parameter.linkedConstant) throw new Error(`Entrée connectée : ${parameter.input}.`);
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
    const volume = resolveVolume(graph);
    if (!volume) throw new Error('Missing volumeshader in edited material.');
    const builder = new IrModuleBuilder();
    appendVolumeIr(volume, builder, graph);
    volumeIr = builder.build();
    volumeMedium = isSpatialVolumeIr(volumeIr) ? undefined : evaluateVolumeIr(volumeIr);
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
