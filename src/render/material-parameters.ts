import { emitLayeredSurface } from '../compiler/surface-wgsl.ts';
import { hashString } from '../compiler/cache.ts';
import type { WgslUniformField } from '../compiler/wgsl.ts';
import type { ResolvedGraph } from '../materialx/graph.ts';
import type { NormalizedSurfaceInput, ResolvedSurface } from '../materialx/surface-graph.ts';
import { assembleIrForwardShader } from './raster/ir-forward.ts';
import type { MaterialResource, SceneResources } from './scene-resources.ts';
import { extractDisplacement } from './graph-material-compiler.ts';
import { resolveVolume } from '../materialx/volume-graph.ts';
import { appendVolumeIr, evaluateVolumeIr } from '../compiler/volume-ir.ts';
import { IrModuleBuilder } from '../compiler/ir.ts';

export interface MaterialParameter {
  id: string;
  label: string;
  type: 'float' | 'integer' | 'boolean' | 'color3' | 'vector2' | 'vector3' | 'vector4';
  value: readonly number[];
  initial: readonly number[];
  /** Uniform edits are immediate; feature boundaries and topology rebuild. */
  update: 'uniform' | 'feature' | 'rebuild';
  uniform?: string;
  nodeId?: string;
  input: string;
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

export function visibleMaterialParameters(material: MaterialResource): readonly MaterialParameter[] {
  const surfaceNode = material.surfaceGraph?.nodes.get(material.resolvedSurface?.nodeId ?? '');
  return (material.parameters ?? []).filter(parameter => {
    if (parameter.nodeId) return false;
    const input = surfaceNode?.inputs.find(input => input.name === parameter.input);
    return input?.source.kind === 'value' && !input.interfaceName;
  });
}

export function parameterValues(parameter: MaterialParameter, values: readonly number[]): number[] {
  const size = parameter.type === 'color3' ? 3 : parameter.type.startsWith('vector') ? Number(parameter.type.at(-1)) : 1;
  if (values.length !== size || !values.every(Number.isFinite)) throw new Error(`Invalid value for ${parameter.label}`);
  if (parameter.type === 'integer' && !Number.isInteger(values[0])) throw new Error(`${parameter.label} requires an integer.`);
  if (parameter.type === 'boolean' && values[0] !== 0 && values[0] !== 1) throw new Error(`${parameter.label} requires a boolean.`);
  return [...values];
}

/** Give each object independent values even when its original material is shared. */
export function editableSceneMaterials(resources: SceneResources): SceneResources {
  const materials = new Map(resources.materials);
  const instances = resources.instances.map(instance => {
    const material = instance.materialKey ? materials.get(instance.materialKey) : undefined;
    if (!material?.resolvedSurface || !material.surfaceGraph) return instance;
    const key = `${instance.materialKey}::editor::${instance.primPath}`;
    const parameters: MaterialParameter[] = [];
    let inputs = new Map(material.resolvedSurface.inputs);
    const surfaceNode = material.surfaceGraph.nodes.get(material.resolvedSurface.nodeId);
    for (const [name, input] of inputs) {
      const authored = surfaceNode?.inputs.find(candidate => candidate.name === name);
      if (authored?.interfaceName || authored?.source.kind === 'interface' || authored?.source.kind === 'connection') continue;
      if (input.source.kind !== 'value' && input.source.kind !== 'default') continue;
      const uniform = `parameter_${parameters.length}`;
      const rebuild = input.type === 'boolean' || input.type === 'integer';
      const feature = featureRule(material.resolvedSurface, name, input.type);
      parameters.push({
        id: `surface:${name}`, label: name, type: input.type, input: name,
        value: [...input.source.value], initial: [...input.source.value],
        update: rebuild ? 'rebuild' : feature ? 'feature' : 'uniform', ...(!rebuild ? { uniform } : {}),
      });
      if (!rebuild && !feature) inputs.set(name, { ...input, parameter: uniform });
    }
    // Expose literal inputs of reachable upstream nodes; connections remain intact.
    for (const [nodeId, node] of material.surfaceGraph.nodes) {
      if (nodeId === material.resolvedSurface.nodeId) continue;
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
        const values = input.source.value.trim() === 'true' ? [1] : input.source.value.trim() === 'false' ? [0]
          : input.source.value.split(',').map(Number);
        const parameter: MaterialParameter = {
          id: JSON.stringify([nodeId, input.name]), label: `${nodeId} / ${input.name}`, type: input.type,
          value: values, initial: [...values], update: 'rebuild', nodeId, input: input.name,
        };
        parameterValues(parameter, values);
        parameters.push(parameter);
      }
    }
    const surface = applyFeatureStates({ ...material.resolvedSurface, inputs }, parameters);
    materials.set(key, compileEditableMaterial({ ...material, unitKey: key, boundPrims: [instance.primPath], resolvedSurface: surface, parameters }));
    return { ...instance, materialKey: key };
  });
  const used = new Set(instances.map(instance => instance.materialKey));
  for (const key of materials.keys()) if (!used.has(key)) materials.delete(key);
  return { ...resources, instances, materials };
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
  const inputs = new Map(material.resolvedSurface.inputs);
  const nodes = new Map(material.surfaceGraph.nodes);
  for (const id of changes.keys()) if (!material.parameters.some(parameter => parameter.id === id)) throw new Error(`Unknown parameter: ${id}`);
  const parameters = material.parameters.map(parameter => {
    const change = changes.get(parameter.id);
    if (!change) return parameter;
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
    }
    return { ...parameter, value };
  });
  const surface = applyFeatureStates({ ...material.resolvedSurface, inputs }, parameters);
  const graph: ResolvedGraph = { ...material.surfaceGraph, nodes };
  // Displacement amplitude lives outside the surface shader.
  const displacement = material.displacement ? extractDisplacement(graph) : undefined;
  let volumeMedium = material.volumeMedium;
  if (volumeMedium) {
    const volume = resolveVolume(graph);
    if (!volume) throw new Error('Missing volumeshader in edited material.');
    const builder = new IrModuleBuilder();
    appendVolumeIr(volume, builder);
    volumeMedium = evaluateVolumeIr(builder.build());
  }
  return {
    ...material, parameters, resolvedSurface: surface, surfaceGraph: graph,
    ...(volumeMedium ? { volumeMedium } : {}),
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
