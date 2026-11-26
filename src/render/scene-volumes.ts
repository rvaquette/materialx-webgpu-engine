// USD volumes (UsdVolVolume with OpenVDBAsset fields). Each field file is read as
// NanoVDB (.nvdb; .vdb files must be converted) and resampled into a dense grid
// in the Volume prim's space. The prim renders as a closed box around its fields
// whose volume material reads them through `geompropvalue` (density,
// temperature...); the path-tracing scene bakes them into its world-space grid
// atlas per instance, so instanced volumes share their fields. A Volume without
// a material gets a default one: scattering from density, blackbody emission
// from an optional temperature field.
import type { DiagnosticSink } from '../core/diagnostics.ts';
import type { Aabb } from '../geometry/bvh.ts';
import type { RawMesh } from '../geometry/prepare.ts';
import { resolveAsset } from '../geometry/external-mesh.ts';
import { readNanoVdb, resampleNanoVdb, type NanoVdbGrid } from '../assets/nanovdb.ts';
import type { MaterialXReference, SceneAsset, ScenePrim } from '../scene/types.ts';

export interface SceneVolume {
  /** Bounds of all fields in the Volume prim's space. */
  bounds: Aabb;
  /** Scalar fields by name, sampled in the Volume prim's space (0 outside the field). */
  fields: ReadonlyMap<string, (position: readonly number[]) => number>;
}

/** Densest resampled axis of a field. */
export const VOLUME_FIELD_RESOLUTION = 96;

