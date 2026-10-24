import { describe, expect, it } from 'vitest';
import { emitWgsl } from '../../src/compiler/wgsl.ts';
import { buildWorleyIr, WORLEY_ORACLES } from '../fixtures/worley-cases.ts';

describe('MaterialX Worley lowering', () => {
  for (const { dims } of WORLEY_ORACLES) {
    for (const channels of [1, 2, 3] as const) {
      it(`wires solid style and ${channels} output channels in ${dims}D`, () => {
        const code = emitWgsl(buildWorleyIr(dims, channels, 1)).code;
        const style = code.match(/let (e\d+) = 1;/)?.[1];
        expect(style).toBeDefined();
        expect(code).toContain(`, ${dims}, i32(${style}), ${channels})`);
        expect(code).toContain('if (style == 1)');
        expect(code).toContain('if (channels == 1)');
        expect(code).toContain('mx_unified_hash(nearest, dims)');
        expect(code).toContain('mx_worley_cell_color(nearest, dims)');
        expect(code.split('fn mx_noise_final(')).toHaveLength(2);
        expect(code).not.toContain('fn mx_hash_u32(');
      });
    }

    it(`defaults to distance style in ${dims}D`, () => {
      const code = emitWgsl(buildWorleyIr(dims, 3)).code;
      expect(code).toContain(`, ${dims}, i32(0), 3)`);
      expect(code).toContain('return sqrt(d);');
      expect(code).toContain('d = vec3f(dist, d.x, d.y);');
      expect(code).toContain('d = vec3f(d.x, dist, d.y);');
      expect(code).toContain('nearest = vec3i(floor(cellpos + fl));');
    });
  }
});
