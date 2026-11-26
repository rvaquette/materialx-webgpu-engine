import type { MaterialCatalogEntry } from '../scene/material-catalog.ts';

const AMBIENT_API = 'https://ambientcg.com/api/v3/assets?type=material&sort=alphabet&include=downloads%2Ctitle%2Ctype&limit=500&offset=0';
const PHYSICALLY_BASED_API = 'https://raw.githubusercontent.com/AntonPalmqvist/physically-based-api/main/deploy/v2/materials.json';
const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
const MAX_UNPACKED_BYTES = 128 * 1024 * 1024;
const MAX_ARCHIVE_FILES = 1000;

interface PackageFile {
  path: string;
  bytes: Uint8Array;
}

interface AmbientAsset {
  id: string;
  title: string;
  type: string;
  downloads?: { url?: string; attributes?: string; extension?: string }[];
}

interface PhysicallyBasedMaterial {
  name: string;
  color?: { colorSpace?: string; color?: number[] }[];
  metalness?: number;
  roughness?: number;
  specularColor?: { format?: string[]; color?: { colorSpace?: string; color?: number[] }[] }[];
  complexIor?: { colorSpace?: string; n?: number[] }[];
  category?: string[];
  images?: { format?: string; '300'?: string; '600'?: string }[];
}

let ambientCatalog: Promise<MaterialCatalogEntry[]> | undefined;
let physicallyBasedMaterials: Promise<PhysicallyBasedMaterial[]> | undefined;
const resolvedExternal = new Map<string, MaterialCatalogEntry>();
const objectUrls = new Set<string>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function responseJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} depuis ${new URL(url).hostname}.`);
  const text = new TextDecoder().decode(await readResponseBytes(response, 32 * 1024 * 1024));
  try { return JSON.parse(text) as unknown; }
  catch { throw new Error('La réponse de la bibliothèque n’est pas un JSON valide.'); }
}

async function readResponseBytes(response: Response, limit: number): Promise<Uint8Array> {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > limit) {
    await response.body?.cancel();
    throw new Error(`Téléchargement supérieur à ${Math.round(limit / (1024 * 1024))} Mio.`);
  }
  if (!response.body) throw new Error('Réponse distante vide.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value.byteLength > limit - size) {
        await reader.cancel();
        throw new Error(`Téléchargement supérieur à ${Math.round(limit / (1024 * 1024))} Mio.`);
      }
      size += value.byteLength;
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function imageUrl(images: PhysicallyBasedMaterial['images']): string | undefined {
  return images?.find(image => image.format === 'jpeg')?.['300'] ?? images?.[0]?.['300'];
}

async function loadAmbientCatalog(): Promise<MaterialCatalogEntry[]> {
  ambientCatalog ??= (async () => {
    const assets: AmbientAsset[] = [];
    const visited = new Set<string>();
    let next: string | null = AMBIENT_API;
    while (next) {
      const url = new URL(next);
      if (url.protocol !== 'https:' || url.hostname !== 'ambientcg.com' || visited.has(url.href)) {
        throw new Error('Pagination AmbientCG invalide.');
      }
      visited.add(url.href);
      const data = await responseJson(url.href);
      if (!isRecord(data) || !Array.isArray(data.assets)) throw new Error('Réponse AmbientCG invalide.');
      for (const raw of data.assets) {
        if (isRecord(raw) && typeof raw.id === 'string' && typeof raw.title === 'string' && raw.type === 'material') {
          assets.push(raw as unknown as AmbientAsset);
        }
      }
      next = typeof data.nextPageHttp === 'string' ? data.nextPageHttp : null;
      if (assets.length > 5000) throw new Error('Le catalogue AmbientCG dépasse la limite de 5 000 matériaux.');
    }
    return assets.map(asset => {
      const downloads = asset.downloads ?? [];
      const download = downloads.find(file => file.attributes === '1K-JPG' && file.extension === 'zip')
        ?? downloads.find(file => file.attributes === '1K-PNG' && file.extension === 'zip');
      return {
        path: `ambientcg:${encodeURIComponent(asset.id)}`,
        group: 'AmbientCG',
        label: asset.title,
        source: 'AmbientCG',
        provider: 'ambientcg' as const,
        remoteId: asset.id,
        preview: `https://acg-media.struffelproductions.com/file/ambientCG-Web/media/thumbnail/256-PNG/${encodeURIComponent(asset.id)}.png`,
        ...(download?.url ? { downloadUrl: download.url } : {}),
      };
    });
  })().catch((error: unknown) => {
    ambientCatalog = undefined;
    throw error;
  });
  return ambientCatalog;
}

