import inventory from '../../docs/generated/materialx-nodedefs.json';
import { prepareCpuValueProbe } from '../../scripts/materialx-compatibility-cpu.ts';
import {
  OBJECT_TO_WORLD_INPUT, WORLD_TO_OBJECT_INPUT, OBJECT_POSITION_INPUT,
  OBJECT_NORMAL_INPUT, OBJECT_TANGENT_INPUT, OBJECT_BITANGENT_INPUT,
} from '../../src/compiler/ir.ts';
import { runNodeOnGpu } from '../../src/gpu/exec.ts';

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const GPU_TYPES = new Set(['float', 'color3', 'color4', 'vector2', 'vector3', 'vector4']);

export async function materialxGpuProbes() {
  const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('No WebGPU adapter is available.');
  const device = await adapter.requestDevice();
  const results: { nodedef: string; status: 'matched' | 'different' | 'error'; actual?: number[]; message?: string }[] = [];
  try {
    for (const definition of inventory.definitions) {
      if (definition.origin !== 'library' || definition.cpuProbe.status !== 'evaluated'
          || definition.outputs.length !== 1 || !GPU_TYPES.has(definition.outputs[0]!.type)) continue;
      const probe = prepareCpuValueProbe(definition);
      if (probe.status !== 'evaluated') throw new Error(`Stale CPU probe: ${definition.nodedef}.`);
      device.pushErrorScope('validation');
      let actual: number[] | undefined;
      let failure: string | undefined;
      try {
        const result = await runNodeOnGpu(device, probe.ir, {
          varyings: {
            position: [0.25, 0.5, 0.75], normal: [0, 0, 1], tangent: [1, 0, 0],
            bitangent: [0, 1, 0], texcoord: [0.25, 0.5], viewDir: [0, 0, 1],
          },
          inputs: {
            [OBJECT_TO_WORLD_INPUT]: IDENTITY, [WORLD_TO_OBJECT_INPUT]: IDENTITY,
            [OBJECT_POSITION_INPUT]: [0.25, 0.5, 0.75], [OBJECT_NORMAL_INPUT]: [0, 0, 1],
            [OBJECT_TANGENT_INPUT]: [1, 0, 0], [OBJECT_BITANGENT_INPUT]: [0, 1, 0],
          },
        });
        actual = [...result.output];
      } catch (error) {
        failure = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      }
      const validation = await device.popErrorScope();
      if (validation) failure = [failure, validation.message].filter(Boolean).join('\n');
      if (failure || !actual) {
        results.push({ nodedef: definition.nodedef, status: 'error', message: failure ?? 'No output.' });
        continue;
      }
      if (actual.some(value => !Number.isFinite(value))) {
        results.push({ nodedef: definition.nodedef, status: 'error', message: `Non-finite GPU output: ${actual.join(', ')}.` });
        continue;
      }
      const matched = actual.length === probe.value.length && actual.every((value, index) => {
        const expected = probe.value[index]!;
        return Math.abs(value - expected) <= 1e-4 * Math.max(1, Math.abs(expected));
      });
      results.push(matched
        ? { nodedef: definition.nodedef, status: 'matched' }
        : { nodedef: definition.nodedef, status: 'different', actual });
    }
    return { adapter: { vendor: adapter.info.vendor, architecture: adapter.info.architecture, device: adapter.info.device }, results };
  } finally {
    device.destroy();
  }
}
