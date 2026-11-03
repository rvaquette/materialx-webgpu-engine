import type { DecodedPixelImage } from './images.ts';
import { AssetResolver } from './resolver.ts';

export const UDIM_COLUMNS = 10;
export const UDIM_ROWS = 100;

export function udimTileAt(u: number, v: number): number | undefined {
  if (!Number.isFinite(u) || !Number.isFinite(v) || u < 0 || u >= UDIM_COLUMNS || v < 0 || v >= UDIM_ROWS) return undefined;
  const tile = 1001 + Math.floor(u) + UDIM_COLUMNS * Math.floor(v);
  return tile <= 1999 ? tile : undefined;
}

/** Build a URL inventory without requesting guessed or missing tile filenames. */
export function indexUdimFiles(files: readonly string[], base: string): ReadonlyMap<string, readonly number[]> {
  const index = new Map<string, number[]>();
  for (const file of files) {
    const url = new URL(file, base);
    const match = /^(.*)\.(1\d{3})(\.[^/.]+)$/.exec(url.pathname);
    if (!match || Number(match[2]) < 1001) continue;
    url.pathname = `${match[1]}.<UDIM>${match[3]}`;
    const tiles = index.get(url.href) ?? [];
    const tile = Number(match[2]);
    if (!tiles.includes(tile)) tiles.push(tile);
    index.set(url.href, tiles);
  }
  for (const tiles of index.values()) tiles.sort((a, b) => a - b);
  return index;
}

export async function decodeUdimImage(
  file: string,
  tiles: readonly number[],
  decode: (url: string) => Promise<DecodedPixelImage | undefined>,
): Promise<DecodedPixelImage> {
  if (tiles.length === 0) throw new Error(`No UDIM tiles inventoried for ${file}. Rebuild after adding textures.`);
  const layers: { tile: number; image: DecodedPixelImage }[] = [];
  for (const tile of tiles) {
    if (!Number.isInteger(tile) || tile < 1001 || tile > 1999 || layers.some(layer => layer.tile === tile)) {
      throw new Error(`Invalid or duplicate UDIM tile ${tile}: ${file}`);
    }
    const image = await decode(AssetResolver.expandUdim(file, tile));
    if (!image) throw new Error(`Missing UDIM tile ${tile}: ${file}`);
    if (image.componentType !== 'uint8' || image.channels !== 4 || image.udim ||
        image.width < 1 || image.height < 1 || image.data.length !== image.width * image.height * 4) {
      throw new Error(`UDIM tile ${tile} requires decoded RGBA8 pixels: ${file}`);
    }
    layers.push({ tile, image });
  }
  const first = layers[0]!.image;
  for (const { tile, image } of layers) {
    if (image.width !== first.width || image.height !== first.height || image.colorSpace !== first.colorSpace) {
      throw new Error(`UDIM tiles must have matching dimensions and colorspace (tile ${tile}): ${file}`);
    }
  }
  return { ...first, udim: layers };
}

/** Zero means no tile; populated entries store the array layer plus one. */
export function udimLayerIndex(image: DecodedPixelImage): Uint32Array {
  if (!image.udim?.length) throw new Error('Missing decoded UDIM tiles.');
  const index = new Uint32Array(UDIM_COLUMNS * UDIM_ROWS);
  image.udim.forEach(({ tile }, layer) => { index[tile - 1001] = layer + 1; });
  return index;
}
