import { indexUdimFiles } from './udim.ts';

const files = Object.keys(import.meta.glob('/scenes/**/*.{jpg,jpeg,png,tif,tiff,exr,hdr}', { query: '?url', import: 'default' }));

export function sceneUdimIndex(base: string): ReadonlyMap<string, readonly number[]> {
  return indexUdimFiles(files.map(path => `.${path}`), base);
}
