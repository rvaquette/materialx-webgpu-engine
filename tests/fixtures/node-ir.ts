// Shared IR builder for the corpus execution cases (T034a cases -> ShaderIr).
// Reused by the Node composition tests (tests/gpu/exec.test.ts) and the real
// device harness (tests/render/corpus-device.harness.ts) so a single source of
// truth produces the modules we run on the GPU. Texture cases pin an explicit
// LOD 0 so the emitter uses textureSampleLevel, which is valid inside the
// compute entry point (textureSample is fragment-only).

import {
  IrModuleBuilder,
  FLOAT,
  INT,
  COLOR3,
  vector,
  closureType,
  shaderType,
  type IrType,
  type IrRef,
  type ShaderIr,
} from '../../src/compiler/ir.ts';
import type { NodeCase, ClosureLobeCase } from './node-cases.ts';

const irTypeByLen = (n: number): IrType =>
  n === 1 ? FLOAT : n === 2 ? vector(2, 'float') : n === 3 ? COLOR3 : vector(4, 'float');
const irTypeByOut = (out: NonNullable<NodeCase['out']>): IrType =>
  out === 'f32' ? FLOAT : out === 'vec2f' ? vector(2, 'float') : out === 'vec3f' ? COLOR3 : vector(4, 'float');

/** Build a single-leaf ShaderIr for a runnable corpus case (expr/texture/closure). */
export function buildNodeIr(c: NodeCase): ShaderIr {
  const b = new IrModuleBuilder();
  let ref: IrRef;
  let type: IrType;
  if (c.exec === 'texture') {
    b.declareTexture({ name: 'tex', valueType: COLOR3 });
    b.declareSampler({ name: 'samp' });
    const uv = b.add({ kind: 'primvar', type: vector(2, 'float', 'texcoord'), name: 'st' });
    const lod = b.constant(FLOAT, 0);
    ref = b.add({ kind: 'texture', type: COLOR3, texture: 'tex', uv, sampler: 'samp', lod });
    type = COLOR3;
  } else if (c.exec === 'closure') {
    if (c.category === 'surface') {
      const opacity = b.constant(FLOAT, 1);
      ref = b.add({ kind: 'closure', type: shaderType('surface'), closure: 'bsdf', op: 'surface', params: { opacity } });
      type = shaderType('surface');
    } else {
      const weight = b.constant(FLOAT, 0.8);
      const tint = b.constant(COLOR3, [0.6, 0.3, 0.1]);
      const roughness = b.constant(vector(2, 'float'), [0.1, 0.2]);
      ref = b.add({
        kind: 'closure',
        type: closureType('bsdf'),
        closure: 'bsdf',
        op: c.category,
        params: { weight, tint, roughness },
      });
      type = closureType('bsdf');
    }
  } else {
    const args = c.inputs.map((v, i) => {
      if (c.category === 'extract' && i === 1) return b.constant(INT, v[0]!);
      return b.constant(irTypeByLen(v.length), v.length === 1 ? v[0]! : [...v]);
    });
    type = irTypeByOut(c.out!);
    ref = b.add({ kind: 'call', type, op: c.category, args });
  }
  b.output({ name: 'out', type, ref });
  return b.build();
}

/** The corpus cases that run as a single GPU dispatch (expr/texture/closure). */
export function isRunnableOnGpu(c: NodeCase): boolean {
  return c.exec === 'expr' || c.exec === 'texture' || c.exec === 'closure';
}

/** Build a single-leaf closure ShaderIr for a per-lobe case (T042). The named
 * params become inlined constants wired to the lobe's WGSL lowering; the lighting
 * context (for the real BSDF/VDF lobes) is bound by the exec harness. */
export function buildLobeIr(c: ClosureLobeCase): ShaderIr {
  const b = new IrModuleBuilder();
  const params: Record<string, IrRef> = {};
  for (const [name, v] of Object.entries(c.params)) {
    const t = v.length === 1 ? FLOAT : v.length === 2 ? vector(2, 'float') : COLOR3;
    params[name] = b.constant(t, v.length === 1 ? v[0]! : [...v]);
  }
  const type = closureType(c.kind);
  const leaf = b.add({ kind: 'closure', type, closure: c.kind, op: c.category, params });
  b.output({ name: 'out', type, ref: leaf });
  return b.build();
}
