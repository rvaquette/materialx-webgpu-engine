import type { SceneAsset } from '../../scene/types.ts';
import { materialUnitKey } from '../../usd/materials.ts';
import type { MaterialResource, SceneResources } from '../scene-resources.ts';
import { buildDisneyAcceleration, type DisneyAcceleration } from './disney-acceleration.ts';
import { packDisneyGeometryTextures, type DisneyGeometryTextures } from './disney-geometry-textures.ts';
import { disneyMaterialFromPrincipled, packDisneyMaterials, type DisneyMaterial } from './disney-material.ts';
import { disneyMaterialFromStandard } from './disney-standard-material.ts';
import { DisneyTextureRegistry } from './disney-texture-array.ts';

export interface DisneySceneData {
  geometry: DisneyGeometryTextures;
  materials: readonly DisneyMaterial[];
  textures: DisneyTextureRegistry;
  warnings: readonly { materialKey: string; message: string }[];
  /** Two-level acceleration and material slots, kept for in-place dynamic updates. */
  acceleration?: DisneyAcceleration;
  materialIndices?: ReadonlyMap<string, number>;
}

export function convertDisneySceneMaterial(key: string, resource: MaterialResource, textures: DisneyTextureRegistry) {
  const surface = resource.resolvedSurface;
  if (!surface) throw new Error(`Missing resolved Disney surface: ${key}.`);
  if (resource.volumeIr || resource.volumeMedium || resource.volumeBoundary || resource.displacement ||
      surface.backNodeId || resource.surfaceGraph?.terminals.some(terminal =>
        (terminal.name === 'volumeshader' || terminal.name === 'displacementshader') && terminal.nodeId)) {
    throw new Error(`Unsupported volume, displacement or back surface in Disney material: ${key}.`);
  }
  if (surface.family === 'disney_principled') return disneyMaterialFromPrincipled(surface, resource.parameters);
  if (surface.family === 'standard_surface' && resource.surfaceGraph) {
    return disneyMaterialFromStandard(surface, resource.surfaceGraph, resource.parameters,
      (file, usage) => textures.add(file, usage));
  }
  throw new Error(`Unsupported Disney material family or missing graph for ${key}: ${surface.family}.`);
}

/**
 * Prepare the geometry and referenced material records for the Disney backend.
 * The caller must pass the renderable instances (excluding analytic-light proxies).
 * Subset paths must resolve to already compiled MaterialX resources.
 */
export function prepareDisneyScene(scene: SceneAsset, resources: SceneResources): DisneySceneData {
  if (!resources.instances.length) throw new Error('Cannot prepare a Disney scene without instances.');
  const acceleration = buildDisneyAcceleration(resources);
  const textures = new DisneyTextureRegistry();
  const materials: DisneyMaterial[] = [];
  const warnings: { materialKey: string; message: string }[] = [];
  const materialIndices = new Map<string, number>();
  const indexFor = (key: string): number => {
    const existing = materialIndices.get(key);
    if (existing !== undefined) return existing;
    const resource = resources.materials.get(key);
    if (!resource) throw new Error(`Missing compiled Disney material: ${key}.`);
    const converted = convertDisneySceneMaterial(key, resource, textures);
    const index = materials.length;
    materials.push(converted.material);
    materialIndices.set(key, index);
    warnings.push(...converted.warnings.map(message => ({ materialKey: key, message })));
    return index;
  };
  const instanceMaterials: number[] = [];
  const subsetMaterials: Map<string, number>[] = [];
  for (const instance of acceleration.instances) {
    if (!instance.materialKey) throw new Error(`Missing Disney material binding for instance ${instance.id}.`);
    instanceMaterials.push(indexFor(instance.materialKey));
    const geometry = acceleration.geometries.get(instance.prototypeId)!.geometry;
    const subsetMap = new Map<string, number>();
    for (const subset of geometry.subsets) {
      const path = subset.material;
      if (path === undefined || subsetMap.has(path)) continue;
      const references = scene.materials.filter(reference => reference.primPath === path);
      if (!references.length) throw new Error(`Missing MaterialX reference for Disney subset material ${path}.`);
      const key = materialUnitKey(references[0]!);
      if (references.some(reference => materialUnitKey(reference) !== key)) {
        throw new Error(`Ambiguous MaterialX reference for Disney subset material ${path}.`);
      }
      subsetMap.set(path, indexFor(key));
    }
    subsetMaterials.push(subsetMap);
  }
  packDisneyMaterials(materials);
  return {
    geometry: packDisneyGeometryTextures(acceleration, instanceMaterials, subsetMaterials),
    materials, textures, warnings, acceleration, materialIndices,
  };
}
