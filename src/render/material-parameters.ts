import { emitLayeredSurface } from '../compiler/surface-wgsl.ts';
import { hashString } from '../compiler/cache.ts';
import type { WgslUniformField } from '../compiler/wgsl.ts';
import type { ResolvedGraph } from '../materialx/graph.ts';
import type { ResolvedSurface } from '../materialx/surface-graph.ts';
import { assembleIrForwardShader } from './raster/ir-forward.ts';
import type { MaterialResource, SceneResources } from './scene-resources.ts';
import { extractDisplacement } from './graph-material-compiler.ts';

export interface MaterialParameter {
  id: string;
  label: string;
  type: 'float' | 'integer' | 'boolean' | 'color3' | 'vector2' | 'vector3' | 'vector4';
  value: readonly number[];
  initial: readonly number[];
  /** Uniform edits are immediate; topology, upstream nodes and displacement rebuild. */
  update: 'uniform' | 'rebuild';
  uniform?: string;
  nodeId?: string;
  input: string;
}

const numericTypes = new Set(['float', 'integer', 'boolean', 'color3', 'vector2', 'vector3', 'vector4']);

function isType(type: string): type is MaterialParameter['type'] { return numericTypes.has(type); }

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
    const inputs = new Map(material.resolvedSurface.inputs);
    for (const [name, input] of inputs) {
      if (input.source.kind !== 'value' && input.source.kind !== 'default') continue;
      const uniform = `parameter_${parameters.length}`;
      const rebuild = input.type === 'boolean' || input.type === 'integer';
      parameters.push({
        id: `surface:${name}`, label: name, type: input.type, input: name,
        value: [...input.source.value], initial: [...input.source.value],
        update: rebuild ? 'rebuild' : 'uniform', ...(!rebuild ? { uniform } : {}),
      });
      if (!rebuild) inputs.set(name, { ...input, parameter: uniform });
    }
    // Expose literal inputs of reachable upstream nodes; connections remain intact.
    for (const [nodeId, node] of material.surfaceGraph.nodes) {
      if (nodeId === material.resolvedSurface.nodeId) continue;
      const inputs = [
        ...node.inputs,
        ...(node.nodeDef?.inputs ?? []).filter(input => input.value !== undefined && !node.inputs.some(authored => authored.name === input.name))
          .map(input => ({
            ...input, source: { kind: 'value' as const, type: input.type, value: input.value! },
          })),
      ];
      for (const input of inputs) {
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
    const surface = { ...material.resolvedSurface, inputs };
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
  const surface: ResolvedSurface = { ...material.resolvedSurface, inputs };
  const graph: ResolvedGraph = { ...material.surfaceGraph, nodes };
  // Displacement amplitude lives outside the surface shader.
  const displacement = material.displacement ? extractDisplacement(graph) : undefined;
  return { ...material, parameters, resolvedSurface: surface, surfaceGraph: graph, ...(displacement ? { displacement } : {}) };
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
