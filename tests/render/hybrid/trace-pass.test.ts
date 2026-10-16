import { describe, expect, it } from 'vitest';
import {
  emitHybridShadowPass,
  emitGBufferPass,
  emitShadowCompositePass,
  packShadowUniform,
  HYBRID_SHADOW_ENTRY,
  HYBRID_SHADOW_BINDINGS,
  HYBRID_SHADOW_UNIFORM_FLOATS,
  HYBRID_WORKGROUP_SIZE,
  GBUFFER_VERTEX_ENTRY,
  GBUFFER_FRAGMENT_ENTRY,
  SHADOW_COMPOSITE_VERTEX_ENTRY,
  SHADOW_COMPOSITE_FRAGMENT_ENTRY,
} from '../../../src/render/hybrid/trace-pass.ts';
import { BVH_NODE_STRIDE, BVH_TRI_STRIDE } from '../../../src/render/pathtracing/bvh-wgsl.ts';
import { PT_NODE_FLOATS, PT_TRIANGLE_FLOATS } from '../../../src/render/pathtracing/scene-buffers.ts';

describe('emitHybridShadowPass', () => {
  const pass = emitHybridShadowPass();

  it('exposes the entry point and workgroup size', () => {
    expect(pass.entryPoint).toBe(HYBRID_SHADOW_ENTRY);
    expect(pass.workgroupSize).toBe(HYBRID_WORKGROUP_SIZE);
    expect(pass.code).toContain(`@workgroup_size(${HYBRID_WORKGROUP_SIZE}, ${HYBRID_WORKGROUP_SIZE})`);
    expect(pass.code).toContain(`fn ${HYBRID_SHADOW_ENTRY}(`);
  });

  it('reuses the shared BVH traversal (traverse + intersect_tri)', () => {
    expect(pass.code).toContain('fn traverse(');
    expect(pass.code).toContain('fn intersect_tri(');
    // anyHit traversal is used for occlusion rays.
    expect(pass.code).toContain('traverse(ro + toLight * RAY_EPS, toLight, tMax, true)');
  });

  it('binds the packed BVH buffers at the declared slots', () => {
    expect(pass.code).toContain(`@group(0) @binding(${HYBRID_SHADOW_BINDINGS.nodes}) var<storage, read> nodes`);
    expect(pass.code).toContain(`@group(0) @binding(${HYBRID_SHADOW_BINDINGS.triangles}) var<storage, read> tris`);
    expect(pass.code).toContain(`@group(0) @binding(${HYBRID_SHADOW_BINDINGS.triangleOrder}) var<storage, read> triOrder`);
    expect(pass.code).toContain(`@group(0) @binding(${HYBRID_SHADOW_BINDINGS.visibility}) var visibility : texture_storage_2d<r32float, write>`);
  });

  it('declares strides matching the scene-buffers packing', () => {
    expect(BVH_NODE_STRIDE).toBe(PT_NODE_FLOATS);
    expect(BVH_TRI_STRIDE).toBe(PT_TRIANGLE_FLOATS);
    expect(pass.code).toContain(`const NODE_STRIDE : u32 = ${PT_NODE_FLOATS}u;`);
    expect(pass.code).toContain(`const TRI_STRIDE : u32 = ${PT_TRIANGLE_FLOATS}u;`);
  });

  it('leaves background pixels fully lit and back-facing points unlit', () => {
    expect(pass.code).toContain('if (posTexel.w <= 0.0)');
    expect(pass.code).toContain('if (nDotL <= 0.0)');
  });
});

describe('packShadowUniform', () => {
  it('packs lightDir and params with defaults', () => {
    const u = packShadowUniform({ lightDir: [0, -1, 0], width: 256, height: 128 });
    expect(u.length).toBe(HYBRID_SHADOW_UNIFORM_FLOATS);
    expect([u[0], u[1], u[2]]).toEqual([0, -1, 0]);
    expect(u[4]).toBe(256);
    expect(u[5]).toBe(128);
    expect(u[6]).toBeCloseTo(1.0e-3);
    expect(u[7]).toBe(0);
  });

  it('honours an explicit normal bias and max distance', () => {
    const u = packShadowUniform({ lightDir: [1, 0, 0], width: 64, height: 64, normalBias: 0.05, maxDistance: 10 });
    expect(u[6]).toBeCloseTo(0.05);
    expect(u[7]).toBe(10);
  });
});

describe('emitGBufferPass', () => {
  const pass = emitGBufferPass();

  it('exposes the vertex/fragment entry points', () => {
    expect(pass.vertexEntry).toBe(GBUFFER_VERTEX_ENTRY);
    expect(pass.fragmentEntry).toBe(GBUFFER_FRAGMENT_ENTRY);
    expect(pass.code).toContain(`fn ${GBUFFER_VERTEX_ENTRY}(`);
    expect(pass.code).toContain(`fn ${GBUFFER_FRAGMENT_ENTRY}(`);
  });

  it('writes world position with a surface mask and world normal', () => {
    expect(pass.code).toContain('@location(0) position : vec4<f32>');
    expect(pass.code).toContain('@location(1) normal : vec4<f32>');
    expect(pass.code).toContain('t.position = vec4<f32>(in.worldPos, 1.0);');
  });

  it('transforms by the frame uniform model + viewProj prefix', () => {
    expect(pass.code).toContain('struct GBufUniforms { model : mat4x4<f32>, viewProj : mat4x4<f32> };');
    expect(pass.code).toContain('let world = GU.model * vec4<f32>(position, 1.0);');
  });
});

describe('emitShadowCompositePass', () => {
  const pass = emitShadowCompositePass();

  it('exposes the fullscreen entry points', () => {
    expect(pass.vertexEntry).toBe(SHADOW_COMPOSITE_VERTEX_ENTRY);
    expect(pass.fragmentEntry).toBe(SHADOW_COMPOSITE_FRAGMENT_ENTRY);
  });

  it('shadows only the direct term (full - ibl) by the traced visibility', () => {
    expect(pass.code).toContain('let direct = hdr.rgb - ibl.rgb;');
    expect(pass.code).toContain('let atten = 1.0 - CU.x * (1.0 - vis);');
    expect(pass.code).toContain('return vec4<f32>(ibl.rgb + direct * atten, hdr.a);');
  });

  it('binds the full HDR, IBL-only HDR, visibility and strength uniform', () => {
    expect(pass.code).toContain('@binding(0) var hdrTex : texture_2d<f32>;');
    expect(pass.code).toContain('@binding(1) var iblTex : texture_2d<f32>;');
    expect(pass.code).toContain('@binding(2) var visTex : texture_2d<f32>;');
    expect(pass.code).toContain('@binding(3) var<uniform> CU : vec4<f32>;');
  });
});
