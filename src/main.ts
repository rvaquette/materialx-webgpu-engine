// Browser entry point (T026b, T051, T052). Drives the executable raster backend
// on a real scene: it builds a composed SceneAsset, resolves its USD lights (and
// camera when present), turns it into GPU resources through the SceneAsset -> GPU
// bridge (src/render/scene-resources.ts), assembles a multi-object render plan
// with the effectively-active passes (src/render/raster/scene-frame.ts), uploads
// every prototype's geometry, records one scene forward pass per active pass into
// an HDR target, and resolves it to the canvas. T052 adds a WebGPU compute path
// tracer fed by the SAME resources (src/render/pathtracing/scene-buffers.ts +
// compute.ts) with progressive accumulation, and wires backend switching through
// the RenderEngine (src/render/engine.ts) so raster and path tracing render the
// same assets with no reimport ([r] raster / [p] path tracing). The demo
// SceneAsset stands in for the crate/USD loader that will supply real assets; the
// runtime flow -- scene -> camera/lights -> resources -> frame -> GPU passes -- is
// the real path, no longer a hard-coded triangle with hard-coded uniforms.

import { emitWgsl } from './compiler/wgsl.ts';
import { FLOAT, IrModuleBuilder, shaderType } from './compiler/ir.ts';
import { RasterBackend, RESOLVE_UNIFORM_SIZE, SCENE_FORWARD_UNIFORM_SIZE, type ScenePassKind, type SceneDrawCall } from './render/raster/backend.ts';
import { buildSceneFrame, buildSceneUniform, type FrameCamera } from './render/raster/scene-frame.ts';
import { buildSceneResources, uploadGeometry, type MaterialBuild, type MaterialCompiler, type MeshSource } from './render/scene-resources.ts';
import { buildPathTraceScene } from './render/pathtracing/scene-buffers.ts';
import { buildPathTraceUniform, PathTraceBackend, PT_UNIFORM_SIZE } from './render/pathtracing/compute.ts';
import { RenderEngine, type BackendKind } from './render/engine.ts';
import { lookAt4, multiply4, perspective4 } from './scene/transforms.ts';
import type { RawMesh } from './geometry/prepare.ts';
import type { MaterialXReference, SceneAsset, ScenePrim, XformOp } from './scene/types.ts';
import { importCameras } from './usd/cameras.ts';
import { importLights } from './usd/lights.ts';

function setStatus(text: string): void {
  const el = document.getElementById('status');
  if (el) el.textContent = text;
}

function prim(path: string, overrides: Partial<ScenePrim> = {}): ScenePrim {
  const name = path.split('/').filter(Boolean).pop() ?? '';
  return {
    path,
    name,
    specifier: 'def',
    apiSchemas: [],
    inherits: [],
    references: [],
    payloads: [],
    attributes: new Map(),
    relationships: new Map(),
    xformOps: [],
    children: [],
    ...overrides,
  };
}

const translate = (x: number, y: number, z: number): XformOp => ({
  op: 'xformOp:translate',
  typeName: 'double3',
  value: [x, y, z],
  invert: false,
});

const SURF_MTLX: MaterialXReference = {
  primPath: '/World/Looks/surf',
  assetPath: './demo.mtlx',
  referencedPrimPath: '/MaterialX/Materials/surf',
  materialName: 'surf',
};

