import { describe, expect, it } from 'vitest';
import { IrModuleBuilder, FLOAT } from '../../src/compiler/ir.ts';
import { emitWgsl } from '../../src/compiler/wgsl.ts';
import { emitLayeredSurface } from '../../src/compiler/surface-wgsl.ts';
import { resolveSurface } from '../../src/materialx/surface-graph.ts';
import type { ResolvedGraph } from '../../src/materialx/graph.ts';
import { importUsdStage } from '../../src/usd/importer.ts';
import { buildSceneResources } from '../../src/render/scene-resources.ts';
import { buildMaterialDispatch } from '../../src/render/pathtracing/material-variant.ts';
import { changeMaterialParameters, compileEditableMaterial, editableSceneMaterials, materialUniformData, packParameterUniforms, parameterValues, visibleMaterialParameters } from '../../src/render/material-parameters.ts';
import { applySceneDisplacement } from '../../src/render/displacement.ts';

async function fixture(displacement = false, configure?: (graph: ResolvedGraph) => void) {
  const graph: ResolvedGraph = {
    terminals: [{ name: 'surfaceshader', type: 'surfaceshader', nodeId: 'surface', provenance: { namePath: '/surface' } }],
    nodes: new Map([['surface', {
      id: 'surface', category: 'standard_surface', type: 'surfaceshader', inputs: [], provenance: { namePath: '/surface' },
    }], ['custom_node', {
      id: 'custom_node', category: 'multiply', type: 'float',
      nodeDef: { name: 'ND_custom', nodeString: 'multiply', type: 'float', implementation: { kind: 'unresolved' },
        inputs: [{ name: 'custom_gain', type: 'float', value: '2' }, { name: 'custom_direction', type: 'vector2', value: '1, 2' },
          { name: 'enabled', type: 'boolean', value: 'true' }, { name: 'octaves', type: 'integer', value: '4' }] },
      inputs: [], provenance: { namePath: '/custom_node' },
    }]]),
  };
  if (displacement) {
    const nodes = new Map(graph.nodes);
    nodes.set('height', {
      id: 'height', category: 'tiledimage', type: 'float', provenance: { namePath: '/height' },
      inputs: [{ name: 'file', type: 'filename', source: { kind: 'value', type: 'filename', value: 'height.png' }, provenance: { namePath: '/height/file' } }],
      nodeDef: { name: 'ND_height', nodeString: 'tiledimage', type: 'float', implementation: { kind: 'unresolved' },
        inputs: [{ name: 'uvtiling', type: 'vector2', value: '1, 1' }, { name: 'uvoffset', type: 'vector2', value: '0, 0' }] },
    });
    nodes.set('disp', {
      id: 'disp', category: 'displacement', type: 'displacementshader', provenance: { namePath: '/disp' },
      inputs: [
        { name: 'scale', type: 'float', source: { kind: 'value', type: 'float', value: '0.1' }, provenance: { namePath: '/disp/scale' } },
        { name: 'displacement', type: 'float', source: { kind: 'connection', nodeId: 'height' }, provenance: { namePath: '/disp/displacement' } },
      ],
    });
    graph.nodes = nodes;
    graph.terminals = [...graph.terminals, { name: 'displacementshader', type: 'displacementshader', nodeId: 'disp', provenance: { namePath: '/disp' } }];
  }
  configure?.(graph);
  const surface = resolveSurface(graph, {})!;
  const builder = new IrModuleBuilder();
  builder.output({ name: 'color', type: FLOAT, ref: builder.constant(FLOAT, 1) });
  const ir = builder.build();
  const scene = await importUsdStage('test.usda', { reader: { read: async () => `#usda 1.0
def Material "Mat" (prepend references = @mat.mtlx@</Mat>) {}
def Mesh "a" { rel material:binding = </Mat> }
def Mesh "b" { rel material:binding = </Mat> }` } });
  return editableSceneMaterials(await buildSceneResources(scene, {
    meshSource: { meshFor: () => ({
      points: [0, 0, 0, 1, 0, 0, 0, 1, 0], faceVertexCounts: [3], faceVertexIndices: [0, 1, 2],
      primvars: [{ name: 'st', interpolation: 'vertex', elementSize: 2, values: [0, 0, 1, 0, 0, 1] }],
    }) },
    materialCompiler: { compile: () => ({ ir, module: emitWgsl(ir), graph, surface, layered: emitLayeredSurface(graph, surface),
      ...(displacement ? { displacement: { file: 'height.png', scale: 0.1 } } : {}) }) },
  }));
}

