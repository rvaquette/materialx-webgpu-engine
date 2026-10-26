# MaterialX JavaScript Core WASM

## Scope

Qualification performed against the local MaterialX JavaScript build at
`D:\WebGL2\MaterialX\MaterialX-rva\javascript\build\installed\JavaScript\MaterialX`.
The installed artifacts include `JsMaterialXCore-1.39.6.js` and
`JsMaterialXCore.wasm`. A Node.js smoke test instantiated the Core module and
confirmed the APIs listed below. The Core module exports no shader generator,
generation context, or standard-library generator loader.

Use `JsMaterialXCore.js` only. Do not import `JsMaterialXGenShader.js` or call
any MaterialX shader generator. This keeps XML and graph inspection separate
from the TypeScript IR and WGSL backend.

## Confirmed APIs

| Operation | Core API | Notes |
| --- | --- | --- |
| Instantiate module | `MaterialX()` | Asynchronous Emscripten module factory. In this local CommonJS build, use the module's `default` export. |
| Create document | `mx.createDocument()` | Creates a Core `Document`. |
| Read XML | `mx.readFromXmlFile(doc, file, searchPath, options)` and `mx.readFromXmlString(doc, xml, searchPath, options)` | Asynchronous. Search paths are semicolon-separated. Includes are read by default and can be disabled with `XmlReadOptions.readXIncludes = false`. |
| Load library documents | Read library XML into documents, then call `doc.importLibrary(libraryDoc)` | The Core build does not expose `loadStandardLibraries`; the application must resolve and load the required local `.mtlx` library files. |
| Validate document | `doc.validate()` | Returns a boolean and detects invalid documents, including graph cycles. Treat failure as an import/compile error; the application owns actionable diagnostics and source context. |
| Find definitions | `doc.getNodeDef(name)` / `doc.getMatchingNodeDefs(category)`; `node.getNodeDef(target)` | `NodeDef` exposes type, node string/group, version compatibility, and implementation lookup. TypeScript must select and record the applicable definition when several match. |
| Find implementations | `doc.getImplementation(name)` / `doc.getMatchingImplementations(target)`; `node.getImplementation(target)` | Implementations expose file/function references and NodeDef association. A `NodeGraph` can itself provide its associated NodeDef and implementation. |
| Traverse document | `doc.traverseTree()` | Iterable tree traversal for collecting nodes, definitions, inputs, and provenance. |
| Traverse graph | `output.traverseGraph()`; `graph.topologicalSort()`; `graph.flattenSubgraphs()` | Core supplies traversal/graph utilities. TypeScript remains responsible for IR construction, lowering policy, and WGSL emission. |
| Resolve included files | XML reader search path and `mx.getEnviron` / `mx.setEnviron` / `mx.removeEnviron` | `readXIncludesFunction` from the C++ options is not exposed in JavaScript. Use the common application asset resolver for controlled path policy and diagnostics. |
| Release wrappers | `object.delete()` | Embind-backed objects and iterator results must be released deterministically. |

## Recommended Core-only flow

1. Instantiate `JsMaterialXCore.js` and create a document.
2. Read the document and its XIncludes with an explicit search path.
3. Read required local library documents and import them into the document.
4. Call `doc.validate()` and retain the originating document/element paths for diagnostics.
5. Traverse the document, resolve each node's applicable NodeDef and implementation, and record typed inputs, defaults, connections, and provenance in TypeScript-owned data structures.
6. Build the TypeScript IR and generate WGSL outside the WASM module.
7. Release Embind objects after extracting the required data.

## Qualification limits

- The smoke test confirms module instantiation and representative API presence;
  it does not yet qualify every MaterialX API or every corpus document.
- `Document.validate()` is structural validation, not proof that every node has
  a supported TypeScript lowering or correct WebGPU behavior.
- NodeDef/implementation matching and version/target selection policy must be
  explicit in TypeScript; do not assume a unique match.
- Library file inventory, include resolution, and full node coverage are tracked
  by the separate corpus inventory and conformance tasks.
- The Core module does not generate WGSL or GLSL. Do not use the GenShader WASM
  as a compilation fallback.

## Local evidence

Paths below are relative to `D:\WebGL2\MaterialX\MaterialX-rva`.

- `javascript/README.md`: Core versus GenShader module responsibilities, module
  loading, XML IO, include behavior, search paths, and Embind lifetime.
- `source/JsMaterialX/JsMaterialXCore/JsDocument.cpp`: document, NodeDef,
  implementation, and library bindings.
- `source/JsMaterialX/JsMaterialXCore/JsElement.cpp`: inherited `validate()`
  binding and its optional diagnostic-message overload.
- `source/JsMaterialX/JsMaterialXCore/JsNode.cpp` and `JsDefinition.cpp`:
  node-to-definition/implementation and definition/implementation bindings.
