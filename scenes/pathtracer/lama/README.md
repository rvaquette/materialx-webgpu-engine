# Lama Test Scenes

Small path-tracer scenes derived from `test_thinwalled_transmission.usda`.
They reuse its floor and sphere OBJ assets, compensate their local origins,
and frame the four materials with an oriented USD camera.

- `test_lama_sss.usda`, left to right: diffuse control, exponential random walk
  with IOR 1.3, normalized Burley with diffuse distance, Burley with volumetric MFP.
- `test_lama_closures.usda`: exact conductor Fresnel, generalized Schlick,
  dielectric-over-diffuse layer, and a diffuse/sheen mix.

The paired `.mtlx` documents use the Lama node definitions loaded by the engine.
Render with `usd-image-harness.html?entry=/scenes/pathtracer/lama/test_lama_sss.usda&backend=pathtracing&res=256&spp=32`.

## SSS Model Contract

- `sssMode=1`: exponential homogeneous random walk. With
  `albedoInversionMethod=1`, Chiang maps colour to single-scatter albedo and
  sigma_t is exactly 1 / radius (no diffuse-MFP remapping).
  Active exponential interfaces are neutral cosine-transmission boundaries:
  colour is applied by the medium only, not again at entry and exit. A zero
  radius still selects the coloured local Lambert response.
- `sssMode=2`: a normalized two-exponential Burley spatial BSSRDF. Radius is
  interpreted as mean radial distance, so diffusion length is radius / 2.5.
- `sssMode=3`: the same spatial profile with diffusion length derived from
  volumetric MFP: radius / sqrt(3 * (1 - alpha) * (1 - alpha * g)).
  These are explicit engine parameterizations, not verified RenderMan remappings.
- Burley uses three projection axes (normal/tangent/bitangent with probabilities
  0.5/0.25/0.25), samples matching-material exits, and includes all three area
  PDFs, projection Jacobians and exit-selection probabilities in its density.
  Separate objects sharing a material share the diffusion domain. The GPU limits
  projection to 128 crossings; paths exceeding this safety bound are terminated.
- Random-walk `sssIOR` triggers total internal reflection at the exit boundary.
  Burley currently requires IOR 1; mode 2 also requires anisotropy 0.
- Radius zero remains local Lambert. Zero-radius individual channels retain a
  local component instead of losing their energy.
- Davis (`sssMode=0`) and Pixar inversion (`albedoInversionMethod=0`) are not
  implemented and are rejected for active SSS, including when NodeDef defaults
  select them. Author mode 1/2/3 and inversion 1 explicitly.
- Nonzero bleed/topology/continuation, nonempty subset, non-reflection surface
  mode, and outer coat/sheen/fuzz/thin-film layers on Burley are rejected rather
  than ignored. Additive and mixed lobes use a compensated event-selection step.
- Raster remains a local preview; spatial diffusion is a path-tracer operation.

## Mobile Interface Regression (2026-11-10)

Exponential SSS no longer multiplies diffuse colour at entry and exit on top of
the medium coefficients. CPU tests verify neutral interface throughput in both
directions, matching evaluation/sampling, and the zero-radius Lambert limit.

Samsung SM-F731B / Adreno 7xx, 512x512, unchanged scene and camera:

| SPP | Render Time | Image |
| --- | --- | --- |
| 32 | 16.54 s | `renders/device-lama-sss-corrected-32spp.png` |
| 128 | 64.76 s | `renders/device-lama-sss-corrected-128spp.png` |
| 512 | 258.39 s | `renders/device-lama-sss-corrected-512spp.png` |

All three runs reported zero WGSL errors and zero nonfinite accumulation values.
The 512-spp PNG was recovered from the completed mobile CDP result after the
terminal collector stopped; the phone completed all 512 samples.

Display-RGB RMS differences to the 512-spp image, measured on 3209-pixel disks
of radius 32 at (198,256), (312,256), and (426,256), with RGB normalized to [0,1]:

| Model | 32 vs 512 | 128 vs 512 | Error Ratio |
| --- | --- | --- | --- |
| Exponential | 0.12255 | 0.05498 | 0.449 |
| Burley diffuse distance | 0.08112 | 0.03439 | 0.424 |
| Burley MFP | 0.09840 | 0.04131 | 0.420 |

This checks image convergence, not equivalence to RenderMan or an unbiased
infinite-depth solution. The 512-spp image is a finite-sample reference, and
the render retains the scene's maxDepth=12 limit. Visible random-walk noise remains.

