import type { ResolvedVolume } from '../materialx/volume-graph.ts';
import { IrModuleBuilder, FLOAT, vector, shaderType, type IrRef, type ShaderIr } from './ir.ts';
import { evaluateIrRef, type IrEvalVaryings } from './ir-eval.ts';

export interface VolumeMedium {
  absorption: readonly [number, number, number];
  scattering: readonly [number, number, number];
  anisotropy: number;
}

/** Homogeneous coefficients only: never bake a spatial input to a neutral value. */
export function lowerVolumeInputsToIr(volume: ResolvedVolume, builder: IrModuleBuilder): Record<string, IrRef> {
  const inputs: Record<string, IrRef> = {};
  for (const [name, input] of volume.inputs) {
    if (input.source.kind === 'connection') {
      throw new Error(`Spatial/procedural volume input '${name}' is not supported yet.`);
    }
    const value = input.source.value;
    if (value.some(n => !Number.isFinite(n)) ||
        (name === 'anisotropy' ? Math.abs(value[0]!) >= 1 : value.some(n => n < 0))) {
      throw new Error(`Invalid volume coefficient '${name}'.`);
    }
    inputs[name] = builder.constant(
      input.type === 'float' ? FLOAT : vector(3),
      input.type === 'float' ? value[0]! : value,
    );
  }
  return inputs;
}

export function appendVolumeIr(volume: ResolvedVolume, builder: IrModuleBuilder): void {
  const params = lowerVolumeInputsToIr(volume, builder);
  const ref = builder.add({
    kind: 'closure', type: shaderType('volume'), closure: 'vdf', op: 'anisotropic_vdf', params,
  });
  builder.output({ name: 'volumeshader', type: shaderType('volume'), ref });
}

export function evaluateVolumeIr(ir: ShaderIr, varyings: IrEvalVaryings = {}): VolumeMedium {
  const output = ir.outputs.find(o => o.name === 'volumeshader');
  const closure = output ? ir.exprs.get(output.ref) : undefined;
  if (closure?.kind !== 'closure' || closure.closure !== 'vdf') {
    throw new Error('Missing volume closure in compiled IR.');
  }
  const value = (name: string): readonly number[] => {
    const ref = closure.params[name];
    if (!ref) throw new Error(`Missing compiled volume input '${name}'.`);
    return evaluateIrRef(ir, ref, varyings);
  };
  const rgb = (name: string): readonly [number, number, number] => {
    const v = value(name);
    if (v.length !== 3 || v.some(n => !Number.isFinite(n) || n < 0)) {
      throw new Error(`Invalid compiled volume input '${name}'.`);
    }
    return [v[0]!, v[1]!, v[2]!];
  };
  const g = value('anisotropy')[0];
  if (g === undefined || !Number.isFinite(g) || Math.abs(g) >= 1) {
    throw new Error('Invalid compiled volume anisotropy.');
  }
  return { absorption: rgb('absorption'), scattering: rgb('scattering'), anisotropy: g };
}
