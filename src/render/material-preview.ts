import { buildTlas } from '../geometry/bvh.ts';
import { loadExternalMesh } from '../geometry/external-mesh.ts';
import { prepareMesh } from '../geometry/prepare.ts';
import { OrbitCamera } from '../scene/orbit-camera.ts';
import { IDENTITY4, inverse4, type Mat4, type Vec3 } from '../scene/transforms.ts';
import type { DiagnosticSink } from '../core/diagnostics.ts';
import { buildGeometry, transformBounds, type GeometryResource, type SceneResources } from './scene-resources.ts';
import type { FrameCamera } from './raster/scene-frame.ts';

export type MaterialPreviewTarget = 'object' | 'shaderball';
export type MaterialPreviewOptions =
  | { target: MaterialPreviewTarget; backend: 'raster' }
  | { target: MaterialPreviewTarget; backend: 'pathtracing'; samples: number };

export async function loadMaterialPreviewShaderBall(baseUrl: string, sink: DiagnosticSink): Promise<GeometryResource> {
  const url = new URL('scenes/pathtracer/ShaderBall.glb', baseUrl).href;
  const mesh = await loadExternalMesh(url, 'Preview_Mesh', sink);
  return buildGeometry('material-preview-shaderball', '/__material_preview', prepareMesh(mesh, { computeTangents: true, sink }));
}

/** Isolate the selected material and one mesh without changing the source scene. */
export function materialPreviewResources(
  source: SceneResources, path: string, shaderBall?: GeometryResource,
): SceneResources {
  const selected = source.instances.find(instance => instance.primPath === path && instance.hasGeometry);
  const key = selected?.materialKey;
  const material = key ? source.materials.get(key) : undefined;
  const geometry = shaderBall ?? (selected ? source.geometries.get(selected.prototypeId) : undefined);
  if (!selected || !key || !material || !geometry) throw new Error('Objet ou matériau d’aperçu indisponible.');
  const instance = {
    ...selected, id: '/__material_preview', primPath: '/__material_preview',
    prototypeId: geometry.prototypeId, transform: shaderBall ? IDENTITY4 : selected.transform,
  };
  return {
    ...source, geometries: new Map([[geometry.prototypeId, geometry]]), materials: new Map([[key, material]]),
    instances: [instance], tlas: buildTlas([transformBounds(geometry.bounds, instance.transform)]),
    pendingGeometry: [], pendingMaterials: [], unboundGprims: [],
  };
}

/** Frame the displaced world-space bounds from the main viewer's viewing direction. */
export function materialPreviewCamera(
  resources: SceneResources, direction: Vec3, exposure: number,
): { camera: FrameCamera; backgroundInvViewProj: Mat4 } {
  const instance = resources.instances[0];
  const geometry = instance ? resources.geometries.get(instance.prototypeId) : undefined;
  if (!instance || !geometry) throw new Error('Géométrie d’aperçu indisponible.');
  const bounds = transformBounds(geometry.bounds, instance.transform);
  const values = [...bounds.min, ...bounds.max, ...direction, exposure];
  if (!values.every(Number.isFinite)) throw new Error('Cadrage de l’aperçu invalide.');
  const target: Vec3 = [
    (bounds.min[0] + bounds.max[0]) / 2,
    (bounds.min[1] + bounds.max[1]) / 2,
    (bounds.min[2] + bounds.max[2]) / 2,
  ];
  const radius = Math.max(0.001, Math.hypot(
    bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1], bounds.max[2] - bounds.min[2],
  ) / 2);
  const length = Math.hypot(...direction);
  const view: Vec3 = length > 0 ? [direction[0] / length, direction[1] / length, direction[2] / length] : [0.657, 0.438, 0.613];
  const fov = Math.PI / 4;
  const distance = radius * 1.2 / Math.sin(fov / 2);
  const eye: Vec3 = [target[0] + view[0] * distance, target[1] + view[1] * distance, target[2] + view[2] * distance];
  const orbit = OrbitCamera.fromEyeTarget(eye, target, 1, fov, Math.max(radius * 0.0001, 0.000001), distance + radius * 2);
  orbit.projection = 'perspective';
  return {
    camera: { viewProj: orbit.viewProj(), eye: orbit.eye, exposure },
    backgroundInvViewProj: inverse4(orbit.backgroundViewProj()),
  };
}
