// Browser entry point (T026b). Verifies WebGPU, then drives the executable raster
// backend: it builds an HDR colour target plus depth, uploads a small lit
// triangle, records a forward opaque pass and a tonemap resolve to the canvas,
// and submits one static frame. The real device lifecycle lives in
// src/gpu/device.ts; this bootstrap wires a minimal end-to-end render.

import { RasterBackend, FORWARD_UNIFORM_SIZE, RESOLVE_UNIFORM_SIZE } from './render/raster/backend.ts';
import { lookAt4, multiply4, perspective4 } from './scene/transforms.ts';

function setStatus(text: string): void {
  const el = document.getElementById('status');
  if (el) el.textContent = text;
}

// Interleaved position(xyz) + normal(xyz); a single camera-facing triangle.
const VERTICES = new Float32Array([
  -0.6, -0.5, 0, 0, 0, 1,
  0.6, -0.5, 0, 0, 0, 1,
  0.0, 0.6, 0, 0, 0, 1,
]);
const INDICES = new Uint32Array([0, 1, 2]);

function buildForwardUniforms(aspect: number): Float32Array {
  const proj = perspective4(Math.PI / 3, aspect, 0.1, 100);
  const view = lookAt4([0, 0, 2], [0, 0, 0], [0, 1, 0]);
  const viewProj = multiply4(proj, view);
  const data = new Float32Array(FORWARD_UNIFORM_SIZE / 4);
  data.set(viewProj, 0);
  data.set([0.3, 0.5, 0.8, 0], 16); // lightDir
  data.set([1, 1, 1, 0], 20); // lightColor
  data.set([1.0, 0.5, 0.2, 1], 24); // baseColor
  return data;
}

async function main(): Promise<void> {
  if (!('gpu' in navigator)) {
    setStatus('WebGPU is not available in this browser.');
    return;
  }
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    setStatus('No WebGPU adapter found.');
    return;
  }
  const device = await adapter.requestDevice();
  const canvas = document.getElementById('view') as HTMLCanvasElement | null;
  const context = canvas?.getContext('webgpu') ?? null;
  if (!canvas || !context) {
    setStatus('WebGPU adapter ready; no canvas context.');
    return;
  }

  const outputFormat = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format: outputFormat, alphaMode: 'opaque' });

  const width = canvas.width;
  const height = canvas.height;
  const backend = new RasterBackend({ device, outputFormat, tonemap: 'acesFilmic' });
  backend.createForwardPipeline();
  backend.createResolvePipeline();

  const hdrTexture = device.createTexture({
    size: [width, height],
    format: backend.hdrFormat,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });
  const depthTexture = device.createTexture({
    size: [width, height],
    format: backend.depthFormat,
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });

  const vertexBuffer = device.createBuffer({
    size: VERTICES.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(vertexBuffer, 0, VERTICES);
  const indexBuffer = device.createBuffer({
    size: INDICES.byteLength,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(indexBuffer, 0, INDICES);

  const forwardUniform = device.createBuffer({
    size: FORWARD_UNIFORM_SIZE,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(forwardUniform, 0, buildForwardUniforms(width / height));

  const resolveUniform = device.createBuffer({
    size: RESOLVE_UNIFORM_SIZE,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(resolveUniform, 0, new Float32Array([0])); // exposure EV

  const forwardPipeline = backend.forwardPipeline;
  const resolvePipeline = backend.resolvePipeline;
  if (!forwardPipeline || !resolvePipeline) {
    setStatus('Pipeline creation failed.');
    return;
  }

  const forwardBindGroup = device.createBindGroup({
    layout: forwardPipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: forwardUniform } }],
  });
  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
  const hdrView = hdrTexture.createView();
  const resolveBindGroup = device.createBindGroup({
    layout: resolvePipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: hdrView },
      { binding: 1, resource: sampler },
      { binding: 2, resource: { buffer: resolveUniform } },
    ],
  });

  const encoder = device.createCommandEncoder();
  backend.recordFrame(
    encoder,
    {
      hdrView,
      depthView: depthTexture.createView(),
      bindGroup: forwardBindGroup,
      geometry: { vertexBuffer, indexBuffer, indexCount: INDICES.length },
    },
    { outputView: context.getCurrentTexture().createView(), bindGroup: resolveBindGroup },
  );
  device.queue.submit([encoder.finish()]);

  setStatus(`WebGPU raster frame submitted (${adapter.info?.vendor || 'unknown vendor'}).`);
}

void main();
