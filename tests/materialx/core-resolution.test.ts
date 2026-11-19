import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, it, expect } from 'vitest';
import { MaterialXCore, type MaterialXModuleFactory } from '../../src/materialx/wasm.ts';
import { MaterialXLibraries, defaultLibrarySources } from '../../src/materialx/libraries.ts';
import { loadMaterialXDocuments } from '../../src/materialx/document-source.ts';
import { exportSurfaceGraph, makeMaterialExport } from '../../src/materialx/graph-export.ts';
import { createGraphMaterialCompiler } from '../../src/render/graph-material-compiler.ts';
import { activeParameterPreset, changeMaterialParameters, compileEditableMaterial, editableSceneMaterials, parameterPresetChanges, parameterPresetNames, visibleMaterialParameters } from '../../src/render/material-parameters.ts';
import { surfaceGraphToLayered } from '../../src/compiler/surface-lower.ts';
import { evaluateSurfaceToLayered } from '../../src/compiler/surface-eval.ts';
import { buildSceneResources } from '../../src/render/scene-resources.ts';
import { importUsdStage } from '../../src/usd/importer.ts';
import type { Diagnostic } from '../../src/core/diagnostics.ts';

const coreRoot = process.env['MX_CORE_DIR']
  ?? 'D:\\WebGL2\\MaterialX\\MaterialX-rva\\javascript\\build\\installed\\JavaScript\\MaterialX';
const libraryRoot = process.env['MX_LIB_ROOT'] ?? 'D:\\WebGL2\\MaterialX\\MaterialX-rva\\libraries';
const playgroundRoot = process.env['MX_PLAYGROUND_ROOT']
  ?? 'D:\\WebGL2\\MaterialX\\OpenPBRShaderPlayground\\ShdrPlygrnd';
const coreFile = join(coreRoot, 'JsMaterialXCore.js');

