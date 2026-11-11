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

- `sssMode=0`: engine Davis-equivalent heterogeneous walk, not Pixar's original
  formula. A unit-mean gamma density multiplier is drawn once per SSS entry;
  shape and rate are both `2 - 0.75 * sssBleed`. It scales scattering and
  absorption together. Bleed in [0,1] changes the density variance and tail;
  even bleed zero is heterogeneous, unlike mode 1.
- `sssMode=1`: exponential homogeneous random walk. With
  `albedoInversionMethod=1`, Chiang maps colour to single-scatter albedo and
  sigma_t is exactly 1 / radius (no diffuse-MFP remapping).
  Active exponential interfaces are neutral cosine-transmission boundaries:
  colour is applied by the medium only, not again at entry and exit. A zero
  radius still selects the coloured local Lambert response.
- `sssMode=2`: a normalized two-exponential Burley spatial BSSRDF. Radius is
  interpreted as effective mean radial distance, so diffusion length is radius
  / 2.5. This parameterization is independent of albedo and anisotropy; use mode
  3 when anisotropy should change the diffusion length.
- `sssMode=3`: the same spatial profile with diffusion length derived from
  volumetric MFP: radius / sqrt(3 * (1 - alpha) * (1 - alpha * g)). The
  two-flux alpha inversion also includes the specified IOR.
  These are explicit engine parameterizations, not verified RenderMan remappings.
- Burley uses three projection axes (normal/tangent/bitangent with probabilities
  0.5/0.25/0.25), samples matching-domain exits, and includes all three area
  PDFs, projection Jacobians and exit-selection probabilities in its density.
  Separate objects sharing a material share the diffusion domain. The GPU limits
  projection to 128 crossings; paths exceeding this safety bound are terminated.
- Random-walk `sssIOR` triggers total internal reflection at the exit boundary.
  Burley multiplies its spatial response by unpolarized dielectric transmission
  at entry and exit, using the incident/outgoing cosines. This is an engine
  interface model; the diffusion profile itself is not a refractive BSSRDF.
- Radius zero remains local Lambert. Zero-radius individual channels retain a
  local component instead of losing their energy.
- `albedoInversionMethod=0`: engine two-flux equivalent, not Pixar's fitted
  inversion. It uses escape probability `1 / IOR^2`, converts the target colour
  to internal diffuse reflectance, inverts `A = (1-sqrt(1-alpha')) /
  (1+sqrt(1-alpha'))`, and undoes reduced-scattering anisotropy. Extinction uses
  diffuse-MFP remapping `1 / (radius * (1.9-A+3.5*(A-0.8)^2))`.
  Method 1 retains the Chiang polynomial and exponential extinction `1/radius`.
- `sssSubset`: exact uniform group label using letters, digits, `_`, `.`, `:`,
  or `-`. Equal labels share a domain across materials; empty labels retain the
  material-index domain. Labels become exact Float32 integer keys with collision
  detection. RenderMan subset expressions and connected labels are rejected.
- `sssContinuationRays=1`, or a nonempty subset, makes random walks ignore
  foreign-domain surfaces before free-flight sampling. The origin and full optical
  distance are preserved; ignored surfaces consume no random draws or bounces.
  Both implementations terminate after more than 128 foreign crossings.
  Burley already projects through foreign surfaces, so continuation does not
  change its projection algorithm; subset still controls eligible exits.
- `sssFollowTopology` in [0,1] is an explicit normal-based engine equivalent.
  Burley multiplies spatial weight by `1-strength*(1-max(dot(Nentry,Nexit),0))`,
  without altering the sampling PDF. Random walks instead reflect a prospective
  exit with probability `strength*(1-max(dot(Nentry,Nexit),0))`; this redistributes
  paths rather than absorbing them. Normals are smooth shading normals; boundary
  reflection uses the geometric normal. This is not a curvature/topology solver.
- Surface `mode=0` omits exit next-event lighting, but keeps indirect continuation;
  `mode=1` retains internal contributions and stops at the exit; `mode=2` enables
  exit lighting and continuation. These are documented engine selections, not
  a verified RenderMan match. Burley does not support transmission mode 1.
- Outer coat/sheen/fuzz/thin-film controls are no longer blanket-rejected above
  Burley. Spatial base attenuation uses the existing layer stack and entry/exit
  angles; local layer reflection is selected separately with compensated weights.
  The local coat regression covers dielectric-over-Burley; this is not exhaustive
  GPU qualification of every layer combination.
- Nonzero bleed requires mode 0. Transport, inversion, bleed and surface mode
  must be uniform. Mode 2 deliberately treats radius as an effective radial
  distance and does not use albedo, anisotropy or IOR to set that profile length;
  IOR still affects its entry/exit transmission. Mode 3 uses albedo, anisotropy
  and (for inversion 0) IOR in the profile length.
- Raster remains a local preview; spatial diffusion is a path-tracer operation.

## Local Equivalent Controls Validation

