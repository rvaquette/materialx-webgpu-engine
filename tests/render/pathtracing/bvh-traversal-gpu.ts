import { bvhTraversalWgsl } from '../../../src/render/pathtracing/bvh-wgsl.ts';
import { packBvh4 } from '../../../src/render/pathtracing/bvh4.ts';
import { pathTraceDisplacementWgsl } from '../../../src/render/pathtracing/displacement-wgsl.ts';
import { traversalCases, traversalFixture, traversalLeafOrderFixture, traversalWideFixture, traversalDeepFixture,
  type TraversalCase } from './bvh-traversal-cases.ts';

export interface TraversalChecks {
  cases: number;
  comparisons: number;
  identical: boolean;
  semanticTriangleIds: boolean;
  displacementEdgeUpdate: boolean;
  bvh4?: boolean;
}

/** Separate untimed GPU corpus: exact hit distance/ID/barycentrics, including
 * any-hit traversal order, not just shadow visibility in a finished image. */
export async function checkBvhTraversalGpu(device: GPUDevice, progress?: (message: string) => void): Promise<TraversalChecks> {
  const pipelines = new Map<string, GPUComputePipeline>();
  const binary = await checkBvhCorpus(device, traversalFixture(), traversalCases, pipelines, true, true, progress);
  const wide = await checkBvhCorpus(device, traversalWideFixture(), traversalCases, pipelines, false, true, progress);
  const deep = traversalDeepFixture();
  const layered = await checkBvhCorpus(device, deep.fixture, deep.cases, pipelines, false, false, progress);
  return { ...binary, cases: binary.cases + wide.cases + layered.cases,
    comparisons: binary.comparisons + wide.comparisons + layered.comparisons, bvh4: true };
}

