# MaterialX node coverage (T002)

Authoritative list of MaterialX node categories the engine must support to render
the example corpus. Every entry is resolved against the MaterialX standard
libraries (56 `.mtlx`, 818 NodeDefs indexed) plus corpus-local NodeDefs using the
Core WASM; there are **0 unresolved categories**.

- Generator: [tools/t002-inventory.mjs](../tools/t002-inventory.mjs).
- Machine-readable report: [docs/generated/t002-inventory.json](generated/t002-inventory.json).
- Corpus overview: [scene-inventory.md](scene-inventory.md).
- Drives **T014** (per-node WGSL lowering) and **T034** (per-node JS + WebGPU
  parity tests), satisfies **REQ-014**.

## 1. Headline numbers

| Metric | Value |
| --- | --- |
| Directly authored categories (top level) | 40 |
| Categories after transitive closure | 75 |
| Source-code leaves (require hand-written WGSL) | 57 |
| Nodegraph nodes (expand into other categories) | 18 |
| Unresolved categories | 0 |

**Implementation kinds.** A category is either:

- **nodegraph** — its NodeDef is implemented by a MaterialX nodegraph (or an
  `<implementation ... nodegraph="...">` redirect). The engine implements it by
  flattening the graph; no bespoke WGSL math is written for the node itself.
- **sourcecode** — its NodeDef is implemented by native/source code
  (`file`/`function`/`sourcecode`). These are the real leaves: each needs a
  hand-authored WGSL implementation and a per-node parity test.

The 57 source-code leaves are therefore the concrete T014/T034 work list.

## 2. Directly authored categories (40)

`count` = node instances across the corpus, `files` = distinct documents.

| Category | Type(s) | Count | Files | Group | Impl | Source |
| --- | --- | --- | --- | --- | --- | --- |
| add | color3/float | 4 | 2 | math | sourcecode | stdlib |
| chiang_hair_absorption_from_color | vector3 | 1 | 1 | pbr | sourcecode | stdlib |
| chiang_hair_bsdf | BSDF | 1 | 1 | pbr | sourcecode | stdlib |
| chiang_hair_roughness | multioutput | 1 | 1 | pbr | sourcecode | stdlib |
| clamp | color3 | 1 | 1 | math | sourcecode | stdlib |
| combine3 | color3 | 1 | 1 | channel | sourcecode | stdlib |
| constant | color3 | 1 | 1 | procedural | sourcecode | stdlib |
| convert | vector2 | 2 | 2 | channel | nodegraph | stdlib |
| deon_hair_absorption_from_melanin | vector3 | 1 | 1 | pbr | sourcecode | stdlib |
| disney_principled | surfaceshader | 5 | 5 | pbr | nodegraph | stdlib |
| divide | float | 1 | 1 | math | sourcecode | stdlib |
| dotproduct | float | 1 | 1 | math | sourcecode | stdlib |
| extract | float | 1 | 1 | channel | sourcecode | stdlib |
| fractal3d | float | 1 | 1 | procedural3d | sourcecode | stdlib |
| gltf_colorimage | multioutput | 1 | 1 | texture2d | nodegraph | stdlib |
| gltf_image | color3/vector3 | 2 | 1 | texture2d | nodegraph | stdlib |
| gltf_normalmap | vector3 | 1 | 1 | texture2d | nodegraph | stdlib |
| gltf_pbr | surfaceshader | 6 | 6 | pbr | nodegraph | stdlib |
| hextiledimage | color3 | 2 | 1 | texture2d | sourcecode | stdlib |
| hsvtorgb | color3 | 1 | 1 | adjustment | sourcecode | stdlib |
| image | color3/float/vector3 | 59 | 2 | texture2d | sourcecode | stdlib |
| max | float | 1 | 1 | math | sourcecode | stdlib |
| mix | color3/vector3 | 4 | 3 | compositing | sourcecode | stdlib |
| multiply | color3/float/vector3 | 12 | 2 | math | sourcecode | stdlib |
| normalmap | vector3 | 16 | 2 | math | sourcecode | stdlib |
| open_pbr_surface | surfaceshader | 10 | 10 | pbr | nodegraph | stdlib |
| place2d | vector2 | 1 | 1 | math | nodegraph | stdlib |
| position | vector3 | 1 | 1 | geometric | sourcecode | stdlib |
| power | float | 1 | 1 | math | sourcecode | stdlib |
| rgbtohsv | color3 | 1 | 1 | adjustment | sourcecode | stdlib |
| separate3 | multioutput | 1 | 1 | channel | nodegraph | stdlib |
| simple_hair | surfaceshader | 1 | 1 | pbr | nodegraph | **corpus** |
| sin | float | 1 | 1 | math | sourcecode | stdlib |
| standard_surface | surfaceshader | 34 | 20 | pbr | nodegraph | stdlib |
| subtract | float | 1 | 1 | math | sourcecode | stdlib |
| surface | surfaceshader | 1 | 1 | pbr | sourcecode | stdlib |
| surfacematerial | material | 62 | 48 | material | sourcecode | stdlib |
| texcoord | vector2 | 1 | 1 | geometric | sourcecode | stdlib |
| tiledimage | color3/float/vector3 | 12 | 4 | texture2d | nodegraph | stdlib |
| UsdPreviewSurface | surfaceshader | 6 | 6 | pbr | nodegraph | stdlib |