async function fetchBytes(uri: string): Promise<ArrayBuffer> {
  const response = await fetch(uri);
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${uri}`);
  return response.arrayBuffer();
}

/** Reads the fields of every Volume prim, by Volume prim path. */
export async function loadSceneVolumes(
  scene: SceneAsset, sink: DiagnosticSink, read: (uri: string) => Promise<ArrayBuffer> = fetchBytes,
): Promise<Map<string, SceneVolume>> {
  const volumes = new Map<string, SceneVolume>();
  const files = new Map<string, Promise<NanoVdbGrid[]>>();
  for (const prim of scene.prims.values()) {
    if (prim.typeName !== 'Volume') continue;
    const fields = new Map<string, (position: readonly number[]) => number>();
    let bounds: Aabb | undefined;
    const minValue = prim.attributes.get('engine:boundsMin')?.value;
    const maxValue = prim.attributes.get('engine:boundsMax')?.value;
    const extentValue = prim.attributes.get('extent')?.value;
    if (Array.isArray(minValue) && minValue.length === 3 && Array.isArray(maxValue) && maxValue.length === 3) {
      const min = minValue.map(Number) as [number, number, number];
      const max = maxValue.map(Number) as [number, number, number];
      if (min.every(Number.isFinite) && max.every(Number.isFinite) && min.every((value, axis) => value < max[axis]!)) {
        bounds = { min, max };
      } else {
        sink({ level: 'error', message: `Volume ${prim.path} has invalid engine bounds.` });
      }
    } else if (minValue !== undefined || maxValue !== undefined) {
      sink({ level: 'error', message: `Volume ${prim.path} must define both engine:boundsMin and engine:boundsMax.` });
    }
    if (!bounds && Array.isArray(extentValue) && extentValue.length === 6) {
      const min = extentValue.slice(0, 3).map(Number) as [number, number, number];
      const max = extentValue.slice(3, 6).map(Number) as [number, number, number];
      if (min.every(Number.isFinite) && max.every(Number.isFinite) && min.every((value, axis) => value < max[axis]!)) {
        bounds = { min, max };
      } else {
        sink({ level: 'error', message: `Volume ${prim.path} has invalid extent.` });
      }
    } else if (!bounds && extentValue !== undefined) {
      sink({ level: 'error', message: `Volume ${prim.path} extent must contain its minimum and maximum points.` });
    }
    for (const [relationship, rel] of prim.relationships) {
      if (!relationship.startsWith('field:')) continue;
      const fieldPrim = scene.prims.get(rel.targets[0] ?? '');
      const name = relationship.slice('field:'.length);
      try {
        if (fieldPrim?.typeName !== 'OpenVDBAsset') throw new Error(`field:${name} must target an OpenVDBAsset prim.`);
        const attribute = fieldPrim.attributes.get('filePath');
        if (typeof attribute?.value !== 'string' || !attribute.value) throw new Error('Missing filePath.');
        const uri = resolveAsset(attribute.sourceLayer ?? scene.entry, attribute.value);
        if (!files.has(uri)) files.set(uri, read(uri).then(readNanoVdb));
        const grids = await files.get(uri)!;
        const gridName = fieldPrim.attributes.get('fieldName')?.value;
        const index = fieldPrim.attributes.get('fieldIndex')?.value;
        const grid = typeof gridName === 'string' && gridName
          ? grids.filter(candidate => candidate.name === gridName)[typeof index === 'number' ? index : 0]
          : grids[typeof index === 'number' ? index : 0];
        if (!grid) throw new Error(`No grid '${String(gridName ?? index ?? 0)}' in ${uri}.`);
        const dense = resampleNanoVdb(grid, VOLUME_FIELD_RESOLUTION);
        const { min, max } = dense.bounds;
        fields.set(name, position => position.every((v, a) => v >= min[a]! && v <= max[a]!) ? dense.sample(position) : 0);
        bounds = bounds
          ? { min: [0, 1, 2].map(a => Math.min(bounds!.min[a]!, min[a]!)) as [number, number, number],
            max: [0, 1, 2].map(a => Math.max(bounds!.max[a]!, max[a]!)) as [number, number, number] }
          : { min, max };
      } catch (error) {
        sink({ level: 'error', message: `Volume field ${prim.path}.field:${name} ignored: ${error instanceof Error ? error.message : String(error)}` });
      }
    }
    if (bounds) volumes.set(prim.path, { bounds, fields });
  }
  return volumes;
}

/** Closed box around a volume's fields (outward faces), drawn as the volume boundary. */
export function volumeBoxMesh(volume: SceneVolume): RawMesh {
  const { min, max } = volume.bounds;
  const points: number[] = [];
  for (let corner = 0; corner < 8; corner++) {
    points.push(corner & 1 ? max[0] : min[0], corner & 2 ? max[1] : min[1], corner & 4 ? max[2] : min[2]);
  }
  return {
    points, faceVertexCounts: [4, 4, 4, 4, 4, 4],
    faceVertexIndices: [0, 2, 3, 1, 4, 5, 7, 6, 0, 1, 5, 4, 2, 6, 7, 3, 0, 4, 6, 2, 1, 3, 7, 5],
  };
}

function boundMaterial(scene: SceneAsset, prim: ScenePrim): boolean {
  for (let path = prim.path; path && path !== '/'; path = path.slice(0, path.lastIndexOf('/')) || '/') {
    if (scene.prims.get(path)?.materialBinding) return true;
  }
  return false;
}

/** MaterialX volume reading `density` (and `temperature` when present). */
export function defaultVolumeMaterialXml(name: string, temperature: boolean): string {
  const field = (id: string) => `  <geompropvalue name="${id}" type="float">\n    <input name="geomprop" type="string" value="${id}" />\n  </geompropvalue>`;
  return `<?xml version="1.0"?>
<materialx version="1.39" colorspace="lin_rec709">
${field('density')}
  <combine3 name="scattering" type="vector3">
    <input name="in1" type="float" nodename="density" />
    <input name="in2" type="float" nodename="density" />
    <input name="in3" type="float" nodename="density" />
  </combine3>
  <multiply name="absorption" type="vector3">
    <input name="in1" type="vector3" nodename="scattering" />
    <input name="in2" type="vector3" value="0.05, 0.05, 0.05" />
  </multiply>
  <anisotropic_vdf name="vdf" type="VDF">
    <input name="absorption" type="vector3" nodename="absorption" />
    <input name="scattering" type="vector3" nodename="scattering" />
    <input name="anisotropy" type="float" value="0.2" />
  </anisotropic_vdf>
${temperature ? `${field('temperature')}
  <multiply name="kelvin_span" type="float">
    <input name="in1" type="float" nodename="temperature" />
    <input name="in2" type="float" value="2500" />
  </multiply>
  <add name="kelvin" type="float">
    <input name="in1" type="float" nodename="kelvin_span" />
    <input name="in2" type="float" value="800" />
  </add>
  <blackbody name="tint" type="color3">
    <input name="temperature" type="float" nodename="kelvin" />
  </blackbody>
  <power name="radiance" type="float">
    <input name="in1" type="float" nodename="temperature" />
    <input name="in2" type="float" value="4" />
  </power>
  <multiply name="glow_scale" type="float">
    <input name="in1" type="float" nodename="radiance" />
    <input name="in2" type="float" value="8" />
  </multiply>
  <multiply name="glow" type="color3">
    <input name="in1" type="color3" nodename="tint" />
    <input name="in2" type="float" nodename="glow_scale" />
  </multiply>
  <uniform_edf name="edf" type="EDF">
    <input name="color" type="color3" nodename="glow" />
  </uniform_edf>
` : ''}  <volume name="volume_shader" type="volumeshader">
    <input name="vdf" type="VDF" nodename="vdf" />
${temperature ? '    <input name="edf" type="EDF" nodename="edf" />\n' : ''}  </volume>
  <surfacematerial name="${name}" type="material">
    <input name="volumeshader" type="volumeshader" nodename="volume_shader" />
  </surfacematerial>
</materialx>
`;
}

/** Binds a default volume material to every Volume without one; returns the documents to load. */
export function applyDefaultVolumeMaterials(
  scene: SceneAsset, volumes: ReadonlyMap<string, SceneVolume>,
): { scene: SceneAsset; texts: Map<string, string> } {
  const texts = new Map<string, string>();
  const prims = new Map(scene.prims);
  const materials: MaterialXReference[] = [...scene.materials];
  for (const [path, volume] of volumes) {
    const prim = prims.get(path)!;
    if (boundMaterial(scene, prim)) continue;
    const materialPath = `${path}/__VolumeMaterial`;
    const assetPath = `usdvolume:${path}`;
    texts.set(assetPath, defaultVolumeMaterialXml('volume', volume.fields.has('temperature')));
    prims.set(path, { ...prim, materialBinding: { target: materialPath } });
    materials.push({ primPath: materialPath, assetPath, referencedPrimPath: '/volume', materialName: 'volume' });
  }
  return { scene: texts.size ? { ...scene, prims, materials } : scene, texts };
}
