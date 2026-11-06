import { bvhTraversalWgsl } from '../pathtracing/bvh-wgsl.ts';
import { analyticLightsWgsl } from '../pathtracing/analytic-lights.ts';
import { PT_MATERIAL_RECORD_FLOATS } from '../pathtracing/material-record.ts';
import { volumeFieldWgsl } from '../volume-field.ts';

export const RASTER_VOLUME_UNIFORM_BYTES = 144;

/** Single scattering over mesh-bounded media, composited in linear HDR. */
export function rasterVolumeWgsl(grid: boolean, lights: boolean): string {
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
${bvhTraversalWgsl()}
${volumeFieldWgsl(grid)}
${lights ? analyticLightsWgsl(0,9,'u32(V.settings.w)','PI','RAY_EPS') : ''}
fn volume_material(index: u32) -> bool { return materials[index*${PT_MATERIAL_RECORD_FLOATS}u+29u] != 0.0; }
fn boundary_normal(tri: u32) -> vec3f {
  return normalize(cross(tri_vertex(tri,1u)-tri_vertex(tri,0u),tri_vertex(tri,2u)-tri_vertex(tri,0u)));
}
fn shadow_volume(origin: vec3f, direction: vec3f, distance: f32, initial: u32) -> vec3f {
  var p = origin;
  var remaining = distance;
  var mediumIndex = initial;
  var tr = vec3f(1.0);
  loop {
    let hit = traverse(p,direction,remaining,false);
    let length = select(remaining,hit.t,hit.hitAny);
    if (mediumIndex != 0xffffffffu && length < 1e29) {
      let ds = length/12.0;
      for (var i=0u;i<12u;i++) {
        let m = volume_field(mediumIndex,p+direction*(f32(i)+0.5)*ds);
        tr *= exp(-(m.absorption+m.scattering)*ds);
      }
    }
    if (!hit.hitAny) { return tr; }
    let index = tri_material(hit.tri);
    if (!volume_material(index)) { return vec3f(0.0); }
    mediumIndex = select(0xffffffffu,index,dot(direction,boundary_normal(hit.tri)) < 0.0);
    p += direction*(hit.t+2.0*RAY_EPS);
    remaining -= hit.t+2.0*RAY_EPS;
    if (remaining <= RAY_EPS) { return tr; }
  }
}
fn single_scattering(p: vec3f, rd: vec3f, index: u32, g: f32) -> vec3f {
  var result = V.environment.xyz;
${lights ? `
  let count = u32(V.settings.w);
  for (var i=0u;i<count;i++) {
    let light = mx_sample_light(p,vec3f(0.5,0.5,(f32(i)+0.5)/f32(count)));
    if (light.pdf > 0.0) {
      result += light.radiance*volume_phase(dot(rd,light.direction),g)*
        shadow_volume(p,light.direction,light.distance-2.0*RAY_EPS,index)/(light.pdf*f32(count));
    }
  }` : `
  let wi = normalize(V.lightDirection.xyz);
  result += V.lightColor.xyz*volume_phase(dot(rd,wi),g)*shadow_volume(p,wi,1e30,index);
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
  var radiance = vec3f(0.0);
  var tr = vec3f(1.0);
  var first = true;
  loop {
    let hit = traverse(ro,rd,1e30,false);
    if (!hit.hitAny) { break; }
    let index = tri_material(hit.tri);
    let normal = boundary_normal(hit.tri);
    if (first && volume_material(index) && dot(rd,normal) > 0.0) { mediumIndex = index; }
    first = false;
    if (mediumIndex != 0xffffffffu) {
      let count = u32(V.settings.z);
      let ds = hit.t/f32(count);
      for (var i=0u;i<count;i++) {
        let p = ro+rd*(f32(i)+0.5)*ds;
        let m = volume_field(mediumIndex,p);
        let extinction = m.absorption+m.scattering;
        let stepTr = exp(-extinction*ds);
        var integral = vec3f(ds);
        for (var c=0u;c<3u;c++) {
          if (extinction[c] > 1e-6) { integral[c] = (1.0-stepTr[c])/extinction[c]; }
        }
        var source = m.emission;
        if (max(m.scattering.x,max(m.scattering.y,m.scattering.z)) > 0.0) {
          source += m.scattering*single_scattering(p,rd,mediumIndex,m.anisotropy);
        }
        radiance += tr*source*integral;
        tr *= stepTr;
      }
    }
    if (!volume_material(index)) { break; }
    mediumIndex = select(0xffffffffu,index,dot(rd,normal) < 0.0);
    ro += rd*(hit.t+2.0*RAY_EPS);
  }
  let background = textureLoad(hdr,vec2i(in.position.xy),0);
  return vec4f(radiance+tr*background.xyz,background.w);
}
`;
}