**Corpus-local node.** `simple_hair` is not in the standard library. It is
defined inside `SimpleHair/simple_hair_default.mtlx` as
`ND_simple_hair_shader` (`nodegroup="pbr"`) with inline nodegraph
`NG_simple_hair_shader`. The loader must register document-local NodeDefs before
resolving node references.

## 3. Nodes added by transitive closure (35)

These categories are not authored directly in any example but become required
once the nodegraph-backed root shaders (`standard_surface`, `open_pbr_surface`,
`disney_principled`, `gltf_pbr`, `UsdPreviewSurface`, `simple_hair`,
`tiledimage`, ...) are flattened.

| Category | Impl |
| --- | --- |
| absval | sourcecode |
| anisotropic_vdf | sourcecode |
| artistic_ior | sourcecode |
| burley_diffuse_bsdf | sourcecode |
| combine2 | sourcecode |
| conductor_bsdf | sourcecode |
| dielectric_bsdf | sourcecode |
| dot | sourcecode |
| generalized_schlick_bsdf | sourcecode |
| generalized_schlick_edf | sourcecode |
| ifequal | sourcecode |
| ifgreater | sourcecode |
| ifgreatereq | sourcecode |
| invert | sourcecode |
| layer | sourcecode |
| ln | sourcecode |
| luminance | sourcecode |
| maxcomponent | nodegraph |
| min | sourcecode |
| mincomponent | nodegraph |
| normalize | sourcecode |
| open_pbr_anisotropy | nodegraph |
| oren_nayar_diffuse_bsdf | sourcecode |
| rotate2d | sourcecode |
| rotate3d | sourcecode |
| roughness_anisotropy | sourcecode |
| roughness_dual | sourcecode |
| separate4 | nodegraph |
| sheen_bsdf | sourcecode |
| sign | sourcecode |
| sqrt | sourcecode |
| subsurface_bsdf | sourcecode |
| switch | nodegraph |
| translucent_bsdf | sourcecode |
| uniform_edf | sourcecode |

The BSDF/EDF/VDF leaves (`dielectric_bsdf`, `conductor_bsdf`,
`generalized_schlick_bsdf`, `sheen_bsdf`, `subsurface_bsdf`,
`oren_nayar_diffuse_bsdf`, `burley_diffuse_bsdf`, `translucent_bsdf`,
`anisotropic_vdf`, `uniform_edf`, `generalized_schlick_edf`) plus `layer` are the
physically-based building blocks the PBR root shaders compose, so they are the
highest-value WGSL targets.