async function checkBvhCorpus(device: GPUDevice, fixture: ReturnType<typeof traversalFixture>,
  cases: TraversalCase[], pipelines: Map<string, GPUComputePipeline>,
  legacy = false, analytic = true, progress?: (message: string) => void): Promise<TraversalChecks> {
  const leafFixture = traversalLeafOrderFixture();
  const resources: GPUBuffer[] = [];
  const storage = (data: Float32Array | Uint32Array) => {
    const buffer = device.createBuffer({ size: Math.max(4, data.byteLength),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    resources.push(buffer);
    if (data.byteLength) device.queue.writeBuffer(buffer, 0, data);
    return buffer;
  };
  // Four bytes are less than NODE_STRIDE, so the existing empty guard is tested.
  const empty = storage(new Float32Array(1));
  const output = device.createBuffer({ size: cases.length * 32,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const readback = device.createBuffer({ size: output.size, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  resources.push(output, readback);
  const results: Float32Array[] = [];
  const rayData = new Float32Array(cases.length * 8);
  for (const [i, ray] of cases.entries()) {
    rayData.set([...ray.origin, ray.tMax, ...ray.direction, Number(ray.anyHit)], i * 8);
  }
  const rays = storage(rayData);
  try {
    const variants = legacy ? ['reference', 'leafOrder', 'triangleEdges', 'bvh4'] as const : ['reference', 'bvh4'] as const;
    for (const variant of variants) {
      progress?.(`diag BVH corpus ${legacy ? 'legacy' : analytic ? 'wide' : 'layered'}/${variant}: ${pipelines.has(variant) ? 'reuse' : 'compile'}`);
      const current = variant === 'leafOrder' ? leafFixture : fixture;
      const nodes = storage(variant === 'bvh4' ? packBvh4(current.nodes) : current.nodes), tris = storage(current.triangles);
      const order = variant === 'leafOrder' ? undefined : storage(current.order);
      const edgesData = new Float32Array(current.triangles.length / 24 * 9);
      for (let tri = 0; tri < edgesData.length / 9; tri++) {
        const source = tri * 24, target = tri * 9;
        for (let axis = 0; axis < 3; axis++) {
          const v0 = Math.fround(current.triangles[source + axis]!);
          edgesData[target + axis] = v0;
          edgesData[target + 3 + axis] = Math.fround(Math.fround(current.triangles[source + 3 + axis]!) - v0);
          edgesData[target + 6 + axis] = Math.fround(Math.fround(current.triangles[source + 6 + axis]!) - v0);
        }
      }
      const edges = variant === 'triangleEdges' ? storage(edgesData) : undefined;
      const code = `
@group(0) @binding(0) var<storage, read> nodes : array<f32>;
@group(0) @binding(1) var<storage, read> tris : array<f32>;
${variant === 'leafOrder' ? '' : '@group(0) @binding(2) var<storage, read> triOrder : array<u32>;'}
@group(0) @binding(3) var<storage, read_write> output : array<vec4<f32>>;
${variant === 'triangleEdges' ? '@group(0) @binding(4) var<storage, read> triEdges : array<f32>;' : ''}
struct TestRay { origin : vec4f, direction : vec4f };
@group(0) @binding(5) var<storage, read> rays : array<TestRay>;
const NODE_STRIDE = 12u;
const TRI_STRIDE = 24u;
const RAY_EPS = 1.0e-4;
${bvhTraversalWgsl(variant)}
@compute @workgroup_size(1) fn main(@builtin(global_invocation_id) id : vec3<u32>) {
  let ray = rays[id.x];
  let h = traverse(ray.origin.xyz, ray.direction.xyz, ray.origin.w, ray.direction.w != 0.0);
  output[id.x * 2u] = vec4<f32>(h.t, f32(h.tri), h.u, h.v);
  output[id.x * 2u + 1u] = vec4<f32>(select(0.0, 1.0, h.hitAny), 0.0, 0.0, 0.0);
}`;
      let pipeline = pipelines.get(variant);
      if (!pipeline) {
        const module = device.createShaderModule({ code });
        const errors = (await module.getCompilationInfo()).messages.filter(m => m.type === 'error');
        if (errors.length) throw new Error(`BVH corpus ${variant}: ${errors.map(e => e.message).join('\n')}`);
        pipeline = await device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint: 'main' } });
        pipelines.set(variant, pipeline);
      }
      const encoder = device.createCommandEncoder();
      for (const emptyScene of [false, true]) {
        const entries: GPUBindGroupEntry[] = [
          { binding: 0, resource: { buffer: emptyScene ? empty : nodes } },
          ...(variant === 'triangleEdges' ? [] : [{ binding: 1, resource: { buffer: tris } }]),
          ...(order ? [{ binding: 2, resource: { buffer: order } }] : []),
          { binding: 3, resource: { buffer: output } },
          ...(edges ? [{ binding: 4, resource: { buffer: edges } }] : []),
          { binding: 5, resource: { buffer: rays } },
        ];
        const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries });
        const pass = encoder.beginComputePass();
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, group);
        pass.dispatchWorkgroups(cases.length);
        pass.end();
        for (let i = 0; i < cases.length; i++) {
          if (Boolean(cases[i]!.empty) === emptyScene) {
            encoder.copyBufferToBuffer(output, i * 32, readback, i * 32, 32);
          }
        }
      }
      device.queue.submit([encoder.finish()]);
      await readback.mapAsync(GPUMapMode.READ);
      const data = new Float32Array(readback.getMappedRange().slice(0));
      readback.unmap();
      if (variant === 'leafOrder') {
        for (let i = 0; i < cases.length; i++) {
          if (cases[i]!.expected) {
            const b = i * 8;
            data[b + 1] = leafFixture.originalTriangleIds[data[b + 1]!]!;
          }
        }
      }
      results.push(data);
      progress?.(`diag BVH corpus ${legacy ? 'legacy' : analytic ? 'wide' : 'layered'}/${variant}: readback`);
      for (let i = 0; analytic && i < cases.length; i++) {
        const c = cases[i]!, b = i * 8;
        if (data[b + 4] !== (c.expected ? 1 : 0)) throw new Error(`${variant}: ${c.name}: visibility differs`);
        if (data[b] !== (c.expected?.t ?? c.tMax)) throw new Error(`${variant}: ${c.name}: distance differs`);
        if (c.expected && (data[b + 1] !== c.expected.tri ||
          (!c.anyHit && (data[b + 2] !== c.expected.u || data[b + 3] !== c.expected.v)))) {
          throw new Error(`${variant}: ${c.name}: triangle/barycentrics differ`);
        }
      }
      nodes.destroy();
      tris.destroy();
      order?.destroy();
      edges?.destroy();
    }
    if (results.some(data => data.some((value, i) => !Number.isFinite(value) || value !== results[0]![i]))) {
      throw new Error(`BVH GPU corpus (${legacy ? 'legacy' : analytic ? 'wide' : 'layered'}) is not exactly identical`);
    }
    if (legacy) await checkDisplacementEdgeGpu(device);
    return {
      cases: cases.length, comparisons: cases.length * variants.length,
      identical: true, semanticTriangleIds: true, displacementEdgeUpdate: true,
    };
  } finally {
    for (const buffer of resources) buffer.destroy();
  }

  async function checkDisplacementEdgeGpu(device: GPUDevice): Promise<void> {
    const triangles = new Float32Array(24);
    triangles.set([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    triangles.set([0.6, 0, 0.8, 0.6, 0, 0.8, 0.6, 0, 0.8], 9);
    triangles[18] = 0;
    const uvs = new Float32Array([0.1, 0.5, 0.9, 0.5, 0.1, 0.5]);
    const edges = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const makeStorage = (data: Float32Array) => {
      const buffer = device.createBuffer({ size: data.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC });
      device.queue.writeBuffer(buffer, 0, data);
      return buffer;
    };
    const triBuffer = makeStorage(triangles), uvBuffer = makeStorage(uvs);
    const edgeBuffer = makeStorage(edges), scaleBuffer = makeStorage(new Float32Array([0.5]));
    const info = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(info, 0, new Uint32Array([1, 0, 0, 0]));
    device.queue.writeBuffer(info, 4, new Float32Array([0.5]));
    const texture = device.createTexture({
      size: [2, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    const pixels = new Uint8Array([0, 0, 0, 255, 255, 0, 0, 255]);
    device.queue.writeTexture({ texture }, pixels, { bytesPerRow: 8, rowsPerImage: 1 }, [2, 1, 1]);
    const sampler = device.createSampler({
      addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge', magFilter: 'nearest', minFilter: 'nearest',
    });
    const readback = device.createBuffer({ size: (24 + 9) * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    try {
      const module = device.createShaderModule({ code: pathTraceDisplacementWgsl(true) });
      const errors = (await module.getCompilationInfo()).messages.filter(message => message.type === 'error');
      if (errors.length) throw new Error(`Displacement-edge GPU corpus: ${errors.map(message => message.message).join('\n')}`);
      const pipeline = await device.createComputePipelineAsync({
        layout: 'auto', compute: { module, entryPoint: 'main' },
      });
      const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: triBuffer } },
          { binding: 1, resource: { buffer: uvBuffer } },
          { binding: 2, resource: { buffer: scaleBuffer } },
          { binding: 3, resource: { buffer: info } },
          { binding: 4, resource: texture.createView() },
          { binding: 5, resource: sampler },
          { binding: 6, resource: { buffer: edgeBuffer } },
        ],
      });
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(1);
      pass.end();
      encoder.copyBufferToBuffer(triBuffer, 0, readback, 0, 24 * 4);
      encoder.copyBufferToBuffer(edgeBuffer, 0, readback, 24 * 4, 9 * 4);
      device.queue.submit([encoder.finish()]);
      await readback.mapAsync(GPUMapMode.READ);
      const result = new Float32Array(readback.getMappedRange().slice(0));
      readback.unmap();
      if (result[2] === 0 || result[5] === 0) throw new Error('Displacement-edge GPU corpus did not displace vertices');
      for (let axis = 0; axis < 3; axis++) {
        const v0 = result[axis]!, v1 = result[3 + axis]!, v2 = result[6 + axis]!;
        if (result[24 + axis] !== v0 ||
            result[27 + axis] !== Math.fround(v1 - v0) ||
            result[30 + axis] !== Math.fround(v2 - v0)) {
          throw new Error(`Displacement-edge GPU corpus: edge stream differs at axis ${axis}`);
        }
      }
    } finally {
      triBuffer.destroy(); uvBuffer.destroy(); edgeBuffer.destroy(); scaleBuffer.destroy();
      info.destroy(); texture.destroy(); readback.destroy();
    }
  }
}
