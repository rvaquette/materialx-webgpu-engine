import { describe, expect, it } from 'vitest';
import { FLOAT, INT, IrModuleBuilder, vector } from '../../src/compiler/ir.ts';
import { evaluateShaderIr } from '../../src/compiler/ir-eval.ts';
import { emitWgsl } from '../../src/compiler/wgsl.ts';
import { buildWorleyIr, WORLEY_ORACLES } from '../fixtures/worley-cases.ts';

describe('MaterialX Worley lowering', () => {
  for (const { dims, distances, scalar, color } of WORLEY_ORACLES) {
    for (const channels of [1, 2, 3] as const) {
      for (const style of [0, 1] as const) {
        it(`evaluates the ${dims}D ${channels}-channel ${style === 0 ? 'distance' : 'solid'} oracle`, () => {
          const actual = evaluateShaderIr(buildWorleyIr(dims, channels, style)).get('out')!;
          const expected = style === 0 ? distances.slice(0, channels)
            : channels === 1 ? [scalar] : color.slice(0, channels);
          expect(actual).toHaveLength(channels);
          actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index]!, 6));
        });
      }

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

    it(`uses regularly centered ${dims}D cells when jitter is zero`, () => {
      const builder = new IrModuleBuilder();
      const coordinate = builder.constant(vector(dims, 'float'), dims === 2 ? [0.3, 0.7] : [0.3, 0.7, 0.2]);
      const jitter = builder.constant(FLOAT, 0);
      const type = vector(3, 'float');
      const ref = builder.add({
        kind: 'call', type, op: `worleynoise${dims}d`, args: [],
        namedArgs: { [dims === 2 ? 'texcoord' : 'position']: coordinate, jitter },
      });
      builder.output({ name: 'out', type, ref });
      const expected = dims === 2 ? [Math.sqrt(0.08), Math.sqrt(0.68), Math.sqrt(0.68)]
        : [Math.sqrt(0.17), Math.sqrt(0.57), Math.sqrt(0.77)];
      const actual = evaluateShaderIr(builder.build()).get('out')!;
      actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index]!, 6));
    });

    it(`honors positional ${dims}D coordinates, jitter, and style on CPU and GPU`, () => {
      const builder = new IrModuleBuilder();
      const coordinate = builder.constant(vector(dims, 'float'), dims === 2 ? [0.3, 0.7] : [0.3, 0.7, 0.2]);
      const jitter = builder.constant(FLOAT, 0.65);
      const style = builder.constant(INT, 1);
      const ref = builder.add({ kind: 'call', type: FLOAT, op: `worleynoise${dims}d`, args: [coordinate, jitter, style] });
      builder.output({ name: 'out', type: FLOAT, ref });
      const ir = builder.build();
      expect(evaluateShaderIr(ir).get('out')![0]).toBeCloseTo(scalar, 6);
      const code = emitWgsl(ir).code;
      const styleName = code.match(/let (e\d+) = 1;/)?.[1];
      expect(styleName).toBeDefined();
      expect(code).toContain(`, ${dims}, i32(${styleName}), 1)`);
      expect(code).toContain(dims === 2 ? 'mx_worley(vec3f(e0, 0.0), e1' : 'mx_worley(e0, e1');
    });
  }
});