`sss-equivalent-controls.mtlx` enables Davis-equivalent transport, two-flux
inversion, bleed 0.5, topology 0.25, subset `skin`, continuation and surface mode 2.
The furnace run on Intel gen-12lp WebGPU at 64x64 and 128 spp completed in 64.34 s,
but its black sphere exposed a missing graph-backed subset lookup despite zero
WGSL messages/nonfinite values. That preliminary image and the `-final` image are
failed visual checks, not qualification evidence.

The corrected dispatcher reads uniform group keys from the compiled graphs,
falling back to packed records only for materials without graphs. The corrected
run completed in 41.74 s, with zero WGSL messages/nonfinite accumulation values,
and a visibly coloured sphere. All pixels have 128 samples; the 197-pixel central
disk has mean linear RGB `(0.744993, 0.256407, 0.147538)`. This is a nonblack,
finite-response check, not an independent physical oracle or RenderMan comparison.
Artifact: `renders/local-test_lama_sss_furnace-pathtracing-depth12-equivalent-controls-domain-fixed.png`
and matching HDR JSON. CPU tests compare identical trajectories and random draw
counts with and without embedded geometry, with filtering before free-flight.

Focused CPU tests cover gamma mean/Laplace transform, pure-absorption Davis
transmission, analytic inversion round trip, opposed-normal topology response,
continuation, graph-backed groups, mode selection, and packed record/JSON
preservation. The path-tracer/compiler gate passes 519 tests across
35 files, excluding the existing analytic-lights traversal-string assertion.
Production build and typecheck pass. The independent Davis/two-flux validation
below qualifies that engine equivalent; prior analog measurements below qualify
Chiang/exponential only.

## Independent Davis / Two-Flux Qualification

`scripts/validate-sss-equivalent-physics.mjs` independently computes an analog
walk on a sphere of radius 0.8. It uses a regularized-gamma inverse CDF for the
per-entry Davis density (not the production rejection sampler), derives the
two-flux albedo and extinction directly from their equations, then simulates
exponential collisions, HG scattering, absorption and IOR-based TIR. The GPU
fixture is `sss-fidelity-davis.mtlx` (IOR 1.3, g 0.15, bleed 0.5).

Intel gen-12lp, 64x64, 512 spp; the reference uses 40,000 analog photons/channel.
The acceptance band is 0.015 radiance plus five combined standard errors:

| Channel | Analog Reference | GPU Mean | Difference | Tolerance |
| --- | ---: | ---: | ---: | ---: |
| Red | 0.75125 | 0.74887 | -0.00238 | 0.03589 |
| Green | 0.25420 | 0.25356 | -0.00064 | 0.02942 |
| Blue | 0.14718 | 0.14743 | +0.00026 | 0.02657 |

All three channels pass. WGSL diagnostics and nonfinite accumulation are zero;
the 512-spp timestamp query exceeded the driver budget, so render time is not
reported. Report: `renders/local-lama-sss-equivalent-physical-validation.json`;
render: `renders/local-test_lama_sss_furnace-pathtracing-depth12-davis-two-flux.png`.
This qualifies the engine's declared Davis/two-flux equivalents on the sphere,
not Pixar formulas or RenderMan output.

Burley mode 3 with inversion 0, IOR 1.5 and g 0.3 compiled and rendered on Intel
gen-12lp at 64x64/128 spp (13.02 s, zero WGSL messages/nonfinite values). An
independent sphere oracle integrates the normalized radial profile over the sphere
and cosine-averages the exit Fresnel transmission; it does not call production
BSSRDF sampling or evaluation. On the 197-pixel central disk, measured/oracle
linear RGB are `(0.284816, 0.111132, 0.071066)` /
`(0.276066, 0.108469, 0.069730)`. All channels pass `0.006 + 5σ` residual
tolerance. This qualifies the spherical mode-3 response for this configuration,
not arbitrary geometry or RenderMan equivalence. Report:
`renders/local-lama-sss-burley-ior-validation.json`;
render: `renders/local-test_lama_sss_furnace-pathtracing-depth12-burley-ior-anisotropy.png`.

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

## Independent Physical Validation (2026-11-10)

`scripts/validate-sss-physics.mjs` compares HDR furnace renders to a scalar analog
walk on an analytic sphere of radius 0.8. The reference uses 40,000 photons per
colour channel, independent free-flight, phase inversion, sphere intersection,
analog absorption and total internal reflection; it imports only the PCG RNG,
not the production transport or phase functions.

The furnace scene has one sphere, no floor, a disabled local light and unit white
environment radiance. Background HDR corners are checked within 1e-5, every pixel
must have the requested spp, and missing/failed controls cause a nonzero exit.
Measurements use a central disk (radius one eighth of the image width), before
tonemapping, with firefly clamping disabled. Coloured cases use 128x128 at 1024
spp; the expensive high-albedo case uses 64x64 at 512 spp. Dispatches contain one
sample to avoid the Intel watchdog. HDR export continues when timestamp timing
exceeds its query budget; `timestampStatus` then reports `budget-exceeded`.

The controls exposed and led to three corrections:

- HG evaluation now uses the same outgoing-direction convention as its sampler;
  its integral is one and its signed first moment is -g. The slab oracle passes
  the negated travel direction to this sampler. CPU/WGSL clamp g identically.
