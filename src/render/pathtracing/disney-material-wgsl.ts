/*
 * Material and texture lookup adapted from GLSL-PathTracer.
 * Copyright (c) 2019 Asif Ali
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

/**
 * Requires disneyMaterials: array<vec4f> (read-only storage) and
 * disneyTextureMaps: texture_2d_array<u32> (RGBA8). A dummy texture must be
 * bound when no layers are used. Callers must treat nonzero error as failure:
 * 1 = invalid material, 2 = invalid texture lookup, 3 = invalid normal/frame,
 * 4 = invalid ray direction or mollification parameters, 5 = missing UVs.
 */
export const DISNEY_MATERIAL_WGSL = /* wgsl */ `
struct DisneyTextureSample {
  color: vec4f,
  valid: bool,
};

fn disneySampleTexture(layer: i32, uv: vec2f) -> DisneyTextureSample {
  var sample: DisneyTextureSample;
  let size = textureDimensions(disneyTextureMaps);
  let layers = textureNumLayers(disneyTextureMaps);
  if (layer < 0 || u32(layer) >= layers || size.x == 0u || size.x != size.y ||
      layers > 0x7fffffffu / size.x ||
      any((bitcast<vec2u>(uv) & vec2u(0x7f800000u)) == vec2u(0x7f800000u))) {
    return sample;
  }
  var v = uv.y;
  if (v < 0.0) { v = 1.0 - fract(v); }
  else if (v > 1.0) { v = fract(v); }
  let xFloat = floor(uv.x * f32(size.x));
  if (xFloat < -2147483648.0 || xFloat >= 2147483648.0) { return sample; }
  let width = i32(size.x);
  let x = i32(xFloat);
  var rowOffset = x / width;
  var column = x % width;
  if (column < 0) { column += width; rowOffset--; }
  let baseRow = layer * width + i32(floor(v * f32(size.y)));
  let totalRows = i32(layers * size.y);
  if (rowOffset < -baseRow || rowOffset >= totalRows - baseRow) { return sample; }
  let row = baseRow + rowOffset;
  sample.color = vec4f(textureLoad(disneyTextureMaps, vec2i(column, row % width), row / width, 0)) / 255.0;
  sample.valid = true;
  return sample;
}

struct DisneyMaterialContext {
  uv: vec2f,
  normal: vec3f,
  tangent: vec3f,
  bitangent: vec3f,
  direction: vec3f,
  normalValid: bool,
  uvValid: bool,
  tangentValid: bool,
  flipNormalY: bool,
  mollify: bool,
  previousRoughness: f32,
  mollificationAmount: f32,
};

struct DisneyShadingMaterial {
  baseColor: vec3f,
  anisotropic: f32,
  emission: vec3f,
  metallic: f32,
  roughness: f32,
  subsurface: f32,
  specularTint: f32,
  sheen: f32,
  sheenTint: f32,
  clearcoat: f32,
  clearcoatRoughness: f32,
  specTrans: f32,
  ior: f32,
  mediumType: i32,
  mediumDensity: f32,
  mediumColor: vec3f,
  mediumAnisotropy: f32,
  opacity: f32,
  alphaMode: i32,
  alphaCutoff: f32,
  materialType: i32,
  ax: f32,
  ay: f32,
  eta: f32,
  normal: vec3f,
  faceNormal: vec3f,
  error: u32,
};

fn disneyMaterialDirectionValid(v: vec3f) -> bool {
  return all((bitcast<vec3u>(v) & vec3u(0x7f800000u)) != vec3u(0x7f800000u))
    && max(abs(v.x), max(abs(v.y), abs(v.z))) > 0.0;
}

fn disneyMaterialUnit(v: vec3f) -> vec3f {
  return normalize(v / max(abs(v.x), max(abs(v.y), abs(v.z))));
}

fn disneyLoadMaterial(id: u32, context: DisneyMaterialContext) -> DisneyShadingMaterial {
  var mat: DisneyShadingMaterial;
  if (id >= arrayLength(&disneyMaterials) / 8u) { mat.error = 1u; return mat; }
  if (!context.normalValid || !disneyMaterialDirectionValid(context.normal)) { mat.error = 3u; return mat; }
  if (!disneyMaterialDirectionValid(context.direction) ||
      (context.mollify && any((bitcast<vec2u>(vec2f(context.previousRoughness, context.mollificationAmount))
        & vec2u(0x7f800000u)) == vec2u(0x7f800000u)))) {
    mat.error = 4u;
    return mat;
  }
  let index = id * 8u;
  let p1 = disneyMaterials[index];
  let p2 = disneyMaterials[index + 1u];
  let p3 = disneyMaterials[index + 2u];
  let p4 = disneyMaterials[index + 3u];
  let p5 = disneyMaterials[index + 4u];
  let p6 = disneyMaterials[index + 5u];
  let ids = vec4i(disneyMaterials[index + 6u]);
  let p8 = disneyMaterials[index + 7u];
  if (any(ids >= vec4i(0)) && !context.uvValid) { mat.error = 5u; return mat; }
  mat.baseColor = p1.rgb; mat.anisotropic = p1.w;
  mat.emission = p2.rgb;
  mat.metallic = p3.x; mat.roughness = max(p3.y, 0.001);
  mat.subsurface = p3.z; mat.specularTint = p3.w;
  mat.sheen = p4.x; mat.sheenTint = p4.y; mat.clearcoat = p4.z;
  mat.clearcoatRoughness = mix(0.1, 0.001, p4.w);
  mat.specTrans = p5.x; mat.ior = p5.y; mat.mediumType = i32(p5.z); mat.mediumDensity = p5.w;
  mat.mediumColor = p6.rgb; mat.mediumAnisotropy = clamp(p6.w, -0.9, 0.9);
  mat.opacity = p8.x; mat.alphaMode = i32(p8.y); mat.alphaCutoff = p8.z; mat.materialType = i32(p8.w + 0.5);
  mat.normal = context.normal;
  mat.faceNormal = select(-mat.normal, mat.normal, dot(mat.normal, context.direction) <= 0.0);
  if (ids.x >= 0) {
    let tex = disneySampleTexture(ids.x, context.uv);
    if (!tex.valid) { mat.error = 2u; return mat; }
    mat.baseColor *= pow(tex.color.rgb, vec3f(2.2));
    mat.opacity *= tex.color.a;
  }
  if (ids.y >= 0) {
    let tex = disneySampleTexture(ids.y, context.uv);
    if (!tex.valid) { mat.error = 2u; return mat; }
    mat.metallic = tex.color.b;
    mat.roughness = max(tex.color.g * tex.color.g, 0.001);
  }
  if (ids.z >= 0) {
    if (!context.tangentValid) { mat.error = 3u; return mat; }
    let tex = disneySampleTexture(ids.z, context.uv);
    if (!tex.valid) { mat.error = 2u; return mat; }
    var texNormal = tex.color.rgb;
    if (context.flipNormalY) { texNormal.y = 1.0 - texNormal.y; }
    texNormal = texNormal * 2.0 - 1.0;
    if (!disneyMaterialDirectionValid(texNormal)) { mat.error = 3u; return mat; }
    texNormal = disneyMaterialUnit(texNormal);
    let mapped = context.tangent * texNormal.x + context.bitangent * texNormal.y + context.normal * texNormal.z;
    if (!disneyMaterialDirectionValid(mapped)) { mat.error = 3u; return mat; }
    mat.normal = disneyMaterialUnit(mapped);
    mat.faceNormal = select(-mat.normal, mat.normal, dot(context.normal, context.direction) <= 0.0);
  }
  if (ids.w >= 0) {
    let tex = disneySampleTexture(ids.w, context.uv);
    if (!tex.valid) { mat.error = 2u; return mat; }
    mat.emission = pow(tex.color.rgb, vec3f(2.2));
  }
  if (context.mollify) {
    let mollified = context.previousRoughness * context.mollificationAmount;
    if ((bitcast<u32>(mollified) & 0x7f800000u) == 0x7f800000u) { mat.error = 4u; return mat; }
    mat.roughness = max(mollified, mat.roughness);
  }
  let aspect = sqrt(1.0 - mat.anisotropic * 0.9);
  mat.ax = max(0.001, mat.roughness / aspect);
  mat.ay = max(0.001, mat.roughness * aspect);
  mat.eta = select(mat.ior, 1.0 / mat.ior, dot(context.direction, mat.normal) < 0.0);
  return mat;
}
`;
