import type { DecodedPixelImage } from '../../assets/images.ts';
import { uploadMaterialImageArray } from '../../gpu/material-texture.ts';
import type { PtImageProvider } from './device-bindings.ts';

type TextureUsage = 'albedo' | 'metallic-roughness';
type ResizeImage = (image: DecodedPixelImage, width: number, height: number) => DecodedPixelImage | Promise<DecodedPixelImage>;
type TextureDevice = Parameters<typeof uploadMaterialImageArray>[0];

/** Stable array-layer indices for the files requested by material conversion. */
export class DisneyTextureRegistry {
  private readonly indices = new Map<string, number>();
  private readonly files: string[] = [];

  add(file: string, _usage: TextureUsage): number {
    if (!file) throw new Error('Disney texture reference is empty.');
    const existing = this.indices.get(file);
    if (existing !== undefined) return existing;
    const index = this.files.length;
    if (index > 0xffffff) throw new Error('Disney texture registry exceeds the exact float index limit.');
    this.indices.set(file, index);
    this.files.push(file);
    return index;
  }

  references(): readonly string[] {
    return [...this.files];
  }
}

function validateImage(image: DecodedPixelImage, file: string): void {
  if (image.udim || image.componentType !== 'uint8' || image.channels !== 4 || !(image.data instanceof Uint8Array) ||
      !Number.isSafeInteger(image.width) || image.width <= 0 ||
      !Number.isSafeInteger(image.height) || image.height <= 0 ||
      image.data.length !== image.width * image.height * 4) {
    throw new Error(`Disney texture requires a single decoded RGBA8 image: ${file}.`);
  }
}

/** Resize with the browser's canvas path used by the source renderer. */
export function resizeDisneyImage(image: DecodedPixelImage, width: number, height: number): DecodedPixelImage {
  validateImage(image, '<resize>');
  if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0) {
    throw new Error('Invalid Disney texture dimensions.');
  }
  if (image.width === width && image.height === height) return image;
  if (typeof document === 'undefined') throw new Error('Resizing Disney textures requires a browser canvas.');
  const source = document.createElement('canvas');
  source.width = image.width;
  source.height = image.height;
  const sourceContext = source.getContext('2d');
  if (!sourceContext) throw new Error('Cannot create source canvas for Disney texture.');
  const pixels = sourceContext.createImageData(image.width, image.height);
  pixels.data.set(image.data);
  sourceContext.putImageData(pixels, 0, 0);
  const target = document.createElement('canvas');
  target.width = width;
  target.height = height;
  const targetContext = target.getContext('2d');
  if (!targetContext) throw new Error('Cannot create target canvas for Disney texture.');
  targetContext.drawImage(source, 0, 0, width, height);
  return {
    kind: 'pixels', componentType: 'uint8', channels: 4, width, height, colorSpace: image.colorSpace,
    data: new Uint8Array(targetContext.getImageData(0, 0, width, height).data),
  };
}

/**
 * Decode, resize and upload an integer texture array in registry order.
 * Dimensions must come from the reference scene's texture-array settings.
 * An empty registry returns undefined: no material refers to a texture.
 */
export async function uploadDisneyTextureArray(
  device: TextureDevice, registry: DisneyTextureRegistry, provider: PtImageProvider,
  width: number, height: number, resize: ResizeImage = resizeDisneyImage,
): Promise<GPUTexture | undefined> {
  if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0) {
    throw new Error('Invalid Disney texture dimensions.');
  }
  if (width !== height) throw new Error('Disney WebGL texture lookup requires square texture layers.');
  const files = registry.references();
  if (!files.length) return undefined;
  if (width > device.limits.maxTextureDimension2D || height > device.limits.maxTextureDimension2D ||
      files.length > device.limits.maxTextureArrayLayers) {
    throw new Error(`Disney texture array exceeds device limits: ${width} x ${height} x ${files.length}.`);
  }
  const images: DecodedPixelImage[] = [];
  for (const file of files) {
    const image = await provider.decode(file);
    if (!image) throw new Error(`Missing Disney texture: ${file}.`);
    validateImage(image, file);
    const resized = image.width === width && image.height === height ? image : await resize(image, width, height);
    validateImage(resized, file);
    if (resized.width !== width || resized.height !== height) throw new Error(`Invalid resized Disney texture dimensions: ${file}.`);
    images.push(resized);
  }
  return uploadMaterialImageArray(device, images, 'rgba8uint');
}
