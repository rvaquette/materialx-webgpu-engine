// NanoVDB grids (https://github.com/AcademySoftwareFoundation/openvdb, nanovdb/NanoVDB.h,
// ABI major version 32). Reads raw grid buffers and .nvdb files (codec NONE or ZIP;
// BLOSC is reported), for Float, Half and Double grids, and resamples them into a
// dense field. Values are located at integer index coordinates and mapped to
// world space by the grid's affine map (row-major 3x3 matrix + translation).
// The tree is not traversed: NanoVDB stores each node level as a fixed-size
// array, so leaves and constant tiles are visited directly. A small writer
// produces Float grids for tests and generated control scenes.

export type NanoVdbValueType = 'float' | 'half' | 'double';

export interface NanoVdbGrid {
  name: string;
  valueType: NanoVdbValueType;
  /** NanoVDB GridClass (1 level set, 2 fog volume...). */
  gridClass: number;
  /** Index-to-world map: world = matrix * ijk + translation (row-major matrix). */
  matrix: readonly number[];
  translation: readonly number[];
  inverse: readonly number[];
  /** Index bounding box of the active values. */
  indexMin: readonly [number, number, number];
  indexMax: readonly [number, number, number];
  background: number;
  /** Visits every stored value block: leaf voxels (size 1) and constant tiles (size 8, 128 or 4096). */
  forEachValue(visit: (i: number, j: number, k: number, size: number, value: number) => void): void;
}

export class NanoVdbError extends Error {
  override readonly name = 'NanoVdbError';
}

const MAGIC = 'NanoVDB';
const GRID_SIZE = 672;
const TREE_SIZE = 64;
const TYPES: Record<number, NanoVdbValueType> = { 1: 'float', 2: 'double', 9: 'half' };
const VALUE_BYTES: Record<NanoVdbValueType, number> = { float: 4, half: 2, double: 8 };
const LEAF_BYTES: Record<NanoVdbValueType, number> = { float: 2144, half: 1120, double: 4224 };
const LEAF_VALUES: Record<NanoVdbValueType, number> = { float: 96, half: 96, double: 128 };
const ROOT_BYTES: Record<NanoVdbValueType, number> = { float: 64, half: 64, double: 96 };
const TILE_VALUE: Record<NanoVdbValueType, number> = { float: 20, half: 20, double: 24 };
const LOWER = { log2: 4, table: 1088, bytes: 1088 + 4096 * 8, total: 7 };
const UPPER = { log2: 5, table: 8256, bytes: 8256 + 32768 * 8, total: 12 };

function magicKind(view: DataView, offset: number): string | undefined {
  if (view.byteLength < offset + 8) return undefined;
  let text = '';
  for (let i = 0; i < 7; i++) text += String.fromCharCode(view.getUint8(offset + i));
  return text === MAGIC ? String.fromCharCode(view.getUint8(offset + 7)) : undefined;
}

function readValue(view: DataView, offset: number, type: NanoVdbValueType): number {
  if (type === 'float') return view.getFloat32(offset, true);
  if (type === 'double') return view.getFloat64(offset, true);
  const bits = view.getUint16(offset, true);
  const exponent = (bits >> 10) & 0x1f, fraction = bits & 0x3ff, sign = bits & 0x8000 ? -1 : 1;
  if (exponent === 0) return sign * 2 ** -14 * (fraction / 1024);
  if (exponent === 31) return fraction ? NaN : sign * Infinity;
  return sign * 2 ** (exponent - 15) * (1 + fraction / 1024);
}

function bitOn(view: DataView, maskOffset: number, n: number): boolean {
  return (view.getUint8(maskOffset + (n >> 3)) & (1 << (n & 7))) !== 0;
}

