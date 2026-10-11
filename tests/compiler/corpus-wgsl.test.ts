import { describe, it, expect } from 'vitest';
import { NODE_CASES, type NodeCase } from '../fixtures/node-cases.ts';
import {
  IrModuleBuilder,
  FLOAT,
  INT,
  COLOR3,
  COLOR4,
  vector,
  closureType,
  shaderType,
  type IrType,
  type IrRef,
} from '../../src/compiler/ir.ts';
import { emitWgsl, WgslEmitError } from '../../src/compiler/wgsl.ts';

const irTypeByLen = (n: number): IrType =>
  n === 1 ? FLOAT : n === 2 ? vector(2, 'float') : n === 3 ? COLOR3 : COLOR4;
const irTypeByOut = (out: NonNullable<NodeCase['out']>): IrType =>
  out === 'f32' ? FLOAT : out === 'vec2f' ? vector(2, 'float') : out === 'vec3f' ? COLOR3 : COLOR4;

function buildExprIr(b: IrModuleBuilder, c: NodeCase): IrRef {
  const args: IrRef[] = c.inputs.map((v, i) => {
    if (c.category === 'extract' && i === 1) return b.constant(INT, v[0]!);
    const t = irTypeByLen(v.length);
    return b.constant(t, v.length === 1 ? v[0]! : [...v]);
  });
  return b.add({ kind: 'call', type: irTypeByOut(c.out!), op: c.category, args });
}
function buildTextureIr(b: IrModuleBuilder): IrRef {
  b.declareTexture({ name: 'tex', valueType: COLOR3 });
  b.declareSampler({ name: 'samp' });
  const uv = b.add({ kind: 'primvar', type: vector(2, 'float', 'texcoord'), name: 'st' });
  return b.add({ kind: 'texture', type: COLOR3, texture: 'tex', uv, sampler: 'samp' });
}
function buildClosureIr(b: IrModuleBuilder, c: NodeCase): IrRef {
  if (c.category === 'surface') {
    const opacity = b.constant(FLOAT, 1);
    return b.add({ kind: 'closure', type: shaderType('surface'), closure: 'bsdf', op: 'surface', params: { opacity } });
  }
  const weight = b.constant(FLOAT, 0.8);
  const tint = b.constant(COLOR3, [0.6, 0.3, 0.1]);
  const roughness = b.constant(vector(2, 'float'), [0.1, 0.2]);
  return b.add({ kind: 'closure', type: closureType('bsdf'), closure: 'bsdf', op: c.category, params: { weight, tint, roughness } });
}

// Substring the lowering of each node must inject into the emitted WGSL body.
const EXPECTED_TOKEN: Readonly<Record<string, string>> = {
  add: ' + ',
  subtract: ' - ',
  multiply: ' * ',
  divide: ' / ',
  power: 'pow(',
  max: 'max(',
  clamp: 'clamp(',
  sin: 'sin(',
  dotproduct: 'dot(',
  mix: 'mix(',
  extract: '[',
  combine3: 'vec3f(',
  constant: 'vec3f(0.2, 0.5, 0.8)',
  rgbtohsv: 'mx_rgbtohsv(',
  hsvtorgb: 'mx_hsvtorgb(',
  position: 'vary.position',
  texcoord: 'vary.texcoord',
  normalmap: 'mx_normalmap(',
  fractal3d: 'mx_fractal3d(',
  chiang_hair_absorption_from_color: 'mx_chiang_hair_absorption_from_color(',
  chiang_hair_roughness: 'mx_chiang_hair_roughness(',
  deon_hair_absorption_from_melanin: 'mx_deon_hair_absorption_from_melanin(',
  image: 'textureSample(',
  tiledimage: 'textureSample(',
  hextiledimage: 'textureSample(',
  chiang_hair_bsdf: 'mx_chiang_hair_bsdf(',
  surface: 'mx_surface(',
};

// Prelude function definition expected when the node pulls in a helper.
const EXPECTED_PRELUDE: Readonly<Record<string, string>> = {
  rgbtohsv: 'fn mx_rgbtohsv(',
  hsvtorgb: 'fn mx_hsvtorgb(',
  normalmap: 'fn mx_normalmap(',
  fractal3d: 'fn mx_fractal3d(',
  chiang_hair_absorption_from_color: 'fn mx_chiang_hair_absorption_from_color(',
  chiang_hair_roughness: 'fn mx_chiang_hair_roughness(',
  deon_hair_absorption_from_melanin: 'fn mx_deon_hair_absorption_from_melanin(',
};