describe('dynamic MaterialX parameters', () => {
  it('shows only authored unbound surface inputs, as in absval, not implicit defaults or graph internals', async () => {
    const resources = await fixture(false, graph => {
      graph.nodes.get('surface')!.inputs = [
        { name: 'base_color', type: 'color3', source: { kind: 'connection', nodeId: 'color' }, provenance: { namePath: '/surface/base_color' } },
        { name: 'specular_roughness', type: 'float', source: { kind: 'value', type: 'float', value: '0.45' }, provenance: { namePath: '/surface/specular_roughness' } },
        { name: 'specular', type: 'float', source: { kind: 'value', type: 'float', value: '0.5' }, provenance: { namePath: '/surface/specular' } },
      ];
      graph.nodes.set('color', {
        id: 'color', category: 'constant', type: 'color3', inputs: [
          { name: 'value', type: 'color3', source: { kind: 'value', type: 'color3', value: '0.2, 0.4, 0.6' }, provenance: { namePath: '/color/value' } },
        ], provenance: { namePath: '/color' },
      });
    });
    const material = [...resources.materials.values()][0]!;
    expect(visibleMaterialParameters(material).map(parameter => [parameter.input, parameter.type, parameter.value]))
      .toEqual([['specular', 'float', [0.5]], ['specular_roughness', 'float', [0.45]]]);
    expect(material.parameters!.some(parameter => parameter.nodeId === 'color')).toBe(true);
    expect(material.parameters!.some(parameter => parameter.input === 'base')).toBe(true);
  });
  it('only exposes unbound inputs, not connections, resolved interfaces or implicit geometry properties', async () => {
    const resources = await fixture(false, graph => {
      graph.nodes.get('surface')!.inputs = [
        { name: 'base_color', type: 'color3', source: { kind: 'connection', nodeId: 'custom_node' }, provenance: { namePath: '/surface/base_color' } },
        { name: 'specular_roughness', type: 'float', interfaceName: 'roughness',
          source: { kind: 'value', type: 'float', value: '0.4' }, provenance: { namePath: '/surface/specular_roughness' } },
        { name: 'coat', type: 'float', source: { kind: 'interface', name: 'coat' }, provenance: { namePath: '/surface/coat' } },
      ];
      const upstream = graph.nodes.get('custom_node')!;
      upstream.inputs = [
        { name: 'in1', type: 'float', source: { kind: 'value', type: 'float', value: '1' }, provenance: { namePath: '/custom_node/in1' } },
        { name: 'in2', type: 'float', source: { kind: 'value', type: 'float', value: '1' }, provenance: { namePath: '/custom_node/in2' } },
        { name: 'enabled', type: 'boolean', interfaceName: 'enabled',
          source: { kind: 'value', type: 'boolean', value: 'true' }, provenance: { namePath: '/custom_node/enabled' } },
        { name: 'custom_direction', type: 'vector2', source: { kind: 'interface', name: 'direction' }, provenance: { namePath: '/custom_node/custom_direction' } },
      ];
      upstream.nodeDef!.inputs = [...upstream.nodeDef!.inputs!,
        { name: 'position', type: 'vector3', value: '0, 0, 0', geomprop: 'Pobject' }];
    });
    const material = [...resources.materials.values()][0]!;
    const ids = material.parameters!.map(parameter => parameter.id);
    expect(ids).not.toContain('surface:base_color');
    expect(ids).not.toContain('surface:specular_roughness');
    expect(ids).not.toContain('surface:coat');
    expect(ids).not.toContain(JSON.stringify(['custom_node', 'enabled']));
    expect(ids).not.toContain(JSON.stringify(['custom_node', 'custom_direction']));
    expect(ids).not.toContain(JSON.stringify(['custom_node', 'position']));
    expect(ids).toContain('surface:base');
    expect(ids).toContain(JSON.stringify(['custom_node', 'custom_gain']));
    expect(material.resolvedSurface!.inputs.get('base_color')?.source.kind).toBe('connection');
  });
  it('updates displacement from discovered inputs and rebakes original geometry, including reset', async () => {
    const resources = await fixture(true);
    const instance = resources.instances[0]!;
    const material = resources.materials.get(instance.materialKey!)!;
    const scale = material.parameters!.find(parameter => parameter.nodeId === 'disp' && parameter.input === 'scale')!;
    const provider = { decode: async () => ({
      kind: 'pixels' as const, colorSpace: 'raw' as const, channels: 4 as const, componentType: 'uint8' as const,
      width: 1, height: 1, data: new Uint8Array([255, 255, 255, 255]),
    }) };
    const initial = await applySceneDisplacement(resources, provider);
    const updated = changeMaterialParameters(material, new Map([
      [scale.id, [0.4]], [JSON.stringify(['height', 'uvtiling']), [2, 3]], [JSON.stringify(['height', 'uvoffset']), [0.2, 0.4]],
    ]));
    expect(updated.displacement).toMatchObject({ scale: 0.4, uvScale: [2, 3], uvOffset: [-0.2, -0.4] });
    const materials = new Map(resources.materials).set(instance.materialKey!, updated);
    const rebaked = await applySceneDisplacement({ ...resources, materials }, provider);
    const z = (scene: typeof resources) => scene.geometries.get(scene.instances[0]!.prototypeId)!.streams[0]!.data[2];
    expect(z(initial)).toBeCloseTo(0.05);
    expect(z(rebaked)).toBeCloseTo(0.2);
    expect(z(resources)).toBe(0);
    materials.set(instance.materialKey!, changeMaterialParameters(updated, new Map([[scale.id, scale.initial]])));
    expect(z(await applySceneDisplacement({ ...resources, materials }, provider))).toBeCloseTo(0.05);
  });
  it('discovers upstream default inputs and their types from arbitrary NodeDefs', async () => {
    const resources = await fixture();
    const material = [...resources.materials.values()][0]!;
    const inputs = material.parameters!.filter(parameter => parameter.nodeId === 'custom_node');
    expect(inputs.map(parameter => [parameter.input, parameter.type, parameter.value]))
      .toEqual([['custom_gain', 'float', [2]], ['custom_direction', 'vector2', [1, 2]], ['enabled', 'boolean', [1]], ['octaves', 'integer', [4]]]);
    const gain = inputs[0]!;
    const updated = changeMaterialParameters(material, new Map([[gain.id, [5]]]));
    expect(updated.surfaceGraph!.nodes.get('custom_node')!.inputs[0]!.source).toMatchObject({ kind: 'value', value: '5' });
    expect(material.surfaceGraph!.nodes.get('custom_node')!.inputs).toEqual([]);
  });

  it('isolates objects with shared source materials and preserves authored defaults for reset', async () => {
    const resources = await fixture();
    const [a, b] = resources.instances;
    expect(a!.materialKey).not.toBe(b!.materialKey);
    const material = resources.materials.get(a!.materialKey!)!;
    const original = material.parameters!.find(parameter => parameter.input === 'base_color' && !parameter.nodeId)!;
    const updated = changeMaterialParameters(material, new Map([[original.id, [0.2, 0.3, 0.4]]]));
    expect(updated.parameters!.find(parameter => parameter.id === original.id)!.initial).toEqual(original.initial);
    expect(resources.materials.get(b!.materialKey!)!.parameters!.find(parameter => parameter.id === original.id)!.value).toEqual(original.initial);
    const reset = changeMaterialParameters(updated, new Map([[original.id, original.initial]]));
    expect(reset.parameters!.find(parameter => parameter.id === original.id)!.value).toEqual(original.initial);
  });

  it('changes color and roughness uniforms without changing shader code; detects new lobes without a parameter-name catalogue', async () => {
    const material = [...(await fixture()).materials.values()][0]!;
    const updated = compileEditableMaterial(changeMaterialParameters(material, new Map([
      ['surface:base_color', [0.2, 0.4, 0.8]], ['surface:specular_roughness', [0.65]],
    ])));
    expect(updated.sceneShader!.code).toBe(material.sceneShader!.code);
    expect(new Uint8Array(materialUniformData(updated))).not.toEqual(new Uint8Array(materialUniformData(material)));
    const coat = compileEditableMaterial(changeMaterialParameters(updated, new Map([['surface:coat', [1]]])));
    expect(coat.surfaceModule!.features!.coat).toBe(true);
    expect(coat.sceneShader!.code).not.toBe(updated.sceneShader!.code);
    const trans = compileEditableMaterial(changeMaterialParameters(updated, new Map([['surface:transmission', [1]]])));
    expect(trans.surfaceModule!.features!.transmission).toBe(true);
    expect(trans.sceneShader!.code).not.toBe(updated.sceneShader!.code);
  });

  it('namespaces uniforms for multi-material path tracing', async () => {
    const materials = [...(await fixture()).materials.values()];
    const dispatch = buildMaterialDispatch(materials.map((material, materialIndex) => ({
      materialIndex, graph: material.surfaceGraph!, surface: material.resolvedSurface!,
    })));
    expect(new Set(dispatch.uniforms.map(field => field.field)).size).toBe(dispatch.uniforms.length);
    expect(dispatch.uniforms.some(field => field.field.startsWith('m0_'))).toBe(true);
    expect(dispatch.uniforms.some(field => field.field.startsWith('m1_'))).toBe(true);
    expect(dispatch.dispatcherWgsl).toContain('u.m0_parameter_');
    expect(dispatch.dispatcherWgsl).toContain('u.m1_parameter_');
    const data = packParameterUniforms(dispatch.uniforms, field => {
      const index = Number(/^m(\d+)_/.exec(field.field)![1]);
      return materials[index]!.parameters!.find(parameter => parameter.uniform === field.name)!.value;
    });
    expect(data.byteLength % 16).toBe(0);
  });

  it('packs vec3 alignment, scalar tails and vec2 fields according to WGSL rules', () => {
    const values: Record<string, number[]> = { scalar: [1], color: [2, 3, 4], tail: [5], uv: [6, 7] };
    const buffer = packParameterUniforms([
      { name: 'scalar', field: 'scalar', wgslType: 'f32' },
      { name: 'color', field: 'color', wgslType: 'vec3f' },
      { name: 'tail', field: 'tail', wgslType: 'i32' },
      { name: 'uv', field: 'uv', wgslType: 'vec2f' },
    ], field => values[field.name]!);
    const view = new DataView(buffer);
    expect(view.getFloat32(0, true)).toBe(1);
    expect(view.getFloat32(16, true)).toBe(2);
    expect(view.getInt32(28, true)).toBe(5);
    expect(view.getFloat32(32, true)).toBe(6);
    expect(buffer.byteLength).toBe(48);
  });

  it('rejects invalid values and unknown parameters explicitly', async () => {
    const material = [...(await fixture()).materials.values()][0]!;
    const color = material.parameters!.find(parameter => parameter.input === 'base_color')!;
    expect(() => parameterValues(color, [1, 2])).toThrow('Invalid value');
    expect(() => parameterValues(color, [1, NaN, 0])).toThrow('Invalid value');
    expect(() => changeMaterialParameters(material, new Map([['unknown', [1]]]))).toThrow('Unknown parameter');
    const integer = material.parameters!.find(parameter => parameter.type === 'integer')!;
    expect(() => parameterValues(integer, [1.5])).toThrow('integer');
  });
});
