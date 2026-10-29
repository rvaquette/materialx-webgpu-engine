import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, it, expect } from 'vitest';
import { MaterialXCore, type MaterialXModuleFactory } from '../../src/materialx/wasm.ts';
import { MaterialXLibraries, defaultLibrarySources } from '../../src/materialx/libraries.ts';
import { loadMaterialXDocuments } from '../../src/materialx/document-source.ts';
import { createGraphMaterialCompiler } from '../../src/render/graph-material-compiler.ts';
import type { Diagnostic } from '../../src/core/diagnostics.ts';

const coreRoot = process.env['MX_CORE_DIR']
  ?? 'D:\\WebGL2\\MaterialX\\MaterialX-rva\\javascript\\build\\installed\\JavaScript\\MaterialX';
const libraryRoot = process.env['MX_LIB_ROOT'] ?? 'D:\\WebGL2\\MaterialX\\MaterialX-rva\\libraries';
const playgroundRoot = process.env['MX_PLAYGROUND_ROOT']
  ?? 'D:\\WebGL2\\MaterialX\\OpenPBRShaderPlayground\\ShdrPlygrnd';
const coreFile = join(coreRoot, 'JsMaterialXCore.js');

describe.skipIf(!existsSync(coreFile) || !existsSync(libraryRoot))('installed MaterialX Core resolution', () => {
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
});
