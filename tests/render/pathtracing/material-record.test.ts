// T057b: round-trip tests for the GPU material-record codec and structural
// markers for the WGSL reader. Numeric CPU<->WGSL parity is deferred to the
// device suite (T059); here Node checks the pack/unpack pair is a faithful
// inverse and the emitted WGSL exposes the reader against the shared struct.

import { describe, expect, it } from 'vitest';
import { canonicalSurfaceToLayered, type LayeredClosure } from '../../../src/compiler/ir.ts';
import {
  PT_MATERIAL_RECORD_FLOATS,
  PT_MAX_LOBES,
  materialClosureReaderWgsl,
  packLayeredMaterial,
  unpackLayeredMaterial,
} from '../../../src/render/pathtracing/material-record.ts';

function expectLobesClose(a: LayeredClosure, b: LayeredClosure): void {
  expect(b.lobes.length).toBe(a.lobes.length);
  for (let i = 0; i < a.lobes.length; i++) {
    const la = a.lobes[i]!;
    const lb = b.lobes[i]!;
    expect(lb.kind).toBe(la.kind);
    expect(lb.weight).toBeCloseTo(la.weight, 5);
    for (let k = 0; k < 3; k++) expect(lb.color[k]!).toBeCloseTo(la.color[k]!, 5);
    if (la.roughness === undefined) expect(lb.roughness).toBeUndefined();
    else expect(lb.roughness!).toBeCloseTo(la.roughness, 5);
    if (la.ior === undefined) expect(lb.ior).toBeUndefined();
    else expect(lb.ior!).toBeCloseTo(la.ior, 5);
  }
}

