import { indexUdimFiles, matchUdimFiles } from './udim.ts';
import { AssetResolver } from './resolver.ts';

const files = Object.keys(import.meta.glob([
  '/scenes/**/*1[0-9][0-9][0-9]*.{jpg,jpeg,png,webp,tif,tiff,exr,hdr,tga,bmp}',
  '/scenes/**/*1[0-9][0-9][0-9]*/**/*.{jpg,jpeg,png,webp,tif,tiff,exr,hdr,tga,bmp}',
], { query: '?url', import: 'default' })).map(path => `.${path}`);
let cachedBase: string | undefined;
let cachedIndex: ReadonlyMap<string, readonly number[]> | undefined;
const matches = new Map<string, readonly number[]>();

export function sceneUdimIndex(base: string): ReadonlyMap<string, readonly number[]> {
  if (cachedBase !== base || !cachedIndex) {
    cachedBase = base;
    cachedIndex = indexUdimFiles(files, base);
    matches.clear();
  }
  return cachedIndex;
}

/** Match an explicit template against known files, including UDIMs followed by a frame number. */
export function sceneUdimTiles(file: string, base: string): readonly number[] {
  const index = sceneUdimIndex(base);
  const url = new URL(AssetResolver.normalizeUdim(file), base);
  url.search = '';
  url.hash = '';
  let tiles = matches.get(url.href);
  if (!tiles) {
    tiles = index.get(url.href) ?? matchUdimFiles(files, url.href, base);
    matches.set(url.href, tiles);
  }
  return tiles;
}
