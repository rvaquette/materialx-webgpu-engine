import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { nanoVdbVectorGpuData, readNanoVdb, readNanoVdbVectors, resampleNanoVdb, writeNanoVdb, type NanoVdbGrid } from '../../src/assets/nanovdb.ts';

// Fixtures written by the official NanoVDB headers (tools::createNanoGrid, io::writeGrid,
// tools::createFogVolumeSphere); the .txt files list values read with the official accessor.
const fixture = async (name: string): Promise<Uint8Array> => new Uint8Array(await new Response(
  new Blob([readFileSync(`tests/fixtures/nanovdb/${name}.nvdb.gz`)]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());

function valueMap(grid: NanoVdbGrid): (i: number, j: number, k: number) => number {
  const voxels = new Map<string, number>();
  const tiles: Array<{ origin: number[]; size: number; value: number }> = [];
  grid.forEachValue((i, j, k, size, value) => {
    if (size === 1) voxels.set(`${i},${j},${k}`, value);
    else tiles.push({ origin: [i, j, k], size, value });
  });
  return (i, j, k) => voxels.get(`${i},${j},${k}`)
    ?? tiles.find(t => [i, j, k].every((c, a) => c >= t.origin[a]! && c < t.origin[a]! + t.size))?.value
    ?? grid.background;
}

describe('NanoVDB', () => {
  for (const type of ['vec3f', 'vec3d'] as const) {
    it(`samples official ${type} velocity grids across leaves and background`, async () => {
      const [grid] = await readNanoVdbVectors(await fixture(`velocity_${type}`));
      expect(grid).toMatchObject({ name: 'velocity', valueType: type });
      const close = (position: number[], expected: number[]) =>
        grid!.sample(position).forEach((value, i) => expect(value).toBeCloseTo(expected[i]!, 5));
      close([1, -2, 0.5], [1, -0.5, 2]);
      close([1.25, -1.75, 0.75], [1.05, -0.4, 2.15]);
      close([0.75, -2, 0.5], [0.95, -0.5, 2]);
      close([2.25, -2, 0.5], [0.7, -0.1, 1.2]);
      close([9, -2, 0.5], [1, 2, 3]);
      close([129, -2, 0.5], [4, 5, 6]);
      close([4097, -2, 0.5], [7, 8, 9]);
      close([10000, 0, 0], [0.2, 0.3, 0.4]);
      expect(() => grid!.sample([NaN, 0, 0])).toThrow(/finite vector3/);
    });
  }

  it('rejects scalar grids when a vector velocity field is requested', async () => {
    await expect(readNanoVdbVectors(await fixture('function_float'))).rejects.toThrow(/expected Vec3f or Vec3d/);
  });

  it('selects vector grids from mixed raw buffers', async () => {
    const scalarFile = writeNanoVdb('density', [1, 1, 1], new Float32Array([1]));
    const header = 16 + 176 + new DataView(scalarFile.buffer).getUint32(16 + 136, true);
    const scalar = scalarFile.subarray(header);
    const vector = await fixture('velocity_vec3f');
    const combined = new Uint8Array(scalar.length + vector.length);
    combined.set(scalar);
    combined.set(vector, scalar.length);
    const grids = await readNanoVdbVectors(combined);
    expect(grids).toHaveLength(1);
    expect(grids[0]!.sample([1, -2, 0.5])[0]).toBeCloseTo(1);
  });

  it('samples staggered MAC velocities at their component-centered locations', async () => {
    const [grid] = await readNanoVdbVectors(await fixture('velocity_staggered'));
    expect(grid!.gridClass).toBe(3);
    grid!.sample([1, -2, 0.5]).forEach((value, i) =>
      expect(value).toBeCloseTo([1.05, -0.4, 2.15][i]!, 5));
  });

  it('rejects invalid vector-grid transforms rather than sampling bogus coordinates', async () => {
    const bytes = await fixture('velocity_vec3f');
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setFloat64(456, NaN, true);
    await expect(readNanoVdbVectors(bytes)).rejects.toThrow(/invalid index-to-world transform/);
  });

  it('rejects vector-grid transforms that cannot be represented on the GPU', async () => {
    const bytes = await fixture('velocity_vec3d');
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setFloat64(456, 1e100, true);
    const [grid] = await readNanoVdbVectors(bytes);
    expect(() => nanoVdbVectorGpuData(grid!, 100_000_000)).toThrow(/outside GPU float32 range/);
    expect(() => nanoVdbVectorGpuData(grid!, 4)).toThrow(/GPU bytes/);
  });

  for (const type of ['float', 'double'] as const) {
    it(`reads ${type} grids written by the official library`, async () => {
      const [grid] = await readNanoVdb(await fixture(`function_${type}`));
      expect(grid).toMatchObject({ name: 'density', valueType: type, gridClass: 2, indexMin: [-12, -5, 0], indexMax: [71, 8, 29] });
      expect(grid!.matrix).toEqual([0.05, 0, 0, 0, 0.05, 0, 0, 0, 0.05]);
      expect(grid!.translation).toEqual([1, -2, 0.5]);
      const value = valueMap(grid!);
      const expected = readFileSync(`tests/fixtures/nanovdb/function_${type}.txt`, 'utf8').trim().split('\n').map(line => line.split(' ').map(Number));
      expect(expected.filter(([, , , v]) => v! > 0).length).toBeGreaterThan(50);
      for (const [i, j, k, v] of expected) expect(value(i!, j!, k!)).toBeCloseTo(v!, 6);
    });
  }

  it('reads the constant tiles of an official fog volume', async () => {
    const [grid] = await readNanoVdb(await fixture('sphere'));
    const value = valueMap(grid!);
    expect(value(0, 0, 0)).toBe(1);
    expect(value(0, 0, 30)).toBe(0);
    const dense = resampleNanoVdb(grid!, 16);
    expect(dense.dims.every(d => d <= 16)).toBe(true);
    expect(dense.sample([0, 0, 0])).toBeCloseTo(1, 2);
    // Like the official accessor: background (3 for this generator) outside the tree.
    expect(grid!.background).toBe(3);
    expect(dense.sample([0, 0, 40])).toBe(3);
    expect(dense.bounds.min[0]).toBeLessThan(-19);
    expect(dense.bounds.max[0]).toBeGreaterThan(19);
  });

  it('round-trips its own writer, raw buffers and ZIP segments', async () => {
    const dims: [number, number, number] = [20, 11, 9];
    const values = new Float32Array(dims[0] * dims[1] * dims[2]).map((_, n) => (n % 7 === 0 ? 0 : (n % 13) / 13));
    const file = writeNanoVdb('smoke', dims, values, { voxelSize: 0.5, origin: [-5, 0, 2] });
    const [grid] = await readNanoVdb(file);
    const value = valueMap(grid!);
    for (let n = 0; n < values.length; n += 17) {
      const i = n % dims[0], j = Math.floor(n / dims[0]) % dims[1], k = Math.floor(n / (dims[0] * dims[1]));
      expect(value(i, j, k)).toBeCloseTo(values[n]!, 6);
    }
    // Raw grid buffer (no file header).
    const nameSize = new DataView(file.buffer).getUint32(16 + 136, true);
    const raw = file.slice(16 + 176 + nameSize);
    expect((await readNanoVdb(raw))[0]!.name).toBe('smoke');
    // ZIP segment: u64 compressed size, then a zlib stream.
    const compressed = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
    const zipped = new Uint8Array(16 + 176 + nameSize + 8 + compressed.length);
    zipped.set(file.subarray(0, 16 + 176 + nameSize));
    const view = new DataView(zipped.buffer);
    view.setUint16(14, 1, true);
    view.setBigUint64(16 + 8, BigInt(8 + compressed.length), true);
    view.setBigUint64(16 + 176 + nameSize, BigInt(compressed.length), true);
    zipped.set(compressed, 16 + 176 + nameSize + 8);
    const [unzipped] = await readNanoVdb(zipped);
    expect(valueMap(unzipped!)(3, 4, 5)).toBeCloseTo(values[(5 * dims[1] + 4) * dims[0] + 3]!, 6);
    // A dense resample at full resolution reproduces voxel values at voxel centers.
    const dense = resampleNanoVdb(grid!);
    expect(dense.sample([-5 + 3 * 0.5, 4 * 0.5, 2 + 5 * 0.5])).toBeCloseTo(values[(5 * dims[1] + 4) * dims[0] + 3]!, 5);
  });

  it('explains unsupported inputs', async () => {
    const vdb = new Uint8Array(16);
    vdb.set([0x20, 0x42, 0x44, 0x0b]);
    await expect(readNanoVdb(vdb)).rejects.toThrow('convert them with nanovdb_convert');
    const blosc = writeNanoVdb('x', [8, 8, 8], new Float32Array(512).fill(1));
    new DataView(blosc.buffer).setUint16(14, 2, true);
    await expect(readNanoVdb(blosc)).rejects.toThrow('BLOSC');
  });
});