/** One grid buffer (GridData at `base`). */
function parseGrid(view: DataView, base: number): NanoVdbGrid {
  const kind = magicKind(view, base);
  if (kind !== '0' && kind !== '1') throw new NanoVdbError('Not a NanoVDB grid buffer.');
  const major = view.getUint32(base + 16, true) >>> 21;
  if (major !== 32) throw new NanoVdbError(`Unsupported NanoVDB version ${major}; this reader expects major version 32.`);
  const gridType = view.getUint32(base + 636, true);
  const valueType = TYPES[gridType];
  if (!valueType) throw new NanoVdbError(`Unsupported NanoVDB grid type ${gridType}; use Float, Half or Double grids.`);
  let name = '';
  for (let i = 0; i < 256; i++) {
    const c = view.getUint8(base + 40 + i);
    if (c === 0) break;
    name += String.fromCharCode(c);
  }
  const doubles = (offset: number, count: number): number[] =>
    Array.from({ length: count }, (_, i) => view.getFloat64(base + offset + i * 8, true));
  const matrix = doubles(384, 9), inverse = doubles(456, 9), translation = doubles(528, 3);
  const tree = base + GRID_SIZE;
  const nodeOffset = (level: number): number => Number(view.getBigInt64(tree + level * 8, true));
  const nodeCount = (level: number): number => view.getUint32(tree + 32 + level * 4, true);
  const root = tree + nodeOffset(3);
  const int3 = (offset: number): [number, number, number] =>
    [view.getInt32(offset, true), view.getInt32(offset + 4, true), view.getInt32(offset + 8, true)];
  const indexMin = int3(root), indexMax = int3(root + 12);
  const tableSize = view.getUint32(root + 24, true);
  const background = readValue(view, root + (valueType === 'double' ? 32 : 28), valueType);
  const leafBytes = LEAF_BYTES[valueType];
  const forEachValue = (visit: (i: number, j: number, k: number, size: number, value: number) => void): void => {
    const leaves = tree + nodeOffset(0);
    for (let n = 0; n < nodeCount(0); n++) {
      const leaf = leaves + n * leafBytes;
      const [x0, y0, z0] = int3(leaf).map(v => v & ~7) as [number, number, number];
      const values = leaf + LEAF_VALUES[valueType];
      for (let v = 0; v < 512; v++) {
        visit(x0 + (v >> 6), y0 + ((v >> 3) & 7), z0 + (v & 7), 1, readValue(view, values + v * VALUE_BYTES[valueType], valueType));
      }
    }
    // Constant tiles of the internal nodes (children are visited through their own arrays).
    for (const [level, node] of [[1, LOWER], [2, UPPER]] as const) {
      const first = tree + nodeOffset(level);
      const dim = 1 << node.log2, tile = 1 << (node.total - node.log2);
      const maskBytes = (1 << (3 * node.log2)) / 8;
      for (let n = 0; n < nodeCount(level); n++) {
        const at = first + n * node.bytes;
        const origin = int3(at).map(v => v & ~((1 << node.total) - 1));
        const childMask = at + 32 + maskBytes;
        for (let t = 0; t < dim ** 3; t++) {
          if (bitOn(view, childMask, t)) continue;
          const value = readValue(view, at + node.table + t * 8, valueType);
          if (value === background) continue;
          visit(origin[0]! + (t >> (2 * node.log2)) * tile, origin[1]! + ((t >> node.log2) & (dim - 1)) * tile,
            origin[2]! + (t & (dim - 1)) * tile, tile, value);
        }
      }
    }
    const tiles = root + ROOT_BYTES[valueType];
    for (let t = 0; t < tableSize; t++) {
      const at = tiles + t * 32;
      if (view.getBigInt64(at + 8, true) !== 0n) continue;
      const value = readValue(view, at + TILE_VALUE[valueType], valueType);
      if (value === background) continue;
      const key = view.getBigUint64(at, true);
      const coord = [key >> 42n, (key >> 21n) & 0x1fffffn, key & 0x1fffffn]
        .map(v => (Number(v) << 12) | 0);
      visit(coord[0]!, coord[1]!, coord[2]!, 4096, value);
    }
  };
  return {
    name, valueType, gridClass: view.getUint32(base + 632, true), matrix, translation, inverse,
    indexMin, indexMax, background, forEachValue,
  };
}

