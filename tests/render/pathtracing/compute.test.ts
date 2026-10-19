import { describe, expect, it, vi } from 'vitest';
import {
  buildPathTraceUniform,
  pathTraceComputeWgsl,
  pathTraceTile,
  PathTraceBackend,
  PT_COMPUTE_ENTRY,
  PT_UNIFORM_FLOATS,
  PT_WORKGROUP_SIZE,
} from '../../../src/render/pathtracing/compute.ts';
import type { PathTraceScene } from '../../../src/render/pathtracing/scene-buffers.ts';
import { IDENTITY4 } from '../../../src/scene/transforms.ts';
import { vector, type IrType } from '../../../src/compiler/ir.ts';
import { buildMaterialDispatch } from '../../../src/render/pathtracing/material-variant.ts';
import { evaluateSurfaceToLayered } from '../../../src/compiler/surface-eval.ts';
import { resolveSurface } from '../../../src/materialx/surface-graph.ts';
import type { ResolvedGraph, ResolvedNode } from '../../../src/materialx/graph.ts';

/** standard_surface whose base_color is driven by a connected constant node. */
function brickGraph(): ResolvedGraph {
  const surfaceNode: ResolvedNode = {
    id: 'SR',
    category: 'standard_surface',
    type: 'surfaceshader',
    inputs: [
      { name: 'base_color', type: 'color3', source: { kind: 'connection', nodeId: 'brick' }, provenance: { namePath: '/mat/base_color' } },
    ],
    provenance: { namePath: '/mat/SR' },
  };
  const brick: ResolvedNode = {
    id: 'brick',
    category: 'constant',
    type: 'color3',
    inputs: [
      { name: 'value', type: 'color3', source: { kind: 'value', value: '0.661876, 0.19088, 0', type: 'color3' }, provenance: { namePath: '/mat/brick/value' } },
    ],
    provenance: { namePath: '/mat/brick' },
  };
  return {
    terminals: [{ name: 'surfaceshader', type: 'surfaceshader', nodeId: 'SR', provenance: { namePath: '/mat/SR' } }],
    nodes: new Map<string, ResolvedNode>([['SR', surfaceNode], ['brick', brick]]),
  };
}


function fakeScene(): PathTraceScene {
  return {
    nodes: new Float32Array(),
    nodeCount: 0,
    triangles: new Float32Array(),
    triangleOrder: new Uint32Array(),
    triangleCount: 0,
    materials: new Float32Array(),
    materialCount: 0,
    triangleUv: new Float32Array(),
    triangleTangent: new Float32Array(),
    materialKeys: [],
    variantSources: [],
    camera: { viewProj: IDENTITY4, invViewProj: IDENTITY4, eye: [1, 2, 3], exposure: 0 },
    light: { direction: [0, 0, -1], color: [1, 0.5, 0.25], intensity: 4 },
    environment: { radiance: [0.1, 0.2, 0.3] },
    bounds: { min: [0, 0, 0], max: [0, 0, 0] },
  };
}

