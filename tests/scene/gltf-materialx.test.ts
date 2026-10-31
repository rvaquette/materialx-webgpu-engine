import { describe, expect, it, vi } from 'vitest';
import { MeshStandardMaterial, MeshPhysicalMaterial, Texture, Vector2 } from 'three';
import { gltfMaterialToMaterialX } from '../../src/scene/gltf-materialx.ts';

describe('glTF to Disney MaterialX', () => {
  it('preserves linear base color and metallic-roughness factors', async () => {
    const material = new MeshStandardMaterial({ color: 0xffffff, metalness: 0.7, roughness: 0.3 });
    material.color.setRGB(0.2, 0.4, 0.6);
    const xml = await gltfMaterialToMaterialX(material, 'test', vi.fn(), vi.fn());
    expect(xml).toContain('<disney_principled name="test_surface"');
    expect(xml).toContain('name="baseColor" type="color3" value="0.2, 0.4, 0.6"');
    expect(xml).toContain('name="metallic" type="float" value="0.7"');
    expect(xml).toContain('name="roughness" type="float" value="0.3"');
    expect(xml).toContain('nodename="test_surface"');
  });

  it('extracts glTF packed channels and retains factors, sRGB decoding and UV transforms', async () => {
    const texture = new Texture();
    texture.offset = new Vector2(0.25, 0.4);
    texture.repeat = new Vector2(2, 3);
    const material = new MeshStandardMaterial({
      map: texture, metalnessMap: texture, roughnessMap: texture,
      metalness: 0.7, roughness: 0.3,
    });
    const exporter = vi.fn(async (_texture: Texture, channel?: number) => `blob:local/channel${channel ?? 'rgb'}&texture`);
    const xml = await gltfMaterialToMaterialX(material, 'test', exporter, vi.fn());
    expect(exporter.mock.calls.map(call => call[1])).toEqual([undefined, 2, 1]);
    expect(xml).toContain('colorspace="srgb_texture"');
    expect(xml).toContain('blob:local/channelrgb&amp;texture');
    expect(xml).toContain('name="uvoffset" type="vector2" value="-0.25, 2.4"');
    expect(xml).toContain('name="uvtiling" type="vector2" value="2, 3"');
    expect(xml).toContain('<multiply name="metallic_factor" type="float">');
    expect(xml).toContain('<input name="in2" type="float" value="0.7"');
  });

  it('converts clearcoat roughness into Disney gloss and preserves transmission and IOR', async () => {
    const material = new MeshPhysicalMaterial({ clearcoat: 0.6, clearcoatRoughness: 0.3, transmission: 0.8, ior: 1.6 });
    const xml = await gltfMaterialToMaterialX(material, 'test', vi.fn(), vi.fn());
    expect(xml).toContain('name="clearcoatGloss" type="float" value="0.7"');
    expect(xml).toContain('name="specTrans" type="float" value="0.8"');
    expect(xml).toContain('name="ior" type="float" value="1.6"');
    material.clearcoatRoughnessMap = new Texture();
    const mapped = await gltfMaterialToMaterialX(material, 'test', async () => 'blob:texture', vi.fn());
    expect(mapped).toContain('<subtract name="clearcoatGloss_inverted" type="float">');
  });

  it('reports material features that Disney cannot represent rather than dropping them silently', async () => {
    const material = new MeshPhysicalMaterial({
      normalMap: new Texture(), transparent: true, opacity: 0.5,
      emissive: 0xff0000, thickness: 0.4, iridescence: 1, sheen: 0.2,
    });
    const warnings: string[] = [];
    await gltfMaterialToMaterialX(material, 'test', vi.fn(), message => warnings.push(message));
    expect(warnings.some(message => message.includes('normal'))).toBe(true);
    expect(warnings.some(message => message.includes('opaque'))).toBe(true);
    expect(warnings.some(message => message.includes('emission'))).toBe(true);
    expect(warnings.some(message => message.includes('volume'))).toBe(true);
    expect(warnings.some(message => message.includes('iridescence'))).toBe(true);
    expect(warnings.some(message => message.includes('sheen'))).toBe(true);
  });
});
