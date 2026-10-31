import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { defaultLibraryRoot, surfaceDefaults, simplifyMaterialXml } from '../../scripts/simplify-pathtracer-materials.mjs';

describe.skipIf(!existsSync(defaultLibraryRoot))('Pathtracer MaterialX default simplification', () => {
  const xml = (body, attributes = '') => `<standard_surface name="s" type="surfaceshader"${attributes}>\n${body}\n</standard_surface>`;
  const input = (name, type, value, extra = '') => `  <input name="${name}" type="${type}" value="${value}"${extra} />`;

  it('resolves inherited defaults while retaining the non-default source white color', () => {
    const result = simplifyMaterialXml(xml([
      input('base', 'float', '1'),
      input('base_color', 'color3', '1, 1, 1'),
      input('metalness', 'float', '0.0'),
      input('specular_roughness', 'float', '0.5'),
      input('specular_IOR', 'float', '1.5'),
    ].join('\n')), surfaceDefaults(defaultLibraryRoot));
    expect(result.removed).toBe(3);
    expect(result.text).toContain('name="base_color"');
    expect(result.text).toContain('name="specular_roughness"');
    expect(simplifyMaterialXml(result.text, surfaceDefaults(defaultLibraryRoot))).toEqual({ text: result.text, removed: 0 });
  });

  it('respects old versions and explicit NodeDefs', () => {
    const defaults = surfaceDefaults(defaultLibraryRoot);
    const body = [input('base', 'float', '0.8'), input('base_color', 'color3', '1,1,1')].join('\n');
    expect(simplifyMaterialXml(xml(body, ' version="1.0.0"'), defaults).removed).toBe(2);
    expect(simplifyMaterialXml(xml(body, ' nodedef="ND_standard_surface_surfaceshader_100"'), defaults).removed).toBe(2);
    expect(simplifyMaterialXml(xml(body, ' version="99.0"'), defaults).removed).toBe(0);
  });

  it('retains connections, attributes, invalid literals and inputs without a value default', () => {
    const text = xml([
      '  <input name="base_color" type="color3" nodename="texture" />',
      input('metalness', 'float', '0', ' uiname="Editable metal"'),
      input('normal', 'vector3', '0, 0, 1'),
      input('base', 'float', 'invalid'),
      input('metalness', 'float', ''),
      input('metalness', 'float', '0x0'),
      input('unknown', 'float', '0'),
    ].join('\n'));
    expect(simplifyMaterialXml(text, surfaceDefaults(defaultLibraryRoot))).toEqual({ text, removed: 0 });
  });

  it('preserves OpenPBR thin-wall state while omitting its default metalness', () => {
    const text = `<open_pbr_surface name="s" type="surfaceshader">\n${input('base_metalness', 'float', '0')}\n${input('geometry_thin_walled', 'boolean', 'true')}\n</open_pbr_surface>`;
    const result = simplifyMaterialXml(text, surfaceDefaults(defaultLibraryRoot));
    expect(result.removed).toBe(1);
    expect(result.text).toContain('geometry_thin_walled');
  });
});
