import { buildTlas } from '../../src/geometry/bvh.ts';
import { buildGeometry, type SceneResources } from '../../src/render/scene-resources.ts';
import { IDENTITY4 } from '../../src/scene/transforms.ts';
import { DisneyGpuBackend } from '../../src/render/pathtracing/disney-gpu-backend.ts';
import { buildDisneyAcceleration } from '../../src/render/pathtracing/disney-acceleration.ts';
import { packDisneyGeometryTextures } from '../../src/render/pathtracing/disney-geometry-textures.ts';
import type { DisneyMaterial } from '../../src/render/pathtracing/disney-material.ts';
import { DisneyTextureRegistry } from '../../src/render/pathtracing/disney-texture-array.ts';

/** Exercise upload, pipeline creation, dispatch, readback and disposal on a real WebGPU device. */
export async function runDisneyGpuBackendProbe(device: GPUDevice): Promise<void> {
  const geometry = buildGeometry('triangle', '/Triangle', {
    positions: new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    indices: new Uint32Array([0, 1, 2]), attributes: new Map(), subsets: [],
    subdivision: { scheme: 'none', level: 0, applied: false },
    displacement: { required: false },
  });
  const resources: SceneResources = {
    geometries: new Map([['triangle', geometry]]), materials: new Map(),
    instances: [{ id: 'triangle', primPath: '/Triangle', prototypeId: 'triangle', transform: IDENTITY4, hasGeometry: true }],
    tlas: buildTlas([]), pendingGeometry: [], pendingMaterials: [], unboundGprims: [],
  };
  const material: DisneyMaterial = {
    baseColor: [0.8, 0.8, 0.8], anisotropic: 0, emission: [0, 0, 0],
    metallic: 0, roughness: 0.5, subsurface: 0, specularTint: 0, sheen: 0,
    sheenTint: 0.5, clearcoat: 0, clearcoatGloss: 0.5, specTrans: 0, ior: 1.5,
    mediumType: 0, mediumDensity: 0, mediumColor: [1, 1, 1], mediumAnisotropy: 0,
    textures: [-1, -1, -1, -1], opacity: 1, alphaMode: 0, alphaCutoff: 0.5,
  };
  const scene = {
    geometry: packDisneyGeometryTextures(buildDisneyAcceleration(resources), [0]),
    materials: [material], textures: new DisneyTextureRegistry(), warnings: [],
  };
  const backend = await DisneyGpuBackend.create(device, scene, {
    width: 1, height: 1, textureSize: 1, outputFormat: 'rgba8unorm',
    imageProvider: { decode: () => undefined },
    lights: new Float32Array(20),
  });
  const target = device.createTexture({
    size: [1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });
  const targetReadback = device.createBuffer({ size: 256, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  try {
    backend.reset();
    backend.renderTile({
      resolution: [1, 1], tileOrigin: [0, 0], tileSize: [1, 1],
      tileOffset: [0, 0], inverseTileCount: [1, 1], frame: 1,
      root: scene.geometry.topLevelIndex,
      camera: { position: [10, 10, 10], right: [1, 0, 0], up: [0, 1, 0],
        forward: [0, 0, 1], fov: 0.5, focalDistance: 1, aperture: 0 },
      lightCount: 0, maxDepth: 1, rrDepth: 0, russianRoulette: false,
      environment: false, uniformLight: true, hideEmitters: false,
      transparentBackground: false, alphaTest: false, medium: false,
      volumeMis: false, flipNormalY: false, mollify: false, environmentLinear: false,
      mollificationAmount: 0, environmentTotal: 0, environmentRotation: 0,
      environmentIntensity: 1, uniformColor: [0.25, 0.5, 0.75],
    }, target.createView(), 0);
    if (await backend.readError() !== 0) throw new Error('Disney backend GPU status was nonzero.');
    const result = await backend.readPixels();
    if (result.samples[0] !== 1 || Array.from(result.color).some(value => !Number.isFinite(value))) {
      throw new Error(`Disney backend GPU output was invalid: ${Array.from(result.color)} / ${result.samples[0]}.`);
    }
    const encoder = device.createCommandEncoder();
    encoder.copyTextureToBuffer({ texture: target }, { buffer: targetReadback, bytesPerRow: 256 }, [1, 1]);
    device.queue.submit([encoder.finish()]);
    await targetReadback.mapAsync(GPUMapMode.READ);
    const displayed = new Uint8Array(targetReadback.getMappedRange()).slice(0, 4);
    targetReadback.unmap();
    if (displayed[0] === 0 || displayed[1] === 0 || displayed[2] === 0 || displayed[3] !== 255) {
      throw new Error(`Disney display pass output was invalid: ${Array.from(displayed)}.`);
    }
  } finally {
    backend.dispose();
    target.destroy();
    targetReadback.destroy();
  }
}