async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Decode grid buffers shared by the scalar and vector readers. */
async function readGridBuffers(input: ArrayBuffer | Uint8Array): Promise<DataView[]> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const kind = magicKind(view, 0);
  if (!kind) {
    throw new NanoVdbError(new TextDecoder().decode(bytes.subarray(0, 4)) === ' BD\u000b'
      ? 'OpenVDB (.vdb) files are not read directly; convert them with nanovdb_convert to .nvdb.'
      : 'Not a NanoVDB file.');
  }
  const looksLikeFile = kind !== '1' && view.byteLength >= 16 + 176 && view.getUint32(8, true) >>> 21 === 32
    && view.getUint16(12, true) > 0 && view.getUint16(14, true) <= 2
    && Number(view.getBigUint64(16, true)) >= GRID_SIZE + TREE_SIZE && view.getUint32(16 + 136, true) <= 257;
  const grids: DataView[] = [];
  if (!looksLikeFile) {
    for (let offset = 0; offset < view.byteLength;) {
      const size = Number(view.getBigUint64(offset + 32, true));
      if (!Number.isSafeInteger(size) || size < GRID_SIZE + TREE_SIZE || offset + size > view.byteLength) {
        throw new NanoVdbError('Invalid or truncated NanoVDB grid buffer.');
      }
      grids.push(new DataView(bytes.buffer, bytes.byteOffset + offset, size));
      offset += size;
    }
    return grids;
  }
  let offset = 0;
  while (offset + 16 <= view.byteLength && magicKind(view, offset)) {
    const count = view.getUint16(offset + 12, true), codec = view.getUint16(offset + 14, true);
    if (codec === 2) throw new NanoVdbError('BLOSC-compressed NanoVDB files are not supported; re-save them with ZIP or no compression.');
    offset += 16;
    const sizes: Array<{ grid: number; file: number }> = [];
    for (let g = 0; g < count; g++) {
      sizes.push({ grid: Number(view.getBigUint64(offset, true)), file: Number(view.getBigUint64(offset + 8, true)) });
      offset += 176 + view.getUint32(offset + 136, true);
    }
    for (const { grid, file } of sizes) {
      let buffer: Uint8Array;
      if (codec === 1) {
        const compressed = Number(view.getBigUint64(offset, true));
        buffer = await inflate(bytes.subarray(offset + 8, offset + 8 + compressed));
      } else {
        buffer = bytes.slice(offset, offset + grid);
      }
      if (buffer.byteLength !== grid) throw new NanoVdbError('Truncated NanoVDB grid.');
      grids.push(new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength));
      offset += file;
    }
  }
  return grids;
}

/** All scalar grids of a .nvdb file or raw NanoVDB buffer. */
export async function readNanoVdb(input: ArrayBuffer | Uint8Array): Promise<NanoVdbGrid[]> {
  return (await readGridBuffers(input)).map(view => parseGrid(view, 0));
}

export interface NanoVdbVectorGrid {
  name: string;
  valueType: 'vec3f' | 'vec3d';
  gridClass: number;
  background: readonly [number, number, number];
  /** Trilinear interpolation in grid world space, including background outside the tree. */
  sample(position: readonly number[]): [number, number, number];
}