describe('T057b material-record codec', () => {
  it('preserves optional dispersion through CPU packing and the GPU reader', () => {
    const closure: LayeredClosure = { opacity: 1, lobes: [
      { kind: 'dielectric_transmission', weight: 1, color: [1, 1, 1], ior: 1.52, dispersion: 0.35 },
    ] };
    const back = unpackLayeredMaterial(packLayeredMaterial(closure));
    expect(back.lobes[0]?.dispersion).toBeCloseTo(0.35);
    expect(materialClosureReaderWgsl()).toContain('lobe.dispersion = materials[base + 23u]');
  });
  it('packs a record of the documented fixed stride', () => {
    const closure = canonicalSurfaceToLayered({
      baseColor: [0.8, 0.2, 0.1],
      metalness: 0,
      roughness: 0.4,
      transmission: 0,
      subsurface: 0,
      ior: 1.5,
      specular: 1,
    });
    const buf = packLayeredMaterial(closure);
    expect(buf.length).toBe(PT_MATERIAL_RECORD_FLOATS);
    expect(buf[0]).toBe(closure.lobes.length); // lobeCount header slot
  });

  it('round-trips a canonical dielectric closure (non-regression anchor)', () => {
    const closure = canonicalSurfaceToLayered({
      baseColor: [0.6, 0.7, 0.9],
      metalness: 0,
      roughness: 0.3,
      transmission: 0,
      subsurface: 0,
      ior: 1.5,
      specular: 1,
    });
    const back = unpackLayeredMaterial(packLayeredMaterial(closure));
    expectLobesClose(closure, back);
    expect(back.opacity).toBeCloseTo(closure.opacity, 5);
    expect(back.coat).toBeUndefined();
    expect(back.sheen).toBeUndefined();
    expect(back.thinFilm).toBeUndefined();
    expect(back.emission).toBeUndefined();
  });

  it('round-trips a metal closure', () => {
    const closure = canonicalSurfaceToLayered({
      baseColor: [0.95, 0.64, 0.54],
      metalness: 1,
      roughness: 0.2,
      transmission: 0,
      subsurface: 0,
      ior: 1.5,
      specular: 1,
    });
    const back = unpackLayeredMaterial(packLayeredMaterial(closure));
    expectLobesClose(closure, back);
  });

  it('round-trips a rich stack with layers and optional lobe fields', () => {
    const closure: LayeredClosure = {
      lobes: [
        {
          kind: 'conductor',
          weight: 1,
          color: [0.9, 0.7, 0.4],
          roughness: 0.25,
          anisotropy: 0.6,
          rotation: 0.3,
          extinction: [2.1, 1.9, 1.7],
        },
        {
          kind: 'generalized_schlick',
          weight: 0.5,
          color: [0.04, 0.04, 0.04],
          color90: [1, 1, 1],
          roughness: 0.1,
          ior: 1.4,
        },
        { kind: 'dielectric_transmission', weight: 0.3, color: [1, 1, 1], roughness: 0.05, ior: 1.33, thinWalled: true },
      ],
      coat: { weight: 0.8, color: [1, 0.98, 0.95], roughness: 0.08, ior: 1.5 },
      sheen: { weight: 0.4, color: [0.5, 0.5, 0.6], roughness: 0.3 },
      fuzz: { weight: 0.2, color: [0.9, 0.9, 0.9], roughness: 0.5 },
      thinFilm: { weight: 1, thickness: 420, ior: 1.35 },
      emission: [0.1, 0.2, 0.3],
      opacity: 0.9,
    };
    const back = unpackLayeredMaterial(packLayeredMaterial(closure));
    expectLobesClose(closure, back);
    // optional lobe fields survive via the presence bitmask
    expect(back.lobes[0]!.anisotropy).toBeCloseTo(0.6, 5);
    expect(back.lobes[0]!.rotation).toBeCloseTo(0.3, 5);
    expect(back.lobes[0]!.extinction![1]!).toBeCloseTo(1.9, 5);
    expect(back.lobes[1]!.color90![0]!).toBeCloseTo(1, 5);
    expect(back.lobes[2]!.thinWalled).toBe(true);
    // layers + emission + opacity
    expect(back.coat!.ior).toBeCloseTo(1.5, 5);
    expect(back.sheen!.roughness).toBeCloseTo(0.3, 5);
    expect(back.fuzz!.color[0]!).toBeCloseTo(0.9, 5);
    expect(back.thinFilm!.thickness).toBeCloseTo(420, 3);
    expect(back.emission![2]!).toBeCloseTo(0.3, 5);
    expect(back.opacity).toBeCloseTo(0.9, 5);
  });

  it('round-trips a transmissive interior medium and a subsurface radius', () => {
    const closure: LayeredClosure = {
      lobes: [
        {
          kind: 'dielectric_transmission',
          weight: 1,
          color: [0.8, 0.9, 1],
          roughness: 0.05,
          ior: 1.5,
          attenuationColor: [0.5, 0.25, 0.1],
          attenuationDistance: 2,
        },
        { kind: 'subsurface', weight: 0.7, color: [0.9, 0.5, 0.4], subsurfaceRadius: [1.2, 0.4, 0.2] },
      ],
      opacity: 1,
    };
    const back = unpackLayeredMaterial(packLayeredMaterial(closure));
    expectLobesClose(closure, back);
    const glass = back.lobes[0]!;
    expect(glass.attenuationColor![1]!).toBeCloseTo(0.25, 5);
    expect(glass.attenuationDistance!).toBeCloseTo(2, 5);
    const sss = back.lobes[1]!;
    expect(sss.subsurfaceRadius![0]!).toBeCloseTo(1.2, 5);
    expect(sss.subsurfaceRadius![2]!).toBeCloseTo(0.2, 5);
    // A lobe without medium fields keeps them undefined after the round-trip.
    expect(back.lobes[1]!.attenuationColor).toBeUndefined();
  });

  it('is idempotent: pack(unpack(pack(c))) is byte-identical', () => {
    const closure = canonicalSurfaceToLayered({
      baseColor: [0.3, 0.6, 0.2],
      metalness: 0.5,
      roughness: 0.35,
      transmission: 0.2,
      subsurface: 0,
      ior: 1.45,
      specular: 0.9,
    });
    const once = packLayeredMaterial(closure);
    const twice = packLayeredMaterial(unpackLayeredMaterial(once));
    expect(Array.from(twice)).toEqual(Array.from(once));
  });

  it('reads an arbitrary material index from a concatenated buffer', () => {
    const a = canonicalSurfaceToLayered({
      baseColor: [1, 0, 0],
      metalness: 1,
      roughness: 0.1,
      transmission: 0,
      subsurface: 0,
      ior: 1.5,
      specular: 1,
    });
    const b = canonicalSurfaceToLayered({
      baseColor: [0, 1, 0],
      metalness: 0,
      roughness: 0.5,
      transmission: 0,
      subsurface: 0,
      ior: 1.5,
      specular: 1,
    });
    const buf = new Float32Array(PT_MATERIAL_RECORD_FLOATS * 2);
    buf.set(packLayeredMaterial(a), 0);
    buf.set(packLayeredMaterial(b), PT_MATERIAL_RECORD_FLOATS);
    const backB = unpackLayeredMaterial(buf, 1);
    expectLobesClose(b, backB);
    expect(backB.lobes[0]!.color[1]!).toBeCloseTo(1, 5);
  });

  it('caps the packed lobe count at PT_MAX_LOBES', () => {
    const many: LayeredClosure = {
      lobes: Array.from({ length: PT_MAX_LOBES + 3 }, () => ({
        kind: 'burley_diffuse' as const,
        weight: 0.1,
        color: [0.5, 0.5, 0.5] as const,
        roughness: 0.4,
      })),
      opacity: 1,
    };
    const back = unpackLayeredMaterial(packLayeredMaterial(many));
    expect(back.lobes.length).toBe(PT_MAX_LOBES);
  });
});

describe('T057b material-record WGSL reader', () => {
  const wgsl = materialClosureReaderWgsl();

  it('emits the closure reader entry points', () => {
    expect(wgsl).toContain('fn mx_material_closure(matIndex : u32) -> LayeredClosure');
    expect(wgsl).toContain('fn mx_material_lobe(base : u32) -> MxBsdfLobe');
  });

  it('reads from the materials storage array with the documented stride', () => {
    expect(wgsl).toContain(`const MX_MATERIAL_RECORD_FLOATS: u32 = ${PT_MATERIAL_RECORD_FLOATS}u;`);
    expect(wgsl).toContain('materials[base]');
    expect(wgsl).toContain('matIndex * MX_MATERIAL_RECORD_FLOATS');
  });

  it('rebuilds the layered stack fields and lobe loop', () => {
    expect(wgsl).toContain('c.lobeCount = lobeCount;');
    expect(wgsl).toContain('i < MX_MAX_LOBES');
    expect(wgsl).toContain('c.lobes[i] = mx_material_lobe(');
    expect(wgsl).toContain('MxCoatLayer(');
    expect(wgsl).toContain('MxThinFilmLayer(');
  });

  it('decodes the per-lobe presence bitmask', () => {
    expect(wgsl).toContain('MX_LOBE_HAS_COLOR90');
    expect(wgsl).toContain('MX_LOBE_HAS_EXTINCTION');
    expect(wgsl).toContain('flags & MX_LOBE_HAS_ROUGHNESS');
  });
});