/** Minimal composed scene: two lit meshes bound to one material + a key light. */
function buildDemoScene(): SceneAsset {
  const world = prim('/World', { children: ['/World/tri', '/World/quad', '/World/Looks', '/World/key'] });
  const binding = { target: '/World/Looks/surf', strength: 'weakerThanDescendants' as const };
  const tri = prim('/World/tri', { typeName: 'Mesh', mesh: { primvars: [] }, xformOps: [translate(-0.7, 0, 0)], materialBinding: binding });
  const quad = prim('/World/quad', { typeName: 'Mesh', mesh: { primvars: [] }, xformOps: [translate(0.7, 0, 0)], materialBinding: binding });
  const looks = prim('/World/Looks', { children: ['/World/Looks/surf'] });
  const surf = prim('/World/Looks/surf', { typeName: 'Material' });
  const key = prim('/World/key', {
    typeName: 'DistantLight',
    attributes: new Map([
      ['inputs:intensity', { name: 'inputs:intensity', typeName: 'float', value: 3 }],
      ['inputs:color', { name: 'inputs:color', typeName: 'color3f', value: [1, 0.96, 0.9] }],
    ]),
  });
  const prims = [world, tri, quad, looks, surf, key];
  return {
    entry: 'demo.usda',
    stage: { subLayers: [] },
    prims: new Map(prims.map((p) => [p.path, p])),
    roots: ['/World'],
    materials: [SURF_MTLX],
  };
}

function demoMeshSource(): MeshSource {
  const tri: RawMesh = {
    points: [-0.5, -0.4, 0, 0.5, -0.4, 0, 0, 0.5, 0],
    faceVertexCounts: [3],
    faceVertexIndices: [0, 1, 2],
  };
  const quad: RawMesh = {
    points: [-0.45, -0.45, 0, 0.45, -0.45, 0, 0.45, 0.45, 0, -0.45, 0.45, 0],
    faceVertexCounts: [4],
    faceVertexIndices: [0, 1, 2, 3],
  };
  const map: Record<string, RawMesh> = { '/World/tri': tri, '/World/quad': quad };
  return { meshFor: (path) => map[path] };
}

function demoMaterialCompiler(): MaterialCompiler {
  return {
    compile(): MaterialBuild {
      const b = new IrModuleBuilder();
      const opacity = b.constant(FLOAT, 1);
      const ref = b.add({ kind: 'closure', type: shaderType('surface'), closure: 'bsdf', op: 'surface', params: { opacity } });
      b.output({ name: 'surfaceshader', type: shaderType('surface'), ref });
      const ir = b.build();
      return { ir, module: emitWgsl(ir) };
    },
  };
}

