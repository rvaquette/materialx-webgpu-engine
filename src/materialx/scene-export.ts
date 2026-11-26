import {
  AmbientLight, BufferAttribute, BufferGeometry, CanvasTexture, DirectionalLight, Group, Mesh,
  MeshStandardMaterial, SRGBColorSpace,
} from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import type { PtImageProvider } from '../render/pathtracing/device-bindings.ts';
import type { SceneResources } from '../render/scene-resources.ts';
import type { SceneFramePlan } from '../render/raster/scene-frame.ts';
import type { AttributeValue, SceneAsset, ScenePrim } from '../scene/types.ts';
import { computeWorldTransforms, IDENTITY4, inverse4, multiply4 } from '../scene/transforms.ts';
import { bakeMaterialMaps, createMeshBakeSampler, type BakedMap, type BakedMaterialMaps } from './bake.ts';
import { makeBakedMaterialExport } from './graph-export.ts';

function constantMaps(color: readonly number[], roughness: number, metalness: number): BakedMaterialMaps {
  const fill = (channels: number, values: readonly number[]): BakedMap => {
    const data = new Float32Array(channels * 4);
    for (let pixel = 0; pixel < 4; pixel++) {
      for (let channel = 0; channel < channels; channel++) data[pixel * channels + channel] = values[channel] ?? 0;
    }
    return { channels, data };
  };
  return {
    width: 2, height: 2,
    baseColor: fill(4, [color[0] ?? 0.8, color[1] ?? 0.8, color[2] ?? 0.8, 1]),
    roughness: fill(1, [roughness]),
    metalness: fill(1, [metalness]),
    normal: fill(3, [0.5, 0.5, 1]),
    heightMap: fill(1, [0]),
    heightRange: [0, 0],
  };
}

