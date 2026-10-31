import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { materialBlocks, standardMaterial } from '../../scripts/repair-pathtracer-materials.mjs';

describe('Pathtracer standard MaterialX conversion', () => {
  it('parses named materials without activating commented maps and records malformed source lines', () => {
    const blocks = materialBlocks('material Test {\ncolor 1 0 0\n# normaltexture ignored.png\n0.1\n}');
    expect(blocks).toEqual([{ name: 'Test', values: { color: '1 0 0' }, ignored: ['0.1'] }]);
  });

  it('preserves source defaults and converts GGX alpha to perceptual roughness', () => {
    const xml = standardMaterial('test', { roughness: '0.25', clearcoatgloss: '1' });
    expect(xml).toContain('<standard_surface ');
    expect(xml).toContain('name="base_color" type="color3" value="1, 1, 1"');
    expect(xml).toContain('name="specular_roughness" type="float" value="0.5"');
    expect(xml).toContain('name="diffuse_roughness" type="float" value="0.25"');
    expect(xml).toContain('name="coat_roughness" type="float" value="0.0316227766017"');
  });

  it('preserves gamma 2.2, base factor, linear packed channels, normal handedness and alpha without duplicate images', () => {
    const xml = standardMaterial('test', {
      color: '0.1 0.2 0.3', albedotexture: 'color.png',
      metallicroughnesstexture: 'packed.png', normaltexture: 'normal.png',
      alphamode: 'mask', alphacutoff: '0.4', opacity: '0.7',
    });
    expect(xml).toContain('<power name="test_albedo_linear"');
    expect(xml).toContain('value="2.2, 2.2, 2.2"');
    expect(xml).toContain('value="0.1, 0.2, 0.3"');
    expect(xml).toContain('output="outz"');
    expect(xml).toContain('output="outy"');
    expect(xml).toContain('<normalmap name="test_normal_mapped"');
    expect(xml).toContain('value="1, -1, 1"');
    expect(xml).toContain('<ifgreatereq name="test_alpha_mask"');
    expect(xml).toContain('value="0.4"');
    expect(xml).not.toContain('colorspace="srgb');
    const names = [...xml.matchAll(/^  <\w+ name="([^"]+)"/gm)].map(match => match[1]);
    expect(new Set(names).size).toBe(names.length);
    expect(standardMaterial('normal', { normaltexture: 'normal.png' }, { flipNormalY: false })).not.toContain('normal_flip');
  });

  it('retains emissive radiance and the exact source absorbing extinction coefficient', () => {
    const xml = standardMaterial('glass', { emission: '5 5 20', mediumtype: 'absorb', mediumcolor: '0.2 0.6 1', mediumdensity: '4' });
    expect(xml).toContain('name="emission_color" type="color3" value="5, 5, 20"');
    expect(xml).toContain('name="transmission_depth" type="float" value="0.25"');
    const raw = /name="transmission_color" type="color3" value="([^"]+)"/.exec(xml)[1].split(',').map(Number);
    raw.forEach((value, i) => expect(-Math.log(value) / 0.25).toBeCloseTo([3.2, 1.6, 0][i], 10));
  });

  it('uses OpenPBR for thin-walled transmission and rejects unsupported volumes explicitly', () => {
    const xml = standardMaterial('thin', { thinwalled: '1', spectrans: '1', transmissioncolor: '0.75 0.95 1' });
    expect(xml).toContain('<open_pbr_surface ');
    expect(xml).toContain('name="geometry_thin_walled" type="boolean" value="true"');
    expect(xml).toContain('name="transmission_weight" type="float" value="1"');
    expect(() => standardMaterial('volume', { mediumtype: 'scatter' })).toThrow('participating medium');
    expect(() => standardMaterial('invalid', { roughness: 'nan' })).toThrow('invalid roughness');
  });

  it('keeps every USDA MaterialX terminal present after repair, including restored originals', () => {
    const root = join(process.cwd(), 'scenes', 'pathtracer');
    const scenes = readdirSync(root).filter(name => name.endsWith('.usda'));
    expect(scenes).toHaveLength(45);
    let references = 0;
    for (const scene of scenes) {
      const stage = readFileSync(join(root, scene), 'utf8');
      for (const [, asset, name] of stage.matchAll(/@([^@]+\.mtlx)@<\/MaterialX\/Materials\/([^>]+)>/g)) {
        const xml = readFileSync(join(root, asset), 'utf8');
        expect(xml, `${scene}: ${name}`).toContain(`<surfacematerial name="${name}"`);
        references++;
      }
    }
    expect(references).toBeGreaterThanOrEqual(294);
    const restored = readFileSync(join(root, 'openpbr_rva_standard_shader_ball.usda'), 'utf8');
    expect(restored).toContain('../mtlx-library/Examples/StandardSurface/standard_surface_glass.mtlx@</MaterialX/Materials/Glass>');
  });
});
