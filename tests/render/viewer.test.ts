import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InteractiveViewer, type ViewerStatus } from '../../src/render/viewer.ts';
import { loadUsdScene, type LoadedUsdScene } from '../../src/render/usd-scene-assets.ts';
import { buildCachedPathTraceScene } from '../../src/render/pathtracing/scene-buffers.ts';
import { generateEnvironmentMipmaps } from '../../src/render/env/mipmaps.ts';
import { buildSceneResources } from '../../src/render/scene-resources.ts';
import { importUsdStage } from '../../src/usd/importer.ts';
import { NEUTRAL_SURFACE, SCENE_FRAME_UNIFORM_FLOATS } from '../../src/render/raster/scene-frame.ts';
import { projectIrradianceSH } from '../../src/render/env/irradiance.ts';
import { buildEnvCdf } from '../../src/assets/environment-cdf.ts';
import { JsDenoiser } from '../../src/render/pathtracing/js-denoiser.ts';
import { compileEditableMaterial, editableSceneMaterials, materialUniformData } from '../../src/render/material-parameters.ts';
import { applySceneDisplacement } from '../../src/render/displacement.ts';
import { uploadMaterialTextures } from '../../src/render/usd-scene-assets.ts';
import { PT_UNIFORM_SIZE, pathTraceTile, pathTraceTileCount } from '../../src/render/pathtracing/compute.ts';
import type { ShaderCompilationError } from '../../src/gpu/shader-diagnostics.ts';
import { exportCompiledMaterial, exportCompiledScene } from '../../src/scene/compiled-scene.ts';
import { exportSurfaceGraph } from '../../src/materialx/graph-export.ts';
import { DisneyGpuBackend } from '../../src/render/pathtracing/disney-gpu-backend.ts';
import { tonemapIndex } from '../../src/render/output.ts';
import {
  loadMaterialPreviewShaderBall, materialPreviewCamera, materialPreviewResources,
} from '../../src/render/material-preview.ts';
import { IDENTITY4, inverse4, translation4 } from '../../src/scene/transforms.ts';
import {
  pathTraceViewIndex, PT_DISPLAY_INFO_BYTES, PT_DISPLAY_PIXEL_BYTES, PT_SURFACE_AOV_PIXEL_BYTES,
} from '../../src/render/pathtracing/display.ts';
import { PT_CONVERGENCE_UNIFORM_BYTES } from '../../src/render/pathtracing/convergence.ts';
import type { ResolvedGraph } from '../../src/materialx/graph.ts';

vi.mock('../../src/render/usd-scene-assets.ts', async (original) => ({
  ...await original<typeof import('../../src/render/usd-scene-assets.ts')>(),
  loadUsdScene: vi.fn(),
}));
vi.mock('../../src/render/pathtracing/scene-buffers.ts', async (original) => ({
  ...await original<typeof import('../../src/render/pathtracing/scene-buffers.ts')>(),
  buildCachedPathTraceScene: vi.fn(),
}));
vi.mock('../../src/render/material-preview.ts', async (original) => ({
  ...await original<typeof import('../../src/render/material-preview.ts')>(),
  loadMaterialPreviewShaderBall: vi.fn(),
}));

function fakeDevice() {
  const pass = {
    setPipeline: vi.fn(), setBindGroup: vi.fn(), setVertexBuffer: vi.fn(), setIndexBuffer: vi.fn(),
    setScissorRect: vi.fn(), drawIndexed: vi.fn(), draw: vi.fn(), end: vi.fn(),
    dispatchWorkgroups: vi.fn(),
  };
  const textures: Array<{ destroy: ReturnType<typeof vi.fn> }> = [];
  const createRenderPipeline = vi.fn((_descriptor?: GPURenderPipelineDescriptor) => ({ getBindGroupLayout: vi.fn(() => ({})) }));
  const device = {
    limits: { maxStorageBufferBindingSize: 1 << 28, maxBufferSize: 1 << 28, maxTextureArrayLayers: 256,
      maxTextureDimension2D: 8192, maxComputeWorkgroupsPerDimension: 65535 },
    createBuffer: vi.fn((desc: GPUBufferDescriptor) => ({
      destroy: vi.fn(), mapAsync: vi.fn(async () => {}), getMappedRange: () => new ArrayBuffer(desc.size), unmap: vi.fn(),
    })),
    createTexture: vi.fn((desc: GPUTextureDescriptor) => {
      const texture = { mipLevelCount: desc.mipLevelCount ?? 1, createView: vi.fn(() => ({})), destroy: vi.fn() };
      textures.push(texture);
      return texture;
    }),
    createShaderModule: vi.fn((_desc: GPUShaderModuleDescriptor) => ({
      getCompilationInfo: async (): Promise<Pick<GPUCompilationInfo, 'messages'>> => ({ messages: [] }),
    })),
    createRenderPipeline,
    createRenderPipelineAsync: vi.fn(async (descriptor: GPURenderPipelineDescriptor) => createRenderPipeline(descriptor)),
    createComputePipelineAsync: vi.fn(async () => ({ getBindGroupLayout: vi.fn(() => ({})) })),
    createBindGroup: vi.fn((_desc: GPUBindGroupDescriptor) => ({})),
    createSampler: vi.fn(() => ({})),
    createCommandEncoder: vi.fn(() => ({
      beginRenderPass: vi.fn(() => pass), beginComputePass: vi.fn(() => pass),
      clearBuffer: vi.fn(), copyBufferToBuffer: vi.fn(), copyTextureToBuffer: vi.fn(), finish: vi.fn(() => ({})),
    })),
    pushErrorScope: vi.fn(),
    popErrorScope: vi.fn(async () => null),
    queue: {
      writeBuffer: vi.fn(), writeTexture: vi.fn(), submit: vi.fn(),
      onSubmittedWorkDone: vi.fn(async () => {}),
    },
  };
  return { device, gpu: device as unknown as GPUDevice, pass, textures };
}

interface SceneFixtureOptions {
  twoObjects?: boolean;
  textureNode?: boolean;
  transmission?: boolean;
  displaced?: boolean;
  volumeBoundary?: boolean;
  transformNode?: boolean;
}

async function sceneFixture(editable = false, options: SceneFixtureOptions = {}): Promise<LoadedUsdScene> {
  const imported = await importUsdStage('scene.usda', {
    reader: { read: async () => `#usda 1.0
def Xform "World" {
  def Mesh "Ball" {
    rel material:binding = </World/Material>
  }
  def Material "Material" {
    token outputs:surface.connect = </World/Material/Surface.outputs:surface>
    def Shader "Surface" {
      uniform token info:id = "UsdPreviewSurface"
      color3f inputs:diffuseColor = (0.5, 0.5, 0.5)
      token outputs:surface
    }
  }
}` },
  });
  const { lowerPreviewSurfaceMaterials } = await import('../../src/usd/preview-surface.ts');
  const lowered = lowerPreviewSurfaceMaterials(imported);
  const scene = { ...imported, materials: [...imported.materials, ...lowered.map((material) => material.reference)] };
  // The lifecycle test only needs one valid layered shader; graph construction is tested separately.
  const { resolveSurface } = await import('../../src/materialx/surface-graph.ts');
  const { emitLayeredSurface } = await import('../../src/compiler/surface-wgsl.ts');
  const { IrModuleBuilder, FLOAT } = await import('../../src/compiler/ir.ts');
  const { emitWgsl } = await import('../../src/compiler/wgsl.ts');
  const graph: ResolvedGraph = {
    terminals: [{ name: 'surfaceshader', type: 'surfaceshader', nodeId: 's', provenance: { namePath: '/s' } }],
    nodes: new Map([['s', { id: 's', category: 'standard_surface', type: 'surfaceshader', inputs: [
      { name: 'base_color', type: 'color3', source: { kind: 'value' as const, type: 'color3', value: '0.8, 0.8, 0.8' }, provenance: { namePath: '/s/base_color' } },
      { name: 'coat', type: 'float', source: { kind: 'value' as const, type: 'float', value: '0' }, provenance: { namePath: '/s/coat' } },
      { name: 'specular_roughness', type: 'float', min: [0], max: [1], source: { kind: 'value' as const, type: 'float', value: '0.2' }, provenance: { namePath: '/s/specular_roughness' } },
      { name: 'diffuse_roughness', type: 'float', source: { kind: 'value' as const, type: 'float', value: '0.8' }, provenance: { namePath: '/s/diffuse_roughness' } },
      { name: 'coat_roughness', type: 'float', source: { kind: 'value' as const, type: 'float', value: '0.1' }, provenance: { namePath: '/s/coat_roughness' } },
      ...(options.transmission ? [
        { name: 'transmission', type: 'float', source: { kind: 'value' as const, type: 'float', value: '0' }, provenance: { namePath: '/s/transmission' } },
      ] : []),
    ], provenance: { namePath: '/s' } }]]),
  };
  if (options.textureNode) graph.nodes.set('image', {
    id: 'image', category: 'image', type: 'color3',
    inputs: [{ name: 'file', type: 'filename', source: { kind: 'value', type: 'filename', value: 'texture.png' },
      provenance: { namePath: '/image/file' } }],
    provenance: { namePath: '/image' },
  });
  if (options.transmission) graph.nodes.set('amount', {
    id: 'amount', category: 'constant', type: 'float',
    inputs: [{ name: 'value', type: 'float', source: { kind: 'value', type: 'float', value: '0.5' },
      provenance: { namePath: '/amount/value' } }],
    provenance: { namePath: '/amount' },
  });
  if (options.transformNode) {
    graph.nodes.set('spaceTransform', {
      id: 'spaceTransform', category: 'transformpoint', type: 'vector3',
      inputs: [
        { name: 'in', type: 'vector3', source: { kind: 'value', type: 'vector3', value: '1,2,3' }, provenance: { namePath: '/spaceTransform/in' } },
        { name: 'fromspace', type: 'string', source: { kind: 'value', type: 'string', value: 'world' }, provenance: { namePath: '/spaceTransform/fromspace' } },
        { name: 'tospace', type: 'string', source: { kind: 'value', type: 'string', value: 'object' }, provenance: { namePath: '/spaceTransform/tospace' } },
      ],
      provenance: { namePath: '/spaceTransform' },
    });
    graph.nodes.set('transformColor', {
      id: 'transformColor', category: 'convert', type: 'color3',
      inputs: [{ name: 'in', type: 'vector3', source: { kind: 'connection', nodeId: 'spaceTransform' },
        provenance: { namePath: '/transformColor/in' } }],
      provenance: { namePath: '/transformColor' },
    });
  }
  if (options.displaced) {
    for (const [id, file] of [['height', 'height.png'], ['otherHeight', 'other.png']] as const) {
      graph.nodes.set(id, {
        id, category: 'image', type: 'float',
        inputs: [{ name: 'file', type: 'filename', source: { kind: 'value', type: 'filename', value: file },
          provenance: { namePath: `/${id}/file` } }],
        provenance: { namePath: `/${id}` },
      });
    }
    graph.nodes.set('disp', {
      id: 'disp', category: 'displacement', type: 'displacementshader',
      inputs: [
        { name: 'scale', type: 'float', source: { kind: 'value', type: 'float', value: '0.1' }, provenance: { namePath: '/disp/scale' } },
        { name: 'displacement', type: 'float', source: { kind: 'connection', nodeId: 'height' }, provenance: { namePath: '/disp/displacement' } },
      ],
      provenance: { namePath: '/disp' },
    });
    graph.terminals = [...graph.terminals, {
      name: 'displacementshader', type: 'displacementshader', nodeId: 'disp', provenance: { namePath: '/disp' },
    }];
  }
  const builder = new IrModuleBuilder();
  builder.output({ name: 'color', type: FLOAT, ref: builder.constant(FLOAT, 1) });
  const ir = builder.build();
  let resources = await buildSceneResources(scene, {
    meshSource: { meshFor: () => ({
      points: [-1, 0, 0, 1, 0, 0, 0, 1, 0], faceVertexCounts: [3], faceVertexIndices: [0, 1, 2],
      ...(options.displaced ? { primvars: [
        { name: 'st', interpolation: 'vertex' as const, elementSize: 2, values: [0, 0, 1, 0, 0, 1] },
      ] } : {}),
    }) },
    materialCompiler: {
      compile: () => ({ ir, module: emitWgsl(ir), layered: emitLayeredSurface(graph, resolveSurface(graph, {})!),
        ...(editable ? { graph, surface: resolveSurface(graph, {})! } : {}) }),
    },
  });
  if (options.transformNode) resources.instances[0]!.transform = translation4(2, 3, 4);
  if (options.twoObjects) {
    resources = { ...resources, instances: [...resources.instances, {
      ...resources.instances[0]!, id: '/World/Other', primPath: '/World/Other',
    }] };
  }
  const imageProvider = { decode: async () => options.textureNode || options.displaced ? {
    kind: 'pixels' as const, componentType: 'uint8' as const, channels: 4 as const, colorSpace: 'raw',
    width: 1, height: 1, data: new Uint8Array([128, 64, 32, 255]),
  } : undefined };
  let parameterResources = editable ? editableSceneMaterials(resources) : undefined;
  if (parameterResources && options.displaced) {
    const key = parameterResources.instances[0]!.materialKey!;
    const materials = new Map(parameterResources.materials);
    materials.set(key, compileEditableMaterial({ ...materials.get(key)!, displacement: { file: 'height.png', scale: 0.1 } }));
    parameterResources = { ...parameterResources, materials };
  }
  if (parameterResources && options.volumeBoundary) {
    const key = parameterResources.instances.at(-1)!.materialKey!;
    const materials = new Map(parameterResources.materials);
    materials.set(key, { ...materials.get(key)!, volumeBoundary: true });
    parameterResources = { ...parameterResources, materials };
  }
  const renderResources = parameterResources
    ? await applySceneDisplacement(parameterResources, imageProvider) : resources;
  return {
    entry: 'https://example.test/scenes/source/scene.usda', scene,
    resources: renderResources,
    ...(parameterResources ? { parameterResources } : {}), lights: [], cameras: [],
    mtlx: {
      documents: { documentFor: () => undefined, delete: vi.fn() },
      surfaceFor: () => NEUTRAL_SURFACE,
      imageProvider,
    },
  };
}