> **P8 status — closures now physically evaluated.** These BSDF/EDF/VDF leaves
> and the surface composition (`layer`, closure `mix`/`add`/`multiply`) were
> initially lowered as non-physical stubs `Closure(color·weight, weight)` (T014).
> The P8 fix (plan §9.5) replaces them with real evaluations — rough diffuse
> (T039), GGX/Smith/Fresnel microfacet and transport lobes (T040), energetic
> composition (T041), composed OpenPBR surfaces (T043) and the executable raster
> surface (T045) — plus consistent `eval`/`pdf`/`sample` triples for the path
> tracer (T044). Each is validated against an **independent** fp64 analytic
> oracle, [src/render/bsdf/reference.ts](../src/render/bsdf/reference.ts), that is
> not derived from the WGSL, ending the earlier circular validation. Formulas,
> limits and per-target GPU tolerances: [docs/validation.md](validation.md);
> raster/path-tracing support matrix: [docs/conformance.md](conformance.md).

## 4. The 57 WGSL leaves (T014 work list)

Complete source-code leaf set, sorted; each needs a WGSL implementation (T014)
and a JS-vs-WebGPU parity test (T034):

```
absval, add, anisotropic_vdf, artistic_ior, burley_diffuse_bsdf,
chiang_hair_absorption_from_color, chiang_hair_bsdf, chiang_hair_roughness,
clamp, combine2, combine3, conductor_bsdf, constant,
deon_hair_absorption_from_melanin, dielectric_bsdf, divide, dot, dotproduct,
extract, fractal3d, generalized_schlick_bsdf, generalized_schlick_edf,
hextiledimage, hsvtorgb, ifequal, ifgreater, ifgreatereq, image, invert, layer,
ln, luminance, max, min, mix, multiply, normalize, normalmap,
oren_nayar_diffuse_bsdf, position, power, rgbtohsv, rotate2d, rotate3d,
roughness_anisotropy, roughness_dual, sheen_bsdf, sign, sin, sqrt,
subsurface_bsdf, subtract, surface, surfacematerial, texcoord,
translucent_bsdf, uniform_edf
```

## 5. By node group (directly authored)

| Group | Categories |
| --- | --- |
| adjustment | hsvtorgb, rgbtohsv |
| channel | combine3, convert, extract, separate3 |
| compositing | mix |
| geometric | position, texcoord |
| material | surfacematerial |
| math | add, clamp, divide, dotproduct, max, multiply, normalmap, place2d, power, sin, subtract |
| pbr | chiang_hair_absorption_from_color, chiang_hair_bsdf, chiang_hair_roughness, deon_hair_absorption_from_melanin, disney_principled, gltf_pbr, open_pbr_surface, simple_hair, standard_surface, surface, UsdPreviewSurface |
| procedural | constant |
| procedural3d | fractal3d |
| texture2d | gltf_colorimage, gltf_image, gltf_normalmap, hextiledimage, image, tiledimage |

## 6. Methodology

1. Load all 56 standard-library `.mtlx` into one document via `importLibrary`
   (56/56 loaded) and index every NodeDef by `node` string / type / nodegroup
   (818 NodeDefs).
2. A raw XML scan classifies each NodeDef as `nodegraph` (has
   `<nodegraph nodedef="...">` or `<implementation ... nodegraph="...">`) or
   `sourcecode`, and records each NodeDef's implementing nodegraph name.
3. Parse each of the 50 examples **without** `importLibrary` so only the
   document's own nodes are counted (avoids injecting library implementation-graph
   nodes). Register document-local NodeDefs and nodegraphs first.
4. Resolve every authored node category against the library + corpus index.
5. Compute the transitive closure: starting from the 40 authored categories,
   recursively expand each nodegraph category through its implementing graph's
   child categories until only source-code leaves remain.