function countChar(s: string, c: string): number {
  let n = 0;
  for (const ch of s) if (ch === c) n++;
  return n;
}

function wgslOutType(c: NodeCase): string {
  if (c.exec === 'closure') return 'Closure';
  if (c.exec === 'texture') return 'vec3f';
  return c.out!;
}

describe('corpus WGSL lowering', () => {
  const runnable = NODE_CASES.filter((c) => c.exec === 'expr' || c.exec === 'texture' || c.exec === 'closure');

  for (const c of runnable) {
    it(`emits a structurally valid module for ${c.category}`, () => {
      const b = new IrModuleBuilder();
      const ref =
        c.exec === 'texture' ? buildTextureIr(b) : c.exec === 'closure' ? buildClosureIr(b, c) : buildExprIr(b, c);
      const outType = b.get(ref)!.type;
      b.output({ name: 'out', type: outType, ref });

      const mod = emitWgsl(b.build());

      // Shape of the module interface.
      expect(mod.entryPoint).toBe('mx_shade');
      expect(mod.outputs).toHaveLength(1);
      expect(mod.outputs[0]!.wgslType).toBe(wgslOutType(c));

      // Structural anchors always present.
      expect(mod.code).toContain('struct Closure');
      expect(mod.code).toContain('struct MxVaryings');
      expect(mod.code).toContain('struct MxOutputs');
      expect(mod.code).toContain('fn mx_shade(vary: MxVaryings) -> MxOutputs');
      expect(mod.code).toContain(`result.${mod.outputs[0]!.field} = ${ref};`);
      expect(mod.code).toContain('return result;');

      // Balanced braces and parentheses.
      expect(countChar(mod.code, '{')).toBe(countChar(mod.code, '}'));
      expect(countChar(mod.code, '(')).toBe(countChar(mod.code, ')'));

      // The node's own lowering actually reached the body, not just a compile.
      const token = EXPECTED_TOKEN[c.category];
      expect(token, `no expected token for ${c.category}`).toBeDefined();
      expect(mod.code).toContain(token!);
      const prelude = EXPECTED_PRELUDE[c.category];
      if (prelude) expect(mod.code).toContain(prelude);
    });
  }
});

describe('corpus WGSL bindings', () => {
  it('emits a uniform block for editable params', () => {
    const b = new IrModuleBuilder();
    b.declareParam({ name: 'gain', type: FLOAT, editable: true });
    const p = b.add({ kind: 'param', type: FLOAT, name: 'gain' });
    const c = b.constant(FLOAT, 2);
    const out = b.add({ kind: 'call', type: FLOAT, op: 'multiply', args: [p, c] });
    b.output({ name: 'out', type: FLOAT, ref: out });

    const mod = emitWgsl(b.build());
    expect(mod.uniforms.map((u) => u.name)).toContain('gain');
    expect(mod.code).toContain('struct MxUniforms');
    expect(mod.code).toContain('@group(0) @binding(0) var<uniform> u: MxUniforms;');
    expect(mod.code).toContain('u.gain');
  });

  it('emits texture and sampler bindings at their declared groups', () => {
    const b = new IrModuleBuilder();
    const ref = buildTextureIr(b);
    b.output({ name: 'out', type: COLOR3, ref });

    const mod = emitWgsl(b.build());
    expect(mod.textures).toEqual([{ name: 'tex', handle: 'tex_tex', group: 1, binding: 0 }]);
    expect(mod.samplers).toEqual([{ name: 'samp', handle: 'samp_samp', group: 2, binding: 0 }]);
    expect(mod.code).toContain('@group(1) @binding(0) var tex_tex: texture_2d<f32>;');
    expect(mod.code).toContain('@group(2) @binding(0) var samp_samp: sampler;');
  });

  it('rejects an unknown node category instead of emitting invalid WGSL', () => {
    const b = new IrModuleBuilder();
    const a = b.constant(FLOAT, 1);
    const out = b.add({ kind: 'call', type: FLOAT, op: 'not_a_real_node', args: [a] });
    b.output({ name: 'out', type: FLOAT, ref: out });
    expect(() => emitWgsl(b.build())).toThrow(WgslEmitError);
  });
});
