import { LoadingManager, Mesh, MeshBasicMaterial, MeshStandardMaterial, MeshPhysicalMaterial, SkinnedMesh, InstancedMesh, PerspectiveCamera, OrthographicCamera, Light, Texture, type Material } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { extractMesh } from '../geometry/external-mesh.ts';
import type { RawMesh } from '../geometry/prepare.ts';
import type { SceneLoadOptions } from '../render/usd-scene-assets.ts';
import type { ScenePrim, SceneAsset } from './types.ts';
import { gltfMaterialToMaterialX } from './gltf-materialx.ts';

export interface LocalGltfScene {
  entry: string;
  name: string;
  options: SceneLoadOptions;
  warnings: readonly string[];
  materialTexts: ReadonlyMap<string, string>;
  dispose(): void;
}

/** Match local resources by relative path; never fetch missing dependencies remotely. */
export function resolveLocalGltfFile(files: readonly File[], uri: string, entry: File): File {
  const pathOf = (file: File): string => (file.webkitRelativePath || file.name).replaceAll('\\', '/');
  const entryPath = pathOf(entry);
  const normalized = decodeURIComponent(new URL(uri, `https://local.invalid/${entryPath}`).pathname).slice(1);
  if (/^[a-z][a-z0-9+.-]*:/i.test(uri) && !uri.startsWith('https://local.invalid/')) {
    throw new Error(`External glTF resource is not allowed in a local import: ${uri}`);
  }
  const exact = files.filter(file => pathOf(file) === normalized);
  if (exact.length === 1) return exact[0]!;
  const basename = normalized.split('/').at(-1);
  const matches = files.filter(file => file.name === basename);
  if (matches.length !== 1) throw new Error(`Missing or ambiguous glTF resource: ${uri}. Select its .bin and texture files, or select the containing folder.`);
  return matches[0]!;
}

const prim = (path: string, typeName: string): ScenePrim => ({
  path, name: path.split('/').at(-1)!, typeName, specifier: 'def',
  apiSchemas: [], inherits: [], references: [], payloads: [],
  attributes: new Map(), relationships: new Map(), xformOps: [], children: [],
});

