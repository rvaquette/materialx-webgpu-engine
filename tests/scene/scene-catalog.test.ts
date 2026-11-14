import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compiledSceneCatalog, SCENE_CATALOG, SOURCE_SCENE_CATALOG } from '../../src/scene/scene-catalog.ts';
import { compiledMaterialCatalog } from '../../src/scene/material-catalog.ts';
import {
  compiledMaterialDirectory, compiledSceneDirectory, compiledSharedBuffersDirectory, compiledWrapperLayer, compiledWrapperPath,
} from '../../src/scene/compiled-paths.ts';
import { parseCompiledLayerReferences } from '../../src/scene/compiled-scene.ts';

describe('scene selector catalog', () => {
  it('includes every Lama USDA across all subdirectories exactly once', () => {
    const paths = readdirSync('scenes\\lama', { recursive: true })
      .map(path => path.replace(/\\/g, '/'))
      .filter(path => path.endsWith('.usda'))
      .map(path => `./scenes/lama/${path}`)
      .sort();
    const entries = SOURCE_SCENE_CATALOG.filter(scene => scene.entry.startsWith('./scenes/lama/'));
    expect(paths.length).toBeGreaterThan(0);
    expect(entries.map(scene => scene.entry).sort()).toEqual(paths);
  });

  it('includes every dielectric parameter scene and identifies unsupported controls', () => {
    const names = readdirSync('scenes/lama/dielectric').filter(name => name.endsWith('.usda')).sort();
    const entries = SOURCE_SCENE_CATALOG.filter(scene => scene.entry.startsWith('./scenes/lama/dielectric/'));
    expect(entries.map(scene => scene.entry).sort()).toEqual(names.map(name => `./scenes/lama/dielectric/${name}`));
    expect(entries).toHaveLength(34);
    expect(entries.filter(scene => scene.label.includes('NOT SUPPORTED'))).toHaveLength(10);
  });

  it('includes every generalized-Schlick parameter scene and identifies unsupported controls', () => {
    const names = readdirSync('scenes/lama/generalized_schlick').filter(name => name.endsWith('.usda')).sort();
    const entries = SOURCE_SCENE_CATALOG.filter(scene => scene.entry.startsWith('./scenes/lama/generalized_schlick/'));
    expect(entries.map(scene => scene.entry).sort()).toEqual(names.map(name => `./scenes/lama/generalized_schlick/${name}`));
    expect(entries).toHaveLength(34);
    expect(entries.every(scene => scene.label.startsWith('LamaGeneralizedSchlick - '))).toBe(true);
    expect(entries.filter(scene => scene.label.includes('NOT SUPPORTED'))).toHaveLength(10);
  });

  it('includes every current pathtracer USDA exactly once, in filename order', () => {
    const names = readdirSync('scenes\\pathtracer')
      .filter(name => name.endsWith('.usda')).sort();
    const entries = SOURCE_SCENE_CATALOG.filter(scene => scene.entry.startsWith('./scenes/pathtracer/')
      && scene.entry.endsWith('.usda') && !scene.entry.slice('./scenes/pathtracer/'.length).includes('/'));
    expect(entries.map(scene => scene.entry)).toEqual(names.map(name => `./scenes/pathtracer/${name}`));
    expect(new Set(SOURCE_SCENE_CATALOG.map(scene => scene.entry)).size).toBe(SOURCE_SCENE_CATALOG.length);
    expect(entries.every(scene => scene.label.startsWith('Pathtracer - '))).toBe(true);
  });
  it('includes every Lama USDA scene once with a dedicated label', () => {
    const names = ['add', 'iridescence', 'layer', 'mix', 'sheen', 'sss', 'translucent'].flatMap(directory =>
      readdirSync(join('scenes', 'lama', directory))
        .filter(name => name.endsWith('.usda'))
        .map(name => `${directory}/${name}`),
    ).sort();
    const entries = SOURCE_SCENE_CATALOG.filter(scene => ['add', 'iridescence', 'layer', 'mix', 'sheen', 'sss', 'translucent']
      .some(directory => scene.entry.startsWith(`./scenes/lama/${directory}/`)));
    expect(entries.map(scene => scene.entry)).toEqual(names.map(name => `./scenes/lama/${name}`));
    expect(entries.every(scene => scene.label.startsWith('Lama - ') || scene.label.startsWith('LamaLayer Gold - '))).toBe(true);
  });
  it('labels the four LamaLayer gold modes explicitly in the scene selector', () => {
    expect(SOURCE_SCENE_CATALOG.filter(scene => scene.label.startsWith('LamaLayer Gold - ')).map(scene => scene.label)).toEqual([
      'LamaLayer Gold - Auto',
      'LamaLayer Gold - Fresnel Blend',
      'LamaLayer Gold - Rough Coating',
      'LamaLayer Gold - Smooth Coating',
    ]);
  });
  it('includes every conductor parameter example and labels unsupported cases explicitly', () => {
    const names = readdirSync('scenes/lama/conductor').filter(name => name.endsWith('.usda')).sort();
    const entries = SOURCE_SCENE_CATALOG.filter(scene => scene.entry.startsWith('./scenes/lama/conductor/'));
    expect(entries.map(scene => scene.entry).sort()).toEqual(names.map(name => `./scenes/lama/conductor/${name}`));
    expect(entries).toHaveLength(21);
    expect(entries.every(scene => scene.label.startsWith('LamaConductor - '))).toBe(true);
    expect(entries.filter(scene => scene.label.includes('NOT SUPPORTED'))).toHaveLength(4);
  });
  it('includes only top-level pathtracer glTF and GLB files with distinct format labels', () => {
    const names = readdirSync('scenes\\pathtracer').filter(name => /\.(gltf|glb)$/i.test(name)).sort();
    const entries = SOURCE_SCENE_CATALOG.filter(scene => /\.(gltf|glb)$/i.test(scene.entry));
    expect(entries.map(scene => scene.entry)).toEqual(names.map(name => `./scenes/pathtracer/${name}`));
    expect(entries.every(scene => /\.(gltf|glb)$/i.test(scene.label))).toBe(true);
    expect(entries.every(scene => !scene.entry.slice('./scenes/pathtracer/'.length).includes('/'))).toBe(true);
  });
  it('defaults to Simple shader ball and keeps app-relative paths', () => {
    expect(SOURCE_SCENE_CATALOG[0]!.entry).toBe('./scenes/standard-shader-ball/openpbr-rva-standard-shader-ball.usda');
    expect(SOURCE_SCENE_CATALOG.every(scene => scene.entry.startsWith('./'))).toBe(true);
    expect(SOURCE_SCENE_CATALOG.find(scene => scene.entry.endsWith('/hyperion_rect_lights.usda'))?.label)
      .toBe('Pathtracer - hyperion rect lights');
  });
  it('lists only sources with a compiled wrapper, keeping their original labels', () => {
    const sources = [
      { label: 'Ajax', entry: './scenes/pathtracer/ajax.usda' },
      { label: 'Not compiled', entry: './scenes/pathtracer/other.usda' },
      { label: 'Duck', entry: './scenes/pathtracer/duck.glb' },
    ];
    expect(compiledSceneCatalog(sources, ['/scenes/compiled/pathtracer/ajax.usda', '/scenes/compiled/pathtracer/duck_glb.usda']))
      .toEqual([
        { label: 'Ajax', entry: './scenes/compiled/pathtracer/ajax.usda' },
        { label: 'Duck', entry: './scenes/compiled/pathtracer/duck_glb.usda' },
      ]);
    expect(SCENE_CATALOG.every(scene => scene.entry.startsWith('./scenes/compiled/') && scene.entry.endsWith('.usda'))).toBe(true);
  });
  it('lists only precompiled library materials under their source name', () => {
    expect(compiledMaterialCatalog(
      ['/scenes/mtlx-library/metals/gold/gold_polished.mtlx', '/scenes/mtlx-library/metals/silver/silver.mtlx'],
      ['/scenes/compiled/mtlx-library/metals/gold/gold_polished/material.json'],
    )).toEqual([{
      path: './scenes/mtlx-library/metals/gold/gold_polished.mtlx', group: 'metals', label: 'gold polished',
      compiled: './scenes/compiled/mtlx-library/metals/gold/gold_polished/material.json',
    }]);
  });
  it('maps sources to compiled paths and wrapper layers that resolve back to the binaries and source', () => {
    expect(compiledWrapperPath('./scenes/lama/add/a.usda')).toBe('scenes/compiled/lama/add/a.usda');
    expect(compiledSceneDirectory('scenes/pathtracer/box.gltf')).toBe('scenes/compiled/pathtracer/box_gltf');
    expect(compiledMaterialDirectory('scenes/mtlx-library/wood/oak.mtlx')).toBe('scenes/compiled/mtlx-library/wood/oak');
    expect(() => compiledWrapperPath('scenes/compiled/lama/a.usda')).toThrow();
    const layer = compiledWrapperLayer('./scenes/lama/add/a.usda');
    expect(layer).toContain('subLayers = [@../../../lama/add/a.usda@]');
    expect(parseCompiledLayerReferences(layer, 'https://x.test/app/scenes/compiled/lama/add/a.usda')).toEqual({
      scene: 'https://x.test/app/scenes/compiled/lama/add/a/scene.json',
      shaders: 'https://x.test/app/scenes/compiled/lama/add/a/shaders.wgsl.zst',
      buffers: 'https://x.test/app/scenes/compiled/lama/_shared/buffers.bin.zst',
      source: 'https://x.test/app/scenes/lama/add/a.usda',
    });
    expect(compiledSharedBuffersDirectory('scenes/lama/add/a.usda')).toBe('scenes/compiled/lama/_shared');
    expect(compiledSharedBuffersDirectory('scenes/pathtracer/ajax.usda')).toBeUndefined();
    expect(compiledWrapperLayer('scenes/pathtracer/ajax.usda')).not.toContain('compiledBuffers');
    expect(compiledWrapperLayer('scenes/pathtracer/duck.glb')).not.toContain('subLayers');
    expect(parseCompiledLayerReferences('#usda 1.0\ndef Xform "World" {}\n', 'https://x.test/a.usda')).toBeUndefined();
  });
  it('includes the composed Playground selection exactly once', () => {
    expect(SOURCE_SCENE_CATALOG.filter(scene => scene.entry === './scenes/OpenPBRShaderPlayground/playground_selection.usda'))
      .toEqual([{ label: 'OpenPBR Shader Playground - Selection (9 groups)', entry: './scenes/OpenPBRShaderPlayground/playground_selection.usda' }]);
  });
  it('includes the second composed Playground selection exactly once', () => {
    expect(SOURCE_SCENE_CATALOG.filter(scene => scene.entry === './scenes/OpenPBRShaderPlayground/playground_selection_2.usda'))
      .toEqual([{ label: 'OpenPBR Shader Playground - Selection 2 (8 groups)', entry: './scenes/OpenPBRShaderPlayground/playground_selection_2.usda' }]);
  });
});
