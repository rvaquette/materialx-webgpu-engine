// T055d-volume: emit WGSL `MxVolumeMedium` struct and helpers
// for volumeshader rendering. Parallel to surface-wgsl.ts but simpler:
// volumeshaders take only a VDF closure + 3 parameters (absorption, scattering,
// anisotropy) rather than the complex BSDF composition of surfaces.
// The generated code interfaces with path tracer media.ts and raster volume.ts.

export const VOLUME_MEDIUM_PRELUDE = `
// Volume medium parameters for participating media rendering
struct MxVolumeMedium {
  absorption: vec3f,    // sigma_a: absorption coefficient (per channel)
  scattering: vec3f,    // sigma_s: scattering coefficient (per channel)
  anisotropy: f32,      // g: Henyey-Greenstein anisotropy in [-1, 1]
  emission: vec3f,
};

// Helper: extinction coefficient (sigma_t = sigma_a + sigma_s)
fn mx_extinction(medium: MxVolumeMedium) -> vec3f {
  return medium.absorption + medium.scattering;
}

// Helper: single-scattering albedo (sigma_s / sigma_t)
fn mx_scattering_albedo(medium: MxVolumeMedium) -> vec3f {
  let sigma_t = mx_extinction(medium);
  return select(vec3f(0.0), medium.scattering / sigma_t, sigma_t > vec3f(0.0));
}

// Helper: Beer-Lambert transmittance over distance d
fn mx_transmittance(medium: MxVolumeMedium, distance: f32) -> vec3f {
  let sigma_t = mx_extinction(medium);
  let d = max(distance, 0.0);
  return exp(-sigma_t * d);
}
`;
