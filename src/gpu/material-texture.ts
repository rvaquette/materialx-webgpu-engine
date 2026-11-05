import type { DecodedPixelImage } from '../assets/images.ts';
import { UDIM_COLUMNS, UDIM_ROWS, udimLayerIndex } from '../assets/udim.ts';
import type { WgslBinding } from '../compiler/wgsl.ts';

type MaterialTextureDevice = Pick<GPUDevice, 'createTexture'> & {
  limits: Pick<GPUSupportedLimits, 'maxTextureDimension2D' | 'maxTextureArrayLayers'>;
  queue: Pick<GPUQueue, 'writeTexture'>;
};

/** Upload compatible views as separate layers, preserving their original pixels. */
export function uploadMaterialImageArray(
  device: MaterialTextureDevice, images: readonly (DecodedPixelImage | undefined)[],
  format: GPUTextureFormat, index = false,
): GPUTexture {
  const first = images[0];
  if (!first || images.some(image => !image)) throw new Error('Texture array requires decoded images.');
  const width = index ? UDIM_COLUMNS : first.width;
  const height = index ? UDIM_ROWS : first.height;
  if (width > device.limits.maxTextureDimension2D || height > device.limits.maxTextureDimension2D
    || images.length > device.limits.maxTextureArrayLayers) {
    throw new Error(`Material texture array exceeds device limits: ${width} x ${height} x ${images.length}.`);
  }
  for (const image of images) {
    if (index ? !image!.udim?.length
      : image!.width !== width || image!.height !== height || image!.channels !== 4 || image!.componentType !== 'uint8') {
      throw new Error('Incompatible image in material texture array.');
    }
  }
  const texture = device.createTexture({
    size: [width, height, images.length], format,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  try {
    images.forEach((image, layer) => {
      device.queue.writeTexture({ texture, origin: [0, 0, layer] }, index ? udimLayerIndex(image!) : image!.data,
        { bytesPerRow: width * 4, rowsPerImage: height }, [width, height, 1]);
    });
    return texture;
  } catch (error) {
    texture.destroy();
    throw error;
  }
}

/** Shared raster/compute upload; UDIM indices are integer textures, never sRGB. */
export function uploadMaterialImage(
  device: MaterialTextureDevice,
  image: DecodedPixelImage | undefined,
  format: GPUTextureFormat,
  textureKind?: WgslBinding['textureKind'],
): GPUTexture {
  if (textureKind && !image?.udim?.length) throw new Error('UDIM texture requires decoded tiles.');
  const isIndex = textureKind === 'udim-index';
  const layers = textureKind === 'udim' ? image!.udim!.length : 1;
  const width = isIndex ? UDIM_COLUMNS : image?.width ?? 1;
  const height = isIndex ? UDIM_ROWS : image?.height ?? 1;
  const images = textureKind === 'udim' ? image!.udim!.map(tile => tile.image) : [image];
  if (!isIndex && images.some(pixels => pixels !== undefined &&
      (pixels.componentType !== 'uint8' || pixels.channels !== 4 || !(pixels.data instanceof Uint8Array) ||
       pixels.width !== width || pixels.height !== height || pixels.data.length !== width * height * 4))) {
    throw new Error('Material texture upload requires matching decoded RGBA8 pixels; higher precision is preserved in compiled scenes but not supported by this GPU upload path.');
  }
  if (width > device.limits.maxTextureDimension2D || height > device.limits.maxTextureDimension2D ||
      layers > device.limits.maxTextureArrayLayers) {
    throw new Error(`Material texture exceeds device limits: ${width} x ${height} x ${layers}.`);
  }
  const texture = device.createTexture({
    size: [width, height, layers],
    format: isIndex ? 'r32uint' : format,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  try {
    if (isIndex) {
      device.queue.writeTexture({ texture }, udimLayerIndex(image!), { bytesPerRow: width * 4, rowsPerImage: height }, [width, height, 1]);
    } else {
      images.forEach((pixels, layer) => {
        if (pixels?.componentType === 'uint8' && pixels.channels === 4) {
          device.queue.writeTexture({ texture, origin: [0, 0, layer] }, pixels.data,
            { bytesPerRow: width * 4, rowsPerImage: height }, [width, height, 1]);
        }
      });
    }
    return texture;
  } catch (error) {
    texture.destroy();
    throw error;
  }
}