describe.skipIf(!existsSync(coreFile) || !existsSync(libraryRoot))('installed MaterialX Core resolution', () => {
  it('packages texture bytes once and round-trips relative image paths and shared UV transforms', async () => {
    const module = await import(/* @vite-ignore */ pathToFileURL(coreFile).href) as { default: MaterialXModuleFactory };
    const core = new MaterialXCore(await module.default());
    const libraries = new MaterialXLibraries(core);
    await libraries.load({ sources: defaultLibrarySources(libraryRoot), fetchText: async path => readFileSync(path, 'utf8') });
    const textureUrl = 'https://example.test/assets/checker.png';
    const documents = await loadMaterialXDocuments({ core, libraries, texts: new Map([['source', `<materialx version="1.39">
      <texcoord name="uv" type="vector2"><input name="index" type="integer" value="0" /></texcoord>
      <place2d name="placement" type="vector2">
        <input name="texcoord" type="vector2" nodename="uv" />
        <input name="pivot" type="vector2" value="0.5, 0.5" />
        <input name="scale" type="vector2" value="2, 3" />
        <input name="offset" type="vector2" value="0.1, 0.2" />
        <input name="operationorder" type="integer" value="1" />
      </place2d>
      <rotate2d name="rotation" type="vector2">
        <input name="in" type="vector2" nodename="placement" />
        <input name="amount" type="float" value="45" unit="degree" unittype="angle" />
      </rotate2d>
      <image name="albedo" type="color3">
        <input name="file" type="filename" value="${textureUrl}" colorspace="srgb_texture" />
        <input name="texcoord" type="vector2" nodename="rotation" />
      </image>
      <image name="roughness" type="float">
        <input name="file" type="filename" value="${textureUrl}" />
        <input name="texcoord" type="vector2" nodename="rotation" />
      </image>
      <standard_surface name="surface" type="surfaceshader">
        <input name="base_color" type="color3" nodename="albedo" />
        <input name="specular_roughness" type="float" nodename="roughness" />
      </standard_surface>
      <surfacematerial name="mat" type="material"><input name="surfaceshader" type="surfaceshader" nodename="surface" /></surfacematerial>
    </materialx>`]]) });
    try {
      const separate3 = documents.nodeDefinitions?.().find(definition => definition.name === 'ND_separate3_vector3');
      expect(separate3?.outputs).toEqual(expect.arrayContaining([
        { name: 'outx', type: 'float' }, { name: 'outy', type: 'float' }, { name: 'outz', type: 'float' },
      ]));
      const unit = { assetPath: 'source', materialName: 'mat', referencedPrimPath: '/MaterialX/Materials/mat', boundPrims: [] };
      const graph = (await createGraphMaterialCompiler({ documents }).compile(unit))!.graph!;
      const bytes = new Uint8Array(readFileSync(join('scenes', 'pathtracer', 'renderman', 'textures', 'checker.png')));
      const requests: string[] = [];
      const { filename, blob } = await makeMaterialExport(graph, 'mat', async url => {
        requests.push(String(url));
        return new Response(bytes, { headers: { 'Content-Type': 'image/png' } });
      });
      expect(filename).toBe('mat.zip');
      expect(requests).toEqual([textureUrl]);
      const { unzipSync, strFromU8 } = await import('three/addons/libs/fflate.module.js');
      const archive = unzipSync(new Uint8Array(await blob.arrayBuffer()));
      expect(Object.keys(archive).sort()).toEqual(['mat.mtlx', 'textures/checker.png']);
      expect(archive['textures/checker.png']).toEqual(bytes);
      const xml = strFromU8(archive['mat.mtlx']!);
      expect(xml).not.toContain(textureUrl);
      const imported = await loadMaterialXDocuments({
        core, texts: new Map([['source', xml]]),
        libraries: { importInto(doc) { libraries.importInto(doc); expect(core.validate(doc)).toBe(true); } },
      });
      try {
        const restored = (await createGraphMaterialCompiler({ documents: imported }).compile(unit))!.graph!;
        expect(restored.nodes.get('albedo')?.inputs[0]).toMatchObject({
          colorSpace: 'srgb_texture', source: { kind: 'value', value: 'textures/checker.png' },
        });
        expect(restored.nodes.get('roughness')?.inputs[0]?.source)
          .toMatchObject({ kind: 'value', value: 'textures/checker.png' });
        for (const id of ['albedo', 'roughness']) {
          expect(restored.nodes.get(id)?.inputs.find(input => input.name === 'texcoord')?.source)
            .toEqual({ kind: 'connection', nodeId: 'rotation' });
        }
        expect(restored.nodes.get('rotation')?.inputs).toEqual(expect.arrayContaining([
          expect.objectContaining({ name: 'in', source: { kind: 'connection', nodeId: 'placement' } }),
          expect.objectContaining({ name: 'amount', unit: 'degree', unitType: 'angle',
            source: { kind: 'value', type: 'float', value: '45' } }),
        ]));
        expect(restored.nodes.get('placement')?.inputs).toEqual(expect.arrayContaining([
          expect.objectContaining({ name: 'texcoord', source: { kind: 'connection', nodeId: 'uv' } }),
          ...[['pivot', 'vector2', '0.5, 0.5'], ['scale', 'vector2', '2, 3'], ['offset', 'vector2', '0.1, 0.2'],
            ['operationorder', 'integer', '1']].map(([name, type, value]) =>
            expect.objectContaining({ name, source: { kind: 'value', type, value } })),
        ]));
      } finally {
        imported.delete();
      }
      await expect(makeMaterialExport(graph, 'mat', async () => new Response(null, { status: 404 })))
        .rejects.toThrow('Impossible d’inclure textures/checker.png : HTTP 404');
    } finally {
      documents.delete();
      libraries.delete();
    }
  }, 30000);

  it('round-trips an edited surface with a shared Constant, procedural color and arithmetic in MaterialX Core', async () => {
    const module = await import(/* @vite-ignore */ pathToFileURL(coreFile).href) as { default: MaterialXModuleFactory };
    const core = new MaterialXCore(await module.default());
    const libraries = new MaterialXLibraries(core);
    await libraries.load({ sources: defaultLibrarySources(libraryRoot), fetchText: async path => readFileSync(path, 'utf8') });
    const documents = await loadMaterialXDocuments({ core, libraries, texts: new Map([['source', `<materialx version="1.39">
      <nodegraph name="NG"><constant name="rough" type="float">
        <input name="value" type="float" value="0.7" />
      </constant><multiply name="scale" type="float">
        <input name="in1" type="float" nodename="rough" />
        <input name="in2" type="float" nodename="rough" />
      </multiply><output name="roughness" type="float" nodename="scale" /></nodegraph>
      <subtract name="offset" type="float">
        <input name="in1" type="float" nodegraph="NG" output="roughness" />
        <input name="in2" type="float" value="0.5" />
      </subtract>
      <absval name="absolute" type="float"><input name="in" type="float" nodename="offset" /></absval>
      <min name="bounded" type="float">
        <input name="in1" type="float" nodename="absolute" />
        <input name="in2" type="float" value="0.2" />
      </min>
      <divide name="half" type="color3" nodedef="ND_divide_color3FA">
        <input name="in1" type="color3" value="0.25, 0.5, 0.75" />
        <input name="in2" type="float" value="2" />
      </divide>
      <max name="glow" type="color3">
        <input name="in1" type="color3" nodename="half" />
        <input name="in2" type="color3" value="0.25, 0.25, 0.25" />
      </max>
      <texcoord name="uv" type="vector2"><input name="index" type="integer" value="0" /></texcoord>
      <checkerboard name="checks" type="color3">
        <input name="texcoord" type="vector2" nodename="uv" />
        <input name="uvtiling" type="vector2" value="4, 8" />
      </checkerboard>
      <standard_surface name="surface" type="surfaceshader">
        <input name="base_color" type="color3" nodename="checks" />
        <input name="specular_color" type="color3" value="0.2, 0.3, 0.4" />
        <input name="specular_roughness" type="float" nodename="bounded" />
        <input name="emission" type="float" value="1" />
        <input name="emission_color" type="color3" nodename="glow" />
      </standard_surface>
      <surfacematerial name="mat" type="material"><input name="surfaceshader" type="surfaceshader" nodename="surface" /></surfacematerial>
    </materialx>`]]) });
    try {
      const unit = { assetPath: 'source', materialName: 'mat', referencedPrimPath: '/MaterialX/Materials/mat', boundPrims: [] };
      const build = await createGraphMaterialCompiler({ documents }).compile(unit);
      const graph = build!.graph!;
      expect(graph.nodes.get('surface')?.nodeDef?.inputs?.find(input => input.name === 'specular_roughness'))
        .toMatchObject({ uiMin: 0, uiMax: 1 });
      expect(graph.nodes.get('surface')?.nodeDef?.inputs?.find(input => input.name === 'base_color'))
        .toMatchObject({ uiMinComponents: [0, 0, 0], uiMaxComponents: [1, 1, 1] });
      const rough = graph.nodes.get('NG/rough')!;
      rough.inputs[0]!.source = { kind: 'value', type: 'float', value: '0.42' };
      const { filename, xml } = exportSurfaceGraph(graph, 'NG rough');
      expect(filename).toBe('NG_rough.mtlx');
      let valid = false;
      const imported = await loadMaterialXDocuments({
        core, texts: new Map([['source', xml]]),
        libraries: { importInto(doc) { libraries.importInto(doc); valid = core.validate(doc); } },
      });
      try {
        expect(valid).toBe(true);
        const roundTrip = await createGraphMaterialCompiler({ documents: imported }).compile({
          ...unit, materialName: 'NG_rough', referencedPrimPath: '/MaterialX/Materials/NG_rough',
        });
        expect(roundTrip?.surface?.inputs.get('specular_roughness')?.source)
          .toEqual({ kind: 'connection', nodeId: 'bounded' });
        for (const [node, input, upstream] of [
          ['bounded', 'in1', 'absolute'], ['absolute', 'in', 'offset'], ['offset', 'in1', 'NG_scale'], ['glow', 'in1', 'half'],
        ]) {
          expect(roundTrip?.graph?.nodes.get(node!)?.inputs.find(binding => binding.name === input)?.source)
            .toEqual({ kind: 'connection', nodeId: upstream });
        }
        expect(roundTrip?.graph?.nodes.get('half')?.nodeDef?.name).toBe('ND_divide_color3FA');
        expect(evaluateSurfaceToLayered(roundTrip!.graph!, roundTrip!.surface!, {}).emission)
          .toEqual([0.25, 0.25, 0.375]);
        expect(roundTrip?.graph?.nodes.get('NG_scale')?.inputs.map(input => input.source))
          .toEqual(Array(2).fill({ kind: 'connection', nodeId: 'NG_rough_2' }));
        expect(roundTrip?.graph?.nodes.get('NG_rough_2')?.inputs[0]?.source)
          .toEqual({ kind: 'value', type: 'float', value: '0.42' });
        expect(roundTrip?.surface?.inputs.get('base_color')?.source).toEqual({ kind: 'connection', nodeId: 'checks' });
        expect(roundTrip?.graph?.nodes.get('checks')?.inputs.find(input => input.name === 'texcoord')?.source)
          .toEqual({ kind: 'connection', nodeId: 'uv' });
        expect(roundTrip?.surface?.inputs.get('specular_color')?.source).toEqual({ kind: 'value', value: [0.2, 0.3, 0.4] });
      } finally {
        imported.delete();
      }
      expect(() => exportSurfaceGraph({ ...graph, nodes: new Map(graph.nodes).set(rough.id, { ...rough, category: 'image' }) }, 'mat'))
        .toThrow('Nœud non pris en charge');
      const scale = graph.nodes.get('NG/scale')!;
      const customDefinitionGraph = { ...graph, nodes: new Map(graph.nodes).set(scale.id, {
        ...scale, nodeDef: { ...scale.nodeDef!, name: 'ND_custom_multiply_float' },
      }) };
      expect(exportSurfaceGraph(customDefinitionGraph, 'mat').xml)
        .toContain('nodedef="ND_custom_multiply_float"');
    } finally {
      documents.delete();
      libraries.delete();
    }
  }, 30000);

  it('evaluates the chrome cutout on the front without cutting the back', async () => {
    const module = await import(/* @vite-ignore */ pathToFileURL(coreFile).href) as { default: MaterialXModuleFactory };
    const core = new MaterialXCore(await module.default());
    const libraries = new MaterialXLibraries(core);
    await libraries.load({ sources: defaultLibrarySources(libraryRoot), fetchText: async path => readFileSync(path, 'utf8') });
    const diagnostics: Diagnostic[] = [];
    const text = readFileSync(join('scenes', 'lama', 'surface', 'lama_surface_chrome_cutout.mtlx'), 'utf8');
    const documents = await loadMaterialXDocuments({ core, libraries, texts: new Map([['chrome', text]]),
      sink: d => diagnostics.push(d) });
    try {
      const build = await createGraphMaterialCompiler({ documents, sink: d => diagnostics.push(d) }).compile({
        assetPath: 'chrome', materialName: 'chrome_cutout',
        referencedPrimPath: '/MaterialX/Materials/chrome_cutout', boundPrims: [],
      });
      expect(build?.graph).toBeDefined();
      expect(build?.surface).toBeDefined();
      expect(build?.surface?.backNodeId).toBe('interior');
      expect(build?.surface?.inputs.get('opacity')?.source).toEqual({ kind: 'connection', nodeId: 'front_cutout' });
      const opacity = (position: number[]) => evaluateSurfaceToLayered(build!.graph!, build!.surface!, { position }).opacity;
      expect(opacity([0.05, 0.0883, 0])).toBe(0);
      expect(opacity([0.05, 0.0883, 0.05])).toBe(1);
      expect(opacity([0.05, 0.0616, 0.047])).toBe(0);
      expect(opacity([0.05, 0.0616, -0.047])).toBe(0);
      expect(opacity([-0.05, 0.0506, 0])).toBe(1);
      expect(diagnostics.filter(d => d.level === 'error')).toEqual([]);
    } finally {
      documents.delete();
      libraries.delete();
    }
  }, 30000);

  it('compiles a LamaSurface with front, back and a connected presence pattern', async () => {
    const module = await import(/* @vite-ignore */ pathToFileURL(coreFile).href) as { default: MaterialXModuleFactory };
    const core = new MaterialXCore(await module.default());
    const libraries = new MaterialXLibraries(core);
    await libraries.load({ sources: defaultLibrarySources(libraryRoot), fetchText: async path => readFileSync(path, 'utf8') });
    const diagnostics: Diagnostic[] = [];
    const documents = await loadMaterialXDocuments({ core, libraries, texts: new Map([['lama', `<materialx version="1.39">
      <LamaDiffuse name="front" type="BSDF"><input name="color" type="color3" value="0.8, 0.1, 0.1" /></LamaDiffuse>
      <LamaSheen name="back" type="BSDF"><input name="color" type="color3" value="0.1, 0.2, 0.8" /></LamaSheen>
      <image name="mask" type="float"><input name="file" type="filename" value="mask.png" /></image>
      <LamaSurface name="mat" type="material">
        <input name="materialFront" type="BSDF" nodename="front" />
        <input name="materialBack" type="BSDF" nodename="back" />
        <input name="presence" type="float" nodename="mask" />
      </LamaSurface>
    </materialx>`]]), sink: d => diagnostics.push(d) });
    try {
      const build = await createGraphMaterialCompiler({ documents, sink: d => diagnostics.push(d) }).compile({
        assetPath: 'lama', materialName: 'mat', referencedPrimPath: '/MaterialX/Materials/mat', boundPrims: [],
      });
      expect(build?.graph?.nodes.has('mask')).toBe(true);
      expect(build?.surface?.backNodeId).toBe('back');
      expect(build?.layered?.textures).toHaveLength(1);
      expect(build?.layered?.features?.opaque).toBe(false);
      expect(build?.layered?.code).toContain('vary.frontFacing');
      expect(diagnostics.filter(d => d.level === 'error')).toEqual([]);
    } finally {
      documents.delete();
      libraries.delete();
    }
  }, 30000);

  it('compiles every generated LamaSurface example with the installed libraries', async () => {
    const module = await import(/* @vite-ignore */ pathToFileURL(coreFile).href) as { default: MaterialXModuleFactory };
    const core = new MaterialXCore(await module.default());
    const libraries = new MaterialXLibraries(core);
    await libraries.load({ sources: defaultLibrarySources(libraryRoot), fetchText: async path => readFileSync(path, 'utf8') });
    const diagnostics: Diagnostic[] = [];
    const directory = join('scenes', 'lama', 'surface');
    const coverage = JSON.parse(readFileSync(join(directory, 'coverage.json'), 'utf8')) as { parameter: string; status: string }[];
    const documents = await loadMaterialXDocuments({ core, libraries,
      texts: new Map([['surface', readFileSync(join(directory, 'materials.mtlx'), 'utf8')]]),
      sink: d => diagnostics.push(d) });
    try {
      const compiler = createGraphMaterialCompiler({ documents, sink: d => diagnostics.push(d) });
      for (const example of coverage) {
        diagnostics.length = 0;
        const materialName = `surface_${example.parameter}`;
        const build = await compiler.compile({ assetPath: 'surface', materialName,
          referencedPrimPath: `/MaterialX/Materials/${materialName}`, boundPrims: [] });
        expect(build?.layered, materialName).toBeDefined();
        expect(diagnostics.filter(d => d.level === 'error'), materialName).toEqual([]);
        if (example.parameter === 'presence') {
          expect(build?.graph?.nodes.has('checker')).toBe(true);
          expect(build?.layered?.code).toContain('floor(');
          expect(build?.layered?.features?.opaque).toBe(false);
        }
        if (example.parameter === 'material_back') expect(build?.surface?.backNodeId).toBe('back');
      }
    } finally {
      documents.delete();
      libraries.delete();
    }
  }, 30000);

  it('compiles the two-sided procedural camouflage and its cutout network', async () => {
    const module = await import(/* @vite-ignore */ pathToFileURL(coreFile).href) as { default: MaterialXModuleFactory };
    const core = new MaterialXCore(await module.default());
    const libraries = new MaterialXLibraries(core);
    await libraries.load({ sources: defaultLibrarySources(libraryRoot), fetchText: async path => readFileSync(path, 'utf8') });
    const diagnostics: Diagnostic[] = [];
    const text = readFileSync(join('scenes', 'lama', 'surface', 'lama_surface_camouflage.mtlx'), 'utf8');
    const documents = await loadMaterialXDocuments({ core, libraries, texts: new Map([['camouflage', text]]),
      sink: d => diagnostics.push(d) });
    try {
      const build = await createGraphMaterialCompiler({ documents, sink: d => diagnostics.push(d) }).compile({
        assetPath: 'camouflage', materialName: 'camouflage',
        referencedPrimPath: '/MaterialX/Materials/camouflage', boundPrims: [],
      });
      expect(build?.surface?.backNodeId).toBe('camouflage_diffuse');
      expect(build?.surface?.inputs.get('opacity')?.source).toEqual({ kind: 'connection', nodeId: 'holes' });
      expect(build?.graph?.nodes.has('hole_noise')).toBe(true);
      expect(build?.graph?.nodes.has('hole_projection')).toBe(true);
      expect(build?.graph?.nodes.has('cells')).toBe(true);
      expect(build?.layered?.features?.opaque).toBe(false);
      expect(build?.layered?.code).toContain('mx_worley(');
      expect(diagnostics.filter(d => d.level === 'error')).toEqual([]);
    } finally {
      documents.delete();
      libraries.delete();
    }
  }, 30000);

  it.each(['conductor', 'dielectric', 'generalized_schlick'])('resolves all %s parameter scenes and explicitly diagnoses unsupported controls', async (family) => {
    const module = await import(/* @vite-ignore */ pathToFileURL(coreFile).href) as { default: MaterialXModuleFactory };
    const core = new MaterialXCore(await module.default());
    const libraries = new MaterialXLibraries(core);
    await libraries.load({ sources: defaultLibrarySources(libraryRoot), fetchText: async path => readFileSync(path, 'utf8') });
    const diagnostics: Diagnostic[] = [];
    const documents = await loadMaterialXDocuments({ core, libraries,
      texts: new Map([[family, readFileSync(`scenes/lama/${family}/materials.mtlx`, 'utf8')]]),
      sink: diagnostic => diagnostics.push(diagnostic),
    });
    try {
      const coverage = JSON.parse(readFileSync(`scenes/lama/${family}/coverage.json`, 'utf8')) as { parameter: string; status: string }[];
      const compiler = createGraphMaterialCompiler({ documents, sink: diagnostic => diagnostics.push(diagnostic) });
      for (const example of coverage) {
        diagnostics.length = 0;
        const name = `${family}_${example.parameter}`;
        const build = await compiler.compile({ assetPath: family, materialName: name,
          referencedPrimPath: `/MaterialX/Materials/${name}`, boundPrims: [] });
        expect(build?.layered, example.parameter).toBeDefined();
        expect(diagnostics.filter(diagnostic => diagnostic.level === 'error'), example.parameter).toEqual([]);
        if (family === 'dielectric' && example.parameter === 'transmission_tint') {
          const scene = await importUsdStage('test.usda', { reader: { read: async () => `#usda 1.0
def Material "Mat" (prepend references = @materials.mtlx@</MaterialX/Materials/dielectric_transmission_tint>) {}
def Mesh "Teapot" { rel material:binding = </Mat> }` } });
          const resources = editableSceneMaterials(await buildSceneResources(scene, {
            meshSource: { meshFor: () => ({ points: [0, 0, 0, 1, 0, 0, 0, 1, 0], faceVertexCounts: [3], faceVertexIndices: [0, 1, 2] }) },
            materialCompiler: { compile: () => build },
          }));
          const material = [...resources.materials.values()][0]!;
          const editable = visibleMaterialParameters(material);
          expect(editable.map(parameter => parameter.input).sort()).toEqual(['reflectionTint', 'transmissionTint']);
          expect(editable.every(parameter => parameter.type === 'color3' && parameter.update === 'uniform')).toBe(true);
          expect(material.surfaceModule!.uniforms.map(field => field.name).sort()).toEqual(editable.map(parameter => parameter.uniform).sort());
        }
        if (example.status === 'unsupported') {
          expect(diagnostics.some(diagnostic => diagnostic.message.includes('is not implemented')), example.parameter).toBe(true);
        } else {
          expect(diagnostics, example.parameter).toEqual([]);
        }
      }
    } finally {
      documents.delete();
      libraries.delete();
    }
  }, 30000);

  it('resolves the corpus-local SimpleHair NodeDef to a native Chiang surface', async () => {
    const module = await import(/* @vite-ignore */ pathToFileURL(coreFile).href) as { default: MaterialXModuleFactory };
    const core = new MaterialXCore(await module.default());
    const libraries = new MaterialXLibraries(core);
    await libraries.load({
      sources: defaultLibrarySources(libraryRoot),
      fetchText: async path => readFileSync(path, 'utf8'),
    });
    const diagnostics: Diagnostic[] = [];
    const text = readFileSync(join('scenes', 'mtlx-library', 'Examples', 'SimpleHair', 'simple_hair_default.mtlx'), 'utf8');
    const documents = await loadMaterialXDocuments({
      core, libraries, texts: new Map([['hair', text]]), sink: d => diagnostics.push(d),
    });
    try {
      const build = await createGraphMaterialCompiler({ documents, sink: d => diagnostics.push(d) }).compile({
        assetPath: 'hair', materialName: 'simple_hair_default',
        referencedPrimPath: '/MaterialX/Materials/simple_hair_default', boundPrims: [],
      });
      expect(build?.surface?.family).toBe('simple_hair');
      expect(build?.layered?.features?.lobeKinds).toEqual([9]);
      expect(diagnostics).toEqual([]);
    } finally {
      documents.delete();
      libraries.delete();
    }
  }, 30000);

  it('resolves colliding content names and exporter image signatures without hiding invalid inputs', async () => {
    const module = await import(/* @vite-ignore */ pathToFileURL(coreFile).href) as { default: MaterialXModuleFactory };
    const core = new MaterialXCore(await module.default());
    const libraries = new MaterialXLibraries(core);
    const diagnostics: Diagnostic[] = [];
    await libraries.load({
      sources: defaultLibrarySources(libraryRoot),
      fetchText: async path => readFileSync(path, 'utf8'),
    });
    const xml = `<materialx version="1.39">
      <geompropvalue name="st" type="vector2"><input name="geomprop" type="string" value="st" /></geompropvalue>
      <image name="tex" type="color3">
        <input name="file" type="filename" value="color.png" />
        <input name="texcoord" type="vector2" nodename="st" />
        <input name="uvtiling" type="vector2" value="0.25, 1" />
      </image>
      <colorcorrect name="ND_colorcorrect_color3" type="color3">
        <input name="in" type="color3" nodename="tex" />
        <input name="gamma" type="float" value="1.5" />
      </colorcorrect>
      <standard_surface name="surface" type="surfaceshader">
        <input name="base_color" type="color3" nodename="ND_colorcorrect_color3" />
      </standard_surface>
      <surfacematerial name="material" type="material">
        <input name="surfaceshader" type="surfaceshader" nodename="surface" />
      </surfacematerial>
    </materialx>`;
    const documents = await loadMaterialXDocuments({
      core, libraries, texts: new Map([
        ['valid', xml],
        ['invalid', xml.replace('name="uvtiling"', 'name="unsupported_input"')],
      ]),
    });
    try {
      const compiler = createGraphMaterialCompiler({ documents, sink: d => diagnostics.push(d) });
      const build = await compiler.compile({
        assetPath: 'valid', materialName: 'material', referencedPrimPath: '/MaterialX/Materials/material', boundPrims: [],
      });
      expect(diagnostics).toEqual([]);
      expect(build).toBeDefined();
      const nodes = [...build!.graph!.nodes.values()];
      expect(nodes.map(node => [node.category, node.nodeDef?.name])).toContainEqual(['image', 'ND_engine_image_color3']);
      expect(nodes.find(node => node.category === 'colorcorrect')?.nodeDef?.inputs)
        .toContainEqual({ name: 'saturation', type: 'float', value: '1' });
      await compiler.compile({
        assetPath: 'invalid', materialName: 'material', referencedPrimPath: '/MaterialX/Materials/material', boundPrims: [],
      });
      expect(diagnostics.some(d => d.message.includes("Unresolved NodeDef for node 'image'"))).toBe(true);
    } finally {
      documents.delete();
      libraries.delete();
    }
  }, 30000);

  it('reads namespaced engine extension attributes from MaterialX inputs', async () => {
    const module = await import(/* @vite-ignore */ pathToFileURL(coreFile).href) as { default: MaterialXModuleFactory };
    const core = new MaterialXCore(await module.default());
    const libraries = new MaterialXLibraries(core);
    await libraries.load({
      sources: defaultLibrarySources(libraryRoot),
      fetchText: async path => readFileSync(path, 'utf8'),
    });
    const diagnostics: Diagnostic[] = [];
    const assetPath = join('scenes', 'lama', 'layer', 'lama_layer_gold_modes.mtlx');
    const text = readFileSync(assetPath, 'utf8');
    const documents = await loadMaterialXDocuments({
      core, libraries, texts: new Map([[assetPath, text]]), sink: d => diagnostics.push(d),
    });
    try {
      const compiler = createGraphMaterialCompiler({ documents, sink: d => diagnostics.push(d) });
      for (const [materialName, mode] of [
        ['gold_fresnel_blend', 'fresnel_blend'], ['gold_smooth_coating', 'smooth_coating'],
        ['gold_rough_coating', 'rough_coating'], ['gold_auto', 'auto'],
      ] as const) {
        const build = await compiler.compile({
          assetPath, materialName, referencedPrimPath: `/MaterialX/Materials/${materialName}`, boundPrims: [],
        });
        const nodes = [...(build?.graph?.nodes.values() ?? [])];
        const dielectric = nodes.find(node => node.category === 'LamaDielectric');
        expect(dielectric?.inputs.find(input => input.name === 'IOR')).toMatchObject({ editable: true, min: [1], max: [3] });
        const layer = nodes.find(node => node.category === 'LamaLayer');
        expect(layer?.lamaLayer).toEqual({ mode, topThickness: 0 });
        expect(layer?.inputs.find(input => input.name === 'topMix')).toMatchObject({ editable: true, min: [0], max: [1] });
      }
      expect(diagnostics).toEqual([]);
    } finally {
      documents.delete();
      libraries.delete();
    }
  }, 30000);

  it('exposes the LamaSSS RenderMan Color/Radius presets as one editor selection', async () => {
    const module = await import(/* @vite-ignore */ pathToFileURL(coreFile).href) as { default: MaterialXModuleFactory };
    const core = new MaterialXCore(await module.default());
    const libraries = new MaterialXLibraries(core);
    await libraries.load({ sources: defaultLibrarySources(libraryRoot), fetchText: async path => readFileSync(path, 'utf8') });
    const diagnostics: Diagnostic[] = [];
    const assetPath = join('scenes', 'lama', 'sss', 'lama_sss_color_radius.mtlx');
    const documents = await loadMaterialXDocuments({
      core, libraries, texts: new Map([[assetPath, readFileSync(assetPath, 'utf8')]]), sink: d => diagnostics.push(d),
    });
    try {
      const build = await createGraphMaterialCompiler({ documents, sink: d => diagnostics.push(d) }).compile({
        assetPath, materialName: 'sss_material', referencedPrimPath: '/MaterialX/Materials/sss_material', boundPrims: [],
      });
      expect(diagnostics).toEqual([]);
      const scene = await importUsdStage('test.usda', { reader: { read: async () => `#usda 1.0
def Material "Mat" (prepend references = @sss.mtlx@</MaterialX/Materials/sss_material>) {}
def Mesh "Teapot" { rel material:binding = </Mat> }` } });
      const resources = editableSceneMaterials(await buildSceneResources(scene, {
        meshSource: { meshFor: () => ({ points: [0, 0, 0, 1, 0, 0, 0, 1, 0], faceVertexCounts: [3], faceVertexIndices: [0, 1, 2] }) },
        materialCompiler: { compile: () => build },
      }));
      const material = [...resources.materials.values()][0]!;
      const editable = visibleMaterialParameters(material);
      expect(editable.map(parameter => [parameter.input, parameter.update])).toEqual([['color', 'uniform'], ['sssRadius', 'uniform']]);
      const names = parameterPresetNames(editable);
      expect(names).toEqual(['apple', 'chicken1', 'chicken2', 'cream', 'ketchup', 'marble', 'potato',
        'skim milk', 'skin1', 'skin2', 'whole milk']);
      expect(activeParameterPreset(editable, parameter => parameter.value)).toBe('apple');
      const changes = parameterPresetChanges(editable, 'skim milk');
      expect([...changes.values()]).toEqual([[0.815, 0.813, 0.682], [18.42, 10.44, 3.5]]);
      const updated = changeMaterialParameters(material, changes);
      expect(activeParameterPreset(visibleMaterialParameters(updated), parameter => parameter.value)).toBe('skim milk');
      expect(compileEditableMaterial(updated).sceneShader!.code).toBe(material.sceneShader!.code);
      const lobe = surfaceGraphToLayered(updated.resolvedSurface!, updated.surfaceGraph!).lobes[0]!;
      expect(lobe).toMatchObject({ kind: 'subsurface', subsurfaceTransport: 0, color: [0.815, 0.813, 0.682] });
      [18.42, 10.44, 3.5].forEach((millimeters, i) => expect(lobe.subsurfaceRadius![i]).toBeCloseTo(millimeters * 0.001, 8));
    } finally {
      documents.delete();
      libraries.delete();
    }
  }, 30000);

  it.skipIf(!existsSync(join(playgroundRoot, 'materials')))('compiles all playground documents without material warnings', async () => {
    const module = await import(/* @vite-ignore */ pathToFileURL(coreFile).href) as { default: MaterialXModuleFactory };
    const core = new MaterialXCore(await module.default());
    const libraries = new MaterialXLibraries(core);
    await libraries.load({
      sources: defaultLibrarySources(libraryRoot),
      fetchText: async path => readFileSync(path, 'utf8'),
    });
    const materialRoot = join(playgroundRoot, 'materials');
    const files = readdirSync(materialRoot).filter(file => file.endsWith('.mtlx'));
    const diagnostics: Diagnostic[] = [];
    const documents = await loadMaterialXDocuments({
      core, libraries, texts: new Map(files.map(file => [file, readFileSync(join(materialRoot, file), 'utf8')])),
      sink: d => diagnostics.push(d),
    });
    try {
      const compiler = createGraphMaterialCompiler({ documents, sink: d => diagnostics.push(d) });
      for (const file of files) {
        const name = /<surfacematerial\s+name="([^"]+)"/.exec(readFileSync(join(materialRoot, file), 'utf8'))?.[1];
        expect(name, file).toBeDefined();
        const build = await compiler.compile({
          assetPath: file, materialName: name!, referencedPrimPath: `/MaterialX/Materials/${name}`, boundPrims: [],
        });
        expect(build, file).toBeDefined();
      }
      expect(files.length).toBeGreaterThan(0);
      expect(diagnostics).toEqual([]);
    } finally {
      documents.delete();
      libraries.delete();
    }
  }, 30000);

  it('compiles every MaterialX binding in the converted Pathtracer USDA corpus', async () => {
    const module = await import(/* @vite-ignore */ pathToFileURL(coreFile).href) as { default: MaterialXModuleFactory };
    const core = new MaterialXCore(await module.default());
    const libraries = new MaterialXLibraries(core);
    await libraries.load({
      sources: defaultLibrarySources(libraryRoot),
      fetchText: async path => readFileSync(path, 'utf8'),
    });
    const root = join('scenes', 'pathtracer');
    const texts = new Map<string, string>();
    const bindings: { assetPath: string; materialName: string }[] = [];
    const files = readdirSync(root).filter(file => file.endsWith('.usda'));
    for (const file of files) {
      const stage = readFileSync(join(root, file), 'utf8');
      for (const match of stage.matchAll(/@([^@]+\.mtlx)@<\/MaterialX\/Materials\/([^>]+)>/g)) {
        const assetPath = join(root, match[1]!);
        texts.set(assetPath, readFileSync(assetPath, 'utf8'));
        bindings.push({ assetPath, materialName: match[2]! });
      }
    }
    const diagnostics: Diagnostic[] = [];
    const documents = await loadMaterialXDocuments({ core, libraries, texts, sink: d => diagnostics.push(d) });
    try {
      const compiler = createGraphMaterialCompiler({ documents, sink: d => diagnostics.push(d) });
      for (const binding of bindings) {
        const build = await compiler.compile({
          ...binding, referencedPrimPath: `/MaterialX/Materials/${binding.materialName}`, boundPrims: [],
        });
        // Native volume materials compile to a volume closure instead of a layered surface.
        expect(build?.surface ?? build?.volume, `${binding.assetPath}/${binding.materialName}`).toBeDefined();
        expect(build?.layered ?? build?.volume, `${binding.assetPath}/${binding.materialName}`).toBeDefined();
      }
      expect(files).toHaveLength(50);
      expect(bindings.length).toBeGreaterThanOrEqual(294);
      expect(diagnostics).toEqual([]);
    } finally {
      documents.delete();
      libraries.delete();
    }
  }, 120000);
});
