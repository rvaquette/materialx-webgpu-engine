import { describe, expect, it } from 'vitest';
import { lowerHexTiledImage, type HexTileInputs } from '../../src/compiler/hextile.ts';
import { COLOR3, COLOR4, FLOAT, IrModuleBuilder, vector, type IrRef } from '../../src/compiler/ir.ts';
import { evaluateShaderIr } from '../../src/compiler/ir-eval.ts';
import { lowerExprs } from '../../src/compiler/wgsl.ts';

interface Params {
  tiling: number[];
  rotation: number;
  rotationrange: number[];
  scale: number;
  scalerange: number[];
  offset: number;
  offsetrange: number[];
  falloff: number;
  falloffcontrast: number;
  lumacoeffs: number[];
}

const DEFAULTS: Params = {
  tiling: [1, 1], rotation: 1, rotationrange: [0, 360],
  scale: 1, scalerange: [0.5, 2], offset: 1, offsetrange: [0, 1],
  falloff: 0.5, falloffcontrast: 0.5, lumacoeffs: [0.2722287, 0.6740818, 0.0536895],
};
const texture = (u: number, v: number): number[] => [
  0.5 + 0.3 * Math.sin(u * 5), 0.5 + 0.3 * Math.cos(v * 7),
  0.5 + 0.2 * Math.sin((u + v) * 3), 0.5 + 0.4 * Math.cos(u - v),
];

function reference(uv: number[], p: Params): number[] {
  const coord = [uv[0]! * p.tiling[0]!, 1 - uv[1]! * p.tiling[1]!];
  const root12 = Math.sqrt(12);
  const skew = [(coord[0]! - 0.57735027 * coord[1]!) * root12, coord[1]! * 1.15470054 * root12];
  const base = skew.map(Math.floor);
  const f = skew.map((v) => v - Math.floor(v));
  const z = 1 - f[0]! - f[1]!;
  const upper = z <= 0 ? 1 : 0;
  const sign = upper * 2 - 1;
  const weights = [-z * sign, upper - f[1]! * sign, upper - f[0]! * sign];
  const vertices = [[upper, upper], [upper, 1 - upper], [1 - upper, upper]];
  const samples = vertices.map((vertex) => {
    const id = vertex.map((v, i) => v + base[i]!);
    const seed = id.map((v) => v + 0.12345);
    const hash = [seed[0]! * 0.1031, seed[1]! * 0.103, seed[0]! * 0.0973].map((v) => v - Math.floor(v));
    const d = hash.reduce((sum, v, i) => sum + v * (hash[(i + 1) % 3]! + 33.33), 0);
    const [a, b, c] = hash.map((v) => v + d);
    const rand = [(a! + b!) * c!, (a! + c!) * b!].map((v) => v - Math.floor(v));
    const angle = (p.rotationrange[0]! + (p.rotationrange[1]! - p.rotationrange[0]!) * rand[0]! * p.rotation) * Math.PI / 180;
    const scale = 1 + (p.scalerange[0]! + (p.scalerange[1]! - p.scalerange[0]!) * rand[1]! - 1) * p.scale;
    const center = [(id[0]! + id[1]! * 0.5) / root12, id[1]! / (1.15470054 * root12)];
    const x = coord[0]! - center[0]!;
    const y = coord[1]! - center[1]!;
    const rotated = [x * Math.cos(angle) - y * Math.sin(angle), x * Math.sin(angle) + y * Math.cos(angle)];
    const point = rotated.map((v, i) => v / scale + center[i]! + p.offsetrange[0]! + (p.offsetrange[1]! - p.offsetrange[0]!) * rand[i]! * p.offset);
    return texture(point[0]!, point[1]!);
  });
  const blendWeights = (luma: number[]): number[] => {
    const raw = weights.map((w, i) => Math.pow(w, 7) * luma[i]!);
    const sum = raw.reduce((a, b) => a + b, 0);
    const normalized = raw.map((w) => w / sum);
    if (p.falloff === 0.5) return normalized;
    const r = Math.max(0.001, Math.min(0.999, p.falloff));
    const gained = normalized.map((w) => {
      const a = (1 / r - 2) * (1 - 2 * w);
      return w < 0.5 ? w / (a + 1) : (a - w) / (a - 1);
    });
    const total = gained.reduce((a, b) => a + b, 0);
    return gained.map((w) => w / total);
  };
  const colorWeights = blendWeights(samples.map((sample) =>
    1 + (sample.slice(0, 3).reduce((sum, v, i) => sum + v * p.lumacoeffs[i]!, 0) - 1) * p.falloffcontrast));
  const alphaWeights = blendWeights([1, 1, 1]);
  return [0, 1, 2, 3].map((c) => samples.reduce((sum, sample, i) =>
    sum + sample[c]! * (c === 3 ? alphaWeights[i]! : colorWeights[i]!), 0));
}

