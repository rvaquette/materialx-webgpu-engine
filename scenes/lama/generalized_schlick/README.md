# LamaGeneralizedSchlick Parameter Corpus

Reference: https://rmanwiki-26.pixar.com/space/REN26/19661517/LamaGeneralizedSchlick

The corpus has 34 scenes, all using the Lama teapot camera and area lights. The
scene selector lists two groups: 24 working shading examples (6 of them engine
equivalents) and 10 unsupported parameter probes. `coverage.json` records the
status of each case. This gives functional, partial RenderMan-style
compatibility. It is NOT numerically equivalent to RenderMan.

## Supported Shading

- **Reflection Tint and Transmission Tint.**
  - Transmission Tint also tints internal reflection, so the inside of the object
    stays consistent with the transmitted colour.
- **Fresnel Mode 0 (Artistic) and Mode 1 (Scientific).**
  - Artistic mode: `F0 = reflectivity` and `F90 = reflectivity90`, joined by the
    generalized Schlick curve `F0 + (F90 - F0) * (1 - cos)^(1/reflectivityProfile)`.
  - Scientific mode: `F0 = ((eta - 1) / (eta + 1))^2`, where
    `eta = IOR / exteriorIOR`.
- **External reflection** evaluates this exact generalized Schlick curve, with
  isotropic or anisotropic GGX microfacets.
- **Refraction and internal reflection** go through a paired dielectric interface
  (`thin = -1`), as LamaDielectric does. This preserves the signed exit normal and
  total internal reflection.
  - The refraction IOR comes from the Fresnel inputs. In Scientific mode it is the
    mean of `IOR / exteriorIOR`. In Artistic mode it is
    `(1 + sqrt(F0)) / (1 - sqrt(F0))`, divided by `exteriorIOR`.
- **Roughness**, and **Normal** with connected normal mapping.
- **Anisotropy.**
  - Unlike LamaDielectric, Anisotropy here is the roughness along the co-tangent
    axis (the RenderMan convention). A negative value means isotropic.
  - The engine derives a GGX alpha pair `alphaT = roughness^2` and
    `alphaB = anisotropy^2`. When `alphaB > alphaT`, the axes are swapped by
    rotating them a quarter turn.
  - Anisotropy Direction and Anisotropy Rotation are supported.
- **Absorption Color** is the transmittance after travelling Absorption Radius
  scene units: `sigmaT = -log(clamp(color, 1e-6, 1)) / max(radius, 1e-6)`.
- **Scatter Color** is the medium albedo: `sigmaS = sigmaT * scatterColor` and
  `sigmaA = sigmaT * (1 - scatterColor)`. Scatter Anisotropy is clamped to
  [-0.99, 0.99].
- **Exterior IOR** divides the surface IOR. It is an engine extension input,
  declared by `ND_engine_lama_generalized_schlick`.

## Engine Equivalents

- **Energy split.** The transmitted energy follows the paired interface's
  dielectric Fresnel, not `1 - Schlick`. A non-physical Schlick curve (for example
  `F90 < 1`, or a low profile) changes reflection without transferring the
  difference to refraction.
- **Coloured Reflectivity and Reflectivity 90.** These are exact for external
  reflection. The refraction IOR uses the mean of F0.
- **Reflectivity Profile.** The engine maps it to the Schlick exponent
  `1 / profile`, approximating Pixar's profile curve.
- **RGB IOR.** Reflection uses the full RGB Fresnel. Refraction uses the mean IOR,
  so there is no dispersion.
- **Tail Mix and Tail Length.** These blend the main pair with a wider GGX pair.
  The tail roughness is `mix(roughness, 1, clamp(tailLength, 0, 1))`. This is not
  Pixar's tail model.

## Explicit Limitations

Unsupported controls produce a compiler warning and keep the baseline beauty
shading. Their scenes are conformance probes, not demonstrations of a working
effect:

| Parameter | Missing Behavior |
| --- | --- |
| Energy Compensation | Generalized-Schlick multiple-scattering compensation |
| Shadow Density / Coloring / Fresnel Front / Fresnel Back | Artistic colored transmission-shadow controls |
| Surface Mollification | Per-hit curvature/normal-variance data |
| Motion Mollification | Time-dependent geometry, velocity and shutter data |
| Lobe Name / Matte | Named LPE/AOV routing, per-lobe accumulation and export |
| Interior Id | Nested-medium tracking by named/numbered interior |

The raster backend is a direct-light preview without volumetric refractive
transport, so check absorption and scattering in the path tracer.

When a LamaGeneralizedSchlick sits on top of a LamaLayer, it is not converted to a
coat: its closures are merged.

## Generation And Tests

`node scripts/build-lama-generalized-schlick-scenes.mjs` regenerates the corpus.

The tests cover:
- MaterialX Core resolution of every case, with no diagnostics for the supported
  cases and a warning for each unsupported probe;
- USD references and the shared camera;
- the artistic and scientific F0 mappings;
- the co-tangent anisotropy mapping;
- Beer-Lambert coefficients;
- the tail weights;
- paired internal reflection with the interior tint;
- the closure codecs.