/** Reads vector velocity grids without downsampling their sparse values. */
export async function readNanoVdbVectors(input: ArrayBuffer | Uint8Array): Promise<NanoVdbVectorGrid[]> {
  const views = await readGridBuffers(input);
  for (const view of views) {
    const kind = magicKind(view, 0);
    if (kind !== '0' && kind !== '1') throw new NanoVdbError('Not a NanoVDB grid buffer.');
    const major = view.getUint32(16, true) >>> 21;
    if (major !== 32) throw new NanoVdbError(`Unsupported NanoVDB version ${major}; this reader expects major version 32.`);
  }
  const vectorViews = views.filter(view => [6, 7].includes(view.getUint32(636, true)));
  if (!vectorViews.length) throw new NanoVdbError('No vector velocity grid found; expected Vec3f or Vec3d.');
  return vectorViews.map(view => {
    const type = view.getUint32(636, true);
    const isDouble = type === 7;
    const layout = isDouble
      ? { width: 8, leafSize: 12448, leafValues: 160, rootSize: 128, rootBackground: 32, tileSize: 64, tileValue: 24,
        lowerSize: 99424, lowerTable: 1120, upperSize: 794720, upperTable: 8288, stride: 24 }
      : { width: 4, leafSize: 6272, leafValues: 128, rootSize: 96, rootBackground: 28, tileSize: 32, tileValue: 20,
        lowerSize: 66624, lowerTable: 1088, upperSize: 532544, upperTable: 8256, stride: 16 };
    const vector = (offset: number): [number, number, number] => [0, 1, 2].map(i =>
      isDouble ? view.getFloat64(offset + i * layout.width, true) : view.getFloat32(offset + i * layout.width, true)) as [number, number, number];
    let name = '';
    for (let i = 0; i < 256; i++) {
      const c = view.getUint8(40 + i);
      if (!c) break;
      name += String.fromCharCode(c);
    }
    const doubles = (offset: number, count: number) => Array.from({ length: count }, (_, i) => view.getFloat64(offset + i * 8, true));
    const inverse = doubles(456, 9), translation = doubles(528, 3);
    const determinant = inverse[0]! * (inverse[4]! * inverse[8]! - inverse[5]! * inverse[7]!)
      - inverse[1]! * (inverse[3]! * inverse[8]! - inverse[5]! * inverse[6]!)
      + inverse[2]! * (inverse[3]! * inverse[7]! - inverse[4]! * inverse[6]!);
    if (![...inverse, ...translation, determinant].every(Number.isFinite) || determinant === 0) {
      throw new NanoVdbError(`Grid '${name}' has an invalid index-to-world transform.`);
    }
    const gridClass = view.getUint32(632, true);
    const tree = GRID_SIZE;
    const nodeOffset = (level: number) => Number(view.getBigInt64(tree + level * 8, true));
    const nodeCount = (level: number) => view.getUint32(tree + 32 + level * 4, true);
    const int3 = (offset: number) => [view.getInt32(offset, true), view.getInt32(offset + 4, true), view.getInt32(offset + 8, true)];
    const key = (p: readonly number[], total: number) => p.map(v => v & ~((1 << total) - 1)).join(',');
    const nodes = (level: number, size: number, total: number): Map<string, number> => {
      const result = new Map<string, number>();
      const first = tree + nodeOffset(level);
      for (let i = 0; i < nodeCount(level); i++) {
        const offset = first + i * size;
        result.set(key(int3(offset), total), offset);
      }
      return result;
    };
    const leaves = nodes(0, layout.leafSize, 3);
    const lowers = nodes(1, layout.lowerSize, 7);
    const uppers = nodes(2, layout.upperSize, 12);
    const root = tree + nodeOffset(3);
    const background = vector(root + layout.rootBackground);
    const roots = new Map<string, number>();
    for (let i = 0; i < view.getUint32(root + 24, true); i++) {
      const offset = root + layout.rootSize + i * layout.tileSize;
      const bits = view.getBigUint64(offset, true);
      const origin = [bits >> 42n, (bits >> 21n) & 0x1fffffn, bits & 0x1fffffn].map(v => (Number(v) << 12) | 0);
      roots.set(origin.join(','), offset);
    }
    const lookup = (p: readonly number[]): [number, number, number] => {
      const leaf = leaves.get(key(p, 3));
      if (leaf !== undefined) {
        const index = ((p[0]! & 7) << 6) | ((p[1]! & 7) << 3) | (p[2]! & 7);
        return vector(leaf + layout.leafValues + index * 3 * layout.width);
      }
      const tile = (node: number, log2: number, childBits: number, table: number): [number, number, number] => {
        const mask = (1 << log2) - 1;
        const index = (((p[0]! >> childBits) & mask) << (2 * log2))
          | (((p[1]! >> childBits) & mask) << log2) | ((p[2]! >> childBits) & mask);
        const childMask = node + 32 + (1 << (3 * log2)) / 8;
        if (bitOn(view, childMask, index)) throw new NanoVdbError(`Grid '${name}' has an invalid child node.`);
        return vector(node + table + index * layout.stride);
      };
      const lower = lowers.get(key(p, 7));
      if (lower !== undefined) return tile(lower, 4, 3, layout.lowerTable);
      const upper = uppers.get(key(p, 12));
      if (upper !== undefined) return tile(upper, 5, 7, layout.upperTable);
      const rootTile = roots.get(key(p, 12));
      if (rootTile === undefined) return [...background];
      if (view.getBigInt64(rootTile + 8, true) !== 0n) throw new NanoVdbError(`Grid '${name}' has an invalid root child.`);
      return vector(rootTile + layout.tileValue);
    };
    const sampleIndex = (coord: readonly number[]): [number, number, number] => {
      if (coord.some(value => !Number.isFinite(value))) throw new NanoVdbError(`Grid '${name}' produced invalid index coordinates.`);
      if (coord.some(value => value < -2147483648 || value >= 2147483647)) {
        return [...background];
      }
      const lower = coord.map(Math.floor), fraction = coord.map((v, i) => v - lower[i]!);
      const result: [number, number, number] = [0, 0, 0];
      for (let c = 0; c < 8; c++) {
        const point = lower.map((value, i) => value + ((c >> i) & 1));
        const weight = fraction.reduce((w, value, i) => w * ((c >> i) & 1 ? value : 1 - value), 1);
        const value = lookup(point);
        for (let i = 0; i < 3; i++) result[i]! += weight * value[i]!;
      }
      return result;
    };
    const sample = (position: readonly number[]): [number, number, number] => {
      if (position.length !== 3 || !position.every(Number.isFinite)) throw new NanoVdbError('NanoVDB sample position must be a finite vector3.');
      const d = position.map((value, i) => value - translation[i]!);
      const coord = [0, 1, 2].map(r => inverse[r * 3]! * d[0]! + inverse[r * 3 + 1]! * d[1]! + inverse[r * 3 + 2]! * d[2]!);
      if (gridClass !== 3) return sampleIndex(coord);
      return [0, 1, 2].map(axis =>
        sampleIndex(coord.map((value, i) => value + (i === axis ? 0.5 : 0)))[axis]!) as [number, number, number];
    };
    return { name, valueType: isDouble ? 'vec3d' : 'vec3f', gridClass, background, sample };
  });
}