function build(params: Params, alpha = false) {
  const builder = new IrModuleBuilder();
  const inputs = Object.fromEntries(Object.entries(params).map(([name, value]) => [
    name, Array.isArray(value) ? builder.constant(vector(value.length === 3 ? 3 : 2), value) : builder.constant(FLOAT, value),
  ]));
  const uv = builder.add({ kind: 'input', type: vector(2), name: 'texcoord' });
  const type = alpha ? COLOR4 : COLOR3;
  const refs: HexTileInputs = {
    texcoord: uv, tiling: inputs.tiling!, rotation: inputs.rotation!, rotationrange: inputs.rotationrange!,
    scale: inputs.scale!, scalerange: inputs.scalerange!, offset: inputs.offset!, offsetrange: inputs.offsetrange!,
    falloff: inputs.falloff!, falloffcontrast: inputs.falloffcontrast!, lumacoeffs: inputs.lumacoeffs!,
  };
  builder.declareTexture({ name: 'tex', valueType: type });
  builder.declareSampler({ name: 'tex' });
  const result = lowerHexTiledImage(builder, type, refs, (coord: IrRef) =>
    builder.add({ kind: 'texture', type, texture: 'tex', sampler: 'tex', uv: coord }));
  builder.output({ name: 'color', type, ref: result });
  return builder.build();
}

describe('hexagonal image lowering', () => {
  it.each([
    {},
    { rotation: 0.75 },
    { rotationrange: [-45, 45] },
    { rotation: 0, scale: 0, offset: 0, tiling: [2, 1.5] },
    { rotation: 0, rotationrange: [90, 90], scale: 0, offset: 0 },
    { falloff: 0.1, falloffcontrast: 0.9, lumacoeffs: [1, 0, 0] },
    { falloff: 0.9, falloffcontrast: 0 },
    { scale: 0.35, scalerange: [0.7, 1.4], offset: 0.6, offsetrange: [-0.2, 0.5] },
  ])('matches an independent numeric oracle for %j', (overrides) => {
    const params = { ...DEFAULTS, ...overrides };
    for (const alpha of [false, true]) {
      const ir = build(params, alpha);
      for (const uv of [[0.2, 0.4], [0.8, 0.7], [-0.3, 1.2], [0, 1], [1.5, -0.2]]) {
        const actual = evaluateShaderIr(ir, { texcoord: uv, textures: { tex: texture } }).get('color')!;
        const expected = reference(uv, params).slice(0, alpha ? 4 : 3);
        actual.forEach((v, i) => expect(v).toBeCloseTo(expected[i]!, 8));
      }
    }
  });

  it('changes the sampled color when rotation or its range changes', () => {
    const evaluate = (overrides: Partial<Params>) =>
      evaluateShaderIr(build({ ...DEFAULTS, ...overrides }), { texcoord: [0.2, 0.4], textures: { tex: texture } }).get('color')!;
    const unrotated = evaluate({ rotation: 0 });
    expect(Math.abs(evaluate({ rotation: 0.75 })[0]! - unrotated[0]!)).toBeGreaterThan(0.01);
    expect(Math.abs(evaluate({ rotationrange: [-45, 45] })[0]! - evaluate({})[0]!)).toBeGreaterThan(0.001);
  });

  it('emits three samples of one image for fragment and compute stages', () => {
    const ir = build(DEFAULTS);
    for (const compute of [false, true]) {
      const code = lowerExprs(ir, '', compute).body.join('\n');
      expect(code.match(compute ? /textureSampleLevel\(/g : /textureSample\(/g)).toHaveLength(3);
      expect(code).toContain('sin(');
      expect(code).toContain('cos(');
    }
    expect(ir.textures).toHaveLength(1);
  });
});