- `source/JsMaterialX/JsMaterialXCore/JsTraversal.cpp`: tree, graph, and
  inheritance iterators.
- `source/JsMaterialX/JsMaterialXFormat/JsXmlIo.cpp`: XML read options and IO
  bindings.
- `javascript/MaterialXTest/{document,traversal,xmlIo}.spec.js`: exercised
  validation, graph access/traversal, definition lookup behavior, XML includes,
  search paths, and library imports.

---

# Asset and geometry dependencies (T004)

Qualification of BVH, subdivision, TIFF, EXR, and volume dependencies against the
concrete needs of the target scene
(`D:\WebGL2\MaterialX\OpenPBRShaderPlayground\ShdrPlygrnd`) and the plan's reuse
policy (section 6). See [scene-inventory.md](scene-inventory.md) and
[usd-import.md](usd-import.md) for the measured asset facts cited below.

Status: these are external JS/WASM libraries and are **not yet installed** in this
workspace (no `package.json`). This section qualifies capability and fit against
measured requirements and records the runtime smoke-tests still owed once the
dependency is added and version-locked.

## Measured requirements (from the scene)

| Area | Evidence | Requirement |
| --- | --- | --- |
| Subdivision | `subdivisionScheme = "catmullClark"`, `refinementLevel`, `refinementEnableOverride` in `material_assignment.usda` | Catmull-Clark subdivision (OpenSubdiv-compatible), not triangulation; preserve face-varying `st`, creases, holes. |
| TIFF | 137 `.tif`, little-endian (`II*\0`), UDIM naming (`*.1001.tif`), colorspaces `srgb_tx`/`Raw` set by MaterialX inputs | Decode with full bit depth and channels; UDIM tile expansion; no silent 8-bit downconvert; colorspace comes from MaterialX, not the file. |
| EXR | 6 `.exr` HDRIs (studio/env maps) consumed by the binary `lightRig.usd` | Decode half/float HDR without clamping, for dome/IBL. |
| Volumes | 0 `.vdb`; the only `volume` token is `token outputs:mtlx:volume` (a material terminal) | No explicit OpenVDB field in this corpus → volume loader is **out of scope** here (conditional). |
| BVH | Path-tracer backend over the 57.5 MB `ShdrPlygrnd_Geo.usd` crate | CPU BVH build + refit + GPU-serializable layout; WGSL traversal is engine-owned. |

## BVH

- **Candidate:** `three-mesh-bvh` (`MeshBVH`) — mature CPU SAH BVH with build,
  `refit`, raycast, and serialize/deserialize; worker-friendly.
- **Fit:** reuse for CPU construction, refit (instancing), and serialization;
  flatten the node layout into engine-owned GPU buffers and implement WGSL
  traversal. Do **not** depend on its WebGPU/TSL path — plan section 6 flags that
  API as unstable; it is not assumed to bind to proprietary WGSL pipelines.
- **To qualify at runtime:** serialized node layout (bounds/offset/count packing)
  stability across the locked version, build time + memory on the full geometry
  crate (REQ-012), refit correctness for instanced prototypes.
- **Version policy:** lock the exact version; treat the serialized BVH format as a
  pinned contract.

## Subdivision

- **Candidate:** an OpenSubdiv-compatible path — `opensubdiv` compiled to WASM, or
  a vetted JS Catmull-Clark implementation that matches OpenSubdiv topology rules.
- **Fit:** the scene authors `catmullClark` with `refinementLevel` (1 observed);
  subdivide on CPU/worker **before** BVH build and rasterization. Per plan
  section 8, do not substitute a plain triangulation for Catmull-Clark.
- **To qualify at runtime:** face-varying UV (`st`) interpolation, boundary and
  crease rules, holes/subsets, parity with OpenSubdiv at the scene's refinement
  level, and cost at the 57.5 MB geometry scale.
- **Version policy:** lock the implementation and record its OpenSubdiv rule
  compatibility; displacement is prepared before raster and BVH.

## TIFF

- **Candidate:** `UTIF.js` (pure JS, broad TIFF incl. 8/16-bit, LZW/deflate);
  fallback `geotiff.js` for 16/32-bit float, tiled, or BigTIFF cases.
- **Fit:** decode the 137 `.tif` preserving bit depth and channel count. UDIM
  (`<UDIM>` → tiles `1001+`) is expanded by the asset layer, not the decoder.
  Colorspace (`srgb_tx` vs `Raw`) is taken from the MaterialX `image` input, not
  guessed from the file (REQ-013).
- **To qualify at runtime:** actual bits-per-sample / sample-format / compression
  present in the scene TIFFs, 16-bit round-trip without 8-bit truncation, and
  per-channel decode for data maps (roughness/normal).
- **Version policy:** lock the decoder; record which compressions it supports and
  escalate to `geotiff.js` only if a gap is found.

## EXR / HDR

