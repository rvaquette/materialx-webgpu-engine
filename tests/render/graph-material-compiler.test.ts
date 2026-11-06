// T057m1: createGraphMaterialCompiler lowers a MaterialX material through the
// full resolved node network (materialGraphRoots -> resolveGraph ->
// resolveSurface) and returns a complete MaterialBuild whose graph/surface feed
// the path tracer megakernel. These tests drive the compiler with fake Embind
// document/node views (no WASM), assert the upstream procedural nodes survive in
// build.graph, and confirm buildMaterialDispatch turns the build into a textured
// variant source. No WebGPU is exercised.

import { describe, it, expect } from 'vitest';
import { createGraphMaterialCompiler } from '../../src/render/graph-material-compiler.ts';
import type { MaterialBuild } from '../../src/render/scene-resources.ts';
import { buildMaterialDispatch } from '../../src/render/pathtracing/material-variant.ts';
import { evaluateVolumeMedium } from '../../src/render/pathtracing/volume-material.ts';
import { evaluateVolumeMaterial } from '../../src/render/raster/volume-material.ts';
import { evaluateVolumeIr, isSpatialVolumeIr } from '../../src/compiler/volume-ir.ts';
import type {
  MxInput,
  MxInterfaceElement,
  MxNode,
  MxNodeDef,
} from '../../src/materialx/graph.ts';
import type {
  MaterialCompileUnit,
  MtlxDocumentView,
  MtlxMaterialInput,
  MtlxMaterialNode,
} from '../../src/usd/materials.ts';

// --- Fakes mirroring the Embind surface (as in corpus-resolve) ---------------

interface FakeInputSpec {
  name: string;
  type: string;
  value?: string;
  connected?: MxNode;
  colorSpace?: string;
}

function fakeInput(spec: FakeInputSpec): MxInput {
  return {
    getName: () => spec.name,
    getNamePath: () => `/mat/${spec.name}`,
    getType: () => spec.type,
    getValueString: () => spec.value ?? '',
    hasValue: () => spec.value !== undefined,
    getInterfaceName: () => '',
    getConnectedNode: () => spec.connected ?? null,
    getOutputString: () => '',
    getColorSpace: () => spec.colorSpace ?? '',
    getUnit: () => '',
    getUnitType: () => '',
    validate: () => true,
    delete: () => {},
  } as unknown as MxInput;
}

function fakeImpl(kind: 'nodegraph' | 'implementation', name: string): MxInterfaceElement {
  return {
    getName: () => name,
    getNamePath: () => `/impl/${name}`,
    getCategory: () => kind,
    getTarget: () => (kind === 'implementation' ? 'genglsl' : ''),
    getFunction: () => (kind === 'implementation' ? `mx_${name}` : ''),
    getFile: () => '',
    validate: () => true,
    delete: () => {},
  } as unknown as MxInterfaceElement;
}

function fakeNodeDef(category: string, type: string, impl: MxInterfaceElement): MxNodeDef {
  return {
    getName: () => `ND_${category}`,
    getNamePath: () => `/nd/${category}`,
    getNodeString: () => category,
    getType: () => type,
    getNodeGroup: () => '',
    getVersionString: () => '',
    getImplementation: () => impl,
    getActiveSourceUri: () => 'brick.mtlx',
    validate: () => true,
    delete: () => {},
  } as unknown as MxNodeDef;
}

function fakeNode(category: string, type: string, impl: MxInterfaceElement, inputs: MxInput[]): MxNode {
  const def = fakeNodeDef(category, type, impl);
  return {
    getName: () => category,
    getNamePath: () => `/mat/${category}`,
    getType: () => type,
    getCategory: () => category,
    getInputs: () => inputs,
    getNodeDef: () => def,
    getActiveSourceUri: () => 'brick.mtlx',
    validate: () => true,
    delete: () => {},
  } as unknown as MxNode;
}

function materialInput(name: string, type: string, node: MxNode | null): MtlxMaterialInput {
  return { getName: () => name, getType: () => type, getConnectedNode: () => node };
}

/** A document whose material connects its surfaceshader terminal to `surface`. */
function fakeDocument(materialName: string, surface: MxNode | null, volume?: MxNode): MtlxDocumentView {
  const material = {
    getName: () => materialName,
    getNamePath: () => `/mat/${materialName}`,
    getInputs: () => [
      ...(surface ? [materialInput('surfaceshader', 'surfaceshader', surface)] : []),
      ...(volume ? [materialInput('volumeshader', 'volumeshader', volume)] : []),
    ],
    validate: () => true,
    delete: () => {},
  } as unknown as MtlxMaterialNode;
  return { getMaterialNode: (n: string) => (n === materialName ? material : null) };
}

