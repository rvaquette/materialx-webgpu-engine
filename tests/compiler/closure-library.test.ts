// T056a: the shared closure library prelude is a WGSL string, so it cannot run
// under Node (no WebGPU). These tests therefore check two things: (1) the prelude
// structurally exposes every isotropic lobe triplet, shared type and helper, and
// carries the exact distinctive formula fragments it shares with the CPU oracle;
// (2) the CPU oracle src/render/pathtracing/bsdf.ts -- which the WGSL transcribes
// verbatim -- holds the numeric reference the device parity run (T059) reproduces.
import { describe, expect, it } from 'vitest';
import {
  CLOSURE_LIBRARY_PRELUDE,
  CLOSURE_LIBRARY_LOBES,
  CLOSURE_LIBRARY_HELPERS,
  lobeFns,
} from '../../src/compiler/closure-library.ts';
import {
  lambertLobe,
  translucentLobe,
  conductorLobe,
  dielectricLobe,
  dielectricF0,
} from '../../src/render/pathtracing/bsdf.ts';
import { createPcg32 } from '../../src/render/pathtracing/integrator.ts';
import type { Vec3 } from '../../src/scene/transforms.ts';

type V = [number, number, number];
const normalize = (a: V): V => {
  const len = Math.hypot(a[0], a[1], a[2]);
  return len === 0 ? [0, 0, 1] : [a[0] / len, a[1] / len, a[2] / len];
};
const WO: V = normalize([0.4, 0.1, 1.0]);

