/*
 * Path transport adapted from GLSL-PathTracer.
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
 * Requires the camera, traversal, surface, material, alpha, BSDF, environment
 * and lights WGSL modules and disneyLights: array<vec4f> (five texels per light).
 * Volume MIS with hidden emitters or roughness mollification is rejected:
 * the source shadow-transmittance state is uninitialized in those combinations.
 * All nonzero errors must be reported; no result with an error may be accumulated.
 *
 * Error categories: 1 invalid input, 2 traversal overflow, 3 light record,
 * 4 light operation, 9 non-finite arithmetic, 10 unsupported transport option;
 * material, BSDF and
 * environment errors are 500+, 600+ and 700+ their underlying error codes.
 */
export const DISNEY_INTEGRATOR_WGSL = /* wgsl */ `
struct DisneyPathOptions {
  root: u32,
  lightCount: u32,
  maxDepth: u32,
  rrDepth: u32,
  russianRoulette: bool,
  environment: bool,
  uniformLight: bool,
  hideEmitters: bool,
  transparentBackground: bool,
  alphaTest: bool,
  medium: bool,
  volumeMis: bool,
  flipNormalY: bool,
  mollify: bool,
  mollificationAmount: f32,
  environmentTotal: f32,
  environmentRotation: f32,
  environmentIntensity: f32,
  environmentLinear: bool,
  uniformColor: vec3f,
};

struct DisneyPathResult { color: vec4f, error: u32 };
struct DisneyDirectResult { color: vec3f, error: u32 };
struct DisneyShadowResult { hit: bool, error: u32 };
struct DisneyLightRecord { light: DisneyLight, error: u32 };
struct DisneyTransmittance { color: vec3f, error: u32 };
struct DisneyPhaseResult { value: vec3f, pdf: f32, error: u32 };

fn disneyPathLight(index: u32, count: u32) -> DisneyLightRecord {
  var result: DisneyLightRecord;
  if (index >= count || count > arrayLength(&disneyLights) / 5u) { result.error = 3u; return result; }
  let base = index * 5u;
  let p = disneyLights[base]; let e = disneyLights[base + 1u];
  let u = disneyLights[base + 2u]; let v = disneyLights[base + 3u];
  let params = disneyLights[base + 4u];
  if (!disneyLightFinite(params.z) || params.z < 0.0 || params.z > 2.0 || floor(params.z) != params.z) {
    result.error = 3u; return result;
  }
  result.light = DisneyLight(p.xyz, e.xyz, u.xyz, v.xyz, params.x, params.y, u32(params.z));
  if (!disneyLightValid(result.light)) { result.error = 3u; }
  return result;
}

fn disneyPathShadow(options: DisneyPathOptions, origin: vec3f, direction: vec3f, maxT: f32,
                    seed: ptr<function, vec4u>) -> DisneyShadowResult {
  var result: DisneyShadowResult;
  if (maxT <= 0.0 || !disneyLightFinite(maxT)) { result.error = 1u; return result; }
  for (var i = 0u; i < options.lightCount; i++) {
    let light = disneyPathLight(i, options.lightCount);
    if (light.error != 0u) { result.error = light.error; return result; }
    let hit = disneyIntersectLight(light.light, origin, direction, maxT, true);
    if (hit.error != 0u) { result.error = 4u; return result; }
    if (hit.hit) { result.hit = true; return result; }
  }
  if (options.alphaTest && !options.medium) {
    let geometry = disneyAlphaAnyHit(options.root, origin, direction, maxT, seed);
    result.hit = geometry.hit;
    result.error = geometry.error;
  } else {
    let geometry = disneyTrace(options.root, origin, direction, 0.0, maxT, true);
    if (geometry.overflow) { result.error = 2u; return result; }
    result.hit = geometry.hit;
  }
  return result;
}

fn disneyPathPower(a: f32, b: f32) -> f32 {
  return a * a / (a * a + b * b);
}

fn disneyPathPhase(cosTheta: f32, g: f32) -> f32 {
  let denom = 1.0 + g * g + 2.0 * g * cosTheta;
  return 0.07957747154594766 * (1.0 - g * g) / (denom * sqrt(denom));
}

fn disneyPathSamplePhase(view: vec3f, g: f32, random: vec2f) -> vec3f {
  var cosTheta: f32;
  if (abs(g) < 0.001) {
    cosTheta = 1.0 - 2.0 * random.y;
  } else {
    let term = (1.0 - g * g) / (1.0 + g - 2.0 * g * random.y);
    cosTheta = -(1.0 + g * g - term * term) / (2.0 * g);
  }
  let phi = random.x * 6.28318530717958648;
  let sine = clamp(sqrt(1.0 - cosTheta * cosTheta), 0.0, 1.0);
  let frame = disneyBsdfFrame(view);
  return sine * cos(phi) * frame[0] + sine * sin(phi) * frame[1] + cosTheta * view;
}

fn disneyPathTransmittance(options: DisneyPathOptions, rayOrigin: vec3f, direction: vec3f,
                          seed: ptr<function, vec4u>) -> DisneyTransmittance {
  var result: DisneyTransmittance;
  result.color = vec3f(1.0);
  var origin = rayOrigin;
  for (var depth = 0u; depth < options.maxDepth; depth++) {
    var closestLight = 1000000.0;
    for (var i = 0u; i < options.lightCount; i++) {
      let light = disneyPathLight(i, options.lightCount);
      if (light.error != 0u) { result.error = light.error; return result; }
      let hit = disneyIntersectLight(light.light, origin, direction, closestLight, false);
      if (hit.error != 0u) { result.error = 4u; return result; }
      if (hit.hit) { closestLight = hit.distance; }
    }
    let hit = disneyTrace(options.root, origin, direction, 0.0, closestLight, false);
    if (hit.overflow) { result.error = 2u; return result; }
    if (!hit.hit) { break; }
    let surface = disneySurface(hit, origin, direction);
    let context = DisneyMaterialContext(surface.uv, surface.normal, surface.tangent, surface.bitangent, direction,
      surface.normalValid, surface.uvValid, surface.tangentValid, options.flipNormalY, false, 0.0, 0.0);
    let mat = disneyLoadMaterial(hit.material, context);
    if (mat.error != 0u) { result.error = 500u + mat.error; return result; }
    if (mat.materialType != 0) { result.error = 500u; return result; }
    var alpha = mat.alphaMode == 2 && mat.opacity < mat.alphaCutoff;
    if (mat.alphaMode == 1) { alpha = disneyRandom(seed) > mat.opacity; }
    let refractive = (1.0 - mat.metallic) * mat.specTrans > 0.0;
    if (!alpha && !refractive) { result.color = vec3f(0.0); return result; }
    if (dot(direction, mat.normal) > 0.0 && mat.mediumType != 0) {
      var color = vec3f(1.0);
      if (mat.mediumType == 1) { color = vec3f(1.0) - mat.mediumColor; }
      result.color *= exp(-color * mat.mediumDensity * hit.t);
    }
    origin = surface.position + direction * 0.0003;
  }
  if (!disneyLightFinite3(result.color)) { result.error = 9u; }
  return result;
}

fn disneyPathEvaluateScatter(options: DisneyPathOptions, direction: vec3f, lightDirection: vec3f,
                             mat: DisneyShadingMaterial, isSurface: bool, anisotropy: f32) -> DisneyPhaseResult {
  var result: DisneyPhaseResult;
  if (options.medium && options.volumeMis && !isSurface) {
    result.pdf = disneyPathPhase(dot(-direction, lightDirection), anisotropy);
    result.value = vec3f(result.pdf);
  } else {
    let bsdf = disneyEval(mat, -direction, mat.faceNormal, lightDirection);
    result.value = bsdf.value;
    result.pdf = bsdf.pdf;
    if (bsdf.error != 0u) { result.error = 600u + bsdf.error; }
  }
  if (!disneyLightFinite(result.pdf) || !disneyLightFinite3(result.value)) { result.error = 9u; }
  return result;
}

fn disneyPathDirect(options: DisneyPathOptions, direction: vec3f,
                    surface: DisneySurface, mat: DisneyShadingMaterial, isSurface: bool, anisotropy: f32,
                    seed: ptr<function, vec4u>) -> DisneyDirectResult {
  var result: DisneyDirectResult;
  let scatterPos = surface.position + mat.normal * 0.0003;
  if (options.environment && !options.uniformLight) {
    let random = disneyRandom(seed);
    let env = disneySampleEnvironment(random, options.environmentTotal, options.environmentRotation, options.environmentLinear);
    if (env.error != 0u) { result.error = 700u + env.error; return result; }
    var visibility = vec3f(1.0);
    if (options.medium && options.volumeMis) {
      let transmittance = disneyPathTransmittance(options, scatterPos, env.direction, seed);
      if (transmittance.error != 0u) { result.error = transmittance.error; return result; }
      visibility = transmittance.color;
    } else {
      let shadow = disneyPathShadow(options, scatterPos, env.direction, 1000000.0 - 0.0003, seed);
      if (shadow.error != 0u) { result.error = shadow.error; return result; }
      if (shadow.hit) { visibility = vec3f(0.0); }
    }
    if ((options.medium && options.volumeMis) || any(visibility != vec3f(0.0))) {
      let scatter = disneyPathEvaluateScatter(options, direction, env.direction, mat, isSurface, anisotropy);
      if (scatter.error != 0u) { result.error = scatter.error; return result; }
      if (scatter.pdf > 0.0) {
        let weight = disneyPathPower(env.pdf, scatter.pdf);
        if (weight > 0.0) { result.color += weight * visibility * env.color * scatter.value * options.environmentIntensity / env.pdf; }
      }
    }
  }
  if (options.lightCount > 0u) {
    let choice = disneySelectLight(disneyRandom(seed), options.lightCount);
    if (choice.error != 0u) { result.error = 4u; return result; }
    let light = disneyPathLight(choice.index, options.lightCount);
    if (light.error != 0u) { result.error = light.error; return result; }
    var random = vec2f(0.0);
    if (light.light.kind != 2u) {
      random.x = disneyRandom(seed);
      random.y = disneyRandom(seed);
    }
    let sample = disneySampleLight(light.light, scatterPos, random, options.lightCount);
    if (sample.error != 0u) { result.error = 4u; return result; }
    if (sample.pdf > 0.0 && dot(sample.direction, sample.normal) < 0.0) {
      var visibility = vec3f(1.0);
      if (options.medium && options.volumeMis) {
        let transmittance = disneyPathTransmittance(options, scatterPos, sample.direction, seed);
        if (transmittance.error != 0u) { result.error = transmittance.error; return result; }
        visibility = transmittance.color;
      } else {
        let shadow = disneyPathShadow(options, scatterPos, sample.direction, sample.distance - 0.0003, seed);
        if (shadow.error != 0u) { result.error = shadow.error; return result; }
        if (shadow.hit) { visibility = vec3f(0.0); }
      }
      if ((options.medium && options.volumeMis) || any(visibility != vec3f(0.0))) {
        let scatter = disneyPathEvaluateScatter(options, direction, sample.direction, mat, isSurface, anisotropy);
        if (scatter.error != 0u) { result.error = scatter.error; return result; }
        var weight = 1.0;
        if (light.light.area > 0.0) { weight = disneyPathPower(sample.pdf, scatter.pdf); }
        if (scatter.pdf > 0.0) { result.color += weight * visibility * sample.emission * scatter.value / sample.pdf; }
      }
    }
  }
  if (!disneyLightFinite3(result.color)) { result.error = 9u; }
  return result;
}

fn disneyPathTrace(options: DisneyPathOptions, rayOrigin: vec3f, rayDirection: vec3f,
                   seed: ptr<function, vec4u>) -> DisneyPathResult {
  var result: DisneyPathResult;
  result.color.a = 1.0;
  if (options.medium && options.volumeMis && (options.hideEmitters || options.mollify)) {
    result.error = 10u; return result;
  }
  if (!disneyLightFinite3(rayOrigin) || !disneyBsdfUnit(rayDirection) ||
      options.lightCount > arrayLength(&disneyLights) / 5u ||
      options.maxDepth > 0x7fffffffu || options.rrDepth > 0x7fffffffu ||
      !disneyLightFinite3(options.uniformColor) ||
      !disneyLightFinite(options.mollificationAmount) ||
      !disneyLightFinite(options.environmentIntensity)) {
    result.error = 1u; return result;
  }
  var origin = rayOrigin;
  var direction = rayDirection;
  var throughput = vec3f(1.0);
  var previousPdf = 0.0;
  var previousRoughness = 0.0;
  var surfaceScatter = false;
  var inMedium = false;
  var mediumType = 0;
  var mediumDensity = 0.0;
  var mediumColor = vec3f(0.0);
  var mediumAnisotropy = 0.0;
  for (var depth = 0i; ; depth++) {
    var lightDistance = 1000000.0;
    var lightHit = false;
    var lightEmission = vec3f(0.0);
    var lightPdf = 0.0;
    if (!options.hideEmitters || depth > 0) {
      for (var i = 0u; i < options.lightCount; i++) {
        let light = disneyPathLight(i, options.lightCount);
        if (light.error != 0u) { result.error = light.error; return result; }
        let hit = disneyIntersectLight(light.light, origin, direction, lightDistance, false);
        if (hit.error != 0u) { result.error = 4u; return result; }
        if (hit.hit) {
          lightDistance = hit.distance;
          lightEmission = hit.emission;
          lightPdf = hit.pdf;
          lightHit = true;
        }
      }
    }
    let hit = disneyTrace(options.root, origin, direction, 0.0, lightDistance, false);
    if (hit.overflow) { result.error = 2u; return result; }
    if (!hit.hit && lightHit) {
      var weight = 1.0;
      if (depth > 0) { weight = disneyPathPower(previousPdf, lightPdf); }
      if (options.medium && !options.volumeMis && !surfaceScatter) { weight = 1.0; }
      result.color = vec4f(result.color.rgb + weight * lightEmission * throughput, result.color.a);
      if (!disneyLightFinite3(result.color.rgb)) { result.error = 9u; }
      return result;
    }
    if (!hit.hit) {
      if (options.transparentBackground && depth == 0) { result.color.a = 0.0; }
      if (!options.hideEmitters || depth > 0) {
        if (options.uniformLight) {
          result.color = vec4f(result.color.rgb + options.uniformColor * throughput, result.color.a);
        } else if (options.environment) {
          let env = disneyEvalEnvironment(direction, options.environmentTotal, options.environmentRotation, options.environmentLinear);
          if (env.error != 0u) { result.error = 700u + env.error; return result; }
          var weight = 1.0;
          if (depth > 0) { weight = disneyPathPower(previousPdf, env.pdf); }
          if (options.medium && !options.volumeMis && !surfaceScatter) { weight = 1.0; }
          if (weight > 0.0) {
            result.color = vec4f(result.color.rgb + weight * env.color * throughput * options.environmentIntensity, result.color.a);
          }
        }
      }
      break;
    }
    var surface = disneySurface(hit, origin, direction);
    let context = DisneyMaterialContext(surface.uv, surface.normal, surface.tangent, surface.bitangent, direction,
      surface.normalValid, surface.uvValid, surface.tangentValid, options.flipNormalY,
      options.mollify && depth > 0, previousRoughness, options.mollificationAmount);
    let mat = disneyLoadMaterial(hit.material, context);
    if (mat.error != 0u) { result.error = 500u + mat.error; return result; }
    if (mat.materialType != 0) { result.error = 500u; return result; }
    result.color = vec4f(result.color.rgb + mat.emission * throughput, result.color.a);
    previousRoughness = mat.roughness;
    if (depth == i32(options.maxDepth)) { break; }
    surfaceScatter = false;
    var mediumSampled = false;
    if (options.medium && inMedium) {
      if (mediumType == 1) {
        throughput *= exp(-(vec3f(1.0) - mediumColor) * hit.t * mediumDensity);
      } else if (mediumType == 3) {
        result.color = vec4f(result.color.rgb + mediumColor * hit.t * mediumDensity * throughput, result.color.a);
      } else if (mediumType == 2) {
        if (mediumDensity <= 0.0) { result.error = 10u; return result; }
        let distance = min(-log(disneyRandom(seed)) / mediumDensity, hit.t);
        mediumSampled = distance < hit.t;
        if (mediumSampled) {
          throughput *= mediumColor;
          origin += direction * distance;
          surface.position = origin;
          let direct = disneyPathDirect(options, direction, surface, mat, false, mediumAnisotropy, seed);
          if (direct.error != 0u) { result.error = direct.error; return result; }
          result.color = vec4f(result.color.rgb + direct.color * throughput, result.color.a);
          var random: vec2f;
          random.x = disneyRandom(seed); random.y = disneyRandom(seed);
          let nextDirection = disneyPathSamplePhase(-direction, mediumAnisotropy, random);
          if (!disneyBsdfUnit(nextDirection)) { result.error = 9u; return result; }
          previousPdf = disneyPathPhase(dot(-direction, nextDirection), mediumAnisotropy);
          direction = nextDirection;
        }
      } else {
        result.error = 10u; return result;
      }
    }
    if (!mediumSampled) {
      var skip = false;
      if (options.alphaTest) {
        if (mat.alphaMode == 2 && mat.opacity < mat.alphaCutoff) { skip = true; }
        else if (mat.alphaMode == 1 && disneyRandom(seed) > mat.opacity) { skip = true; }
      }
      if (skip) {
        depth--;
      } else {
        surfaceScatter = true;
        let direct = disneyPathDirect(options, direction, surface, mat, true, mediumAnisotropy, seed);
        if (direct.error != 0u) { result.error = direct.error; return result; }
        result.color = vec4f(result.color.rgb + direct.color * throughput, result.color.a);
        var random: vec3f;
        random.x = disneyRandom(seed); random.y = disneyRandom(seed); random.z = disneyRandom(seed);
        let scatter = disneySample(mat, -direction, mat.faceNormal, random);
        if (scatter.error != 0u) { result.error = 600u + scatter.error; return result; }
        if (scatter.pdf <= 0.0) { break; }
        throughput *= scatter.value / scatter.pdf;
        previousPdf = scatter.pdf;
        direction = scatter.direction;
      }
      origin = surface.position + direction * 0.0003;
      if (options.medium && mat.mediumType != 0) {
        if (dot(direction, mat.normal) < 0.0) {
          inMedium = true;
          mediumType = mat.mediumType;
          mediumDensity = mat.mediumDensity;
          mediumColor = mat.mediumColor;
          mediumAnisotropy = mat.mediumAnisotropy;
        } else {
          inMedium = false;
        }
      }
    }
    if (options.russianRoulette && depth >= i32(options.rrDepth)) {
      let q = min(max(throughput.x, max(throughput.y, throughput.z)) + 0.001, 0.95);
      if (disneyRandom(seed) > q) { break; }
      throughput /= q;
    }
    if (!disneyLightFinite3(throughput) || !disneyLightFinite3(result.color.rgb)) {
      result.error = 9u; return result;
    }
  }
  if (!disneyLightFinite3(result.color.rgb)) { result.error = 9u; }
  return result;
}
`;
