// Background BVH rebuild for dynamic path-tracing scenes. A Web Worker builds the
// new topology from a snapshot of the triangle records; without workers (tests,
// restricted hosts) the same builder runs on the next macrotask.
import { rebuildPackedBvh, type RebuiltBvh } from './bvh-pack.ts';

let worker: Worker | undefined;
let workerFailed = false;
let nextId = 0;
const pending = new Map<number, { resolve: (result: RebuiltBvh) => void; reject: (error: Error) => void }>();

function rebuildWorker(): Worker | undefined {
  if (worker || workerFailed || typeof Worker === 'undefined') return worker;
  try {
    worker = new Worker(new URL('./bvh-rebuild-worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<{ id: number; error?: string } & Partial<RebuiltBvh>>) => {
      const entry = pending.get(event.data.id);
      if (!entry) return;
      pending.delete(event.data.id);
      const { nodes, nodeCount, triangleOrder, error } = event.data;
      if (error !== undefined || !nodes || nodeCount === undefined || !triangleOrder) entry.reject(new Error(error ?? 'BVH rebuild failed.'));
      else entry.resolve({ nodes, nodeCount, triangleOrder });
    };
    worker.onerror = event => {
      event.preventDefault();
      workerFailed = true;
      worker?.terminate();
      worker = undefined;
      const failed = [...pending.values()];
      pending.clear();
      for (const entry of failed) entry.reject(new Error(`BVH rebuild worker failed: ${event.message}`));
    };
  } catch {
    workerFailed = true;
    worker = undefined;
  }
  return worker;
}

/** Rebuild the BVH of `triangleCount` packed records; `triangles` is copied, not consumed. */
export function rebuildBvhInBackground(triangles: Float32Array, triangleCount: number, inflate: number): Promise<RebuiltBvh> {
  const snapshot = triangles.slice();
  const target = rebuildWorker();
  if (!target) {
    return new Promise((resolve, reject) => setTimeout(() => {
      try { resolve(rebuildPackedBvh(snapshot, triangleCount, inflate)); }
      catch (error) { reject(error instanceof Error ? error : new Error(String(error))); }
    }, 0));
  }
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    target.postMessage({ id, triangles: snapshot, triangleCount, inflate }, [snapshot.buffer]);
  }).then(result => result, (error: unknown) => {
    // A worker that cannot load (CSP, packaging) falls back to the main thread.
    if (!workerFailed) throw error;
    return rebuildPackedBvh(triangles, triangleCount, inflate);
  }) as Promise<RebuiltBvh>;
}