describe('pathTraceComputeWgsl', () => {
  const src = pathTraceComputeWgsl();

  it('declares the compute entry point and workgroup tile', () => {
    expect(src).toContain(`fn ${PT_COMPUTE_ENTRY}`);
    expect(src).toContain(`@workgroup_size(${PT_WORKGROUP_SIZE}, ${PT_WORKGROUP_SIZE}, 1)`);
    expect(src).toContain('@compute');
  });

  it('includes BVH traversal, the shared closure library and the integrator', () => {
    expect(src).toContain('fn traverse(');
    expect(src).toContain('fn intersect_tri(');
    // T057d: the inline seven-parameter surface block is gone; the megakernel
    // rebuilds the LayeredClosure and calls the shared closure library.
    expect(src).not.toContain('fn surface_eval(');
    expect(src).not.toContain('fn surface_sample(');
    expect(src).not.toContain('fn load_surface(');
    expect(src).not.toContain('struct Surface {');
    expect(src).toContain('struct LayeredClosure {');
    expect(src).toContain('fn mx_material_closure(');
    expect(src).toContain('fn mx_closure_eval(');
    expect(src).toContain('fn mx_closure_pdf(');
    expect(src).toContain('fn mx_closure_sample(');
    expect(src).toContain('fn integrate(');
    expect(src).toContain('fn power_heuristic(');
    expect(src).toContain('fn pcg_hash(');
  });

  it('uses orthographic per-pixel camera rays matching the raster projection', () => {
    expect(src).toContain('struct MxCameraRay {');
    expect(src).toContain('let near = U.invViewProj * vec4<f32>(ndc, 0.0, 1.0);');
    expect(src).toContain('ray.direction = normalize(far.xyz / far.w - ray.origin);');
    expect(src).toContain('integrate(ray.origin, ray.direction, &state)');
    expect(src).not.toContain('normalize(world - U.eye.xyz)');
  });

  it('wires NEE + MIS on the generated stack (environment next-event estimation)', () => {
    // T057e: the integrator mirrors integratePath -- it carries the MIS state and
    // weights the environment via the power heuristic instead of "no MIS".
    expect(src).not.toContain('unit pdf, no MIS');
    expect(src).toContain('var specularBounce');
    expect(src).toContain('var bsdfPdf');
    expect(src).toContain('mx_cosine_hemisphere(');
    // Both strategies feed the power heuristic (NEE direction and BSDF continuation).
    expect(src).toContain('power_heuristic(1.0, envPdf, 1.0, ev.pdf)');
    expect(src).toContain('power_heuristic(1.0, bsdfPdf, 1.0, envPdf)');
  });

  it('binds the scene storage buffers and the accumulation buffer', () => {
    expect(src).toContain('var<storage, read> nodes');
    expect(src).toContain('var<storage, read> tris');
    expect(src).toContain('var<storage, read> triOrder');
    expect(src).toContain('var<storage, read> materials');
    expect(src).toContain('var<storage, read_write> accum');
  });

  it('accumulates progressively with a running mean keyed by frame', () => {
    expect(src).toContain('accum[pixel]');
    expect(src).toContain('prev.w');
  });
});

describe('pathTraceComputeWgsl participating media (increment 4)', () => {
  const src = pathTraceComputeWgsl();

  it('emits the homogeneous-medium helpers and the HG phase sampler', () => {
    expect(src).toContain('struct MxMedium {');
    expect(src).toContain('fn mx_absorbing_medium(');
    expect(src).toContain('fn mx_subsurface_medium(');
    expect(src).toContain('fn mx_single_scatter_albedo(');
    expect(src).toContain('fn mx_extinction_from_mfp(');
    expect(src).toContain('fn mx_sample_homogeneous(');
    expect(src).toContain('fn mx_sample_hg(');
  });

  it('derives the interior medium from the packed closure flags', () => {
    expect(src).toContain('const MX_LOBE_HAS_ATTENUATION');
    expect(src).toContain('const MX_LOBE_HAS_SUBSURFACE_RADIUS');
    expect(src).toContain('c.hasInterior = 1u;');
    expect(src).toContain('interiorSigmaA: vec3f,');
  });

  it('runs free-flight sampling and toggles the medium on transmission', () => {
    expect(src).toContain('var inMedium = false;');
    expect(src).toContain('mx_sample_homogeneous(medium, tMax, state)');
    expect(src).toContain('mx_sample_hg(-rd, medium.g');
    expect(src).toContain('(wo.z > 0.0) != (bs.wi.z > 0.0)');
    expect(src).toContain('medium = MxMedium(c.interiorSigmaA, c.interiorSigmaS, c.interiorG);');
  });
});

