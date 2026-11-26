import { describe, expect, it, vi } from 'vitest';
import { unzipSync, strFromU8, unzlibSync } from 'three/addons/libs/fflate.module.js';
import { exportSurfaceGraph, makeBakedMaterialExport, makeMaterialExport, type TextureSourceResolver } from '../../src/materialx/graph-export.ts';
import type { BakedMap } from '../../src/materialx/bake.ts';
import type { ResolvedGraph, ResolvedInput, ResolvedNode } from '../../src/materialx/graph.ts';

function value(name: string, type: string, text: string): ResolvedInput {
  return { name, type, source: { kind: 'value', type, value: text }, provenance: { namePath: name } };
}

function connection(name: string, type: string, nodeId: string): ResolvedInput {
  return { name, type, source: { kind: 'connection', nodeId }, provenance: { namePath: name } };
}

function node(id: string, category: string, type: string, inputs: ResolvedInput[]): ResolvedNode {
  return {
    id, category, type, inputs, provenance: { namePath: id },
    nodeDef: {
      name: `ND_${category}_${type}`, nodeString: category, type, implementation: { kind: 'unresolved' },
      inputs: inputs.map(input => ({ name: input.name, type: input.type })), outputs: [{ name: 'out', type }],
    },
  };
}

function graph(...nodes: ResolvedNode[]): ResolvedGraph {
  const surface = node('surface', 'standard_surface', 'surfaceshader', [
    connection('base_color', 'color3', nodes[0]!.id),
    ...(nodes[1]?.type === 'color3' ? [connection('emission_color', 'color3', nodes[1].id)] : []),
  ]);
  return {
    terminals: [{ name: 'surfaceshader', type: 'surfaceshader', nodeId: surface.id, provenance: { namePath: surface.id } }],
    nodes: new Map([surface, ...nodes].map(item => [item.id, item])),
  };
}

async function archive(blob: Blob) {
  return unzipSync(new Uint8Array(await blob.arrayBuffer()));
}

