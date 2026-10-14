// T058f1: parity between the raster-on-IR direct term and the path tracer
// megakernel direct term. Both backends now shade the SAME LayeredClosure through
// the SAME shared stack (mx_closure_eval, closure-library.ts, T056): the raster
// forward fragment (ir-forward.ts, T058b) and the compute megakernel
// (pathtracing/compute.ts, T057) build the closure, transform into a local frame
// and evaluate the delta-light next-event term identically. This test proves it
// two ways: (1) structurally, both emitted WGSL embed the shared closure library
// and call mx_closure_eval with the same delta-light form; (2) numerically on the
// CPU, the shared oracle (layeredSurfaceBsdf.eval == the CPU mirror of
// mx_closure_eval) produces the same direct term for both backends on witness
// materials whose raster lowering and the path tracer's canonical packing coincide
// (the T055b standard_surface anchor). Raster-only approximations (constant env,
// single sample, no shadow, no MIS) are documented as the declared delta vs the
// multi-bounce path tracer; full device parity is deferred to T059.

import { describe, it, expect } from 'vitest';
import type { Vec3 } from '../../../src/scene/transforms.ts';
import {
  resolvedGraphFromParsedSurface,
  surfaceFromParsedInputs,
  parsedInputsToLayered,
  parsedSurfaceToCanonical,
  type ParsedSurfaceInputs,
} from '../../../src/materialx/surface-from-inputs.ts';
import { emitLayeredSurface } from '../../../src/compiler/surface-wgsl.ts';
import { canonicalSurfaceToLayered, type LayeredClosure } from '../../../src/compiler/ir.ts';
import { serializeLayeredClosure } from '../../../src/compiler/layered-serialize.ts';
import { assembleIrForwardShader } from '../../../src/render/raster/ir-forward.ts';
import { pathTraceComputeWgsl } from '../../../src/render/pathtracing/compute.ts';
import { layeredSurfaceBsdf, evalWorld } from '../../../src/render/pathtracing/bsdf.ts';
import { nodeTolerance } from '../../fixtures/tolerances.ts';

const CLOSURE_TOL = nodeTolerance('closure');

function rasterShaderCode(spec: ParsedSurfaceInputs): string {
  const surface = surfaceFromParsedInputs(spec);
  expect(surface).not.toBeNull();
  const module = emitLayeredSurface(resolvedGraphFromParsedSurface(spec), surface!);
  return assembleIrForwardShader(module).code;
}

