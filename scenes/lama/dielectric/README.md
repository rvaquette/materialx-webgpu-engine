# LamaDielectric Parameter Corpus

Reference: https://rmanwiki-26.pixar.com/space/REN26/19661513/LamaDielectric

34 scenes share the Lama teapot camera and lighting. The scene selector labels
24 working shading examples and 10 unsupported parameter probes separately.
`coverage.json` records the status of each case. This is functional, partial
RenderMan-style compatibility, NOT numerical equivalence to RenderMan.

## Supported Shading

- Reflection Tint and Transmission Tint; artistic reflectivity and scientific IOR.
- Roughness, connected normal mapping, signed anisotropy, direction and rotation.
  Reflection and refraction both use anisotropic GGX sampling/evaluation.
- Exterior IOR: the surface IOR is divided by the positive exterior-medium IOR.
- Absorption Color is transmittance after Absorption Radius scene units:
  `sigmaT = -log(clamp(color, 1e-6, 1)) / max(radius, 1e-6)`.
  White is transparent, black approaches complete absorption. This corrects the
  previous engine interpretation of the color as a raw absorption coefficient.
- Scatter Color is medium albedo: `sigmaS = sigmaT * scatterColor`,
  `sigmaA = sigmaT * (1 - scatterColor)`. White absorption color has no density
  and therefore does not scatter. Scatter Anisotropy is clamped to [-0.99,0.99].
- The Lama interface uses separate reflection and transmission branches. Its
  transmission does not add a second reflection term. The reflected branch
  evaluates exact dielectric Fresnel, including total internal reflection.

## Engine Equivalents

- Tail Mix blends the main reflection/refraction pair with a wider GGX pair.
  Tail roughness is `mix(roughness, 1, clamp(tailLength, 0, 1))`.
  Nonpositive tail length disables the extra pair. This is not Pixar's tail model.
- Dispersion uses the engine's persistent RGB hero-channel approximation, not
  full spectral RenderMan transport. Mode 0 uses `dispersionSpread`; mode 1 uses
  `20 / max(dispersionAbbe, 1)`. Saturation scales that strength between 0 and 1:
  zero collapses the chromatic IOR differences. In engine channel order R/G/B,
  `n[channel] = max(1, n + (channel - 1) * (n - 1) * 0.025 * strength)`.
  This reproduces the intended controllability, not RenderMan's spectral model
  or exact saturation behavior. Exterior-medium ratios below 1 are not qualified
  for dispersive transport, which clamps per-channel IOR to 1.

## Explicit Limitations

Unsupported controls produce a compiler warning and retain the baseline beauty
shading. Their scenes are conformance probes, not working effect demonstrations:

| Parameter | Missing Behavior |
| --- | --- |
| Energy Compensation | Dielectric multiple-scattering compensation |
| Shadow Density / Coloring / Fresnel Front / Fresnel Back | Artistic colored transmission-shadow controls |
| Surface Mollification | Per-hit curvature/normal-variance data |
| Motion Mollification | Time-dependent geometry, velocity and shutter data |
| Lobe Name / Matte | Named LPE/AOV routing, per-lobe accumulation and export |
| Interior Id | Nested-medium tracking by named/numbered interior |

The raster backend is a direct-light preview, not volumetric refractive transport;
inspect absorption, scattering and dispersion with the path tracer. Transparent
shadow caustics and artistic shadow overrides are not implemented. Nested or
overlapping media, internal-reflection tint matching, and Tail used as a
LamaLayer coat are not qualified for RenderMan fidelity. A single coating slot
cannot reproduce both roughness components of the Tail pair.

## Generation And Tests

`node scripts/build-lama-dielectric-scenes.mjs` regenerates the corpus.

Numeric inputs are editable uniforms; IOR, roughness, tail and dispersion changes
do not require graph recompilation. Tests cover actual MaterialX Core resolution,
USD references/common camera, Beer-Lambert coefficients, scattering albedo,
exterior IOR, Abbe mapping, tail weights, signed anisotropy, reflection/refraction
separation, total internal reflection, sampling/PDF agreement, and closure codecs.