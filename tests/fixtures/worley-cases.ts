import { IrModuleBuilder, FLOAT, INT, vector, type IrRef } from '../../src/compiler/ir.ts';

// Values from MaterialX mx_noise.glsl at (0.3, 0.7, 0.2), jitter 0.65.
export const WORLEY_ORACLES = [
  { dims: 2, distances: [0.4873181251, 0.6514539560, 0.9608424696], scalar: 0.8603127584, color: [0.6110676517, 0.1858237819, 0.0413060666] },
  { dims: 3, distances: [0.3735703228, 0.8790154592, 0.9405814319], scalar: 0.6110676517, color: [0.1115729688, 0.3250998890, 0.3399472726] },
] as const;

export function buildWorleyIr(dims: 2 | 3, channels: 1 | 2 | 3, style?: 0 | 1) {
  const b = new IrModuleBuilder();
  const type = channels === 1 ? FLOAT : vector(channels, 'float');
  const namedArgs: Record<string, IrRef> = {
    [dims === 2 ? 'texcoord' : 'position']: b.constant(vector(dims, 'float'), dims === 2 ? [0.3, 0.7] : [0.3, 0.7, 0.2]),
    jitter: b.constant(FLOAT, 0.65),
  };
  if (style !== undefined) namedArgs.style = b.constant(INT, style);
  const ref = b.add({ kind: 'call', type, op: `worleynoise${dims}d`, args: [], namedArgs });
  b.output({ name: 'out', type, ref });
  return b.build();
}
