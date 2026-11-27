import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ScriptLibrary } from '../../src/materialx/script-api.ts';
import { scriptToSceneGraph } from '../../src/materialx/scene-graph-script.ts';
import {
  compileP25SceneGraphScript, compileSceneGraph, P25_SCENE_GRAPH, removeSceneGraphLink, setSceneGraphLink,
  sceneGraphViewNodes, setSceneGraphValue, type SceneGraph,
} from '../../src/materialx/scene-graph.ts';

const library = ScriptLibrary.fromXml([`<materialx version="1.39">
  <nodedef name="ND_standard_surface" node="standard_surface">
    <input name="base_color" type="color3" value="1, 1, 1" />
    <input name="specular_roughness" type="float" value="0.2" />
    <output name="out" type="surfaceshader" />
  </nodedef>
  <nodedef name="ND_displacement_float" node="displacement">
    <input name="displacement" type="float" value="0" />
    <output name="out" type="displacementshader" />
  </nodedef>
  <nodedef name="ND_surfacematerial" node="surfacematerial">
    <input name="surfaceshader" type="surfaceshader" />
    <input name="displacementshader" type="displacementshader" />
    <output name="out" type="material" />
  </nodedef>
</materialx>`]);

const example = readFileSync(fileURLToPath(new URL('../../examples/scripts/p25-scene-graph.js', import.meta.url)), 'utf8')
  .replace(/\r\n/g, '\n');

describe('typed scene graph prototype', () => {
  it('generates the example script with one shared surface and displacement for both objects', () => {
    const script = compileP25SceneGraphScript(P25_SCENE_GRAPH);

    expect(script).toBe(example);
    expect(sceneGraphViewNodes(P25_SCENE_GRAPH).map(node => node.title)).toEqual([
      'material : MaterialX',
      'sphereA : Sphere',
      'sphereB : Sphere',
      'scene : Scene',
      'camera : Camera',
      'render : Render',
      'save : Save',
    ]);
    expect(script.match(/\.material = material;/g)).toHaveLength(2);
    expect(script).toContain('material.surfaceshader = surface;');
    expect(script).toContain('material.displacementshader = displacement;');
    expect(script).toContain('render.backend = "pathtracing";');
    expect(script).toContain('await save("p25-scene-graph.png");');
  });

  it('imports the example without execution and round-trips the shared material and scene values', () => {
    const original = scriptToSceneGraph(example, library);
    const regenerated = `${original.materialScript}\n${compileSceneGraph(original.graph)}`;
    const withoutComments = (code: string) => code.replace(/\/\/[^\n]*/g, '').replace(/\s+/g, '');
    expect(withoutComments(regenerated)).toBe(withoutComments(example));

    const source = example.replaceAll('sphereA', 'left').replaceAll('sphereB', 'right')
      .replace(/\bmaterial\b/g, 'sharedMaterial').replaceAll('.sharedMaterial', '.material')
      .replace('radius: 0.6, resolution: 48', 'radius: 0.85, resolution: 32')
      .replace('[0.12, 0.42, 0.72]', '[0.8, 0.1, 0.3]');
    const imported = scriptToSceneGraph(source, library);
    const updated = setSceneGraphValue(imported.graph, 'left', 'translate', [-2, 0, 0]);
    const output = `${imported.materialScript}\n${compileSceneGraph(updated)}`;

    expect(output).toContain('surface.base_color = [0.8, 0.1, 0.3];');
    expect(output).toContain('const left = new Sphere({ radius: 0.85, resolution: 32 });');
    expect(output).toContain('left.translate = [-2, 0, 0];');
    expect(output).toContain('left.material = sharedMaterial;');
    expect(output).toContain('right.material = sharedMaterial;');
    expect(compileSceneGraph(scriptToSceneGraph(output, library).graph)).toBe(compileSceneGraph(updated));
  });

  it('rejects unsupported constructs without evaluating them or silently changing the scene', () => {
    expect(() => scriptToSceneGraph(example.replace('0.6, resolution', 'Math.random(), resolution'), library))
      .toThrow(/Ligne .*expression non convertible/);
    expect(() => scriptToSceneGraph(example.replace('await render(16);', 'for (;;) {}'), library))
      .toThrow(/Ligne .*structure JavaScript non convertible/);
    expect(() => scriptToSceneGraph(example.replace('sphereB.material = material;', 'sphereB.material = surface;'), library))
      .toThrow('doivent partager un même matériau');
    expect(() => scriptToSceneGraph(example.replace('await save(', 'await saveAov('), library))
      .toThrow(/appel saveAov non pris en charge/);
    expect(() => scriptToSceneGraph(example.replace('sphereA.translate = [-0.7, 0, 0];', 'sphereA.visible = false;'), library))
      .toThrow('visible');
  });

  it('accepts object-style declarations and inline primitive properties', () => {
    const source = example.replaceAll('const ', '')
      .replace(
        'sphereA = new Sphere({ radius: 0.6, resolution: 48 });\nsphereA.material = material;\nsphereA.translate = [-0.7, 0, 0];',
        'sphereA = new Sphere({ material: material, translate: [-0.7, 0, 0] });',
      );
    const imported = scriptToSceneGraph(source, library);
    const result = compileSceneGraph(imported.graph);
    expect(result).toContain('sphereA = new Sphere({ radius: 0.5, resolution: 48 });');
    expect(result).toContain('sphereA.material = material;');
    expect(result).toContain('sphereA.translate = [-0.7, 0, 0];');
  });

  it('rejects scene links that would silently omit an object', () => {
    const changed = setSceneGraphLink(P25_SCENE_GRAPH, {
      from: 'sphereA', output: 'object', to: 'scene', input: 'objectB',
    });
    expect(() => compileSceneGraph(changed)).toThrow('deux sphères distinctes');
  });

  it('keeps graph edits typed and compiles changed values and connections', () => {
    const changed = setSceneGraphValue(P25_SCENE_GRAPH, 'camera', 'fov', 55);
    expect(compileP25SceneGraphScript(changed)).toContain('fov: 55');

    const disconnected = removeSceneGraphLink(P25_SCENE_GRAPH, 'sphereB', 'material');
    expect(() => compileSceneGraph(disconnected)).toThrow('sphereB.material');
    expect(() => setSceneGraphValue(P25_SCENE_GRAPH, 'render', 'resolution', 63)).toThrow('numérique valide');
    expect(() => setSceneGraphValue(P25_SCENE_GRAPH, 'save', 'filename', 'scene.usda')).toThrow('valeur autorisée');
    expect(() => setSceneGraphLink(P25_SCENE_GRAPH, {
      from: 'scene', output: 'out', to: 'sphereA', input: 'material',
    })).toThrow('Connexion incompatible');
  });

  it('rejects incompatible and unresolved graph dependencies with explicit diagnostics', () => {
    const incompatible: SceneGraph = {
      nodes: P25_SCENE_GRAPH.nodes,
      links: [...P25_SCENE_GRAPH.links, { from: 'render', output: 'out', to: 'render', input: 'scene' }],
    };
    expect(() => compileSceneGraph(incompatible)).toThrow('Connexion incompatible ou orpheline');

    const unresolved: SceneGraph = {
      nodes: P25_SCENE_GRAPH.nodes,
      links: [...P25_SCENE_GRAPH.links, { from: 'missing', output: 'out', to: 'save', input: 'image' }],
    };
    expect(() => compileSceneGraph(unresolved)).toThrow('Connexion incompatible ou orpheline');
  });
});