- SSS roulette is evaluated every 32 internal events after its minimum depth,
  still with reciprocal-probability compensation. Ordinary roulette is unchanged.
- A persistent uniformly selected RGB channel drives each SSS path. Throughput
  carries the 1/p=3 selection compensation, and the medium coefficients use the
  selected channel. This avoids products of high-variance RGB tracking weights.

Final linear RGB measurements and independent predictions:

| Case | GPU Mean RGB | Analog Reference RGB | Result |
| --- | --- | --- | --- |
| Isotropic, IOR 1 | (0.73852, 0.27841, 0.17768) | (0.73900, 0.28205, 0.18445) | pass |
| Original g=0.15, IOR 1.3 | (0.60796, 0.15446, 0.08928) | (0.60945, 0.15673, 0.09345) | pass |
| White input, g=0, IOR 1 | (0.93868, 0.93916, 0.92780) | (0.94310, 0.93580, 0.92900) | pass |

Per-channel acceptance is 0.01 absolute radiance plus five combined estimated
standard errors. The analytic surface and triangle surface are not identical,
and numerical ray offsets remain. This is a finite-sample transport check, not
an exact identity or proof of RenderMan fidelity. The Chiang polynomial maps
white input to single-scatter albedo slightly below one, so this white control
is weakly absorbing; an exactly nonabsorbing medium is covered by CPU energy tests.

Under controlled lighting, the original IOR/anisotropy settings physically lower
the reflected energy, particularly in green and blue. Thus the darker, more
saturated second sphere is consistent with the implemented exponential model
after the depth-truncation and variance issues were corrected. The reference
checks the configured coefficients, not the exact artistic fit of the inversion.

Run the local matrix with `MX_ENTRIES=/scenes/pathtracer/lama/test_lama_sss_furnace.usda`,
`MX_MAX_DEPTH=12`, `MX_TILE_SPP=1`, and a case tag `MX_OUTPUT_TAG=fidelity-<case>`.
Set `MX_HARNESS_QUERY` to `openpbr=/scenes/pathtracer/lama/sss-fidelity-<case>.mtlx&skyPower=1&skyColor=1,1,1&firefly=0`.
Cases are `calibration`, `original` and `white`; after their renders, run
`node scripts/validate-sss-physics.mjs`. The complete report is
`renders/local-lama-sss-physical-validation.json`; PNG/HDR pairs use the stem
`renders/local-test_lama_sss_furnace-pathtracing-depth12-fidelity-<case>`.

All final controls reported zero WGSL errors/nonfinite accumulation values.
The path-tracer/compiler suite passed 495 tests in 35 files, excluding the same
pre-existing analytic-lights traversal-string assertion. Validation was local only.

## LamaLayer gold / dielectric IOR

The `lama_layer_gold_ior.usda` scene uses the existing RenderMan teapot mesh
and `lama_layer_gold.mtlx` document. The conductor forms the rough gold base;
a dielectric LamaLayer sits above it with roughness 0.08 and an initial IOR of
1.0, editable in the viewer over the range 1.0-3.0.

The key is a vertical 0.18 x 0.35 m rectangular softbox in front of the teapot,
with a weaker fill and an explicit studio HDR dome at intensity 0.06 to preserve
reflection contrast instead of using the viewer's default preview illumination.
The camera has a 12.5-degree field of view for a close-up of the teapot.
The isotropic gold conductor uses scientific Fresnel (complex IOR), neutral tint,
and roughness 0.22; the dielectric top roughness stays at 0.08.
This is a local lighting/material reconstruction, not a pixel-matched RenderMan reference.

In the viewer, select **Teapot**, then **Parametres du materiau** to edit only
the dielectric IOR. Its 1.0-3.0 range is defined by `uimin`/`uimax`. Edits update
the material uniform without recompiling the shader and restart path accumulation;
reset restores the selected scene's initial IOR. Ground and stand controls are hidden.
The engine extension namespace is `urn:materialx-webgpu-engine:extensions` with
the `engine` prefix. Its input attribute `engine:editable="true"` opts an input
into the editor; once any `engine:editable` attribute is authored in a material's
reachable graph, all unmarked inputs are hidden. `false` alone hides all controls
for that material. Without this metadata, the usual editor behavior (explicit
unbound surface inputs only) is unchanged. Connections and interface bindings
cannot be made editable by this attribute. The legacy `engine_editable` spelling
is still accepted when loading existing documents.

`LamaLayer` accepts `engine:layerMode` with `fresnel_blend`, `smooth_coating`,
`rough_coating`, or `auto`, plus non-negative `engine:topThickness` in scene units.
Fresnel Blend is the default and matches MaterialX's standard layer behavior.
Smooth and rough coating refract base-layer directions; rough coating also clamps
base roughness and adjusts dielectric IOR relative to the top layer. Positive top
thickness applies Beer-Lambert absorption from the top `LamaDielectric`. These are
engine extensions, and the coating models are renderer approximations rather than
a byte-for-byte RenderMan implementation.

Open a scene with
`usd-image-harness.html?entry=/scenes/pathtracer/lama/lama_layer_gold_ior.usda&backend=pathtracing&res=512&spp=64`.