async function loadPhysicallyBasedData(): Promise<PhysicallyBasedMaterial[]> {
  physicallyBasedMaterials ??= responseJson(PHYSICALLY_BASED_API).then((value) => {
    if (!isRecord(value) || !Array.isArray(value.data)) throw new Error('Réponse PhysicallyBased invalide.');
    return value.data.filter((item): item is PhysicallyBasedMaterial =>
      isRecord(item) && typeof item.name === 'string');
  }).catch((error: unknown) => {
    physicallyBasedMaterials = undefined;
    throw error;
  });
  return physicallyBasedMaterials;
}

export async function loadExternalMaterialCatalog(provider: 'ambientcg' | 'physicallybased'): Promise<MaterialCatalogEntry[]> {
  if (provider === 'ambientcg') return loadAmbientCatalog();
  const materials = await loadPhysicallyBasedData();
  return materials.map(material => ({
    path: `physicallybased:${encodeURIComponent(material.name)}`,
    group: material.category?.[0] ?? 'Physically Based',
    label: material.name,
    source: 'Physically Based',
    provider: 'physicallybased',
    remoteId: material.name,
    ...(imageUrl(material.images) ? { preview: imageUrl(material.images)! } : {}),
  }));
}

function normalizeArchivePath(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  if (!normalized || normalized.startsWith('/') || /^[a-z]:/i.test(normalized) || normalized.includes('\0')) {
    throw new Error(`Chemin de fichier invalide dans l’archive : ${path}.`);
  }
  const parts: string[] = [];
  for (const part of normalized.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!parts.length) throw new Error(`Chemin hors de l’archive : ${path}.`);
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  if (!parts.length) throw new Error(`Chemin de fichier vide dans l’archive : ${path}.`);
  return parts.join('/');
}

