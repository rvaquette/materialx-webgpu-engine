import { InstancedMesh, Matrix3, Mesh, MeshBasicMaterial, SkinnedMesh, Vector3, type Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import type { DiagnosticSink } from '../core/diagnostics.ts';
import type { SceneAsset } from '../scene/types.ts';
import type { MeshSource } from '../render/scene-resources.ts';
import type { RawMesh } from './prepare.ts';

export type GeometryReader = (uri: string) => Promise<ArrayBuffer>;

function resolveAsset(layer: string, asset: string): string {
  if (/^[a-z]+:\/\//i.test(layer)) return new URL(asset, layer).href;
  if (/^[a-z]+:\/\//i.test(asset)) return asset;
  const base = new URL(layer, 'http://scene.local/');
  const resolved = new URL(asset, base);
  return layer.startsWith('/') || asset.startsWith('/') ? resolved.pathname : resolved.pathname.slice(1);
}

async function fetchGeometry(uri: string): Promise<ArrayBuffer> {
  const response = await fetch(uri);
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${uri}`);
  return response.arrayBuffer();
}

async function parseGeometry(bytes: ArrayBuffer, uri: string): Promise<Object3D> {
  const extension = new URL(uri, 'http://scene.local/').pathname.split('.').at(-1)?.toLowerCase();
  if (extension === 'obj') return new OBJLoader().parse(new TextDecoder().decode(bytes));
  if (extension === 'glb') {
    // Geometry only: do not fetch or decode glTF materials/textures. USD owns shading.
    const loader = new GLTFLoader();
    const material = new MeshBasicMaterial();
    loader.register(() => ({
      name: 'EngineGeometryOnly',
      loadMaterial: () => Promise.resolve(material),
    }));
    return (await loader.parseAsync(bytes, uri.slice(0, uri.lastIndexOf('/') + 1))).scene;
  }
  throw new Error(`Unsupported geometry format: ${uri} (expected .glb or .obj)`);
}

function extractMesh(root: Object3D, objectName: string | undefined, sink: DiagnosticSink): RawMesh {
  root.updateMatrixWorld(true);
  let selected = root;
  if (objectName) {
    const matches: Object3D[] = [];
    root.traverse((node) => { if (node.name === objectName) matches.push(node); });
    if (matches.length !== 1) throw new Error(`Expected one object named '${objectName}', found ${matches.length}`);
    selected = matches[0]!;
  }
  const meshes: Mesh[] = [];
  selected.traverse((node) => {
    if (node instanceof Mesh) {
      if (node instanceof SkinnedMesh || node.geometry.morphAttributes.position?.length) {
        throw new Error(`Animated geometry is not supported: ${node.name}`);
      }
      if (node instanceof InstancedMesh) throw new Error(`glTF GPU instancing is not supported: ${node.name}`);
      meshes.push(node);
    }
  });
  if (meshes.length === 0) throw new Error(`No triangle mesh found${objectName ? ` in '${objectName}'` : ''}`);
  const points: number[] = [], normals: number[] = [], uvs: number[] = [];
  const faceVertexCounts: number[] = [], faceVertexIndices: number[] = [];
  const hasUvs = meshes.every((mesh) => mesh.geometry.hasAttribute('uv'));
  if (!hasUvs && meshes.some((mesh) => mesh.geometry.hasAttribute('uv'))) {
    sink({ level: 'warning', message: `Mixed UV availability in '${objectName ?? root.name}'; select individual objects to preserve UVs` });
  }
  const vector = new Vector3();
  for (const mesh of meshes) {
    const geometry = mesh.geometry.hasAttribute('normal') ? mesh.geometry : mesh.geometry.clone();
    if (!geometry.hasAttribute('normal')) geometry.computeVertexNormals();
    const position = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal');
    const uv = geometry.getAttribute('uv');
    if (!position || position.itemSize !== 3) throw new Error(`Missing 3D positions: ${mesh.name}`);
    if (normal.count !== position.count || normal.itemSize !== 3) throw new Error(`Invalid normals: ${mesh.name}`);
    if (hasUvs && (uv.count !== position.count || uv.itemSize !== 2)) throw new Error(`Invalid UVs: ${mesh.name}`);
    const offset = points.length / 3;
    const normalMatrix = new Matrix3().getNormalMatrix(mesh.matrixWorld);
    for (let i = 0; i < position.count; i++) {
      vector.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
      if (![vector.x, vector.y, vector.z].every(Number.isFinite)) throw new Error(`Invalid position in ${mesh.name}`);
      points.push(vector.x, vector.y, vector.z);
      vector.fromBufferAttribute(normal, i).applyNormalMatrix(normalMatrix);
      if (![vector.x, vector.y, vector.z].every(Number.isFinite)) throw new Error(`Invalid normal in ${mesh.name}`);
      normals.push(vector.x, vector.y, vector.z);
      if (hasUvs) {
        const u = uv.getX(i), v = uv.getY(i);
        if (!Number.isFinite(u) || !Number.isFinite(v)) throw new Error(`Invalid UV in ${mesh.name}`);
        uvs.push(u, v);
      }
    }
    const count = geometry.index?.count ?? position.count;
    if (count === 0 || count % 3 !== 0) throw new Error(`Invalid triangle count: ${mesh.name}`);
    const mirrored = mesh.matrixWorld.determinant() < 0;
    for (let i = 0; i < count; i += 3) {
      const tri = [0, mirrored ? 2 : 1, mirrored ? 1 : 2].map((corner) => geometry.index?.getX(i + corner) ?? i + corner);
      if (tri.some((index) => !Number.isInteger(index) || index < 0 || index >= position.count)) {
        throw new Error(`Out-of-range triangle index: ${mesh.name}`);
      }
      faceVertexCounts.push(3);
      faceVertexIndices.push(...tri.map((index) => index + offset));
    }
  }
  return {
    points, faceVertexCounts, faceVertexIndices,
    normals: { name: 'normals', interpolation: 'vertex', elementSize: 3, values: normals },
    ...(hasUvs ? { primvars: [{ name: 'st', interpolation: 'vertex', elementSize: 2, values: uvs }] } : {}),
  };
}

/** Preload engine geometry assets once per URI; inline USDA remains the fallback. */
export async function loadExternalMeshSource(
  scene: SceneAsset,
  inline: MeshSource,
  sink: DiagnosticSink,
  read: GeometryReader = fetchGeometry,
): Promise<MeshSource> {
  const files = new Map<string, Promise<Object3D>>();
  const meshes = new Map<string, RawMesh>();
  for (const [path, prim] of scene.prims) {
    const attribute = prim.attributes.get('engine:geometry:file');
    if (!attribute) continue;
    try {
      if (prim.typeName !== 'Mesh') throw new Error('engine:geometry:file requires a Mesh prim');
      if (typeof attribute.value !== 'string' || !attribute.value) throw new Error('Missing geometry asset path');
      const objectName = prim.attributes.get('engine:geometry:object')?.value;
      if (objectName !== undefined && (typeof objectName !== 'string' || !objectName)) throw new Error('Invalid geometry object name');
      const uri = resolveAsset(attribute.sourceLayer ?? scene.entry, attribute.value);
      let file = files.get(uri);
      if (!file) {
        file = read(uri).then((bytes) => parseGeometry(bytes, uri));
        files.set(uri, file);
      }
      meshes.set(path, extractMesh(await file, objectName, sink));
    } catch (cause) {
      const message = `Failed to load geometry for ${path}: ${String(cause)}`;
      sink({ level: 'error', message });
      throw new Error(message, { cause });
    }
  }
  return { meshFor: (path) => meshes.get(path) ?? inline.meshFor(path) };
}
