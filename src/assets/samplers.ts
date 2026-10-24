import type { SamplerResource } from '../compiler/ir.ts';

export interface ImageSamplerDescriptor {
  addressModeU: GPUAddressMode;
  addressModeV: GPUAddressMode;
  magFilter: GPUFilterMode;
  minFilter: GPUFilterMode;
}

export function imageSamplerDescriptor(sampler: Pick<SamplerResource, 'addressU' | 'addressV' | 'filter'>): ImageSamplerDescriptor {
  const address = (mode: string | undefined): GPUAddressMode => {
    switch (mode) {
      case undefined:
      case 'periodic': return 'repeat';
      case 'clamp': return 'clamp-to-edge';
      case 'mirror': return 'mirror-repeat';
      // The constant border is evaluated in the shader, not by WebGPU samplers.
      case 'constant': return 'clamp-to-edge';
      default: throw new Error(`Unsupported MaterialX image address mode '${mode}'.`);
    }
  };
  let filter: GPUFilterMode;
  switch (sampler.filter) {
    case 'closest': filter = 'nearest'; break;
    case undefined:
    case 'linear':
    case 'cubic': filter = 'linear'; break;
    default: throw new Error(`Unsupported MaterialX image filter '${sampler.filter}'.`);
  }
  return { addressModeU: address(sampler.addressU), addressModeV: address(sampler.addressV), magFilter: filter, minFilter: filter };
}
