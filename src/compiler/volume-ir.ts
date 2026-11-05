// T055c-volume: lower ResolvedVolume (from volume-graph.ts) to VDF IR expressions.
// Parallel to surface-ir.ts but for volumeshaders. Consumes a ResolvedVolume
// and outputs VDF closure references that the WGSL emitter can compose into
// shader code.

import type { ResolvedVolume } from '../materialx/volume-graph.ts';
import type { IrRef } from '../compiler/ir.ts';
import { IrModuleBuilder, FLOAT, COLOR3 } from '../compiler/ir.ts';

export interface VolumeIrInputs {
  /** Map of input name to IR expression reference. */
  readonly [key: string]: IrRef;
}

/** Lower volumeshader node inputs to IR expressions. Returns a map from
 * input name to IrRef for use by the volume WGSL emitter. */
export function lowerVolumeInputsToIr(
  volume: ResolvedVolume,
  builder: IrModuleBuilder,
): VolumeIrInputs {
  const inputs: { [key: string]: IrRef } = {};

  for (const [name, input] of volume.inputs) {
    let ref: IrRef;

    switch (input.source.kind) {
      case 'value': {
        // Parse literal value
        const value = input.source.value;
        if (!value || (Array.isArray(value) && value.length === 0)) {
          const defaultVal = input.type === 'color3' ? [0, 0, 0] : 0;
          ref = builder.constant(
            input.type === 'color3' ? COLOR3 : FLOAT,
            defaultVal,
          );
        } else {
          const type = name.includes('color') || (Array.isArray(value) && value.length === 3) ? COLOR3 : FLOAT;
          ref = builder.constant(
            type,
            type.kind === 'vector' ? value : (Array.isArray(value) ? value[0] : value),
          );
        }
        break;
      }

      case 'connection': {
        // Resolve upstream node connection
        const nodeId = input.source.nodeId;
        // Will be lowered by the emitter
        ref = nodeId as IrRef; // Placeholder
        break;
      }

      case 'default': {
        // Use default values
        const defaultVal = input.type === 'color3' ? [0, 0, 0] : 0;
        ref = builder.constant(
          input.type === 'color3' ? COLOR3 : FLOAT,
          defaultVal,
        );
        break;
      }
    }

    inputs[name] = ref;
  }

  return inputs;
}

/** Resolve a VDF closure from the volume inputs or VDF node reference. */
export function getVdfClosureRef(volume: ResolvedVolume): IrRef | null {
  if (volume.vdfNodeId) {
    return volume.vdfNodeId as IrRef;
  }
  // If no VDF node is connected, the inputs (absorption, scattering, anisotropy)
  // will be used to construct an anisotropic_vdf in the emitter
  return null;
}