export async function importLocalGltf(files: readonly File[], entryFile?: File): Promise<LocalGltfScene> {
  const entries = files.filter(file => /\.(glb|gltf)$/i.test(file.name));
  const entry = entryFile ?? (entries.length === 1 ? entries[0] : undefined);
  if (!entry || !files.includes(entry)) throw new Error('Select exactly one .glb or .gltf scene and its resources.');
  const urls: string[] = [];
  const warnings = new Set<string>();
  const warn = (message: string): void => { warnings.add(message); };
  const blobUrl = (blob: Blob): string => {
    const url = URL.createObjectURL(blob);
    urls.push(url);
    return url;
  };
  const dispose = (): void => { for (const url of urls) URL.revokeObjectURL(url); urls.length = 0; };
  const resources = new Map<File, string>();
  let resourceError: Error | undefined;
  const manager = new LoadingManager();
  manager.onError = uri => { resourceError = new Error(`Failed to load glTF resource: ${uri}`); };
  manager.setURLModifier(uri => {
    // GLTFLoader creates its own blob URLs for embedded GLB images.
    if (uri.startsWith('data:') || uri.startsWith('blob:')) return uri;
    let file: File;
    try { file = resolveLocalGltfFile(files, uri, entry); }
    catch (error) {
      resourceError = error instanceof Error ? error : new Error(String(error));
      throw error;
    }
    let url = resources.get(file);
    if (!url) { url = blobUrl(file); resources.set(file, url); }
    return url;
  });
  let gltf: Awaited<ReturnType<GLTFLoader['parseAsync']>> | undefined;
  try {
    gltf = await new GLTFLoader(manager).parseAsync(await entry.arrayBuffer(), '');
    if (resourceError) throw resourceError;
    const root = gltf.scene;
    root.updateMatrixWorld(true);
    if (gltf.animations.length) warn('Animations are not played; the scene uses its initial static pose.');
    warn('glTF PBR is converted to Disney Principled; BRDF and transmission behavior are not an exact glTF reference.');
    const json: unknown = gltf.parser.json;
    if (typeof json === 'object' && json !== null && 'extensionsUsed' in json && Array.isArray(json.extensionsUsed)) {
      const supported = new Set(['KHR_materials_clearcoat', 'KHR_materials_transmission', 'KHR_materials_ior', 'KHR_texture_transform']);
      for (const extension of json.extensionsUsed) {
        if (typeof extension === 'string' && !supported.has(extension)) warn(`${extension}: support may be partial or absent in the Disney conversion.`);
      }
    }
    const textureCache = new Map<Texture, Map<number, Promise<string>>>();
    const exportTexture = (texture: Texture, channel?: number): Promise<string> => {
      let channels = textureCache.get(texture);
      if (!channels) { channels = new Map(); textureCache.set(texture, channels); }
      const key = channel ?? -1;
      let result = channels.get(key);
      if (!result) {
        result = (async () => {
          const image: unknown = texture.image;
          if (!(image instanceof ImageBitmap) && !(image instanceof HTMLImageElement) && !(image instanceof HTMLCanvasElement)) {
            throw new Error(`Unsupported decoded glTF texture: ${texture.name}`);
          }
          const canvas = document.createElement('canvas');
          canvas.width = image.width; canvas.height = image.height;
          const ctx = canvas.getContext('2d');
          if (!ctx) throw new Error('Cannot decode glTF textures: no 2D canvas context.');
          ctx.drawImage(image, 0, 0);
          if (channel !== undefined) {
            const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
            for (let i = 0; i < pixels.data.length; i += 4) {
              const value = pixels.data[i + channel]!;
              pixels.data[i] = value; pixels.data[i + 1] = value; pixels.data[i + 2] = value; pixels.data[i + 3] = 255;
            }
            ctx.putImageData(pixels, 0, 0);
          }
          const blob = await new Promise<Blob>((done, reject) => canvas.toBlob(blob => blob ? done(blob) : reject(new Error('Failed to encode glTF texture.')), 'image/png'));
          return blobUrl(blob);
        })();
        channels.set(key, result);
      }
      return result;
    };
    const entryUri = new URL(`./__local_gltf__/${crypto.randomUUID()}/scene.usda`, document.baseURI).href;
    const materialTexts = new Map<string, string>();
    const materialPaths = new Map<Material, string>();
    const scene: SceneAsset = {
      entry: entryUri, stage: { defaultPrim: 'World', upAxis: 'Y', metersPerUnit: 1, subLayers: [] },
      prims: new Map(), roots: ['/World'], materials: [],
    };
    const prims = new Map<string, ScenePrim>();
    const meshes = new Map<string, RawMesh>();
    const materials: SceneAsset['materials'][number][] = [];
    const world = prim('/World', 'Xform');
    prims.set('/', { ...prim('/', 'Scope'), children: ['/World'] });
    prims.set('/World', world);
    const meshNodes: Mesh[] = [];
    root.traverse(node => {
      if (node instanceof Mesh) meshNodes.push(node);
      else if (node instanceof PerspectiveCamera || node instanceof OrthographicCamera) warn(`Camera ${node.name || node.type}: the viewer uses automatic framing instead of the glTF camera.`);
      else if (node instanceof Light) warn(`Light ${node.name || node.type}: glTF punctual lights are not imported; the viewer uses its default environment.`);
    });
    for (const node of meshNodes) {
      if (node instanceof SkinnedMesh || node instanceof InstancedMesh || node.geometry.morphAttributes.position?.length) {
        throw new Error(`Skinned, morphed or GPU-instanced meshes are not supported: ${node.name}`);
      }
      if (node.geometry.hasAttribute('color')) warn(`${node.name}: vertex colors are not applied to the Disney material.`);
      if (!node.visible) continue;
      const nodeMaterials = Array.isArray(node.material) ? node.material : [node.material];
      const groups = Array.isArray(node.material) ? node.geometry.groups : [{ start: 0, count: node.geometry.index?.count ?? node.geometry.getAttribute('position').count, materialIndex: 0 }];
      if (!groups.length) throw new Error(`Missing material groups: ${node.name}`);
      for (const group of groups) {
        if (!group.count) continue;
        let material = nodeMaterials[group.materialIndex ?? 0];
        if (!material) throw new Error(`Missing material for mesh ${node.name}`);
        if (material instanceof MeshBasicMaterial) {
          warn(`${node.name}: unlit material is approximated by a lit Disney material.`);
          const lit = new MeshStandardMaterial({ color: material.color, map: material.map, transparent: material.transparent, opacity: material.opacity, alphaTest: material.alphaTest });
          lit.name = material.name; material = lit;
        }
        let materialPath = materialPaths.get(material);
        if (!materialPath) {
          const name = `material_${materialPaths.size}_${material.name.replace(/[^A-Za-z0-9_]/g, '_') || 'default'}`;
          materialPath = `/World/Looks/${name}`;
          const assetPath = new URL(`${name}.mtlx`, entryUri).href;
          materialTexts.set(assetPath, await gltfMaterialToMaterialX(material, name, exportTexture, warn));
          materialPaths.set(material, materialPath);
          prims.set(materialPath, prim(materialPath, 'Material'));
          materials.push({ primPath: materialPath, assetPath, referencedPrimPath: `/MaterialX/Materials/${name}`, materialName: name });
        }
        const path = `/World/Mesh_${meshes.size}_${node.name.replace(/[^A-Za-z0-9_]/g, '_') || 'unnamed'}`;
        const geometry = node.geometry.clone();
        const index = node.geometry.index;
        geometry.setIndex(Array.from({ length: group.count }, (_, i) => index ? index.getX(group.start + i) : group.start + i));
        const mesh = new Mesh(geometry, material);
        mesh.matrix.copy(node.matrixWorld);
        mesh.matrixAutoUpdate = false;
        try {
          meshes.set(path, extractMesh(mesh, undefined, diagnostic => warn(diagnostic.message), true));
        } finally { geometry.dispose(); }
        prims.set(path, { ...prim(path, 'Mesh'), materialBinding: { target: materialPath },
          mesh: { subdivisionScheme: 'none', primvars: [{ name: 'st', typeName: 'texCoord2f[]', interpolation: 'vertex' }] } });
        if (!node.geometry.hasAttribute('uv') && material instanceof MeshStandardMaterial &&
          (material.map || material.metalnessMap || material.roughnessMap)) {
          warn(`${node.name}: textured material has no UV0; textures use the engine's default UV.`);
        }
      }
    }
    if (!meshes.size) throw new Error('No supported triangle meshes found in the glTF scene.');
    prims.set('/World/Looks', { ...prim('/World/Looks', 'Scope'), children: [...materialPaths.values()] });
    prims.set('/World', { ...world, children: ['/World/Looks', ...meshes.keys()] });
    const imported = { scene: { ...scene, prims, materials }, meshSource: { meshFor: (path: string) => meshes.get(path) }, materialTexts };
    return { entry: entryUri, name: entry.name, options: { imported }, warnings: [...warnings], materialTexts, dispose };
  } catch (error) {
    dispose();
    throw error;
  } finally {
    const images = new Set<ImageBitmap>();
    gltf?.scene.traverse(node => {
      if (!(node instanceof Mesh)) return;
      node.geometry.dispose();
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
        if (material instanceof MeshStandardMaterial || material instanceof MeshPhysicalMaterial || material instanceof MeshBasicMaterial) {
          for (const value of Object.values(material)) if (value instanceof Texture) {
            const image: unknown = value.image;
            if (image instanceof ImageBitmap) images.add(image);
            value.dispose();
          }
        }
        material.dispose();
      }
    });
    for (const image of images) image.close();
  }
}
