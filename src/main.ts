// Browser entry point (T026b, T051). Drives the executable raster backend on a
// real scene: it builds a composed SceneAsset, resolves its USD lights (and
// camera when present), turns it into GPU resources through the SceneAsset -> GPU
// bridge (src/render/scene-resources.ts), assembles a multi-object render plan
// with the effectively-active passes (src/render/raster/scene-frame.ts), uploads
// every prototype's geometry, records one scene forward pass per active pass into
// an HDR target, and resolves it to the canvas. The demo SceneAsset stands in for
// the crate/USD loader (T048 follow-up) that will supply real assets; the runtime
// flow -- scene -> camera/lights -> resources -> frame -> GPU passes -- is the real
// path, no longer a hard-coded triangle with hard-coded uniforms.

import { emitWgsl } from './compiler/wgsl.ts';
import { FLOAT, IrModuleBuilder, shaderType } from './compiler/ir.ts';
import { RasterBackend, RESOLVE_UNIFORM_SIZE, SCENE_FORWARD_UNIFORM_SIZE, type ScenePassKind, type SceneDrawCall } from './render/raster/backend.ts';
import { buildSceneFrame, buildSceneUniform, type FrameCamera } from './render/raster/scene-frame.ts';
import { buildSceneResources, uploadGeometry, type MaterialBuild, type MaterialCompiler, type MeshSource } from './render/scene-resources.ts';
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

  const encoder = device.createCommandEncoder();
  let first = true;
  for (const pass of frame.passes) {
    const draws = drawsByPass.get(pass) ?? [];
    if (draws.length === 0) continue;
    backend.recordScenePass(encoder, { pass, hdrView, depthView, draws, clear: first });
    first = false;
  }
  backend.recordResolvePass(encoder, { outputView: context.getCurrentTexture().createView(), bindGroup: resolveBindGroup });
  device.queue.submit([encoder.finish()]);

  const note = warnings.length ? ` (${warnings.length} diagnostic(s))` : '';
  setStatus(`WebGPU scene frame: ${frame.draws.length} object(s), passes [${frame.passes.join(', ')}]${note}.`);
}

void main();
