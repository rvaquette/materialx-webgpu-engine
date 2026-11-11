# LamaConductor Parameter Corpus

Reference: https://rmanwiki-26.pixar.com/space/REN26/19661511/LamaConductor

This is NOT complete RenderMan compatibility. There are 21 parameter examples,
including 4 explicitly unsupported controls. `coverage.json` is the authoritative
inventory. Unsupported examples are labelled in the scene selector and emit a
compiler warning; they are not demonstrations of working AOVs or mollification.

Every scene uses the same camera, geometry and lighting as the LamaLayer gold
scenes. The teapot and its stand use the selected conductor. Ground assets are
shared with the existing corpus. Numeric controls are editable uniforms.

## Implemented Controls

- Tint, artistic/scientific Fresnel mode, reflectivity, edge color, eta and kappa.
- Roughness and a connected procedural normal-map example.
- Positive and negative anisotropy, brushing direction and signed rotation in turns.
- Exterior IOR: eta and kappa are divided by the positive exterior-medium IOR.
- Tail Mix / Length: an engine equivalent, NOT Pixar's proprietary tail model.
  The BSDF is `(1 - tailMix) * GGX(main) + tailMix * GGX(tail)`;
  tail roughness is `mix(roughness, 1, clamp(tailLength, 0, 1))`.
  Nonpositive tail length disables the extra lobe. Both lobes use matching
  evaluation and sampling PDFs, and their weights sum to one.
- Energy Compensation: an engine Kulla-Conty-style multiple-scattering equivalent.
  A 16x16 GGX directional-albedo reference is integrated with 2048 deterministic
  NDF samples per cell, then fitted by a degree-5 polynomial in roughness and
  view cosine. CPU and WGSL use the same fit; WGSL has no dynamically indexed
  constant albedo array. The reciprocal missing-
  energy term is cosine-sampled as part of the conductor BSDF, with a matching
  mixture PDF. Fresnel averaging uses a Schlick integral fit. The albedo table
  reference is isotropic: compensation on anisotropic/film-coated conductors remains an
  approximation. This is not a reproduction of RenderMan's compensation.

Advanced inputs absent from the upstream MaterialX NodeDef are declared in
`ND_engine_lama_conductor`, inheriting the standard NodeDef. External MaterialX
libraries are not modified. Energy compensation defaults to 0 to preserve the
previous engine appearance; its example enables it at roughness 0.8.

## Not Implemented

| Parameter | Missing Infrastructure |
| --- | --- |
| Surface Mollification | Per-hit curvature/normal-variance data supplied to material graphs |
| Motion Mollification | Shutter interval, time-dependent geometry and motion/velocity data |
| Lobe Name | Named light-path expressions, per-lobe accumulation and AOV routing |
| Matte | Per-lobe final-weight AOV accumulation and export |

The engine's existing display coverage buffer is NOT a per-lobe Matte AOV.
These four controls cannot be simulated by changing the beauty color or attaching
metadata alone. Their example images keep the baseline shading and warn about the
missing effect. They are retained as explicit outstanding conformance cases.

## Generation And Validation

Regenerate with `node scripts/build-lama-conductor-scenes.mjs`.

Tests cover MaterialX Core resolution of all 21 materials, the common camera and
USD references, signed anisotropy, tail weights, exterior optical constants,
compensation reciprocity, evaluation/sampling agreement and white-furnace energy.
Numerical RenderMan equivalence has NOT been qualified.