describe('closure library prelude (T056a)', () => {
  it('faces the reflective half-vector toward the incident ray inside and outside glass', () => {
    const reflection = CLOSURE_LIBRARY_PRELUDE.match(/\/\/ Reflection branch([\s\S]*?)\/\/ Refraction branch/)?.[1];
    expect(reflection).toContain('if (dot(ctx.wo, wm) < 0.0) { wm = -wm; }');
    expect(reflection).not.toContain('if (wm.z < 0.0)');
  });

  it('declares the shared BSDF types and MX_PI', () => {
    expect(CLOSURE_LIBRARY_PRELUDE).toContain('const MX_PI: f32');
    expect(CLOSURE_LIBRARY_PRELUDE).toContain('struct MxBsdfEval {');
    expect(CLOSURE_LIBRARY_PRELUDE).toContain('struct MxBsdfSample {');
    expect(CLOSURE_LIBRARY_PRELUDE).toContain('struct MxLobeCtx {');
    expect(CLOSURE_LIBRARY_PRELUDE).toContain('valid: bool');
  });

  it('exposes the eval/pdf/sample triplet for every ported lobe', () => {
    for (const lobe of CLOSURE_LIBRARY_LOBES) {
      const fns = lobeFns(lobe);
      expect(CLOSURE_LIBRARY_PRELUDE).toContain(`fn ${fns.eval}(ctx: MxLobeCtx, wi: vec3f) -> MxBsdfEval`);
      expect(CLOSURE_LIBRARY_PRELUDE).toContain(`fn ${fns.pdf}(ctx: MxLobeCtx, wi: vec3f) -> f32`);
      expect(CLOSURE_LIBRARY_PRELUDE).toContain(`fn ${fns.sample}(ctx: MxLobeCtx, u: ${fns.sampleInputType}) -> MxBsdfSample`);
    }
  });

  it('lights Zeltner fuzz with directional albedo in SH without duplicating its environment energy', () => {
    const diffuse = CLOSURE_LIBRARY_PRELUDE.match(/fn mx_closure_diffuse_albedo[\s\S]*?\n}/)?.[0];
    const sampledDiffuse = CLOSURE_LIBRARY_PRELUDE.match(/fn mx_closure_sampled_is_diffuse[\s\S]*?\n}/)?.[0];
    const specular = CLOSURE_LIBRARY_PRELUDE.match(/fn mx_closure_specular_eval[\s\S]*?\n}/)?.[0];
    expect(diffuse).toContain('a = a * (1.0 - coverage) + c.fuzz.color * coverage;');
    expect(sampledDiffuse).toContain('if (uz < coverage) { return true; }');
    expect(specular).toContain('base.value * (1.0 - coverage)');
    expect(specular).not.toContain('mx_fuzz_eval');
  });

  it('declares every shared math helper', () => {
    for (const helper of CLOSURE_LIBRARY_HELPERS) {
      expect(CLOSURE_LIBRARY_PRELUDE).toContain(`fn ${helper}(`);
    }
  });

  it('carries the distinctive formula fragments shared verbatim with the CPU oracle', () => {
    // Schlick Fresnel exponent, dielectric F0 from ior, GGX alpha clamp.
    expect(CLOSURE_LIBRARY_PRELUDE).toContain('pow(clamp(1.0 - cosT, 0.0, 1.0), 5.0)');
    expect(CLOSURE_LIBRARY_PRELUDE).toContain('(ior - 1.0) / (ior + 1.0)');
    expect(CLOSURE_LIBRARY_PRELUDE).toContain('max(roughness * roughness, 1.0e-3)');
    // Microfacet value and pdf denominators.
    expect(CLOSURE_LIBRARY_PRELUDE).toContain('d * g / (4.0 * wo.z * wi.z)');
    expect(CLOSURE_LIBRARY_PRELUDE).toContain('d * wm.z / (4.0 * cosVH)');
    // Charlie sheen NDF and Ashikhmin visibility (T056b).
    expect(CLOSURE_LIBRARY_PRELUDE).toContain('(2.0 + inv) * pow(sin2, inv * 0.5) / (2.0 * MX_PI)');
    expect(CLOSURE_LIBRARY_PRELUDE).toContain('1.0 / (4.0 * (wi.z + ctx.wo.z - wi.z * ctx.wo.z))');
    // Anisotropic GGX split, NDF and rotation, plus the isotropic dispatch guard (T056c).
    expect(CLOSURE_LIBRARY_PRELUDE).toContain('vec2f(min(base / aspect, 1.0), base * aspect)');
    expect(CLOSURE_LIBRARY_PRELUDE).toContain('MX_PI * alpha.x * alpha.y * t * t');
    expect(CLOSURE_LIBRARY_PRELUDE).toContain('if (ctx.anisotropy <= 0.0)');
    // Coat layering: two Fresnel crossings and MaterialX substrate tint.
    expect(CLOSURE_LIBRARY_PRELUDE).toContain('let att = (1.0 - coatW * fo) * (1.0 - coatW * fi);');
    expect(CLOSURE_LIBRARY_PRELUDE).toContain('vec3f(1.0 - coatW) + coatW * color');
    expect(CLOSURE_LIBRARY_PRELUDE).not.toContain('vec3f(pathLen)');
    // Dielectric transmission: Snell refraction, dielectric Fresnel, eta^2 pdf
    // Jacobian (1/eta^2 radiance compression) and the thin-walled branch (T056e).
    expect(CLOSURE_LIBRARY_PRELUDE).toContain('invEta * invEta * max(0.0, 1.0 - cosI * cosI)');
    expect(CLOSURE_LIBRARY_PRELUDE).toContain('0.5 * (rs * rs + rp * rp)');
    expect(CLOSURE_LIBRARY_PRELUDE).toContain('d * abs(wm.z) * eta * eta * abs(dotI) / (denom * denom)');
    expect(CLOSURE_LIBRARY_PRELUDE).toContain('if (ctx.thin > 0.0)');

    // Thin film: Airy interference phase, per-channel substrate index from F0 and
    // the weight/thickness no-op guard that keeps the nominal Fresnel (T056f).
    expect(CLOSURE_LIBRARY_PRELUDE).toContain('4.0 * MX_PI * n1 * thickness * c1 / lambda');
    expect(CLOSURE_LIBRARY_PRELUDE).toContain('let n2 = (1.0 + s) / (1.0 - s);');
    expect(CLOSURE_LIBRARY_PRELUDE).toContain('if (weight <= 0.0 || thickness <= 0.0) { return baseFresnel; }');
    expect(CLOSURE_LIBRARY_PRELUDE).toContain('mix(baseFresnel, tint, clamp(weight, 0.0, 1.0))');

    // Subsurface: the optically-thick BSSRDF limit is the cosine-diffuse lobe
    // (T056g), so it shares the Lambert value/pdf expression with the diffuse lobe.
    expect(CLOSURE_LIBRARY_PRELUDE).toContain('fn mx_subsurface_eval(ctx: MxLobeCtx, wi: vec3f) -> MxBsdfEval');
    expect(CLOSURE_LIBRARY_PRELUDE).toContain('return MxBsdfSample(wi, ctx.color / MX_PI, wi.z / MX_PI, true);');

    // T056h full-stack assembler: the mx_closure_* triplet over LayeredClosure,
    // mirroring composeLobes (one-sample MIS) + coatOverBase, plus the thin-film
    // specular cores that modulate the GGX Fresnel.
    expect(CLOSURE_LIBRARY_PRELUDE).toContain('fn mx_closure_eval(c: LayeredClosure, wo: vec3f, wi: vec3f) -> MxBsdfEval');
    expect(CLOSURE_LIBRARY_PRELUDE).toContain('fn mx_closure_pdf(c: LayeredClosure, wo: vec3f, wi: vec3f) -> f32');
    expect(CLOSURE_LIBRARY_PRELUDE).toContain('fn mx_closure_sample(c: LayeredClosure, wo: vec3f, u: vec3f) -> MxBsdfSample');
    expect(CLOSURE_LIBRARY_PRELUDE).toContain('pdf = pdf + (lobe.weight / total) * r.pdf;');
    expect(CLOSURE_LIBRARY_PRELUDE).toContain('let value = coatW * cc.value + att * base.value;');
    expect(CLOSURE_LIBRARY_PRELUDE).toContain('mx_thin_film_fresnel(mx_fresnel_schlick(f0, cosVH), f0, cosVH, filmW, filmT, filmIor)');
  });
});

