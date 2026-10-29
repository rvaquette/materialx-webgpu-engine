export interface GpuMemory {
  bufferBytes: number;
  textureBytes: number;
  peakBufferBytes: number;
  peakTextureBytes: number;
  peakBytes: number;
  unknownFormats: string[];
}

export function textureByteSize(texture: Pick<GPUTexture, 'width' | 'height' | 'depthOrArrayLayers' | 'dimension' | 'mipLevelCount' | 'sampleCount' | 'format'>): number | undefined {
  const { format } = texture;
  let bytes: number;
  if (format === 'depth24plus' || format === 'depth24plus-stencil8' || format === 'depth32float' || format === 'stencil8') {
    bytes = format === 'stencil8' ? 1 : 4;
  } else if (format === 'depth16unorm') {
    bytes = 2;
  } else if (format === 'depth32float-stencil8') {
    bytes = 8;
  } else if (/^(rgb10a2|rg11b10|rgb9e5)/.test(format)) {
    bytes = 4;
  } else {
    const match = /^(r|rg|rgba|bgra)(8|16|32)(unorm|snorm|uint|sint|float)(-srgb)?$/.exec(format);
    if (!match) return undefined;
    bytes = match[1]!.length * Number(match[2]) / 8;
  }
  let total = 0;
  for (let mip = 0; mip < texture.mipLevelCount; mip++) {
    const width = Math.max(1, Math.floor(texture.width / 2 ** mip));
    const height = texture.dimension === '1d' ? 1 : Math.max(1, Math.floor(texture.height / 2 ** mip));
    const depth = texture.dimension === '3d'
      ? Math.max(1, Math.floor(texture.depthOrArrayLayers / 2 ** mip))
      : texture.depthOrArrayLayers;
    total += width * height * depth * texture.sampleCount * bytes;
  }
  return total;
}

/** Counts logical allocations, not driver padding, pipelines or implicit reclamation by GC. */
export function trackGpuMemory(device: GPUDevice): (() => GpuMemory) & { reset: () => void } {
  const resources = new Set<GPUBuffer | GPUTexture>();
  const memory: GpuMemory = {
    bufferBytes: 0, textureBytes: 0, peakBufferBytes: 0,
    peakTextureBytes: 0, peakBytes: 0, unknownFormats: [],
  };
  const track = (resource: GPUBuffer | GPUTexture, key: 'bufferBytes' | 'textureBytes', bytes: number): void => {
    resources.add(resource);
    memory[key] += bytes;
    memory.peakBufferBytes = Math.max(memory.peakBufferBytes, memory.bufferBytes);
    memory.peakTextureBytes = Math.max(memory.peakTextureBytes, memory.textureBytes);
    memory.peakBytes = Math.max(memory.peakBytes, memory.bufferBytes + memory.textureBytes);
    const destroy = resource.destroy.bind(resource);
    let destroyed = false;
    resource.destroy = () => {
      destroy();
      if (!destroyed) memory[key] -= bytes;
      destroyed = true;
      resources.delete(resource);
    };
  };
  const createBuffer = device.createBuffer.bind(device);
  device.createBuffer = descriptor => {
    const buffer = createBuffer(descriptor);
    track(buffer, 'bufferBytes', buffer.size);
    return buffer;
  };
  const createTexture = device.createTexture.bind(device);
  device.createTexture = descriptor => {
    const texture = createTexture(descriptor);
    const bytes = textureByteSize(texture);
    if (bytes === undefined) {
      resources.add(texture);
      if (!memory.unknownFormats.includes(texture.format)) memory.unknownFormats.push(texture.format);
    } else {
      track(texture, 'textureBytes', bytes);
    }
    return texture;
  };
  return Object.assign(() => ({ ...memory, unknownFormats: [...memory.unknownFormats] }), {
    reset() {
      for (const resource of resources) resource.destroy();
      resources.clear();
      memory.bufferBytes = memory.textureBytes = 0;
      memory.peakBufferBytes = memory.peakTextureBytes = memory.peakBytes = 0;
      memory.unknownFormats = [];
    },
  });
}
