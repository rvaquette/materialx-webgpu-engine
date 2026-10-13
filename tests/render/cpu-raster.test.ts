// CPU software rasterizer (src/render/raster/cpu-raster.ts) coverage. A single
// quad at z=0 is built through the real SceneResources + scene-frame plan, then
// rasterized by an orthographic-ish perspective camera looking straight down -Z.
// The test pins projection (the quad fills the centre, the corners stay empty),
// perspective-correct shading (the centre pixel equals the reference BSDF under
// the frame's own light + environment for a front-facing normal), and
// determinism. A nearer occluding quad verifies the depth buffer picks the front
// surface.
import { describe, expect, it } from 'vitest';
import { IrModuleBuilder, FLOAT, shaderType } from '../../src/compiler/ir.ts';
import { emitWgsl } from '../../src/compiler/wgsl.ts';
import type { RawMesh } from '../../src/geometry/prepare.ts';
import type { MaterialXReference, SceneAsset, ScenePrim, XformOp } from '../../src/scene/types.ts';
import type { MaterialCompileUnit } from '../../src/usd/materials.ts';
import {
  buildSceneResources,
  type MaterialBuild,
  type MaterialCompiler,
  type MaterialResource,
  type MeshSource,
} from '../../src/render/scene-resources.ts';
import {
  buildSceneFrame,
  type FrameCamera,
  type RasterSurface,
} from '../../src/render/raster/scene-frame.ts';
import { evaluateSurface, type ReferenceLighting } from '../../src/render/bsdf/reference.ts';
import { lookAt4, multiply4, perspective4 } from '../../src/scene/transforms.ts';
import { rasterizeScene } from '../../src/render/raster/cpu-raster.ts';

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

/** A z=0 quad spanning [-2,2] in x and y, wound so its normal faces +Z. */
function quad(): RawMesh {
  return {
    points: [-2, -2, 0, 2, -2, 0, 2, 2, 0, -2, 2, 0],
    faceVertexCounts: [4],
    faceVertexIndices: [0, 1, 2, 3],
    primvars: [],
  };
}

const MTLX = (name: string): MaterialXReference => ({
  primPath: `/World/Looks/${name}`,
  assetPath: `./${name}.mtlx`,
  referencedPrimPath: `/MaterialX/Materials/${name}`,
  materialName: name,
});

function surfaceCompiler(): MaterialCompiler {
  return {
    compile(_unit: MaterialCompileUnit): MaterialBuild {
      const b = new IrModuleBuilder();
      const opacity = b.constant(FLOAT, 1);
      const ref = b.add({ kind: 'closure', type: shaderType('surface'), closure: 'bsdf', op: 'surface', params: { opacity } });
      b.output({ name: 'surfaceshader', type: shaderType('surface'), ref });
      const ir = b.build();
      return { ir, module: emitWgsl(ir) };
    },
  };
}

function meshSource(map: Record<string, RawMesh>): MeshSource {
  return { meshFor: (path) => map[path] };
}

const RED_SURFACE: RasterSurface = {
  baseColor: [0.8, 0.1, 0.1],
  metalness: 0,
  roughness: 0.4,
  transmission: 0,
  subsurface: 0,
  ior: 1.5,
  specular: 1,
};
const BLUE_SURFACE: RasterSurface = {
  baseColor: [0.1, 0.1, 0.8],
  metalness: 0,
  roughness: 0.4,
  transmission: 0,
  subsurface: 0,
  ior: 1.5,
  specular: 1,
};

// Perspective camera at +Z looking at the origin; the quad fills the viewport.
const RES = 9;
const CENTER = (4 * RES + 4) * 3;
const previewCamera: FrameCamera = {
  viewProj: multiply4(perspective4(1.2, 1, 0.1, 100), lookAt4([0, 0, 5], [0, 0, 0], [0, 1, 0])),
  eye: [0, 0, 5],
  exposure: 0,
};

async function singleQuadResources(): Promise<Awaited<ReturnType<typeof buildSceneResources>>> {
  const world = prim('/World', { children: ['/World/quad', '/World/Looks'] });
  const mesh = prim('/World/quad', {
    typeName: 'Mesh',
    mesh: { primvars: [] },
    materialBinding: { target: '/World/Looks/red', strength: 'weakerThanDescendants' },
  });
  const looks = prim('/World/Looks', { children: ['/World/Looks/red'] });
  const material = prim('/World/Looks/red', { typeName: 'Material' });
  const prims = [world, mesh, looks, material];
  const scene: SceneAsset = {
    entry: 'root.usda',
    stage: { subLayers: [] },
    prims: new Map(prims.map((p) => [p.path, p])),
    roots: ['/World'],
    materials: [MTLX('red')],
  };
  return buildSceneResources(scene, {
    meshSource: meshSource({ '/World/quad': quad() }),
    materialCompiler: surfaceCompiler(),
    sink: () => {},
  });
}

