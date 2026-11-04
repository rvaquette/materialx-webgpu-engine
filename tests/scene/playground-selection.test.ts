import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { importUsdStage } from '../../src/usd/importer.ts';
import { importLights } from '../../src/usd/lights.ts';

describe('Playground selection composition', () => {
  it('composes the second selection with the airplane tape and masks unselected airplane branches', async () => {
    const root = 'scenes\\OpenPBRShaderPlayground\\';
    const scene = await importUsdStage('playground_selection_2.usda', {
      reader: { read: async uri => readFileSync(root + uri.replaceAll('/', '\\'), 'utf8') },
    });
    expect(scene.stage.subLayers).toHaveLength(6);
    for (const group of ['chairB_grp', 'plane_grp', 'mug_grp', 'paintSpill_scrnRT_grp', 'powerPlug_grp', 'outlet_grp']) {
      expect(scene.prims.get(`/World/${group}`)?.references).toHaveLength(1);
    }
    for (const group of ['mainBody_grp', 'plasticCaps_grp', 'tape_grp']) {
      const prim = scene.prims.get(`/World/plane_grp/${group}`);
      expect(prim, group).toBeDefined();
      expect(prim!.attributes.get('visibility')?.value).not.toBe('invisible');
    }
    for (const group of ['pencils_grp', 'cardboard_grp', 'hotglue_grp', 'lids_grp']) {
      expect(scene.prims.get(`/World/plane_grp/${group}`)?.attributes.get('visibility')?.value).toBe('invisible');
    }
    expect(scene.prims.get('/World/tape_grp')?.references ?? []).toHaveLength(0);
    expect(importLights(scene)).toHaveLength(6);
    expect(scene.prims.has('/World/Looks')).toBe(true);
  });

  it('composes nine original groups and materials with a single shared lighting rig', async () => {
    const root = 'scenes\\OpenPBRShaderPlayground\\';
    const scene = await importUsdStage('playground_selection.usda', {
      reader: { read: async uri => readFileSync(root + uri.replaceAll('/', '\\'), 'utf8') },
    });
    const groups = [
      'chairA_grp', 'tube_grp', 'orangeJuice_grp', 'meetMAT_grp', 'paintSpill_grp',
      'masonJar_grp', 'paintBrushes_grp', 'paper_grp', 'dresser_grp',
    ];
    expect(scene.stage.defaultPrim).toBe('World');
    expect(scene.stage.metersPerUnit).toBe(0.01);
    expect(scene.stage.upAxis).toBe('Y');
    expect(scene.stage.subLayers).toHaveLength(9);
    for (const group of groups) {
      const prim = scene.prims.get(`/World/${group}`);
      expect(prim, group).toBeDefined();
      expect(prim!.references).toHaveLength(1);
      expect(prim!.references[0]!.assetPath).toContain(`${group}_geometry.usda`);
    }
    expect(importLights(scene)).toHaveLength(6);
    expect(scene.prims.has('/World/Looks')).toBe(true);
  });
});
