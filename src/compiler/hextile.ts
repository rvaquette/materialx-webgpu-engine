import { FLOAT, IrModuleBuilder, vector, type IrRef, type IrType } from './ir.ts';

export interface HexTileInputs {
  texcoord: IrRef;
  tiling: IrRef;
  rotation: IrRef;
  rotationrange: IrRef;
  scale: IrRef;
  scalerange: IrRef;
  offset: IrRef;
  offsetrange: IrRef;
  falloff: IrRef;
  falloffcontrast: IrRef;
  lumacoeffs: IrRef;
}

/** Expand the MaterialX hexagonal image algorithm into shared CPU/raster/PT IR. */
export function lowerHexTiledImage(
  builder: IrModuleBuilder,
  type: IrType,
  inputs: HexTileInputs,
  sample: (uv: IrRef) => IrRef,
): IrRef {
  const v2 = vector(2);
  const v3 = vector(3);
  const scalar = (value: number): IrRef => builder.constant(FLOAT, value);
  const call = (op: string, out: IrType, namedArgs: Record<string, IrRef>): IrRef =>
    builder.add({ kind: 'call', type: out, op, args: [], namedArgs });
  const component = (source: IrRef, pattern: string): IrRef =>
    builder.add({ kind: 'swizzle', type: FLOAT, source, pattern });
  const pair = (x: IrRef, y: IrRef): IrRef => call('combine2', v2, { in1: x, in2: y });
  const triple = (x: IrRef, y: IrRef, z: IrRef): IrRef => call('combine3', v3, { in1: x, in2: y, in3: z });
  const binary = (op: string, a: IrRef, b: IrRef, out: IrType = FLOAT): IrRef =>
    call(op, out, { in1: a, in2: b });
  const add = (a: IrRef, b: IrRef, out?: IrType): IrRef => binary('add', a, b, out);
  const sub = (a: IrRef, b: IrRef, out?: IrType): IrRef => binary('subtract', a, b, out);
  const mul = (a: IrRef, b: IrRef, out?: IrType): IrRef => binary('multiply', a, b, out);
  const div = (a: IrRef, b: IrRef, out?: IrType): IrRef => binary('divide', a, b, out);
  const unary = (op: string, value: IrRef, out: IrType = FLOAT): IrRef => call(op, out, { in: value });
  const mix = (a: IrRef, b: IrRef, weight: IrRef, out: IrType = FLOAT): IrRef =>
    call('mix', out, { bg: a, fg: b, mix: weight });
  const splat = (value: IrRef, out: IrType): IrRef =>
    builder.add({ kind: 'convert', type: out, source: value, from: FLOAT });
  const zero = scalar(0);
  const one = scalar(1);
  const coord = add(
    mul(mul(inputs.texcoord, inputs.tiling, v2), builder.constant(v2, [1, -1]), v2),
    builder.constant(v2, [0, 1]), v2,
  );
  const x = component(coord, 'x');
  const y = component(coord, 'y');
  const root12 = scalar(Math.sqrt(3) * 2);
  const skewed = pair(mul(sub(x, mul(scalar(0.57735027), y)), root12), mul(mul(y, scalar(1.15470054)), root12));
  const fraction = unary('fract', skewed, v2);
  const fx = component(fraction, 'x');
  const fy = component(fraction, 'y');
  const z = sub(sub(one, fx), fy);
  const upper = call('ifgreatereq', FLOAT, { value1: zero, value2: z, in1: one, in2: zero });
  const sign = sub(mul(scalar(2), upper), one);
  const weights = [mul(sub(zero, z), sign), sub(upper, mul(fy, sign)), sub(upper, mul(fx, sign))];
  const base = unary('floor', skewed, v2);
  const other = sub(one, upper);
  const ids = [pair(upper, upper), pair(upper, other), pair(other, upper)].map((delta) => add(base, delta, v2));

  const samples: IrRef[] = [];
  for (const id of ids) {
    const ix = component(id, 'x');
    const iy = component(id, 'y');
    const center = pair(div(add(ix, mul(scalar(0.5), iy)), root12), div(iy, mul(scalar(1.15470054), root12)));
    const seed = add(id, builder.constant(v2, [0.12345, 0.12345]), v2);
    const seedX = component(seed, 'x');
    const seedY = component(seed, 'y');
    const p = unary('fract', mul(triple(seedX, seedY, seedX), builder.constant(v3, [0.1031, 0.103, 0.0973]), v3), v3);
    const permuted = builder.add({ kind: 'swizzle', type: v3, source: p, pattern: 'yzx' });
    const d = binary('dotproduct', p, add(permuted, builder.constant(v3, [33.33, 33.33, 33.33]), v3));
    const hashed = add(p, splat(d, v3), v3);
    const hx = component(hashed, 'x');
    const hy = component(hashed, 'y');
    const hz = component(hashed, 'z');
    const rand = unary('fract', pair(mul(add(hx, hy), hz), mul(add(hx, hz), hy)), v2);
    const rx = component(rand, 'x');
    const ry = component(rand, 'y');

    // Rotation ranges are degrees; rotation is the randomization amount, not an angle.
    const angle = mul(mix(component(inputs.rotationrange, 'x'), component(inputs.rotationrange, 'y'), mul(rx, inputs.rotation)), scalar(Math.PI / 180));
    const sine = unary('sin', angle);
    const cosine = unary('cos', angle);
    const local = sub(coord, center, v2);
    const lx = component(local, 'x');
    const ly = component(local, 'y');
    const rotated = pair(sub(mul(lx, cosine), mul(ly, sine)), add(mul(lx, sine), mul(ly, cosine)));
    const scale = mix(one, mix(component(inputs.scalerange, 'x'), component(inputs.scalerange, 'y'), ry), inputs.scale);
    const offsetMin = component(inputs.offsetrange, 'x');
    const offsetMax = component(inputs.offsetrange, 'y');
    const offset = pair(mix(offsetMin, offsetMax, mul(rx, inputs.offset)), mix(offsetMin, offsetMax, mul(ry, inputs.offset)));
    samples.push(sample(add(add(div(rotated, splat(scale, v2), v2), center, v2), offset, v2)));
  }

  const blendWeights = (luminance: readonly IrRef[]): IrRef[] => {
    const raw = weights.map((weight, i) => mul(luminance[i]!, binary('power', weight, scalar(7))));
    const sum = (values: readonly IrRef[]): IrRef => add(add(values[0]!, values[1]!), values[2]!);
    const total = sum(raw);
    const normalized = raw.map((weight) => div(weight, total));
    const gain = call('clamp', FLOAT, { in: inputs.falloff, low: scalar(0.001), high: scalar(0.999) });
    const adjusted = normalized.map((weight) => {
      const a = mul(sub(div(one, gain), scalar(2)), sub(one, mul(scalar(2), weight)));
      return call('ifgreater', FLOAT, {
        value1: scalar(0.5), value2: weight,
        in1: div(weight, add(a, one)), in2: div(sub(a, weight), sub(a, one)),
      });
    });
    const adjustedTotal = sum(adjusted);
    return adjusted.map((weight) => div(weight, adjustedTotal));
  };
  const luminance = samples.map((color) => {
    const rgb = type.kind === 'vector' && type.size === 4
      ? builder.add({ kind: 'swizzle', type: v3, source: color, pattern: 'xyz' })
      : color;
    return mix(one, binary('dotproduct', rgb, inputs.lumacoeffs), inputs.falloffcontrast);
  });
  const colorWeights = blendWeights(luminance);
  const blend = (values: readonly IrRef[], w: readonly IrRef[], out: IrType): IrRef => {
    const weighted = values.map((color, i) => mul(color, splat(w[i]!, out), out));
    return add(add(weighted[0]!, weighted[1]!, out), weighted[2]!, out);
  };
  if (type.kind === 'vector' && type.size === 4) {
    const rgb = blend(samples.map((color) => builder.add({ kind: 'swizzle', type: v3, source: color, pattern: 'xyz' })), colorWeights, v3);
    const alphaWeights = blendWeights([one, one, one]);
    const alpha = samples.map((color, i) => mul(component(color, 'w'), alphaWeights[i]!));
    return call('combine4', type, { in1: component(rgb, 'x'), in2: component(rgb, 'y'), in3: component(rgb, 'z'), in4: add(add(alpha[0]!, alpha[1]!), alpha[2]!) });
  }
  return blend(samples, colorWeights, type);
}