describe('pathTraceComputeWgsl varyings (T057h)', () => {
  it('omits the varyings machinery by default', () => {
    const src = pathTraceComputeWgsl();
    expect(src).not.toContain('struct MxVaryings');
    expect(src).not.toContain('fn mx_hit_varyings(');
    expect(src).not.toContain('var<storage, read> triUv');
  });

  it('emits the MxVaryings struct, UV binding and the barycentric hit builder', () => {
    const primvarFields = new Map<string, IrType>([['st', vector(2)]]);
    const src = pathTraceComputeWgsl({ varyings: { primvarFields, extraInputs: new Map() } });
    // Struct and the UV source it interpolates from.
    expect(src).toContain('struct MxVaryings');
    expect(src).toContain('v_st: vec2f,');
    expect(src).toContain('@group(0) @binding(6) var<storage, read> triUv : array<f32>;');
    expect(src).toContain('const UV_STRIDE : u32 = 6u;');
    // Barycentric interpolation of the per-triangle UVs.
    expect(src).toContain('fn mx_hit_uv(');
    expect(src).toContain('let w = 1.0 - h.u - h.v;');
    // Builder fills the standard fields and mirrors st onto the interpolated UV.
    expect(src).toContain('fn mx_hit_varyings(h : Hit, pos : vec3<f32>, n : vec3<f32>, viewDir : vec3<f32>) -> MxVaryings');
    expect(src).toContain('vary.texcoord = uv;');
    expect(src).toContain('vary.v_st = uv;');
    expect(src).toContain('vary.tangent = tang;');
  });

  it('keeps constant shading until T057i wires the dispatcher', () => {
    const primvarFields = new Map<string, IrType>([['st', vector(2)]]);
    const src = pathTraceComputeWgsl({ varyings: { primvarFields, extraInputs: new Map() } });
    expect(src).toContain('fn mx_material_closure(');
    expect(src).not.toContain('mx_eval_material');
  });
});

describe('pathTraceComputeWgsl tangent frame (T057l)', () => {
  it('binds the per-triangle tangent buffer and interpolates the hit tangent', () => {
    const primvarFields = new Map<string, IrType>([['st', vector(2)]]);
    const src = pathTraceComputeWgsl({ varyings: { primvarFields, extraInputs: new Map() } });
    expect(src).toContain('@group(0) @binding(7) var<storage, read> triTangent : array<f32>;');
    expect(src).toContain('const TAN_STRIDE : u32 = 9u;');
    expect(src).toContain('fn mx_tri_tangent(tri : u32, slot : u32) -> vec3<f32>');
    expect(src).toContain('fn mx_hit_tangent(h : Hit) -> vec3<f32>');
    // Empty buffer -> keep the branchless basis tangent (graceful fallback).
    expect(src).toContain('if (arrayLength(&triTangent) < TAN_STRIDE)');
    expect(src).toContain('let tang = select(f[0], normalize(tRaw - n * dot(n, tRaw)), hasT);');
    expect(src).toContain('vary.bitangent = select(f[1], normalize(cross(n, tang)), hasT);');
  });
});

