// T058b: structural checks for the scene-forward shader assembled from a compiled
// layered surface module (src/render/raster/ir-forward.ts). The builder is
// additive -- no backend consumes it yet -- so these tests assert the emitted WGSL
// embeds the shared closure library, reconstructs the surface LayeredClosure and
// evaluates the same direct term as the path tracer megakernel. Numeric raster <->
// path tracer parity and device validation are deferred (T058f/T059).

import { describe, it, expect } from 'vitest';
import type {
  ResolvedGraph,
  ResolvedInput,
  ResolvedNode,
  ResolvedValueSource,
} from '../../../src/materialx/graph.ts';
import { resolveSurface } from '../../../src/materialx/surface-graph.ts';
import { emitLayeredSurface } from '../../../src/compiler/surface-wgsl.ts';
import type { LayeredSurfaceModule } from '../../../src/compiler/surface-wgsl.ts';
import { FLOAT } from '../../../src/compiler/ir.ts';
import {
  assembleIrForwardShader,
  IR_FORWARD_FRAME_GROUP,
} from '../../../src/render/raster/ir-forward.ts';

function value(name: string, type: string, raw: string): ResolvedInput {
  const source: ResolvedValueSource = { kind: 'value', value: raw, type };
  return { name, type, source, provenance: { namePath: `/mat/${name}` } };
}

function surfaceGraph(category: string, surfaceInputs: ResolvedInput[]): ResolvedGraph {
  const surface: ResolvedNode = {
    id: 'SR',
    category,
    type: 'surfaceshader',
    inputs: surfaceInputs,
    provenance: { namePath: '/mat/SR' },
  };
  return {
    terminals: [{ name: 'surfaceshader', type: 'surfaceshader', nodeId: 'SR', provenance: { namePath: '/mat/SR' } }],
    nodes: new Map<string, ResolvedNode>([['SR', surface]]),
  };
}

function forward(category: string, inputs: ResolvedInput[]) {
  const resolved = resolveSurface(surfaceGraph(category, inputs), {});
  expect(resolved).not.toBeNull();
  const surface = emitLayeredSurface(surfaceGraph(category, inputs), resolved!);
  return { surface, shader: assembleIrForwardShader(surface) };
}

describe('assembleIrForwardShader (T058b)', () => {
  it('keeps the material module source: shared closure library and surface entry', () => {
    const { surface, shader } = forward('standard_surface', [value('base_color', 'color3', '0.8, 0.1, 0.1')]);
    // The shared library (LayeredClosure struct + mx_closure_eval) rides along.
    expect(shader.code).toContain('struct LayeredClosure {');
    expect(shader.code).toContain('fn mx_closure_eval(c: LayeredClosure, wo: vec3f, wi: vec3f) -> MxBsdfEval');
    // The surface fill function is preserved and called by the fragment.
    expect(shader.code).toContain('fn mx_surface_layered(vary: MxVaryings) -> LayeredClosure {');
    expect(shader.code).toContain(`let c = ${surface.entryPoint}(vary);`);
  });

  it('declares a dedicated frame uniform on a distinct bind group', () => {
    const { shader } = forward('open_pbr_surface', [value('base_color', 'color3', '0.2, 0.5, 0.9')]);
    expect(shader.code).toContain('struct MxFrame {');
    expect(shader.code).toContain(`@group(${IR_FORWARD_FRAME_GROUP}) @binding(0) var<uniform> fu: MxFrame;`);
    expect(shader.frameGroup).toBe(IR_FORWARD_FRAME_GROUP);
    // Distinct from the material binds: group 0 (MxUniforms), 1 (textures), 2 (samplers).
    expect(IR_FORWARD_FRAME_GROUP).toBeGreaterThan(2);
  });

  it('emits vertex and fragment stages that fill MxVaryings and project the vertex', () => {
    const { shader } = forward('standard_surface', [value('base_color', 'color3', '0.5, 0.5, 0.5')]);
    expect(shader.code).toContain('@vertex');
    expect(shader.code).toContain(`fn ${shader.vertexEntry}(vin: MxVertexIn) -> MxVertexOut`);
    expect(shader.code).toContain('out.clip = fu.viewProj * world;');
    expect(shader.code).toContain('out.viewDir = normalize(fu.eye.xyz - worldPos);');
    expect(shader.code).toContain('@fragment');
    expect(shader.code).toContain(`fn ${shader.fragmentEntry}(fin: MxVertexOut) -> @location(0) vec4f`);
    expect(shader.code).toContain('var vary: MxVaryings;');
    expect(shader.code).toContain('vary.viewDir = normalize(fin.viewDir);');
  });

  it('shades the closure with the same direct term as the path tracer (delta light, no shadow)', () => {
    const { shader } = forward('standard_surface', [value('base_color', 'color3', '0.5, 0.5, 0.5')]);
    // Orthonormal frame + local wo, mirroring compute.ts.
    expect(shader.code).toContain('fn basis(n: vec3f) -> mat3x3f {');
    expect(shader.code).toContain('let wo = transpose(sframe) * vary.viewDir;');
    // Delta-light next-event term evaluated through the shared closure.
    expect(shader.code).toContain('let toLight = normalize(-fu.lightDir.xyz);');
    expect(shader.code).toContain('let ev = mx_closure_eval(c, wo, wiLight);');
    expect(shader.code).toContain('var radiance = ev.value * (fu.lightColor.xyz * fu.lightColor.w) * cosL;');
    // No shadow ray in the raster forward pass.
    expect(shader.code).not.toContain('traverse(');
  });

  it('adds a constant-environment term through the shared closure eval', () => {
    const { shader } = forward('open_pbr_surface', [value('base_color', 'color3', '0.2, 0.5, 0.9')]);
    expect(shader.code).toContain('let evEnv = mx_closure_eval(c, wo, wiEnv);');
    expect(shader.code).toContain('radiance = radiance + evEnv.value * fu.env.xyz * MX_PI;');
  });

  it('adds the closure emission when present', () => {
    const { shader } = forward('standard_surface', [
      value('base_color', 'color3', '0.5, 0.5, 0.5'),
      value('emission', 'float', '2'),
      value('emission_color', 'color3', '1, 1, 1'),
    ]);
    expect(shader.code).toContain('if (c.hasEmission != 0u) { radiance = radiance + c.emission; }');
  });
});

// Minimal surface module stub: assembleIrForwardShader only reads the primvar
// keys to decide which v_* varyings the host must feed, so the body is trivial.
function stubModule(primvars: readonly string[]): LayeredSurfaceModule {
  return {
    code: 'fn mx_surface_layered(vary: MxVaryings) -> LayeredClosure { var c: LayeredClosure; return c; }',
    entryPoint: 'mx_surface_layered',
    returnType: 'LayeredClosure',
    family: 'standard_surface',
    uniforms: [],
    textures: [],
    samplers: [],
    primvarFields: new Map(primvars.map((name) => [name, FLOAT])),
    extraInputs: new Map(),
  };
}

describe('assembleIrForwardShader primvar feed (st -> texcoord)', () => {
  it('feeds the st primvar from the interpolated texcoord like the megakernel', () => {
    const shader = assembleIrForwardShader(stubModule(['st']));
    expect(shader.code).toContain('vary.v_st = fin.texcoord;');
  });

  it('omits the primvar assignment when the surface reads no st primvar', () => {
    const shader = assembleIrForwardShader(stubModule([]));
    expect(shader.code).not.toContain('vary.v_st');
  });
});
