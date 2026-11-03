import type { DecodedPixelImage } from '../assets/images.ts';
import { UDIM_COLUMNS, UDIM_ROWS, udimLayerIndex } from '../assets/udim.ts';
import type { WgslBinding } from '../compiler/wgsl.ts';

/** Shared raster/compute upload; UDIM indices are integer textures, never sRGB. */
export function uploadMaterialImage(
  device: GPUDevice,
  image: DecodedPixelImage | undefined,
  format: GPUTextureFormat,
  textureKind?: WgslBinding['textureKind'],
): GPUTexture {
  if (textureKind && !image?.udim?.length) throw new Error('UDIM texture requires decoded tiles.');
  const isIndex = textureKind === 'udim-index';
  const layers = textureKind === 'udim' ? image!.udim!.length : 1;
  const width = isIndex ? UDIM_COLUMNS : image?.width ?? 1;
  const height = isIndex ? UDIM_ROWS : image?.height ?? 1;
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
      const images = textureKind === 'udim' ? image!.udim!.map(tile => tile.image) : [image];
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