describe('portable MaterialX texture export', () => {
  it('packages the baked MaterialX graph and all five PNG maps', async () => {
    const bakedMap = (channels: number, data: number[]): BakedMap => ({ channels, data: new Float32Array(data) });
    const result = await makeBakedMaterialExport({
      width: 1,
      height: 1,
      baseColor: bakedMap(4, [0.2, 0.4, 0.6, 1]),
      roughness: bakedMap(1, [0.5]),
      metalness: bakedMap(1, [0.25]),
      normal: bakedMap(3, [0.5, 0.5, 1]),
      heightMap: bakedMap(1, [-1]),
      heightRange: [-1, 1],
    }, 'My Material');
    const files = await archive(result.blob);

    expect(result.filename).toBe('My_Material.baked.zip');
    expect(Object.keys(files).sort()).toEqual([
      'My_Material.mtlx',
      'textures/baseColor.png',
      'textures/height.png',
      'textures/metalness.png',
      'textures/normal.png',
      'textures/roughness.png',
    ]);
    const xml = strFromU8(files['My_Material.mtlx']!);
    expect(xml).toContain('name="base_color" type="color3" nodename="base_color_map"');
    expect(xml).toContain('name="height_offset"');
    const channelCounts: Record<string, number> = {
      baseColor: 4, roughness: 1, metalness: 1, normal: 3, height: 1,
    };
    for (const [texture, channels] of Object.entries(channelCounts)) {
      const png = files[`textures/${texture}.png`]!;
      expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
      expect(new DataView(png.buffer, png.byteOffset, png.byteLength).getUint32(16)).toBe(1);
      expect(new DataView(png.buffer, png.byteOffset, png.byteLength).getUint32(20)).toBe(1);
      const idat: Uint8Array[] = [];
      for (let offset = 8; offset < png.length;) {
        const view = new DataView(png.buffer, png.byteOffset + offset, png.length - offset);
        const size = view.getUint32(0);
        const type = String.fromCharCode(...png.subarray(offset + 4, offset + 8));
        if (type === 'IDAT') idat.push(png.subarray(offset + 8, offset + 8 + size));
        offset += size + 12;
      }
      const compressed = new Uint8Array(idat.reduce((length, part) => length + part.length, 0));
      let outputOffset = 0;
      for (const part of idat) {
        compressed.set(part, outputOffset);
        outputOffset += part.length;
      }
      expect(unzlibSync(compressed)).toHaveLength(channels + 1);
    }
  });

  it('exports sparse encoded UDIMs once while preserving shared texture parameters', async () => {
    const url = 'https://assets.test/coat.%3cudim%3e.png';
    const tiling = node('tiling', 'constant', 'vector2', [value('value', 'vector2', '2, 3')]);
    const a = node('albedo', 'tiledimage', 'color3', [
      value('file', 'filename', url), connection('uvtiling', 'vector2', 'tiling'),
      value('uvoffset', 'vector2', '0.1, 0.2'),
    ]);
    const b = node('detail', 'image', 'color3', [value('file', 'filename', 'https://assets.test/coat.<UDIM>.png')]);
    const fetchTexture = vi.fn(async (input: RequestInfo | URL) =>
      new Response(String(input).endsWith('1001.png') ? 'tile 1001' : 'tile 1011'));
    const source: TextureSourceResolver = file => file === url ? { urls: [file], tiles: [1001, 1011] } : undefined;
    const result = await makeMaterialExport(graph(a, b, tiling), 'mat', fetchTexture, source);
    const files = await archive(result.blob);
    expect(result.filename).toBe('mat.zip');
    expect(Object.keys(files).sort()).toEqual(['mat.mtlx', 'textures/texture_1/coat.1001.png', 'textures/texture_1/coat.1011.png']);
    expect(strFromU8(files['textures/texture_1/coat.1001.png']!)).toBe('tile 1001');
    expect(strFromU8(files['textures/texture_1/coat.1011.png']!)).toBe('tile 1011');
    expect(fetchTexture.mock.calls.map(([url]) => String(url))).toEqual([
      'https://assets.test/coat.1001.png', 'https://assets.test/coat.1011.png',
    ]);
    const xml = strFromU8(files['mat.mtlx']!);
    expect(xml.match(/textures\/texture_1\/coat\.&lt;UDIM&gt;\.png/g)).toHaveLength(2);
    expect(xml).toContain('name="uvtiling" type="vector2" nodename="tiling"');
    expect(xml).toContain('name="uvoffset" type="vector2" value="0.1, 0.2"');
  });

  it('preserves connected filename and sequence parameters, including negative padded frames', async () => {
    const image = node('animated', 'image', 'color3', [
      connection('file', 'filename', 'filename'), connection('framerange', 'string', 'range'),
      connection('frameoffset', 'integer', 'offset'), value('frameendaction', 'string', 'mirror'),
    ]);
    const filename = node('filename', 'constant', 'filename', [value('value', 'filename', 'https://assets.test/run.%7B04frame%7D.png')]);
    const range = node('range', 'constant', 'string', [value('value', 'string', '-1-1')]);
    const offset = node('offset', 'constant', 'integer', [value('value', 'integer', '4')]);
    const fetchTexture = vi.fn(async (input: RequestInfo | URL) => new Response(String(input)));
    const files = await archive((await makeMaterialExport(graph(image, filename, range, offset), 'sequence', fetchTexture)).blob);
    expect(Object.keys(files).sort()).toEqual([
      'sequence.mtlx', 'textures/texture_1/run.-001.png', 'textures/texture_1/run.0000.png',
      'textures/texture_1/run.0001.png',
    ]);
    expect(fetchTexture.mock.calls.map(([url]) => String(url))).toEqual([
      'https://assets.test/run.-001.png', 'https://assets.test/run.0000.png', 'https://assets.test/run.0001.png',
    ]);
    const xml = strFromU8(files['sequence.mtlx']!);
    expect(xml).toContain('name="file" type="filename" nodename="filename"');
    expect(xml).toContain('name="framerange" type="string" nodename="range"');
    expect(xml).toContain('name="frameoffset" type="integer" nodename="offset"');
    expect(xml).toContain('name="frameendaction" type="string" value="mirror"');
    expect(xml).toContain('textures/texture_1/run.{04frame}.png');
  });

  it('inventories UDIM tiles independently for every sequence frame', async () => {
    const template = 'https://assets.test/coat.<UDIM>.{frame}.png';
    const image = node('animatedTiles', 'image', 'color3', [
      value('file', 'filename', template), value('framerange', 'string', '1-2'),
    ]);
    const source: TextureSourceResolver = file => file === template ? { urls: [file] }
      : file.endsWith('.1.png') ? { urls: [file], tiles: [1001, 1011] }
      : file.endsWith('.2.png') ? { urls: [file], tiles: [1002] } : undefined;
    const fetchTexture = vi.fn(async (input: RequestInfo | URL) => new Response(String(input)));
    const files = await archive((await makeMaterialExport(graph(image), 'mat', fetchTexture, source)).blob);
    expect(Object.keys(files).sort()).toEqual([
      'mat.mtlx', 'textures/texture_1/coat.1001.1.png', 'textures/texture_1/coat.1002.2.png',
      'textures/texture_1/coat.1011.1.png',
    ]);
    expect(fetchTexture).toHaveBeenCalledTimes(3);
  });

  it('uses the same resolved source for every tile instead of mixing fallbacks', async () => {
    const image = node('tiles', 'image', 'color3', [value('file', 'filename', 'source/<UDIM>.png')]);
    const fetchTexture = vi.fn(async (input: RequestInfo | URL) =>
      String(input) === 'https://first.test/1001.png' ? new Response(null, { status: 404 }) : new Response(String(input)));
    const source: TextureSourceResolver = file => file === 'source/<UDIM>.png'
      ? { urls: ['https://first.test/<UDIM>.png', 'https://second.test/<UDIM>.png'], tiles: [1001, 1011] }
      : undefined;
    const files = await archive((await makeMaterialExport(graph(image), 'mat', fetchTexture, source)).blob);
    expect(strFromU8(files['textures/texture_1/1001.png']!)).toBe('https://second.test/1001.png');
    expect(strFromU8(files['textures/texture_1/1011.png']!)).toBe('https://second.test/1011.png');
    expect(fetchTexture.mock.calls.map(([url]) => String(url))).toEqual([
      'https://first.test/1001.png', 'https://second.test/1001.png', 'https://second.test/1011.png',
    ]);
  });

  it('exports all triplanar texture sequences with their shared frame settings', async () => {
    const projection = node('project', 'triplanarprojection', 'color3', [
      value('filex', 'filename', 'https://assets.test/x.{frame}.png'),
      value('filey', 'filename', 'https://assets.test/y.{frame}.png'),
      value('framerange', 'string', '1-2'), value('blend', 'float', '0.5'),
    ]);
    const files = await archive((await makeMaterialExport(graph(projection), 'mat', async url => new Response(String(url)))).blob);
    expect(Object.keys(files).sort()).toEqual([
      'mat.mtlx', 'textures/texture_1/x.1.png', 'textures/texture_1/x.2.png',
      'textures/texture_2/y.1.png', 'textures/texture_2/y.2.png',
    ]);
    expect(strFromU8(files['mat.mtlx']!)).toContain('name="blend" type="float" value="0.5"');
  });

  it('refuses unresolved filename connections on texture nodes with nonstandard NodeDef names', () => {
    for (const [category, definition] of [
      ['latlongimage', 'ND_latlongimage'], ['gltf_image', 'ND_gltf_image_color3_color3_1_0'],
    ]) {
      const image = node('image', category!, 'color3', [connection('file', 'filename', 'dynamic')]);
      image.nodeDef!.name = definition!;
      const dynamic = node('dynamic', 'geompropvalueuniform', 'filename', [
        value('default', 'filename', 'https://assets.test/fallback.png'),
      ]);
      expect(() => exportSurfaceGraph(graph(image, dynamic), 'mat')).toThrow('Valeur de texture dynamique non résolue');
    }
  });

  it('preserves resolved filename interface tokens and their actual archive paths', async () => {
    const file = value('file', 'filename', 'https://assets.test/[set]/albedo.[variant].png');
    file.interfaceName = 'filename';
    file.filenameTokens = { set: 'wood', variant: 'dark' };
    const image = node('NG/albedo', 'tiledimage', 'color3', [file, value('uvtiling', 'vector2', '4, 2')]);
    const fetchTexture = vi.fn(async (input: RequestInfo | URL) => new Response(String(input)));
    const files = await archive((await makeMaterialExport(graph(image), 'mat', fetchTexture)).blob);
    expect(fetchTexture).toHaveBeenCalledWith('https://assets.test/wood/albedo.dark.png');
    expect(Object.keys(files).sort()).toEqual(['mat.mtlx', 'textures/texture_1/wood/albedo.dark.png']);
    const xml = strFromU8(files['mat.mtlx']!);
    expect(xml).toContain('<token name="set" type="string" value="wood" />');
    expect(xml).toContain('name="file" type="filename" interfacename="filename"');
    expect(xml).toContain('value="textures/texture_1/[set]/albedo.[variant].png"');
  });

  it('keeps distinct sources with the same basename without overwriting their bytes', async () => {
    const a = node('a', 'image', 'color3', [value('file', 'filename', 'https://one.test/coat.png')]);
    const b = node('b', 'image', 'color3', [value('file', 'filename', 'https://two.test/coat.png')]);
    const files = await archive((await makeMaterialExport(graph(a, b), 'mat', async url => new Response(String(url)))).blob);
    expect(strFromU8(files['textures/coat.png']!)).toBe('https://one.test/coat.png');
    expect(strFromU8(files['textures/coat_2.png']!)).toBe('https://two.test/coat.png');
  });

  it('rejects unknown tokens, unbounded sequences, missing tiles and missing frames', async () => {
    const image = node('image', 'image', 'color3', [value('file', 'filename', 'https://assets.test/[unknown].png')]);
    expect(() => exportSurfaceGraph(graph(image), 'mat')).toThrow('Jeton de texture [unknown] non résolu');
    image.inputs[0] = value('file', 'filename', 'https://assets.test/{host}.png');
    expect(() => exportSurfaceGraph(graph(image), 'mat')).toThrow('Substitution de texture non résolue');
    image.inputs[0] = value('file', 'filename', 'https://assets.test/a.{frame}.png');
    expect(() => exportSurfaceGraph(graph(image), 'mat')).toThrow('Valeur de texture non résolue');
    image.inputs.push(value('framerange', 'string', '3-1'));
    image.nodeDef!.inputs = image.inputs.map(input => ({ name: input.name, type: input.type }));
    expect(() => exportSurfaceGraph(graph(image), 'mat')).toThrow('Plage de séquence invalide');
    image.inputs[1] = value('framerange', 'string', '1-10001');
    expect(() => exportSurfaceGraph(graph(image), 'mat')).toThrow('Plage de séquence invalide');
    image.inputs[1] = value('framerange', 'string', '1-2');
    await expect(makeMaterialExport(graph(image), 'mat', async url =>
      String(url).endsWith('.2.png') ? new Response(null, { status: 404 }) : new Response('frame')))
      .rejects.toThrow('HTTP 404');
    image.inputs = [value('file', 'filename', 'https://assets.test/a.<UDIM>.png')];
    image.nodeDef!.inputs = [{ name: 'file', type: 'filename' }];
    const fetchTexture = vi.fn();
    await expect(makeMaterialExport(graph(image), 'mat', fetchTexture)).rejects.toThrow('Aucune tuile UDIM inventoriée');
    expect(fetchTexture).not.toHaveBeenCalled();
    await expect(makeMaterialExport(graph(image), 'mat', async url =>
      String(url).includes('1011') ? new Response(null, { status: 404 }) : new Response('tile'),
    file => ({ urls: [file], tiles: [1001, 1011] }))).rejects.toThrow('HTTP 404');
    const dynamic = node('dynamic', 'geompropvalueuniform', 'filename', [
      value('geomprop', 'string', 'texture_file'), value('default', 'filename', 'https://assets.test/default.png'),
    ]);
    image.inputs = [connection('file', 'filename', 'dynamic')];
    expect(() => exportSurfaceGraph(graph(image, dynamic), 'mat')).toThrow('Valeur de texture dynamique non résolue');
  });

  it('preserves authored frame settings on an otherwise static texture', async () => {
    const image = node('image', 'tiledimage', 'color3', [
      value('file', 'filename', 'https://assets.test/static.png'),
      value('framerange', 'string', '1,1'), value('frameoffset', 'integer', '2'),
    ]);
    const files = await archive((await makeMaterialExport(graph(image), 'mat', async () => new Response('image'))).blob);
    const xml = strFromU8(files['mat.mtlx']!);
    expect(xml).toContain('name="framerange" type="string" value="1,1"');
    expect(xml).toContain('name="frameoffset" type="integer" value="2"');
  });

  it('rejects nonportable expanded texture paths before fetching', async () => {
    const image = node('image', 'image', 'color3', [
      value('file', 'filename', 'https://assets.test/tile.<UDIM>./image.png'),
    ]);
    const fetchTexture = vi.fn();
    await expect(makeMaterialExport(graph(image), 'mat', fetchTexture, file =>
      ({ urls: [file], tiles: [1001] }))).rejects.toThrow('Chemin de texture non portable');
    expect(fetchTexture).not.toHaveBeenCalled();
  });

  it('rejects a texture stream exceeding the total 64 MiB limit', async () => {
    const image = node('image', 'image', 'color3', [value('file', 'filename', 'https://assets.test/large.png')]);
    const response = () => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(64 * 1024 * 1024));
        controller.enqueue(new Uint8Array(1));
        controller.close();
      },
    }));
    await expect(makeMaterialExport(graph(image), 'mat', async () => response())).rejects.toThrow('limite totale de 64 Mio dépassée');
  });
});
