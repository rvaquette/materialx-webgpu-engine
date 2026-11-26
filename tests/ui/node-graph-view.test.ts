import { describe, expect, it } from 'vitest';
import { fitGraphPreviewImage } from '../../src/ui/node-graph-view.ts';

describe('node graph preview images', () => {
  it('preserves the captured aspect ratio and centers the image in the preview area', () => {
    const fitted = fitGraphPreviewImage(160, 120, 164, 68);

    expect(fitted.width / fitted.height).toBeCloseTo(160 / 120);
    expect(fitted.height).toBe(68);
    expect(fitted.x).toBeGreaterThan(0);
    expect(fitted.x + fitted.width).toBeLessThanOrEqual(164);
    expect(fitted.y).toBe(0);
  });
});
