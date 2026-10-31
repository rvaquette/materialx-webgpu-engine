import { describe, expect, it, vi } from 'vitest';
import { MeshStandardMaterial, MeshPhysicalMaterial, Texture, Vector2 } from 'three';
import { gltfMaterialToMaterialX } from '../../src/scene/gltf-materialx.ts';

describe('glTF to gltf_pbr MaterialX', () => {
  it('preserves linear base color and metallic-roughness factors', async () => {
    const material = new MeshStandardMaterial({ color: 0xffffff, metalness: 0.7, roughness: 0.3 });
    material.color.setRGB(0.2, 0.4, 0.6);
    const xml = await gltfMaterialToMaterialX(material, 'test', vi.fn(), vi.fn());
    expect(xml).toContain('<gltf_pbr name="test_surface"');
    expect(xml).toContain('name="base_color" type="color3" value="0.2, 0.4, 0.6"');
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

  it('preserves clearcoat roughness, transmission and IOR without Disney gloss conversion', async () => {
    const material = new MeshPhysicalMaterial({ clearcoat: 0.6, clearcoatRoughness: 0.3, transmission: 0.8, ior: 1.6 });
    const xml = await gltfMaterialToMaterialX(material, 'test', vi.fn(), vi.fn());
    expect(xml).toContain('name="clearcoat_roughness" type="float" value="0.3"');
    expect(xml).toContain('name="transmission" type="float" value="0.8"');
    expect(xml).toContain('name="ior" type="float" value="1.6"');
    material.clearcoatRoughnessMap = new Texture();
    const mapped = await gltfMaterialToMaterialX(material, 'test', async () => 'blob:texture', vi.fn());
    expect(mapped).toContain('<multiply name="clearcoat_roughness_factor" type="float">');
  });

  it('preserves normals, alpha, emission and extensions while warning about unsupported volume', async () => {
    const material = new MeshPhysicalMaterial({
      normalMap: new Texture(), transparent: true, opacity: 0.5,
      emissive: 0xff0000, thickness: 0.4, iridescence: 1, sheen: 0.2,
    });
    const warnings: string[] = [];
    const xml = await gltfMaterialToMaterialX(material, 'test', async () => 'blob:normal', message => warnings.push(message));
    expect(xml).toContain('<normalmap name="normal_mapped"');
    expect(xml).toContain('name="normal" type="vector3" nodename="normal_mapped"');
    expect(xml).toContain('name="alpha_mode" type="integer" value="2"');
    expect(xml).toContain('name="alpha" type="float" value="0.5"');
    expect(xml).toContain('name="emissive" type="color3" value="1, 0, 0"');
    expect(warnings.some(message => message.includes('normal and bump maps are not represented'))).toBe(false);
    expect(warnings.some(message => message.includes('volume'))).toBe(true);
    expect(xml).toContain('name="iridescence" type="float" value="1"');
    expect(xml).toContain('name="sheen_color"');
  });
  it('keeps tangent normal texture linear and preserves nonuniform normal scale', async () => {
    const material = new MeshStandardMaterial({ normalMap: new Texture() });
    material.normalScale.set(0.25, 0.75);
    const xml = await gltfMaterialToMaterialX(material, 'test', async () => 'blob:normal', vi.fn());
    expect(xml).toContain('<image name="normal_image" type="vector3">');
    expect(xml).not.toContain('<image name="normal_image" type="vector3" colorspace=');
    expect(xml).toContain('name="in2" type="vector3" value="0.25, 0.75, 1"');
    expect(xml).toContain('<normalmap name="normal_mapped"');
  });

  it('preserves alpha texture channel and mask cutoff without sRGB decoding', async () => {
    const material = new MeshStandardMaterial({ map: new Texture(), alphaTest: 0.4, opacity: 0.7 });
    const exportTexture = vi.fn(async (_texture: Texture, channel?: number) => `blob:${channel ?? 'rgb'}`);
    const xml = await gltfMaterialToMaterialX(material, 'test', exportTexture, vi.fn());
    expect(exportTexture.mock.calls.map(call => call[1])).toEqual([undefined, 3]);
    expect(xml).toContain('name="alpha_mode" type="integer" value="1"');
    expect(xml).toContain('name="alpha_cutoff" type="float" value="0.4"');
    expect(xml).toContain('<image name="alpha_image" type="float">');
    expect(xml).toContain('name="alpha" type="float" nodename="alpha_factor"');
  });
});
