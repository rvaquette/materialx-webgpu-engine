// Rebuilds a dynamic scene's path-tracing BVH off the main thread (bvh-rebuild.ts).
import { rebuildPackedBvh } from './bvh-pack.ts';

interface Request { id: number; triangles: Float32Array; triangleCount: number; inflate: number }

self.onmessage = (event: MessageEvent<Request>) => {
  const { id, triangles, triangleCount, inflate } = event.data;
  try {
    const result = rebuildPackedBvh(triangles, triangleCount, inflate);
    (self as unknown as Worker).postMessage({ id, ...result }, [result.nodes.buffer, result.triangleOrder.buffer]);
  } catch (error) {
    (self as unknown as Worker).postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
};