function textureFromMap(map: BakedMap, width: number, height: number, color: 'srgb' | 'linear'): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D context is unavailable for glTF export.');
  const image = context.createImageData(width, height);
  for (let pixel = 0; pixel < width * height; pixel++) {
    for (let channel = 0; channel < 3; channel++) {
      let value = map.data[pixel * map.channels + Math.min(channel, map.channels - 1)] ?? 0;
      if (color === 'srgb') {
        value = value <= 0.0031308 ? value * 12.92 : 1.055 * Math.pow(Math.max(0, value), 1 / 2.4) - 0.055;
      }
      image.data[pixel * 4 + channel] = Math.round(Math.min(1, Math.max(0, value)) * 255);
    }
    image.data[pixel * 4 + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  const texture = new CanvasTexture(canvas);
  if (color === 'srgb') texture.colorSpace = SRGBColorSpace;
  texture.flipY = false;
  texture.needsUpdate = true;
  return texture;
}

function packedMetalRough(maps: BakedMaterialMaps): BakedMap {
  const data = new Float32Array(maps.width * maps.height * 4);
  for (let pixel = 0; pixel < maps.width * maps.height; pixel++) {
    data[pixel * 4 + 1] = maps.roughness.data[pixel]!;
    data[pixel * 4 + 2] = maps.metalness.data[pixel]!;
    data[pixel * 4 + 3] = 1;
  }
  return { channels: 4, data };
}

function geometryFor(
  prototypeId: string,
  resources: SceneResources,
): BufferGeometry {
  const source = resources.geometries.get(prototypeId);
  if (!source) throw new Error(`Missing geometry for exported prototype '${prototypeId}'.`);
  const geometry = new BufferGeometry();
  for (const stream of source.streams) {
    if (stream.name === 'position') geometry.setAttribute('position', new BufferAttribute(stream.data, stream.components));
    else if (stream.name === 'normal') geometry.setAttribute('normal', new BufferAttribute(stream.data, stream.components));
    else if (stream.name === 'uv') geometry.setAttribute('uv', new BufferAttribute(stream.data, stream.components));
    else if (stream.name === 'tangent') geometry.setAttribute('tangent', new BufferAttribute(stream.data, stream.components));
  }
  geometry.setIndex(new BufferAttribute(source.indices, 1));
  return geometry;
}

async function bakeSceneMaterials(
  frame: SceneFramePlan,
  resources: SceneResources,
  provider: PtImageProvider,
  samplingResources: SceneResources = resources,
): Promise<Map<string, BakedMaterialMaps>> {
  const maps = new Map<string, BakedMaterialMaps>();
  for (const draw of frame.draws) {
    const key = draw.instanceId;
    if (maps.has(key)) continue;
    const material = draw.materialKey ? resources.materials.get(draw.materialKey) : undefined;
    if (material?.surfaceGraph && material.resolvedSurface) {
      const geometry = samplingResources.geometries.get(draw.prototypeId);
      if (!geometry?.streams.some(stream => stream.name === 'uv')) {
        throw new Error(`Material '${material.materialName}' needs UVs to bake textures for export.`);
      }
      maps.set(key, await bakeMaterialMaps(material.surfaceGraph, material.resolvedSurface, provider, {
        material, width: 512, sampleAt: createMeshBakeSampler(geometry, draw.model, 512, 512),
      }));
    } else {
      maps.set(key, constantMaps(draw.surface.baseColor, draw.surface.roughness, draw.surface.metalness));
    }
  }
  return maps;
}

/** Exports visible scene geometry as a binary glTF with baked PBR textures. */
export async function exportSceneGlb(
  frame: SceneFramePlan,
  resources: SceneResources,
  provider: PtImageProvider,
  samplingResources: SceneResources = resources,
): Promise<Blob> {
  const maps = await bakeSceneMaterials(frame, resources, provider, samplingResources);

  const root = new Group();
  root.name = 'MaterialX Scene';
  root.add(new AmbientLight(0xffffff, Math.max(0.05, frame.environment.radiance.reduce((sum, value) => sum + value, 0) / 3)));
  const light = new DirectionalLight(0xffffff, Math.max(0, frame.light.intensity));
  light.color.setRGB(...frame.light.color);
  light.position.set(...frame.light.direction).negate();
  root.add(light);

  for (const draw of frame.draws) {
    const geometry = geometryFor(draw.prototypeId, resources);
    const baked = maps.get(draw.instanceId);
    const materialResource = draw.materialKey ? resources.materials.get(draw.materialKey) : undefined;
    const material = new MeshStandardMaterial({ name: draw.materialKey ?? 'Default', color: 0xffffff });
    if (baked && materialResource?.surfaceGraph) {
      material.map = textureFromMap(baked.baseColor, baked.width, baked.height, 'srgb');
      const packed = textureFromMap(packedMetalRough(baked), baked.width, baked.height, 'linear');
      material.roughnessMap = packed;
      material.metalnessMap = packed;
      material.normalMap = textureFromMap(baked.normal, baked.width, baked.height, 'linear');
    } else {
      material.color.setRGB(...draw.surface.baseColor);
      material.roughness = draw.surface.roughness;
      material.metalness = draw.surface.metalness;
    }
    material.transparent = draw.surface.transmission > 0;
    material.opacity = material.transparent ? Math.max(0.05, 1 - draw.surface.transmission) : 1;
    const mesh = new Mesh(geometry, material);
    mesh.name = draw.instanceId;
    mesh.matrix.fromArray(draw.model);
    mesh.matrixAutoUpdate = false;
    root.add(mesh);
  }

  const exporter = new GLTFExporter();
  const output = await exporter.parseAsync(root, { binary: true, onlyVisible: true });
  if (!(output instanceof ArrayBuffer)) throw new Error('glTF exporter did not produce a binary GLB.');
  return new Blob([output], { type: 'model/gltf-binary' });
}

function usdSafeName(name: string): string {
  const value = name.replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'BakedMaterial';
  return /^[A-Za-z_]/.test(value) ? value : `M_${value}`;
}

function usdArray(values: ArrayLike<number>, components: number): string {
  const tuples: string[] = [];
  for (let i = 0; i < values.length; i += components) {
    tuples.push(`(${Array.from({ length: components }, (_, c) => Number(values[i + c] ?? 0).toPrecision(8)).join(', ')})`);
  }
  return `[${tuples.join(', ')}]`;
}

function usdTransform(matrix: readonly number[]): string {
  const rows = Array.from({ length: 4 }, (_, row) =>
    Array.from({ length: 4 }, (_, column) => Number(matrix[column * 4 + row] ?? (row === column ? 1 : 0)).toPrecision(8)));
  return `((${rows.map(row => row.join(', ')).join('), (')}))`;
}

function usdTextureShader(
  name: string, material: string, file: string, colorSpace: 'sRGB' | 'raw', output: 'rgb' | 'r',
): string[] {
  return [
    `      def Shader "${name}" {`,
    `        uniform token info:id = "UsdUVTexture"`,
    `        asset inputs:file = @${file}@`,
    `        token inputs:sourceColorSpace = "${colorSpace}"`,
    `        token inputs:wrapS = "repeat"`,
    `        token inputs:wrapT = "repeat"`,
    `        float2 inputs:st.connect = </Scene/Looks/${material}/Primvar.outputs:result>`,
    ...(name.startsWith('Normal_') ? [
      '        float4 inputs:scale = (2, 2, 2, 1)',
      '        float4 inputs:bias = (-1, -1, -1, 0)',
    ] : []),
    `        ${output === 'rgb' ? 'float3' : 'float'} outputs:${output}`,
    '      }',
  ];
}

function usdString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}

