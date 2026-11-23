import { InstancedMesh, Matrix3, Mesh, MeshBasicMaterial, SkinnedMesh, Vector3, type Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import type { Diagnostic, DiagnosticSink } from '../core/diagnostics.ts';
import type { SceneAsset } from '../scene/types.ts';
import type { MeshSource } from '../render/scene-resources.ts';
import type { RawMesh } from './prepare.ts';

export type GeometryReader = (uri: string) => Promise<ArrayBuffer>;

/** Resolves a USD asset path against the layer that authored it. */
export function resolveAsset(layer: string, asset: string): string {
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

async function parseGeometry(bytes: ArrayBuffer, uri: string, read: GeometryReader, sink: DiagnosticSink): Promise<{ root: Object3D; flipV: boolean }> {
  const extension = new URL(uri, 'http://scene.local/').pathname.split('.').at(-1)?.toLowerCase();
  if (extension === 'obj') {
    const text = new TextDecoder().decode(bytes);
    if (/^\s*(?:<!doctype\s+html\b|<html\b)/i.test(text)) {
      throw new Error(`Geometry asset returned HTML instead of OBJ (check for a missing file): ${uri}`);
    }
    const trianglesOnly = text.replace(/^[\t ]*[lp][\t ]+[^\r\n]*/gm, '');
    if (trianglesOnly !== text) {
      sink({ level: 'warning', message: `Ignoring OBJ line and point primitives for triangle geometry: ${uri}` });
    }
    return { root: new OBJLoader().parse(trianglesOnly), flipV: false };
  }
  if (extension === 'glb' || extension === 'gltf') {
    // Geometry only: do not fetch or decode glTF materials/textures. USD owns shading.
    const loader = new GLTFLoader();
    const material = new MeshBasicMaterial();
    loader.register(parser => {
      const loadBuffer = parser.loadBuffer.bind(parser);
      parser.loadBuffer = async index => {
        const json: unknown = parser.json;
        if (typeof json !== 'object' || json === null || !('buffers' in json) || !Array.isArray(json.buffers)) {
          throw new Error(`Missing glTF buffers: ${uri}`);
        }
        const buffer: unknown = json.buffers[index];
        if (typeof buffer !== 'object' || buffer === null) throw new Error(`Invalid glTF buffer ${index}: ${uri}`);
        if ('uri' in buffer && typeof buffer.uri === 'string' && !buffer.uri.startsWith('data:')) {
          return read(resolveAsset(uri, buffer.uri));
        }
        return loadBuffer(index);
      };
      return {
        name: 'EngineGeometryOnly',
        loadMaterial: () => Promise.resolve(material),
      };
    });
    return { root: (await loader.parseAsync(bytes, uri.slice(0, uri.lastIndexOf('/') + 1))).scene, flipV: true };
  }
  throw new Error(`Unsupported geometry format: ${uri} (expected .glb, .gltf or .obj)`);
}

export function extractMesh(root: Object3D, objectName: string | undefined, sink: DiagnosticSink, flipV: boolean): RawMesh {
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
        // glTF's top-left UV origin must become USD/MaterialX's bottom-left origin.
        uvs.push(u, flipV ? 1 - v : v);
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

/** Load one named mesh through the same geometry-only path used by USD assets. */
export async function loadExternalMesh(
  uri: string, objectName: string | undefined, sink: DiagnosticSink, read: GeometryReader = fetchGeometry,
): Promise<RawMesh> {
  const { root, flipV } = await parseGeometry(await read(uri), uri, read, sink);
  return extractMesh(root, objectName, sink, flipV);
}

/**
 * Engine geometry assets referenced by `engine:geometry:file`. Every file is fetched and
 * digested up front (so each prim gets a content key), but parsed only when a mesh is
 * actually needed: a prepared-geometry cache hit skips parsing. Inline USDA remains the
 * fallback. Without lazy, every mesh is parsed before returning (errors surface here).
 */
type Aabb = { min: [number, number, number]; max: [number, number, number] };

function pointBounds(points: ArrayLike<number>): Aabb | undefined {
  if (points.length < 3) return undefined;
  const min: Aabb['min'] = [Infinity, Infinity, Infinity], max: Aabb['max'] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i + 2 < points.length; i += 3) {
    for (let axis = 0; axis < 3; axis++) {
      const value = points[i + axis]!;
      if (value < min[axis]!) min[axis] = value;
      if (value > max[axis]!) max[axis] = value;
    }
  }
  return { min, max };
}

/**
 * Bounds of an OBJ file's vertices without parsing faces: per `o`/`g` section name and for
 * the whole file (key ''). Used only for streaming placeholders.
 */
export function scanObjBounds(bytes: ArrayBuffer): Map<string, Aabb> {
  const text = new TextDecoder().decode(bytes);
  const result = new Map<string, Aabb>();
  const grow = (key: string, x: number, y: number, z: number): void => {
    let box = result.get(key);
    if (!box) result.set(key, box = { min: [x, y, z], max: [x, y, z] });
    if (x < box.min[0]) box.min[0] = x; else if (x > box.max[0]) box.max[0] = x;
    if (y < box.min[1]) box.min[1] = y; else if (y > box.max[1]) box.max[1] = y;
    if (z < box.min[2]) box.min[2] = z; else if (z > box.max[2]) box.max[2] = z;
  };
  let section = '';
  for (const match of text.matchAll(/^(v|o|g)[ \t]+([^\r\n]*)/gm)) {
    if (match[1] !== 'v') { section = match[2]!.trim(); continue; }
    const [x, y, z] = match[2]!.trim().split(/\s+/).map(Number);
    if (![x, y, z].every(Number.isFinite)) continue;
    grow('', x!, y!, z!);
    if (section) grow(section, x!, y!, z!);
  }
  return result;
}

export async function loadExternalMeshSource(
  scene: SceneAsset,
  inline: MeshSource,
  sink: DiagnosticSink,
  read: GeometryReader = fetchGeometry,
  options: { lazy?: boolean } = {},
): Promise<MeshSource> {
  interface GeometryFile {
    bytes: Promise<ArrayBuffer>;
    parsed?: Promise<{ root: Object3D; flipV: boolean }>;
    diagnostics: Diagnostic[];
  }
  const files = new Map<string, GeometryFile>();
  const entries = new Map<string, { uri: string; objectName: string | undefined; diagnostics: Diagnostic[] }>();
  const meshes = new Map<string, RawMesh>();
  const fail = (path: string, cause: unknown): never => {
    const message = `Failed to load geometry for ${path}: ${String(cause)}`;
    sink({ level: 'error', message });
    throw new Error(message, { cause });
  };
  for (const [path, prim] of scene.prims) {
    const attribute = prim.attributes.get('engine:geometry:file');
    if (!attribute) continue;
    try {
      if (prim.typeName !== 'Mesh') throw new Error('engine:geometry:file requires a Mesh prim');
      if (typeof attribute.value !== 'string' || !attribute.value) throw new Error('Missing geometry asset path');
      const objectName = prim.attributes.get('engine:geometry:object')?.value;
      if (objectName !== undefined && (typeof objectName !== 'string' || !objectName)) throw new Error('Invalid geometry object name');
      const uri = resolveAsset(attribute.sourceLayer ?? scene.entry, attribute.value);
      if (!files.has(uri)) {
        const bytes = read(uri);
        bytes.catch(() => undefined);
        files.set(uri, { bytes, diagnostics: [] });
      }
      entries.set(path, { uri, objectName, diagnostics: [] });
    } catch (cause) {
      fail(path, cause);
    }
  }
  // Files download in parallel; each digest (the prepared-geometry cache key) is taken when its mesh is first needed.
  const subtle = globalThis.crypto?.subtle;
  const digests = new Map<GeometryFile, Promise<string | undefined>>();
  const digestOf = (path: string, file: GeometryFile): Promise<string | undefined> => {
    let digest = digests.get(file);
    if (!digest) {
      digest = file.bytes.then(async bytes => subtle
        ? Array.from(new Uint8Array(await subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('')
        : undefined, cause => fail(path, cause));
      digests.set(file, digest);
    }
    return digest;
  };
  const loadMesh = async (path: string): Promise<RawMesh | undefined> => {
    const entry = entries.get(path);
    if (!entry) return inline.meshFor(path);
    const loaded = meshes.get(path);
    if (loaded) return loaded;
    const file = files.get(entry.uri)!;
    try {
      file.parsed ??= file.bytes.then(bytes => parseGeometry(bytes, entry.uri, read, diagnostic => {
        file.diagnostics.push(diagnostic);
        sink(diagnostic);
      }));
      const { root, flipV } = await file.parsed;
      const mesh = extractMesh(root, entry.objectName, diagnostic => {
        entry.diagnostics.push(diagnostic);
        sink(diagnostic);
      }, flipV);
      meshes.set(path, mesh);
      return mesh;
    } catch (cause) {
      return fail(path, cause);
    }
  };
  if (!options.lazy) for (const path of entries.keys()) await loadMesh(path);
  const objBounds = new Map<GeometryFile, Promise<Map<string, Aabb>>>();
  return {
    quickBounds: async (path) => {
      const entry = entries.get(path);
      if (!entry) {
        const mesh = inline.meshFor(path);
        return mesh ? pointBounds(mesh.points) : undefined;
      }
      if (!/\.obj(?:[?#]|$)/i.test(entry.uri)) return undefined;
      const file = files.get(entry.uri)!;
      let bounds = objBounds.get(file);
      if (!bounds) objBounds.set(file, bounds = file.bytes.then(scanObjBounds));
      return (await bounds).get(entry.objectName ?? '');
    },
    meshFor: (path) => meshes.get(path) ?? (entries.has(path) ? undefined : inline.meshFor(path)),
    loadMesh,
    contentKey: async (path) => {
      const entry = entries.get(path);
      if (!entry) return undefined;
      const digest = await digestOf(path, files.get(entry.uri)!);
      return digest === undefined ? undefined : `engine-geometry:${digest}:${entry.objectName ?? ''}`;
    },
    diagnosticsFor: (path) => {
      const entry = entries.get(path);
      return entry ? [...files.get(entry.uri)!.diagnostics, ...entry.diagnostics] : [];
    },
  };
}
