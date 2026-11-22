import { describe, expect, it } from 'vitest';
import { TelemetryRecorder } from '../../src/diagnostics/telemetry.ts';

describe('TelemetryRecorder', () => {
  it('aggregates engine measures, GPU samples, uploads and convergence locally', async () => {
    const telemetry = new TelemetryRecorder();
    const writes: unknown[] = [];
    const queue = {
      writeBuffer: (...args: unknown[]) => writes.push(args),
      writeTexture: (...args: unknown[]) => writes.push(args),
    } as unknown as GPUQueue;
    const original = queue.writeBuffer;
    telemetry.watchUploads(queue);
    queue.writeBuffer({} as GPUBuffer, 0, new Float32Array(8));
    queue.writeBuffer({} as GPUBuffer, 0, new Float32Array(8), 2, 4);
    queue.writeTexture({} as GPUTexelCopyTextureInfo, new Uint8Array(64), {}, [4, 4]);
    const start = performance.now();
    performance.measure('usd:geometry', { start, end: start + 5 });
    performance.measure('unrelated', { start, end: start + 5 });
    await new Promise(resolve => setTimeout(resolve, 20));
    telemetry.recordGpu('pathtracing', 3);
    telemetry.recordGpu('pathtracing', 5);
    telemetry.recordConvergence({ backend: 'pathtracing', samples: 64, relativeNoise: 0.02 });
    const snapshot = telemetry.snapshot();
    expect(writes).toHaveLength(3);
    expect(snapshot.uploads).toEqual({ buffers: { count: 2, bytes: 48 }, textures: { count: 1, bytes: 64 } });
    expect(snapshot.phases['usd:geometry']?.count).toBe(1);
    expect(snapshot.phases.unrelated).toBeUndefined();
    expect(snapshot.gpu?.pathtracing).toEqual({ count: 2, totalMs: 8, maxMs: 5, lastMs: 5 });
    expect(JSON.parse(JSON.stringify(snapshot)).convergence.samples).toBe(64);
    telemetry.dispose();
    expect(queue.writeBuffer).toBe(original);
  });
});