// The WGSL lobe bodies are a verbatim transcription of these CPU oracle lobes;
// pinning the oracle here fixes the reference the device parity run reproduces.
describe('CPU oracle the library transcribes (T056a)', () => {
  it('diffuse: value = color/pi, pdf = cos/pi', () => {
    const color: Vec3 = [0.8, 0.6, 0.4];
    const wi: V = normalize([0.2, -0.3, 0.9]);
    const e = lambertLobe(color).eval(WO, wi);
    expect(e.value[0]).toBeCloseTo(0.8 / Math.PI, 9);
    expect(e.value[1]).toBeCloseTo(0.6 / Math.PI, 9);
    expect(e.value[2]).toBeCloseTo(0.4 / Math.PI, 9);
    expect(e.pdf).toBeCloseTo(wi[2] / Math.PI, 9);
  });

  it('translucent: emits into the far hemisphere, pdf = -cos/pi', () => {
    const color: Vec3 = [0.5, 0.4, 0.3];
    const lobe = translucentLobe(color);
    expect(lobe.eval(WO, normalize([0.2, -0.3, 0.9])).pdf).toBe(0); // same hemisphere -> 0
    const wi: V = normalize([0.2, -0.3, -0.9]);
    const e = lobe.eval(WO, wi);
    expect(e.value[0]).toBeCloseTo(0.5 / Math.PI, 9);
    expect(e.pdf).toBeCloseTo(-wi[2] / Math.PI, 9);
  });

  it('dielectric F0 matches the (ior-1)/(ior+1) squared helper', () => {
    expect(dielectricF0(1.5)).toBeCloseTo(0.04, 9);
    expect(dielectricF0(1.0)).toBeCloseTo(0.0, 12);
  });

  it('conductor/dielectric sample() pdf and value agree with eval() at wi', () => {
    const lobes = [conductorLobe([1, 0.86, 0.57], 0.3), dielectricLobe(1.5, 0.3)];
    for (const lobe of lobes) {
      const rng = createPcg32(7);
      for (let i = 0; i < 64; i++) {
        const s = lobe.sample(WO, rng);
        if (!s) continue;
        const e = lobe.eval(WO, s.wi);
        expect(e.pdf).toBeCloseTo(s.pdf, 9);
        expect(e.value[0]).toBeCloseTo(s.value[0], 9);
        expect(e.value[1]).toBeCloseTo(s.value[1], 9);
        expect(e.value[2]).toBeCloseTo(s.value[2], 9);
      }
    }
  });
});
