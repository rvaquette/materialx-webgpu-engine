// T057j: path tracer texture registry. The megakernel binds every graph-backed
// material's textures at once, so this collects all variant texture/sampler
// bindings into one sequential layout (textures group 1, samplers group 2) and
// deduplicates the underlying images by file reference: materials that sample the
// same file share a single decoded GPU texture (the bind group binds it to each
// slot that references it) instead of uploading it once per material. Handles stay
// per-material (emitSurfaceVariant prefixes them `m<index>_`) so the variant fill
// functions keep referencing their own bindings; only the device-side image
// decode/upload is shared. Pure data (Node-testable); the device bind group is
// built from this layout by scene-buffers/the harness (T057m).

import type { SurfaceVariantModule } from '../../compiler/surface-wgsl.ts';
import type { WgslBinding } from '../../compiler/wgsl.ts';

/** Deduplicated texture layout shared by all megakernel material variants. */
export interface PtTextureRegistry {
  /** Every variant texture binding, renumbered to a sequential group-1 layout. */
  textures: WgslBinding[];
  /** Every variant sampler binding, renumbered to a sequential group-2 layout. */
  samplers: WgslBinding[];
  /** Unique images referenced across all materials (deduped by file reference);
   *  an `undefined` entry is a distinct slot with no file (never dedups). */
  images: (string | undefined)[];
  /** For each `textures[i]`, the index into `images` it samples. Bindings that
   *  resolve to the same file share an image index (device decode dedup). */
  textureImage: number[];
}

/** Collect and dedup the texture/sampler bindings of every graph-backed material. */
export function buildTextureRegistry(variants: readonly SurfaceVariantModule[]): PtTextureRegistry {
  const images: (string | undefined)[] = [];
  const byFile = new Map<string, number>();
  const textureImage: number[] = [];

  const allTextures = variants.flatMap((v) => v.textures);
  for (const t of allTextures) {
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

  const textures = allTextures.map((t, i) => ({
    name: t.name, handle: t.handle, group: 1, binding: i,
    ...(t.colorSpace !== undefined ? { colorSpace: t.colorSpace } : {}),
  }));
  const samplers = variants
    .flatMap((v) => v.samplers)
    .map((s, i) => ({ name: s.name, handle: s.handle, group: 2, binding: i }));

  return { textures, samplers, images, textureImage };
}
