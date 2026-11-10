# Lama Test Scenes

Small path-tracer scenes derived from `test_thinwalled_transmission.usda`.
They reuse its floor and sphere OBJ assets, compensate their local origins,
and frame the four materials with an oriented USD camera.

- `test_lama_sss.usda`: diffuse control, short/long mean-free-path SSS, and an
  SSS base under a dielectric Lama layer.
- `test_lama_closures.usda`: exact conductor Fresnel, generalized Schlick,
  dielectric-over-diffuse layer, and a diffuse/sheen mix.

The paired `.mtlx` documents use the Lama node definitions loaded by the engine.
Render with `usd-image-harness.html?entry=/scenes/pathtracer/lama/test_lama_sss.usda&backend=pathtracing&res=256&spp=32`.