describe('pathTraceComputeWgsl material dispatcher (T057i4)', () => {
  function brickDispatch() {
    const graph = brickGraph();
    const surface = resolveSurface(graph, {})!;
    expect(surface).not.toBeNull();
    return { graph, surface, dispatch: buildMaterialDispatch([{ materialIndex: 0, graph, surface }]) };
  }

  it('emits the variant fill function and the mx_eval_material switch', () => {
    const { dispatch } = brickDispatch();
    const src = pathTraceComputeWgsl({ dispatch });
    expect(src).toContain('fn mx_surface_layered_0(vary: MxVaryings)');
    expect(src).toContain('fn mx_eval_material(matId: u32, vary: MxVaryings) -> LayeredClosure');
    expect(src).toContain('case 0u: { return mx_surface_layered_0(vary); }');
    // Non-graph materials fall back to the packed constant record.
    expect(src).toContain('default: { return mx_material_closure(matId); }');
  });

  it('switches the integrator onto mx_eval_material at the interpolated varyings', () => {
    const { dispatch } = brickDispatch();
    const src = pathTraceComputeWgsl({ dispatch });
    expect(src).toContain('let vary = mx_hit_varyings(hit, pos, n, normalize(-rd));');
    expect(src).toContain('var c = mx_eval_material(tri_material(hit.tri), vary);');
    // The dispatch path always emits the varyings machinery it consumes.
    expect(src).toContain('struct MxVaryings');
    expect(src).toContain('@group(0) @binding(6) var<storage, read> triUv : array<f32>;');
  });

  it('bakes the evaluated brick base_color so device matches the CPU oracle', () => {
    const { graph, surface, dispatch } = brickDispatch();
    const src = pathTraceComputeWgsl({ dispatch });
    // The procedural brick_color folds to a constant in the variant WGSL...
    expect(src).toContain('0.661876');
    expect(src).toContain('0.19088');
    // ...matching the CPU oracle's evaluated diffuse base_color.
    const closure = evaluateSurfaceToLayered(graph, surface);
    const diffuse = closure.lobes.find((l) => l.kind === 'burley_diffuse')!;
    expect(diffuse.color[0]).toBeCloseTo(0.661876, 5);
    expect(diffuse.color[1]).toBeCloseTo(0.19088, 5);
  });

  it('declares no MxUniforms block while surface lowering bakes constants (T057i3 note)', () => {
    const { dispatch } = brickDispatch();
    expect(dispatch.uniforms).toEqual([]);
    const src = pathTraceComputeWgsl({ dispatch });
    expect(src).not.toContain('struct MxUniforms');
  });
});


describe('pathTraceComputeWgsl texture registry (T057j)', () => {
  /** standard_surface whose base_color samples an image node reading `file`. */
  function imageGraph(file: string): ResolvedGraph {
    const tex: ResolvedNode = {
      id: 'tex',
      category: 'image',
      type: 'color3',
      inputs: [
        { name: 'file', type: 'filename', source: { kind: 'value', value: file, type: 'filename' }, provenance: { namePath: '/mat/tex/file' } },
      ],
      provenance: { namePath: '/mat/tex' },
    };
    const surfaceNode: ResolvedNode = {
      id: 'SR',
      category: 'standard_surface',
      type: 'surfaceshader',
      inputs: [
        { name: 'base_color', type: 'color3', source: { kind: 'connection', nodeId: 'tex' }, provenance: { namePath: '/mat/base_color' } },
      ],
      provenance: { namePath: '/mat/SR' },
    };
    return {
      terminals: [{ name: 'surfaceshader', type: 'surfaceshader', nodeId: 'SR', provenance: { namePath: '/mat/SR' } }],
      nodes: new Map<string, ResolvedNode>([['SR', surfaceNode], ['tex', tex]]),
    };
  }

  function imageDispatch(files: readonly string[]) {
    const sources = files.map((file, i) => {
      const graph = imageGraph(file);
      const surface = resolveSurface(graph, {})!;
      expect(surface).not.toBeNull();
      return { materialIndex: i, graph, surface };
    });
    return buildMaterialDispatch(sources);
  }

  it('emits the registry texture and sampler binding declarations', () => {
    const dispatch = imageDispatch(['brick.png']);
    const src = pathTraceComputeWgsl({ dispatch });
    expect(src).toContain('@group(1) @binding(0) var m0_tex_tex: texture_2d<f32>;');
    expect(src).toContain('@group(2) @binding(0) var m0_samp_tex: sampler;');
  });

  it('dimensions the bindings to every material at once', () => {
    const dispatch = imageDispatch(['brick.png', 'wood.png']);
    const src = pathTraceComputeWgsl({ dispatch });
    expect(src).toContain('@group(1) @binding(0) var m0_tex_tex: texture_2d<f32>;');
    expect(src).toContain('@group(1) @binding(1) var m1_tex_tex: texture_2d<f32>;');
    expect(src).toContain('@group(2) @binding(1) var m1_samp_tex: sampler;');
  });

  it('deduplicates shared images in the registry while keeping both bindings', () => {
    const dispatch = imageDispatch(['brick.png', 'brick.png']);
    expect(dispatch.textureRegistry.images).toEqual(['brick.png']);
    expect(dispatch.textureRegistry.textureImage).toEqual([0, 0]);
    expect(dispatch.textures).toHaveLength(2);
  });

  it('emits no texture bindings when no material samples an image', () => {
    const graph = brickGraph();
    const surface = resolveSurface(graph, {})!;
    const dispatch = buildMaterialDispatch([{ materialIndex: 0, graph, surface }]);
    const src = pathTraceComputeWgsl({ dispatch });
    expect(dispatch.textures).toEqual([]);
    expect(src).not.toContain('texture_2d<f32>');
  });

  it('wires the variant texture sampling to the registry texture/sampler slots (T057k)', () => {
    const dispatch = imageDispatch(['brick.png']);
    const src = pathTraceComputeWgsl({ dispatch });
    // The lowered image node samples its own slot at the interpolated st primvar.
    // The megakernel is a compute pipeline, so it must sample an explicit LOD
    // (textureSample is fragment-only).
    expect(src).toContain('textureSampleLevel(m0_tex_tex, m0_samp_tex');
    expect(src).toContain('vary.v_st');
  });
});


