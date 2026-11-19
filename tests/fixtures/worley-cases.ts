import { IrModuleBuilder, FLOAT, INT, vector, type IrRef } from '../../src/compiler/ir.ts';

// Values from MaterialX mx_noise.glsl at (0.3, 0.7, 0.2), jitter 0.65.
export const WORLEY_ORACLES = [
  { dims: 2, distances: [0.4873181251, 0.6514539560, 0.9608424696], scalar: 0.8603127584, color: [0.6110676517, 0.1858237819, 0.0413060666] },
  { dims: 3, distances: [0.3735703228, 0.8790154592, 0.9405814319], scalar: 0.6110676517, color: [0.1115729688, 0.3250998890, 0.3399472726] },
] as const;

// Read back from MaterialX mx_noise.glsl for negative coordinates and jitter above one.
export const WORLEY_EDGE_ORACLES = [
  { dims: 2, coordinate: [-3.25, 4.125], jitter: 1, distances: [0.64683318, 0.69411075, 0.8527264], scalar: 0.77878547, color: [0.47220957, 0.70914525, 0.76225436] },
  { dims: 3, coordinate: [-3.25, 4.125, -1.75], jitter: 1, distances: [0.64606774, 0.86576551, 0.96299005], scalar: 0.50044, color: [0.56463522, 0.73652023, 0.34532276] },
  { dims: 2, coordinate: [1.01, -0.02], jitter: 1.4, distances: [0.36345366, 0.43765649, 0.92202723], scalar: 0.86031276, color: [0.61106765, 0.18582378, 0.04130607] },
  { dims: 3, coordinate: [1.01, -0.02, 1.5], jitter: 1.4, distances: [0.15878415, 0.71035129, 1.28937185], scalar: 0.56510055, color: [0.75178707, 0.85497528, 0.49221063] },
] as const;

export function buildWorleyIr(
  dims: 2 | 3, channels: 1 | 2 | 3, style?: 0 | 1,
  options?: { coordinate: readonly number[]; jitter: number },
) {
  const b = new IrModuleBuilder();
  const type = channels === 1 ? FLOAT : vector(channels, 'float');
  const namedArgs: Record<string, IrRef> = {
    [dims === 2 ? 'texcoord' : 'position']: b.constant(vector(dims, 'float'),
      options ? [...options.coordinate] : dims === 2 ? [0.3, 0.7] : [0.3, 0.7, 0.2]),
    jitter: b.constant(FLOAT, options?.jitter ?? 0.65),
  };
  if (style !== undefined) namedArgs.style = b.constant(INT, style);
  const ref = b.add({ kind: 'call', type, op: `worleynoise${dims}d`, args: [], namedArgs });
  b.output({ name: 'out', type, ref });
  return b.build();
}
