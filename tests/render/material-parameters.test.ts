import { describe, expect, it } from 'vitest';
import { IrModuleBuilder, FLOAT } from '../../src/compiler/ir.ts';
import { emitWgsl } from '../../src/compiler/wgsl.ts';
import { emitLayeredSurface } from '../../src/compiler/surface-wgsl.ts';
import { resolveSurface } from '../../src/materialx/surface-graph.ts';
import type { ResolvedGraph, ResolvedNodeDefRef } from '../../src/materialx/graph.ts';
import { exportSurfaceGraph } from '../../src/materialx/graph-export.ts';
import { importUsdStage } from '../../src/usd/importer.ts';
import { buildSceneResources } from '../../src/render/scene-resources.ts';
import { buildMaterialDispatch } from '../../src/render/pathtracing/material-variant.ts';
import {
  addMaterialNodeDownstream, addMaterialNodeFromDefinition, changeMaterialGraphInputLink, changeMaterialParameters, compileEditableMaterial,
  changeMaterialGraphInputValue, compatibleMaterialGraphOutputs, compatibleNodeInputChoices, compatibleNodeOutputChoices,
  editableSceneMaterials, materialUniformData, packParameterUniforms, parameterValues,
  uniformSceneMaterials, visibleMaterialParameters,
} from '../../src/render/material-parameters.ts';
import { applySceneDisplacement } from '../../src/render/displacement.ts';
import { buildSceneFrame } from '../../src/render/raster/scene-frame.ts';
import { resolveVolume } from '../../src/materialx/volume-graph.ts';
import { appendVolumeIr } from '../../src/compiler/volume-ir.ts';
import { surfaceGraphToLayered } from '../../src/compiler/surface-lower.ts';

async function fixture(displacement = false, configure?: (graph: ResolvedGraph) => void, mode: 'editor' | 'uniform' | 'literal' = 'editor') {
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
  const volume = resolveVolume(graph);
  if (volume) appendVolumeIr(volume, builder);
  const ir = builder.build();
  const scene = await importUsdStage('test.usda', { reader: { read: async () => `#usda 1.0
def Material "Mat" (prepend references = @mat.mtlx@</Mat>) {}
def Mesh "a" { rel material:binding = </Mat> }
def Mesh "b" { rel material:binding = </Mat> }` } });
  const built = await buildSceneResources(scene, {
    meshSource: { meshFor: () => ({
      points: [0, 0, 0, 1, 0, 0, 0, 1, 0], faceVertexCounts: [3], faceVertexIndices: [0, 1, 2],
      primvars: [{ name: 'st', interpolation: 'vertex', elementSize: 2, values: [0, 0, 1, 0, 0, 1] }],
    }) },
    materialCompiler: { compile: () => ({ ir, module: emitWgsl(ir), graph, surface, layered: emitLayeredSurface(graph, surface),
      ...(volume ? { volume } : {}),
      ...(displacement ? { displacement: { file: 'height.png', scale: 0.1 } } : {}) }) },
  });
  return mode === 'editor' ? editableSceneMaterials(built) : mode === 'uniform' ? uniformSceneMaterials(built) : built;
}

