import { downloadBlob } from '../assets/download.ts';
import type { PathTraceAovData, PathTraceView } from './pathtracing/display.ts';

export type ExportablePathTraceView = Exclude<PathTraceView, 'beauty'>;

function sceneName(sceneEntry: string): string {
  return sceneEntry
    .replace(/[?#].*$/, '')
    .split(/[\\/]/)
    .at(-1)
    ?.replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'scene';
}

export function encodePathTraceAovPfm(image: PathTraceAovData): Uint8Array {
  const { width, height, channels, values } = image;
  if (!Number.isSafeInteger(width) || width < 1 || !Number.isSafeInteger(height) || height < 1 ||
      (channels !== 1 && channels !== 3) || values.length !== width * height * channels) {
    throw new RangeError('Invalid path-tracing AOV image for PFM export.');
  }
  const header = new TextEncoder().encode(`${channels === 1 ? 'Pf' : 'PF'}\n${width} ${height}\n-1.0\n`);
  const bytes = new Uint8Array(header.length + values.length * Float32Array.BYTES_PER_ELEMENT);
  bytes.set(header);
  const output = new DataView(bytes.buffer);
  for (let y = 0; y < height; y++) {
    const sourceRow = (height - 1 - y) * width;
    for (let x = 0; x < width; x++) {
      const sourceIndex = (sourceRow + x) * channels;
      const outputIndex = header.length + (y * width + x) * channels * Float32Array.BYTES_PER_ELEMENT;
      for (let channel = 0; channel < channels; channel++) {
        output.setFloat32(outputIndex + channel * Float32Array.BYTES_PER_ELEMENT, values[sourceIndex + channel]!, true);
      }
    }
  }
  return bytes;
}

export async function downloadDisplayedAovPng(
  canvas: HTMLCanvasElement, sceneEntry: string, view: ExportablePathTraceView,
): Promise<void> {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(value => value
      ? resolve(value)
      : reject(new Error('The browser could not encode the selected AOV as PNG.')), 'image/png');
  });
  downloadBlob(blob, `${sceneName(sceneEntry)}_${view}_${canvas.width}x${canvas.height}.png`);
}

export async function downloadPathTraceAovPfm(
  sceneEntry: string, view: ExportablePathTraceView, image: PathTraceAovData,
): Promise<void> {
  const bytes = encodePathTraceAovPfm(image);
  const blob = new Blob([bytes], { type: 'image/x-portable-floatmap' });
  downloadBlob(blob, `${sceneName(sceneEntry)}_${view}_${image.width}x${image.height}.pfm`);
}