function validateZip(bytes: Uint8Array): void {
  if (bytes.length > MAX_ARCHIVE_BYTES) throw new Error('Archive ZIP supérieure à 64 Mio.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const min = Math.max(0, bytes.length - 65_557);
  let eocd = -1;
  for (let offset = bytes.length - 22; offset >= min; offset--) {
    if (view.getUint32(offset, true) === 0x06054b50) { eocd = offset; break; }
  }
  if (eocd < 0) throw new Error('Archive ZIP invalide : répertoire central absent.');
  const disk = view.getUint16(eocd + 4, true);
  const directoryDisk = view.getUint16(eocd + 6, true);
  const diskEntries = view.getUint16(eocd + 8, true);
  const entries = view.getUint16(eocd + 10, true);
  const directorySize = view.getUint32(eocd + 12, true);
  const directoryOffset = view.getUint32(eocd + 16, true);
  if (disk || directoryDisk || diskEntries !== entries || entries === 0xffff ||
      directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
    throw new Error('Archive ZIP multi-disque ou ZIP64 non pris en charge.');
  }
  if (entries > MAX_ARCHIVE_FILES || directoryOffset + directorySize > eocd) {
    throw new Error('Archive ZIP invalide ou contenant trop de fichiers.');
  }
  let offset = directoryOffset;
  let total = 0;
  const decoder = new TextDecoder();
  for (let i = 0; i < entries; i++) {
    if (offset + 46 > eocd || view.getUint32(offset, true) !== 0x02014b50) {
      throw new Error('Archive ZIP invalide : entrée de répertoire incorrecte.');
    }
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const compressed = view.getUint32(offset + 20, true);
    const uncompressed = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const end = offset + 46 + nameLength + extraLength + commentLength;
    if (end > eocd || flags & 1 || (method !== 0 && method !== 8) ||
        compressed === 0xffffffff || uncompressed === 0xffffffff) {
      throw new Error('Archive ZIP chiffrée, ZIP64 ou avec une compression non prise en charge.');
    }
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    if (name && !name.endsWith('/')) normalizeArchivePath(name);
    total += uncompressed;
    if (total > MAX_UNPACKED_BYTES) throw new Error('Contenu décompressé supérieur à 128 Mio.');
    offset = end;
  }
}

function mimeType(path: string): string {
  const extension = path.split('.').at(-1)?.toLowerCase();
  return extension === 'png' ? 'image/png'
    : extension === 'jpg' || extension === 'jpeg' ? 'image/jpeg'
      : extension === 'tif' || extension === 'tiff' ? 'image/tiff'
        : extension === 'exr' ? 'image/x-exr'
          : extension === 'webp' ? 'image/webp' : 'application/octet-stream';
}

function addObjectUrl(blob: Blob): string {
  const url = URL.createObjectURL(blob);
  objectUrls.add(url);
  return url;
}

function packagePathForReference(documentPath: string, fileprefix: string, value: string): string {
  const prefix = fileprefix.replace(/\\/g, '/');
  const relative = value.replace(/\\/g, '/');
  const base = documentPath.split('/').slice(0, -1);
  if (prefix.startsWith('/') || /^[a-z]:/i.test(prefix) || relative.startsWith('/') || /^[a-z]:/i.test(relative)) {
    throw new Error(`Chemin absolu de texture non pris en charge : ${value}.`);
  }
  return normalizeArchivePath([...base, prefix, relative].filter(Boolean).join('/'));
}

function materialXmlBlob(path: string, xml: string, files: ReadonlyMap<string, PackageFile>): string {
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  if (document.querySelector('parsererror')) throw new Error(`${path} : document MaterialX XML invalide.`);
  const root = document.documentElement;
  if (root.tagName !== 'materialx') throw new Error(`${path} : le document racine n’est pas <materialx>.`);
  const inputs = [...document.querySelectorAll('input[type="filename"], input[name="file"]')];
  for (const input of inputs) {
    const value = input.getAttribute('value');
    if (!value || /^(?:https?:|blob:|data:)/i.test(value)) continue;
    const fileprefix = input.parentElement?.getAttribute('fileprefix') ?? root.getAttribute('fileprefix') ?? '';
    const resolved = packagePathForReference(path, fileprefix, value);
    let file = files.get(resolved.toLowerCase());
    if (!file) {
      const suffix = `/${resolved.toLowerCase()}`;
      const matches = [...files.values()].filter(candidate => candidate.path.toLowerCase().endsWith(suffix));
      if (matches.length === 1) file = matches[0];
    }
    if (!file) throw new Error(`Texture absente du paquet MaterialX : ${value}.`);
    input.setAttribute('value', addObjectUrl(new Blob([file.bytes], { type: mimeType(file.path) })));
  }
  for (const element of [...document.querySelectorAll('[fileprefix]')]) element.removeAttribute('fileprefix');
  const serialized = new XMLSerializer().serializeToString(document);
  return addObjectUrl(new Blob([serialized], { type: 'application/xml' }));
}

function findMaterialDocument(files: readonly PackageFile[]): PackageFile {
  const candidates = files.filter(file => file.path.toLowerCase().endsWith('.mtlx')).sort((a, b) => a.path.localeCompare(b.path));
  const material = candidates.find(file => /<surfacematerial\b/i.test(new TextDecoder().decode(file.bytes)));
  if (!material) throw new Error('Aucun document .mtlx contenant un surfacematerial dans le paquet.');
  return material;
}

async function unpackArchive(blob: Blob): Promise<PackageFile[]> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  validateZip(bytes);
  const { unzipSync } = await import('three/addons/libs/fflate.module.js');
  const entries = unzipSync(bytes);
  let total = 0;
  const files: PackageFile[] = [];
  for (const [path, content] of Object.entries(entries)) {
    if (path.endsWith('/')) continue;
    const safePath = normalizeArchivePath(path);
    total += content.byteLength;
    if (total > MAX_UNPACKED_BYTES) throw new Error('Contenu décompressé supérieur à 128 Mio.');
    files.push({ path: safePath, bytes: content });
  }
  return files;
}

function fromPackage(label: string, group: string, source: string, files: readonly PackageFile[]): MaterialCatalogEntry {
  const document = findMaterialDocument(files);
  const index = new Map(files.map(file => [file.path.toLowerCase(), file]));
  const path = materialXmlBlob(document.path, new TextDecoder().decode(document.bytes), index);
  return { path, label, group, source };
}