export interface DenseField {
  /** Local (grid world space) bounds of the field. */
  bounds: { min: [number, number, number]; max: [number, number, number] };
  dims: [number, number, number];
  data: Float32Array;
  /** Trilinear value at a point of the grid's world space (background outside). */
  sample(position: readonly number[]): number;
}

/** Box-filtered dense copy of a grid with at most `maxDim` cells per axis. */
export function resampleNanoVdb(grid: NanoVdbGrid, maxDim = 128): DenseField {
  const min = grid.indexMin, max = grid.indexMax;
  const extent = [0, 1, 2].map(a => max[a]! - min[a]! + 1);
  if (extent.some(e => !(e > 0))) throw new NanoVdbError(`Grid '${grid.name}' has no active values.`);
  const factor = Math.max(1, Math.ceil(Math.max(...extent) / maxDim));
  const dims = extent.map(e => Math.ceil(e / factor)) as [number, number, number];
  const sums = new Float64Array(dims[0] * dims[1] * dims[2]).fill(grid.background * factor ** 3);
  const cellOf = (index: number, axis: number): number => Math.floor((index - min[axis]!) / factor);
  grid.forEachValue((i, j, k, size, value) => {
    const delta = value - grid.background;
    if (delta === 0) return;
    if (size === 1) {
      const c = [cellOf(i, 0), cellOf(j, 1), cellOf(k, 2)];
      if (c.some((v, a) => v < 0 || v >= dims[a]!)) return;
      sums[(c[2]! * dims[1] + c[1]!) * dims[0] + c[0]!]! += delta;
      return;
    }
    // A tile adds its value to every overlapped cell, weighted by the overlap.
    const lo = [i, j, k], ranges = lo.map((start, a) => {
      const from = Math.max(start, min[a]!), to = Math.min(start + size - 1, max[a]!);
      return from > to ? undefined : [from, to] as const;
    });
    if (ranges.some(r => !r)) return;
    for (let cz = cellOf(ranges[2]![0], 2); cz <= cellOf(ranges[2]![1], 2); cz++) {
      for (let cy = cellOf(ranges[1]![0], 1); cy <= cellOf(ranges[1]![1], 1); cy++) {
        for (let cx = cellOf(ranges[0]![0], 0); cx <= cellOf(ranges[0]![1], 0); cx++) {
          const overlap = [cx, cy, cz].reduce((product, c, a) => {
            const from = Math.max(ranges[a]![0], min[a]! + c * factor), to = Math.min(ranges[a]![1], min[a]! + (c + 1) * factor - 1);
            return product * Math.max(0, to - from + 1);
          }, 1);
          sums[(cz * dims[1] + cy) * dims[0] + cx]! += delta * overlap;
        }
      }
    }
  });
  const data = Float32Array.from(sums, v => v / factor ** 3);
  const m = grid.matrix, t = grid.translation, inv = grid.inverse;
  const corners = [0, 1, 2, 3, 4, 5, 6, 7].map(c => [0, 1, 2].map(a => (c >> a) & 1 ? max[a]! + 0.5 : min[a]! - 0.5));
  const world = corners.map(p => [0, 1, 2].map(r => m[r * 3]! * p[0]! + m[r * 3 + 1]! * p[1]! + m[r * 3 + 2]! * p[2]! + t[r]!));
  const bounds = {
    min: [0, 1, 2].map(a => Math.min(...world.map(p => p[a]!))) as [number, number, number],
    max: [0, 1, 2].map(a => Math.max(...world.map(p => p[a]!))) as [number, number, number],
  };
  const sample = (position: readonly number[]): number => {
    const d = [0, 1, 2].map(a => position[a]! - t[a]!);
    const ijk = [0, 1, 2].map(r => inv[r * 3]! * d[0]! + inv[r * 3 + 1]! * d[1]! + inv[r * 3 + 2]! * d[2]!);
    // Cell c holds the average of indices [min + c*factor, min + (c+1)*factor - 1].
    const coord = ijk.map((v, a) => (v - min[a]! + 0.5) / factor - 0.5);
    if (coord.some((v, a) => v < -0.5 || v > dims[a]! - 0.5)) return grid.background;
    const lower = coord.map(Math.floor), fraction = coord.map((v, a) => v - lower[a]!);
    let value = 0;
    for (let corner = 0; corner < 8; corner++) {
      const cell = [0, 1, 2].map(a => Math.min(dims[a]! - 1, Math.max(0, lower[a]! + ((corner >> a) & 1))));
      const weight = [0, 1, 2].reduce((w, a) => w * ((corner >> a) & 1 ? fraction[a]! : 1 - fraction[a]!), 1);
      value += weight * data[(cell[2]! * dims[1] + cell[1]!) * dims[0] + cell[0]!]!;
    }
    return value;
  };
  return { bounds, dims, data, sample };
}