describe('rasterizeScene (CPU raster backend)', () => {
  it('projects the quad over the centre and leaves the corners empty', async () => {
    const resources = await singleQuadResources();
    const frame = buildSceneFrame(resources, {
      frameCamera: previewCamera,
      surfaceFor: () => RED_SURFACE,
      environment: { radiance: [0.2, 0.2, 0.2] },
    });

    const result = rasterizeScene(resources, frame, { width: RES, height: RES });

    expect(result.covered).toBeGreaterThan(0);
    expect(result.covered).toBeLessThan(RES * RES);
    // Centre is on the quad; the four corners fall outside it.
    expect(result.coverage[4 * RES + 4]).toBe(1);
    for (const corner of [0, RES - 1, (RES - 1) * RES, RES * RES - 1]) {
      expect(result.coverage[corner]).toBe(0);
      expect(result.hdr[corner * 3]).toBe(0);
    }
  });

  it('shades the centre pixel with the reference BSDF (front-facing normal, view +Z)', async () => {
    const resources = await singleQuadResources();
    const frame = buildSceneFrame(resources, {
      frameCamera: previewCamera,
      surfaceFor: () => RED_SURFACE,
      environment: { radiance: [0.2, 0.2, 0.2] },
    });

    const result = rasterizeScene(resources, frame, { width: RES, height: RES });

    const lighting: ReferenceLighting = {
      environment: frame.environment.radiance,
      lights: [
        { direction: frame.light.direction, color: frame.light.color, intensity: frame.light.intensity },
      ],
    };
    const expected = evaluateSurface(RED_SURFACE, { normal: [0, 0, 1], view: [0, 0, 1] }, lighting).color;

    expect(result.hdr[CENTER]).toBeCloseTo(expected[0], 6);
    expect(result.hdr[CENTER + 1]).toBeCloseTo(expected[1], 6);
    expect(result.hdr[CENTER + 2]).toBeCloseTo(expected[2], 6);
  });

  it('is deterministic for identical inputs', async () => {
    const resources = await singleQuadResources();
    const frame = buildSceneFrame(resources, {
      frameCamera: previewCamera,
      surfaceFor: () => RED_SURFACE,
      environment: { radiance: [0.2, 0.2, 0.2] },
    });
    const a = rasterizeScene(resources, frame, { width: RES, height: RES });
    const b = rasterizeScene(resources, frame, { width: RES, height: RES });
    expect(Array.from(a.hdr)).toEqual(Array.from(b.hdr));
    expect(Array.from(a.coverage)).toEqual(Array.from(b.coverage));
  });

  it('resolves the depth buffer to the nearer surface', async () => {
    // Two quads: a far red one at z=0 and a nearer blue one at z=1 (closer to the
    // +Z eye). The centre pixel must show the blue (nearer) surface regardless of
    // draw order.
    const world = prim('/World', { children: ['/World/far', '/World/near', '/World/Looks'] });
    const far = prim('/World/far', {
      typeName: 'Mesh',
      mesh: { primvars: [] },
      materialBinding: { target: '/World/Looks/red', strength: 'weakerThanDescendants' },
    });
    const near = prim('/World/near', {
      typeName: 'Mesh',
      mesh: { primvars: [] },
      xformOps: [translate(0, 0, 1)],
      materialBinding: { target: '/World/Looks/blue', strength: 'weakerThanDescendants' },
    });
    const looks = prim('/World/Looks', { children: ['/World/Looks/red', '/World/Looks/blue'] });
    const redMat = prim('/World/Looks/red', { typeName: 'Material' });
    const blueMat = prim('/World/Looks/blue', { typeName: 'Material' });
    const prims = [world, far, near, looks, redMat, blueMat];
    const scene: SceneAsset = {
      entry: 'root.usda',
      stage: { subLayers: [] },
      prims: new Map(prims.map((p) => [p.path, p])),
      roots: ['/World'],
      materials: [MTLX('red'), MTLX('blue')],
    };
    const resources = await buildSceneResources(scene, {
      meshSource: meshSource({ '/World/far': quad(), '/World/near': quad() }),
      materialCompiler: surfaceCompiler(),
      sink: () => {},
    });

    const surfaceFor = (material: MaterialResource): RasterSurface =>
      material.materialName === 'blue' ? BLUE_SURFACE : RED_SURFACE;
    const frame = buildSceneFrame(resources, {
      frameCamera: previewCamera,
      surfaceFor,
      environment: { radiance: [0.2, 0.2, 0.2] },
    });

    const result = rasterizeScene(resources, frame, { width: RES, height: RES });

    const lighting: ReferenceLighting = {
      environment: frame.environment.radiance,
      lights: [
        { direction: frame.light.direction, color: frame.light.color, intensity: frame.light.intensity },
      ],
    };
    const blue = evaluateSurface(BLUE_SURFACE, { normal: [0, 0, 1], view: [0, 0, 1] }, lighting).color;
    // Blue dominates its red channel; the nearer surface must win the centre.
    expect(result.hdr[CENTER + 2]).toBeCloseTo(blue[2], 6);
    expect(result.hdr[CENTER]).toBeCloseTo(blue[0], 6);
  });
});