describe('dynamic MaterialX parameters', () => {
  it('adds arbitrary typed NodeDefs from a compatible port and restores its previous source', async () => {
    const resources = await fixture(false, graph => {
      const surface = graph.nodes.get('surface')!;
      surface.nodeDef = {
        name: 'ND_standard_surface_surfaceshader', nodeString: 'standard_surface', type: 'surfaceshader',
        implementation: { kind: 'unresolved' },
        inputs: [{ name: 'base_color', type: 'color3', value: '0.8, 0.8, 0.8' }],
      };
      surface.inputs = [{
        name: 'base_color', type: 'color3', source: { kind: 'value', type: 'color3', value: '0.8, 0.8, 0.8' },
        provenance: { namePath: '/surface/base_color' },
      }];
    });
    const material = [...resources.materials.values()][0]!;
    const definition: ResolvedNodeDefRef = {
      name: 'ND_custom_color', nodeString: 'custom_color', type: 'color3', implementation: { kind: 'unresolved' },
      inputs: [
        { name: 'in1', type: 'color3', value: '0, 0, 0' }, { name: 'in2', type: 'float', value: '0' },
        { name: 'label', type: 'string', value: 'initial' },
        { name: 'description', type: 'string' },
        { name: 'file', type: 'filename', value: 'https://example.test/texture.png' },
      ],
      outputs: [{ name: 'out', type: 'color3' }, { name: 'other', type: 'color3' }],
    };
    expect(compatibleNodeOutputChoices([definition], 'color3').map(choice => choice.output.name)).toEqual(['out', 'other']);
    expect(compatibleNodeOutputChoices([definition], 'string')).toEqual([]);
    const filenameDefinition: ResolvedNodeDefRef = {
      name: 'ND_filename_source', nodeString: 'custom_filename', type: 'filename',
      implementation: { kind: 'unresolved' }, outputs: [{ name: 'out', type: 'filename' }],
    };
    expect(compatibleNodeOutputChoices([filenameDefinition], 'filename')).toHaveLength(1);
    const updated = addMaterialNodeFromDefinition(material, 'surface', 'base_color', definition.name, 'other', [definition]);
    const nodeId = 'editor_node_1';
    expect(updated.surfaceGraph!.nodes.get('surface')!.inputs[0]!.source).toEqual({
      kind: 'connection', nodeId, output: 'other',
    });
    expect(updated.surfaceGraph!.nodes.get(nodeId)!.inputs[0]!.source)
      .toEqual({ kind: 'value', type: 'color3', value: '0.8, 0.8, 0.8' });
    expect(compatibleMaterialGraphOutputs(updated, 'surface', 'base_color'))
      .toEqual(expect.arrayContaining([expect.objectContaining({ nodeId, output: 'other', type: 'color3' })]));
    const factor = updated.parameters!.find(parameter => parameter.nodeId === nodeId && parameter.input === 'in2')!;
    const edited = changeMaterialParameters(updated, new Map([[factor.id, [0.25]]]));
    expect(edited.surfaceGraph!.nodes.get(nodeId)!.inputs.find(input => input.name === 'in2')?.source)
      .toMatchObject({ kind: 'value', value: '0.25' });
    const literalEdited = changeMaterialGraphInputValue(edited, nodeId, 'label', 'updated label');
    expect(literalEdited.surfaceGraph!.nodes.get(nodeId)!.inputs.find(input => input.name === 'label')?.source)
      .toEqual({ kind: 'value', type: 'string', value: 'updated label' });
    const defaultEdited = changeMaterialGraphInputValue(literalEdited, nodeId, 'description', 'added later');
    expect(defaultEdited.surfaceGraph!.nodes.get(nodeId)!.inputs.find(input => input.name === 'description')?.source)
      .toEqual({ kind: 'value', type: 'string', value: 'added later' });
    expect(() => changeMaterialGraphInputValue(literalEdited, nodeId, 'in1', '0.5, 0.5, 0.5'))
      .toThrow('entrée littérale non paramétrée');
    expect(() => changeMaterialGraphInputValue(literalEdited, nodeId, 'file', 'https://example.test/other.png'))
      .toThrow('filename ne peut être modifiée');
    const xml = exportSurfaceGraph(defaultEdited.surfaceGraph!, 'mat').xml;
    expect(xml).toContain(`<custom_color name="${nodeId}" type="color3" nodedef="ND_custom_color">`);
    expect(xml).toContain(`<input name="label" type="string" value="updated label" />`);
    expect(xml).toContain(`<input name="description" type="string" value="added later" />`);
    expect(xml).toContain(`<input name="file" type="filename" value="textures/texture.png" />`);
    expect(xml).toContain(`nodename="${nodeId}" output="other"`);
    expect(() => changeMaterialGraphInputLink(edited, 'surface', 'base_color', nodeId, 'missing'))
      .toThrow('Connexion impossible');
    const restored = changeMaterialGraphInputLink(edited, 'surface', 'base_color', null);
    expect(restored.surfaceGraph!.nodes.get('surface')!.inputs[0]!.source)
      .toEqual({ kind: 'value', type: 'color3', value: '0.8, 0.8, 0.8' });
  });

  it('edits and feeds NodeDef inputs the document does not author', async () => {
    const resources = await fixture(false, graph => {
      const surface = graph.nodes.get('surface')!;
      surface.nodeDef = {
        name: 'ND_standard_surface_surfaceshader', nodeString: 'standard_surface', type: 'surfaceshader',
        implementation: { kind: 'unresolved' },
        inputs: [{ name: 'base_color', type: 'color3', value: '0.8, 0.8, 0.8' }, { name: 'specular_roughness', type: 'float', value: '0.2' }],
      };
      surface.inputs = [{
        name: 'base_color', type: 'color3', source: { kind: 'value', type: 'color3', value: '0.8, 0.8, 0.8' },
        provenance: { namePath: '/surface/base_color' },
      }];
    });
    const material = [...resources.materials.values()][0]!;
    const roughness = (graph: typeof material) => graph.surfaceGraph!.nodes.get('surface')!.inputs.find(input => input.name === 'specular_roughness');
    expect(roughness(material)).toBeUndefined();
    expect(roughness(changeMaterialGraphInputValue(material, 'surface', 'specular_roughness', '0.6'))?.source)
      .toEqual({ kind: 'value', type: 'float', value: '0.6' });
    const scalar: ResolvedNodeDefRef = {
      name: 'ND_constant_float', nodeString: 'constant', type: 'float', implementation: { kind: 'unresolved' },
      inputs: [{ name: 'value', type: 'float', value: '0' }], outputs: [{ name: 'out', type: 'float' }],
    };
    const fed = addMaterialNodeFromDefinition(material, 'surface', 'specular_roughness', scalar.name, 'out', [scalar]);
    expect(roughness(fed)?.source).toEqual({ kind: 'connection', nodeId: 'editor_node_1' });
    // The NodeDef default seeds the new node, as an authored value would.
    expect(fed.surfaceGraph!.nodes.get('editor_node_1')!.inputs[0]!.source).toMatchObject({ kind: 'value', value: '0.2' });
    expect(compatibleMaterialGraphOutputs(material, 'surface', 'specular_roughness'))
      .toEqual([expect.objectContaining({ nodeId: 'custom_node', type: 'float' })]);
    // Downstream: a new node fed by an output stays off the surface until connected further.
    const mix: ResolvedNodeDefRef = {
      name: 'ND_mix_float', nodeString: 'mix', type: 'float', implementation: { kind: 'unresolved' },
      inputs: [{ name: 'fg', type: 'float', value: '0' }, { name: 'bg', type: 'float', value: '0' }, { name: 'mix', type: 'float', value: '0.5' }],
      outputs: [{ name: 'out', type: 'float' }],
    };
    expect(compatibleNodeInputChoices([mix], 'float').map(choice => choice.input)).toEqual(['fg', 'bg', 'mix']);
    const downstream = addMaterialNodeDownstream(fed, 'editor_node_1', 'out', mix.name, 'bg', [mix]);
    expect(downstream.surfaceGraph!.nodes.get('editor_node_2')!.inputs.find(input => input.name === 'bg')?.source)
      .toEqual({ kind: 'connection', nodeId: 'editor_node_1' });
    expect(downstream.resolvedSurface?.nodeId).toBe(fed.resolvedSurface?.nodeId);
    expect(() => addMaterialNodeDownstream(fed, 'editor_node_1', 'out', mix.name, 'missing', [mix])).toThrow('type d’entrée');
  });

  it('shares one shader across value-only variants in uniform parameter mode', async () => {
    const schlick = (roughness: string, reflectivity: string) => (graph: ResolvedGraph) => {
      const surface = graph.nodes.get('surface')!;
      surface.category = 'LamaLayer';
      surface.type = 'BSDF';
      surface.nodeDef = {
        name: 'ND_LamaLayer', nodeString: 'LamaLayer', type: 'BSDF', implementation: { kind: 'unresolved' },
        inputs: [{ name: 'materialTop', type: 'BSDF' }, { name: 'materialBase', type: 'BSDF' }, { name: 'topMix', type: 'float', value: '1' }],
      };
      surface.inputs = [
        { name: 'materialTop', type: 'BSDF', source: { kind: 'connection', nodeId: 'gs' }, provenance: { namePath: '/surface/materialTop' } },
        { name: 'materialBase', type: 'BSDF', source: { kind: 'connection', nodeId: 'gold' }, provenance: { namePath: '/surface/materialBase' } },
      ];
      graph.nodes.set('gs', {
        id: 'gs', category: 'LamaGeneralizedSchlick', type: 'BSDF', provenance: { namePath: '/gs' },
        nodeDef: { name: 'ND_LamaGeneralizedSchlick', nodeString: 'LamaGeneralizedSchlick', type: 'BSDF', implementation: { kind: 'unresolved' },
          inputs: [{ name: 'roughness', type: 'float', value: '0.2' }, { name: 'reflectivity', type: 'color3', value: '0.04, 0.04, 0.04' },
            { name: 'fresnelMode', type: 'integer', value: '0' }, { name: 'energyCompensation', type: 'float', value: '1' }] },
        inputs: [
          { name: 'roughness', type: 'float', source: { kind: 'value', type: 'float', value: roughness }, provenance: { namePath: '/gs/roughness' } },
          { name: 'reflectivity', type: 'color3', source: { kind: 'value', type: 'color3', value: reflectivity }, provenance: { namePath: '/gs/reflectivity' } },
        ],
      });
      graph.nodes.set('gold', { id: 'gold', category: 'LamaConductor', type: 'BSDF', provenance: { namePath: '/gold' }, inputs: [] });
    };
    const dispatchOf = (resources: Awaited<ReturnType<typeof fixture>>) => {
      const material = [...resources.materials.values()][0]!;
      return { material, dispatch: buildMaterialDispatch([{ materialIndex: 0, graph: material.surfaceGraph!, surface: material.resolvedSurface! }]) };
    };
    const literalA = dispatchOf(await fixture(false, schlick('0.1', '0.9, 0.2, 0.1'), 'literal'));
    const literalB = dispatchOf(await fixture(false, schlick('0.6', '0.1, 0.5, 0.9'), 'literal'));
    expect(literalA.dispatch.dispatcherWgsl).not.toBe(literalB.dispatch.dispatcherWgsl);

    const uniformA = dispatchOf(await fixture(false, schlick('0.1', '0.9, 0.2, 0.1'), 'uniform'));
    const uniformB = dispatchOf(await fixture(false, schlick('0.6', '0.1, 0.5, 0.9'), 'uniform'));
    expect(uniformA.dispatch.dispatcherWgsl).toBe(uniformB.dispatch.dispatcherWgsl);
    expect(uniformA.material.sceneShader!.code).toBe(uniformB.material.sceneShader!.code);
    expect(uniformA.material.variant.pipelineKey).toBe(uniformB.material.variant.pipelineKey);
    expect(new Uint8Array(materialUniformData(uniformA.material))).not.toEqual(new Uint8Array(materialUniformData(uniformB.material)));
    // Unauthored defaults become uniforms too; integer modes stay compile-time literals.
    const gsInputs = uniformA.material.surfaceGraph!.nodes.get('gs')!.inputs;
    expect(gsInputs.find(input => input.name === 'energyCompensation')).toMatchObject({ defaulted: true, parameter: expect.any(String) });
    expect(gsInputs.find(input => input.name === 'fresnelMode')?.parameter).toBeUndefined();
    expect(uniformA.material.parameters!.find(parameter => parameter.input === 'roughness')?.update).toBe('uniform');
    expect(uniformA.material.parameters!.find(parameter => parameter.input === 'fresnelMode')?.update).toBe('rebuild');
  });

  it('parameterizes the LamaSurface back closure when it reuses the front node', async () => {
    const twoSided = (roughness: string) => (graph: ResolvedGraph) => {
      const surface = graph.nodes.get('surface')!;
      surface.category = 'LamaGeneralizedSchlick';
      surface.type = 'BSDF';
      surface.nodeDef = { name: 'ND_LamaGeneralizedSchlick', nodeString: 'LamaGeneralizedSchlick', type: 'BSDF', implementation: { kind: 'unresolved' },
        inputs: [{ name: 'roughness', type: 'float', value: '0.2' }, { name: 'absorptionRadius', type: 'float', value: '0.08' }] };
      surface.inputs = [{ name: 'roughness', type: 'float', source: { kind: 'value', type: 'float', value: roughness }, provenance: { namePath: '/surface/roughness' } }];
      graph.lamaSurface = { backNodeId: 'surface' };
    };
    const shaderOf = async (roughness: string) => [...(await fixture(false, twoSided(roughness), 'uniform')).materials.values()][0]!;
    const [a, b] = [await shaderOf('0.1'), await shaderOf('0.7')];
    expect(a.resolvedSurface!.backNodeId).toBe('surface');
    expect(a.sceneShader!.code).toBe(b.sceneShader!.code);
    expect(a.surfaceGraph!.nodes.get('surface')!.inputs.find(input => input.name === 'absorptionRadius')).toMatchObject({ defaulted: true });
  });

  it('updates explicitly editable dielectric colors as uniforms without compiling unrelated inputs', async () => {
    const resources = await fixture(false, graph => {
      const node = graph.nodes.get('surface')!;
      node.category = 'LamaDielectric';
      node.type = 'BSDF';
      node.nodeDef = {
        name: 'ND_LamaDielectric', nodeString: 'LamaDielectric', type: 'BSDF',
        implementation: { kind: 'unresolved' },
        inputs: [
          { name: 'reflectionTint', type: 'color3', value: '1, 1, 1' },
          { name: 'transmissionTint', type: 'color3', value: '1, 1, 1' },
          { name: 'roughness', type: 'float', value: '0.08' },
        ],
      };
      node.inputs = [
        { name: 'reflectionTint', type: 'color3', editable: true, source: { kind: 'value', type: 'color3', value: '1, 1, 1' }, provenance: { namePath: '/surface/reflectionTint' } },
        { name: 'transmissionTint', type: 'color3', editable: true, source: { kind: 'value', type: 'color3', value: '0.2, 0.6, 1' }, provenance: { namePath: '/surface/transmissionTint' } },
        { name: 'roughness', type: 'float', source: { kind: 'value', type: 'float', value: '0.08' }, provenance: { namePath: '/surface/roughness' } },
      ];
    });
    const material = [...resources.materials.values()][0]!;
    const parameters = visibleMaterialParameters(material);
    expect(parameters.map(parameter => parameter.input)).toEqual(['reflectionTint', 'transmissionTint']);
    expect(parameters.map(parameter => parameter.update)).toEqual(['uniform', 'uniform']);
    expect(material.surfaceModule!.uniforms.map(field => field.name).sort())
      .toEqual(parameters.map(parameter => parameter.uniform).sort());
    const reflection = parameters[0]!;
    const transmission = parameters[1]!;
    const updated = changeMaterialParameters(material, new Map([
      [reflection.id, [0.3, 0.4, 0.5]], [transmission.id, [0.7, 0.8, 0.9]],
    ]));
    expect(compileEditableMaterial(updated).sceneShader!.code).toBe(material.sceneShader!.code);
    expect(Array.from(new Float32Array(materialUniformData(updated)))).toEqual([
      expect.closeTo(0.3), expect.closeTo(0.4), expect.closeTo(0.5), 0,
      expect.closeTo(0.7), expect.closeTo(0.8), expect.closeTo(0.9), 0,
    ]);
    const dispatch = buildMaterialDispatch([{ materialIndex: 0, graph: material.surfaceGraph!, surface: material.resolvedSurface! }]);
    for (const parameter of parameters) {
      expect(dispatch.uniforms.find(field => field.name === parameter.uniform)?.wgslType).toBe('vec3f');
      expect(dispatch.dispatcherWgsl).toContain(`u.m0_${parameter.uniform}`);
    }
    const reset = changeMaterialParameters(updated, new Map(parameters.map(parameter => [parameter.id, parameter.initial])));
    expect(new Uint8Array(materialUniformData(reset))).toEqual(new Uint8Array(materialUniformData(material)));
  });

  it('emits editable upstream color inputs as uniforms in raster and path tracing', async () => {
    const resources = await fixture(false, graph => {
      graph.nodes.get('surface')!.inputs = [
        { name: 'base_color', type: 'color3', source: { kind: 'connection', nodeId: 'color' }, provenance: { namePath: '/surface/base_color' } },
      ];
      graph.nodes.set('color', {
        id: 'color', category: 'multiply', type: 'color3', provenance: { namePath: '/color' },
        inputs: [
          { name: 'in1', type: 'color3', editable: true, source: { kind: 'value', type: 'color3', value: '0.2, 0.4, 0.6' }, provenance: { namePath: '/color/in1' } },
          { name: 'in2', type: 'color3', source: { kind: 'value', type: 'color3', value: '1, 1, 1' }, provenance: { namePath: '/color/in2' } },
        ],
      });
    });
    const material = [...resources.materials.values()][0]!;
    const [parameter] = visibleMaterialParameters(material);
    expect(parameter?.update).toBe('uniform');
    expect(material.surfaceModule!.uniforms.some(field => field.name === parameter!.uniform)).toBe(true);
    const dispatch = buildMaterialDispatch([{ materialIndex: 0, graph: material.surfaceGraph!, surface: material.resolvedSurface! }]);
    expect(dispatch.dispatcherWgsl).toContain(`u.m0_${parameter!.uniform}`);
    const updated = changeMaterialParameters(material, new Map([[parameter!.id, [0.1, 0.3, 0.5]]]));
    expect(compileEditableMaterial(updated).sceneShader!.code).toBe(material.sceneShader!.code);
    expect(Array.from(new Float32Array(materialUniformData(updated))).slice(0, 3))
      .toEqual([expect.closeTo(0.1), expect.closeTo(0.3), expect.closeTo(0.5)]);
  });

  it('exposes the opted-in dielectric IOR as a uniform without changing the LamaLayer shader', async () => {
    const resources = await fixture(false, graph => {
      const surface = graph.nodes.get('surface')!;
      surface.category = 'LamaLayer';
      surface.type = 'BSDF';
      surface.nodeDef = {
        name: 'ND_LamaLayer', nodeString: 'LamaLayer', type: 'BSDF',
        implementation: { kind: 'unresolved' },
        inputs: [
          { name: 'materialTop', type: 'BSDF' }, { name: 'materialBase', type: 'BSDF' },
          { name: 'topMix', type: 'float', value: '1' },
        ],
      };
      surface.inputs = [
        { name: 'materialTop', type: 'BSDF', source: { kind: 'connection', nodeId: 'coat' }, provenance: { namePath: '/surface/materialTop' } },
        { name: 'materialBase', type: 'BSDF', source: { kind: 'connection', nodeId: 'gold' }, provenance: { namePath: '/surface/materialBase' } },
        { name: 'topMix', type: 'float', editable: true, min: [0], max: [1],
          source: { kind: 'value', type: 'float', value: '1' }, provenance: { namePath: '/surface/topMix' } },
      ];
      graph.nodes.set('coat', {
        id: 'coat', category: 'LamaDielectric', type: 'BSDF', provenance: { namePath: '/coat' },
        inputs: [
          { name: 'IOR', type: 'float', editable: true, min: [1], max: [3], source: { kind: 'value', type: 'float', value: '1.5' }, provenance: { namePath: '/coat/IOR' } },
          { name: 'fresnelMode', type: 'integer', source: { kind: 'value', type: 'integer', value: '1' }, provenance: { namePath: '/coat/fresnelMode' } },
        ],
      });
      graph.nodes.set('gold', {
        id: 'gold', category: 'LamaConductor', type: 'BSDF', provenance: { namePath: '/gold' }, inputs: [],
      });
    });
    const material = [...resources.materials.values()][0]!;
    const parameters = visibleMaterialParameters(material);
    const ior = parameters.find(parameter => parameter.input === 'IOR')!;
    const topMix = parameters.find(parameter => parameter.input === 'topMix')!;
    expect(visibleMaterialParameters(material, 'coat')).toEqual([ior]);
    expect(visibleMaterialParameters(material, 'gold')).toEqual([]);
    expect(ior.update).toBe('uniform');
    expect(topMix.update).toBe('uniform');
    expect(topMix.min).toEqual([0]);
    expect(topMix.max).toEqual([1]);
    expect(ior.uniform).toBeDefined();
    expect(ior.min).toEqual([1]);
    expect(ior.max).toEqual([3]);
    expect(parameterValues(ior, [3])).toEqual([3]);
    expect(() => parameterValues(ior, [0.9])).toThrow('below its minimum');
    expect(() => parameterValues(ior, [3.1])).toThrow('above its maximum');
    const original = surfaceGraphToLayered(material.resolvedSurface!, material.surfaceGraph!);
    const updated = compileEditableMaterial(changeMaterialParameters(material, new Map([[ior.id, [3]]])));
    const changed = surfaceGraphToLayered(updated.resolvedSurface!, updated.surfaceGraph!);
    expect(original.coat?.ior).toBe(1.5);
    expect(changed.coat?.ior).toBe(3);
    expect(changed.lobes).toEqual(original.lobes);
    expect(material.surfaceModule!.uniforms.some(field => field.name === ior.uniform)).toBe(true);
    expect(updated.sceneShader!.code).toBe(material.sceneShader!.code);
    const dispatch = buildMaterialDispatch([{ materialIndex: 0, graph: material.surfaceGraph!, surface: material.resolvedSurface! }]);
    expect(dispatch.uniforms.some(field => field.name === ior.uniform)).toBe(true);
    expect(dispatch.dispatcherWgsl).toContain(`u.m0_${ior.uniform}`);
    const initialUniforms = new Float32Array(materialUniformData(material));
    const changedUniforms = new Float32Array(materialUniformData(updated));
    expect(Array.from(initialUniforms)).toContain(1.5);
    expect(Array.from(changedUniforms)).toContain(3);
    expect(Array.from(changedUniforms)).not.toEqual(Array.from(initialUniforms));
    expect(visibleMaterialParameters(updated).map(parameter => parameter.input).sort()).toEqual(['IOR', 'topMix']);
    const reset = changeMaterialParameters(updated, new Map([[ior.id, ior.initial]]));
    expect(surfaceGraphToLayered(reset.resolvedSurface!, reset.surfaceGraph!).coat?.ior).toBe(1.5);
    const changedMix = compileEditableMaterial(changeMaterialParameters(material, new Map([[topMix.id, [0.25]]])));
    expect(changedMix.sceneShader!.code).toBe(material.sceneShader!.code);
    expect(surfaceGraphToLayered(changedMix.resolvedSurface!, changedMix.surfaceGraph!).coat?.weight).toBeCloseTo(0.25);
    expect(Array.from(new Float32Array(materialUniformData(changedMix)))).toContain(0.25);
  });

  it('can hide every control and does not expose marked connections or interfaces', async () => {
    const resources = await fixture(false, graph => {
      graph.nodes.get('surface')!.inputs = [
        { name: 'specular', type: 'float', editable: false, source: { kind: 'value', type: 'float', value: '1' }, provenance: { namePath: '/surface/specular' } },
        { name: 'base_color', type: 'color3', editable: true, source: { kind: 'connection', nodeId: 'color' }, provenance: { namePath: '/surface/base_color' } },
        { name: 'specular_roughness', type: 'float', editable: true, interfaceName: 'roughness',
          source: { kind: 'value', type: 'float', value: '0.4' }, provenance: { namePath: '/surface/specular_roughness' } },
      ];
      graph.nodes.set('color', {
        id: 'color', category: 'constant', type: 'color3', provenance: { namePath: '/color' },
        inputs: [{ name: 'value', type: 'color3', source: { kind: 'value', type: 'color3', value: '1, 1, 1' }, provenance: { namePath: '/color/value' } }],
      });
    });
    expect(visibleMaterialParameters([...resources.materials.values()][0]!)).toEqual([]);
  });
  it('rebuilds explicit volume coefficients when an upstream VDF parameter changes', async () => {
    const resources = await fixture(false, graph => {
      graph.terminals = [...graph.terminals, { name: 'volumeshader', type: 'volumeshader', nodeId: 'volume', provenance: { namePath: '/volume' } }];
      graph.nodes.set('volume', {
        id: 'volume', category: 'volume', type: 'volumeshader', provenance: { namePath: '/volume' },
        inputs: [{ name: 'vdf', type: 'VDF', source: { kind: 'connection', nodeId: 'vdf' }, provenance: { namePath: '/volume/vdf' } }],
      });
      graph.nodes.set('vdf', {
        id: 'vdf', category: 'anisotropic_vdf', type: 'VDF', provenance: { namePath: '/vdf' },
        inputs: [{ name: 'absorption', type: 'vector3', source: { kind: 'value', type: 'vector3', value: '0.1, 0.2, 0.3' }, provenance: { namePath: '/vdf/absorption' } }],
      });
    });
    const material = [...resources.materials.values()][0]!;
    const parameter = material.parameters!.find(p => p.nodeId === 'vdf' && p.input === 'absorption')!;
    const changed = changeMaterialParameters(material, new Map([[parameter.id, [0.4, 0.5, 0.6]]]));
    expect(changed.volumeMedium?.absorption).toEqual([0.4, 0.5, 0.6]);
    expect(material.volumeMedium?.absorption).toEqual([0.1, 0.2, 0.3]);
    expect(() => changeMaterialParameters(material, new Map([[parameter.id, [-1, 0, 0]]]))).toThrow('Invalid volume coefficient');
  });
  it('recompiles volume coefficients when its VDF connection changes', async () => {
    const resources = await fixture(false, graph => {
      graph.terminals = [...graph.terminals, { name: 'volumeshader', type: 'volumeshader', nodeId: 'volume', provenance: { namePath: '/volume' } }];
      graph.nodes.set('volume', {
        id: 'volume', category: 'volume', type: 'volumeshader', provenance: { namePath: '/volume' },
        inputs: [{ name: 'vdf', type: 'VDF', source: { kind: 'connection', nodeId: 'vdf' }, provenance: { namePath: '/volume/vdf' } }],
      });
      for (const [id, value] of [['vdf', '0.1, 0.2, 0.3'], ['vdf2', '0.4, 0.5, 0.6']] as const) {
        graph.nodes.set(id, {
          id, category: 'anisotropic_vdf', type: 'VDF', provenance: { namePath: `/${id}` },
          inputs: [{ name: 'absorption', type: 'vector3', source: { kind: 'value', type: 'vector3', value }, provenance: { namePath: `/${id}/absorption` } }],
        });
      }
      graph.nodes.set('invalidVdf', {
        id: 'invalidVdf', category: 'constant', type: 'VDF', inputs: [], provenance: { namePath: '/invalidVdf' },
      });
    });
    const material = [...resources.materials.values()][0]!;
    const changed = changeMaterialGraphInputLink(material, 'volume', 'vdf', 'vdf2');
    expect(changed.volumeMedium?.absorption).toEqual([0.4, 0.5, 0.6]);
    expect(changed.volumeIr).not.toBe(material.volumeIr);
    expect(changeMaterialGraphInputLink(changed, 'volume', 'vdf', null).volumeMedium?.absorption)
      .toEqual([0.1, 0.2, 0.3]);
    expect(material.volumeMedium?.absorption).toEqual([0.1, 0.2, 0.3]);
    expect(() => changeMaterialGraphInputLink(material, 'volume', 'vdf', 'invalidVdf'))
      .toThrow('anisotropic_vdf');
  });
  it('shows only authored unbound surface inputs, as in absval, not implicit defaults or graph internals', async () => {
    const resources = await fixture(false, graph => {
      graph.nodes.get('surface')!.inputs = [
        { name: 'base_color', type: 'color3', source: { kind: 'connection', nodeId: 'color' }, provenance: { namePath: '/surface/base_color' } },
        { name: 'metalness', type: 'float', source: { kind: 'connection', nodeId: 'color' }, provenance: { namePath: '/surface/metalness' } },
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
    expect(material.parameters!.some(parameter => parameter.input === 'metalness' && !parameter.nodeId)).toBe(false);
    expect(material.surfaceModule!.features!.lobeKinds).toContain(4);
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
  it('marks scene-clock nodes driving displacement for geometry rebuilds', async () => {
    const resources = await fixture(true, graph => {
      graph.nodes.set('clock', {
        id: 'clock', category: 'time', type: 'float',
        inputs: [{ name: 'fps', type: 'float', source: { kind: 'value', type: 'float', value: '24' },
          provenance: { namePath: '/clock/fps' } }],
        provenance: { namePath: '/clock' },
      });
      const displacement = graph.nodes.get('disp')!;
      graph.nodes.set('disp', {
        ...displacement,
        inputs: displacement.inputs.map(input => input.name === 'displacement'
          ? { ...input, source: { kind: 'connection' as const, nodeId: 'clock' } } : input),
      });
    });
    const material = [...resources.materials.values()][0]!;
    const clock = material.parameters?.find(parameter => parameter.clock);
    expect(clock).toMatchObject({ update: 'rebuild', nodeId: 'clock' });
  });
  it('refreshes displacement when its height source is rewired or removed', async () => {
    const resources = await fixture(true, graph => {
      const height = graph.nodes.get('height')!;
      graph.nodes.set('otherHeight', {
        ...height, id: 'otherHeight', inputs: [{
          name: 'file', type: 'filename', source: { kind: 'value', type: 'filename', value: 'other.png' },
          provenance: { namePath: '/otherHeight/file' },
        }],
      });
      graph.nodes.set('flatHeight', {
        id: 'flatHeight', category: 'constant', type: 'float',
        inputs: [{ name: 'value', type: 'float', source: { kind: 'value', type: 'float', value: '0' },
          provenance: { namePath: '/flatHeight/value' } }],
        provenance: { namePath: '/flatHeight' },
      });
    });
    const material = [...resources.materials.values()][0]!;
    const changed = changeMaterialGraphInputLink(material, 'disp', 'displacement', 'otherHeight');
    expect(changed.displacement).toMatchObject({ file: 'other.png', scale: 0.1 });
    expect(changeMaterialGraphInputLink(changed, 'disp', 'displacement', null).displacement)
      .toMatchObject({ file: 'height.png', scale: 0.1 });
    expect(changeMaterialGraphInputLink(material, 'disp', 'displacement', 'flatHeight').displacement).toBeUndefined();
    expect(material.displacement?.file).toBe('height.png');
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

  it('keeps ordinary numeric edits live and specializes feature toggles at their boundaries', async () => {
    const material = [...(await fixture()).materials.values()][0]!;
    const updated = compileEditableMaterial(changeMaterialParameters(material, new Map([
      ['surface:base_color', [0.2, 0.4, 0.8]], ['surface:specular_roughness', [0.65]],
    ])));
    expect(updated.sceneShader!.code).toBe(material.sceneShader!.code);
    expect(new Uint8Array(materialUniformData(updated))).not.toEqual(new Uint8Array(materialUniformData(material)));

    expect(material.surfaceModule!.features!.lobeKinds).not.toContain(4);
    expect(material.surfaceModule!.features!.lobeKinds).not.toContain(8);
    expect(material.surfaceModule!.features!.coat).toBe(false);
    expect(material.surfaceModule!.features!.opaque).toBe(true);

    const metal = compileEditableMaterial(changeMaterialParameters(material, new Map([['surface:metalness', [0.35]]])));
    expect(metal.surfaceModule!.features!.lobeKinds).toContain(4);
    expect(metal.sceneShader!.code).not.toBe(material.sceneShader!.code);
    const metalLiveEdit = compileEditableMaterial(changeMaterialParameters(metal, new Map([['surface:metalness', [0.7]]])));
    expect(metalLiveEdit.sceneShader!.code).toBe(metal.sceneShader!.code);
    expect(new Uint8Array(materialUniformData(metalLiveEdit))).not.toEqual(new Uint8Array(materialUniformData(metal)));
    const noMetal = compileEditableMaterial(changeMaterialParameters(metalLiveEdit, new Map([['surface:metalness', [0]]])));
    expect(noMetal.surfaceModule!.features!.lobeKinds).not.toContain(4);
    expect(noMetal.sceneShader!.code).not.toBe(metalLiveEdit.sceneShader!.code);

    const coat = compileEditableMaterial(changeMaterialParameters(updated, new Map([['surface:coat', [1]]])));
    expect(coat.surfaceModule!.features!.coat).toBe(true);
    expect(coat.sceneShader!.code).not.toBe(updated.sceneShader!.code);
    const coatLiveEdit = compileEditableMaterial(changeMaterialParameters(coat, new Map([['surface:coat', [0.5]]])));
    expect(coatLiveEdit.sceneShader!.code).toBe(coat.sceneShader!.code);
    expect(new Uint8Array(materialUniformData(coatLiveEdit))).not.toEqual(new Uint8Array(materialUniformData(coat)));
    const noCoat = compileEditableMaterial(changeMaterialParameters(coatLiveEdit, new Map([['surface:coat', [0]]])));
    expect(noCoat.surfaceModule!.features!.coat).toBe(false);
    expect(noCoat.sceneShader!.code).not.toBe(coatLiveEdit.sceneShader!.code);

    const trans = compileEditableMaterial(changeMaterialParameters(updated, new Map([['surface:transmission', [1]]])));
    expect(trans.surfaceModule!.features!.transmission).toBe(true);
    expect(trans.sceneShader!.code).not.toBe(updated.sceneShader!.code);

    const transparent = compileEditableMaterial(changeMaterialParameters(material, new Map([['surface:opacity', [0.7, 0.7, 0.7]]])));
    expect(transparent.surfaceModule!.features!.opaque).toBe(false);
    expect(transparent.sceneShader!.code).not.toBe(material.sceneShader!.code);
    const opacityEdit = compileEditableMaterial(changeMaterialParameters(transparent, new Map([['surface:opacity', [0.4, 0.4, 0.4]]])));
    expect(opacityEdit.sceneShader!.code).toBe(transparent.sceneShader!.code);
    const opaque = compileEditableMaterial(changeMaterialParameters(opacityEdit, new Map([['surface:opacity', [1, 1, 1]]])));
    expect(opaque.surfaceModule!.features!.opaque).toBe(true);
    expect(opaque.sceneShader!.code).not.toBe(opacityEdit.sceneShader!.code);
  });

  it('specializes open PBR fuzz only for literal zero/nonzero values', async () => {
    const material = [...(await fixture(false, graph => {
      graph.nodes.get('surface')!.category = 'open_pbr_surface';
    })).materials.values()][0]!;
    expect(material.surfaceModule!.features!.fuzz).toBe(false);
    const fuzz = compileEditableMaterial(changeMaterialParameters(material, new Map([['surface:fuzz_weight', [0.4]]])));
    expect(fuzz.surfaceModule!.features!.fuzz).toBe(true);
    const liveEdit = compileEditableMaterial(changeMaterialParameters(fuzz, new Map([['surface:fuzz_weight', [0.8]]])));
    expect(liveEdit.sceneShader!.code).toBe(fuzz.sceneShader!.code);
    const noFuzz = compileEditableMaterial(changeMaterialParameters(liveEdit, new Map([['surface:fuzz_weight', [0]]])));
    expect(noFuzz.surfaceModule!.features!.fuzz).toBe(false);
    expect(noFuzz.sceneShader!.code).not.toBe(liveEdit.sceneShader!.code);
  });

  it('retains editable alpha thresholds when coverage depends on an upstream graph', async () => {
    for (const category of ['gltf_pbr', 'UsdPreviewSurface']) {
      const alpha = category === 'gltf_pbr' ? 'alpha' : 'opacity';
      const threshold = category === 'gltf_pbr' ? 'alpha_cutoff' : 'opacityThreshold';
      const resources = await fixture(false, graph => {
        const node = graph.nodes.get('surface')!;
        node.category = category;
        node.inputs = [
          { name: alpha, type: 'float', source: { kind: 'connection', nodeId: 'coverage' }, provenance: { namePath: `/surface/${alpha}` } },
          { name: threshold, type: 'float', source: { kind: 'value', type: 'float', value: '0.2' }, provenance: { namePath: `/surface/${threshold}` } },
          ...(category === 'gltf_pbr' ? [{
            name: 'alpha_mode', type: 'integer', source: { kind: 'value' as const, type: 'integer', value: '1' }, provenance: { namePath: '/surface/alpha_mode' },
          }] : []),
        ];
        graph.nodes.set('coverage', {
          id: 'coverage', category: 'constant', type: 'float', provenance: { namePath: '/coverage' },
          inputs: [{ name: 'value', type: 'float', source: { kind: 'value', type: 'float', value: '0.3' }, provenance: { namePath: '/coverage/value' } }],
        });
      });
      const material = [...resources.materials.values()][0]!;
      expect(material.resolvedSurface!.inputs.get(alpha)!.source.kind).toBe('connection');
      expect(material.resolvedSurface!.inputs.get(threshold)!.parameter).toBeDefined();
      const edited = compileEditableMaterial(changeMaterialParameters(material, new Map([[`surface:${threshold}`, [0.4]]])));
      expect(edited.resolvedSurface!.inputs.get(alpha)!.source.kind).toBe('connection');
      expect(edited.resolvedSurface!.inputs.get(threshold)!.parameter).toBeDefined();
      expect(edited.sceneShader!.code).toBe(material.sceneShader!.code);
      expect(edited.parameters!.find(parameter => parameter.input === threshold)!.value).toEqual([0.4]);
    }
  });

  it('specializes glTF mask and USD opacity coverage from current values', async () => {
    const gltf = [...(await fixture(false, graph => {
      graph.nodes.get('surface')!.category = 'gltf_pbr';
      graph.nodes.get('surface')!.inputs = [
        { name: 'alpha_mode', type: 'integer', source: { kind: 'value', type: 'integer', value: '1' }, provenance: { namePath: '/surface/alpha_mode' } },
        { name: 'alpha', type: 'float', source: { kind: 'value', type: 'float', value: '0.75' }, provenance: { namePath: '/surface/alpha' } },
        { name: 'alpha_cutoff', type: 'float', source: { kind: 'value', type: 'float', value: '0.5' }, provenance: { namePath: '/surface/alpha_cutoff' } },
      ];
    })).materials.values()][0]!;
    expect(gltf.surfaceModule!.features!.opaque).toBe(true);
    const masked = compileEditableMaterial(changeMaterialParameters(gltf, new Map([['surface:alpha', [0.25]]])));
    expect(masked.surfaceModule!.features!.opaque).toBe(false);
    expect(masked.sceneShader!.code).not.toBe(gltf.sceneShader!.code);

    const usd = [...(await fixture(false, graph => {
      graph.nodes.get('surface')!.category = 'UsdPreviewSurface';
      graph.nodes.get('surface')!.inputs = [
        { name: 'opacity', type: 'float', source: { kind: 'value', type: 'float', value: '0.5' }, provenance: { namePath: '/surface/opacity' } },
        { name: 'opacityThreshold', type: 'float', source: { kind: 'value', type: 'float', value: '0.2' }, provenance: { namePath: '/surface/opacityThreshold' } },
      ];
    })).materials.values()][0]!;
    expect(usd.surfaceModule!.features!.opaque).toBe(true);
    const cutout = compileEditableMaterial(changeMaterialParameters(usd, new Map([['surface:opacity', [0.1]]])));
    expect(cutout.surfaceModule!.features!.opaque).toBe(false);
    expect(cutout.sceneShader!.code).not.toBe(usd.sceneShader!.code);
  });

  it('routes editable USD opacity across the opaque boundary', async () => {
    const resources = await fixture(false, graph => {
      const surface = graph.nodes.get('surface')!;
      surface.category = 'UsdPreviewSurface';
      surface.inputs = [
        { name: 'opacity', type: 'float', source: { kind: 'value', type: 'float', value: '1' }, provenance: { namePath: '/surface/opacity' } },
        { name: 'opacityThreshold', type: 'float', source: { kind: 'value', type: 'float', value: '0' }, provenance: { namePath: '/surface/opacityThreshold' } },
      ];
    });
    const key = resources.instances[0]!.materialKey!;
    const original = resources.materials.get(key)!;
    const pass = (material: typeof original) => {
      const materials = new Map(resources.materials).set(key, material);
      return buildSceneFrame({ ...resources, materials }).draws[0]!.pass;
    };

    expect(pass(original)).toBe('opaque');
    const transparent = compileEditableMaterial(changeMaterialParameters(original, new Map([['surface:opacity', [0.5]]])));
    expect(pass(transparent)).toBe('transmission');
    const edited = compileEditableMaterial(changeMaterialParameters(transparent, new Map([['surface:opacity', [0.25]]])));
    expect(pass(edited)).toBe('transmission');
    expect(edited.sceneShader!.code).toBe(transparent.sceneShader!.code);
    const restored = compileEditableMaterial(changeMaterialParameters(edited, new Map([['surface:opacity', [1]]])));
    expect(pass(restored)).toBe('opaque');
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
