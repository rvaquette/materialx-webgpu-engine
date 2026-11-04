// T057j: path tracer texture registry. The megakernel binds every graph-backed
// material's textures at once, so this collects all variant texture/sampler
// bindings into one sequential layout (textures group 1, samplers group 2) and
// shares compatible texture bindings by file, view kind and GPU color decoding.
// Samplers are shared by their effective GPU descriptor, independently of images.
// Per-material source handles are remapped to the retained bindings by the
// material dispatcher. Image decoding remains deduplicated by file reference.

import type { SurfaceVariantModule } from '../../compiler/surface-wgsl.ts';
import type { WgslBinding } from '../../compiler/wgsl.ts';
import { imageSamplerDescriptor } from '../../assets/samplers.ts';

/** Deduplicated texture layout shared by all megakernel material variants. */
export interface PtTextureRegistry {
  /** Shared texture bindings, renumbered to a sequential group-1 layout. */
  textures: WgslBinding[];
  /** Shared sampler bindings, renumbered to a sequential group-2 layout. */
  samplers: WgslBinding[];
  /** Unique images referenced across all materials (deduped by file reference);
   *  an `undefined` entry is a distinct slot with no file (never dedups). */
  images: (string | undefined)[];
  /** For each `textures[i]`, the index into `images` it samples. Bindings that
   *  resolve to the same file share an image index (device decode dedup). */
  textureImage: number[];
  /** Shared resources use one binding; variant source handles are remapped. */
  bindingAliases?: ReadonlyMap<string, string>;
}

/** Collect and dedup the texture/sampler bindings of every graph-backed material. */
export function buildTextureRegistry(variants: readonly SurfaceVariantModule[]): PtTextureRegistry {
  const images: (string | undefined)[] = [];
  const byFile = new Map<string, number>();
  const textureImage: number[] = [];

  const textures: WgslBinding[] = [];
  const bindingAliases = new Map<string, string>();
  const byTexture = new Map<string, WgslBinding>();
  for (const t of variants.flatMap((v) => v.textures)) {
    const key = t.fileRef === undefined ? undefined
      : JSON.stringify([t.fileRef, t.textureKind ?? '2d', t.textureKind !== 'udim-index' && t.colorSpace === 'srgb_texture']);
    const shared = key === undefined ? undefined : byTexture.get(key);
    if (shared) {
      bindingAliases.set(t.handle, shared.handle);
      continue;
    }
    const binding: WgslBinding = {
      name: t.name, handle: t.handle, group: 1, binding: textures.length,
      ...(t.colorSpace !== undefined ? { colorSpace: t.colorSpace } : {}),
      ...(t.textureKind !== undefined ? { textureKind: t.textureKind } : {}),
    };
    textures.push(binding);
    if (key !== undefined) byTexture.set(key, binding);
    if (t.fileRef !== undefined) {
      let idx = byFile.get(t.fileRef);
      if (idx === undefined) {
        idx = images.length;
        images.push(t.fileRef);
        byFile.set(t.fileRef, idx);
      }
      textureImage.push(idx);
    } else {
      textureImage.push(images.length);
      images.push(undefined);
    }
  }

  const samplers: WgslBinding[] = [];
  const bySampler = new Map<string, WgslBinding>();
  for (const variant of variants) {
    for (const sampler of variant.samplers) {
      const key = JSON.stringify(imageSamplerDescriptor(sampler.sampler ?? {}));
      const shared = bySampler.get(key);
      if (shared) {
        bindingAliases.set(sampler.handle, shared.handle);
        continue;
      }
      const binding = { ...sampler, group: 2, binding: samplers.length };
      samplers.push(binding);
      bySampler.set(key, binding);
    }
  }

  return { textures, samplers, images, textureImage, bindingAliases };
}
