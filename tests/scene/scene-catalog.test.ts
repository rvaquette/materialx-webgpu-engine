import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SCENE_CATALOG } from '../../src/scene/scene-catalog.ts';

describe('scene selector catalog', () => {
  it('includes every dielectric parameter scene and identifies unsupported controls', () => {
    const names = readdirSync('scenes/lama/dielectric').filter(name => name.endsWith('.usda')).sort();
    const entries = SCENE_CATALOG.filter(scene => scene.entry.startsWith('./scenes/lama/dielectric/'));
    expect(entries.map(scene => scene.entry).sort()).toEqual(names.map(name => `./scenes/lama/dielectric/${name}`));
    expect(entries).toHaveLength(34);
    expect(entries.filter(scene => scene.label.includes('NOT SUPPORTED'))).toHaveLength(10);
  });

  it('includes every generalized-Schlick parameter scene and identifies unsupported controls', () => {
    const names = readdirSync('scenes/lama/generalized_schlick').filter(name => name.endsWith('.usda')).sort();
    const entries = SCENE_CATALOG.filter(scene => scene.entry.startsWith('./scenes/lama/generalized_schlick/'));
    expect(entries.map(scene => scene.entry).sort()).toEqual(names.map(name => `./scenes/lama/generalized_schlick/${name}`));
    expect(entries).toHaveLength(34);
    expect(entries.every(scene => scene.label.startsWith('LamaGeneralizedSchlick - '))).toBe(true);
    expect(entries.filter(scene => scene.label.includes('NOT SUPPORTED'))).toHaveLength(10);
  });

  it('includes every current pathtracer USDA exactly once, in filename order', () => {
    const names = readdirSync('scenes\\pathtracer')
      .filter(name => name.endsWith('.usda')).sort();
    const entries = SCENE_CATALOG.filter(scene => scene.entry.startsWith('./scenes/pathtracer/')
      && scene.entry.endsWith('.usda') && !scene.entry.slice('./scenes/pathtracer/'.length).includes('/'));
    expect(entries.map(scene => scene.entry)).toEqual(names.map(name => `./scenes/pathtracer/${name}`));
    expect(new Set(SCENE_CATALOG.map(scene => scene.entry)).size).toBe(SCENE_CATALOG.length);
    expect(entries.every(scene => scene.label.startsWith('Pathtracer - '))).toBe(true);
  });
  it('includes every Lama USDA scene once with a dedicated label', () => {
    const names = ['add', 'iridescence', 'layer', 'mix', 'sheen', 'translucent'].flatMap(directory =>
      readdirSync(join('scenes', 'lama', directory))
        .filter(name => name.endsWith('.usda'))
        .map(name => `${directory}/${name}`),
    ).sort();
    const entries = SCENE_CATALOG.filter(scene => ['add', 'iridescence', 'layer', 'mix', 'sheen', 'translucent']
      .some(directory => scene.entry.startsWith(`./scenes/lama/${directory}/`)));
    expect(entries.map(scene => scene.entry)).toEqual(names.map(name => `./scenes/lama/${name}`));
    expect(entries.every(scene => scene.label.startsWith('Lama - ') || scene.label.startsWith('LamaLayer Gold - '))).toBe(true);
  });
  it('labels the four LamaLayer gold modes explicitly in the scene selector', () => {
    expect(SCENE_CATALOG.filter(scene => scene.label.startsWith('LamaLayer Gold - ')).map(scene => scene.label)).toEqual([
      'LamaLayer Gold - Auto',
      'LamaLayer Gold - Fresnel Blend',
      'LamaLayer Gold - Rough Coating',
      'LamaLayer Gold - Smooth Coating',
    ]);
  });
  it('includes every conductor parameter example and labels unsupported cases explicitly', () => {
    const names = readdirSync('scenes/lama/conductor').filter(name => name.endsWith('.usda')).sort();
    const entries = SCENE_CATALOG.filter(scene => scene.entry.startsWith('./scenes/lama/conductor/'));
    expect(entries.map(scene => scene.entry).sort()).toEqual(names.map(name => `./scenes/lama/conductor/${name}`));
    expect(entries).toHaveLength(21);
    expect(entries.every(scene => scene.label.startsWith('LamaConductor - '))).toBe(true);
    expect(entries.filter(scene => scene.label.includes('NOT SUPPORTED'))).toHaveLength(4);
  });
  it('includes only top-level pathtracer glTF and GLB files with distinct format labels', () => {
    const names = readdirSync('scenes\\pathtracer').filter(name => /\.(gltf|glb)$/i.test(name)).sort();
    const entries = SCENE_CATALOG.filter(scene => /\.(gltf|glb)$/i.test(scene.entry));
    expect(entries.map(scene => scene.entry)).toEqual(names.map(name => `./scenes/pathtracer/${name}`));
    expect(entries.every(scene => /\.(gltf|glb)$/i.test(scene.label))).toBe(true);
    expect(entries.every(scene => !scene.entry.slice('./scenes/pathtracer/'.length).includes('/'))).toBe(true);
  });
  it('defaults to Simple shader ball and keeps app-relative paths', () => {
    expect(SCENE_CATALOG[0]!.entry).toBe('./scenes/standard-shader-ball/openpbr-rva-standard-shader-ball.usda');
    expect(SCENE_CATALOG.every(scene => scene.entry.startsWith('./'))).toBe(true);
    expect(SCENE_CATALOG.find(scene => scene.entry.endsWith('/hyperion_rect_lights.usda'))?.label)
      .toBe('Pathtracer - hyperion rect lights');
  });
  it('shows compiled scene names without their parent paths', () => {
    const entries = SCENE_CATALOG.filter(scene => scene.entry.endsWith('/scene.json'));
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every(scene => scene.label === `Compiled - ${scene.entry.split('/').at(-2)}`)).toBe(true);
  });
  it('includes the composed Playground selection exactly once', () => {
    expect(SCENE_CATALOG.filter(scene => scene.entry === './scenes/OpenPBRShaderPlayground/playground_selection.usda'))
      .toEqual([{ label: 'OpenPBR Shader Playground - Selection (9 groups)', entry: './scenes/OpenPBRShaderPlayground/playground_selection.usda' }]);
  });
  it('includes the second composed Playground selection exactly once', () => {
    expect(SCENE_CATALOG.filter(scene => scene.entry === './scenes/OpenPBRShaderPlayground/playground_selection_2.usda'))
      .toEqual([{ label: 'OpenPBR Shader Playground - Selection 2 (8 groups)', entry: './scenes/OpenPBRShaderPlayground/playground_selection_2.usda' }]);
  });
});
