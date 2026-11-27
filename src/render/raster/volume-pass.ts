import { bvhTraversalWgsl } from '../pathtracing/bvh-wgsl.ts';
import { analyticLightsWgsl } from '../pathtracing/analytic-lights.ts';
import { PT_MATERIAL_RECORD_FLOATS } from '../pathtracing/material-record.ts';
import { volumeDomainsWgsl, volumeFieldWgsl, type VolumeDomain } from '../volume-field.ts';

export const RASTER_VOLUME_UNIFORM_BYTES = 144;

/** Single scattering over mesh-bounded media, composited in linear HDR. */
export function rasterVolumeWgsl(grid: boolean, lights: boolean, domains?: readonly VolumeDomain[]): string {
  return `
struct VolumeCamera {
  invViewProj: mat4x4f, eye: vec4f, lightDirection: vec4f, lightColor: vec4f,
  environment: vec4f, settings: vec4f
};
@group(0) @binding(0) var hdr: texture_2d<f32>;
@group(0) @binding(1) var<storage,read> nodes: array<f32>;
@group(0) @binding(2) var<storage,read> tris: array<f32>;
@group(0) @binding(3) var<storage,read> triOrder: array<u32>;
@group(0) @binding(4) var<storage,read> materials: array<f32>;
@group(0) @binding(5) var<uniform> V: VolumeCamera;
const NODE_STRIDE = 12u;
const TRI_STRIDE = 19u;
const RAY_EPS = 1e-4;
const PI = 3.14159265358979;
${bvhTraversalWgsl(domains !== undefined)}
${volumeFieldWgsl(grid)}
${domains ? volumeDomainsWgsl(domains) : ''}
${lights ? analyticLightsWgsl(0,9,'u32(V.settings.w)','PI','RAY_EPS') : ''}
fn volume_material(index: u32) -> bool { return materials[index*${PT_MATERIAL_RECORD_FLOATS}u+29u] != 0.0; }
${domains ? `fn volume_boundary(index: u32) -> bool { return materials[index*${PT_MATERIAL_RECORD_FLOATS}u+37u] != 0.0; }` : ''}
fn boundary_normal(tri: u32) -> vec3f {
  return normalize(cross(tri_vertex(tri,1u)-tri_vertex(tri,0u),tri_vertex(tri,2u)-tri_vertex(tri,0u)));
}
${domains ? `// Per-instance volume counts at the current march sample: shadow rays start from them
// instead of recomputing containment at every step (copied element-wise, see compute.ts).
var<private> mx_march_volumes: array<u32, ${domains.length}>;` : ''}
fn shadow_volume(origin: vec3f, direction: vec3f, distance: f32, initial: u32) -> vec3f {
  var p = origin;
  var remaining = distance;
  var mediumIndex = initial;
${domains ? `  if (mediumIndex != 0xffffffffu && volume_boundary(mediumIndex)) { mediumIndex = 0xffffffffu; }
  var activeVolumes: array<u32, ${domains.length}>;
  var activeVolumeCount = 0u;
  for (var domain = 0u; domain < MX_VOLUME_DOMAIN_COUNT; domain++) {
    activeVolumes[domain] = mx_march_volumes[domain];
    activeVolumeCount += activeVolumes[domain];
  }` : ''}
  var tr = vec3f(1.0);
  loop {
    let hit = traverse(p,direction,remaining,false);
    let length = select(remaining,hit.t,hit.hitAny);
    if (${domains ? '(mediumIndex != 0xffffffffu || activeVolumeCount > 0u) && length < 1e29' : 'mediumIndex != 0xffffffffu && length < 1e29'}) {
      let ds = length/12.0;
      for (var i=0u;i<12u;i++) {
${domains ? `        var extinction = vec3f(0.0);
        for (var domain = 0u; domain < MX_VOLUME_DOMAIN_COUNT + 1u; domain++) {
          var multiplicity = 0u;
          var index = mediumIndex;
          if (domain < MX_VOLUME_DOMAIN_COUNT) {
            multiplicity = activeVolumes[domain];
            index = mx_volume_domains[domain].x;
          } else if (mediumIndex != 0xffffffffu) { multiplicity = 1u; }
          if (multiplicity > 0u) {
            let m = volume_field(index,p+direction*(f32(i)+0.5)*ds);
            extinction += f32(multiplicity) * (m.absorption+m.scattering);
          }
        }
        tr *= exp(-extinction*ds);` : `
        let m = volume_field(mediumIndex,p+direction*(f32(i)+0.5)*ds);
        tr *= exp(-(m.absorption+m.scattering)*ds);`}
      }
    }
    if (!hit.hitAny) { return tr; }
    let index = tri_material(hit.tri);
    if (!volume_material(index)) { return vec3f(0.0); }
    p += direction*(hit.t+2.0*RAY_EPS);
${domains ? `    if (volume_boundary(index)) { activeVolumeCount = mx_update_volume_domains(p, &activeVolumes); }
    else { mediumIndex = select(0xffffffffu,index,dot(direction,boundary_normal(hit.tri)) < 0.0); }`
    : '    mediumIndex = select(0xffffffffu,index,dot(direction,boundary_normal(hit.tri)) < 0.0);'}
    remaining -= hit.t+2.0*RAY_EPS;
    if (remaining <= RAY_EPS) { return tr; }
  }
}
// Approximate multiple scattering (Wrenninge-style octaves): octave i only returns light the
// shadow path attenuated, a_i (T^(b_i) - T), with b_i = c_i = 2^-i and a_i proportional to
// (albedo/2)^i. It vanishes in thin or absorbing media; deep inside a conservative medium the
// octaves sum to 3x single scattering, the diffusion limit (E/pi against E/(4 pi) isotropic).
const MS_GAIN = 3.0 / 0.875;
fn volume_albedo(m: VolumeField) -> f32 {
  let extinction = m.absorption + m.scattering;
  return max(m.scattering.x, max(m.scattering.y, m.scattering.z)) / max(max(extinction.x, max(extinction.y, extinction.z)), 1e-30);
}
fn ms_ambient(tr: vec3f, albedo: f32) -> vec3f {
  var result = tr;
  var a = MS_GAIN;
  var b = 1.0;
  for (var i = 1u; i < 4u; i++) {
    a *= 0.5 * albedo; b *= 0.5;
    result += a * (pow(max(tr, vec3f(1e-30)), vec3f(b)) - tr);
  }
  return result;
}
fn ms_light(tr: vec3f, cosine: f32, g: f32, albedo: f32) -> vec3f {
  var result = tr * volume_phase(cosine, g);
  var a = MS_GAIN;
  var b = 1.0;
  for (var i = 1u; i < 4u; i++) {
    a *= 0.5 * albedo; b *= 0.5;
    result += a * (pow(max(tr, vec3f(1e-30)), vec3f(b)) - tr) * volume_phase(cosine, g * b);
  }
  return result;
}
fn single_scattering(p: vec3f, rd: vec3f, index: u32, g: f32, albedo: f32) -> vec3f {
  // Two-direction ambient visibility approximates sky/ground self-shadowing.
  var result = V.environment.xyz * 0.5 *
    (ms_ambient(shadow_volume(p,vec3f(0.0,1.0,0.0),1e30,index), albedo)
      + ms_ambient(shadow_volume(p,vec3f(0.0,-1.0,0.0),1e30,index), albedo));
${lights ? `
  let count = u32(V.settings.w);
  for (var i=0u;i<count;i++) {
    let light = mx_sample_light(p,vec3f(0.5,0.5,(f32(i)+0.5)/f32(count)));
    if (light.pdf > 0.0) {
      result += light.radiance*ms_light(shadow_volume(p,light.direction,light.distance-2.0*RAY_EPS,index),
        dot(-rd,light.direction),g,albedo)/(light.pdf*f32(count));
    }
  }` : `
  let wi = normalize(V.lightDirection.xyz);
  result += V.lightColor.xyz*ms_light(shadow_volume(p,wi,1e30,index),dot(-rd,wi),g,albedo);
`}
  return result;
}
struct VO { @builtin(position) position: vec4f };
@vertex fn vs(@builtin(vertex_index) i: u32) -> VO {
  var p = array<vec2f,3>(vec2f(-1.0,-3.0),vec2f(-1.0,1.0),vec2f(3.0,1.0));
  return VO(vec4f(p[i],0.0,1.0));
}
@fragment fn fs(in: VO) -> @location(0) vec4f {
  let ndc = vec2f(in.position.x/V.settings.x*2.0-1.0,1.0-in.position.y/V.settings.y*2.0);
  let near = V.invViewProj*vec4f(ndc,0.0,1.0);
  let far = V.invViewProj*vec4f(ndc,1.0,1.0);
  let rd = normalize(far.xyz/far.w-near.xyz/near.w);
  var ro = near.xyz/near.w;
  var mediumIndex = 0xffffffffu;
${domains ? `  var activeVolumes: array<u32, ${domains.length}>;
  var activeVolumeCount = mx_update_volume_domains(ro, &activeVolumes);` : ''}
  var radiance = vec3f(0.0);
  var tr = vec3f(1.0);
  var first = true;
  loop {
    let hit = traverse(ro,rd,1e30,false);
    if (!hit.hitAny) { break; }
    let index = tri_material(hit.tri);
    let normal = boundary_normal(hit.tri);
    if (first && volume_material(index)${domains ? ' && !volume_boundary(index)' : ''} && dot(rd,normal) > 0.0) { mediumIndex = index; }
    first = false;
    if (mediumIndex != 0xffffffffu${domains ? ' || activeVolumeCount > 0u' : ''}) {
${domains ? '      for (var domain = 0u; domain < MX_VOLUME_DOMAIN_COUNT; domain++) { mx_march_volumes[domain] = activeVolumes[domain]; }' : ''}
      let count = u32(V.settings.z);
      let ds = hit.t/f32(count);
      for (var i=0u;i<count;i++) {
        let p = ro+rd*(f32(i)+0.5)*ds;
${domains ? `        var extinction = vec3f(0.0);
        var source = vec3f(0.0);
        for (var domain = 0u; domain < MX_VOLUME_DOMAIN_COUNT + 1u; domain++) {
          var multiplicity = 0u;
          var fieldIndex = mediumIndex;
          if (domain < MX_VOLUME_DOMAIN_COUNT) {
            multiplicity = activeVolumes[domain];
            fieldIndex = mx_volume_domains[domain].x;
          } else if (mediumIndex != 0xffffffffu) { multiplicity = 1u; }
          if (multiplicity > 0u) {
            let m = volume_field(fieldIndex,p);
            let scale = f32(multiplicity);
            extinction += scale * (m.absorption+m.scattering);
            source += scale * m.emission;
            if (max(m.scattering.x,max(m.scattering.y,m.scattering.z)) > 0.0) {
              source += scale * m.scattering * single_scattering(p,rd,fieldIndex,m.anisotropy,volume_albedo(m));
            }
          }
        }` : `
        let m = volume_field(mediumIndex,p);
        let extinction = m.absorption+m.scattering;`}
        let stepTr = exp(-extinction*ds);
        var integral = vec3f(ds);
        for (var c=0u;c<3u;c++) {
          if (extinction[c] > 1e-6) { integral[c] = (1.0-stepTr[c])/extinction[c]; }
        }
${domains ? '' : `        var source = m.emission;
        if (max(m.scattering.x,max(m.scattering.y,m.scattering.z)) > 0.0) {
          source += m.scattering*single_scattering(p,rd,mediumIndex,m.anisotropy,volume_albedo(m));
        }`}
        radiance += tr*source*integral;
        tr *= stepTr;
      }
    }
    if (!volume_material(index)) { break; }
    ro += rd*(hit.t+2.0*RAY_EPS);
${domains ? `    if (volume_boundary(index)) { activeVolumeCount = mx_update_volume_domains(ro, &activeVolumes); }
    else { mediumIndex = select(0xffffffffu,index,dot(rd,normal) < 0.0); }`
    : '    mediumIndex = select(0xffffffffu,index,dot(rd,normal) < 0.0);'}
  }
  let background = textureLoad(hdr,vec2i(in.position.xy),0);
  return vec4f(radiance+tr*background.xyz,background.w);
}
`;
}