// --- shared CPU direct-term mirrors (same math as the two WGSL shaders) -------

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const mulv = (a: Vec3, b: Vec3): Vec3 => [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
function normalize(a: Vec3): Vec3 {
  const len = Math.hypot(a[0], a[1], a[2]);
  return len === 0 ? [0, 0, 1] : [a[0] / len, a[1] / len, a[2] / len];
}

/** Raster forward delta-light term (ir-forward.ts fragment): max-clamped cosine,
 *  single directional light, no shadow. */
function rasterDelta(closure: LayeredClosure, n: Vec3, wo: Vec3, toLight: Vec3, radiance: Vec3): Vec3 {
  const ev = evalWorld(layeredSurfaceBsdf(closure), n, wo, toLight);
  const cosL = Math.max(dot(n, toLight), 0);
  return mulv(ev.value, scale(radiance, cosL));
}

/** Path tracer megakernel delta-light term (compute.ts, single bounce, beta=1):
 *  abs cosine, distant delta light, MIS weight 1. */
function ptDelta(closure: LayeredClosure, n: Vec3, wo: Vec3, toLight: Vec3, radiance: Vec3): Vec3 {
  const ev = evalWorld(layeredSurfaceBsdf(closure), n, wo, toLight);
  const cosL = Math.abs(dot(n, toLight));
  return mulv(ev.value, scale(radiance, cosL));
}

function close(a: Vec3, b: Vec3, eps: number): boolean {
  return Math.abs(a[0] - b[0]) <= eps && Math.abs(a[1] - b[1]) <= eps && Math.abs(a[2] - b[2]) <= eps;
}

// Witness materials whose T055b raster lowering (parsedInputsToLayered) reproduces
// the canonical 7-parameter packing the path tracer still uses (scene-buffers via
// canonicalSurfaceToLayered). The anchor requires base=1, specular_color=white,
// diffuse_roughness=specular_roughness, no coat/sheen/thin-film, and transmission/
// subsurface=0 (see surface-lower.ts lowerStandardSurface).
const DIFFUSE_SPEC: ParsedSurfaceInputs = {
  category: 'standard_surface',
  inputs: {
    base: 1,
    base_color: [0.82, 0.3, 0.1],
    metalness: 0,
    specular: 0.5,
    specular_roughness: 0.35,
    diffuse_roughness: 0.35,
    specular_IOR: 1.5,
  },
};
const METAL_SPEC: ParsedSurfaceInputs = {
  category: 'standard_surface',
  inputs: {
    base: 1,
    base_color: [0.9, 0.7, 0.3],
    metalness: 1,
    specular_roughness: 0.2,
    diffuse_roughness: 0.2,
    specular_IOR: 1.5,
  },
};

const N: Vec3 = [0, 0, 1];
const WO = normalize([0.3, 0.2, 1]);
const TO_LIGHT = normalize([-0.4, 0.1, 1]); // above the surface -> dot(n, l) > 0
const RADIANCE: Vec3 = [3, 2.85, 2.7];

describe('raster-on-IR vs path tracer direct-term parity (T058f1)', () => {
  it('both backends emit the shared closure library and call mx_closure_eval', () => {
    const raster = rasterShaderCode(DIFFUSE_SPEC);
    const pt = pathTraceComputeWgsl();
    // Same shared runtime closure contract rides in both shaders.
    expect(raster).toContain('struct LayeredClosure {');
    expect(pt).toContain('struct LayeredClosure {');
    expect(raster).toContain('fn mx_closure_eval(c: LayeredClosure, wo: vec3f, wi: vec3f) -> MxBsdfEval');
    expect(pt).toContain('fn mx_closure_eval(c: LayeredClosure, wo: vec3f, wi: vec3f) -> MxBsdfEval');
  });

  it('both evaluate the delta light through mx_closure_eval in a local frame', () => {
    const raster = rasterShaderCode(DIFFUSE_SPEC);
    const pt = pathTraceComputeWgsl();
    // Same delta-light next-event call shape in both shaders.
    expect(raster).toContain('let ev = mx_closure_eval(c, wo, wiLight);');
    expect(pt).toContain('let ev = mx_closure_eval(c, wo, wiLight);');
    // Both transform into the Duff orthonormal frame to get a local wo.
    expect(raster).toContain('let wo = transpose(sframe) * vary.viewDir;');
    expect(pt).toContain('let wo = transpose(frame) * (-rd);');
    // The raster forward pass omits the shadow ray; the megakernel casts it.
    expect(raster).not.toContain('traverse(');
    expect(pt).toContain('traverse(');
  });

  it('raster lowering and the path tracer canonical packing yield the same closure on the anchor', () => {
    for (const spec of [DIFFUSE_SPEC, METAL_SPEC]) {
      const rasterClosure = parsedInputsToLayered(spec);
      expect(rasterClosure).not.toBeNull();
      const ptClosure = canonicalSurfaceToLayered(parsedSurfaceToCanonical(spec));
      // Same LayeredClosure from both source paths (T055b anchor).
      expect(serializeLayeredClosure(rasterClosure!)).toEqual(serializeLayeredClosure(ptClosure));
    }
  });

  it('produces the same direct delta-light radiance from both backends', () => {
    for (const spec of [DIFFUSE_SPEC, METAL_SPEC]) {
      const rasterClosure = parsedInputsToLayered(spec)!;
      const ptClosure = canonicalSurfaceToLayered(parsedSurfaceToCanonical(spec));
      const r = rasterDelta(rasterClosure, N, WO, TO_LIGHT, RADIANCE);
      const p = ptDelta(ptClosure, N, WO, TO_LIGHT, RADIANCE);
      expect(close(r, p, CLOSURE_TOL)).toBe(true);
      // A non-trivial, energy-bearing response (not a silently zeroed term).
      expect(r[0] + r[1] + r[2]).toBeGreaterThan(0);
    }
  });

  it('documents the raster-only constant-environment term (finite, non-negative)', () => {
    // The raster forward pass adds one deterministic env sample along the normal
    // (wi = +Z, envPdf folds to MX_PI); the path tracer instead MIS-weights a
    // cosine env sample against BSDF sampling. This asserts the raster term is a
    // well-formed addition, not a parity point (device parity is T059).
    const closure = parsedInputsToLayered(DIFFUSE_SPEC)!;
    const evEnv = evalWorld(layeredSurfaceBsdf(closure), N, WO, N);
    const env: Vec3 = [0.2, 0.22, 0.25];
    const ambient = scale(mulv(evEnv.value, env), Math.PI);
    expect(Number.isFinite(ambient[0] + ambient[1] + ambient[2])).toBe(true);
    expect(Math.min(ambient[0], ambient[1], ambient[2])).toBeGreaterThanOrEqual(0);
  });

  it('shows the raster IR path still carries layers the canonical packing drops', () => {
    // A coat material: the raster lowering keeps the coat layer (full IR), while
    // the path tracer's canonical 7-parameter packing discards it today. Closing
    // this on the GPU (path tracer consuming the same rich closure) is T059.
    const coat: ParsedSurfaceInputs = {
      category: 'standard_surface',
      inputs: { base: 1, base_color: [0.6, 0.6, 0.6], specular: 0.5, coat: 1, coat_roughness: 0.1 },
    };
    const rasterClosure = parsedInputsToLayered(coat)!;
    const ptClosure = canonicalSurfaceToLayered(parsedSurfaceToCanonical(coat));
    expect(rasterClosure.coat).toBeDefined();
    expect(ptClosure.coat).toBeUndefined();
  });
});