export async function importMaterialFiles(selected: readonly File[]): Promise<MaterialCatalogEntry> {
  if (!selected.length) throw new Error('Aucun fichier sélectionné.');
  const zip = selected.find(file => file.name.toLowerCase().endsWith('.zip'));
  if (zip) {
    const files = await unpackArchive(zip);
    return fromPackage(zip.name.replace(/\.zip$/i, ''), 'Importés', 'Archive MaterialX', files);
  }
  const packageFiles = selected.map(file => ({ path: normalizeArchivePath(file.webkitRelativePath || file.name), file }));
  const materialFile = packageFiles.find(entry => entry.file.name.toLowerCase().endsWith('.mtlx'));
  if (!materialFile) throw new Error('Sélectionne un document .mtlx ou une archive ZIP.');
  const files = await Promise.all(packageFiles.map(async entry => ({
    path: entry.path, bytes: new Uint8Array(await entry.file.arrayBuffer()),
  })));
  return fromPackage(materialFile.file.name.replace(/\.mtlx$/i, ''), 'Importés', 'Document MaterialX', files);
}

function number(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function colorValue(value: unknown, fallback: readonly number[]): string {
  if (!Array.isArray(value) || value.length < 3 || !value.slice(0, 3).every(component =>
    typeof component === 'number' && Number.isFinite(component))) return fallback.join(', ');
  return value.slice(0, 3).join(', ');
}

function physicallyBasedXml(material: PhysicallyBasedMaterial): string {
  const linearColor = material.color?.find(color => color.colorSpace === 'srgb-linear')?.color ?? material.color?.[0]?.color;
  const specular = material.specularColor?.find(entry => entry.format?.includes('F82'))?.color
    ?.find(color => color.colorSpace === 'srgb-linear')?.color;
  const eta = material.complexIor?.find(value => value.colorSpace === 'srgb-linear')?.n;
  const ior = eta?.length ? eta.reduce((sum, component) => sum + component, 0) / eta.length : 1.5;
  return `<?xml version="1.0"?>
<materialx version="1.39">
  <standard_surface name="surface" type="surfaceshader">
    <input name="base_color" type="color3" value="${colorValue(linearColor, [0.18, 0.18, 0.18])}"/>
    <input name="metalness" type="float" value="${number(material.metalness, 0)}"/>
    <input name="specular_roughness" type="float" value="${number(material.roughness, 0.5)}"/>
    <input name="specular_IOR" type="float" value="${Number.isFinite(ior) ? ior : 1.5}"/>
    ${specular ? `<input name="specular_color" type="color3" value="${colorValue(specular, [1, 1, 1])}"/>` : ''}
  </standard_surface>
  <surfacematerial name="material" type="material">
    <input name="surfaceshader" type="surfaceshader" nodename="surface"/>
  </surfacematerial>
</materialx>`;
}

async function physicallyBasedEntry(entry: MaterialCatalogEntry): Promise<MaterialCatalogEntry> {
  const material = (await loadPhysicallyBasedData()).find(candidate => candidate.name === entry.remoteId);
  if (!material) throw new Error(`Matériau PhysicallyBased introuvable : ${entry.label}.`);
  return { ...entry, path: addObjectUrl(new Blob([physicallyBasedXml(material)], { type: 'application/xml' })) };
}

function textureFile(files: readonly PackageFile[], expression: RegExp): PackageFile | undefined {
  return files.find(file => expression.test(file.path.split('/').at(-1) ?? ''));
}

function ambientMaterialXml(files: readonly PackageFile[]): string {
  const color = textureFile(files, /_Color\.(?:jpg|jpeg|png)$/i);
  const roughness = textureFile(files, /_Roughness\.(?:jpg|jpeg|png)$/i);
  const normalGl = textureFile(files, /_NormalGL\.(?:jpg|jpeg|png)$/i);
  const normalDx = textureFile(files, /_NormalDX\.(?:jpg|jpeg|png)$/i);
  const normal = normalGl ?? normalDx;
  if (!color) throw new Error('L’archive AmbientCG ne contient pas de texture Color.');
  const image = (name: string, type: string, file: PackageFile, colorspace = '') =>
    `<image name="${name}" type="${type}"${colorspace ? ` colorspace="${colorspace}"` : ''}><input name="file" type="filename" value="${file.path}"/></image>`;
  const convert = `<convert name="colorRgb" type="color3"><input name="in" type="color4" nodename="colorMap"/></convert>`;
  const normalNodes = normal ? `${image('normalMap', 'vector3', normal)}
    ${normalDx ? `<extract name="normalRed" type="float"><input name="in" type="vector3" nodename="normalMap"/><input name="index" type="integer" value="0"/></extract>
    <extract name="normalGreen" type="float"><input name="in" type="vector3" nodename="normalMap"/><input name="index" type="integer" value="1"/></extract>
    <extract name="normalBlue" type="float"><input name="in" type="vector3" nodename="normalMap"/><input name="index" type="integer" value="2"/></extract>
    <invert name="normalGreenInverted" type="float"><input name="in" type="float" nodename="normalGreen"/></invert>
    <combine3 name="normalCorrected" type="vector3"><input name="in1" type="float" nodename="normalRed"/><input name="in2" type="float" nodename="normalGreenInverted"/><input name="in3" type="float" nodename="normalBlue"/></combine3>` : ''}
    <normalmap name="normalMapped" type="vector3"><input name="in" type="vector3" nodename="${normalDx ? 'normalCorrected' : 'normalMap'}"/></normalmap>` : '';
  return `<?xml version="1.0"?>
<materialx version="1.39">
  ${image('colorMap', 'color4', color, 'srgb_texture')}
  ${convert}
  ${roughness ? image('roughnessMap', 'float', roughness) : ''}
  ${normalNodes}
  <standard_surface name="surface" type="surfaceshader">
    <input name="base_color" type="color3" nodename="colorRgb"/>
    ${roughness ? '<input name="specular_roughness" type="float" nodename="roughnessMap"/>' : ''}
    ${normal ? '<input name="normal" type="vector3" nodename="normalMapped"/>' : ''}
  </standard_surface>
  <surfacematerial name="material" type="material">
    <input name="surfaceshader" type="surfaceshader" nodename="surface"/>
  </surfacematerial>
</materialx>`;
}

async function ambientCgEntry(entry: MaterialCatalogEntry): Promise<MaterialCatalogEntry> {
  if (!entry.downloadUrl) throw new Error(`Aucun téléchargement 1K-JPG disponible pour ${entry.label}.`);
  const url = new URL(entry.downloadUrl);
  if (url.protocol !== 'https:' || url.hostname !== 'ambientcg.com') throw new Error('URL de téléchargement AmbientCG invalide.');
  const response = await fetch(url.href);
  if (!response.ok) throw new Error(`Téléchargement AmbientCG impossible : HTTP ${response.status}.`);
  const bytes = await readResponseBytes(response, MAX_ARCHIVE_BYTES);
  if (!bytes.length) throw new Error('Archive AmbientCG vide.');
  const blob = new Blob([bytes], { type: 'application/zip' });
  const files = await unpackArchive(blob);
  const xml = ambientMaterialXml(files);
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  const fileInputs = [...document.querySelectorAll('input[name="file"]')];
  const byName = new Map(files.map(file => [file.path.toLowerCase(), file]));
  for (const input of fileInputs) {
    const value = input.getAttribute('value');
    const file = value ? byName.get(value.toLowerCase()) : undefined;
    if (!file) throw new Error(`Texture AmbientCG introuvable : ${value ?? ''}.`);
    input.setAttribute('value', addObjectUrl(new Blob([file.bytes], { type: mimeType(file.path) })));
  }
  return {
    ...entry,
    path: addObjectUrl(new Blob([new XMLSerializer().serializeToString(document)], { type: 'application/xml' })),
  };
}

export async function resolveExternalMaterial(entry: MaterialCatalogEntry): Promise<MaterialCatalogEntry> {
  const cached = resolvedExternal.get(entry.path);
  if (cached) return cached;
  const resolved = entry.provider === 'ambientcg' ? await ambientCgEntry(entry)
    : entry.provider === 'physicallybased' ? await physicallyBasedEntry(entry)
      : entry;
  const { provider: _provider, remoteId: _remoteId, downloadUrl: _downloadUrl, preview: _preview, ...ready } = resolved;
  resolvedExternal.set(entry.path, ready);
  return ready;
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    for (const url of objectUrls) URL.revokeObjectURL(url);
    objectUrls.clear();
  });
}
