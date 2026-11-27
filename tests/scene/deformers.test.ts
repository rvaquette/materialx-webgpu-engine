import { describe, expect, it } from 'vitest';
import { deformPosition, validateDeformer, type Deformer } from '../../src/scene/deformers.ts';
import { deformMesh } from '../../src/scene/primitives.ts';

const twist: Deformer = { kind: 'Twist', axis: 'Y', min: -1, max: 1, falloff: 0, angle: 90 };
const shear: Deformer = { kind: 'Shear', axis: 'Y', min: -1, max: 1, falloff: 0, factor: 1 };

describe('object-space deformers', () => {
  it('applies the stack in order without changing its input', () => {
    const point = [1, 1, 0];
    const twisted = deformPosition(point, [twist]);
    expect(twisted[0]).toBeCloseTo(0);
    expect(twisted[2]).toBeCloseTo(-1);
    expect(deformPosition(point, [twist, shear])).not.toEqual(deformPosition(point, [shear, twist]));
    expect(point).toEqual([1, 1, 0]);
  });

  it('limits influence and smoothly fades at the edges', () => {
    const wave: Deformer = { kind: 'Wave', axis: 'Y', min: -1, max: 1, falloff: 0.5, amplitude: 2, frequency: 0, phase: Math.PI / 2 };
    expect(deformPosition([0, 2, 0], [wave])).toEqual([0, 2, 0]);
    expect(deformPosition([0, -1, 0], [wave])).toEqual([0, -1, 0]);
    expect(deformPosition([0, 0, 0], [wave])[2]).toBeCloseTo(2);
    expect(deformPosition([0, -0.75, 0], [wave])[2]).toBeCloseTo(1);
  });

  it('applies bending, tapering and spherization in object space', () => {
    const bend: Deformer = { kind: 'Bend', axis: 'Y', min: 0, max: 1, falloff: 0, angle: 90 };
    const bent = deformPosition([0, 1, 0], [bend]);
    expect(bent[1]).toBeCloseTo(2 / Math.PI);
    expect(bent[2]).toBeCloseTo(-2 / Math.PI);
    const taper: Deformer = { kind: 'Taper', axis: 'Y', min: -1, max: 1, falloff: 0, factor: 1 };
    expect(deformPosition([1, 1, 2], [taper])).toEqual([2, 1, 4]);
    const sphere: Deformer = { kind: 'Spherize', axis: 'Y', min: -1, max: 1, falloff: 0, radius: 1, strength: 1 };
    expect(deformPosition([0, 0.5, 0], [sphere])).toEqual([0, 1, 0]);
    expect(deformPosition([0, 0, 0], [sphere])).toEqual([0, 0, 0]);
  });

  it('validates influence bounds and spherization', () => {
    expect(() => validateDeformer({ ...twist, max: -1 })).toThrow(/max must exceed min/);
    expect(() => validateDeformer({ ...twist, falloff: 2 })).toThrow(/falloff/);
    expect(() => validateDeformer({ ...twist, angle: NaN })).toThrow(/angle must be a finite number/);
    expect(() => validateDeformer({ kind: 'Spherize', axis: 'X', min: -1, max: 1, falloff: 0, radius: 0, strength: 1 }))
      .toThrow(/positive radius/);
  });

  it('interpolates Bezier lattice offsets and leaves points outside unchanged', () => {
    const offsets = Array.from({ length: 8 }, (_, i) => [0, i === 7 ? 8 : 0, 0]).flat();
    const lattice: Deformer = {
      kind: 'Lattice', axis: 'Y', min: -1, max: 1, falloff: 0,
      boundsMin: [-1, -1, -1], boundsMax: [1, 1, 1], dimensions: [2, 2, 2], offsets,
    };
    validateDeformer(lattice);
    expect(deformPosition([0, 0, 0], [lattice])).toEqual([0, 1, 0]);
    expect(deformPosition([2, 0, 0], [lattice])).toEqual([2, 0, 0]);
    expect(() => validateDeformer({ ...lattice, offsets: [1, 2, 3] })).toThrow(/three components per control point/);
  });

  it('uses deterministic 3D wind noise and anchors the beginning of the influence', () => {
    const wind: Deformer = { kind: 'Wind', axis: 'X', min: -1, max: 1, falloff: 0, amplitude: 1, frequency: 2, phase: 0.3, seed: 7 };
    validateDeformer(wind);
    expect(deformPosition([-1, 0.2, 0], [wind])).toEqual([-1, 0.2, 0]);
    const moved = deformPosition([0.3, 0.2, 0.1], [wind]);
    expect(moved).not.toEqual([0.3, 0.2, 0.1]);
    expect(deformPosition([0.3, 0.2, 0.1], [wind])).toEqual(moved);
    expect(deformPosition([0.3, 0.2, 0.1], [{ ...wind, phase: 0.6 }])).not.toEqual(moved);
    expect(() => validateDeformer({ ...wind, seed: 0.5 })).toThrow(/unsigned 32-bit/);
  });

  it('preserves imported hard-normal seams while recomputing deformed normals', () => {
    const result = deformMesh({
      points: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1],
      faceVertexCounts: [3, 3], faceVertexIndices: [0, 1, 2, 3, 4, 5],
      normals: { name: 'normals', interpolation: 'vertex', elementSize: 3,
        values: [0, 0, 1, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 1, 0, 0] },
    }, p => p, true);
    expect(result.normals!.values.slice(0, 3)).toEqual([0, 0, 1]);
    expect(result.normals!.values.slice(9, 12)).toEqual([1, 0, 0]);
  });
});