describe('interactive viewer resource lifecycle', () => {
  let tick: FrameRequestCallback;
  let viewer: InteractiveViewer | undefined;

  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { tick = callback; return 1; });
    vi.stubGlobal('GPUBufferUsage', { VERTEX: 1, INDEX: 2, COPY_DST: 4, UNIFORM: 8, STORAGE: 16, COPY_SRC: 32, MAP_READ: 64 });
    vi.stubGlobal('GPUTextureUsage', { TEXTURE_BINDING: 1, COPY_DST: 2, RENDER_ATTACHMENT: 4, COPY_SRC: 8 });
    vi.stubGlobal('GPUMapMode', { READ: 1 });
    const stored = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
    });
    vi.stubGlobal('ImageData', class {
      constructor(public data: Uint8ClampedArray, public width: number, public height: number) {}
    });
    vi.mocked(buildCachedPathTraceScene).mockReset();
    vi.mocked(loadMaterialPreviewShaderBall).mockReset();
  });
  afterEach(() => { viewer?.dispose(); vi.unstubAllGlobals(); });

  async function setup(
    environment = false, editable = false, backend: 'raster' | 'pathtracing' = 'raster',
    orbitControls = true, options: SceneFixtureOptions = {},
  ) {
    const loaded = await sceneFixture(editable, options);
    if (environment) {
      const image = { width: 4, height: 2, data: new Float32Array(24).fill(1) };
      loaded.environment = {
        image, sh: projectIrradianceSH(image), averageRadiance: [1, 1, 1], tint: [1, 1, 1], intensity: 1,
      };
    }
    vi.mocked(loadUsdScene).mockResolvedValue(loaded);
    const mock = fakeDevice();
    const canvas = {
      width: 512, height: 512, style: {}, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    } as unknown as HTMLCanvasElement;
    const statuses: ViewerStatus[] = [];
    const diagnostics: Array<readonly ShaderCompilationError[]> = [];
    viewer = new InteractiveViewer({
      device: mock.gpu, context: { getCurrentTexture: () => ({ createView: () => ({}) }) } as unknown as GPUCanvasContext,
      outputFormat: 'bgra8unorm', canvas, orbitControls, onStatus: (status) => statuses.push(status),
      onShaderErrors: errors => diagnostics.push(errors),
    });
    viewer.setBackend(backend);
    await viewer.load('scene.usda');
    return { ...mock, loaded, canvas, statuses, diagnostics, viewer };
  }

  it('keeps canvas orbit listeners disabled after loading a scene', async () => {
    const { canvas, viewer } = await setup(false, false, 'raster', false);
    await viewer.load('another-scene.usda');
    expect(canvas.addEventListener).not.toHaveBeenCalled();
  });

  it('submits a headless raster frame only when given an output texture', async () => {
    const requestFrame = vi.fn();
    vi.stubGlobal('requestAnimationFrame', requestFrame);
    const { device, gpu, pass } = fakeDevice();
    vi.mocked(loadUsdScene).mockResolvedValue(await sceneFixture());
    viewer = new InteractiveViewer({ device: gpu, outputFormat: 'rgba8unorm', width: 130, height: 80 });
    await viewer.load('scene.usda');
    expect(requestFrame).not.toHaveBeenCalled();
    expect(device.queue.submit).not.toHaveBeenCalled();

    const output = device.createTexture({ size: [130, 80], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT });
    const outputView = output.createView() as GPUTextureView;
    viewer.renderRasterTo(outputView);

    expect(device.queue.submit).toHaveBeenCalledOnce();
    expect(pass.drawIndexed).toHaveBeenCalled();
    expect(requestFrame).not.toHaveBeenCalled();
  });

  it('captures exactly the requested full-resolution path-tracing sweeps from scratch', async () => {
    const actual = await vi.importActual<typeof import('../../src/render/pathtracing/scene-buffers.ts')>(
      '../../src/render/pathtracing/scene-buffers.ts');
    vi.mocked(buildCachedPathTraceScene).mockImplementation(actual.buildCachedPathTraceScene);
    vi.mocked(loadUsdScene).mockResolvedValue(await sceneFixture());
    const { gpu, device, pass } = fakeDevice();
    Object.assign(device, { pushErrorScope: vi.fn(), popErrorScope: async () => null });
    const width = 270, height = 80;
    viewer = new InteractiveViewer({ device: gpu, outputFormat: 'rgba8unorm', width, height });
    await viewer.load('scene.usda');
    const texture = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT });
    const target = texture.createView() as GPUTextureView;

    for (const samples of [2, 1]) {
      pass.dispatchWorkgroups.mockClear();
      device.queue.writeBuffer.mockClear();
      await viewer.renderPathTraceTo(target, samples);
      const tiles = pathTraceTileCount(width, height);
      const uniforms = device.queue.writeBuffer.mock.calls.map(call => call[2])
        .filter((data): data is Float32Array => data instanceof Float32Array && data.byteLength === PT_UNIFORM_SIZE);
      expect(pass.dispatchWorkgroups).toHaveBeenCalledTimes(tiles * samples);
      expect(uniforms.map(u => Array.from(u.subarray(32, 36)))).toEqual(
        Array.from({ length: tiles * samples }, (_, i) => [Math.floor(i / tiles), 1, width, height]),
      );
    }
    expect(buildCachedPathTraceScene).toHaveBeenCalledOnce();
  });

  it('does not allocate raster textures, geometry or pipelines on a path-tracing-only load', async () => {
    const { viewer, device } = await setup(false, false, 'pathtracing');
    expect(device.createRenderPipeline).not.toHaveBeenCalled();
    expect(device.createTexture).not.toHaveBeenCalled();
    expect(device.createBuffer).not.toHaveBeenCalled();
    await viewer.resize(256);
    await viewer.setRasterQuality('reference');
    expect(device.createRenderPipeline).not.toHaveBeenCalled();
    expect(device.createTexture).not.toHaveBeenCalled();
  });

  it('composites pure volumes in HDR without drawing their boundaries as opaque surfaces', async () => {
    const { loaded, viewer, device, pass } = await setup(false, false, 'pathtracing');
    const { IrModuleBuilder, FLOAT, vector, shaderType } = await import('../../src/compiler/ir.ts');
    const builder = new IrModuleBuilder();
    const ref = builder.add({ kind:'closure',type:shaderType('volume'),closure:'vdf',op:'anisotropic_vdf',
      params: { absorption:builder.constant(vector(3),[0.1,0.2,0.3]),scattering:builder.constant(vector(3),[0.4,0.4,0.4]),
        anisotropy:builder.constant(FLOAT,0) } });
    builder.output({ name:'volumeshader',type:shaderType('volume'),ref });
    for (const material of loaded.resources.materials.values()) {
      material.volumeMedium = { absorption: [0.1, 0.2, 0.3], scattering: [0.4, 0.4, 0.4], anisotropy: 0 };
      material.volumeIr = builder.build();
      material.volumeBoundary = true;
    }
    const { buildPathTraceScene } = await import('../../src/render/pathtracing/scene-buffers.ts');
    vi.mocked(buildCachedPathTraceScene).mockResolvedValue(buildPathTraceScene(loaded.resources));
    viewer.setBackend('raster');
    tick(0);
    await vi.waitFor(() => expect(device.createShaderModule.mock.calls.some(([desc]) => desc.label === 'Raster volume')).toBe(true));
    await new Promise(resolve => setTimeout(resolve,10));
    tick(1);
    expect(viewer.backend).toBe('raster');
    expect(pass.drawIndexed).not.toHaveBeenCalled();
    expect(pass.draw).toHaveBeenCalled();
    const targets = device.createTexture.mock.calls.length;
    await viewer.resize(256);
    expect(device.createTexture.mock.calls.length).toBeGreaterThan(targets);
  });

  it('builds raster once when switching from path tracing and reuses it on subsequent switches', async () => {
    const { viewer, device, pass } = await setup(false, false, 'pathtracing');
    viewer.setBackend('raster');
    tick(0);
    await vi.waitFor(() => expect(device.createRenderPipeline).toHaveBeenCalled());
    await new Promise(resolve => setTimeout(resolve, 10));
    tick(1);
    await Promise.resolve();
    expect(pass.drawIndexed).toHaveBeenCalled();
    const pipelines = device.createRenderPipeline.mock.calls.length;
    viewer.setBackend('pathtracing');
    viewer.setBackend('raster');
    tick(2);
    expect(device.createRenderPipeline).toHaveBeenCalledTimes(pipelines);
  });

  it('reports deferred raster preparation errors without retrying every frame', async () => {
    const { viewer, device, diagnostics } = await setup(false, false, 'pathtracing');
    device.createRenderPipeline.mockImplementationOnce(() => { throw new Error('Raster driver failure'); });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      viewer.setBackend('raster');
      tick(0);
      await vi.waitFor(() => expect(diagnostics.at(-1)?.[0]?.message).toBe('Raster driver failure'));
      tick(1);
      expect(device.createRenderPipeline).toHaveBeenCalledTimes(1);
      expect(log).toHaveBeenCalled();
    } finally { log.mockRestore(); }
  });

  it('starts the path tracer without building raster pipelines', async () => {
    const actual = await vi.importActual<typeof import('../../src/render/pathtracing/scene-buffers.ts')>(
      '../../src/render/pathtracing/scene-buffers.ts');
    vi.mocked(buildCachedPathTraceScene).mockImplementation(actual.buildCachedPathTraceScene);
    const { viewer, device, statuses } = await setup(false, false, 'pathtracing');
    tick(0);
    await vi.waitFor(() => expect(statuses.at(-1)?.pathTracer).toBe('ready'));
    expect(device.createComputePipelineAsync).toHaveBeenCalledTimes(2);
    expect(device.createShaderModule.mock.calls.some(call =>
      /^Raster/.test(call[0].label ?? ''))).toBe(false);
    viewer.dispose();
  });

  it('loads compiled entries into both backends without invoking USD import or the path-trace scene builder', async () => {
    const actual = await vi.importActual<typeof import('../../src/render/pathtracing/scene-buffers.ts')>(
      '../../src/render/pathtracing/scene-buffers.ts');
    vi.mocked(buildCachedPathTraceScene).mockImplementation(actual.buildCachedPathTraceScene);
    const { viewer, loaded, device, statuses } = await setup(false, true, 'pathtracing');
    const compiled = await exportCompiledScene(loaded);
    vi.mocked(buildCachedPathTraceScene).mockReset();
    vi.mocked(loadUsdScene).mockClear();
    const requests: string[] = [];
    vi.stubGlobal('fetch', async (input: string) => {
      requests.push(input);
      if (input.endsWith('/scene.json')) return new Response(JSON.stringify(compiled.manifest));
      const path = new URL(input).pathname.slice('/scenes/prepared/'.length);
      const bytes = compiled.files.get(path);
      return bytes ? new Response(bytes) : new Response(null, { status: 404 });
    });
    await viewer.load('https://example.test/scenes/prepared/scene.json');
    expect(viewer.isCompiledScene).toBe(true);
    tick(0);
    await vi.waitFor(() => expect(statuses.at(-1)?.pathTracer).toBe('ready'));
    expect(buildCachedPathTraceScene).not.toHaveBeenCalled();
    expect(loadUsdScene).not.toHaveBeenCalled();
    expect(requests.every(url => url.startsWith('https://example.test/scenes/prepared/'))).toBe(true);
    viewer.setBackend('raster');
    tick(1);
    await vi.waitFor(() => expect(device.createRenderPipeline).toHaveBeenCalled());
    await viewer.setObjectMaterial('/World/Ball');
    expect(loadUsdScene).not.toHaveBeenCalled();
    expect(buildCachedPathTraceScene).not.toHaveBeenCalled();
    await viewer.setObjectParameters('/World/Ball', new Map([['surface:specular_roughness', [0.7]]]));
    expect(viewer.objectParameters('/World/Ball').find(parameter => parameter.id === 'surface:specular_roughness')?.value).toEqual([0.7]);
    expect(viewer.isCompiledScene).toBe(true);
  });

  it('opens a USDA layer referencing compiled binaries and applies precompiled materials without MaterialX', async () => {
    const actual = await vi.importActual<typeof import('../../src/render/pathtracing/scene-buffers.ts')>(
      '../../src/render/pathtracing/scene-buffers.ts');
    vi.mocked(buildCachedPathTraceScene).mockImplementation(actual.buildCachedPathTraceScene);
    const { viewer, loaded } = await setup(false, true, 'raster');
    const compiled = await exportCompiledScene(loaded);
    const material = await exportCompiledMaterial(loaded, '/World/Ball');
    vi.mocked(loadUsdScene).mockClear();
    const layer = [
      '#usda 1.0', '(', '    customLayerData = {',
      '        string "materialx:compiledScene" = "./ball/scene.json"',
      '        string "materialx:compiledShaders" = "../shared/shaders.wgsl.zst"',
      '        string "materialx:source" = "../../ball.usda"',
      '    }', '    subLayers = [@../../ball.usda@]', ')', '', 'def Xform "World" {}', '',
    ].join('\n');
    const requests: string[] = [];
    vi.stubGlobal('fetch', async (input: string) => {
      requests.push(input);
      const path = new URL(input).pathname;
      if (path === '/scenes/compiled/ball.usda') return new Response(layer);
      if (path === '/scenes/compiled/ball/scene.json') return new Response(JSON.stringify(compiled.manifest));
      if (path === '/scenes/shared/shaders.wgsl.zst') return new Response(compiled.files.get('shaders.wgsl.zst'));
      if (path === '/materials/gold/material.json') return new Response(JSON.stringify(material.manifest));
      const bytes = path.startsWith('/scenes/compiled/ball/') && path !== '/scenes/compiled/ball/shaders.wgsl.zst'
        ? compiled.files.get(path.slice('/scenes/compiled/ball/'.length))
        : path.startsWith('/materials/gold/') ? material.files.get(path.slice('/materials/gold/'.length)) : undefined;
      return bytes ? new Response(bytes) : new Response(null, { status: 404 });
    });
    await viewer.load('https://example.test/scenes/compiled/ball.usda');
    expect(viewer.isCompiledScene).toBe(true);
    expect(loadUsdScene).not.toHaveBeenCalled();
    expect(requests).toContain('https://example.test/scenes/shared/shaders.wgsl.zst');
    await viewer.setObjectMaterial('/World/Ball', 'https://example.test/gold.mtlx', 'https://example.test/materials/gold/material.json');
    expect(loadUsdScene).not.toHaveBeenCalled();
    expect(viewer.objects.find(object => object.path === '/World/Ball')?.assetPath).toBe('https://example.test/gold.mtlx');
    expect(viewer.objectParameters('/World/Ball').length).toBeGreaterThan(0);
    await viewer.setObjectMaterial('/World/Ball');
    expect(viewer.objects.find(object => object.path === '/World/Ball')?.assetPath).toBeUndefined();
    expect(viewer.isCompiledScene).toBe(true);
  });

  it('names an oversized scene buffer and rejects it before compiling the compute shader', async () => {
    const actual = await vi.importActual<typeof import('../../src/render/pathtracing/scene-buffers.ts')>(
      '../../src/render/pathtracing/scene-buffers.ts');
    vi.mocked(buildCachedPathTraceScene).mockImplementation(actual.buildCachedPathTraceScene);
    const { device, statuses, diagnostics } = await setup(false, false, 'pathtracing');
    Object.assign(device.limits, { maxStorageBufferBindingSize: 64 });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      tick(0);
      await vi.waitFor(() => expect(statuses.at(-1)?.pathTracer).toBe('error'));
      expect(diagnostics.at(-1)?.[0]?.message).toContain('Scene storage buffer "triangles" requires 76 bytes');
      expect(device.createShaderModule).not.toHaveBeenCalled();
      expect(device.createComputePipelineAsync).not.toHaveBeenCalled();
    } finally { log.mockRestore(); }
  });

  it('reports texture/sampler capability failures in shader diagnostics before compilation starts', async () => {
    const actual = await vi.importActual<typeof import('../../src/render/pathtracing/scene-buffers.ts')>(
      '../../src/render/pathtracing/scene-buffers.ts');
    vi.mocked(buildCachedPathTraceScene).mockImplementation(actual.buildCachedPathTraceScene);
    const { viewer, device, diagnostics, statuses } = await setup(true);
    Object.assign(device.limits, { maxSampledTexturesPerShaderStage: 0, maxSamplersPerShaderStage: 0 });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      viewer.setBackend('pathtracing');
      tick(0);
      await vi.waitFor(() => expect(statuses.at(-1)?.pathTracer).toBe('error'));
      expect(device.createComputePipelineAsync).not.toHaveBeenCalled();
      expect(diagnostics.at(-1)).toEqual([{
        shader: 'Path tracing - preparation / pipeline',
        message: 'Scene requires 1 sampled textures and 1 samplers; device limits are 0 textures and 0 samplers.',
        line: 0, column: 0, source: '',
      }]);
      expect(log).toHaveBeenCalled();
    } finally { log.mockRestore(); }
  });

  it('reports driver pipeline rejections even when WGSL compilation info has no errors', async () => {
    const actual = await vi.importActual<typeof import('../../src/render/pathtracing/scene-buffers.ts')>(
      '../../src/render/pathtracing/scene-buffers.ts');
    vi.mocked(buildCachedPathTraceScene).mockImplementation(actual.buildCachedPathTraceScene);
    const { viewer, device, diagnostics, statuses } = await setup();
    device.createComputePipelineAsync.mockRejectedValueOnce(new Error('Driver rejected compute pipeline'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      viewer.setBackend('pathtracing');
      tick(0);
      await vi.waitFor(() => expect(statuses.at(-1)?.pathTracer).toBe('error'));
      expect(diagnostics.at(-1)?.[0]?.message).toBe('Driver rejected compute pipeline');
      expect(diagnostics.at(-1)?.[0]?.line).toBe(0);
    } finally { log.mockRestore(); }
  });

  it('retains the original WGSL source error instead of replacing it with a generic startup failure', async () => {
    const actual = await vi.importActual<typeof import('../../src/render/pathtracing/scene-buffers.ts')>(
      '../../src/render/pathtracing/scene-buffers.ts');
    vi.mocked(buildCachedPathTraceScene).mockImplementation(actual.buildCachedPathTraceScene);
    const { viewer, device, diagnostics, statuses } = await setup();
    const shaderError: GPUCompilationMessage = {
      type: 'error', message: 'Invalid call', lineNum: 2, linePos: 3, offset: 1, length: 1,
      __brand: 'GPUCompilationMessage',
    };
    device.createShaderModule.mockImplementation(() => ({
      getCompilationInfo: async () => ({ messages: [shaderError] }),
    }));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      viewer.setBackend('pathtracing');
      tick(0);
      await vi.waitFor(() => expect(statuses.at(-1)?.pathTracer).toBe('error'));
      expect(diagnostics.at(-1)).toHaveLength(3);
      expect(diagnostics.at(-1)?.[0]).toMatchObject({
        shader: 'Path tracing', message: 'Invalid call', line: 2, column: 3,
      });
      expect(device.createComputePipelineAsync).not.toHaveBeenCalled();
    } finally { log.mockRestore(); }
  });

  it('toggles environment uniforms without reloading geometry or recompiling and preserves it on reload', async () => {
    const { viewer, device, statuses } = await setup(true);
    const builds = device.createRenderPipeline.mock.calls.length;
    const textureCount = device.createTexture.mock.calls.length;
    device.queue.writeBuffer.mockClear();
    viewer.setEnvironmentEnabled(false);
    expect(viewer.environmentEnabled).toBe(false);
    expect(statuses.at(-1)?.environmentEnabled).toBe(false);
    const updates = device.queue.writeBuffer.mock.calls.filter(call => call[1] === 44 * 4);
    expect(updates.length).toBeGreaterThan(0);
    for (const update of updates) {
      const data = update[2] as Float32Array;
      expect(data.slice(0, 40).every(value => value === 0)).toBe(true);
      expect([...data.slice(40, 43)]).toEqual([0, 0, 0]);
    }
    viewer.setEnvironmentEnabled(true);
    expect(device.createRenderPipeline).toHaveBeenCalledTimes(builds);
    expect(device.createTexture).toHaveBeenCalledTimes(textureCount);
    viewer.setEnvironmentEnabled(false);
    await viewer.load('scene.usda');
    expect(viewer.environmentEnabled).toBe(false);
    const uniforms = device.queue.writeBuffer.mock.calls.map(call => call[2])
      .filter((data): data is Float32Array => data instanceof Float32Array && data.length === SCENE_FRAME_UNIFORM_FLOATS);
    expect(uniforms.length).toBeGreaterThan(0);
    expect(uniforms.at(-1)!.slice(44, 84).every(value => value === 0)).toBe(true);
  });

  it('removes the raster panorama and clears path tracing transport/display when toggled while paused', async () => {
    const actual = await vi.importActual<typeof import('../../src/render/pathtracing/scene-buffers.ts')>(
      '../../src/render/pathtracing/scene-buffers.ts');
    vi.mocked(buildCachedPathTraceScene).mockImplementation(actual.buildCachedPathTraceScene);
    const { viewer, device, pass, statuses } = await setup(true);
    pass.draw.mockClear();
    tick(0);
    await Promise.resolve();
    const enabledDraws = pass.draw.mock.calls.length;
    pass.draw.mockClear();
    viewer.setEnvironmentEnabled(false);
    tick(1);
    await Promise.resolve();
    expect(pass.draw).toHaveBeenCalledTimes(enabledDraws - 1);
    viewer.setEnvironmentEnabled(true);
    viewer.setBackend('pathtracing');
    tick(2);
    await new Promise(resolve => setTimeout(resolve, 20));
    tick(3);
    await Promise.resolve();
    viewer.setPathTracingPaused(true);
    viewer.setEnvironmentEnabled(false);
    expect(statuses.at(-1)?.samples).toBe(0);
    expect(viewer.pathTracingPaused).toBe(true);
    device.queue.writeBuffer.mockClear();
    tick(4);
    await Promise.resolve();
    const info = device.queue.writeBuffer.mock.calls.map(call => call[2])
      .find((data): data is ArrayBuffer => data instanceof ArrayBuffer);
    expect(info).toBeDefined();
    expect([...new Float32Array(info!).slice(28, 35)]).toEqual(Array(7).fill(0));
    expect(device.createComputePipelineAsync).toHaveBeenCalledTimes(2);
  });

  it('frames imported local scenes from their bounds instead of using the fixed USD preview distance', async () => {
    const { viewer, loaded, device } = await setup();
    device.queue.writeBuffer.mockClear();
    await viewer.load('scene.usda', new Map(), false, {
      imported: { scene: loaded.scene, meshSource: { meshFor: () => undefined }, materialTexts: new Map() },
    });
    const eye = [...device.queue.writeBuffer.mock.calls].reverse().find(call =>
      call[1] === 128 && call[2] instanceof Float32Array && call[2].length === 4)?.[2];
    expect(eye).toBeInstanceOf(Float32Array);
    if (!(eye instanceof Float32Array)) throw new Error('Missing camera eye uniform');
    const bounds = loaded.resources.tlas.bounds;
    const center = bounds.min.map((value, index) => (value + bounds.max[index]!) / 2);
    const radius = Math.hypot(...bounds.min.map((value, index) => bounds.max[index]! - value)) / 2;
    expect(Math.hypot(...Array.from(eye).slice(0, 3).map((value, index) => value - center[index]!)))
      .toBeCloseTo(2.4 * radius, 2);
  });

  it('updates live uniforms without reload, GPU recompilation or geometry upload', async () => {
    const { viewer, device, loaded } = await setup(false, true);
    const path = '/World/Ball';
    const original = viewer.objectParameters(path).find(parameter => parameter.id === 'surface:base_color')!.initial;
    const shaders = device.createShaderModule.mock.calls.length;
    const buffers = device.createBuffer.mock.calls.length;
    const loads = vi.mocked(loadUsdScene).mock.calls.length;
    device.queue.writeBuffer.mockClear();
    await viewer.setObjectParameters(path, new Map([['surface:base_color', [0.2, 0.4, 0.8]]]));
    expect(viewer.objectParameters(path).find(parameter => parameter.id === 'surface:base_color')!.value).toEqual([0.2, 0.4, 0.8]);
    const graph = viewer.objectSurfaceGraph(path);
    expect(graph?.nodes.get('s')?.inputs.find(input => input.name === 'base_color')?.source)
      .toMatchObject({ kind: 'value', value: '0.2, 0.4, 0.8' });
    expect(viewer.objectSurfaceGraph('/World/Unknown')).toBeUndefined();
    expect(device.createShaderModule).toHaveBeenCalledTimes(shaders);
    expect(device.createBuffer).toHaveBeenCalledTimes(buffers);
    expect(loadUsdScene).toHaveBeenCalledTimes(loads);
    expect(device.queue.writeBuffer).toHaveBeenCalled();
    const key = loaded.parameterResources!.instances[0]!.materialKey!;
    const data = materialUniformData(loaded.parameterResources!.materials.get(key)!);
    expect(device.queue.writeBuffer.mock.calls.some(call => call[2] instanceof ArrayBuffer
      && new Uint8Array(call[2]).every((value, i) => value === new Uint8Array(data)[i]))).toBe(true);
    await viewer.resetObjectParameters(path);
    expect(viewer.objectParameters(path).find(parameter => parameter.id === 'surface:base_color')!.value).toEqual(original);
  });

  it('updates only the edited raster material in both quality caches and reuses the original pipeline on undo', async () => {
    const { viewer, device, textures } = await setup(true, true, 'raster', true, { twoObjects: true });
    await viewer.setRasterQuality('reference');
    await viewer.setRasterQuality('interactive');
    const otherGraph = viewer.objectSurfaceGraph('/World/Other');
    const geometry = device.createBuffer.mock.calls.flatMap(([descriptor], index) =>
      descriptor.usage & (GPUBufferUsage.VERTEX | GPUBufferUsage.INDEX)
        ? [device.createBuffer.mock.results[index]!.value] : []);
    const textureCount = textures.length;
    const pipelines = device.createRenderPipeline.mock.calls.length;
    const shaders = device.createShaderModule.mock.calls.length;
    await viewer.setObjectConstant('/World/Ball', 's', 'specular_roughness', true, 'multiply');
    expect(viewer.objectSurfaceGraph('/World/Other')).toBe(otherGraph);
    expect(device.createRenderPipeline).toHaveBeenCalledTimes(pipelines + 2);
    expect(device.createShaderModule).toHaveBeenCalledTimes(shaders + 2);
    expect(textures).toHaveLength(textureCount);
    expect(device.createBuffer.mock.calls.filter(([descriptor]) =>
      descriptor.usage & (GPUBufferUsage.VERTEX | GPUBufferUsage.INDEX))).toHaveLength(geometry.length);
    for (const buffer of geometry) expect(buffer.destroy).not.toHaveBeenCalled();

    await viewer.setObjectConstant('/World/Ball', 'specular_roughness_multiply', 'in2', false, 'multiply');
    expect(device.createRenderPipeline).toHaveBeenCalledTimes(pipelines + 2);
    expect(device.createShaderModule).toHaveBeenCalledTimes(shaders + 2);
    expect(viewer.objectSurfaceGraph('/World/Other')).toBe(otherGraph);
    for (const buffer of geometry) expect(buffer.destroy).not.toHaveBeenCalled();
  });

  it('updates the per-instance inverse when a raster material edit introduces a transform', async () => {
    const { viewer, device } = await setup(false, true, 'raster', true, { transformNode: true });
    device.queue.writeBuffer.mockClear();
    await viewer.setObjectGraphInputLink('/World/Ball', 's', 'base_color', 'transformColor');
    const inverseWrite = device.queue.writeBuffer.mock.calls.find(call =>
      call[1] === 92 * 4 && call[2] instanceof Float32Array && call[2].length === 16);
    const data = inverseWrite?.[2];
    if (!(data instanceof Float32Array)) throw new Error('Missing inverse matrix update.');
    expect(Array.from(data)).toEqual(inverse4(translation4(2, 3, 4), true));
  });

  it('updates material textures independently and moves connected transmission between raster passes', async () => {
    const { viewer, textures, statuses, device } = await setup(false, true, 'raster', true, {
      twoObjects: true, textureNode: true, transmission: true,
    });
    await viewer.setObjectGraphInputLink('/World/Other', 's', 'base_color', 'image');
    const otherTexture = textures.at(-1)!;
    const before = textures.length;
    await viewer.setObjectGraphInputLink('/World/Ball', 's', 'base_color', 'image');
    expect(textures).toHaveLength(before + 1);
    const editedTexture = textures.at(-1)!;
    await viewer.setObjectGraphInputLink('/World/Ball', 's', 'transmission', 'amount');
    expect(statuses.at(-1)?.passes).toEqual(['opaque', 'transmission']);
    expect(textures).toHaveLength(before + 1);
    expect(editedTexture.destroy).not.toHaveBeenCalled();
    await viewer.setObjectGraphInputLink('/World/Ball', 's', 'transmission', null);
    expect(statuses.at(-1)?.passes).toEqual(['opaque']);
    await viewer.setObjectGraphInputLink('/World/Ball', 's', 'base_color', null);
    expect(editedTexture.destroy).toHaveBeenCalledOnce();
    expect(otherTexture.destroy).not.toHaveBeenCalled();
    expect(device.createBuffer.mock.calls.filter(([descriptor]) =>
      descriptor.usage & GPUBufferUsage.INDEX)).toHaveLength(1);
  });

  it('keeps the active scene intact if a topology pipeline fails', async () => {
    const { viewer, device } = await setup(false, true, 'raster', true, { twoObjects: true });
    const original = viewer.objectSurfaceGraph('/World/Ball');
    const geometry = device.createBuffer.mock.calls.flatMap(([descriptor], index) =>
      descriptor.usage & GPUBufferUsage.INDEX ? [device.createBuffer.mock.results[index]!.value] : []);
    device.createRenderPipelineAsync.mockRejectedValueOnce(new Error('topology pipeline failed'));
    await expect(viewer.setObjectConstant('/World/Ball', 's', 'specular_roughness', true, 'multiply'))
      .rejects.toThrow('topology pipeline failed');
    expect(viewer.objectSurfaceGraph('/World/Ball')).toBe(original);
    for (const buffer of geometry) expect(buffer.destroy).not.toHaveBeenCalled();
    tick(1);
    expect(device.queue.submit).toHaveBeenCalled();
  });

  it('reports WGSL errors without committing the edited raster graph', async () => {
    const { viewer, device, diagnostics } = await setup(false, true);
    const original = viewer.objectSurfaceGraph('/World/Ball');
    const shaderError: GPUCompilationMessage = {
      __brand: 'GPUCompilationMessage', type: 'error', message: 'invalid edited shader',
      lineNum: 1, linePos: 1, offset: 0, length: 1,
    };
    device.createShaderModule.mockImplementationOnce(() => ({
      getCompilationInfo: async () => ({ messages: [shaderError] }),
    }));
    await expect(viewer.setObjectConstant('/World/Ball', 's', 'specular_roughness', true, 'multiply'))
      .rejects.toThrow('WGSL: 1 erreur');
    expect(viewer.objectSurfaceGraph('/World/Ball')).toBe(original);
    expect(diagnostics.at(-1)).toEqual([expect.objectContaining({ message: 'invalid edited shader' })]);
    await viewer.setObjectConstant('/World/Ball', 's', 'specular_roughness', true, 'multiply');
    expect(diagnostics.at(-1)).toEqual([]);
  });

  it('serializes a quality switch with a concurrent topology edit', async () => {
    const { viewer, device } = await setup(false, true);
    let release!: () => void;
    let started!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const compiling = new Promise<void>(resolve => { started = resolve; });
    device.createRenderPipelineAsync.mockImplementationOnce(async descriptor => {
      started();
      await blocked;
      return device.createRenderPipeline(descriptor);
    });
    const originalPipelines = device.createRenderPipeline.mock.calls.length;
    const quality = viewer.setRasterQuality('reference');
    await compiling;
    const edit = viewer.setObjectConstant('/World/Ball', 's', 'specular_roughness', true, 'multiply');
    release();
    await Promise.all([quality, edit]);
    expect(viewer.rasterQuality).toBe('reference');
    expect(viewer.objectSurfaceGraph('/World/Ball')?.nodes.has('specular_roughness_multiply')).toBe(true);
    expect(device.createRenderPipeline).toHaveBeenCalledTimes(originalPipelines + 3);
    await viewer.setRasterQuality('interactive');
    await viewer.setRasterQuality('reference');
    expect(device.createRenderPipeline).toHaveBeenCalledTimes(originalPipelines + 3);
  });

  it('rejects a stale topology edit rather than losing a concurrent uniform edit', async () => {
    const { viewer, device } = await setup(false, true);
    let release!: () => void;
    let started!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const compiling = new Promise<void>(resolve => { started = resolve; });
    device.createRenderPipelineAsync.mockImplementationOnce(async descriptor => {
      started();
      await blocked;
      return device.createRenderPipeline(descriptor);
    });
    const edit = viewer.setObjectConstant('/World/Ball', 's', 'specular_roughness', true, 'multiply');
    const rejected = expect(edit).rejects.toThrow('Scene changed during material update.');
    await compiling;
    await viewer.setObjectParameters('/World/Ball', new Map([['surface:base_color', [0.2, 0.4, 0.8]]]));
    release();
    await rejected;
    expect(viewer.objectSurfaceGraph('/World/Ball')?.nodes.has('specular_roughness_multiply')).toBe(false);
    expect(viewer.objectParameters('/World/Ball').find(parameter => parameter.input === 'base_color')?.value).toEqual([0.2, 0.4, 0.8]);
  });

  it('retains baked displacement geometry while updating its surface graph', async () => {
    const { viewer, loaded, device } = await setup(false, true, 'raster', true, { displaced: true });
    const bakedGeometry = loaded.resources.geometries;
    const bakedInstances = loaded.resources.instances;
    const indexBuffers = device.createBuffer.mock.calls.flatMap(([descriptor], index) =>
      descriptor.usage & GPUBufferUsage.INDEX ? [device.createBuffer.mock.results[index]!.value] : []);
    await viewer.setObjectConstant('/World/Ball', 's', 'specular_roughness', true, 'multiply');
    expect(loaded.resources.geometries).toBe(bakedGeometry);
    expect(loaded.resources.instances).toBe(bakedInstances);
    expect([...loaded.resources.materials.values()][0]?.displacement).toBeUndefined();
    expect([...loaded.parameterResources!.materials.values()][0]?.displacement?.file).toBe('height.png');
    for (const buffer of indexBuffers) expect(buffer.destroy).not.toHaveBeenCalled();
  });

  it('rebakes geometry when the displacement graph is rewired and restored', async () => {
    const { viewer, device } = await setup(false, true, 'raster', true, { displaced: true });
    const indices = () => device.createBuffer.mock.calls.flatMap(([descriptor], index) =>
      descriptor.usage & GPUBufferUsage.INDEX ? [device.createBuffer.mock.results[index]!.value] : []);
    const original = indices()[0]!;
    await viewer.setObjectGraphInputLink('/World/Ball', 'disp', 'displacement', 'otherHeight');
    expect(original.destroy).toHaveBeenCalledOnce();
    expect(indices()).toHaveLength(2);
    expect(viewer.objectSurfaceGraph('/World/Ball')?.nodes.get('disp')?.inputs[1]?.source)
      .toMatchObject({ kind: 'connection', nodeId: 'otherHeight' });
    const changed = indices()[1]!;
    await viewer.setObjectGraphInputLink('/World/Ball', 'disp', 'displacement', null);
    expect(changed.destroy).toHaveBeenCalledOnce();
    expect(indices()).toHaveLength(3);
    expect(viewer.objectSurfaceGraph('/World/Ball')?.nodes.get('disp')?.inputs[1]?.source)
      .toMatchObject({ kind: 'connection', nodeId: 'height' });
  });

  it('falls back to rebuilding the scene when a volume boundary is present', async () => {
    const { viewer, device } = await setup(false, true, 'raster', true, { twoObjects: true, volumeBoundary: true });
    const oldIndex = device.createBuffer.mock.calls.findIndex(([descriptor]) => !!(descriptor.usage & GPUBufferUsage.INDEX));
    const oldBuffer = device.createBuffer.mock.results[oldIndex]!.value;
    await viewer.setObjectConstant('/World/Ball', 's', 'specular_roughness', true, 'multiply');
    expect(oldBuffer.destroy).toHaveBeenCalledOnce();
    expect(device.createBuffer.mock.calls.filter(([descriptor]) => descriptor.usage & GPUBufferUsage.INDEX)).toHaveLength(2);
  });

  it('cleans up staged textures when a later texture decode fails', async () => {
    const { viewer, loaded, gpu, textures } = await setup(false, true, 'raster', true, { textureNode: true });
    await viewer.setObjectGraphInputLink('/World/Ball', 's', 'base_color', 'image');
    const material = [...loaded.parameterResources!.materials.values()][0]!;
    const module = material.surfaceModule!;
    const texture = module.textures[0]!;
    const twoTextures = { ...material, surfaceModule: {
      ...module, textures: [texture, { ...texture, name: 'other', fileRef: 'missing.png' }],
    } };
    const before = textures.length;
    await expect(uploadMaterialTextures(gpu, twoTextures, {
      decode: async file => {
        if (file === 'missing.png') throw new Error('decode failed');
        return loaded.mtlx.imageProvider.decode(file);
      },
    }, new Map())).rejects.toThrow('decode failed');
    expect(textures).toHaveLength(before + 1);
    expect(textures.at(-1)?.destroy).toHaveBeenCalledOnce();
  });

  it('rebuilds the shared path-tracing shader while retaining packed geometry and resetting samples', async () => {
    const actual = await vi.importActual<typeof import('../../src/render/pathtracing/scene-buffers.ts')>(
      '../../src/render/pathtracing/scene-buffers.ts');
    vi.mocked(buildCachedPathTraceScene).mockImplementation(actual.buildCachedPathTraceScene);
    const { viewer, device, statuses } = await setup(false, true, 'pathtracing', true, { twoObjects: true });
    tick(0);
    await vi.waitFor(() => expect(statuses.at(-1)?.pathTracer).toBe('ready'));
    tick(1);
    await vi.waitFor(() => expect(statuses.at(-1)?.samples).toBeGreaterThan(0));
    const geometry = device.createBuffer.mock.calls.flatMap(([descriptor], index) =>
      descriptor.label?.startsWith('Path tracing ') && !['Path tracing materials', 'Path tracing analyticLights', 'Path tracing volumeData'].includes(descriptor.label)
        ? [device.createBuffer.mock.results[index]!.value] : []);
    expect(geometry).toHaveLength(5);
    const buffers = device.createBuffer.mock.calls.filter(([descriptor]) => descriptor.label?.startsWith('Path tracing ')).length;
    const pipelines = device.createComputePipelineAsync.mock.calls.length;
    await viewer.setObjectConstant('/World/Ball', 's', 'specular_roughness', true, 'multiply');
    expect(statuses.at(-1)).toMatchObject({ pathTracer: 'idle', samples: 0 });
    for (const buffer of geometry) expect(buffer.destroy).not.toHaveBeenCalled();
    tick(2);
    await vi.waitFor(() => expect(statuses.at(-1)?.pathTracer).toBe('ready'));
    expect(buildCachedPathTraceScene).toHaveBeenCalledOnce();
    expect(device.createBuffer.mock.calls.filter(([descriptor]) => descriptor.label?.startsWith('Path tracing ')))
      .toHaveLength(buffers + 1);
    expect(device.createComputePipelineAsync).toHaveBeenCalledTimes(pipelines + 2);
    for (const buffer of geometry) expect(buffer.destroy).not.toHaveBeenCalled();
  });

  it('reports a deferred path-tracing compilation failure and recovers after undo', async () => {
    const actual = await vi.importActual<typeof import('../../src/render/pathtracing/scene-buffers.ts')>(
      '../../src/render/pathtracing/scene-buffers.ts');
    vi.mocked(buildCachedPathTraceScene).mockImplementation(actual.buildCachedPathTraceScene);
    const { viewer, device, statuses, diagnostics } = await setup(false, true, 'pathtracing');
    tick(0);
    await vi.waitFor(() => expect(statuses.at(-1)?.pathTracer).toBe('ready'));
    await viewer.setObjectConstant('/World/Ball', 's', 'specular_roughness', true, 'multiply');
    device.createComputePipelineAsync.mockRejectedValueOnce(new Error('edited path-tracing pipeline failed'));
    tick(1);
    await vi.waitFor(() => expect(statuses.at(-1)?.pathTracer).toBe('error'));
    expect(viewer.objectSurfaceGraph('/World/Ball')?.nodes.has('specular_roughness_multiply')).toBe(true);
    expect(diagnostics.at(-1)).toEqual([expect.objectContaining({ message: 'edited path-tracing pipeline failed' })]);
    await viewer.setObjectConstant('/World/Ball', 'specular_roughness_multiply', 'in2', false, 'multiply');
    expect(diagnostics.at(-1)).toEqual([]);
    tick(2);
    await vi.waitFor(() => expect(statuses.at(-1)?.pathTracer).toBe('ready'));
  });

  it('does not publish an obsolete path-tracing build after a topology edit', async () => {
    const actual = await vi.importActual<typeof import('../../src/render/pathtracing/scene-buffers.ts')>(
      '../../src/render/pathtracing/scene-buffers.ts');
    vi.mocked(buildCachedPathTraceScene).mockImplementation(actual.buildCachedPathTraceScene);
    const { viewer, device, statuses } = await setup(false, true, 'pathtracing');
    let release!: () => void;
    let started!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const compiling = new Promise<void>(resolve => { started = resolve; });
    device.createComputePipelineAsync.mockImplementationOnce(async () => {
      started();
      await blocked;
      return { getBindGroupLayout: vi.fn(() => ({})) };
    });
    tick(0);
    await compiling;
    await viewer.setObjectConstant('/World/Ball', 's', 'specular_roughness', true, 'multiply');
    expect(statuses.at(-1)?.pathTracer).toBe('idle');
    tick(1);
    await vi.waitFor(() => expect(statuses.at(-1)?.pathTracer).toBe('ready'));
    release();
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(statuses.at(-1)?.pathTracer).toBe('ready');
    expect(viewer.objectSurfaceGraph('/World/Ball')?.nodes.has('specular_roughness_multiply')).toBe(true);
  });

  it('cancels a headless capture when its material topology changes', async () => {
    const actual = await vi.importActual<typeof import('../../src/render/pathtracing/scene-buffers.ts')>(
      '../../src/render/pathtracing/scene-buffers.ts');
    vi.mocked(buildCachedPathTraceScene).mockImplementation(actual.buildCachedPathTraceScene);
    vi.mocked(loadUsdScene).mockResolvedValue(await sceneFixture(true));
    const { device, gpu } = fakeDevice();
    viewer = new InteractiveViewer({ device: gpu, outputFormat: 'rgba8unorm', width: 130, height: 80 });
    viewer.setBackend('pathtracing');
    await viewer.load('scene.usda');
    let release!: () => void;
    let submitted!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const submission = new Promise<void>(resolve => { submitted = resolve; });
    device.queue.onSubmittedWorkDone.mockImplementationOnce(async () => { submitted(); await blocked; });
    const target = device.createTexture({ size: [130, 80], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT });
    const capture = viewer.renderPathTraceTo(target.createView() as GPUTextureView, 2);
    const rejected = expect(capture).rejects.toThrow('Scene changed during path-tracing capture.');
    await submission;
    await viewer.setObjectConstant('/World/Ball', 's', 'specular_roughness', true, 'multiply');
    release();
    await rejected;
  });

  it('invalidates Disney material data on topology edits without rebuilding raster resources', async () => {
    const dispose = vi.fn();
    const create = vi.spyOn(DisneyGpuBackend, 'create').mockResolvedValue(
      { dispose, reset: vi.fn() } as Pick<DisneyGpuBackend, 'dispose' | 'reset'> as DisneyGpuBackend,
    );
    try {
      const { viewer, device, statuses } = await setup(false, true);
      viewer.setBackend('disney');
      tick(0);
      await vi.waitFor(() => expect(statuses.at(-1)?.pathTracer).toBe('ready'));
      const indexBuffers = device.createBuffer.mock.calls.filter(([descriptor]) => descriptor.usage & GPUBufferUsage.INDEX).length;
      await viewer.setObjectConstant('/World/Ball', 's', 'base_color', true, 'multiply');
      expect(dispose).toHaveBeenCalledOnce();
      expect(statuses.at(-1)).toMatchObject({ pathTracer: 'idle', samples: 0 });
      expect(device.createBuffer.mock.calls.filter(([descriptor]) => descriptor.usage & GPUBufferUsage.INDEX)).toHaveLength(indexBuffers);
      const factor = viewer.objectParameters('/World/Ball', 'base_color_multiply')[0]!;
      await viewer.setObjectParameters('/World/Ball', new Map([[factor.id, [0.5]]]));
      tick(1);
      await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(2));
      expect(create.mock.calls[1]?.[1].materials[0]?.baseColor).toEqual([0.4, 0.4, 0.4]);
    } finally { create.mockRestore(); }
  });

  it('switches A/B between a literal and an edited graph without reloading USD', async () => {
    const { viewer, device } = await setup(false, true);
    const path = '/World/Ball';
    const loads = vi.mocked(loadUsdScene).mock.calls.length;
    expect(viewer.objectMaterialVariants(path)).toEqual({ A: 'empty', B: 'empty' });
    await expect(viewer.applyObjectMaterialVariant(path, 'B')).rejects.toThrow('variante B est vide');
    viewer.saveObjectMaterialVariant(path, 'A');
    await viewer.setObjectConstant(path, 's', 'specular_roughness', true);
    await viewer.setObjectParameters(path, new Map([['surface:specular_roughness', [0.42]]]));
    viewer.saveObjectMaterialVariant(path, 'B');
    const pipelines = device.createRenderPipeline.mock.calls.length;
    expect(viewer.objectMaterialVariants(path)).toEqual({ A: 'saved', B: 'active' });
    await viewer.applyObjectMaterialVariant(path, 'A');
    expect(viewer.objectSurfaceGraph(path)?.nodes.has('specular_roughness_constant')).toBe(false);
    expect(viewer.objectParameters(path, 's').find(parameter => parameter.input === 'specular_roughness')?.value).toEqual([0.2]);
    await viewer.setObjectParameters(path, new Map([['surface:specular_roughness', [0.8]]]));
    await viewer.applyObjectMaterialVariant(path, 'B');
    expect(viewer.objectSurfaceGraph(path)?.nodes.get('s')?.inputs.find(input => input.name === 'specular_roughness')?.source)
      .toEqual({ kind: 'connection', nodeId: 'specular_roughness_constant' });
    expect(viewer.objectParameters(path, 'specular_roughness_constant')[0]?.value).toEqual([0.42]);
    await viewer.applyObjectMaterialVariant(path, 'A');
    expect(viewer.objectParameters(path, 's').find(parameter => parameter.input === 'specular_roughness')?.value).toEqual([0.2]);
    expect(loadUsdScene).toHaveBeenCalledTimes(loads);
    expect(device.createRenderPipeline).toHaveBeenCalledTimes(pipelines);
  });

  it('restores persisted A/B material snapshots after reloading the scene', async () => {
    const { viewer } = await setup(false, true);
    const path = '/World/Ball';
    viewer.saveObjectMaterialVariant(path, 'A');
    await viewer.setObjectConstant(path, 's', 'specular_roughness', true);
    await viewer.setObjectParameters(path, new Map([['surface:specular_roughness', [0.42]]]));
    viewer.saveObjectMaterialVariant(path, 'B');

    vi.mocked(loadUsdScene).mockImplementation(async () => sceneFixture(true));
    await viewer.load('scene.usda');

    expect(viewer.objectMaterialVariants(path)).toEqual({ A: 'saved', B: 'saved' });
    expect(viewer.objectMaterialVariantGraph(path, 'B')?.nodes.has('specular_roughness_constant')).toBe(true);
    await viewer.applyObjectMaterialVariant(path, 'B');
    expect(viewer.objectParameters(path, 'specular_roughness_constant')[0]?.value).toEqual([0.42]);
    await viewer.applyObjectMaterialVariant(path, 'A');
    expect(viewer.objectSurfaceGraph(path)?.nodes.has('specular_roughness_constant')).toBe(false);
    expect(viewer.objectParameters(path, 's').find(parameter => parameter.input === 'specular_roughness')?.value).toEqual([0.2]);
  });

  it.each(['raster', 'pathtracing'] as const)('captures the A/B pair in %s without changing the live scene', async backend => {
    const { viewer, loaded, device, pass } = await setup(false, true);
    Object.assign(device, { pushErrorScope: vi.fn(), popErrorScope: async () => null });
    const actual = await vi.importActual<typeof import('../../src/render/pathtracing/scene-buffers.ts')>(
      '../../src/render/pathtracing/scene-buffers.ts');
    vi.mocked(buildCachedPathTraceScene).mockImplementation(actual.buildCachedPathTraceScene);
    const path = '/World/Ball';
    const loads = vi.mocked(loadUsdScene).mock.calls.length;
    viewer.saveObjectMaterialVariant(path, 'A');
    await viewer.setObjectParameters(path, new Map([['surface:specular_roughness', [0.7]]]));
    viewer.saveObjectMaterialVariant(path, 'B');
    const graph = viewer.objectSurfaceGraph(path);
    const signal = new AbortController().signal;
    const options = backend === 'raster' ? { backend } : { backend, samples: 2 };
    const pair = await viewer.captureObjectMaterialVariants(path, options, signal);
    for (const image of [pair.A, pair.B]) {
      expect(image.width).toBe(256);
      expect(image.height).toBe(256);
      expect(image.rgba).toHaveLength(256 * 256 * 4);
    }
    const copies = device.createCommandEncoder.mock.results.flatMap(({ value }) => value.copyTextureToBuffer.mock.calls);
    expect(copies).toHaveLength(2);
    if (backend === 'pathtracing') {
      const inputs = vi.mocked(buildCachedPathTraceScene).mock.calls;
      expect(inputs).toHaveLength(2);
      expect(inputs[0]![1]?.frameCamera).toEqual(inputs[1]![1]?.frameCamera);
      expect(inputs.map(([resources]) => [...resources.materials.values()][0]?.parameters
        ?.find(parameter => parameter.input === 'specular_roughness')?.value)).toEqual([[0.2], [0.7]]);
      expect(pass.dispatchWorkgroups).toHaveBeenCalledTimes(2 * 2 * pathTraceTileCount(256, 256));
    } else {
      expect(pass.drawIndexed).toHaveBeenCalled();
      expect(buildCachedPathTraceScene).not.toHaveBeenCalled();
    }
    expect(viewer.backend).toBe('raster');
    expect(viewer.objectSurfaceGraph(path)).toBe(graph);
    expect(viewer.objectMaterialVariants(path)).toEqual({ A: 'saved', B: 'active' });
    expect(loadUsdScene).toHaveBeenCalledTimes(loads);
    expect(loaded.mtlx.documents?.delete).not.toHaveBeenCalled();
  });

  it('isolates the selected material, bakes displacement and frames all transformed bounds', async () => {
    const loaded = await sceneFixture(true, { twoObjects: true, displaced: true });
    const source = loaded.parameterResources!;
    const selected = source.instances[0]!;
    const key = selected.materialKey!;
    const moved = [...selected.transform];
    moved[12] = 37;
    moved[13] = -12;
    moved[14] = 8;
    const scene = {
      ...source,
      materials: new Map([...source.materials, ['other', { ...source.materials.get(key)!, materialName: 'other' }]]),
      instances: [{ ...selected, transform: moved }, { ...source.instances[1]!, materialKey: 'other' }],
    };
    const isolated = materialPreviewResources(scene, selected.primPath);
    expect(isolated.instances).toHaveLength(1);
    expect([...isolated.materials.keys()]).toEqual([key]);
    expect(isolated.instances[0]!.transform).toEqual(moved);
    expect(isolated.instances[0]!.primPath).not.toBe(selected.primPath);
    expect(scene.instances).toHaveLength(2);
    const geometry = isolated.geometries.get(isolated.instances[0]!.prototypeId)!;
    const shaderBall = { ...geometry, prototypeId: 'shaderball' };
    const ball = materialPreviewResources(scene, selected.primPath, shaderBall);
    expect(ball.instances[0]!.prototypeId).toBe('shaderball');
    expect(ball.instances[0]!.transform).toEqual(IDENTITY4);
    const displaced = await applySceneDisplacement(isolated, loaded.mtlx.imageProvider);
    expect(displaced.instances[0]!.prototypeId).toContain('::displacement::');
    expect(displaced.tlas.bounds).not.toEqual(isolated.tlas.bounds);
    const { camera } = materialPreviewCamera(displaced, [0.4, 0.6, 0.8], 0);
    const matrix = camera.viewProj;
    const { min, max } = displaced.tlas.bounds;
    for (const x of [min[0], max[0]]) for (const y of [min[1], max[1]]) for (const z of [min[2], max[2]]) {
      const clip = [0, 1, 2, 3].map(row => matrix[row]! * x + matrix[row + 4]! * y + matrix[row + 8]! * z + matrix[row + 12]!);
      expect(Math.abs(clip[0]! / clip[3]!)).toBeLessThan(1);
      expect(Math.abs(clip[1]! / clip[3]!)).toBeLessThan(1);
      expect(clip[2]! / clip[3]!).toBeGreaterThanOrEqual(0);
      expect(clip[2]! / clip[3]!).toBeLessThanOrEqual(1);
    }
  });

  it.each(['raster', 'pathtracing'] as const)('captures an isolated object in %s without changing the live viewer', async backend => {
    const { viewer, loaded, device, pass } = await setup(false, true, 'raster', true, { twoObjects: true });
    const actual = await vi.importActual<typeof import('../../src/render/pathtracing/scene-buffers.ts')>(
      '../../src/render/pathtracing/scene-buffers.ts');
    vi.mocked(buildCachedPathTraceScene).mockImplementation(actual.buildCachedPathTraceScene);
    const graph = viewer.objectSurfaceGraph('/World/Ball');
    const originalResources = loaded.resources;
    const options = backend === 'raster'
      ? { target: 'object' as const, backend } : { target: 'object' as const, backend, samples: 2 };
    const capture = await viewer.captureObjectMaterialPreview('/World/Ball', options, new AbortController().signal);
    expect(capture).toMatchObject({ width: 256, height: 256 });
    expect(capture.rgba).toHaveLength(256 * 256 * 4);
    if (backend === 'pathtracing') {
      const resources = vi.mocked(buildCachedPathTraceScene).mock.calls[0]![0];
      expect(resources.instances).toHaveLength(1);
      expect(resources.materials.size).toBe(1);
      expect(pass.dispatchWorkgroups).toHaveBeenCalledTimes(2 * pathTraceTileCount(256, 256));
    } else {
      expect(pass.drawIndexed).toHaveBeenCalled();
      expect(buildCachedPathTraceScene).not.toHaveBeenCalled();
    }
    expect(device.createCommandEncoder.mock.results.flatMap(({ value }) => value.copyTextureToBuffer.mock.calls)).toHaveLength(1);
    expect(viewer.backend).toBe('raster');
    expect(viewer.objectSurfaceGraph('/World/Ball')).toBe(graph);
    expect(loaded.resources).toBe(originalResources);
    expect(loaded.mtlx.documents?.delete).not.toHaveBeenCalled();
  });

  it('loads the shaderball only once and keeps the selected material', async () => {
    const { viewer, loaded } = await setup(false, true);
    const source = loaded.parameterResources!;
    const geometry = source.geometries.get(source.instances[0]!.prototypeId)!;
    vi.stubGlobal('document', { baseURI: 'https://example.test/engine/' });
    vi.mocked(loadMaterialPreviewShaderBall).mockResolvedValue({ ...geometry, prototypeId: 'shaderball' });
    const actual = await vi.importActual<typeof import('../../src/render/pathtracing/scene-buffers.ts')>(
      '../../src/render/pathtracing/scene-buffers.ts');
    vi.mocked(buildCachedPathTraceScene).mockImplementation(actual.buildCachedPathTraceScene);
    const signal = new AbortController().signal;
    await viewer.captureObjectMaterialPreview('/World/Ball', { target: 'shaderball', backend: 'pathtracing', samples: 1 }, signal);
    await viewer.captureObjectMaterialPreview('/World/Ball', { target: 'shaderball', backend: 'raster' }, signal);
    expect(loadMaterialPreviewShaderBall).toHaveBeenCalledOnce();
    const resources = vi.mocked(buildCachedPathTraceScene).mock.calls[0]![0];
    expect(resources.instances[0]!.prototypeId).toBe('shaderball');
    expect(resources.instances[0]!.materialKey).toBe(source.instances[0]!.materialKey);
    expect(resources.instances[0]!.transform).toEqual(IDENTITY4);
  });

  it('previews a compiled scene that has no editable resources', async () => {
    const { viewer, loaded } = await setup(false, true);
    const source = loaded.parameterResources!;
    const geometry = source.geometries.get(source.instances[0]!.prototypeId)!;
    delete loaded.parameterResources;
    const actual = await vi.importActual<typeof import('../../src/render/pathtracing/scene-buffers.ts')>(
      '../../src/render/pathtracing/scene-buffers.ts');
    vi.mocked(buildCachedPathTraceScene).mockImplementation(actual.buildCachedPathTraceScene);
    const compiled = await exportCompiledScene(loaded);
    vi.stubGlobal('document', { baseURI: 'https://example.test/' });
    vi.stubGlobal('fetch', async (input: string) => {
      if (input.endsWith('/scene.json')) return new Response(JSON.stringify(compiled.manifest));
      const path = new URL(input).pathname.slice('/scenes/prepared/'.length);
      const bytes = compiled.files.get(path);
      return bytes ? new Response(bytes) : new Response(null, { status: 404 });
    });
    vi.mocked(loadMaterialPreviewShaderBall).mockResolvedValue({ ...geometry, prototypeId: 'shaderball' });
    await viewer.load('https://example.test/scenes/prepared/scene.json');
    expect(viewer.isCompiledScene).toBe(true);
    expect(viewer.objectSurfaceGraph('/World/Ball')).toBeDefined();
    expect(viewer.objectParameters('/World/Ball')).toEqual([]);
    const signal = new AbortController().signal;
    for (const target of ['object', 'shaderball'] as const) {
      const raster = await viewer.captureObjectMaterialPreview('/World/Ball', { target, backend: 'raster' }, signal);
      const pathtracing = await viewer.captureObjectMaterialPreview(
        '/World/Ball', { target, backend: 'pathtracing', samples: 1 }, signal,
      );
      expect(raster).toMatchObject({ width: 256, height: 256 });
      expect(pathtracing).toMatchObject({ width: 256, height: 256 });
    }
    expect(viewer.backend).toBe('raster');
  });

  it('previews read-only compiled resources without displacing the object twice', async () => {
    const { viewer, loaded } = await setup(false, true, 'raster', true, { displaced: true });
    const source = loaded.parameterResources!;
    const geometry = source.geometries.get(source.instances[0]!.prototypeId)!;
    const baked = loaded.resources;
    const bakedId = baked.instances[0]!.prototypeId;
    delete loaded.parameterResources;
    vi.stubGlobal('document', { baseURI: 'https://example.test/engine/' });
    vi.mocked(loadMaterialPreviewShaderBall).mockResolvedValue({ ...geometry, prototypeId: 'shaderball' });
    const actual = await vi.importActual<typeof import('../../src/render/pathtracing/scene-buffers.ts')>(
      '../../src/render/pathtracing/scene-buffers.ts');
    vi.mocked(buildCachedPathTraceScene).mockImplementation(actual.buildCachedPathTraceScene);
    const decode = vi.spyOn(loaded.mtlx.imageProvider, 'decode');
    const signal = new AbortController().signal;

    await viewer.captureObjectMaterialPreview('/World/Ball', { target: 'object', backend: 'pathtracing', samples: 1 }, signal);
    const object = vi.mocked(buildCachedPathTraceScene).mock.calls[0]![0];
    expect(object.instances[0]!.prototypeId).toBe(bakedId);
    expect(object.geometries.get(bakedId)).toBe(baked.geometries.get(bakedId));
    expect(decode).not.toHaveBeenCalled();

    await viewer.captureObjectMaterialPreview('/World/Ball', { target: 'shaderball', backend: 'pathtracing', samples: 1 }, signal);
    const ball = vi.mocked(buildCachedPathTraceScene).mock.calls[1]![0];
    expect(ball.instances[0]!.prototypeId).toContain('shaderball::displacement::');
    expect(decode).toHaveBeenCalledWith('height.png');
    expect(loaded.resources).toBe(baked);
  });

  it('reports unavailable displacement textures for a read-only shaderball preview', async () => {
    const { viewer, loaded } = await setup(false, true, 'raster', true, { displaced: true });
    const source = loaded.parameterResources!;
    const geometry = source.geometries.get(source.instances[0]!.prototypeId)!;
    delete loaded.parameterResources;
    vi.stubGlobal('document', { baseURI: 'https://example.test/engine/' });
    vi.mocked(loadMaterialPreviewShaderBall).mockResolvedValue({ ...geometry, prototypeId: 'shaderball' });
    vi.spyOn(loaded.mtlx.imageProvider, 'decode').mockRejectedValue(new Error('Texture absent from compiled scene: height.png'));
    await expect(viewer.captureObjectMaterialPreview(
      '/World/Ball', { target: 'shaderball', backend: 'raster' }, new AbortController().signal,
    )).rejects.toThrow('Texture absent from compiled scene: height.png');
  });

  it('discards a read-only preview when its render resources change', async () => {
    const { viewer, device, loaded } = await setup(false, true);
    delete loaded.parameterResources;
    let resume!: () => void;
    const waiting = new Promise<void>(resolve => { resume = resolve; });
    let started = false;
    device.createRenderPipelineAsync.mockImplementationOnce(async descriptor => {
      started = true;
      await waiting;
      return device.createRenderPipeline(descriptor);
    });
    const pending = viewer.captureObjectMaterialPreview(
      '/World/Ball', { target: 'object', backend: 'raster' }, new AbortController().signal,
    );
    await vi.waitFor(() => expect(started).toBe(true));
    loaded.resources = { ...loaded.resources };
    resume();
    await expect(pending).rejects.toThrow('La scène a changé');
  });

  it('rejects invalid previews and discards a capture when the edited scene changes', async () => {
    const { viewer, device, loaded } = await setup(false, true);
    const signal = new AbortController().signal;
    const textures = device.createTexture.mock.calls.length;
    await expect(viewer.captureObjectMaterialPreview('/missing', { target: 'object', backend: 'raster' }, signal))
      .rejects.toThrow('indisponible');
    await expect(viewer.captureObjectMaterialPreview('/World/Ball', { target: 'object', backend: 'pathtracing', samples: 0 }, signal))
      .rejects.toThrow('1 à 64');
    expect(device.createTexture).toHaveBeenCalledTimes(textures);
    let resume!: () => void;
    const waiting = new Promise<void>(resolve => { resume = resolve; });
    let started = false;
    device.createRenderPipelineAsync.mockImplementationOnce(async descriptor => {
      started = true;
      await waiting;
      return device.createRenderPipeline(descriptor);
    });
    const pending = viewer.captureObjectMaterialPreview('/World/Ball', { target: 'object', backend: 'raster' }, signal);
    await vi.waitFor(() => expect(started).toBe(true));
    await viewer.setObjectParameters('/World/Ball', new Map([['surface:specular_roughness', [0.7]]]));
    resume();
    await expect(pending).rejects.toThrow('La scène a changé');
    expect(loaded.mtlx.documents?.delete).not.toHaveBeenCalled();
  });

  it('refuses incomplete or cancelled comparisons without allocating a render target', async () => {
    const { viewer, device } = await setup(false, true);
    const path = '/World/Ball';
    const abort = new AbortController();
    const textures = device.createTexture.mock.calls.length;
    viewer.saveObjectMaterialVariant(path, 'A');
    await expect(viewer.captureObjectMaterialVariants(path, { backend: 'raster' }, abort.signal)).rejects.toThrow('Enregistre');
    viewer.saveObjectMaterialVariant(path, 'B');
    await expect(viewer.captureObjectMaterialVariants(path, { backend: 'pathtracing', samples: 0 }, abort.signal))
      .rejects.toThrow('1 à 64');
    abort.abort();
    await expect(viewer.captureObjectMaterialVariants(path, { backend: 'raster' }, abort.signal)).rejects.toThrow('aborted');
    expect(device.createTexture).toHaveBeenCalledTimes(textures);
  });

  it('shares a Constant between two surface inputs and restores the previous secondary literal', async () => {
    const { viewer } = await setup(false, true);
    const path = '/World/Ball';
    const source = 'specular_roughness_constant';
    const input = 'diffuse_roughness';
    const binding = (name: string) => viewer.objectSurfaceGraph(path)?.nodes.get('s')?.inputs.find(entry => entry.name === name)?.source;
    await viewer.setObjectConstant(path, 's', 'specular_roughness', true);
    expect(viewer.objectConstantSources(path, 's', input)).toEqual([source]);
    await expect(viewer.setObjectConstantLink(path, 's', 'base_color', source)).rejects.toThrow('incompatible');
    await viewer.setObjectConstantLink(path, 's', input, source);
    expect(binding(input)).toEqual({ kind: 'connection', nodeId: source });
    expect(binding('specular_roughness')).toEqual(binding(input));
    await expect(viewer.setObjectConstant(path, source, 'value', false)).rejects.toThrow('utilisé ailleurs');
    await expect(viewer.setObjectParameters(path, new Map([[`surface:${input}`, [0.1]]]))).rejects.toThrow('Entrée connectée');
    await viewer.setObjectParameters(path, new Map([['surface:specular_roughness', [0.5]]]));
    expect(viewer.objectSurfaceGraph(path)?.nodes.get(source)?.inputs[0]?.source)
      .toEqual({ kind: 'value', type: 'float', value: '0.5' });
    await viewer.setObjectConstantLink(path, 's', input, null);
    expect(binding(input)).toEqual({ kind: 'value', type: 'float', value: '0.8' });
    expect(binding('specular_roughness')).toEqual({ kind: 'connection', nodeId: source });
    await viewer.setObjectConstant(path, source, 'value', false);
    expect(binding('specular_roughness')).toEqual({ kind: 'value', type: 'float', value: '0.5' });
  });

  it('shares an arithmetic editor output and restores the secondary literal when disconnected', async () => {
    const { viewer } = await setup(false, true);
    const path = '/World/Ball';
    const source = 'specular_roughness_min';
    const input = 'diffuse_roughness';
    const binding = (name: string) => viewer.objectSurfaceGraph(path)?.nodes.get('s')?.inputs.find(entry => entry.name === name)?.source;
    await viewer.setObjectConstant(path, 's', 'specular_roughness', true, 'min');
    const threshold = viewer.objectParameters(path, source)[0]!;
    await viewer.setObjectParameters(path, new Map([[threshold.id, [0.1]]]));
    expect(viewer.objectConstantSources(path, 's', input)).toEqual([source]);
    await viewer.setObjectConstantLink(path, 's', input, source);
    expect(binding(input)).toEqual({ kind: 'connection', nodeId: source });
    await expect(viewer.setObjectConstant(path, source, 'in2', false, 'min')).rejects.toThrow('utilisé ailleurs');
    await viewer.setObjectParameters(path, new Map([[threshold.id, [0.15]]]));
    expect(viewer.objectSurfaceGraph(path)?.nodes.get(source)?.inputs[1]?.source)
      .toEqual({ kind: 'value', type: 'float', value: '0.15' });
    await viewer.setObjectConstantLink(path, 's', input, null);
    expect(binding(input)).toEqual({ kind: 'value', type: 'float', value: '0.8' });
    await viewer.setObjectConstant(path, source, 'in2', false, 'min');
  });

  it('does not connect an arithmetic output whose range exceeds inherited NodeDef limits', async () => {
    const { viewer } = await setup(false, true);
    const path = '/World/Ball';
    const root = viewer.objectSurfaceGraph(path)!.nodes.get('s')!;
    root.nodeDef = {
      name: 'ND_standard_surface_surfaceshader', nodeString: root.category, type: root.type,
      implementation: { kind: 'unresolved' },
      inputs: root.inputs.map(({ name, type }) => name === 'coat_roughness'
        ? { name, type, uiMin: 0, uiMax: 0.5 }
        : name === 'specular_roughness' ? { name, type, uiMin: 0, uiMax: 1 } : { name, type }),
    };
    await viewer.setObjectConstant(path, 's', 'specular_roughness', true, 'add');
    expect(viewer.objectConstantSources(path, 's', 'coat_roughness')).toEqual([]);
  });

  it('redirects a secondary link atomically and still restores its original literal', async () => {
    const { viewer } = await setup(false, true);
    const path = '/World/Ball';
    const input = 'diffuse_roughness';
    const first = 'specular_roughness_constant';
    const second = 'coat_roughness_constant';
    const binding = () => viewer.objectSurfaceGraph(path)?.nodes.get('s')?.inputs.find(entry => entry.name === input)?.source;
    await viewer.setObjectConstant(path, 's', 'specular_roughness', true);
    await viewer.setObjectConstant(path, 's', 'coat_roughness', true);
    await viewer.setObjectConstant(path, 's', 'base_color', true);
    await viewer.setObjectConstantLink(path, 's', input, first);
    const connected = viewer.objectSurfaceGraph(path);
    expect(viewer.objectConstantSources(path, 's', input)).toEqual([second]);
    expect(viewer.objectConstantSources(path, 's', 'specular_roughness')).toEqual([]);
    await expect(viewer.setObjectConstantLink(path, 's', input, 'base_color_constant')).rejects.toThrow('incompatible');
    await viewer.setObjectConstantLink(path, 's', input, first);
    expect(viewer.objectSurfaceGraph(path)).toBe(connected);
    await viewer.setObjectConstantLink(path, 's', input, second);
    expect(binding()).toEqual({ kind: 'connection', nodeId: second });
    await viewer.setObjectConstant(path, first, 'value', false);
    await expect(viewer.setObjectConstant(path, second, 'value', false)).rejects.toThrow('utilisé ailleurs');
    await viewer.setObjectConstantLink(path, 's', input, null);
    expect(binding()).toEqual({ kind: 'value', type: 'float', value: '0.8' });
  });

  it('inserts a neutral Multiply, validates its factor and folds the computed value back into the surface', async () => {
    const { viewer } = await setup(false, true);
    const path = '/World/Ball';
    const input = 'specular_roughness';
    const nodeId = `${input}_multiply`;
    const loads = vi.mocked(loadUsdScene).mock.calls.length;
    expect(viewer.canInsertObjectConstant(path, 's', input, 'multiply')).toBe(true);
    await viewer.setObjectConstant(path, 's', input, true, 'multiply');
    const read = () => viewer.objectSurfaceGraph(path)!;
    const multiply = read().nodes.get(nodeId)!;
    expect(multiply.inputs.map(entry => entry.source)).toEqual([
      { kind: 'value', type: 'float', value: '0.2' },
      { kind: 'value', type: 'float', value: '1' },
    ]);
    expect(read().nodes.get('s')?.inputs.find(entry => entry.name === input)?.source)
      .toEqual({ kind: 'connection', nodeId });
    expect(viewer.objectConstantSources(path, 's', 'diffuse_roughness')).toContain(nodeId);
    const factor = viewer.objectParameters(path, nodeId)[0]!;
    await expect(viewer.setObjectParameters(path, new Map([[factor.id, [1.01]]]))).rejects.toThrow('above its maximum');
    await viewer.setObjectParameters(path, new Map([[factor.id, [0.5]]]));
    expect(read().nodes.get(nodeId)?.inputs.find(entry => entry.name === 'in2')?.source)
      .toEqual({ kind: 'value', type: 'float', value: '0.5' });
    await viewer.setObjectConstant(path, nodeId, 'in2', false, 'multiply');
    expect(read().nodes.has(nodeId)).toBe(false);
    expect(viewer.objectParameters(path, 's').find(entry => entry.input === input)?.value).toEqual([0.1]);
    expect(loadUsdScene).toHaveBeenCalledTimes(loads);
  });

  it('inserts a neutral Add, bounds its offset and preserves the sum when removed', async () => {
    const { viewer, device } = await setup(false, true);
    const path = '/World/Ball';
    const input = 'specular_roughness';
    const nodeId = `${input}_add`;
    expect(viewer.canInsertObjectConstant(path, 's', 'base_color', 'add')).toBe(false);
    expect(viewer.canInsertObjectConstant(path, 's', 'diffuse_roughness', 'add')).toBe(false);
    await viewer.setObjectConstant(path, 's', input, true, 'add');
    const node = () => viewer.objectSurfaceGraph(path)?.nodes.get(nodeId);
    expect(node()?.nodeDef?.name).toBe('ND_add_float');
    expect(node()?.inputs.map(entry => entry.source)).toEqual([
      { kind: 'value', type: 'float', value: '0.2' },
      { kind: 'value', type: 'float', value: '0' },
    ]);
    const offset = viewer.objectParameters(path, nodeId)[0]!;
    expect(offset).toMatchObject({ min: [-0.2], max: [0.8] });
    await expect(viewer.setObjectParameters(path, new Map([[offset.id, [-0.21]]]))).rejects.toThrow('below its minimum');
    await expect(viewer.setObjectParameters(path, new Map([[offset.id, [0.81]]]))).rejects.toThrow('above its maximum');
    const pipelines = device.createRenderPipeline.mock.calls.length;
    await viewer.setObjectParameters(path, new Map([[offset.id, [0.3]]]));
    expect(device.createRenderPipeline).toHaveBeenCalledTimes(pipelines);
    expect(node()?.inputs[1]?.source).toEqual({ kind: 'value', type: 'float', value: '0.3' });
    await viewer.setObjectConstant(path, nodeId, 'in2', false, 'add');
    expect(node()).toBeUndefined();
    expect(viewer.objectParameters(path, 's').find(entry => entry.input === input)?.value).toEqual([0.5]);
  });

  it('inserts a neutral Subtract, bounds its offset, exports it and preserves the result when removed', async () => {
    const { viewer, device } = await setup(false, true);
    const path = '/World/Ball';
    const input = 'specular_roughness';
    const nodeId = `${input}_subtract`;
    const root = viewer.objectSurfaceGraph(path)!.nodes.get('s')!;
    root.nodeDef = {
      name: 'ND_standard_surface_surfaceshader', nodeString: root.category, type: root.type,
      implementation: { kind: 'unresolved' }, inputs: root.inputs.map(({ name, type }) => ({ name, type })),
    };
    await viewer.setObjectConstant(path, 's', input, true, 'subtract');
    const read = () => viewer.objectSurfaceGraph(path)!;
    expect(read().nodes.get(nodeId)?.nodeDef?.name).toBe('ND_subtract_float');
    expect(read().nodes.get(nodeId)?.inputs.map(entry => entry.source)).toEqual([
      { kind: 'value', type: 'float', value: '0.2' },
      { kind: 'value', type: 'float', value: '0' },
    ]);
    const offset = viewer.objectParameters(path, nodeId)[0]!;
    expect(offset).toMatchObject({ min: [-0.8], max: [0.2], value: [0] });
    await expect(viewer.setObjectParameters(path, new Map([[offset.id, [-0.81]]]))).rejects.toThrow('below its minimum');
    await expect(viewer.setObjectParameters(path, new Map([[offset.id, [0.21]]]))).rejects.toThrow('above its maximum');
    const pipelines = device.createRenderPipeline.mock.calls.length;
    await viewer.setObjectParameters(path, new Map([[offset.id, [0.1]]]));
    expect(device.createRenderPipeline).toHaveBeenCalledTimes(pipelines);
    expect(exportSurfaceGraph(read(), 'mat').xml).toContain(
      `<subtract name="${nodeId}" type="float" nodedef="ND_subtract_float">`,
    );
    await viewer.setObjectConstant(path, nodeId, 'in2', false, 'subtract');
    expect(read().nodes.has(nodeId)).toBe(false);
    expect(viewer.objectParameters(path, 's').find(entry => entry.input === input)?.value).toEqual([0.1]);
  });

  it.each([
    { kind: 'add', threshold: 0.1, min: -0.2, max: 0.2, result: [0.3, 0.5, 0.9] },
    { kind: 'subtract', threshold: 0.1, min: -0.2, max: 0.2, result: [0.1, 0.3, 0.7] },
    { kind: 'min', threshold: 0.5, min: 0, max: 0.8, result: [0.2, 0.4, 0.5] },
    { kind: 'max', threshold: 0.5, min: 0.2, max: 1, result: [0.5, 0.5, 0.8] },
  ] as const)('supports $kind with a bounded scalar operand on color3 inputs', async ({ kind, threshold, min, max, result }) => {
    const { viewer, device } = await setup(false, true);
    const path = '/World/Ball';
    const input = 'base_color';
    const nodeId = `${input}_${kind}`;
    await viewer.setObjectParameters(path, new Map([['surface:base_color', [0.2, 0.4, 0.8]]]));
    const root = viewer.objectSurfaceGraph(path)!.nodes.get('s')!;
    root.nodeDef = {
      name: 'ND_standard_surface_surfaceshader', nodeString: root.category, type: root.type,
      implementation: { kind: 'unresolved' },
      inputs: root.inputs.map(({ name, type }) => name === input
        ? { name, type, uiMinComponents: [0, 0, 0], uiMaxComponents: [1, 1, 1] }
        : { name, type }),
    };
    expect(viewer.canInsertObjectConstant(path, 's', input, kind)).toBe(true);
    await viewer.setObjectConstant(path, 's', input, true, kind);
    const read = () => viewer.objectSurfaceGraph(path)!;
    expect(read().nodes.get(nodeId)?.nodeDef?.name).toBe(`ND_${kind}_color3FA`);
    const offset = viewer.objectParameters(path, nodeId)[0]!;
    expect(offset.min?.[0]).toBeCloseTo(min);
    expect(offset.max?.[0]).toBeCloseTo(max);
    expect(offset.value).toEqual([kind === 'min' ? 0.8 : kind === 'max' ? 0.2 : 0]);
    const pipelines = device.createRenderPipeline.mock.calls.length;
    await viewer.setObjectParameters(path, new Map([[offset.id, [threshold]]]));
    expect(device.createRenderPipeline).toHaveBeenCalledTimes(pipelines);
    expect(exportSurfaceGraph(read(), 'mat').xml).toContain(
      `<${kind} name="${nodeId}" type="color3" nodedef="ND_${kind}_color3FA">`,
    );
    await viewer.setObjectConstant(path, nodeId, 'in2', false, kind);
    const folded = viewer.objectParameters(path, 's').find(entry => entry.input === input)?.value;
    expect(folded).toHaveLength(result.length);
    folded!.forEach((component, index) => expect(component).toBeCloseTo(result[index]!));
  });

  it.each([
    { input: 'specular_roughness', type: 'float', initial: [0.2], foreground: [1], edited: [0.8], result: [0.5] },
    { input: 'base_color', type: 'color3', initial: [0.2, 0.4, 0.8], foreground: [1, 1, 1],
      edited: [0.8, 0.6, 0.4], result: [0.5, 0.5, 0.6] },
  ] as const)('inserts a neutral Mix on $type, updates both operands, exports and folds the result', async ({
    input, type, initial, foreground, edited, result,
  }) => {
    const { viewer, device } = await setup(false, true);
    const path = '/World/Ball';
    const nodeId = `${input}_mix`;
    if (type === 'color3') {
      await viewer.setObjectParameters(path, new Map([['surface:base_color', initial]]));
    }
    const root = viewer.objectSurfaceGraph(path)!.nodes.get('s')!;
    root.nodeDef = {
      name: 'ND_standard_surface_surfaceshader', nodeString: root.category, type: root.type,
      implementation: { kind: 'unresolved' },
      inputs: root.inputs.map(({ name, type: inputType }) => name !== input ? { name, type: inputType }
        : type === 'color3'
          ? { name, type: inputType, uiMinComponents: [0, 0, 0], uiMaxComponents: [1, 1, 1] }
          : { name, type: inputType, uiMin: 0, uiMax: 1 }),
    };
    expect(viewer.canInsertObjectConstant(path, 's', input, 'mix')).toBe(true);
    await viewer.setObjectConstant(path, 's', input, true, 'mix');
    const read = () => viewer.objectSurfaceGraph(path)!;
    expect(read().nodes.get(nodeId)?.nodeDef?.name).toBe(`ND_mix_${type}`);
    expect(read().nodes.get(nodeId)?.inputs.map(entry => entry.source)).toEqual([
      { kind: 'value', type, value: initial.join(', ') },
      { kind: 'value', type, value: foreground.join(', ') },
      { kind: 'value', type: 'float', value: '0' },
    ]);
    const parameters = viewer.objectParameters(path, nodeId);
    const fg = parameters.find(parameter => parameter.input === 'fg')!;
    const factor = parameters.find(parameter => parameter.input === 'mix')!;
    expect(fg.value).toEqual(foreground);
    expect(factor).toMatchObject({ min: [0], max: [1], value: [0] });
    const pipelines = device.createRenderPipeline.mock.calls.length;
    const changes = new Map<string, readonly number[]>();
    changes.set(fg.id, edited);
    changes.set(factor.id, [0.5]);
    await viewer.setObjectParameters(path, changes);
    expect(device.createRenderPipeline).toHaveBeenCalledTimes(pipelines);
    if (input === 'specular_roughness') {
      expect(viewer.objectConstantSources(path, 's', 'coat_roughness')).toEqual([nodeId]);
      await viewer.setObjectConstantLink(path, 's', 'coat_roughness', nodeId);
      await expect(viewer.setObjectConstant(path, nodeId, 'mix', false, 'mix')).rejects.toThrow('utilisé ailleurs');
      await viewer.setObjectConstantLink(path, 's', 'coat_roughness', null);
    }
    const xml = exportSurfaceGraph(read(), 'mat').xml;
    expect(xml).toContain(`<mix name="${nodeId}" type="${type}" nodedef="ND_mix_${type}">`);
    await viewer.setObjectConstant(path, nodeId, 'mix', false, 'mix');
    expect(read().nodes.has(nodeId)).toBe(false);
    const folded = viewer.objectParameters(path, 's').find(parameter => parameter.input === input)?.value;
    expect(folded).toHaveLength(result.length);
    folded!.forEach((component, index) => expect(component).toBeCloseTo(result[index]!));
    expect(viewer.objectParameters(path, nodeId)).toHaveLength(0);
  });

  it('inserts a neutral Divide, keeps its factor positive, exports it and preserves the quotient when removed', async () => {
    const { viewer, device } = await setup(false, true);
    const path = '/World/Ball';
    const input = 'specular_roughness';
    const nodeId = `${input}_divide`;
    const root = viewer.objectSurfaceGraph(path)!.nodes.get('s')!;
    root.nodeDef = {
      name: 'ND_standard_surface_surfaceshader', nodeString: root.category, type: root.type,
      implementation: { kind: 'unresolved' }, inputs: root.inputs.map(({ name, type }) => ({ name, type })),
    };
    await viewer.setObjectConstant(path, 's', input, true, 'divide');
    const read = () => viewer.objectSurfaceGraph(path)!;
    expect(read().nodes.get(nodeId)?.nodeDef?.name).toBe('ND_divide_float');
    const factor = viewer.objectParameters(path, nodeId)[0]!;
    expect(factor).toMatchObject({ min: [0.2], max: [1], value: [1] });
    await expect(viewer.setObjectParameters(path, new Map([[factor.id, [0.19]]]))).rejects.toThrow('below its minimum');
    const pipelines = device.createRenderPipeline.mock.calls.length;
    await viewer.setObjectParameters(path, new Map([[factor.id, [0.5]]]));
    expect(device.createRenderPipeline).toHaveBeenCalledTimes(pipelines);
    expect(exportSurfaceGraph(read(), 'mat').xml).toContain(
      `<divide name="${nodeId}" type="float" nodedef="ND_divide_float">`,
    );
    await viewer.setObjectConstant(path, nodeId, 'in2', false, 'divide');
    expect(read().nodes.has(nodeId)).toBe(false);
    expect(viewer.objectParameters(path, 's').find(entry => entry.input === input)?.value).toEqual([0.4]);
  });

  it('inserts a neutral Power with bounded exponents and preserves the powered result when removed', async () => {
    const { viewer, device } = await setup(false, true);
    const path = '/World/Ball';
    const input = 'specular_roughness';
    const nodeId = `${input}_power`;
    const root = viewer.objectSurfaceGraph(path)!.nodes.get('s')!;
    root.nodeDef = {
      name: 'ND_standard_surface_surfaceshader', nodeString: root.category, type: root.type,
      implementation: { kind: 'unresolved' }, inputs: root.inputs.map(({ name, type }) => ({ name, type })),
    };
    expect(viewer.canInsertObjectConstant(path, 's', 'base_color', 'power')).toBe(false);
    await viewer.setObjectConstant(path, 's', input, true, 'power');
    const read = () => viewer.objectSurfaceGraph(path)!;
    expect(read().nodes.get(nodeId)?.nodeDef?.name).toBe('ND_power_float');
    const exponent = viewer.objectParameters(path, nodeId)[0]!;
    expect(exponent).toMatchObject({ min: [0], max: [1], value: [1] });
    const pipelines = device.createRenderPipeline.mock.calls.length;
    await viewer.setObjectParameters(path, new Map([[exponent.id, [0.5]]]));
    expect(device.createRenderPipeline).toHaveBeenCalledTimes(pipelines);
    expect(exportSurfaceGraph(read(), 'mat').xml).toContain(
      `<power name="${nodeId}" type="float" nodedef="ND_power_float">`,
    );
    await viewer.setObjectConstant(path, nodeId, 'in2', false, 'power');
    expect(read().nodes.has(nodeId)).toBe(false);
    expect(viewer.objectParameters(path, 's').find(entry => entry.input === input)?.value)
      .toEqual([Math.sqrt(0.2)]);
  });

  it('uses the NodeDef bounds for Add when the input has no authored limits', async () => {
    const { viewer } = await setup(false, true);
    const path = '/World/Ball';
    const input = 'coat_roughness';
    const root = viewer.objectSurfaceGraph(path)!.nodes.get('s')!;
    root.nodeDef = {
      name: 'ND_standard_surface_surfaceshader', nodeString: 'standard_surface', type: 'surfaceshader',
      implementation: { kind: 'unresolved' }, inputs: [
        { name: 'coat_roughness', type: 'float', uiMin: 0, uiMax: 1 },
        { name: 'specular_roughness', type: 'float', uiMin: 0.3, uiMax: 0.9 },
      ],
    };
    // The authored range permits the current value (0.2); the NodeDef range would not.
    expect(viewer.canInsertObjectConstant(path, 's', 'specular_roughness', 'add')).toBe(true);
    expect(viewer.objectParameters(path, 's').find(entry => entry.input === input)?.min).toBeUndefined();
    await viewer.setObjectConstant(path, 's', input, true, 'add');
    const offset = viewer.objectParameters(path, `${input}_add`)[0]!;
    expect(offset).toMatchObject({ min: [-0.1], max: [0.9] });
    await expect(viewer.setObjectParameters(path, new Map([[offset.id, [0.91]]]))).rejects.toThrow('above its maximum');
    await viewer.setObjectParameters(path, new Map([[offset.id, [0.9]]]));
    await viewer.setObjectConstant(path, `${input}_add`, 'in2', false, 'add');
    expect(viewer.objectParameters(path, 's').find(entry => entry.input === input)?.value).toEqual([1]);
  });

  it.each([
    { kind: 'min', neutral: 1, threshold: 0.125 },
    { kind: 'max', neutral: 0, threshold: 0.625 },
  ] as const)('inserts a neutral $kind, edits its threshold live and folds the result', async ({ kind, neutral, threshold }) => {
    const { viewer, device } = await setup(false, true);
    const path = '/World/Ball';
    const input = 'specular_roughness';
    const nodeId = `${input}_${kind}`;
    const root = viewer.objectSurfaceGraph(path)!.nodes.get('s')!;
    root.nodeDef = {
      name: 'ND_standard_surface_surfaceshader', nodeString: root.category, type: root.type,
      implementation: { kind: 'unresolved' },
      inputs: root.inputs.map(({ name, type }) => name === 'coat_roughness'
        ? { name, type, uiMin: 0, uiMax: 1 }
        : name === input ? { name, type, uiMin: 0.1, uiMax: 0.9 } : { name, type }),
    };
    expect(viewer.canInsertObjectConstant(path, 's', 'base_color', kind)).toBe(false);
    expect(viewer.canInsertObjectConstant(path, 's', 'diffuse_roughness', kind)).toBe(false);
    expect(viewer.canInsertObjectConstant(path, 's', 'coat_roughness', kind)).toBe(true);
    await viewer.setObjectConstant(path, 's', input, true, kind);
    const read = () => viewer.objectSurfaceGraph(path)!;
    expect(read().nodes.get('s')?.inputs.find(entry => entry.name === input)?.source)
      .toEqual({ kind: 'connection', nodeId });
    const cutoff = viewer.objectParameters(path, nodeId)[0]!;
    expect(cutoff).toMatchObject({ min: [0], max: [1], value: [neutral] });
    const pipelines = device.createRenderPipeline.mock.calls.length;
    await expect(viewer.setObjectParameters(path, new Map([[cutoff.id, [-0.01]]]))).rejects.toThrow('below its minimum');
    await expect(viewer.setObjectParameters(path, new Map([[cutoff.id, [1.01]]]))).rejects.toThrow('above its maximum');
    await viewer.setObjectParameters(path, new Map([[cutoff.id, [threshold]]]));
    expect(device.createRenderPipeline).toHaveBeenCalledTimes(pipelines);
    const { xml } = exportSurfaceGraph(read(), 'mat');
    expect(xml).toContain(`<${kind} name="${nodeId}" type="float" nodedef="ND_${kind}_float">`);
    expect(xml).toContain(`<input name="in2" type="float" value="${threshold}"`);
    await viewer.setObjectConstant(path, nodeId, 'in2', false, kind);
    expect(read().nodes.has(nodeId)).toBe(false);
    expect(viewer.objectParameters(path, 's').find(entry => entry.input === input)?.value).toEqual([threshold]);
  });

  it('scales all three color components with one editable factor, then folds the result as color3', async () => {
    const { viewer, device } = await setup(false, true);
    const path = '/World/Ball';
    const input = 'base_color';
    const nodeId = `${input}_multiply`;
    await viewer.setObjectParameters(path, new Map([['surface:base_color', [0.2, 0.4, 0.8]]]));
    await viewer.setObjectConstant(path, 's', input, true, 'multiply');
    const multiply = viewer.objectSurfaceGraph(path)?.nodes.get(nodeId);
    expect(multiply?.nodeDef?.name).toBe('ND_multiply_color3FA');
    expect(multiply?.inputs[0]?.source).toEqual({ kind: 'value', type: 'color3', value: '0.2, 0.4, 0.8' });
    const factor = viewer.objectParameters(path, nodeId)[0]!;
    expect(factor.value).toEqual([1]);
    const pipelines = device.createRenderPipeline.mock.calls.length;
    device.queue.writeBuffer.mockClear();
    await viewer.setObjectParameters(path, new Map([[factor.id, [0.5]]]));
    expect(device.createRenderPipeline).toHaveBeenCalledTimes(pipelines);
    expect(device.queue.writeBuffer.mock.calls.some(([, , data]) =>
      data instanceof ArrayBuffer && new Float32Array(data).includes(0.5))).toBe(true);
    await viewer.setObjectConstant(path, nodeId, 'in2', false, 'multiply');
    expect(viewer.objectSurfaceGraph(path)?.nodes.get('s')?.inputs.find(entry => entry.name === input)?.source)
      .toEqual({ kind: 'value', type: 'color3', value: '0.1, 0.2, 0.4' });
    expect(viewer.objectParameters(path, 's').find(entry => entry.input === input)?.value).toEqual([0.1, 0.2, 0.4]);
  });

  it('updates a Multiply factor in a prepared MaterialX path tracer without recompiling', async () => {
    const actual = await vi.importActual<typeof import('../../src/render/pathtracing/scene-buffers.ts')>(
      '../../src/render/pathtracing/scene-buffers.ts');
    vi.mocked(buildCachedPathTraceScene).mockImplementation(actual.buildCachedPathTraceScene);
    const { viewer, device, statuses } = await setup(false, true, 'pathtracing');
    const path = '/World/Ball';
    await viewer.setObjectConstant(path, 's', 'base_color', true, 'multiply');
    const factor = viewer.objectParameters(path, 'base_color_multiply')[0]!;
    tick(0);
    await vi.waitFor(() => expect(statuses.at(-1)?.pathTracer).toBe('ready'));
    const pipelines = device.createComputePipelineAsync.mock.calls.length;
    device.queue.writeBuffer.mockClear();
    await viewer.setObjectParameters(path, new Map([[factor.id, [0.375]]]));
    expect(statuses.at(-1)).toMatchObject({ pathTracer: 'ready', samples: 0 });
    expect(device.createComputePipelineAsync).toHaveBeenCalledTimes(pipelines);
    expect(buildCachedPathTraceScene).toHaveBeenCalledOnce();
    expect(device.queue.writeBuffer.mock.calls.some(([, , data]) =>
      data instanceof ArrayBuffer && new Float32Array(data).includes(0.375))).toBe(true);
  });

  it('refreshes Disney material data after a Multiply edit without rebuilding raster', async () => {
    const dispose = vi.fn();
    const create = vi.spyOn(DisneyGpuBackend, 'create').mockResolvedValue(
      { dispose, reset: vi.fn() } as Pick<DisneyGpuBackend, 'dispose' | 'reset'> as DisneyGpuBackend,
    );
    try {
      const { viewer, device, statuses } = await setup(false, true);
      const path = '/World/Ball';
      await viewer.setObjectConstant(path, 's', 'base_color', true, 'multiply');
      const factor = viewer.objectParameters(path, 'base_color_multiply')[0]!;
      viewer.setBackend('disney');
      tick(0);
      await vi.waitFor(() => expect(statuses.at(-1)?.pathTracer).toBe('ready'));
      expect(create.mock.calls[0]?.[1].materials[0]?.baseColor).toEqual([0.8, 0.8, 0.8]);
      viewer.setBackend('raster');
      const pipelines = device.createRenderPipeline.mock.calls.length;
      await viewer.setObjectParameters(path, new Map([[factor.id, [0.5]]]));
      expect(device.createRenderPipeline).toHaveBeenCalledTimes(pipelines);
      expect(create).toHaveBeenCalledOnce();
      expect(dispose).toHaveBeenCalledOnce();
      viewer.setBackend('disney');
      tick(1);
      await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(2));
      expect(create.mock.calls[1]?.[1].materials[0]?.baseColor).toEqual([0.4, 0.4, 0.4]);
    } finally { create.mockRestore(); }
  });

  it('moves objects and edits Disney materials in place once the backend is ready', async () => {
    const backend = { dispose: vi.fn(), reset: vi.fn(), writeTexels: vi.fn(), writeLights: vi.fn(), writeMaterials: vi.fn() };
    const create = vi.spyOn(DisneyGpuBackend, 'create').mockResolvedValue(backend as unknown as DisneyGpuBackend);
    try {
      const { viewer, statuses } = await setup(false, true);
      const path = '/World/Ball';
      await viewer.setObjectConstant(path, 's', 'base_color', true, 'multiply');
      const factor = viewer.objectParameters(path, 'base_color_multiply')[0]!;
      viewer.setBackend('disney');
      tick(0);
      await vi.waitFor(() => expect(statuses.at(-1)?.pathTracer).toBe('ready'));
      viewer.setObjectTransform(path, translation4(0, 2, 0));
      const transforms = backend.writeTexels.mock.calls.at(-1)![0].find((write: { target: string }) => write.target === 'transforms');
      expect([...transforms.data.slice(12, 15)]).toEqual([0, 2, 0]);
      await viewer.setObjectParameters(path, new Map([[factor.id, [0.5]]]));
      expect(backend.writeMaterials.mock.calls.at(-1)![0][0].baseColor).toEqual([0.4, 0.4, 0.4]);
      expect(create).toHaveBeenCalledOnce();
      expect(backend.dispose).not.toHaveBeenCalled();
    } finally { create.mockRestore(); }
  });

  it('connects an editable Constant and restores the literal with its updated value without reloading USD', async () => {
    const { viewer } = await setup(false, true);
    const path = '/World/Ball';
    const input = 'base_color';
    const id = 'base_color_constant';
    const original = viewer.objectSurfaceGraph(path)!;
    const originalValue = viewer.objectParameters(path, 's').find(parameter => parameter.input === input)!.value;
    const readInput = () => viewer.objectSurfaceGraph(path)?.nodes.get('s')?.inputs.find(candidate => candidate.name === input)?.source;
    const loads = vi.mocked(loadUsdScene).mock.calls.length;
    await expect(viewer.setObjectConstant(path, 's', 'coat', true)).rejects.toThrow();
    expect(viewer.objectSurfaceGraph(path)).toBe(original);
    await viewer.setObjectConstant(path, 's', input, true);
    expect(original.nodes.has(id)).toBe(false);
    expect(readInput()).toEqual({ kind: 'connection', nodeId: id });
    expect(viewer.objectParameters(path, 's').some(parameter => parameter.input === input)).toBe(false);
    const parameter = viewer.objectParameters(path, id)[0]!;
    expect(parameter.value).toEqual(originalValue);
    await viewer.setObjectParameters(path, new Map([[parameter.id, [0.2, 0.4, 0.8]]]));
    expect(viewer.objectSurfaceGraph(path)?.nodes.get(id)?.inputs[0]?.source)
      .toEqual({ kind: 'value', type: 'color3', value: '0.2, 0.4, 0.8' });
    await viewer.setObjectConstant(path, id, 'value', false);
    expect(viewer.objectSurfaceGraph(path)?.nodes.has(id)).toBe(false);
    expect(readInput()).toEqual({ kind: 'value', type: 'color3', value: '0.2, 0.4, 0.8' });
    expect(viewer.objectParameters(path, 's').find(parameter => parameter.input === input)?.value).toEqual([0.2, 0.4, 0.8]);
    expect(loadUsdScene).toHaveBeenCalledTimes(loads);
  });

  it('rebuilds when an optional lobe activates or deactivates but keeps edits live while active', async () => {
    const { viewer, device } = await setup(false, true);
    const shaders = device.createShaderModule.mock.calls.length;
    const loads = vi.mocked(loadUsdScene).mock.calls.length;
    await viewer.setObjectParameters('/World/Ball', new Map([['surface:coat', [1]]]));
    expect(device.createShaderModule.mock.calls.length).toBeGreaterThan(shaders);
    expect(loadUsdScene).toHaveBeenCalledTimes(loads);
    const coat = viewer.objectParameters('/World/Ball').find(parameter => parameter.id === 'surface:coat')!;
    expect(coat.value).toEqual([1]);
    expect(coat.initial).toEqual([0]);
    const activeShaders = device.createShaderModule.mock.calls.length;
    await viewer.setObjectParameters('/World/Ball', new Map([['surface:coat', [0.5]]]));
    expect(device.createShaderModule).toHaveBeenCalledTimes(activeShaders);
    const deactivationShaders = device.createShaderModule.mock.calls.length;
    await viewer.setObjectParameters('/World/Ball', new Map([['surface:coat', [0]]]));
    expect(device.createShaderModule.mock.calls.length).toBeGreaterThan(deactivationShaders);
    await expect(viewer.setObjectParameters('/World/Ball', new Map([['surface:base_color', [NaN, 0, 0]]]))).rejects.toThrow();
    expect(viewer.objectParameters('/World/Ball').find(parameter => parameter.id === 'surface:coat')!.value).toEqual([0]);
  });

  it('updates PT material uniforms and resets accumulation without rebuilding the compute pipeline', async () => {
    const actual = await vi.importActual<typeof import('../../src/render/pathtracing/scene-buffers.ts')>(
      '../../src/render/pathtracing/scene-buffers.ts');
    vi.mocked(buildCachedPathTraceScene).mockImplementation(actual.buildCachedPathTraceScene);
    const { viewer, device, statuses } = await setup(false, true);
    viewer.setBackend('pathtracing');
    tick(0);
    await new Promise(resolve => setTimeout(resolve, 30));
    tick(1);
    await Promise.resolve();
    const pipelines = device.createComputePipelineAsync.mock.calls.length;
    expect(statuses.at(-1)?.samples).toBeGreaterThan(0);
    device.queue.writeBuffer.mockClear();
    await viewer.setObjectParameters('/World/Ball', new Map([['surface:specular_roughness', [0.7]]]));
    expect(statuses.at(-1)?.samples).toBe(0);
    expect(device.queue.writeBuffer.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(device.createComputePipelineAsync).toHaveBeenCalledTimes(pipelines);
    expect(buildCachedPathTraceScene).toHaveBeenCalledOnce();
    device.queue.writeBuffer.mockClear();
    await viewer.setObjectParameters('/World/Ball', new Map([['surface:base_color', [0.2, 0.4, 0.8]]]));
    expect(viewer.objectParameters('/World/Ball').find(parameter => parameter.id === 'surface:base_color')?.value).toEqual([0.2, 0.4, 0.8]);
    expect(device.queue.writeBuffer.mock.calls.some(call => call[2] instanceof ArrayBuffer
      && Array.from(new Float32Array(call[2])).some((value, i, data) =>
        Math.abs(value - 0.2) < 1e-6 && Math.abs(data[i + 1]! - 0.4) < 1e-6 && Math.abs(data[i + 2]! - 0.8) < 1e-6))).toBe(true);
    expect(device.createComputePipelineAsync).toHaveBeenCalledTimes(pipelines);
  });

  it('does not build path-tracing CPU data/BVH in raster, including after resize', async () => {
    const { viewer, device, loaded } = await setup();
    expect(loaded.resources.materials.size).toBe(1);
    expect(buildCachedPathTraceScene).not.toHaveBeenCalled();
    const pipelines = device.createRenderPipeline.mock.calls.length;
    const shaders = device.createShaderModule.mock.calls.length;
    const buffers = device.createBuffer.mock.calls.length;
    await viewer.resize(1024);
    expect(device.createRenderPipeline).toHaveBeenCalledTimes(pipelines);
    expect(device.createShaderModule).toHaveBeenCalledTimes(shaders);
    expect(device.createBuffer).toHaveBeenCalledTimes(buffers);
    expect(buildCachedPathTraceScene).not.toHaveBeenCalled();
  });

  it('resizes raster targets to 1024x768 and can return to square without recompiling', async () => {
    const { viewer, canvas, device } = await setup();
    const shaders = device.createShaderModule.mock.calls.length;
    await viewer.resize(128);
    expect(canvas.width).toBe(128);
    expect(canvas.height).toBe(128);
    await viewer.resize(1024, 768);
    expect(canvas.width).toBe(1024);
    expect(canvas.height).toBe(768);
    expect(device.createShaderModule).toHaveBeenCalledTimes(shaders);
    await viewer.resize(512);
    expect(canvas.width).toBe(512);
    expect(canvas.height).toBe(512);
    await expect(viewer.resize(768, 1024)).rejects.toThrow('Unsupported');
  });

  it('submits one interactive frame, keeps reference bands and reuses quality pipelines', async () => {
    const { viewer, device, pass, statuses } = await setup();
    device.queue.submit.mockClear();
    tick(0);
    expect(device.queue.submit).toHaveBeenCalledTimes(1);
    expect(pass.drawIndexed).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    await viewer.setRasterQuality('reference');
    device.queue.submit.mockClear();
    tick(1);
    expect(device.queue.submit).toHaveBeenCalledTimes(4);
    await Promise.resolve();
    const pipelines = device.createRenderPipeline.mock.calls.length;
    await viewer.setRasterQuality('interactive');
    await viewer.setRasterQuality('reference');
    expect(device.createRenderPipeline).toHaveBeenCalledTimes(pipelines);
    expect(statuses.at(-1)?.rasterQuality).toBe('reference');
  });

  it('starts CPU preparation only on first path-tracing render and not after disposal', async () => {
    const { viewer } = await setup();
    vi.mocked(buildCachedPathTraceScene).mockImplementation(async () => { throw new Error('test preparation'); });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      viewer.setBackend('pathtracing');
      expect(buildCachedPathTraceScene).not.toHaveBeenCalled();
      tick(0);
      await new Promise(r => setTimeout(r, 10));
      expect(buildCachedPathTraceScene).toHaveBeenCalledTimes(1);
      viewer.setBackend('raster');
      viewer.setBackend('pathtracing');
      tick(1);
      expect(buildCachedPathTraceScene).toHaveBeenCalledTimes(1);
      expect(error).toHaveBeenCalledWith('Path tracer: test preparation');
    } finally { error.mockRestore(); }
  });

  it('reports the selected material’s Disney approximations from applied values before GPU preparation', async () => {
    const { viewer, device } = await setup(false, true);
    const path = '/World/Ball';
    const diffuseWarning = 'Independent diffuse roughness is replaced by the squared specular roughness.';
    expect(viewer.objectDisneyMaterialDiagnostics(path)).toBeUndefined();
    viewer.setBackend('disney');
    expect(viewer.objectDisneyMaterialDiagnostics('/World/Unknown')).toBeUndefined();
    expect(viewer.objectDisneyMaterialDiagnostics(path)).toMatchObject({
      warnings: expect.arrayContaining([diffuseWarning]),
    });
    await viewer.setObjectParameters(path, new Map([
      ['surface:specular_roughness', [0]],
      ['surface:diffuse_roughness', [0]],
    ]));
    expect(viewer.objectDisneyMaterialDiagnostics(path)).toMatchObject({
      warnings: expect.not.arrayContaining([diffuseWarning]),
    });
    expect(device.createComputePipelineAsync).not.toHaveBeenCalled();
  });

  it('reports raster-only approximations of the selected material, but not in MaterialX path tracing', async () => {
    const { viewer } = await setup(false, true, 'raster', true, { transmission: true });
    const path = '/World/Ball';
    expect(viewer.objectMaterialBackendDiagnostics(path)).toEqual({ backend: 'raster', warnings: [] });
    await viewer.setObjectGraphInputLink(path, 's', 'transmission', 'amount');
    const raster = viewer.objectMaterialBackendDiagnostics(path);
    expect(raster).toMatchObject({ backend: 'raster', warnings: expect.arrayContaining([
      expect.stringContaining('Surface transparente'),
      expect.stringContaining('la réfraction ne montre que l’environnement'),
    ]) });
    expect(viewer.objectMaterialBackendDiagnostics('/World/Unknown')).toBeUndefined();
    viewer.setBackend('pathtracing');
    expect(viewer.objectMaterialBackendDiagnostics(path)).toEqual({ backend: 'pathtracing', warnings: [] });
  });

  it('does not repeatedly clear the Disney canvas while its pipeline is compiling or after an error', async () => {
    let rejectPipeline!: (error: Error) => void;
    const create = vi.spyOn(DisneyGpuBackend, 'create').mockImplementation(() =>
      new Promise((_resolve, reject) => { rejectPipeline = reject; }));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { viewer, device, statuses } = await setup(false, true);
      viewer.setBackend('disney');
      device.queue.submit.mockClear();
      tick(0);
      await new Promise(resolve => setTimeout(resolve, 20));
      expect(error.mock.calls).toEqual([]);
      expect(statuses.at(-1)?.pathTracer).toBe('compiling');
      const initialSubmits = device.queue.submit.mock.calls.length;
      for (let i = 0; i < 5; i++) { tick(i + 1); await Promise.resolve(); }
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(device.queue.submit).toHaveBeenCalledTimes(initialSubmits);
      rejectPipeline(new Error('pipeline failed'));
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(statuses.at(-1)?.pathTracer).toBe('error');
      tick(10);
      await Promise.resolve();
      const errorSubmits = device.queue.submit.mock.calls.length;
      expect(errorSubmits).toBe(initialSubmits + 1);
      for (let i = 0; i < 5; i++) { tick(i + 11); await Promise.resolve(); }
      expect(device.queue.submit).toHaveBeenCalledTimes(errorSubmits);
      expect(error).toHaveBeenCalledWith('Disney path tracer: pipeline failed');
    } finally { create.mockRestore(); error.mockRestore(); }
  });

  it('resumes Disney rendering when compilation completes, honoring pause', async () => {
    const { viewer, device, pass, statuses } = await setup(false, true);
    let finish!: () => void;
    device.createComputePipelineAsync.mockImplementation(() => new Promise(resolve => {
      finish = () => resolve({ getBindGroupLayout: vi.fn(() => ({})) });
    }));
    viewer.setBackend('disney');
    tick(0);
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(statuses.at(-1)?.pathTracer).toBe('compiling');
    viewer.setPathTracingPaused(true);
    finish();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(statuses.at(-1)?.pathTracer).toBe('ready');
    tick(1);
    await Promise.resolve();
    expect(pass.dispatchWorkgroups).not.toHaveBeenCalled();
    viewer.setPathTracingPaused(false);
    tick(2);
    await Promise.resolve();
    expect(pass.dispatchWorkgroups).toHaveBeenCalledTimes(4);
  });

  it('keeps the preview while refining tiles, defaults to raw and resizes without recompilation', async () => {
    const actual = await vi.importActual<typeof import('../../src/render/pathtracing/scene-buffers.ts')>(
      '../../src/render/pathtracing/scene-buffers.ts');
    vi.mocked(buildCachedPathTraceScene).mockImplementation(actual.buildCachedPathTraceScene);
    const { viewer, device, pass } = await setup();
    viewer.setBackend('pathtracing');
    tick(0);
    await new Promise(r => setTimeout(r, 20));
    await Promise.resolve();
    expect(device.createComputePipelineAsync).toHaveBeenCalledTimes(2);
    device.createCommandEncoder.mockClear();
    tick(1);
    await Promise.resolve();
    const previewDispatch = pass.dispatchWorkgroups.mock.calls.at(-1);
    expect(previewDispatch).toEqual([16, 16, 1]); // 512 / 4 / workgroup 8
    await new Promise(r => setTimeout(r, 220));
    device.createCommandEncoder.mockClear();
    device.queue.submit.mockClear();
    device.queue.onSubmittedWorkDone.mockClear();
    pass.dispatchWorkgroups.mockClear();
    pass.draw.mockClear();
    tick(2);
    await Promise.resolve();
    const refinement = device.createCommandEncoder.mock.results[0]!.value;
    expect(refinement.copyBufferToBuffer).toHaveBeenCalledWith(
      expect.anything(), 0, expect.anything(), 0, 128 * 128 * PT_DISPLAY_PIXEL_BYTES,
    );
    expect(pass.dispatchWorkgroups.mock.calls).toEqual(Array(16).fill([8, 8, 1]));
    expect(device.queue.submit).toHaveBeenCalledTimes(1);
    expect(device.queue.onSubmittedWorkDone).toHaveBeenCalledTimes(1);
    expect(pass.draw).toHaveBeenCalledTimes(1);
    const shaders = device.createShaderModule.mock.calls.length;
    const dispatches = pass.dispatchWorkgroups.mock.calls.length;
    viewer.setPathTracingPaused(true);
    viewer.setPathTracingDenoise(false);
    tick(3);
    await Promise.resolve();
    expect(pass.dispatchWorkgroups).toHaveBeenCalledTimes(dispatches);
    expect(viewer.pathTracingDenoise).toBe(false);
    const writes = device.queue.writeBuffer.mock.calls;
    const displayInfo = [...writes].reverse().find((call) => call[2] instanceof ArrayBuffer)?.[2] as ArrayBuffer;
    expect(new Uint32Array(displayInfo)[3]).toBe(0);
    const copyCalls = device.createCommandEncoder.mock.results.reduce((sum, result) =>
      sum + result.value.copyBufferToBuffer.mock.calls.length, 0);
    await viewer.resize(256);
    expect(device.createShaderModule).toHaveBeenCalledTimes(shaders);
    expect(device.createComputePipelineAsync).toHaveBeenCalledTimes(2);
    viewer.setPathTracingPaused(false);
    tick(4);
    await Promise.resolve();
    expect(device.createCommandEncoder.mock.results.reduce((sum, result) =>
      sum + result.value.copyBufferToBuffer.mock.calls.length, 0)).toBe(copyCalls);
  });

  it.each([false, true])('keeps tile/sweep order and bounded work in flight (adaptive=%s)', async adaptive => {
    const actual = await vi.importActual<typeof import('../../src/render/pathtracing/scene-buffers.ts')>(
      '../../src/render/pathtracing/scene-buffers.ts');
    vi.mocked(buildCachedPathTraceScene).mockImplementation(actual.buildCachedPathTraceScene);
    const { viewer, device, statuses } = await setup();
    expect(viewer.pathTracingAdaptive).toBe(false);
    viewer.setPathTracingAdaptive(adaptive);
    viewer.setBackend('pathtracing');
    tick(0);
    await new Promise(r => setTimeout(r, 20));
    tick(1);
    await Promise.resolve();
    await new Promise(r => setTimeout(r, 220));
    device.queue.writeBuffer.mockClear();
    device.queue.submit.mockClear();
    device.queue.onSubmittedWorkDone.mockClear();
    for (let refresh = 0; refresh < 64; refresh++) {
      tick(refresh + 2);
      const submits = device.queue.submit.mock.calls.length;
      tick(refresh + 2);
      expect(device.queue.submit).toHaveBeenCalledTimes(submits);
      await Promise.resolve();
    }
    expect(statuses.at(-1)?.samples).toBe(16);
    await vi.waitFor(() => expect(statuses.at(-1)?.convergence?.samples).toBe(16));
    const convergenceCopies = device.createCommandEncoder.mock.results.flatMap(result =>
      result.value.copyBufferToBuffer.mock.calls).filter(([, , , , size]) => size === 8 * 8 * 16);
    expect(convergenceCopies.length).toBeGreaterThan(0);
    expect(device.queue.submit).toHaveBeenCalledTimes(64);
    expect(device.queue.onSubmittedWorkDone).toHaveBeenCalledTimes(64);
    const uniforms = device.queue.writeBuffer.mock.calls.map(call => call[2])
      .filter((data): data is Float32Array => data instanceof Float32Array && data.byteLength === PT_UNIFORM_SIZE);
    const tileCount = pathTraceTileCount(512, 512);
    expect(uniforms).toHaveLength(64 * 16);
    for (const [index, data] of uniforms.entries()) {
      expect(Array.from(data.slice(32, 36))).toEqual([Math.floor(index / tileCount), 1, 512, 512]);
      expect(data[82]).toBe(adaptive ? 1 : 0);
      const tile = pathTraceTile(512, 512, index % tileCount);
      expect(Array.from(data.slice(76, 80))).toEqual([tile.x, tile.y, tile.width, tile.height]);
      const writeIndex = device.queue.writeBuffer.mock.calls.findIndex(call => call[2] === data);
      const writeOrder = device.queue.writeBuffer.mock.invocationCallOrder[writeIndex]!;
      const batch = Math.floor(index / 16);
      const submitOrder = device.queue.submit.mock.invocationCallOrder[batch]!;
      expect(writeOrder).toBeLessThan(submitOrder);
      if (batch > 0) expect(writeOrder).toBeGreaterThan(device.queue.submit.mock.invocationCallOrder[batch - 1]!);
      const buffer = device.queue.writeBuffer.mock.calls[writeIndex]![0];
      const batchBuffers = uniforms.slice(batch * 16, batch * 16 + 16).map(uniform =>
        device.queue.writeBuffer.mock.calls.find(call => call[2] === uniform)![0]);
      expect(new Set(batchBuffers).size).toBe(16);
      expect(device.createBindGroup.mock.calls.some(([desc]) => Array.from(desc.entries).some(entry =>
        'buffer' in entry.resource && entry.resource.buffer === buffer))).toBe(true);
    }
    viewer.setPathTracingAdaptive(adaptive);
    expect(statuses.at(-1)?.samples).toBe(16);
    viewer.setPathTracingAdaptive(!adaptive);
    expect(viewer.pathTracingAdaptive).toBe(!adaptive);
    expect(statuses.at(-1)?.samples).toBe(0);
    expect(statuses.at(-1)?.convergence).toBeUndefined();
    device.queue.writeBuffer.mockClear();
    tick(100);
    const preview = device.queue.writeBuffer.mock.calls.map(call => call[2])
      .find((data): data is Float32Array => data instanceof Float32Array && data.byteLength === PT_UNIFORM_SIZE);
    expect(preview?.[82]).toBe(0);
  });

  it('stops compute and refills at the time budget, but can redisplay and restart without counting stale work', async () => {
    let clock = 0;
    const now = vi.spyOn(performance, 'now').mockImplementation(() => clock);
    try {
      const actual = await vi.importActual<typeof import('../../src/render/pathtracing/scene-buffers.ts')>(
        '../../src/render/pathtracing/scene-buffers.ts');
      vi.mocked(buildCachedPathTraceScene).mockImplementation(actual.buildCachedPathTraceScene);
      const { viewer, device, statuses } = await setup();
      for (const budget of [-1, NaN, Infinity]) {
        expect(() => viewer.setPathTracingLimits({
          stopOnConvergence: false, timeBudgetSeconds: budget, targetRelativeError: 0.05,
        })).toThrow(RangeError);
      }
      for (const targetRelativeError of [NaN, 0.004, 0.251]) {
        expect(() => viewer.setPathTracingLimits({
          stopOnConvergence: false, timeBudgetSeconds: 0, targetRelativeError,
        })).toThrow(RangeError);
      }
      viewer.setPathTracingLimits({ stopOnConvergence: false, timeBudgetSeconds: 1, targetRelativeError: 0.05 });
      viewer.setBackend('pathtracing');
      tick(0);
      await new Promise(r => setTimeout(r, 20));
      tick(1);
      clock = 100;
      await Promise.resolve();
      expect(statuses.at(-1)?.pathTracingProgress?.elapsedSeconds).toBe(0);
      clock = 300;
      tick(2);
      clock = 1300;
      await Promise.resolve();
      expect(statuses.at(-1)?.pathTracingProgress).toEqual({ elapsedSeconds: 1, stopReason: 'time-budget' });
      expect(statuses.at(-1)?.pathTracingMetrics?.budgetRemainingSeconds).toBe(0);
      const computeWrites = () => device.queue.writeBuffer.mock.calls.filter(call =>
        call[2] instanceof Float32Array && call[2].byteLength === PT_UNIFORM_SIZE).length;
      const writes = computeWrites();
      tick(3);
      viewer.setExposure(1);
      tick(4);
      await Promise.resolve();
      await new Promise(r => setTimeout(r, 0));
      expect(computeWrites()).toBe(writes);
      expect(statuses.at(-1)?.pathTracingPaused).toBe(false);
      expect(statuses.at(-1)?.pathTracingProgress?.elapsedSeconds).toBe(1);
      await viewer.setTonemap('none');
      tick(5);
      await Promise.resolve();
      expect(computeWrites()).toBe(writes);
      expect(statuses.at(-1)?.pathTracingProgress?.stopReason).toBe('time-budget');
      const displayData = device.queue.writeBuffer.mock.calls.map(call => call[2])
        .filter((data): data is ArrayBuffer => data instanceof ArrayBuffer && data.byteLength === PT_DISPLAY_INFO_BYTES);
      expect(new Float32Array(displayData.at(-1)!)[35]).toBe(tonemapIndex('none'));
      viewer.setPathTracingLimits({ stopOnConvergence: false, timeBudgetSeconds: 0, targetRelativeError: 0.05 });
      tick(5);
      expect(computeWrites()).toBeGreaterThan(writes);
      viewer.restartPathTracing();
      clock = 2300;
      await Promise.resolve();
      expect(statuses.at(-1)?.samples).toBe(0);
      expect(statuses.at(-1)?.pathTracingProgress).toEqual({ elapsedSeconds: 0, stopReason: undefined });
      expect(statuses.at(-1)?.pathTracingMetrics).toEqual({});
      viewer.setPathTracingPaused(true);
      clock = 100000;
      tick(6);
      await Promise.resolve();
      expect(statuses.at(-1)?.pathTracingProgress?.elapsedSeconds).toBe(0);
    } finally { now.mockRestore(); }
  });

  it('stops only after three mature convergence readbacks and resumes when limits are disabled', async () => {
    const actual = await vi.importActual<typeof import('../../src/render/pathtracing/scene-buffers.ts')>(
      '../../src/render/pathtracing/scene-buffers.ts');
    vi.mocked(buildCachedPathTraceScene).mockImplementation(actual.buildCachedPathTraceScene);
    const { viewer, device, statuses } = await setup();
    await viewer.resize(128);
    viewer.setPathTracingLimits({ stopOnConvergence: true, timeBudgetSeconds: 0, targetRelativeError: 0.025 });
    viewer.setBackend('pathtracing');
    tick(0);
    await new Promise(r => setTimeout(r, 20));
    tick(1);
    await Promise.resolve();
    await new Promise(r => setTimeout(r, 220));
    const readbackIndex = device.createBuffer.mock.calls.findIndex(([desc]) =>
      desc.size === 8 * 8 * 16 && (desc.usage & GPUBufferUsage.MAP_READ) !== 0);
    const values = new Float32Array(8 * 8 * 4);
    for (let i = 0; i < 64; i++) values.set([0.01, 0.02, 1, 1], i * 4);
    device.createBuffer.mock.results[readbackIndex]!.value.getMappedRange = () => values.buffer;
    let refresh = 2;
    for (let sweep = 1; sweep <= 80; sweep++) {
      for (let batch = 0; batch < 4; batch++) {
        tick(refresh++);
        await Promise.resolve();
      }
      expect(statuses.at(-1)?.samples).toBe(sweep);
      expect(statuses.at(-1)?.pathTracingProgress?.stopReason).toBe(sweep === 80 ? 'convergence' : undefined);
    }
    tick(refresh++);
    expect(statuses.at(-1)?.samples).toBe(80);
    expect(statuses.at(-1)?.pathTracingMetrics?.sweepsPerSecond).toBeGreaterThan(0);
    expect(statuses.at(-1)?.pathTracingMetrics?.convergenceRemainingSeconds).toBe(0);
    expect(statuses.at(-1)?.pathTracingMetrics?.maximumRelativeNoise).toBeCloseTo(0.02);
    expect(statuses.at(-1)?.convergence?.targetRelativeError).toBe(0.025);
    const convergenceUniform = device.queue.writeBuffer.mock.calls.map(call => call[2])
      .filter((data): data is ArrayBuffer => data instanceof ArrayBuffer && data.byteLength === PT_CONVERGENCE_UNIFORM_BYTES)
      .at(-1)!;
    expect(new Float32Array(convergenceUniform)[4]).toBeCloseTo(0.025);
    viewer.setPathTracingLimits({ stopOnConvergence: false, timeBudgetSeconds: 0, targetRelativeError: 0.01 });
    for (let batch = 0; batch < 4; batch++) {
      tick(refresh++);
      await Promise.resolve();
    }
    expect(statuses.at(-1)?.samples).toBe(81);
    expect(statuses.at(-1)?.pathTracingProgress?.stopReason).toBeUndefined();
    await vi.waitFor(() => expect(statuses.at(-1)?.convergence?.targetRelativeError).toBe(0.01));
    await viewer.resize(256);
    expect(statuses.at(-1)?.samples).toBe(0);
    expect(statuses.at(-1)?.pathTracingProgress?.elapsedSeconds).toBe(0);
    expect(statuses.at(-1)?.pathTracingMetrics).toEqual({});
  });

  it('refills after GPU completion without another animation frame, but yields and honors pause/dispose', async () => {
    const actual = await vi.importActual<typeof import('../../src/render/pathtracing/scene-buffers.ts')>(
      '../../src/render/pathtracing/scene-buffers.ts');
    vi.mocked(buildCachedPathTraceScene).mockImplementation(actual.buildCachedPathTraceScene);
    const { viewer, device, canvas } = await setup();
    viewer.setBackend('pathtracing');
    tick(0);
    await new Promise(r => setTimeout(r, 20));
    tick(1);
    await Promise.resolve();
    await new Promise(r => setTimeout(r, 220));
    let complete!: () => void;
    device.queue.onSubmittedWorkDone.mockImplementation(() => new Promise<void>(resolve => { complete = resolve; }));
    device.queue.submit.mockClear();
    tick(2);
    expect(device.queue.submit).toHaveBeenCalledTimes(1);
    tick(3);
    expect(device.queue.submit).toHaveBeenCalledTimes(1);
    complete();
    await Promise.resolve();
    expect(device.queue.submit).toHaveBeenCalledTimes(1);
    await new Promise(r => setTimeout(r, 0));
    expect(device.queue.submit).toHaveBeenCalledTimes(2);
    complete();
    await Promise.resolve();
    viewer.setPathTracingPaused(true);
    await new Promise(r => setTimeout(r, 0));
    // Pause may redisplay once, never adding compute samples.
    const writes = device.queue.writeBuffer.mock.calls.filter(call =>
      call[2] instanceof Float32Array && call[2].byteLength === PT_UNIFORM_SIZE).length;
    complete();
    await Promise.resolve();
    await new Promise(r => setTimeout(r, 0));
    expect(device.queue.writeBuffer.mock.calls.filter(call =>
      call[2] instanceof Float32Array && call[2].byteLength === PT_UNIFORM_SIZE)).toHaveLength(writes);
    viewer.setPathTracingPaused(false);
    tick(4);
    complete();
    await Promise.resolve();
    const ownerDocument = { visibilityState: 'hidden' };
    Object.defineProperty(canvas, 'ownerDocument', { value: ownerDocument });
    const hiddenSubmits = device.queue.submit.mock.calls.length;
    await new Promise(r => setTimeout(r, 0));
    expect(device.queue.submit).toHaveBeenCalledTimes(hiddenSubmits);
    ownerDocument.visibilityState = 'visible';
    tick(5);
    complete();
    await Promise.resolve();
    viewer.dispose();
    const submits = device.queue.submit.mock.calls.length;
    await new Promise(r => setTimeout(r, 0));
    expect(device.queue.submit).toHaveBeenCalledTimes(submits);
  });

  it('rebinds all tile uniforms to the replacement accumulation after resize', async () => {
    const actual = await vi.importActual<typeof import('../../src/render/pathtracing/scene-buffers.ts')>(
      '../../src/render/pathtracing/scene-buffers.ts');
    vi.mocked(buildCachedPathTraceScene).mockImplementation(actual.buildCachedPathTraceScene);
    const { viewer, device } = await setup();
    viewer.setBackend('pathtracing');
    tick(0);
    await new Promise(r => setTimeout(r, 20));
    viewer.setPathTracingPaused(true);
    device.createBindGroup.mockClear();
    await viewer.resize(256);
    const groups = device.createBindGroup.mock.calls.map(([desc]) => Array.from(desc.entries));
    const compute = groups.filter(entries => entries.length > 6);
    expect(compute).toHaveLength(16);
    const buffers = compute.map(entries => entries.filter(entry => 'buffer' in entry.resource).map(entry => entry.resource));
    expect(new Set(buffers.map(entries => (entries[0] as GPUBufferBinding).buffer)).size).toBe(16);
    // Only the per-tile camera uniform differs; every scene/storage binding is shared.
    for (let i = 1; i < buffers[0]!.length; i++) {
      expect(new Set(buffers.map(entries => (entries[i] as GPUBufferBinding).buffer)).size).toBe(1);
    }
  });

  it('redisplays a paused replacement scene when an older scene releases the denoiser', async () => {
    const actual = await vi.importActual<typeof import('../../src/render/pathtracing/scene-buffers.ts')>(
      '../../src/render/pathtracing/scene-buffers.ts');
    vi.mocked(buildCachedPathTraceScene).mockImplementation(actual.buildCachedPathTraceScene);
    const image = new ImageData(new Uint8ClampedArray(512 * 512 * 4), 512, 512);
    let busy = false;
    let finish!: (image: ImageData) => void;
    const busyGetter = vi.spyOn(JsDenoiser.prototype, 'busy', 'get').mockImplementation(() => busy);
    const run = vi.spyOn(JsDenoiser.prototype, 'run').mockImplementationOnce(() => {
      busy = true;
      return new Promise<ImageData>(resolve => { finish = resolve; }).finally(() => { busy = false; });
    }).mockResolvedValue(image);
    try {
      const { viewer, device, statuses } = await setup();
      viewer.setPathTracingDenoise(true);
      viewer.setBackend('pathtracing');
      const sweep = async () => {
        tick(0);
        await new Promise(r => setTimeout(r, 20));
        tick(1);
        await Promise.resolve();
        await new Promise(r => setTimeout(r, 220));
        for (let i = 0; i < 16; i++) { tick(i + 2); await Promise.resolve(); }
        await new Promise(r => setTimeout(r, 0));
      };
      await sweep();
      expect(run).toHaveBeenCalledTimes(1);
      await viewer.load('replacement.usda');
      await sweep();
      viewer.setPathTracingPaused(true);
      expect(statuses.at(-1)?.denoiser.state).toBe('waiting');
      const samples = statuses.at(-1)?.samples;
      finish(image);
      await new Promise(r => setTimeout(r, 0));
      tick(40);
      await new Promise(r => setTimeout(r, 0));
      expect(run).toHaveBeenCalledTimes(2);
      expect(statuses.at(-1)?.denoiser.state).toBe('ready');
      expect(statuses.at(-1)?.samples).toBe(samples);
      expect(device.queue.writeTexture).toHaveBeenCalledTimes(1);
    } finally { run.mockRestore(); busyGetter.mockRestore(); }
  });

  it('compares a frozen beauty accumulation against a fresh denoiser result', async () => {
    const actual = await vi.importActual<typeof import('../../src/render/pathtracing/scene-buffers.ts')>(
      '../../src/render/pathtracing/scene-buffers.ts');
    vi.mocked(buildCachedPathTraceScene).mockImplementation(actual.buildCachedPathTraceScene);
    const image = new ImageData(new Uint8ClampedArray(512 * 512 * 4), 512, 512);
    const run = vi.spyOn(JsDenoiser.prototype, 'run').mockResolvedValue(image);
    try {
      const { viewer, device, statuses } = await setup(false, false, 'pathtracing');
      viewer.setPathTracingDenoise(true);
      expect(() => viewer.setPathTracingDenoiserComparison(true)).toThrow('requires a paused MaterialX beauty render');
      tick(0);
      await new Promise(r => setTimeout(r, 20));
      tick(1);
      await new Promise(r => setTimeout(r, 220));
      for (let i = 0; i < 16; i++) { tick(i + 2); await Promise.resolve(); }
      await vi.waitFor(() => expect(statuses.at(-1)?.denoiser.state).toBe('ready'));
      viewer.setPathTracingPaused(true);
      const frozenSamples = statuses.at(-1)!.samples;
      expect(frozenSamples).toBeGreaterThan(0);
      viewer.setPathTracingDenoiserComparison(true);
      expect(statuses.at(-1)?.denoiserComparison).toBe(true);
      tick(20);
      await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(2));
      await vi.waitFor(() => expect(statuses.at(-1)?.denoiser.state).toBe('ready'));
      expect(statuses.at(-1)?.samples).toBe(frozenSamples);
      tick(21);
      const displayInfo = [...device.queue.writeBuffer.mock.calls].reverse()
        .map(call => call[2]).find(data => data instanceof ArrayBuffer && data.byteLength === PT_DISPLAY_INFO_BYTES);
      expect(new Float32Array(displayInfo as ArrayBuffer)[31]).toBe(0.5);
      viewer.setExposure(0.5);
      expect(statuses.at(-1)?.denoiserComparison).toBe(false);
      viewer.setPathTracingPaused(false);
      expect(statuses.at(-1)?.denoiserComparison).toBe(false);
    } finally { run.mockRestore(); }
  });

  it('shares the real HDR CDF with the path tracer and keeps its sampling metadata', async () => {
    const actual = await vi.importActual<typeof import('../../src/render/pathtracing/scene-buffers.ts')>(
      '../../src/render/pathtracing/scene-buffers.ts');
    vi.mocked(buildCachedPathTraceScene).mockImplementation(actual.buildCachedPathTraceScene);
    const { viewer, device, loaded } = await setup(true);
    viewer.setBackend('pathtracing');
    tick(0);
    await new Promise(r => setTimeout(r, 20));
    const expected = buildEnvCdf(loaded.environment!.image);
    const upload = device.queue.writeBuffer.mock.calls.find(call =>
      call[2] instanceof Float32Array && call[2].length === expected.cdf.length && call[2][7] === expected.cdf[7]);
    expect(upload).toBeDefined();
    const cdfBuffer = upload![0];
    expect(device.createBindGroup.mock.calls.some(([desc]) =>
      Array.from(desc.entries).some(entry => entry.binding === 2 && 'buffer' in entry.resource && entry.resource.buffer === cdfBuffer))).toBe(true);
    const scene = await vi.mocked(buildCachedPathTraceScene).mock.results[0]!.value;
    expect(scene.environment.envTotalSum).toBe(expected.totalSum);
    expect(scene.environment.envResX).toBe(4);
  });

  it('reports neural inference errors and ignores results invalidated by resize or disabling', async () => {
    const actual = await vi.importActual<typeof import('../../src/render/pathtracing/scene-buffers.ts')>(
      '../../src/render/pathtracing/scene-buffers.ts');
    vi.mocked(buildCachedPathTraceScene).mockImplementation(actual.buildCachedPathTraceScene);
    const run = vi.spyOn(JsDenoiser.prototype, 'run').mockRejectedValue(new Error('model unavailable'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { viewer, device, statuses } = await setup();
      viewer.setPathTracingDenoise(true);
      viewer.setBackend('pathtracing');
      tick(0);
      await new Promise(r => setTimeout(r, 20));
      tick(1);
      await Promise.resolve();
      await new Promise(r => setTimeout(r, 220));
      for (let i = 0; i < 16; i++) { tick(i + 2); await Promise.resolve(); }
      await new Promise(r => setTimeout(r, 0));
      expect(run).toHaveBeenCalledTimes(1);
      expect(statuses.at(-1)?.denoiser).toEqual({ state: 'error', error: 'model unavailable' });
      expect(error).toHaveBeenCalledWith('JS denoiser failed:', expect.any(Error));
      viewer.setPathTracingPaused(true);
      let finish!: (image: ImageData) => void;
      run.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
      viewer.setPathTracingDenoise(false);
      viewer.setPathTracingDenoise(true);
      tick(18);
      await new Promise(r => setTimeout(r, 0));
      expect(statuses.at(-1)?.denoiser.state).toBe('running');
      const writes = device.queue.writeTexture.mock.calls.length;
      await viewer.resize(256);
      viewer.setPathTracingDenoise(false);
      finish(new ImageData(new Uint8ClampedArray(512 * 512 * 4), 512, 512));
      await new Promise(r => setTimeout(r, 0));
      expect(device.queue.writeTexture).toHaveBeenCalledTimes(writes);
      expect(statuses.at(-1)?.denoiser.state).toBe('off');
    } finally { run.mockRestore(); error.mockRestore(); }
  });

  it('retains old targets on allocation failure and destroys replaced targets', async () => {
    const { viewer, device, textures, canvas } = await setup();
    const previous = textures.slice(-2);
    device.createTexture.mockImplementationOnce(() => { throw new Error('out of memory'); });
    await expect(viewer.resize(1024)).rejects.toThrow('out of memory');
    expect(canvas.width).toBe(512);
    expect(previous.every(t => t.destroy.mock.calls.length === 0)).toBe(true);
    await viewer.resize(256);
    expect(previous.every(t => t.destroy.mock.calls.length === 1)).toBe(true);
    expect(canvas.width).toBe(256);
  });

  it('does not queue more frames while the GPU is busy', async () => {
    const { viewer, device } = await setup();
    let done!: () => void;
    device.queue.onSubmittedWorkDone.mockImplementationOnce(() => new Promise<void>(r => { done = r; }));
    device.queue.submit.mockClear();
    tick(0);
    await viewer.resize(256);
    tick(1);
    expect(device.queue.submit).toHaveBeenCalledTimes(1);
    done();
    await Promise.resolve();
    tick(2);
    expect(device.queue.submit).toHaveBeenCalledTimes(2);
  });

  it('generates every HDR mip once and reuses the filtering pipeline per device', () => {
    const { device, gpu } = fakeDevice();
    const texture = device.createTexture({ size: [8, 4], format: 'rgba16float', usage: 1, mipLevelCount: 4 });
    generateEnvironmentMipmaps(gpu, texture as unknown as GPUTexture);
    expect(device.createRenderPipeline).toHaveBeenCalledTimes(1);
    expect(device.createBindGroup).toHaveBeenCalledTimes(3);
    expect(texture.createView.mock.calls).toEqual([
      [{ baseMipLevel: 0, mipLevelCount: 1 }], [{ baseMipLevel: 1, mipLevelCount: 1 }],
      [{ baseMipLevel: 1, mipLevelCount: 1 }], [{ baseMipLevel: 2, mipLevelCount: 1 }],
      [{ baseMipLevel: 2, mipLevelCount: 1 }], [{ baseMipLevel: 3, mipLevelCount: 1 }],
    ]);
    generateEnvironmentMipmaps(gpu, texture as unknown as GPUTexture);
    expect(device.createRenderPipeline).toHaveBeenCalledTimes(1);
  });

  it('allocates only the selected AOV and resets samples when a guide is selected', async () => {
    const actual = await vi.importActual<typeof import('../../src/render/pathtracing/scene-buffers.ts')>(
      '../../src/render/pathtracing/scene-buffers.ts');
    vi.mocked(buildCachedPathTraceScene).mockImplementation(actual.buildCachedPathTraceScene);
    const { viewer, device, pass, statuses } = await setup();
    viewer.setBackend('pathtracing');
    tick(0);
    await new Promise(resolve => setTimeout(resolve, 20));
    tick(1);
    await Promise.resolve();
    viewer.setPathTracingPaused(true);
    const samples = statuses.at(-1)?.samples;
    expect(samples).toBeGreaterThan(0);
    const pipelines = device.createRenderPipeline.mock.calls.length;
    let refresh = 2;
    for (const value of ['variance', 'beauty'] as const) {
      device.queue.writeBuffer.mockClear();
      device.queue.submit.mockClear();
      pass.dispatchWorkgroups.mockClear();
      viewer.setPathTracingView(value);
      tick(refresh++);
      await Promise.resolve();
      const uniform = device.queue.writeBuffer.mock.calls.map(call => call[2])
        .find((data): data is ArrayBuffer => data instanceof ArrayBuffer && data.byteLength === PT_DISPLAY_INFO_BYTES);
      expect(uniform).toBeDefined();
      expect(new Float32Array(uniform!)[27]).toBe(pathTraceViewIndex(value));
      expect(device.queue.submit).toHaveBeenCalled();
      expect(pass.dispatchWorkgroups).not.toHaveBeenCalled();
      expect(device.createRenderPipeline).toHaveBeenCalledTimes(pipelines);
      expect(statuses.at(-1)?.samples).toBe(samples);
      expect(statuses.at(-1)?.pathTracingView).toBe(value);
    }

    viewer.setPathTracingView('normal');
    tick(refresh++);
    await Promise.resolve();
    expect(statuses.at(-1)?.samples).toBe(0);
    expect(device.createBuffer.mock.calls.some(([descriptor]) =>
      descriptor.size === 512 * 512 * (PT_DISPLAY_PIXEL_BYTES + PT_SURFACE_AOV_PIXEL_BYTES))).toBe(true);
    expect(device.createBuffer.mock.calls.some(([descriptor]) =>
      descriptor.size === 256 * 256 * (PT_DISPLAY_PIXEL_BYTES + PT_SURFACE_AOV_PIXEL_BYTES))).toBe(true);
    expect(pass.dispatchWorkgroups).not.toHaveBeenCalled();
    expect(device.createRenderPipeline).toHaveBeenCalledTimes(pipelines);

    viewer.setPathTracingView('transmission');
    tick(refresh++);
    await Promise.resolve();
    expect(statuses.at(-1)?.samples).toBe(0);

    viewer.setPathTracingView('variance');
    tick(refresh++);
    await Promise.resolve();
    expect(statuses.at(-1)?.samples).toBe(0);
    expect(device.createBuffer.mock.calls.some(([descriptor]) =>
      descriptor.size === 512 * 512 * PT_DISPLAY_PIXEL_BYTES)).toBe(true);
    expect(device.createBuffer.mock.calls.some(([descriptor]) =>
      descriptor.size === 256 * 256 * PT_DISPLAY_PIXEL_BYTES)).toBe(true);
    expect(pass.dispatchWorkgroups).not.toHaveBeenCalled();
    expect(device.createRenderPipeline).toHaveBeenCalledTimes(pipelines);
  });

  it('reads raw selected guides and derives variance from the accumulated moments', async () => {
    const actual = await vi.importActual<typeof import('../../src/render/pathtracing/scene-buffers.ts')>(
      '../../src/render/pathtracing/scene-buffers.ts');
    vi.mocked(buildCachedPathTraceScene).mockImplementation(actual.buildCachedPathTraceScene);
    const { viewer, device, statuses } = await setup();
    viewer.setPathTracingView('albedo');
    viewer.setBackend('pathtracing');
    tick(0);
    await vi.waitFor(() => expect(statuses.at(-1)?.pathTracer).toBe('ready'));
    tick(1);
    await Promise.resolve();
    viewer.setPathTracingPaused(true);
    expect(statuses.at(-1)?.samples).toBeGreaterThan(0);

    const width = 128;
    const height = 128;
    const pixelCount = width * height;
    const guideValues = new Float32Array(pixelCount * 12);
    guideValues[3] = 1;
    const guideOffset = pixelCount * 8;
    guideValues[guideOffset] = 0.25;
    guideValues[guideOffset + 1] = 0.125;
    guideValues[guideOffset + 2] = -0.5;
    guideValues[guideOffset + 3] = 0.5;
    const guideRead = viewer.readPathTracingAov();
    const guideReadback = device.createBuffer.mock.results.at(-1)!.value;
    const guideCopy = device.createCommandEncoder.mock.results.at(-1)!.value.copyBufferToBuffer;
    guideReadback.getMappedRange = () => guideValues.buffer;
    const guide = await guideRead;
    expect(guide).toMatchObject({ width, height, channels: 3 });
    expect(Array.from(guide.values.slice(0, 3))).toEqual([0.5, 0.25, -1]);
    expect(Number.isNaN(guide.values[3])).toBe(true);
    expect(guideCopy).toHaveBeenCalledWith(
      expect.anything(), 0, guideReadback, 0, pixelCount * (PT_DISPLAY_PIXEL_BYTES + PT_SURFACE_AOV_PIXEL_BYTES),
    );

    viewer.setPathTracingView('variance');
    tick(2);
    await Promise.resolve();
    const varianceValues = new Float32Array(pixelCount * 8);
    varianceValues[3] = 2;
    varianceValues[5] = 3;
    varianceValues[8 + 3] = 1;
    const varianceRead = viewer.readPathTracingAov();
    const varianceReadback = device.createBuffer.mock.results.at(-1)!.value;
    const varianceCopy = device.createCommandEncoder.mock.results.at(-1)!.value.copyBufferToBuffer;
    varianceReadback.getMappedRange = () => varianceValues.buffer;
    const variance = await varianceRead;
    expect(variance.channels).toBe(1);
    expect(variance.values[0]).toBe(3);
    expect(Number.isNaN(variance.values[1])).toBe(true);
    expect(varianceCopy).toHaveBeenCalledWith(
      expect.anything(), 0, varianceReadback, 0, pixelCount * PT_DISPLAY_PIXEL_BYTES,
    );
  });

  it.each(['raster', 'pathtracing', 'disney'] as const)(
    'updates the %s tonemap and exposure while paused, without recompilation or resetting samples', async backend => {
      const actual = await vi.importActual<typeof import('../../src/render/pathtracing/scene-buffers.ts')>(
        '../../src/render/pathtracing/scene-buffers.ts');
      vi.mocked(buildCachedPathTraceScene).mockImplementation(actual.buildCachedPathTraceScene);
      const { viewer, device, pass, statuses } = await setup(false, true);
      await viewer.setTonemap('reinhard');
      viewer.setBackend(backend);
      tick(0);
      await new Promise(resolve => setTimeout(resolve, 20));
      tick(1);
      await Promise.resolve();
      viewer.setPathTracingPaused(true);
      const samples = statuses.at(-1)?.samples;
      const pipelines = device.createRenderPipeline.mock.calls.length;
      let refresh = 2;
      for (const op of ['none', 'acesFilmic', 'reinhard'] as const) {
        device.queue.writeBuffer.mockClear();
        device.queue.submit.mockClear();
        pass.dispatchWorkgroups.mockClear();
        await viewer.setTonemap(op);
        tick(refresh++);
        await Promise.resolve();
        const writes = device.queue.writeBuffer.mock.calls.map(call => call[2]);
        if (backend === 'raster') {
          const uniform = writes.find((data): data is Float32Array => data instanceof Float32Array && data.length === 2);
          expect(uniform?.[1]).toBe(tonemapIndex(op));
        } else {
          const size = backend === 'pathtracing' ? PT_DISPLAY_INFO_BYTES : 16;
          const data = writes.find((value): value is ArrayBuffer => value instanceof ArrayBuffer && value.byteLength === size);
          expect(data).toBeDefined();
          expect(new Float32Array(data!)[backend === 'pathtracing' ? 35 : 3]).toBe(tonemapIndex(op));
        }
        expect(device.queue.submit).toHaveBeenCalled();
        expect(pass.dispatchWorkgroups).not.toHaveBeenCalled();
        expect(device.createRenderPipeline).toHaveBeenCalledTimes(pipelines);
        expect(statuses.at(-1)?.samples).toBe(samples);
      }
      for (const exposure of [2, -2, 0]) {
        device.queue.writeBuffer.mockClear();
        device.queue.submit.mockClear();
        pass.dispatchWorkgroups.mockClear();
        viewer.setExposure(exposure);
        tick(refresh++);
        await Promise.resolve();
        const writes = device.queue.writeBuffer.mock.calls.map(call => call[2]);
        if (backend === 'raster') {
          const uniform = writes.find((data): data is Float32Array => data instanceof Float32Array && data.length === 2);
          expect(uniform?.[0]).toBe(exposure);
          expect(uniform?.[1]).toBe(tonemapIndex('reinhard'));
        } else {
          const size = backend === 'pathtracing' ? PT_DISPLAY_INFO_BYTES : 16;
          const data = writes.find((value): value is ArrayBuffer => value instanceof ArrayBuffer && value.byteLength === size);
          expect(data).toBeDefined();
          expect(new Float32Array(data!)[2]).toBe(exposure);
        }
        expect(device.queue.submit).toHaveBeenCalled();
        expect(pass.dispatchWorkgroups).not.toHaveBeenCalled();
        expect(device.createRenderPipeline).toHaveBeenCalledTimes(pipelines);
        expect(statuses.at(-1)?.samples).toBe(samples);
      }
    },
  );
});