describe('buildPathTraceUniform layout', () => {
  it('defaults to a full image and packs an explicit tile after the SH coefficients', () => {
    const full = buildPathTraceUniform(fakeScene(), 0, 1, 512, 512);
    expect(Array.from(full.slice(76))).toEqual([0, 0, 512, 512]);
    const tile = pathTraceTile(512, 512, 6);
    const tiled = buildPathTraceUniform(fakeScene(), 0, 1, 512, 512, 10, tile);
    expect(Array.from(tiled.slice(76))).toEqual([256, 128, 128, 128]);
    expect(tiled[19]).toBe(10);
  });

  it('packs invViewProj, eye, light, environment and frame counters', () => {
    const u = buildPathTraceUniform(fakeScene(), 7, 2, 320, 180);
    expect(u.length).toBe(PT_UNIFORM_FLOATS);
    // invViewProj occupies floats 0..15 (identity).
    expect(u[0]).toBeCloseTo(1);
    expect(u[5]).toBeCloseTo(1);
    // eye at 16..18.
    expect(u[16]).toBeCloseTo(1);
    expect(u[17]).toBeCloseTo(2);
    expect(u[18]).toBeCloseTo(3);
    // light direction 20..22, color 24..26, intensity 27.
    expect(u[22]).toBeCloseTo(-1);
    expect(u[24]).toBeCloseTo(1);
    expect(u[25]).toBeCloseTo(0.5);
    expect(u[26]).toBeCloseTo(0.25);
    expect(u[27]).toBeCloseTo(4);
    // environment 28..30.
    expect(u[28]).toBeCloseTo(0.1);
    expect(u[30]).toBeCloseTo(0.3);
    // frame counters 32..35.
    expect(u[32]).toBeCloseTo(7);
    expect(u[33]).toBeCloseTo(2);
    expect(u[34]).toBeCloseTo(320);
    expect(u[35]).toBeCloseTo(180);
  });
});

