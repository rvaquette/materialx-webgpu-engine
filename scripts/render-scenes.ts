// Offline preview renderer (not part of the test suite). Shades every
// raster+pathtracing control scene with the same modules the tests use
// (tests/render/scene-samples.ts + scene-shade.ts), applies the HDR resolve from
// src/render/output.ts, and writes PNGs to renders/ for visual inspection.
// Run with: node scripts/render-scenes.ts [resolution]  (Node >=23.6 strips the
// TypeScript types natively, so no build step is required).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { fitShaderBall, sampleSurface, type CameraParams } from '../tests/render/scene-samples.ts';
import { shadeSceneBuffers, type CanonMaterial, type SceneLight } from '../tests/render/scene-shade.ts';
import { applyExposure, tonemap, encodeOutput } from '../src/render/output.ts';
import type { Vec3 } from '../src/scene/transforms.ts';

const here = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => JSON.parse(readFileSync(resolve(here, p), 'utf8'));
const fixture = read('../tests/fixtures/shader-ball.json');
const scenes = read('../tests/fixtures/control-scenes.json');
const materials = read('../tests/fixtures/scene-materials.json');
const OUT_DIR = resolve(here, '../renders');
const RES = Math.max(16, Number.parseInt(process.argv[2] ?? '256', 10) || 256);

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeData), 0);
  return Buffer.concat([len, typeData, crc]);
}

function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter type 0 (None)
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Resolve one linear HDR pixel to an 8-bit sRGB display value. */
function resolveChannel(c: number, gain: number): number {
  const exposed = applyExposure([c * gain, c * gain, c * gain] as Vec3, 0);
  const mapped = tonemap(exposed, 'acesFilmic');
  const enc = encodeOutput(mapped, 'lin_rec709');
  return Math.round(Math.min(Math.max(enc.color[0], 0), 1) * 255);
}

function bufferToRgba(buf: Float32Array, mask: Uint8Array, width: number, height: number, gain = 1): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < mask.length; i++) {
    const o = i * 3;
    const p = i * 4;
    if (mask[i] === 0) continue; // leave transparent
    rgba[p] = resolveChannel(buf[o]!, gain);
    rgba[p + 1] = resolveChannel(buf[o + 1]!, gain);
    rgba[p + 2] = resolveChannel(buf[o + 2]!, gain);
    rgba[p + 3] = 255;
  }
  return rgba;
}

const cam: CameraParams = {
  eye: scenes.camera.eye,
  target: scenes.camera.target,
  up: scenes.camera.up,
  fovYRadians: scenes.camera.fovYRadians,
  aspect: scenes.camera.aspect,
};
const light: SceneLight = {
  direction: scenes.light.direction,
  color: scenes.light.color,
  intensity: scenes.light.intensity,
};
const env = scenes.environment.constantRadiance as Vec3;

mkdirSync(OUT_DIR, { recursive: true });
const surface = fitShaderBall(fixture);
const grid = sampleSurface(surface, cam, RES, RES);
console.log(`[render] ${RES}x${RES}, ${grid.hitCount} hits/scene`);

for (const id of Object.keys(materials.scenes)) {
  const m = materials.scenes[id];
  const material: CanonMaterial = {
    family: m.family,
    focus: m.focus,
    baseColor: m.baseColor,
    metalness: m.metalness,
    roughness: m.roughness,
    transmission: m.transmission,
    subsurface: m.subsurface,
    ior: m.ior,
    specular: m.specular,
  };
  const b = shadeSceneBuffers(grid, material, light, env, 1337);
  const diff = new Float32Array(b.raster.length);
  for (let i = 0; i < diff.length; i++) diff[i] = Math.abs(b.raster[i]! - b.pathtracing[i]!);

  writeFileSync(resolve(OUT_DIR, `${id}_raster.png`), encodePng(RES, RES, bufferToRgba(b.raster, b.mask, RES, RES)));
  writeFileSync(resolve(OUT_DIR, `${id}_pathtracing.png`), encodePng(RES, RES, bufferToRgba(b.pathtracing, b.mask, RES, RES)));
  // Diff is amplified so the small ambient/env gap is visible.
  writeFileSync(resolve(OUT_DIR, `${id}_diff.png`), encodePng(RES, RES, bufferToRgba(diff, b.mask, RES, RES, 10)));
  console.log(`[render] ${id} -> raster / pathtracing / diff`);
}
console.log(`[render] done -> ${OUT_DIR}`);
