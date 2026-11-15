/*
 * Disney BSDF evaluation adapted from GLSL-PathTracer.
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
 * Requires DISNEY_MATERIAL_WGSL. Directions and face normal must be unit vectors;
 * sampling consumes three caller-supplied random values in [0, 1]. Results
 * include the cosine factor, as in the source renderer. A nonzero
 * error denotes invalid input (1), undefined lobe weights (2), a degenerate
 * half-vector (3), or a nonfinite result (4); callers must propagate it.
 */
export const DISNEY_BSDF_WGSL = /* wgsl */ `
const DISNEY_PI: f32 = 3.14159265358979323;
const DISNEY_INV_PI: f32 = 0.31830988618379067;

struct DisneyBsdfEval {
  value: vec3f,
  pdf: f32,
  error: u32,
};

struct DisneyBsdfSample {
  direction: vec3f,
  value: vec3f,
  pdf: f32,
  error: u32,
};

struct DisneyLobeEval {
  value: vec3f,
  pdf: f32,
};

struct DisneyBsdfLobes {
  f0: f32,
  spec0: vec3f,
  sheen: vec3f,
  dielectricWeight: f32,
  metalWeight: f32,
  glassWeight: f32,
  diffuse: f32,
  dielectric: f32,
  metal: f32,
  glass: f32,
  coat: f32,
  total: f32,
};

fn disneyBsdfFinite(v: f32) -> bool {
  return (bitcast<u32>(v) & 0x7f800000u) != 0x7f800000u;
}

fn disneyBsdfFinite3(v: vec3f) -> bool {
  return all((bitcast<vec3u>(v) & vec3u(0x7f800000u)) != vec3u(0x7f800000u));
}

fn disneyBsdfUnit(v: vec3f) -> bool {
  return disneyBsdfFinite3(v) && abs(dot(v, v) - 1.0) < 0.001;
}

fn disneyBsdfInputValid(mat: DisneyShadingMaterial, view: vec3f, normal: vec3f) -> bool {
  return mat.error == 0u && mat.materialType == 0 && disneyBsdfUnit(view) && disneyBsdfUnit(normal) &&
    dot(view, normal) > 0.0 && disneyBsdfFinite(mat.eta) && mat.eta > 0.0 &&
    disneyBsdfFinite(mat.ior) && mat.ior > 0.0 && mat.ax > 0.0 && mat.ay > 0.0 &&
    disneyBsdfFinite(mat.ax) && disneyBsdfFinite(mat.ay);
}

fn disneyBsdfFrame(normal: vec3f) -> mat3x3f {
  let up = select(vec3f(1, 0, 0), vec3f(0, 0, 1), abs(normal.z) < 0.9999999);
  let tangent = normalize(cross(up, normal));
  return mat3x3f(tangent, cross(normal, tangent), normal);
}

fn disneyLuminance(color: vec3f) -> f32 {
  return dot(color, vec3f(0.212671, 0.715160, 0.072169));
}

fn disneySchlick(u: f32) -> f32 {
  let m = clamp(1.0 - u, 0.0, 1.0);
  let m2 = m * m;
  return m2 * m2 * m;
}

fn disneyBsdfLobes(mat: DisneyShadingMaterial, v: vec3f) -> DisneyBsdfLobes {
  var result: DisneyBsdfLobes;
  let lum = disneyLuminance(mat.baseColor);
  var tint = vec3f(1.0);
  if (lum > 0.0) { tint = mat.baseColor / lum; }
  result.f0 = (1.0 - mat.eta) / (1.0 + mat.eta);
  result.f0 *= result.f0;
  result.spec0 = result.f0 * mix(vec3f(1.0), tint, mat.specularTint);
  result.sheen = mix(vec3f(1.0), tint, mat.sheenTint);
  result.dielectricWeight = (1.0 - mat.metallic) * (1.0 - mat.specTrans);
  result.metalWeight = mat.metallic;
  result.glassWeight = (1.0 - mat.metallic) * mat.specTrans;
  let schlick = disneySchlick(v.z);
  result.diffuse = result.dielectricWeight * lum;
  result.dielectric = result.dielectricWeight * disneyLuminance(mix(result.spec0, vec3f(1.0), schlick));
  result.metal = result.metalWeight * disneyLuminance(mix(mat.baseColor, vec3f(1.0), schlick));
  result.glass = result.glassWeight;
  result.coat = 0.25 * mat.clearcoat;
  result.total = result.diffuse + result.dielectric + result.metal + result.glass + result.coat;
  return result;
}

fn disneyFresnel(cosTheta: f32, eta: f32) -> f32 {
  let sinThetaTSq = eta * eta * (1.0 - cosTheta * cosTheta);
  if (sinThetaTSq > 1.0) { return 1.0; }
  let cosThetaT = sqrt(max(1.0 - sinThetaTSq, 0.0));
  let rs = (eta * cosThetaT - cosTheta) / (eta * cosThetaT + cosTheta);
  let rp = (eta * cosTheta - cosThetaT) / (eta * cosTheta + cosThetaT);
  return 0.5 * (rs * rs + rp * rp);
}

fn disneyGtr1(nh: f32, a: f32) -> f32 {
  if (a >= 1.0) { return DISNEY_INV_PI; }
  let a2 = a * a;
  let t = 1.0 + (a2 - 1.0) * nh * nh;
  return (a2 - 1.0) / (DISNEY_PI * log(a2) * t);
}

fn disneyGtr2Aniso(h: vec3f, ax: f32, ay: f32) -> f32 {
  let a = h.x / ax;
  let b = h.y / ay;
  let c = a * a + b * b + h.z * h.z;
  return 1.0 / (DISNEY_PI * ax * ay * c * c);
}

fn disneySmith(nv: f32, alpha: f32) -> f32 {
  let a = alpha * alpha;
  let b = nv * nv;
  return 2.0 * nv / (nv + sqrt(a + b - a * b));
}

fn disneySmithAniso(v: vec3f, ax: f32, ay: f32) -> f32 {
  let a = v.x * ax;
  let b = v.y * ay;
  let c = abs(v.z);
  return 2.0 * c / (c + sqrt(a * a + b * b + c * c));
}

fn disneyDiffuse(mat: DisneyShadingMaterial, sheen: vec3f, v: vec3f, l: vec3f, h: vec3f) -> DisneyLobeEval {
  var result: DisneyLobeEval;
  if (l.z <= 0.0) { return result; }
  let lh = dot(l, h);
  let rr = 2.0 * mat.roughness * lh * lh;
  let fl = disneySchlick(l.z);
  let fv = disneySchlick(v.z);
  let retro = rr * (fl + fv + fl * fv * (rr - 1.0));
  let diffuse = (1.0 - 0.5 * fl) * (1.0 - 0.5 * fv);
  let fss = mix(1.0, 0.5 * rr, fl) * mix(1.0, 0.5 * rr, fv);
  let subsurface = 1.25 * (fss * (1.0 / (l.z + v.z) - 0.5) + 0.5);
  result.pdf = l.z * DISNEY_INV_PI;
  result.value = DISNEY_INV_PI * mat.baseColor * mix(diffuse + retro, subsurface, mat.subsurface)
    + disneySchlick(lh) * mat.sheen * sheen;
  return result;
}

fn disneyReflection(mat: DisneyShadingMaterial, v: vec3f, l: vec3f, h: vec3f, f: vec3f) -> DisneyLobeEval {
  var result: DisneyLobeEval;
  if (l.z <= 0.0) { return result; }
  let d = disneyGtr2Aniso(h, mat.ax, mat.ay);
  let g1 = disneySmithAniso(v, mat.ax, mat.ay);
  let g2 = g1 * disneySmithAniso(l, mat.ax, mat.ay);
  result.pdf = g1 * d / (4.0 * v.z);
  result.value = f * d * g2 / (4.0 * l.z * v.z);
  return result;
}

fn disneyRefraction(mat: DisneyShadingMaterial, eta: f32, v: vec3f, l: vec3f, h: vec3f, f: f32) -> DisneyLobeEval {
  var result: DisneyLobeEval;
  if (l.z >= 0.0) { return result; }
  let lh = dot(l, h);
  let vh = dot(v, h);
  let d = disneyGtr2Aniso(h, mat.ax, mat.ay);
  let g1 = disneySmithAniso(v, mat.ax, mat.ay);
  let g2 = g1 * disneySmithAniso(l, mat.ax, mat.ay);
  let denominator = lh + vh * eta;
  let jacobian = abs(lh) / (denominator * denominator);
  result.pdf = g1 * max(0.0, vh) * d * jacobian / v.z;
  result.value = sqrt(mat.baseColor) * (1.0 - f) * d * g2 * abs(vh) * jacobian * eta * eta / abs(l.z * v.z);
  return result;
}

fn disneyClearcoat(mat: DisneyShadingMaterial, v: vec3f, l: vec3f, h: vec3f) -> DisneyLobeEval {
  var result: DisneyLobeEval;
  if (l.z <= 0.0) { return result; }
  let vh = dot(v, h);
  let f = mix(0.04, 1.0, disneySchlick(vh));
  let d = disneyGtr1(h.z, mat.clearcoatRoughness);
  let g = disneySmith(l.z, 0.25) * disneySmith(v.z, 0.25);
  result.pdf = d * h.z / (4.0 * vh);
  result.value = vec3f(f * d * g);
  return result;
}

fn disneyEval(mat: DisneyShadingMaterial, view: vec3f, normal: vec3f, light: vec3f) -> DisneyBsdfEval {
  var result: DisneyBsdfEval;
  if (!disneyBsdfInputValid(mat, view, normal) || !disneyBsdfUnit(light)) {
    result.error = 1u; return result;
  }
  let frame = disneyBsdfFrame(normal);
  let v = vec3f(dot(view, frame[0]), dot(view, frame[1]), dot(view, frame[2]));
  let l = vec3f(dot(light, frame[0]), dot(light, frame[1]), dot(light, frame[2]));
  let halfVector = select(l + v * mat.eta, l + v, l.z > 0.0);
  if (!disneyMaterialDirectionValid(halfVector)) { result.error = 3u; return result; }
  var h = disneyMaterialUnit(halfVector);
  if (h.z < 0.0) { h = -h; }
  let lobes = disneyBsdfLobes(mat, v);
  if (!disneyBsdfFinite(lobes.total) || lobes.total <= 0.0) { result.error = 2u; return result; }
  let reflect = l.z * v.z > 0.0;
  let vh = abs(dot(v, h));
  if (lobes.diffuse > 0.0 && reflect) {
    let lobe = disneyDiffuse(mat, lobes.sheen, v, l, h);
    result.value += lobe.value * lobes.dielectricWeight;
    result.pdf += lobe.pdf * lobes.diffuse / lobes.total;
  }
  if (lobes.dielectric > 0.0 && reflect) {
    let f = (disneyFresnel(vh, 1.0 / mat.ior) - lobes.f0) / (1.0 - lobes.f0);
    let lobe = disneyReflection(mat, v, l, h, mix(lobes.spec0, vec3f(1.0), f));
    result.value += lobe.value * lobes.dielectricWeight;
    result.pdf += lobe.pdf * lobes.dielectric / lobes.total;
  }
  if (lobes.metal > 0.0 && reflect) {
    let f = mix(mat.baseColor, vec3f(1.0), disneySchlick(vh));
    let lobe = disneyReflection(mat, v, l, h, f);
    result.value += lobe.value * lobes.metalWeight;
    result.pdf += lobe.pdf * lobes.metal / lobes.total;
  }
  if (lobes.glass > 0.0) {
    let f = disneyFresnel(vh, mat.eta);
    if (reflect) {
      let lobe = disneyReflection(mat, v, l, h, vec3f(f));
      result.value += lobe.value * lobes.glassWeight;
      result.pdf += lobe.pdf * lobes.glass * f / lobes.total;
    } else {
      let lobe = disneyRefraction(mat, mat.eta, v, l, h, f);
      result.value += lobe.value * lobes.glassWeight;
      result.pdf += lobe.pdf * lobes.glass * (1.0 - f) / lobes.total;
    }
  }
  if (lobes.coat > 0.0 && reflect) {
    let lobe = disneyClearcoat(mat, v, l, h);
    result.value += lobe.value * 0.25 * mat.clearcoat;
    result.pdf += lobe.pdf * lobes.coat / lobes.total;
  }
  result.value *= abs(l.z);
  if (!disneyBsdfFinite3(result.value) || !disneyBsdfFinite(result.pdf)) { result.error = 4u; }
  return result;
}

fn disneySampleGgxVndf(v: vec3f, ax: f32, ay: f32, r1: f32, r2: f32) -> vec3f {
  let vh = normalize(vec3f(ax * v.x, ay * v.y, v.z));
  let lensq = vh.x * vh.x + vh.y * vh.y;
  var t1 = vec3f(1, 0, 0);
  if (lensq > 0.0) { t1 = vec3f(-vh.y, vh.x, 0) * inverseSqrt(lensq); }
  let t2 = cross(vh, t1);
  let radius = sqrt(r1);
  let phi = 2.0 * DISNEY_PI * r2;
  let x = radius * cos(phi);
  var y = radius * sin(phi);
  let s = 0.5 * (1.0 + vh.z);
  y = (1.0 - s) * sqrt(1.0 - x * x) + s * y;
  let nh = x * t1 + y * t2 + sqrt(max(0.0, 1.0 - x * x - y * y)) * vh;
  return normalize(vec3f(ax * nh.x, ay * nh.y, max(0.0, nh.z)));
}

fn disneySampleGtr1(roughness: f32, r1: f32, r2: f32) -> vec3f {
  let a = max(0.001, roughness);
  let a2 = a * a;
  let phi = r1 * 2.0 * DISNEY_PI;
  let cosine = sqrt((1.0 - pow(a2, 1.0 - r2)) / (1.0 - a2));
  let sine = clamp(sqrt(1.0 - cosine * cosine), 0.0, 1.0);
  return vec3f(sine * cos(phi), sine * sin(phi), cosine);
}

fn disneySample(mat: DisneyShadingMaterial, view: vec3f, normal: vec3f, random: vec3f) -> DisneyBsdfSample {
  var result: DisneyBsdfSample;
  if (!disneyBsdfInputValid(mat, view, normal) || !disneyBsdfFinite3(random) ||
      any(random < vec3f(0.0)) || any(random > vec3f(1.0))) {
    result.error = 1u; return result;
  }
  let frame = disneyBsdfFrame(normal);
  let v = vec3f(dot(view, frame[0]), dot(view, frame[1]), dot(view, frame[2]));
  let lobes = disneyBsdfLobes(mat, v);
  if (!disneyBsdfFinite(lobes.total) || lobes.total <= 0.0) { result.error = 2u; return result; }
  let cdf0 = lobes.diffuse / lobes.total;
  let cdf1 = cdf0 + lobes.dielectric / lobes.total;
  let cdf2 = cdf1 + lobes.metal / lobes.total;
  let cdf3 = cdf2 + lobes.glass / lobes.total;
  var l: vec3f;
  if (random.z < cdf0) {
    let radius = sqrt(random.x);
    let phi = 2.0 * DISNEY_PI * random.y;
    l = vec3f(radius * cos(phi), radius * sin(phi), 0);
    l.z = sqrt(max(0.0, 1.0 - l.x * l.x - l.y * l.y));
  } else if (random.z < cdf2) {
    var h = disneySampleGgxVndf(v, mat.ax, mat.ay, random.x, random.y);
    if (h.z < 0.0) { h = -h; }
    l = normalize(reflect(-v, h));
  } else if (random.z < cdf3) {
    var h = disneySampleGgxVndf(v, mat.ax, mat.ay, random.x, random.y);
    let f = disneyFresnel(abs(dot(v, h)), mat.eta);
    if (h.z < 0.0) { h = -h; }
    let choice = (random.z - cdf2) / (cdf3 - cdf2);
    if (choice < f) { l = normalize(reflect(-v, h)); }
    else { l = normalize(refract(-v, h, mat.eta)); }
  } else {
    var h = disneySampleGtr1(mat.clearcoatRoughness, random.x, random.y);
    if (h.z < 0.0) { h = -h; }
    l = normalize(reflect(-v, h));
  }
  result.direction = frame * l;
  if (!disneyBsdfUnit(result.direction)) { result.error = 4u; return result; }
  let evaluation = disneyEval(mat, view, normal, result.direction);
  result.value = evaluation.value;
  result.pdf = evaluation.pdf;
  result.error = evaluation.error;
  return result;
}
`;
