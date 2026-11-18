import { withGpuValidation } from './device.ts';

export interface RgbaCapture {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
}

export const rgbaCaptureStride = (width: number): number => Math.ceil(width * 4 / 256) * 256;

export async function captureRgba(
  device: GPUDevice, width: number, height: number,
  render: { raster(target: GPUTextureView): void } | { pathTrace(target: GPUTextureView): Promise<void> },
  check: () => void,
): Promise<RgbaCapture> {
  const bytesPerRow = rgbaCaptureStride(width);
  let texture: GPUTexture | undefined;
  let buffer: GPUBuffer | undefined;
  let mapped = false;
  try {
    await withGpuValidation(device, () => {
      texture = device.createTexture({
        size: [width, height], format: 'rgba8unorm',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
      });
      buffer = device.createBuffer({ size: bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    });
    check();
    if (!texture || !buffer) throw new Error('WebGPU capture targets were not allocated.');
    const output = texture;
    const readback = buffer;
    if ('pathTrace' in render) await render.pathTrace(output.createView());
    check();
    await withGpuValidation(device, () => {
      if ('raster' in render) render.raster(output.createView());
      const encoder = device.createCommandEncoder();
      encoder.copyTextureToBuffer({ texture: output }, { buffer: readback, bytesPerRow }, [width, height]);
      device.queue.submit([encoder.finish()]);
    });
    await readback.mapAsync(GPUMapMode.READ);
    mapped = true;
    check();
    const padded = new Uint8Array(readback.getMappedRange());
    const rowBytes = width * 4;
    const rgba = new Uint8Array(rowBytes * height);
    for (let y = 0; y < height; y++) {
      const offset = y * bytesPerRow;
      rgba.set(padded.subarray(offset, offset + rowBytes), y * rowBytes);
    }
    return { width, height, rgba };
  } finally {
    if (mapped) buffer?.unmap();
    buffer?.destroy();
    texture?.destroy();
  }
}
