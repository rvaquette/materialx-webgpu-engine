import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { nodeReferenceEntries, nodeReferenceExample, nodeReferenceSignature } from '../../src/materialx/node-reference.ts';
import { runScript, ScriptLibrary, SCRIPT_LIBRARY_FILES } from '../../src/materialx/script-api.ts';

const LIBRARY = ScriptLibrary.fromXml([`<materialx version="1.39">
  <nodedef name="ND_add_float" node="add" doc="Adds two numbers.">
    <input name="in1" type="float" value="0" />
    <input name="in2" type="float" value="0" />
    <output name="out" type="float" />
  </nodedef>
  <nodedef name="ND_mystery_string" node="mystery">
    <output name="out" type="string" />
  </nodedef>
  <nodedef name="ND_standard_surface_surfaceshader" node="standard_surface">
    <input name="base" type="float" value="1" />
    <input name="base_color" type="color3" value="0.8, 0.8, 0.8" />
    <output name="out" type="surfaceshader" />
  </nodedef>
  <nodedef name="ND_surfacematerial" node="surfacematerial">
    <input name="surfaceshader" type="surfaceshader" value="" />
    <output name="out" type="material" />
  </nodedef>
</materialx>`]);

describe('MaterialX node reference examples', () => {
  it('creates documented signatures and connects compatible outputs to a preview sphere', async () => {
    const definition = LIBRARY.resolve('add');
    expect(nodeReferenceSignature(definition, LIBRARY)).toBe('new Add()');
    const example = nodeReferenceExample(definition, LIBRARY);
    expect(example.previewable).toBe(true);
    expect(example.code).toContain('sample.in1 = 0.2;');
    expect(example.code).toContain('previewSurface.base = sample.out;');
    expect(example.code).toContain('previewSphere.material = previewMaterial;');
    const run = await runScript(example.code, LIBRARY);
    expect(run.nodes.map(node => node.def.name)).toContain('ND_add_float');
  });

  it('keeps outputs without a surface connection executable and marks them as non-previewable', async () => {
    const example = nodeReferenceExample(LIBRARY.resolve('mystery'), LIBRARY);
    expect(example.previewable).toBe(false);
    expect(example.code).toContain('previewSphere.material = previewMaterial;');
    await expect(runScript(example.code, LIBRARY)).resolves.toMatchObject({
      nodes: expect.arrayContaining([expect.objectContaining({ def: LIBRARY.resolve('mystery') })]),
    });
  });

  it('does not claim backend status for categories absent from the coverage corpus', () => {
    const entry = nodeReferenceEntries(LIBRARY).find(candidate => candidate.definition.category === 'mystery');
    expect(entry?.support).toMatchObject({
      coverage: 'not-in-corpus',
      raster: 'not indexed',
      pathTracing: 'not indexed',
    });
  });

  it('uses the conformance matrix for known MaterialX categories', () => {
    const entry = nodeReferenceEntries(LIBRARY).find(candidate => candidate.definition.category === 'standard_surface');
    expect(entry?.support).toMatchObject({ coverage: 'direct', raster: 'supported', pathTracing: 'reference' });
  });
});

const LIBRARY_ROOT = process.env['MX_LIB_ROOT'] ?? 'D:/WebGL2/MaterialX/MaterialX-rva/libraries';

describe.skipIf(!existsSync(join(LIBRARY_ROOT, 'stdlib', 'stdlib_defs.mtlx')))('installed MaterialX node reference examples', () => {
  it('executes a generated example for every NodeDef', async () => {
    const library = ScriptLibrary.fromXml(SCRIPT_LIBRARY_FILES.map(file => readFileSync(join(LIBRARY_ROOT, file), 'utf8')));
    const entries = nodeReferenceEntries(library);
    for (const entry of entries) {
      const { code } = nodeReferenceExample(entry.definition, library);
      const graph = await runScript(code, library);
      expect(graph.nodes.some(node => node.def.name === entry.definition.name), entry.definition.name).toBe(true);
    }
  }, 30_000);
});
