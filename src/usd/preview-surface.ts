// Lower an inline USD `UsdPreviewSurface` shader network into a synthetic
// MaterialX document so the existing graph-material-compiler path (resolveGraph ->
// resolveSurface -> lowerSurfaceInputsToIr) textures and shades it in the path
// tracer. USD materials that reference a `.mtlx` asset already produce a
// MaterialXReference and flow through that path; inline UsdPreviewSurface shaders
// (incl. UsdUVTexture / UsdPrimvarReader) produce none and otherwise fall back to
// the neutral surface. This bridge emits an equivalent `<UsdPreviewSurface>` graph
// (a supported surface family) with `<image>` nodes for textured inputs, keyed by a
// synthetic asset path the document source loads directly from text.

import type { DiagnosticSink } from '../core/diagnostics.ts';
import type { AttributeValue, MaterialXReference, SceneAsset, ScenePrim } from '../scene/types.ts';

export interface LoweredPreviewSurface {
  /** Synthetic reference so resolveSceneMaterials builds a compile unit. */
  reference: MaterialXReference;
  /** Generated MaterialX document text, loaded by the document source. */
  xml: string;
  /** Texture file references authored by the network (relative to the usd dir). */
  textureFiles: readonly string[];
}

/** UsdPreviewSurface inputs we forward, with their MaterialX value type. */
const SURFACE_INPUTS: ReadonlyArray<readonly [name: string, type: string]> = [
  ['diffuseColor', 'color3'],
  ['emissiveColor', 'color3'],
  ['specularColor', 'color3'],
  ['metallic', 'float'],
  ['roughness', 'float'],
  ['clearcoat', 'float'],
  ['clearcoatRoughness', 'float'],
  ['opacity', 'float'],
  ['ior', 'float'],
  ['normal', 'vector3'],
];

function attrValue(prim: ScenePrim, name: string): AttributeValue | undefined {
  return prim.attributes.get(name)?.value;
}

function attrString(prim: ScenePrim, name: string): string | undefined {
  const v = attrValue(prim, name);
  return typeof v === 'string' ? v : undefined;
}

function infoId(prim: ScenePrim): string | undefined {
  return attrString(prim, 'info:id');
}

/** Split a connection target `</prim.outputs:rgb>` into the node path + output. */
function splitConnection(raw: string): { nodePath: string; output: string } {
  const dot = raw.indexOf('.');
  if (dot < 0) return { nodePath: raw, output: '' };
  const nodePath = raw.slice(0, dot);
  const prop = raw.slice(dot + 1);
  const colon = prop.lastIndexOf(':');
  return { nodePath, output: colon >= 0 ? prop.slice(colon + 1) : prop };
}

interface InputSource {
  value?: AttributeValue;
  connection?: { nodePath: string; output: string };
}

function readInput(prim: ScenePrim, input: string): InputSource | undefined {
  const conn = prim.attributes.get(`inputs:${input}.connect`)?.value;
  if (typeof conn === 'string' && conn.length > 0) {
    return { connection: splitConnection(conn) };
  }
  const value = prim.attributes.get(`inputs:${input}`)?.value;
  if (value !== undefined) return { value };
  return undefined;
}

/** Resolve the UsdPreviewSurface shader a material prim's surface terminal drives. */
function surfaceShaderOf(scene: SceneAsset, material: ScenePrim): ScenePrim | undefined {
  for (const [key, attr] of material.attributes) {
    if (key.startsWith('outputs:') && key.endsWith('surface.connect') && typeof attr.value === 'string') {
      const shader = scene.prims.get(splitConnection(attr.value).nodePath);
      if (shader && infoId(shader) === 'UsdPreviewSurface') return shader;
    }
  }
  for (const childPath of material.children) {
    const child = scene.prims.get(childPath);
    if (child && infoId(child) === 'UsdPreviewSurface') return child;
  }
  return undefined;
}

function stripDotSlash(file: string): string {
  return file.startsWith('./') ? file.slice(2) : file;
}

function xmlEscape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatValue(value: AttributeValue, type: string): string {
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) {
    const nums = value as readonly number[];
    if (type === 'color3' || type === 'vector3') {
      const first = Number(nums[0] ?? 0);
      return [0, 1, 2].map((i) => Number(nums[i] ?? first)).join(', ');
    }
    return nums.map((n) => String(n)).join(', ');
  }
  return String(value);
}

interface GeneratedNode {
  xml: string;
  name: string;
}

/** Build one material's MaterialX document, or undefined when it is not a textured
 *  or constant UsdPreviewSurface worth lowering. */
