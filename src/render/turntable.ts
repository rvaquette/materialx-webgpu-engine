import { multiply4, rotationAxis4, type Mat4 } from '../scene/transforms.ts';

export type TurntableTarget = 'object' | 'light';

/** Objects spin around their world-space origin; lights orbit the world origin. */
export function turntableTransform(base: Mat4, target: TurntableTarget, degrees: number): Mat4 {
  const result = [...multiply4(rotationAxis4(1, degrees), base)];
  if (target === 'object') {
    result[12] = base[12]!;
    result[13] = base[13]!;
    result[14] = base[14]!;
  }
  return result;
}

export async function captureTurntable(options: {
  frames: number;
  angle: number;
  signal: AbortSignal;
  apply: (degrees: number) => void;
  capture: () => Promise<Uint8Array>;
  restore: () => void;
  progress: (completed: number, total: number) => void;
}): Promise<Record<string, Uint8Array>> {
  const { frames, angle, signal, apply, capture, restore, progress } = options;
  if (!Number.isInteger(frames) || frames < 1 || frames > 36 || !Number.isFinite(angle)) {
    throw new RangeError('Turntable : angle invalide ou nombre d’images hors de 1 à 36.');
  }
  const images: Record<string, Uint8Array> = {};
  try {
    for (let i = 0; i < frames; i++) {
      signal.throwIfAborted();
      apply(angle + 360 * i / frames);
      progress(i, frames);
      const image = await capture();
      signal.throwIfAborted();
      images[`turntable_${String(i + 1).padStart(3, '0')}.png`] = image;
      progress(i + 1, frames);
    }
    return images;
  } finally {
    restore();
  }
}
