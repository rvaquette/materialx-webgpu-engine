export function cacheGpuPipelines(device: GPUDevice): () => { hits: number; misses: number } {
  const identities = new WeakMap<object, number>();
  let nextIdentity = 0;
  const stats = { hits: 0, misses: 0 };
  const key = (value: unknown): string => {
    if (value === undefined) return 'undefined';
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    const identity = identities.get(value);
    if (identity !== undefined) return `gpu:${identity}`;
    if (Array.isArray(value)) return `[${value.map(key).join(',')}]`;
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
      const id = ++nextIdentity;
      identities.set(value, id);
      return `gpu:${id}`;
    }
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, entry]) => `${JSON.stringify(name)}:${key(entry)}`).join(',')}}`;
  };
  const cache = <D, R extends object>(create: (descriptor: D) => R): (descriptor: D) => R => {
    const entries = new Map<string, R>();
    return descriptor => {
      const signature = key(descriptor);
      const previous = entries.get(signature);
      if (previous) { stats.hits++; return previous; }
      const result = create(descriptor);
      identities.set(result, ++nextIdentity);
      entries.set(signature, result);
      stats.misses++;
      return result;
    };
  };
  const asyncCache = <D, R extends object>(create: (descriptor: D) => Promise<R>): (descriptor: D) => Promise<R> => {
    const entries = new Map<string, Promise<R>>();
    return descriptor => {
      const signature = key(descriptor);
      const previous = entries.get(signature);
      if (previous) { stats.hits++; return previous; }
      const pending = create(descriptor).catch(error => {
        entries.delete(signature);
        throw error;
      });
      entries.set(signature, pending);
      stats.misses++;
      return pending;
    };
  };
  device.createShaderModule = cache(device.createShaderModule.bind(device));
  device.createBindGroupLayout = cache(device.createBindGroupLayout.bind(device));
  device.createPipelineLayout = cache(device.createPipelineLayout.bind(device));
  device.createRenderPipeline = cache(device.createRenderPipeline.bind(device));
  device.createComputePipeline = cache(device.createComputePipeline.bind(device));
  device.createRenderPipelineAsync = asyncCache(device.createRenderPipelineAsync.bind(device));
  device.createComputePipelineAsync = asyncCache(device.createComputePipelineAsync.bind(device));
  return () => ({ ...stats });
}