function cameraForCanvas(aspect: number): FrameCamera {
  const proj = perspective4(Math.PI / 3, aspect, 0.1, 100);
  const eye: [number, number, number] = [0, 0, 2.6];
  const view = lookAt4(eye, [0, 0, 0], [0, 1, 0]);
  return { viewProj: multiply4(proj, view), eye, exposure: 0 };
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
  const ctx = context;
  const width = canvas.width;
  const height = canvas.height;

  // Scene -> resources -> frame (the real runtime chain).
  const scene = buildDemoScene();
  const warnings: string[] = [];
  const sink = (d: { level: string; message: string }): void => {
    if (d.level === 'warning' || d.level === 'error') warnings.push(d.message);
  };
  const resources = await buildSceneResources(scene, {
    meshSource: demoMeshSource(),
    materialCompiler: demoMaterialCompiler(),
    sink,
  });
  const lights = importLights(scene, { sink });
  const cameras = importCameras(scene, { sink });
  const frame = buildSceneFrame(resources, {
    lights,
    ...(cameras[0] ? { camera: cameras[0] } : { frameCamera: cameraForCanvas(width / height) }),
  });

  const backend = new RasterBackend({ device, outputFormat, tonemap: 'acesFilmic' });
  for (const pass of frame.passes) backend.createSceneForwardPipeline(pass);
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
  const hdrView = hdrTexture.createView();
  const depthView = depthTexture.createView();

  // Upload geometry once per prototype.
  const uploaded = new Map<string, ReturnType<typeof uploadGeometry>>();
  for (const [id, geometry] of resources.geometries) {
    uploaded.set(id, uploadGeometry(device, geometry, id));
  }

  // One draw call per instance, grouped by its active pass.
  const drawsByPass = new Map<ScenePassKind, SceneDrawCall[]>();
  for (const draw of frame.draws) {
    const buffers = uploaded.get(draw.prototypeId);
    const position = buffers?.vertexBuffers.get('position');
    const normal = buffers?.vertexBuffers.get('normal');
    if (!buffers || !position || !normal) continue;
    const pipeline = backend.scenePipeline(draw.pass);
    if (!pipeline) continue;
    const uniform = device.createBuffer({
      size: SCENE_FORWARD_UNIFORM_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(uniform, 0, buildSceneUniform(frame, draw));
    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: uniform } }],
    });
    const list = drawsByPass.get(draw.pass) ?? [];
    list.push({ bindGroup, positionBuffer: position, normalBuffer: normal, indexBuffer: buffers.indexBuffer, indexCount: buffers.indexCount });
    drawsByPass.set(draw.pass, list);
  }

  const resolveUniform = device.createBuffer({
    size: RESOLVE_UNIFORM_SIZE,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(resolveUniform, 0, new Float32Array([frame.camera.exposure]));
  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
  const resolvePipeline = backend.resolvePipeline;
  if (!resolvePipeline) {
    setStatus('Resolve pipeline creation failed.');
    return;
  }
  const resolveBindGroup = device.createBindGroup({
    layout: resolvePipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: hdrView },
      { binding: 1, resource: sampler },
      { binding: 2, resource: { buffer: resolveUniform } },
    ],
  });

  function renderRaster(targetView: GPUTextureView): void {
    const encoder = device.createCommandEncoder();
    let first = true;
    for (const pass of frame.passes) {
      const draws = drawsByPass.get(pass) ?? [];
      if (draws.length === 0) continue;
      backend.recordScenePass(encoder, { pass, hdrView, depthView, draws, clear: first });
      first = false;
    }
    backend.recordResolvePass(encoder, { outputView: targetView, bindGroup: resolveBindGroup });
    device.queue.submit([encoder.finish()]);
  }

  // Path tracing backend on the SAME resources (no reimport): pack the scene
  // into GPU storage buffers, build the compute pipeline, and accumulate into a
  // per-pixel storage buffer that a fullscreen pass tonemaps to the canvas.
  const ptScene = buildPathTraceScene(resources, {
    lights,
    ...(cameras[0] ? { camera: cameras[0] } : { frameCamera: cameraForCanvas(width / height) }),
  });
  const ptBackend = new PathTraceBackend(device);
  const { pipeline: ptPipeline } = ptBackend.createPipeline();
  const storage = (data: Float32Array | Uint32Array): GPUBuffer => {
    const buf = device.createBuffer({ size: data.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(buf, 0, data);
    return buf;
  };
  const nodesBuffer = storage(ptScene.nodes);
  const trisBuffer = storage(ptScene.triangles);
  const triOrderBuffer = storage(ptScene.triangleOrder);
  const materialsBuffer = storage(ptScene.materials);
  const accumFloats = new Float32Array(width * height * 4);
  const accumBuffer = device.createBuffer({ size: accumFloats.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const ptUniform = device.createBuffer({ size: PT_UNIFORM_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const ptBindGroup = device.createBindGroup({
    layout: ptPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: ptUniform } },
      { binding: 1, resource: { buffer: nodesBuffer } },
      { binding: 2, resource: { buffer: trisBuffer } },
      { binding: 3, resource: { buffer: triOrderBuffer } },
      { binding: 4, resource: { buffer: materialsBuffer } },
      { binding: 5, resource: { buffer: accumBuffer } },
    ],
  });

  // Fullscreen pass that tonemaps the accumulated mean to the swap chain.
  const ptDisplayModule = device.createShaderModule({
    code: `
struct Info { width: u32, height: u32, exposure: f32, pad: u32 };
@group(0) @binding(0) var<storage, read> accum : array<vec4<f32>>;
@group(0) @binding(1) var<uniform> info : Info;
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
  var p = array<vec2<f32>, 3>(vec2<f32>(-1.0, -3.0), vec2<f32>(-1.0, 1.0), vec2<f32>(3.0, 1.0));
  return vec4<f32>(p[i], 0.0, 1.0);
}
fn tonemap(c: vec3<f32>) -> vec3<f32> {
  let x = c * exp2(info.exposure);
  return x / (x + vec3<f32>(1.0));
}
@fragment fn fs(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
  let idx = u32(frag.y) * info.width + u32(frag.x);
  return vec4<f32>(tonemap(accum[idx].xyz), 1.0);
}
`,
  });
  const ptDisplayPipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: { module: ptDisplayModule, entryPoint: 'vs' },
    fragment: { module: ptDisplayModule, entryPoint: 'fs', targets: [{ format: outputFormat }] },
    primitive: { topology: 'triangle-list' },
  });
  const ptInfo = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(ptInfo, 0, new Uint32Array([width, height, 0, 0]));
  device.queue.writeBuffer(ptInfo, 8, new Float32Array([frame.camera.exposure]));
  const ptDisplayBindGroup = device.createBindGroup({
    layout: ptDisplayPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: accumBuffer } },
      { binding: 1, resource: { buffer: ptInfo } },
    ],
  });
  const [wgX, wgY] = PathTraceBackend.workgroupCount(width, height);

  function resetPathTrace(): void {
    ptBackend.resetAccumulation();
    device.queue.writeBuffer(accumBuffer, 0, accumFloats);
  }

  function renderPathTrace(targetView: GPUTextureView): void {
    const frameIndex = ptBackend.advanceFrame();
    device.queue.writeBuffer(ptUniform, 0, buildPathTraceUniform(ptScene, frameIndex, 1, width, height));
    const encoder = device.createCommandEncoder();
    const compute = encoder.beginComputePass();
    compute.setPipeline(ptPipeline);
    compute.setBindGroup(0, ptBindGroup);
    compute.dispatchWorkgroups(wgX, wgY, 1);
    compute.end();
    const render = encoder.beginRenderPass({
      colorAttachments: [{ view: targetView, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
    });
    render.setPipeline(ptDisplayPipeline);
    render.setBindGroup(0, ptDisplayBindGroup);
    render.draw(3);
    render.end();
    device.queue.submit([encoder.finish()]);
  }

  // The engine owns the shared scene and arbitrates backend switching without
  // reimporting it. Press "r" for raster and "p" for path tracing.
  const engine = new RenderEngine();
  engine.loadScene(scene);
  engine.prepareBackend('raster');
  engine.prepareBackend('pathtracing');
  engine.setBackend('raster');

  const note = warnings.length ? ` (${warnings.length} diagnostic(s))` : '';
  function status(): void {
    const kind = engine.backend;
    const extra = kind === 'pathtracing' ? `, ${engine.accumulatedFrames} spp` : '';
    setStatus(`Backend ${kind}: ${frame.draws.length} object(s), passes [${frame.passes.join(', ')}]${extra}${note}. [r]aster / [p]athtracing`);
  }

  let raf = 0;
  function loop(): void {
    const targetView = ctx.getCurrentTexture().createView();
    if (engine.backend === 'pathtracing') {
      renderPathTrace(targetView);
      engine.renderFrame();
      status();
      raf = requestAnimationFrame(loop);
    } else {
      renderRaster(targetView);
      status();
    }
  }

  function selectBackend(kind: BackendKind): void {
    if (kind === engine.backend) return;
    cancelAnimationFrame(raf);
    engine.setBackend(kind);
    if (kind === 'pathtracing') resetPathTrace();
    loop();
  }

  window.addEventListener('keydown', (e) => {
    if (e.key === 'r') selectBackend('raster');
    else if (e.key === 'p') selectBackend('pathtracing');
  });

  loop();
}

void main();