function usdScalar(type: string, value: number | boolean | string): string {
  if (typeof value === 'string') {
    if (type === 'asset') return `@${value.replace(/@/g, '%40')}@`;
    return usdString(value);
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return Number(value).toPrecision(8);
}

function usdValue(type: string, value: AttributeValue): string {
  if (!Array.isArray(value)) return usdScalar(type, value as number | boolean | string);
  const values = value as readonly (number | boolean | string)[];
  const isArray = type.endsWith('[]');
  const elementType = isArray ? type.slice(0, -2) : type;
  const dimensions = elementType === 'matrix4d' || elementType === 'matrix4f' ? 16
    : /(?:2|2f|2d)$/.test(elementType) ? 2
      : /(?:3|3f|3d)$/.test(elementType) ? 3
        : /(?:4|4f|4d)$/.test(elementType) ? 4 : 1;
  if (dimensions === 16 && values.length === 16) {
    const matrix = values.map(Number);
    return usdTransform(matrix);
  }
  const scalar = (item: number | boolean | string) => usdScalar(elementType, item);
  if (dimensions === 1) return isArray ? `[${values.map(scalar).join(', ')}]` : scalar(values[0] ?? 0);
  const tuples: string[] = [];
  for (let index = 0; index < values.length; index += dimensions) {
    tuples.push(`(${values.slice(index, index + dimensions).map(scalar).join(', ')})`);
  }
  return isArray ? `[${tuples.join(', ')}]` : tuples[0] ?? '()';
}

function usdAttribute(attribute: { name: string; typeName: string; value?: AttributeValue; timeSamples?: readonly { time: number; value: AttributeValue | null }[] }): string[] {
  if (attribute.timeSamples?.length) {
    const type = attribute.typeName;
    return [
      `      ${type} ${attribute.name}.timeSamples = {`,
      ...attribute.timeSamples.map(sample => `        ${sample.time}: ${sample.value === null ? 'None' : usdValue(type, sample.value)},`),
      '      }',
    ];
  }
  if (attribute.value === undefined) return [];
  return [`      ${attribute.typeName} ${attribute.name} = ${usdValue(attribute.typeName, attribute.value)}`];
}

function writeComposedSceneUsda(
  scene: SceneAsset,
  frame: SceneFramePlan,
  resources: SceneResources,
  names: ReadonlyMap<string, string>,
): string {
  const world = computeWorldTransforms(scene);
  const instanceById = new Map(resources.instances.map(instance => [instance.id, instance]));
  const drawsByPrim = new Map<string, typeof frame.draws[number][]>();
  for (const draw of frame.draws) {
    const instance = instanceById.get(draw.instanceId);
    if (!instance) throw new Error(`Missing instance '${draw.instanceId}' for USD export.`);
    const group = drawsByPrim.get(instance.primPath) ?? [];
    group.push(draw);
    drawsByPrim.set(instance.primPath, group);
  }
  const looksScopeBase = '__BakedLooks';
  let looksScope = looksScopeBase;
  for (let suffix = 2; scene.prims.has(`/${looksScope}`); suffix++) looksScope = `${looksScopeBase}_${suffix}`;
  const roots = scene.roots.map(path => scene.prims.get(path)).filter((prim): prim is ScenePrim => prim !== undefined);
  const lines = [
    '#usda 1.0',
    '(',
    `    defaultPrim = ${usdString(scene.stage.defaultPrim ?? roots[0]?.name ?? 'World')}`,
    `    upAxis = ${usdString(scene.stage.upAxis ?? 'Y')}`,
    ...(scene.stage.metersPerUnit !== undefined ? [`    metersPerUnit = ${scene.stage.metersPerUnit}`] : []),
    ...(scene.stage.startTimeCode !== undefined ? [`    startTimeCode = ${scene.stage.startTimeCode}`] : []),
    ...(scene.stage.endTimeCode !== undefined ? [`    endTimeCode = ${scene.stage.endTimeCode}`] : []),
    ...(scene.stage.timeCodesPerSecond !== undefined ? [`    timeCodesPerSecond = ${scene.stage.timeCodesPerSecond}`] : []),
    ...(scene.stage.framesPerSecond !== undefined ? [`    framesPerSecond = ${scene.stage.framesPerSecond}`] : []),
    ')',
  ];

  const meshBody = (prim: ScenePrim, draw: typeof frame.draws[number], indent: string): void => {
    const geometry = resources.geometries.get(draw.prototypeId);
    if (!geometry) throw new Error(`Missing geometry for exported prim '${prim.path}'.`);
    const position = geometry.streams.find(stream => stream.name === 'position');
    if (!position) throw new Error(`Missing position stream for '${prim.path}'.`);
    const normal = geometry.streams.find(stream => stream.name === 'normal');
    const uv = geometry.streams.find(stream => stream.name === 'uv');
    const parentPath = prim.path.slice(0, prim.path.lastIndexOf('/')) || '/';
    const parentWorld = world.get(parentPath) ?? IDENTITY4;
    const local = multiply4(inverse4(parentWorld, true), draw.model);
    lines.push(
      `${indent}uniform token subdivisionScheme = "none"`,
      `${indent}uniform token orientation = "rightHanded"`,
      `${indent}matrix4d xformOp:transform = ${usdTransform(local)}`,
      `${indent}uniform token[] xformOpOrder = ["xformOp:transform"]`,
      `${indent}point3f[] points = ${usdArray(position.data, 3)}`,
      `${indent}int[] faceVertexCounts = [${Array.from({ length: geometry.indices.length / 3 }, () => '3').join(', ')}]`,
      `${indent}int[] faceVertexIndices = [${Array.from(geometry.indices).join(', ')}]`,
    );
    const replaced = new Set([
      'points', 'faceVertexCounts', 'faceVertexIndices', 'normals',
      'subdivisionScheme', 'orientation', 'primvars:st',
    ]);
    for (const attribute of prim.attributes.values()) {
      if (replaced.has(attribute.name) || attribute.name.startsWith('xformOp:') || attribute.name === 'xformOpOrder') continue;
      lines.push(...usdAttribute(attribute).map(line => `${indent}${line.slice(6)}`));
    }
    if (normal) lines.push(`${indent}normal3f[] normals = ${usdArray(normal.data, 3)} (interpolation = "vertex")`);
    if (uv) lines.push(`${indent}texCoord2f[] primvars:st = ${usdArray(uv.data, 2)} (interpolation = "vertex")`);
    const material = names.get(draw.instanceId);
    if (material) lines.push(`${indent}rel material:binding = </${looksScope}/${material}>`);
  };

  const writePrim = (prim: ScenePrim, depth: number): void => {
    const indent = '  '.repeat(depth);
    const draws = drawsByPrim.get(prim.path) ?? [];
    const specifier = prim.specifier === 'over' ? 'def' : prim.specifier;
    const typeName = draws.length > 1 ? 'Xform' : draws.length === 1 ? 'Mesh' : prim.typeName;
    const type = typeName ? `${specifier} ${typeName}` : specifier;
    const metadata = [
      ...(prim.kind ? [`kind = ${usdString(prim.kind)}`] : []),
      ...(prim.apiSchemas.length ? [`apiSchemas = [${prim.apiSchemas.map(usdString).join(', ')}]`] : []),
      ...(prim.inherits.length ? [`prepend inherits = [${prim.inherits.map(path => `<${path}>`).join(', ')}]`] : []),
    ];
    lines.push(
      `${indent}${type} ${usdString(prim.name)}${metadata.length
        ? ` (\n${metadata.map(item => `${indent}  ${item}`).join('\n')}\n${indent})`
        : ''} {`,
    );
    const attributes = [...prim.attributes.values()];
    if (draws.length === 1) {
      meshBody(prim, draws[0]!, `${indent}  `);
    } else if (draws.length > 1) {
      for (const [index, draw] of draws.entries()) {
        lines.push(`${indent}  def Mesh "Instance_${index}" {`);
        meshBody(prim, draw, `${indent}    `);
        lines.push(`${indent}  }`);
      }
    } else {
      for (const attribute of attributes) {
        if (prim.typeName === 'Mesh' && ['points', 'faceVertexCounts', 'faceVertexIndices', 'normals'].includes(attribute.name)) continue;
        if (attribute.name.startsWith('xformOp:') || attribute.name === 'xformOpOrder') continue;
        lines.push(...usdAttribute(attribute).map(line => `${indent}  ${line.slice(6)}`));
      }
      if (prim.xformOps.length) {
        const order = prim.xformOps.map(op => `${op.invert ? '!invert!' : ''}${op.op}`);
        lines.push(`${indent}  uniform token[] xformOpOrder = [${order.map(usdString).join(', ')}]`);
        for (const op of prim.xformOps) {
          lines.push(...usdAttribute({
            name: op.op,
            typeName: op.typeName,
            ...(op.value !== undefined ? { value: op.value } : {}),
            ...(op.timeSamples?.length ? { timeSamples: op.timeSamples } : {}),
          }).map(line => `${indent}  ${line.slice(6)}`));
        }
      }
    }

    const hasMaterialBindingRelationship = prim.relationships.has('material:binding');
    for (const relationship of prim.relationships.values()) {
      if (relationship.name === 'material:binding' && draws.length) continue;
      const targets = relationship.targets.map(target => `<${target}>`);
      lines.push(`${indent}  rel ${relationship.name} = ${targets.length === 1 ? targets[0] : `[${targets.join(', ')}]`}`);
    }
    if (prim.materialBinding && !draws.length && !hasMaterialBindingRelationship) {
      lines.push(`${indent}  rel material:binding = <${prim.materialBinding.target}>`);
    }
    for (const childPath of prim.children) {
      const child = scene.prims.get(childPath);
      if (child) writePrim(child, depth + 1);
    }
    lines.push(`${indent}}`);
  };

  for (const root of roots) writePrim(root, 0);
  lines.push(`def Scope ${usdString(looksScope)} {`);
  for (const name of names.values()) {
    const asset = `materials/${name}/${name}.mtlx`;
    lines.push(
      `  def Material ${usdString(name)} (`,
      `      prepend references = @${asset}@</MaterialX/Materials/${name}>`,
      '  ) {',
      '  }',
    );
  }
  lines.push('}', '');
  return lines.join('\n');
}

/** Exports the current USD composition with baked geometry and linked MaterialX materials. */
export async function exportSceneUsdZip(
  frame: SceneFramePlan,
  resources: SceneResources,
  provider: PtImageProvider,
  samplingResources: SceneResources = resources,
  scene?: SceneAsset,
): Promise<Blob> {
  const maps = await bakeSceneMaterials(frame, resources, provider, samplingResources);
  const materialNames = new Map<string, string>();
  const usedNames = new Set<string>();
  for (const draw of frame.draws) {
    const base = usdSafeName(draw.materialKey ? resources.materials.get(draw.materialKey)?.materialName ?? draw.instanceId : draw.instanceId);
    let name = base;
    for (let suffix = 2; usedNames.has(name); suffix++) name = `${base}_${suffix}`;
    usedNames.add(name);
    materialNames.set(draw.instanceId, name);
  }
  const lines = [
    '#usda 1.0',
    '(',
    '    defaultPrim = "Scene"',
    '    metersPerUnit = 1',
    '    upAxis = "Y"',
    ')',
    'def Xform "Scene" {',
    '  def Scope "Looks" {',
  ];
  for (const name of materialNames.values()) {
    const textureBase = `materials/${name}/textures`;
    lines.push(
      `    def Material "${name}" {`,
      `      token outputs:surface.connect = </Scene/Looks/${name}/Preview.outputs:surface>`,
      `      def Shader "Primvar" {`,
      `        uniform token info:id = "UsdPrimvarReader_float2"`,
      `        token inputs:varname = "st"`,
      `        float2 outputs:result`,
      `      }`,
      `      def Shader "Preview" {`,
      `        uniform token info:id = "UsdPreviewSurface"`,
      `        color3f inputs:diffuseColor.connect = </Scene/Looks/${name}/BaseColor_${name}.outputs:rgb>`,
      `        float inputs:roughness.connect = </Scene/Looks/${name}/Roughness_${name}.outputs:r>`,
      `        float inputs:metallic.connect = </Scene/Looks/${name}/Metalness_${name}.outputs:r>`,
      `        normal3f inputs:normal.connect = </Scene/Looks/${name}/Normal_${name}.outputs:rgb>`,
      `        token outputs:surface`,
      `      }`,
    );
    lines.push(...usdTextureShader(`BaseColor_${name}`, name, `${textureBase}/baseColor.png`, 'sRGB', 'rgb'));
    lines.push(...usdTextureShader(`Roughness_${name}`, name, `${textureBase}/roughness.png`, 'raw', 'r'));
    lines.push(...usdTextureShader(`Metalness_${name}`, name, `${textureBase}/metalness.png`, 'raw', 'r'));
    lines.push(...usdTextureShader(`Normal_${name}`, name, `${textureBase}/normal.png`, 'raw', 'rgb'));
    lines.push('    }');
  }
  lines.push('  }', '  def Xform "Geometry" {');
  for (const [index, draw] of frame.draws.entries()) {
    const geometry = resources.geometries.get(draw.prototypeId);
    if (!geometry) throw new Error(`Missing geometry for exported prototype '${draw.prototypeId}'.`);
    const position = geometry.streams.find(stream => stream.name === 'position');
    if (!position) throw new Error(`Missing position stream for '${draw.prototypeId}'.`);
    const normal = geometry.streams.find(stream => stream.name === 'normal');
    const uv = geometry.streams.find(stream => stream.name === 'uv');
    const materialName = materialNames.get(draw.instanceId)!;
    const path = `/Scene/Looks/${materialName}`;
    lines.push(
      `    def Mesh "Mesh_${index}" {`,
      '      uniform token subdivisionScheme = "none"',
      '      uniform token orientation = "rightHanded"',
      `      matrix4d xformOp:transform = ${usdTransform(draw.model)}`,
      '      uniform token[] xformOpOrder = ["xformOp:transform"]',
      `      point3f[] points = ${usdArray(position.data, 3)}`,
      `      int[] faceVertexCounts = [${Array.from({ length: geometry.indices.length / 3 }, () => '3').join(', ')}]`,
      `      int[] faceVertexIndices = [${Array.from(geometry.indices).join(', ')}]`,
    );
    if (normal) lines.push(`      normal3f[] normals = ${usdArray(normal.data, 3)} (interpolation = "vertex")`);
    if (uv) lines.push(`      texCoord2f[] primvars:st = ${usdArray(uv.data, 2)} (interpolation = "vertex")`);
    lines.push(`      rel material:binding = <${path}>`, '    }');
  }
  lines.push('  }', '}', '');

  const { zipSync, strToU8, unzipSync } = await import('three/addons/libs/fflate.module.js');
  const usda = scene ? writeComposedSceneUsda(scene, frame, resources, materialNames) : lines.join('\n');
  const files: Record<string, Uint8Array> = { 'scene.usda': strToU8(usda) };
  for (const [instanceId, baked] of maps) {
    const name = materialNames.get(instanceId)!;
    const archive = await makeBakedMaterialExport(baked, name);
    const entries = unzipSync(new Uint8Array(await archive.blob.arrayBuffer()));
    for (const [path, content] of Object.entries(entries)) files[`materials/${name}/${path}`] = content;
  }
  return new Blob([zipSync(files, { level: 6 })], { type: 'application/zip' });
}
