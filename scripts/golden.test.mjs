import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareGolden } from './golden.mjs';
import { decodePng, encodePng } from './png.mjs';

function image(width, height, value) {
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) rgba.set([value(i), 100, 50, 255], i * 4);
  return { width, height, rgba };
}

test('PNG round trip preserves RGBA pixels', () => {
  const source = image(5, 3, i => (i * 37) % 256);
  const decoded = decodePng(encodePng(5, 3, source.rgba));
  assert.deepEqual(decoded, source);
});

test('golden comparison tolerates small raster differences and reports outliers', () => {
  const reference = image(16, 16, () => 120);
  const close = image(16, 16, i => (i % 2 ? 121 : 120));
  assert.equal(compareGolden(close, reference, { meanAbsoluteError: 1, outlierFraction: 0.01 }).pass, true);
  const broken = image(16, 16, i => (i < 32 ? 200 : 120));
  const result = compareGolden(broken, reference, { meanAbsoluteError: 1, outlierFraction: 0.01 });
  assert.equal(result.pass, false);
  assert.match(result.reason, /outlierFraction 0\.1250 > 0\.01/);
  assert.equal(compareGolden(image(8, 8, () => 0), reference, {}).pass, false);
});
