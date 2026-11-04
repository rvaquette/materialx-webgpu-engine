import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { AssetResolver } from '../../src/assets/resolver.ts';
import { composeStage } from '../../src/usd/compose.ts';

const root = fileURLToPath(new URL('../../scenes/OpenPBRShaderPlayground/', import.meta.url));
const groups = readdirSync(root).filter(name => name.endsWith('_grp'));

describe('static Playground text geometry', () => {
  it('keeps all 27 entry stages referencing existing text geometry instead of binary USD', () => {
    expect(groups).toHaveLength(27);
    for (const group of groups) {
      expect(readdirSync(join(root, group)).filter(name => /\.usdc?$/i.test(name))).toEqual([]);
      const entry = readFileSync(join(root, group, `${group}.usda`), 'utf8');
      expect(entry).not.toMatch(/@[^@]+\.usdc?@/i);
      expect(entry).toContain(`@${group}_geometry.usda@`);
      const geometry = join(root, group, `${group}_geometry.usda`);
      expect(existsSync(geometry)).toBe(true);
      const descriptor = openSync(geometry, 'r');
      try {
        const header = new Uint8Array(9);
        readSync(descriptor, header, 0, header.length, 0);
        expect(new TextDecoder().decode(header)).toBe('#usda 1.0');
      } finally {
        closeSync(descriptor);
      }
    }
  });

  it('composes Books geometry and material bindings without loading a WASM crate module', async () => {
    const loadCrateModule = vi.fn(async (): Promise<never> => { throw new Error('Binary runtime must not be loaded'); });
    const diagnostics = vi.fn();
    const scene = await composeStage('books_grp/books_grp.usda', {
      resolver: new AssetResolver({ rootUrl: new URL('../../scenes/OpenPBRShaderPlayground/', import.meta.url).href }),
      source: { fetchBytes: async url => new Uint8Array(readFileSync(fileURLToPath(url))) },
      loadCrateModule,
      sink: diagnostics,
    });
    const meshes = [...scene.prims.values()].filter(prim => prim.typeName === 'Mesh');
    expect(meshes).toHaveLength(6);
    expect(meshes.every(prim => prim.mesh !== undefined)).toBe(true);
    expect(scene.materials.some(material => material.materialName === 'books')).toBe(true);
    expect(loadCrateModule).not.toHaveBeenCalled();
    expect(diagnostics.mock.calls.some(([diagnostic]) =>
      diagnostic.level === 'error' || diagnostic.message.startsWith('Arc layer unavailable'))).toBe(false);
  });
});