- **Candidate:** three.js `EXRLoader` (OpenEXR subset: half/float, ZIP/PIZ) for
  `.exr`; `RGBELoader` for `.hdr` if encountered.
- **Fit:** decode the 6 HDRI environment maps to a linear half/float typed array
  + dimensions for dome/IBL; reuse the loader **decoupled** from the three.js
  renderer (extract pixels only). No tone-map or clamp on decode.
- **To qualify at runtime:** the specific EXR compression types in the 6 files,
  channel layout (RGB vs RGBA), and linear-HDR preservation into the GPU texture.
- **Version policy:** lock the three.js version used for the loader subset.

## Volumes (conditional, out of scope for this corpus)

- **Finding:** the scene contains **no OpenVDB field** — 0 `.vdb` assets, and the
  only `volume` token is the MaterialX material output terminal
  `outputs:mtlx:volume`. Transmission in glass/ice/honey/soap/juice materials is
  BSDF surface transmission, not a volumetric field (consistent with plan
  section 3: a transmission parameter does not prove an explicit USD volume).
- **Decision:** do **not** add an OpenVDB dependency now. If a `.vdb`/USD `Volume`
  asset later appears, qualify an OpenVDB/NanoVDB WASM reader plus a sparse GPU
  representation (topology, precision, browser deployment per plan section 6).

## Qualification limits

- Library capabilities here are assessed from documented behavior and the
  measured scene requirements; none has yet been instantiated in this workspace.
  Each "to qualify at runtime" item must be confirmed with a smoke test after the
  dependency is installed and version-locked, mirroring the MaterialX Core WASM
  qualification above.
- Exact TIFF bits-per-sample/compression and EXR compression types are to be read
  from the scene assets during that smoke test; this section records the
  requirement (full precision, no silent downconvert) rather than assuming a
  value.

## USDC crate reader (OpenUSD-wasm) — T048

- **Locked dependency:** `@needle-tools/usd@1.1.2` (devDependency), an Emscripten
  build of **OpenUSD 0.26.5** (`pxr` 2605) bundled with MaterialX 1.39.5. WASM
  payload `node_modules/@needle-tools/usd/src/bindings/emHdBindings.wasm`
  (~34.5 MB) plus the `emHdBindings.js` glue. It is the **sole binary `.usd`
  crate reader**; tinyusdz-wasm was evaluated and **dropped** (could not read the
  reference crate — OOM then indexed-normal / `elementSize 8196` parse failures
  across 0.9.1 and 0.9.10).
- **License:** PolyForm-Noncommercial-1.0.0. This is a **product constraint**: the
  crate reader may not be used in a commercial distribution under this license.
  Flagged for the shipping decision; a commercially-licensed crate reader (or a
  self-built OpenUSD/alternative) would be required before any commercial release.
- **Role:** data extractor only. The reader writes the crate into the module's
  in-memory FS (`FS_createDataFile`), opens the stage (`OpenStage`), exports USDA
  text, then composes that text
  through the existing custom USDA adapter (`src/usd/importer.ts`) into a
  `SceneAsset`. Composition errors (`stage.GetCompositionErrors()`) are forwarded
  as diagnostics. It does **not** drive materials or composition itself.
  The compose reader selects `GetRootLayer().ExportToString()` to preserve
  authored asset paths and leave composition to the adapter. Standalone
  `flattenCrate()` retains stage flattening unless `preserveLayer` is requested.
- **Code:** `src/usd/crate.ts` (`flattenCrate`, `importCrate`, injected
  `OpenUsdModule`), unit-tested with a fake module in `tests/usd/crate.test.ts`.
  The default Node loader is `scripts/openusd-loader.ts` (resolves the package
  main, then imports the internal `bindings/index.js` directly to bypass the
  package `exports` map and the transitive `three` peer). The Node-only loader is
  kept under `scripts/` because `src/` stays browser-typed. The browser loader
  is `src/usd/browser-loader.ts`: it imports local bindings under `openusd/`
  only when a crate is encountered. The static packager includes those bindings,
  the WASM, build information and a license/provenance notice.
- **Qualification evidence (end-to-end):** reads the 57 MB
  `ShdrPlygrnd_Geo.usd` in ~1.5 s with **0 composition errors** (default memory),
  including indexed normals (`elementSize 8196`) and indexed `st`; plus
  `renderCams.usd` (8 cameras) and `lightRig.usd` (6 lights: 4 RectLight,
  1 SphereLight, 1 DomeLight). Reproduce with `node scripts/qualify-crate.ts`.
- **Browser evidence:** the simplified playground was composed and rendered in
  raster on an Intel gen-12lp GPU; full measurements and compatibility warnings
  are recorded in [validation.md](validation.md#chargement-raster-du-playground-simplifie).
  The indexed normals/UV bridge is connected. Mobile import failed before
  rendering, so mobile memory/runtime qualification and GeomSubset/subdivision
  fidelity remain follow-ups (REQ-012).