Validation: 489 tests passed across 35 files, excluding the existing
`analytic-lights.test.ts` traversal-string mismatch; production build/typecheck
passed. The direct interface/SSS/compiler subset passed 96 tests.

## Local Depth Comparison (2026-11-10)

The 12/32/64 depth experiment was run on the desktop Intel gen-12lp GPU in
Chrome WebGPU, not on Android. All runs used the same dense scene, material,
camera, 256x256 resolution, 512 spp and eight samples per dispatch. The scene
file was not changed; `maxDepth` was overridden by the image harness.

Each run validated its requested URL, resolution, sample count and actual
`benchmark.sceneMetadata.maxDepth`, and saved both PNG and linear HDR RGBA
Float32 data. All pixels had 512 accumulated samples and finite RGB values.

Second-sphere centre: (99,128), disk radius 16, 797 pixels. Luminance uses
linear RGB weights (0.2126,0.7152,0.0722), before exposure/tonemapping:

| Max Depth | Render Time | Mean Luminance | Change from Depth 12 |
| --- | --- | --- | --- |
| 12 | 65.42 s | 0.187816 | baseline |
| 32 | 68.02 s | 0.221059 | +17.70% |
| 64 | 83.83 s | 0.231947 | +23.50% |

The second sphere still gains 4.93% from depth 32 to 64. Its red-channel mean
rises from 0.372947 to 0.570651 (+53.01%) between depths 12 and 64, while the
other sphere-centre luminances change by less than 0.2%. This supports a
depth-truncation loss in the exponential walk, not just a tonemapping effect.
It does not establish convergence at depth 64: the estimates retain sampling
noise, Russian roulette, and the finite depth limit.

Artifacts are `renders/local-test_lama_sss-pathtracing-depth{12,32,64}.png`
and matching JSON files. The compact measurements and paired-pixel standard
errors are in `renders/local-lama-sss-depth-comparison.json`.

The local runner accepts `MX_ENTRIES`, `MX_MAX_DEPTH`, `MX_TILE_SPP` and
`MX_CDP_PORT`; depth overrides automatically enable HDR benchmark export.
Eight samples per dispatch keep this experiment within the benchmark timestamp
query budget. The experiment used `MX_PORT=5200` and `MX_CDP_PORT=9235`, avoiding
the Android debugging port. No new mobile render was launched for this run.

## Independent SSS Walk (2026-11-10)

CPU and WGSL now track surface depth separately from subsurface events.
Exponential SSS collisions and total internal reflections do not consume the
surface `maxDepth` budget. They use their own event counter for Russian roulette,
with survival probability based on throughput (capped at 0.95) and reciprocal
throughput compensation. Exiting a subsurface interior resets this counter.
Ordinary participating-medium collisions still consume the normal path budget.
Both integrators retain a separate 65,536-total-step emergency guard, so this is
not a claim of mathematically unlimited transport in pathological scenes.

Tests cover forty internal collisions with only two surface events, compensated
mean energy in a nonabsorbing medium, total internal reflection with the same
two-surface budget, and matching CPU/GPU classification of SSS interiors.

The local 12/32/64 experiment was repeated without changing the scene, material,
camera or sampling parameters. `MX_OUTPUT_TAG=sss-independent` preserves the old
runs. Same HDR centre disk and linear Rec.709 luminance as above:

| Surface Max Depth | Render Time | Second-Sphere Mean Luminance |
| --- | --- | --- |
| 12 | 69.18 s | 0.226712894 |
| 32 | 69.69 s | 0.226711120 |
| 64 | 69.69 s | 0.226711120 |

The 12-to-64 variation is -0.000782%, versus +23.497% before the fix. The sampled
32/64 HDR values match exactly in the centre disk. This validates removal of the
surface-depth dependence for this test, not convergence in spp or equivalence to
RenderMan. Visible Monte Carlo noise remains.

New PNG/HDR pairs:
`renders/local-test_lama_sss-pathtracing-depth{12,32,64}-sss-independent.{png,json}`.
Report: `renders/local-lama-sss-independent-depth-comparison.json`.
All three runs reported zero WGSL errors and zero nonfinite RGB components.
Validation: 493 tests passed in 35 files (the pre-existing analytic-lights
traversal-string assertion remains excluded), and production build/typecheck
passed. The focused transport suite passed 132 tests. Validation was local only.