function lowerOne(
  scene: SceneAsset,
  material: ScenePrim,
  emit: (level: string, message: string) => void,
): LoweredPreviewSurface | undefined {
  const shader = surfaceShaderOf(scene, material);
  if (!shader) return undefined;

  const materialName = material.name;
  const surfaceNode = 'Surface';
  const images = new Map<string, GeneratedNode>();
  const textureFiles: string[] = [];
  const surfaceInputs: string[] = [];

  // USD and MaterialX use bottom-left UVs; image lowering converts to image space.
  const uvNodes: string[] = [];
  const ensureUv = (): string => {
    if (!uvNodes.length) uvNodes.push(`  <texcoord name="st_raw" type="vector2" />`);
    return 'st_raw';
  };

  const emitImage = (tex: ScenePrim, output: string, targetType: string): string | undefined => {
    const file = attrString(tex, 'inputs:file');
    if (!file) {
      emit('warning', `UsdUVTexture ${tex.path} has no inputs:file`);
      return undefined;
    }
    const channel = output === 'r' || output === 'g' || output === 'b' || output === 'a';
    const imageType = channel ? 'float' : targetType;
    const key = `${tex.path}|${output}`;
    const existing = images.get(key);
    if (existing) return existing.name;
    const name = `img_${images.size}_${tex.name}`;
    const relFile = stripDotSlash(file);
    if (!textureFiles.includes(relFile)) textureFiles.push(relFile);
    const uvNode = ensureUv();
    const xml =
      `  <image name="${xmlEscape(name)}" type="${imageType}">\n` +
      `    <input name="file" type="filename" value="${xmlEscape(relFile)}" />\n` +
      `    <input name="texcoord" type="vector2" nodename="${uvNode}" />\n` +
      `  </image>`;
    images.set(key, { xml, name });
    return name;
  };

  for (const [inputName, inputType] of SURFACE_INPUTS) {
    const source = readInput(shader, inputName);
    if (!source) continue;
    if (source.connection) {
      const tex = scene.prims.get(source.connection.nodePath);
      if (!tex || infoId(tex) !== 'UsdUVTexture') {
        emit('info', `UsdPreviewSurface ${shader.path}.${inputName} drives unsupported node; skipped`);
        continue;
      }
      const nodeName = emitImage(tex, source.connection.output, inputType);
      if (nodeName) {
        surfaceInputs.push(`    <input name="${inputName}" type="${inputType}" nodename="${xmlEscape(nodeName)}" />`);
      }
    } else if (source.value !== undefined) {
      surfaceInputs.push(
        `    <input name="${inputName}" type="${inputType}" value="${xmlEscape(formatValue(source.value, inputType))}" />`,
      );
    }
  }

  if (images.size === 0 && surfaceInputs.length === 0) return undefined;

  const imageXml = [...images.values()].map((n) => n.xml).join('\n');
  const uvXml = uvNodes.join('\n');
  const xml =
    `<?xml version="1.0"?>\n` +
    `<materialx version="1.38" colorspace="lin_rec709">\n` +
    (uvXml ? uvXml + '\n' : '') +
    (imageXml ? imageXml + '\n' : '') +
    `  <UsdPreviewSurface name="${surfaceNode}" type="surfaceshader">\n` +
    surfaceInputs.join('\n') +
    (surfaceInputs.length ? '\n' : '') +
    `  </UsdPreviewSurface>\n` +
    `  <surfacematerial name="${xmlEscape(materialName)}" type="material">\n` +
    `    <input name="surfaceshader" type="surfaceshader" nodename="${surfaceNode}" />\n` +
    `  </surfacematerial>\n` +
    `</materialx>\n`;

  return {
    reference: {
      primPath: material.path,
      assetPath: `usdpreview:${material.path}`,
      referencedPrimPath: material.path,
      materialName,
    },
    xml,
    textureFiles,
  };
}

/**
 * Lower every inline UsdPreviewSurface material in the scene that is not already
 * backed by a MaterialX reference into a synthetic MaterialX document. The caller
 * registers each reference on `scene.materials` and loads the XML into the document
 * source so the path tracer compiles a textured megakernel variant for it.
 */
export function lowerPreviewSurfaceMaterials(
  scene: SceneAsset,
  sink?: DiagnosticSink,
): LoweredPreviewSurface[] {
  const emit = (level: string, message: string): void =>
    sink?.({ level: level as 'info' | 'warning' | 'error', message });
  const alreadyReferenced = new Set(scene.materials.map((m) => m.primPath));
  const out: LoweredPreviewSurface[] = [];
  for (const prim of scene.prims.values()) {
    if (prim.typeName !== 'Material') continue;
    if (alreadyReferenced.has(prim.path)) continue;
    const lowered = lowerOne(scene, prim, emit);
    if (lowered) out.push(lowered);
  }
  return out;
}
