import { buildBvh, buildTlas, transformAabb, type Bvh, type Tlas } from '../../geometry/bvh.ts';
import type { GeometryResource, InstanceResource, SceneResources } from '../scene-resources.ts';

export interface DisneyAcceleration {
  /** One local-space BLAS per referenced geometry prototype. */
  geometries: ReadonlyMap<string, { geometry: GeometryResource; blas: Bvh }>;
  /** Instances in the original order; TLAS leaves index this array through instanceOrder. */
  instances: readonly InstanceResource[];
  tlas: Tlas;
}

/**
 * Rebuild two-level acceleration from the geometry and instances stored in a compiled scene.
 * The triangle and instance permutations remain available for the eventual GPU packing step.
 */
export function buildDisneyAcceleration(resources: SceneResources): DisneyAcceleration {
  if (resources.pendingGeometry.length) {
    throw new Error(`Cannot build Disney acceleration: missing geometry ${resources.pendingGeometry.join(', ')}.`);
  }
  const geometries = new Map<string, { geometry: GeometryResource; blas: Bvh }>();
  const bounds = resources.instances.map(instance => {
    let prepared = geometries.get(instance.prototypeId);
    if (!prepared) {
      const geometry = resources.geometries.get(instance.prototypeId);
      if (!instance.hasGeometry || !geometry) throw new Error(`Missing geometry for instance ${instance.id}.`);
      const positions = geometry.streams.find(stream => stream.name === 'position');
      if (!positions || positions.components !== 3 || positions.data.length % 3 !== 0 ||
          geometry.indices.length % 3 !== 0 || !geometry.indices.length ||
          geometry.indices.some(index => index >= positions.data.length / 3) ||
          positions.data.some(value => !Number.isFinite(value))) {
        throw new Error(`Invalid geometry for instance ${instance.id}.`);
      }
      const blas = buildBvh(positions.data, geometry.indices);
      prepared = { geometry, blas };
      geometries.set(instance.prototypeId, prepared);
    }
    if (!instance.hasGeometry) throw new Error(`Missing geometry for instance ${instance.id}.`);
    if (instance.transform.length !== 16 || instance.transform.some(value => !Number.isFinite(value)) ||
        instance.transform[3] !== 0 || instance.transform[7] !== 0 ||
        instance.transform[11] !== 0 || instance.transform[15] !== 1) {
      throw new Error(`Invalid affine transform for instance ${instance.id}.`);
    }
    return transformAabb(prepared.blas.bounds, instance.transform);
  });
  return { geometries, instances: resources.instances, tlas: buildTlas(bounds, { maxLeafTriangles: 1 }) };
}
