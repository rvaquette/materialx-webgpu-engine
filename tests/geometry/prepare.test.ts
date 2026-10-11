import { describe, it, expect, vi } from 'vitest';
import type { Diagnostic } from '../../src/core/diagnostics.ts';
import { prepareMesh, type RawMesh, type Subdivider } from '../../src/geometry/prepare.ts';

function collect(): { sink: (d: Diagnostic) => void; messages: Diagnostic[] } {
  const messages: Diagnostic[] = [];
  return { sink: (d) => messages.push(d), messages };
}

// Unit quad in the XY plane, CCW (right-handed) -> outward normal +Z.
function quad(): RawMesh {
  return {
    points: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0],
    faceVertexCounts: [4],
    faceVertexIndices: [0, 1, 2, 3],
  };
}

describe('prepareMesh', () => {
  it('fan-triangulates a quad and welds shared vertices', () => {
    const mesh = prepareMesh(quad());
    expect(mesh.positions.length / 3).toBe(4);
    expect(Array.from(mesh.indices)).toEqual([0, 1, 2, 0, 2, 3]);
    // Flat quad -> all normals point +Z.
    for (let i = 0; i < 4; i++) expect(mesh.normals[i * 3 + 2]).toBeCloseTo(1);
  });

  it('reverses winding and flips normals for left-handed meshes', () => {
    const mesh = prepareMesh({ ...quad(), leftHanded: true });
    expect(Array.from(mesh.indices)).toEqual([0, 1, 2, 0, 3, 1]);
    for (let i = 0; i < 4; i++) expect(mesh.normals[i * 3 + 2]).toBeCloseTo(-1);
  });

  it('splits vertices across faceVarying primvar seams', () => {
    const mesh = prepareMesh({
      points: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0],
      faceVertexCounts: [3, 3],
      faceVertexIndices: [0, 1, 2, 0, 2, 3],
      primvars: [
        {
          name: 'st',
          interpolation: 'faceVarying',
          elementSize: 2,
          values: [0, 0, 1, 0, 1, 1, 0.2, 0.2, 0.3, 0.3, 0.4, 0.4],
        },
      ],
    });
    // All six corners carry distinct uvs -> no welding across the seam.
    expect(mesh.positions.length / 3).toBe(6);
    expect(mesh.uvs).toBeDefined();
    expect(mesh.uvs!.length / 2).toBe(6);
  });

  it('honours interpolation when sampling primvars', () => {
    const mesh = prepareMesh({
      points: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0],
      faceVertexCounts: [3, 3],
      faceVertexIndices: [0, 1, 2, 0, 2, 3],
      primvars: [
        { name: 'faceColor', interpolation: 'uniform', elementSize: 1, values: [10, 20] },
      ],
    });
    const attr = mesh.attributes.get('faceColor');
    expect(attr).toBeDefined();
    // Triangle 0 belongs to face 0 (value 10); triangle in face 1 carries 20.
    const values = Array.from(attr!.values);
    expect(values).toContain(10);
    expect(values).toContain(20);
  });

  it('skips hole faces', () => {
    const mesh = prepareMesh({
      points: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 2, 0, 0, 2, 1, 0],
      faceVertexCounts: [4, 4],
      faceVertexIndices: [0, 1, 2, 3, 1, 4, 5, 2],
      holeIndices: [1],
    });
    expect(mesh.indices.length).toBe(6); // only the first quad -> 2 triangles
  });

  it('maps GeomSubsets to triangle ranges', () => {
    const { sink } = collect();
    const mesh = prepareMesh(
      {
        points: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 2, 0, 0, 2, 1, 0],
        faceVertexCounts: [4, 4],
        faceVertexIndices: [0, 1, 2, 3, 1, 4, 5, 2],
        subsets: [{ name: 'right', faceIndices: [1], material: 'metal' }],
      },
      { sink },
    );
    expect(mesh.subsets).toHaveLength(1);
    expect(mesh.subsets[0]!.name).toBe('right');
    expect(mesh.subsets[0]!.material).toBe('metal');
    expect(Array.from(mesh.subsets[0]!.triangles)).toEqual([2, 3]);
  });

  it('computes tangents when UVs are present', () => {
    const mesh = prepareMesh({
      ...quad(),
      primvars: [
        { name: 'st', interpolation: 'vertex', elementSize: 2, values: [0, 0, 1, 0, 1, 1, 0, 1] },
      ],
    });
    expect(mesh.tangents).toBeDefined();
    expect(mesh.tangents!.length / 4).toBe(4);
    // Tangent follows +U (world +X) for this planar quad.
    expect(mesh.tangents![0]).toBeCloseTo(1);
    expect(Math.abs(mesh.tangents![3]!)).toBe(1); // handedness sign
  });

  it('reports subdivision as pending without a subdivider', () => {
    const { sink, messages } = collect();
    const mesh = prepareMesh({ ...quad(), subdivisionScheme: 'catmullClark', refinementLevel: 2 }, { sink });
    expect(mesh.subdivision).toEqual({ scheme: 'catmullClark', level: 2, applied: false });
    expect(messages.some((m) => m.level === 'warning' && m.message.includes('Subdivision'))).toBe(true);
  });

  it('subdivides through an injected refiner', () => {
    const refined: RawMesh = {
      points: [0, 0, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0.5, 0],
      faceVertexCounts: [4],
      faceVertexIndices: [0, 1, 2, 3],
    };
    const subdivider: Subdivider = { refine: vi.fn(() => refined) };
    const mesh = prepareMesh(
      { ...quad(), subdivisionScheme: 'catmullClark', refinementLevel: 1 },
      { subdivider },
    );
    expect(subdivider.refine).toHaveBeenCalledOnce();
    expect(mesh.subdivision.applied).toBe(true);
  });

  it('flags displacement when the material requires it', () => {
    const mesh = prepareMesh(quad(), { hasDisplacement: true });
    expect(mesh.displacement.required).toBe(true);
  });
});