describe('PathTraceBackend', () => {
  function mockDevice() {
    const createComputePipeline = vi.fn((_desc: any) => ({ id: 'pipeline' }));
    const createShaderModule = vi.fn((_desc: any) => ({ id: 'module' }));
    return {
      device: { createComputePipeline, createShaderModule } as unknown as GPUDevice,
      createComputePipeline,
      createShaderModule,
    };
  }

  it('creates a compute pipeline from the generated WGSL with an auto layout', () => {
    const { device, createComputePipeline, createShaderModule } = mockDevice();
    const backend = new PathTraceBackend(device);
    backend.createPipeline();
    expect(createShaderModule).toHaveBeenCalledOnce();
    const shaderArg = createShaderModule.mock.calls[0]![0];
    expect(shaderArg.code).toContain(`fn ${PT_COMPUTE_ENTRY}`);
    const pipelineArg = createComputePipeline.mock.calls[0]![0];
    expect(pipelineArg.layout).toBe('auto');
    expect(pipelineArg.compute.entryPoint).toBe(PT_COMPUTE_ENTRY);
  });

  it('caches the pipeline across calls', () => {
    const { device, createComputePipeline } = mockDevice();
    const backend = new PathTraceBackend(device);
    backend.createPipeline();
    backend.createPipeline();
    expect(createComputePipeline).toHaveBeenCalledOnce();
  });

  it('tracks and resets the progressive frame counter', () => {
    const { device } = mockDevice();
    const backend = new PathTraceBackend(device);
    expect(backend.advanceFrame()).toBe(0);
    expect(backend.advanceFrame()).toBe(1);
    expect(backend.frameIndex).toBe(2);
    backend.resetAccumulation();
    expect(backend.frameIndex).toBe(0);
  });

  it('computes the workgroup count to cover an image', () => {
    expect(PathTraceBackend.workgroupCount(320, 180)).toEqual([40, 23]);
  });

  it('counts a sample only after sixteen tiles and resets to the first tile', () => {
    const { device } = mockDevice();
    const backend = new PathTraceBackend(device);
    for (let index = 0; index < 16; index++) {
      expect(backend.frameIndex).toBe(0);
      const step = backend.advanceTile(512, 512);
      expect(step.frameIndex).toBe(0);
      expect(step.tile).toEqual(pathTraceTile(512, 512, index));
    }
    expect(backend.frameIndex).toBe(1);
    expect(backend.advanceTile(512, 512)).toEqual({ tile: pathTraceTile(512, 512, 0), frameIndex: 1 });
    backend.resetAccumulation();
    expect(backend.frameIndex).toBe(0);
    expect(backend.advanceTile(512, 512)).toEqual({ tile: pathTraceTile(512, 512, 0), frameIndex: 0 });
  });
});

describe('path-tracing tiles', () => {
  it.each([256, 512, 1024])('uses quarter-sized tiles at resolution %i', (size) => {
    expect(pathTraceTile(size, size, 0)).toEqual({ x: 0, y: 0, width: size / 4, height: size / 4 });
    expect(pathTraceTile(size, size, 15)).toEqual({ x: size * 3 / 4, y: size * 3 / 4, width: size / 4, height: size / 4 });
  });

  it.each([[17, 13], [3, 2]])('covers every pixel exactly once for %ix%i', (width, height) => {
    const visits = new Uint8Array(width * height);
    for (let index = 0; index < 16; index++) {
      const tile = pathTraceTile(width, height, index);
      for (let y = tile.y; y < tile.y + tile.height; y++) {
        for (let x = tile.x; x < tile.x + tile.width; x++) {
          visits[y * width + x]! += 1;
        }
      }
    }
    expect(Array.from(visits)).toEqual(Array(width * height).fill(1));
  });

  it('uses global pixels and rejects workgroup padding outside the tile', () => {
    const src = pathTraceComputeWgsl();
    expect(src).toContain('if (gid.x >= u32(U.tile.z) || gid.y >= u32(U.tile.w)) { return; }');
    expect(src).toContain('let pixelCoord = gid.xy + vec2<u32>(U.tile.xy);');
    expect(src).toContain('let pixel = pixelCoord.y * width + pixelCoord.x;');
    expect(src).toContain('camera_ray(vec2<f32>(pixelCoord), dims, jitter)');
  });
});
