import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SCENE_CATALOG } from '../../src/scene/scene-catalog.ts';

describe('scene selector catalog', () => {
  it('includes every current pathtracer USDA exactly once, in filename order', () => {
    const names = readdirSync('scenes\\pathtracer')
      .filter(name => name.endsWith('.usda')).sort();
    const entries = SCENE_CATALOG.filter(scene => scene.entry.startsWith('./scenes/pathtracer/'));
    expect(entries.map(scene => scene.entry)).toEqual(names.map(name => `./scenes/pathtracer/${name}`));
    expect(new Set(SCENE_CATALOG.map(scene => scene.entry)).size).toBe(SCENE_CATALOG.length);
    expect(entries.every(scene => scene.label.startsWith('Pathtracer - '))).toBe(true);
  });
  it('keeps the existing default scene and app-relative paths', () => {
    expect(SCENE_CATALOG[0]!.entry).toBe('./scenes/standard-shader-ball/standard-shader-ball.usda');
    expect(SCENE_CATALOG.every(scene => scene.entry.startsWith('./'))).toBe(true);
    expect(SCENE_CATALOG.find(scene => scene.entry.endsWith('/hyperion_rect_lights.usda'))?.label)
      .toBe('Pathtracer - hyperion rect lights');
  });
});