/** standard_surface whose base_color is driven by an image on a texture file. */
function brickSurfaceNode(file: string): MxNode {
  const tex = fakeNode('image', 'color3', fakeImpl('implementation', 'image'), [
    fakeInput({ name: 'file', type: 'filename', value: file, colorSpace: 'srgb_texture' }),
  ]);
  return fakeNode('standard_surface', 'surfaceshader', fakeImpl('nodegraph', 'standard_surface'), [
    fakeInput({ name: 'base_color', type: 'color3', connected: tex }),
  ]);
}

const UNIT: MaterialCompileUnit = {
  assetPath: './brick.mtlx',
  referencedPrimPath: '/MaterialX/Materials/brick',
  materialName: 'brick',
  boundPrims: ['/World/floor'],
};

describe('createGraphMaterialCompiler (T057m1)', () => {
  function volumeNode(absorption = '0.08, 0.3, 0.6'): MxNode {
    const vdf = fakeNode('anisotropic_vdf', 'VDF', fakeImpl('implementation', 'anisotropic_vdf'), [
      fakeInput({ name: 'absorption', type: 'vector3', value: absorption }),
      fakeInput({ name: 'scattering', type: 'vector3', value: '0.4, 0.4, 0.4' }),
      fakeInput({ name: 'anisotropy', type: 'float', value: '0.5' }),
    ]);
    return fakeNode('volume', 'volumeshader', fakeImpl('implementation', 'volume'), [
      fakeInput({ name: 'vdf', type: 'VDF', connected: vdf }),
    ]);
  }

  it('compiles actual homogeneous coefficients rather than a neutral medium', () => {
    const doc = fakeDocument('brick', null, volumeNode());
    const build = createGraphMaterialCompiler({ documents: { documentFor: () => doc } }).compile(UNIT) as MaterialBuild;
    expect(build.volume).toBeDefined();
    expect(build.surface).toBeUndefined();
    const expected = { absorption: [0.08, 0.3, 0.6], scattering: [0.4, 0.4, 0.4], anisotropy: 0.5 };
    expect(evaluateVolumeMedium(build, {})).toEqual(expected);
    expect(evaluateVolumeMaterial(build, {})).toEqual(expected);
    expect(build.module.outputs[0]?.wgslType).toBe('MxVolumeMedium');
    expect(build.module.code).toContain('MxVolumeMedium(');
  });

  it('retains the surface and volume of a combined material', () => {
    const doc = fakeDocument('brick', brickSurfaceNode('brick.jpg'), volumeNode());
    const build = createGraphMaterialCompiler({ documents: { documentFor: () => doc } }).compile(UNIT) as MaterialBuild;
    expect(build.surface).toBeDefined();
    expect(build.layered).toBeDefined();
    expect(build.volume).toBeDefined();
    expect(build.ir.outputs.map(o => o.name)).toEqual(['surfaceshader', 'volumeshader']);
    expect(evaluateVolumeMedium(build, {})?.absorption).toEqual([0.08, 0.3, 0.6]);
  });

  it('lowers spatial coefficients and a connected uniform EDF together', async () => {
    const position = fakeNode('position','vector3',fakeImpl('implementation','position'),[
      fakeInput({ name:'space',type:'string',value:'world' }),
    ]);
    const vdf = fakeNode('anisotropic_vdf','VDF',fakeImpl('implementation','anisotropic_vdf'),[
      fakeInput({ name:'absorption',type:'vector3',value:'0, 0, 0' }),
      fakeInput({ name:'scattering',type:'vector3',connected:position }),
      fakeInput({ name:'anisotropy',type:'float',value:'0' }),
    ]);
    const edf = fakeNode('uniform_edf','EDF',fakeImpl('implementation','uniform_edf'),[
      fakeInput({ name:'color',type:'color3',value:'2, 3, 4' }),
    ]);
    const volume = fakeNode('volume','volumeshader',fakeImpl('implementation','volume'),[
      fakeInput({ name:'vdf',type:'VDF',connected:vdf }),
      fakeInput({ name:'edf',type:'EDF',connected:edf }),
    ]);
    const doc = fakeDocument('brick',null,volume);
    const build = (await createGraphMaterialCompiler({ documents:{ documentFor:() => doc } }).compile(UNIT))!;
    expect(build).toBeDefined();
    expect(isSpatialVolumeIr(build.ir)).toBe(true);
    expect(evaluateVolumeIr(build.ir,{ position:[0.2,0.4,0.8] })).toEqual({
      absorption:[0,0,0],scattering:[0.2,0.4,0.8],anisotropy:0,emission:[2,3,4],
    });
  });

  it('reports invalid coefficients instead of substituting vacuum', () => {
    const errors: string[] = [];
    const doc = fakeDocument('brick', null, volumeNode('-1, 0, 0'));
    const compiler = createGraphMaterialCompiler({
      documents: { documentFor: () => doc },
      sink: diagnostic => errors.push(diagnostic.message),
    });
    expect(compiler.compile(UNIT)).toBeUndefined();
    expect(errors.some(message => message.includes("Invalid volume coefficient 'absorption'"))).toBe(true);
  });

  it('rejects object-space volume inputs instead of treating them as world position', () => {
    const position = fakeNode('position','vector3',fakeImpl('implementation','position'),[
      fakeInput({ name:'space',type:'string',value:'object' }),
    ]);
    const vdf = fakeNode('anisotropic_vdf','VDF',fakeImpl('implementation','anisotropic_vdf'),[
      fakeInput({ name:'absorption',type:'vector3',connected:position }),
    ]);
    const volume = fakeNode('volume','volumeshader',fakeImpl('implementation','volume'),[
      fakeInput({ name:'vdf',type:'VDF',connected:vdf }),
    ]);
    const messages: string[] = [];
    const compiler = createGraphMaterialCompiler({ documents:{ documentFor:() => fakeDocument('brick',null,volume) },
      sink:d => messages.push(d.message) });
    expect(compiler.compile(UNIT)).toBeUndefined();
    expect(messages.join(' ')).toContain("space 'object'");
  });

  it('lowers the full procedural network into build.graph/build.surface', () => {
    const doc = fakeDocument('brick', brickSurfaceNode('brick_base_gray.jpg'));
    const compiler = createGraphMaterialCompiler({ documents: { documentFor: () => doc } });
    const build = compiler.compile(UNIT) as MaterialBuild;

    expect(build).toBeDefined();
    // The upstream image node survives the walk (not folded to a constant).
    expect(build.graph).toBeDefined();
    expect(build.graph!.nodes.get('/mat/standard_surface')).toBeDefined();
    expect(build.graph!.nodes.get('/mat/image')).toBeDefined();
    // Surface normalized to the standard_surface family.
    expect(build.surface).toBeDefined();
    expect(build.surface!.family).toBe('standard_surface');
    // Still a complete raster build: layered module + IR + WGSL.
    expect(build.layered?.entryPoint).toBe('mx_surface_layered');
    expect(build.ir).toBeDefined();
    expect(build.module.code.length).toBeGreaterThan(0);
  });

  it('feeds a textured megakernel variant source via buildMaterialDispatch', () => {
    const doc = fakeDocument('brick', brickSurfaceNode('brick_base_gray.jpg'));
    const compiler = createGraphMaterialCompiler({ documents: { documentFor: () => doc } });
    const build = compiler.compile(UNIT) as MaterialBuild;

    const dispatch = buildMaterialDispatch([{ materialIndex: 0, graph: build.graph!, surface: build.surface! }]);
    expect(dispatch.variants.map((v) => v.index)).toEqual([0]);
    expect(dispatch.dispatcherWgsl).toContain('case 0u: { return mx_surface_layered_0(vary); }');
    // The base_color image produced one group(1) texture + group(2) sampler.
    expect(dispatch.textures).toHaveLength(1);
    expect(dispatch.textures[0]!.group).toBe(1);
    expect(dispatch.samplers).toHaveLength(1);
    expect(dispatch.textureRegistry.images).toHaveLength(1);
    expect(dispatch.textureRegistry.images[0]).toBeDefined();
  });

  it('returns no build when the document is missing', () => {
    const messages: string[] = [];
    const compiler = createGraphMaterialCompiler({
      documents: { documentFor: () => undefined },
      sink: (d) => messages.push(d.message),
    });
    expect(compiler.compile(UNIT)).toBeUndefined();
    expect(messages.join('\n')).toContain('No MaterialX document');
  });

  it('returns no build when the surfaceshader terminal is unconnected', () => {
    const doc = fakeDocument('brick', null);
    const compiler = createGraphMaterialCompiler({ documents: { documentFor: () => doc } });
    expect(compiler.compile(UNIT)).toBeUndefined();
  });
});