/** A Float fog-volume grid (Codec NONE .nvdb file) from dense values; index (0,0,0) sits at `origin`. */
export function writeNanoVdb(
  name: string, dims: readonly [number, number, number], values: Float32Array,
  options: { voxelSize?: number; origin?: readonly [number, number, number]; gridClass?: number } = {},
): Uint8Array {
  const voxel = options.voxelSize ?? 1, origin = options.origin ?? [0, 0, 0];
  const at = (i: number, j: number, k: number): number =>
    i < dims[0] && j < dims[1] && k < dims[2] ? values[(k * dims[1] + j) * dims[0] + i]! : 0;
  // Leaves for every 8^3 block holding a non-zero value, grouped into lower and upper nodes.
  type Block = { origin: [number, number, number] };
  const leaves: Array<Block & { values: Float32Array; mask: Uint8Array; min: number[]; max: number[] }> = [];
  for (let x = 0; x < dims[0]; x += 8) for (let y = 0; y < dims[1]; y += 8) for (let z = 0; z < dims[2]; z += 8) {
    const block = new Float32Array(512), mask = new Uint8Array(64);
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let v = 0; v < 512; v++) {
      const p = [x + (v >> 6), y + ((v >> 3) & 7), z + (v & 7)];
      block[v] = at(p[0]!, p[1]!, p[2]!);
      if (block[v] !== 0) {
        mask[v >> 3]! |= 1 << (v & 7);
        p.forEach((c, a) => { lo[a] = Math.min(lo[a]!, c); hi[a] = Math.max(hi[a]!, c); });
      }
    }
    if (lo[0] !== Infinity) leaves.push({ origin: [x, y, z], values: block, mask, min: lo, max: hi });
  }
  const group = <T extends Block>(children: T[], total: number) => {
    const nodes = new Map<string, { origin: [number, number, number]; children: T[] }>();
    for (const child of children) {
      const o = child.origin.map(v => v & ~((1 << total) - 1)) as [number, number, number];
      const key = o.join(',');
      if (!nodes.has(key)) nodes.set(key, { origin: o, children: [] });
      nodes.get(key)!.children.push(child);
    }
    return [...nodes.values()];
  };
  const lowers = group(leaves, LOWER.total);
  const uppers = group(lowers, UPPER.total);
  // Breadth-first order: upper, lower and leaf arrays follow the same traversal.
  const lowerOrder = uppers.flatMap(u => u.children);
  const leafOrder = lowerOrder.flatMap(l => l.children);
  const rootOffset = TREE_SIZE, tilesOffset = rootOffset + ROOT_BYTES.float;
  const upperOffset = tilesOffset + uppers.length * 32;
  const lowerOffset = upperOffset + uppers.length * UPPER.bytes;
  const leafOffset = lowerOffset + lowerOrder.length * LOWER.bytes;
  const gridSize = GRID_SIZE + leafOffset + leafOrder.length * LEAF_BYTES.float;
  const buffer = new Uint8Array(gridSize);
  const view = new DataView(buffer.buffer);
  const tree = GRID_SIZE;
  const activeMin = [0, 1, 2].map(a => Math.min(...leaves.map(l => l.min[a]!)));
  const activeMax = [0, 1, 2].map(a => Math.max(...leaves.map(l => l.max[a]!)));
  let minimum = Infinity, maximum = -Infinity, sum = 0, count = 0;
  for (const leaf of leaves) for (const v of leaf.values) if (v !== 0) { minimum = Math.min(minimum, v); maximum = Math.max(maximum, v); sum += v; count++; }
  const putInts = (offset: number, ints: readonly number[]) => ints.forEach((v, i) => view.setInt32(offset + i * 4, v, true));
  // GridData.
  [...MAGIC, '0'].forEach((c, i) => view.setUint8(i, c.charCodeAt(0)));
  view.setBigUint64(8, 0xffffffffffffffffn, true);
  view.setUint32(16, (32 << 21) | (11 << 10), true);
  view.setUint32(20, (1 << 1) | (1 << 2) | (1 << 5), true);
  view.setUint32(28, 1, true);
  view.setBigUint64(32, BigInt(gridSize), true);
  [...name.slice(0, 255)].forEach((c, i) => view.setUint8(40 + i, c.charCodeAt(0)));
  const mat = [voxel, 0, 0, 0, voxel, 0, 0, 0, voxel], inv = [1 / voxel, 0, 0, 0, 1 / voxel, 0, 0, 0, 1 / voxel];
  mat.forEach((v, i) => view.setFloat32(296 + i * 4, v, true));
  inv.forEach((v, i) => view.setFloat32(332 + i * 4, v, true));
  origin.forEach((v, i) => view.setFloat32(368 + i * 4, v, true));
  view.setFloat32(380, 1, true);
  mat.forEach((v, i) => view.setFloat64(384 + i * 8, v, true));
  inv.forEach((v, i) => view.setFloat64(456 + i * 8, v, true));
  origin.forEach((v, i) => view.setFloat64(528 + i * 8, v, true));
  view.setFloat64(552, 1, true);
  [0, 1, 2].forEach(a => {
    view.setFloat64(560 + a * 8, origin[a]! + activeMin[a]! * voxel, true);
    view.setFloat64(584 + a * 8, origin[a]! + (activeMax[a]! + 1) * voxel, true);
    view.setFloat64(608 + a * 8, voxel, true);
  });
  view.setUint32(632, options.gridClass ?? 2, true);
  view.setUint32(636, 1, true);
  // TreeData: offsets of leaf, lower, upper and root arrays from the tree.
  [leafOffset, lowerOffset, upperOffset, rootOffset].forEach((v, i) => view.setBigInt64(tree + i * 8, BigInt(v), true));
  [leafOrder.length, lowerOrder.length, uppers.length].forEach((v, i) => view.setUint32(tree + 32 + i * 4, v, true));
  view.setBigUint64(tree + 56, BigInt(count), true);
  // RootData and its tiles (sorted keys, one child per upper node).
  const root = tree + rootOffset;
  putInts(root, [...activeMin, ...activeMax]);
  view.setUint32(root + 24, uppers.length, true);
  view.setFloat32(root + 32, count ? minimum : 0, true);
  view.setFloat32(root + 36, count ? maximum : 0, true);
  view.setFloat32(root + 40, count ? sum / count : 0, true);
  const key = (o: readonly number[]): bigint =>
    (BigInt((o[0]! >>> 12) & 0x1fffff) << 42n) | (BigInt((o[1]! >>> 12) & 0x1fffff) << 21n) | BigInt((o[2]! >>> 12) & 0x1fffff);
  const sortedUppers = uppers.map((upper, index) => ({ upper, index })).sort((a, b) => (key(a.upper.origin) < key(b.upper.origin) ? -1 : 1));
  sortedUppers.forEach(({ upper, index }, t) => {
    const tile = tree + tilesOffset + t * 32;
    view.setBigUint64(tile, key(upper.origin), true);
    view.setBigInt64(tile + 8, BigInt(upperOffset + index * UPPER.bytes - rootOffset), true);
  });
  const writeInternal = (at: number, node: typeof LOWER, nodeOrigin: readonly number[], children: Array<{ origin: number[] | [number, number, number] }>, childBase: number, childBytes: number, firstChild: number) => {
    const maskBytes = (1 << (3 * node.log2)) / 8;
    putInts(at, [...nodeOrigin, ...nodeOrigin.map(v => v + (1 << node.total) - 1)]);
    const tile = 1 << (node.total - node.log2), dim = 1 << node.log2;
    children.forEach((child, c) => {
      const local = child.origin.map((v, a) => (v - nodeOrigin[a]!) / tile);
      const n = (local[0]! * dim + local[1]!) * dim + local[2]!;
      view.setUint8(at + 32 + maskBytes + (n >> 3), view.getUint8(at + 32 + maskBytes + (n >> 3)) | (1 << (n & 7)));
      view.setBigInt64(at + node.table + n * 8, BigInt(childBase + (firstChild + c) * childBytes - (at - tree)), true);
    });
  };
  let lowerIndex = 0, leafIndex = 0;
  uppers.forEach((upper, u) => {
    writeInternal(tree + upperOffset + u * UPPER.bytes, UPPER, upper.origin, upper.children, lowerOffset, LOWER.bytes, lowerIndex);
    lowerIndex += upper.children.length;
  });
  lowerOrder.forEach((lower, l) => {
    writeInternal(tree + lowerOffset + l * LOWER.bytes, LOWER, lower.origin, lower.children, leafOffset, LEAF_BYTES.float, leafIndex);
    leafIndex += lower.children.length;
  });
  leafOrder.forEach((leaf, n) => {
    const at = tree + leafOffset + n * LEAF_BYTES.float;
    putInts(at, leaf.min);
    leaf.max.forEach((v, a) => view.setUint8(at + 12 + a, v - leaf.min[a]!));
    view.setUint8(at + 15, 1 << 1);
    buffer.set(leaf.mask, at + 16);
    leaf.values.forEach((v, i) => view.setFloat32(at + 96 + i * 4, v, true));
  });
  // File segment: header, metadata and name, then the uncompressed grid.
  const nameBytes = new TextEncoder().encode(`${name}\0`);
  const file = new Uint8Array(16 + 176 + nameBytes.length + gridSize);
  const out = new DataView(file.buffer);
  [...MAGIC, '0'].forEach((c, i) => out.setUint8(i, c.charCodeAt(0)));
  out.setUint32(8, (32 << 21) | (11 << 10), true);
  out.setUint16(12, 1, true);
  const meta = 16;
  out.setBigUint64(meta, BigInt(gridSize), true);
  out.setBigUint64(meta + 8, BigInt(gridSize), true);
  out.setBigUint64(meta + 24, BigInt(count), true);
  out.setUint32(meta + 32, 1, true);
  out.setUint32(meta + 36, options.gridClass ?? 2, true);
  for (let i = 0; i < 6; i++) out.setFloat64(meta + 40 + i * 8, view.getFloat64(560 + i * 8, true), true);
  [...activeMin, ...activeMax].forEach((v, i) => out.setInt32(meta + 88 + i * 4, v, true));
  for (let i = 0; i < 3; i++) out.setFloat64(meta + 112 + i * 8, voxel, true);
  out.setUint32(meta + 136, nameBytes.length, true);
  [leafOrder.length, lowerOrder.length, uppers.length, 1].forEach((v, i) => out.setUint32(meta + 140 + i * 4, v, true));
  out.setUint32(meta + 172, (32 << 21) | (11 << 10), true);
  file.set(nameBytes, meta + 176);
  file.set(buffer, meta + 176 + nameBytes.length);
  return file;
}
