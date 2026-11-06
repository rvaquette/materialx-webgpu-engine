# MaterialX IR to Multi-Language Shader Generation

## Architecture Overview

The materialx-webgpu-engine uses a **renderer-independent Intermediate Representation (IR)** that can theoretically be converted to multiple shader languages. Here's how it works:

```
MaterialX Graph (.mtlx)
    ↓
Graph Resolution & Compilation (src/materialx/graph.ts)
    ↓
Shader IR (src/compiler/ir.ts)
    ├─ Type System
    ├─ Expression DAG
    ├─ Closure Compositions
    └─ Provenance & Metadata
    ↓
    ┌─────────────────────────────────────────────┐
    │          Backend Code Generators            │
    ├─────────────────────────────────────────────┤
    │ WGSL    (src/compiler/wgsl.ts)      ✅ DONE │
    │ GLSL    (planned - genglsl.mtlx)    🔲 TODO │
    │ HLSL    (planned - genhlsl.mtlx)    🔲 TODO │
    │ OSL     (planned - genosl.mtlx)     🔲 TODO │
    │ Metal   (planned - genmsl.mtlx)     🔲 TODO │
    │ SPIR-V  (planned - via glslang)     🔲 TODO │
    └─────────────────────────────────────────────┘
    ↓
Output Shader Code
```

## IR Structure (Renderer-Independent)

The `ShaderIr` (src/compiler/ir.ts) represents a complete shader graph independently from any specific shading language:

### Type System
```typescript
export type IrType =
  | { kind: 'scalar'; scalar: Scalar }           // float, int, bool
  | { kind: 'vector'; scalar: Scalar; size: 2|3|4 }
  | { kind: 'matrix'; size: 3|4 }
  | { kind: 'string' }
  | { kind: 'filename' }
  | { kind: 'closure'; closure: ClosureKind }    // BSDF, EDF, VDF, BSSRDF
  | { kind: 'shader'; shader: ShaderKind };      // surface, displacement, volume
```

### Expression Representation
```typescript
export interface IrExpr {
  id: IrRef;                    // Unique identifier for CSE (Common Subexpression Elimination)
  kind: string;                 // Operation type (e.g., "multiply", "sample_texture")
  type: IrType;                 // Result type
  inputs?: IrRef[];             // References to input expressions
  value?: IrConstValue;         // Constant value if applicable
  provenance?: Provenance;      // Source location in MaterialX graph
}
```

### Expression DAG (Directed Acyclic Graph)
- **Key Property:** Each unique computation appears once
- **CSE Applied:** Common subexpression elimination already done
- **Language-Independent:** No WGSL/GLSL specific operations

### Closure Compositions
```typescript
export interface ClosureComposition {
  kind: 'bsdf' | 'edf' | 'vdf' | 'bssrdf';
  closures: Closure[];           // Multiple layer compositions
  weight?: IrRef;                // Optional layer weight
}
```

## WGSL Backend (Current Implementation)

The WGSL backend (src/compiler/wgsl.ts) shows how to convert IR to a specific language:

### Architecture
```typescript
export function emitWgslModule(ir: ShaderIr): WgslModule {
  // 1. Declare uniform block (editable parameters)
  // 2. Declare texture & sampler bindings
  // 3. Declare varyings struct
  // 4. Emit mx_shade() function with:
  //    - Variable declarations for each expression
  //    - Evaluation of every reachable expression (CSE already applied)
  //    - Return statement with shader outputs
}
```

### Key Components
1. **Uniforms:** Editable parameters (colors, scales, etc.)
2. **Bindings:** Textures and samplers with group/binding indices
3. **Varyings:** Interpolated values from vertex shader
4. **Closure Library:** BSDF/EDF implementations (in WGSL)
5. **Intrinsics:** Math/utility functions per backend

## How IR Enables Multi-Backend Support

### 1. **Type Translation Layer**
Each backend translates `IrType` to its native types:

```
IR Type              WGSL            GLSL            HLSL          OSL
─────────            ────            ────            ────          ───
scalar(float)        f32             float           float         float
scalar(int)          i32             int             int           int
vector(3, float)     vec3f           vec3            float3        vector
matrix(4)            mat4x4f         mat4            float4x4      matrix
closure(bsdf)        MxBsdf          MxBsdf_[lang]   MxBsdf        closure
```

### 2. **Operation Mapping**
Each backend maps IR operations to native instructions:

```
IR Operation         WGSL Emit               GLSL Emit          HLSL Emit
────────────         ─────────               ─────────          ─────────
"multiply"           a * b                   a * b              a * b
"dot"                dot(a, b)               dot(a, b)          dot(a, b)
"normalize"          normalize(v)            normalize(v)        normalize(v)
"sample_texture"     textureSample(...)      texture(...)       tex.Sample(...)
"mx_fresnel_*"       Call mx_fresnel_*       Call mx_fresnel_*  Inline math
```

### 3. **Closure Implementation**
Closures are language-specific but share structure:

```wgsl
// WGSL
struct MxBsdf {
  radiance: vec3f,
  transparency: vec3f,
  bxdf: MxBxdf,
}

fn mx_eval_bsdf(bsdf: MxBsdf, vIn: vec3f, vOut: vec3f) -> vec3f {
  // Language-specific implementation
}
```

```glsl
// GLSL equivalent
struct MxBsdf {
  vec3 radiance;
  vec3 transparency;
  MxBxdf bxdf;
};

vec3 mx_eval_bsdf(MxBsdf bsdf, vec3 vIn, vec3 vOut) {
  // Language-specific implementation
}
```

### 4. **Shader Structure Adaptation**
Different languages have different compilation targets:

**WGSL:**
```wgsl
@group(0) @binding(0) var<uniform> params: MxParams;
@group(1) @binding(0) var textures: texture_2d<f32>;
@group(2) @binding(0) var samplers: sampler;

fn mx_shade(vary: MxVaryings) -> vec4f { ... }
```

**GLSL:**
```glsl
uniform MxParams params;
uniform sampler2D textures[MAX_TEXTURES];

vec4 mx_shade(MxVaryings vary) { ... }
```

**HLSL:**
```hlsl
cbuffer MxParams : register(b0) { ... };
Texture2D textures[MAX_TEXTURES] : register(t0);
SamplerState samplers[MAX_SAMPLERS] : register(s0);

float4 mx_shade(MxVaryings vary) { ... }
```

## Actual MaterialX Approach: Target Definitions

The official MaterialX project uses **target definitions** (genglsl.mtlx, genmsl.mtlx, etc.):

These XML files specify how node implementations should be lowered for each language.

### Target Files Location
```
D:\WebGL2\MaterialX\MaterialX-rva\libraries\targets\
├── essl.mtlx          (OpenGL ES)
├── genglsl.mtlx       (OpenGL GLSL)
├── genmdl.mtlx        (NVIDIA MDL)
├── genmsl.mtlx        (Metal Shading Language)
├── genosl.mtlx        (Open Shading Language)
├── genoslnetwork.mtlx (OSL Network)
└── genslangl.mtlx     (SLANG - cross-platform)
```

### Example: How genglsl.mtlx Works

```xml
<!-- genglsl.mtlx: GLSL code generation rules -->
<materialx>
  <!-- For GLSL backend, this is how each node is implemented -->
  
  <!-- Example: multiply operation -->
  <nodeimpl name="multiply_fN_fN_glsl" nodedef="ND_multiply_fN_fN">
    <input name="in1" type="float" />
    <input name="in2" type="float" />
    <output name="out" type="float" />
    <!-- GLSL code template: -->
    <implementation>
      $out = $in1 * $in2;
    </implementation>
  </nodeimpl>
  
  <!-- Example: sample_texture operation -->
  <nodeimpl name="textureSample_glsl">
    <input name="texture" type="filename" />
    <input name="texcoord" type="vector2" />
    <output name="out" type="color3" />
    <implementation>
      $out = texture(uTextures[$texture], $texcoord).rgb;
    </implementation>
  </nodeimpl>
</materialx>
```

## Backend Implementation Phases

### Phase 1: WGSL (✅ DONE)
- Full path tracer support
- Forward raster support
- Closure library complete
- Graphics / compute shaders

### Phase 2: GLSL Backend (🔲 Planned)
```typescript
export function emitGlslModule(ir: ShaderIr): GlslModule {
  // 1. Map IrType → GLSL types (float, vec3, etc.)
  // 2. Emit uniform blocks → uniform declarations
  // 3. Emit texture/sampler bindings → uniform samplers
  // 4. Emit main function with shader logic
  // 5. Include GLSL closure library
  // 6. Generate #version directive
}
```

**Advantages:** Desktop compatibility, older hardware support
**Challenges:** No compute shaders, different closure implementations

### Phase 3: HLSL Backend (🔲 Planned)
```typescript
export function emitHlslModule(ir: ShaderIr): HlslModule {
  // 1. Map IrType → HLSL types (float, float3, etc.)
  // 2. Emit cbuffer blocks
  // 3. Emit texture & sampler resource bindings
  // 4. Emit pixel/vertex shader entry points
  // 5. Include HLSL closure library
}
```

**Advantages:** DirectX ecosystem, Windows/Xbox
**Challenges:** Register binding different, texture syntax varies

### Phase 4: OSL Backend (🔲 Planned)
```typescript
export function emitOslModule(ir: ShaderIr): OslModule {
  // 1. Map IrType → OSL types
  // 2. Emit output closure parameters
  // 3. Emit node structure definitions
  // 4. Include OSL closure library
}
```

**Advantages:** DCC integration (Arnold, RenderMan, etc.)
**Challenges:** Closure system fundamentally different, no textures

### Phase 5: Metal Shading Language (🔲 Planned)
```typescript
export function emitMslModule(ir: ShaderIr): MslModule {
  // 1. Map IrType → MSL types
  // 2. Emit [[buffer(n)]] bindings
  // 3. Emit [[texture(n)]] declarations
  // 4. Emit kernel or vertex/fragment shaders
  // 5. Include MSL closure library
}
```

**Advantages:** Apple platform optimization, iOS/macOS
**Challenges:** Different binding model, no unified shader pipeline

## Code Template Example: Adding a Backend

Here's how you'd add a new backend based on the WGSL pattern:

```typescript
// src/compiler/glsl.ts - GLSL Backend (example)

import type { ShaderIr, IrExpr, IrType } from './ir.ts';
import { getNodeLowering } from './nodes.ts';

export interface GlslModule {
  code: string;
  entryPoint: string;
  uniforms: GlslUniform[];
  textures: GlslBinding[];
  samplers: GlslBinding[];
}

function glslType(type: IrType): string {
  switch (type.kind) {
    case 'scalar':
      return type.scalar === 'float' ? 'float' : 'int';
    case 'vector':
      const prefix = type.scalar === 'float' ? 'vec' : 'ivec';
      return `${prefix}${type.size}`;
    case 'matrix':
      return `mat${type.size}`;
    case 'closure':
      return 'MxBsdf';  // Custom closure type
    // ...
  }
}

export function emitGlslModule(ir: ShaderIr): GlslModule {
  const lines: string[] = [];
  
  lines.push('#version 450');
  lines.push('');
  
  // Emit uniforms
  lines.push('layout(std140, binding = 0) uniform MxParams {');
  ir.uniforms.forEach(uniform => {
    lines.push(`  ${glslType(uniform.type)} ${uniform.name};`);
  });
  lines.push('};');
  lines.push('');
  
  // Emit texture bindings
  ir.textures.forEach((tex, i) => {
    lines.push(`layout(binding = ${i}) uniform sampler2D ${tex.name};`);
  });
  lines.push('');
  
  // Emit main function
  lines.push('vec4 main(in MxVaryings vary) {');
  
  // Emit expression evaluations
  ir.exprs.forEach(expr => {
    const lowering = getNodeLowering(expr.kind, 'glsl');
    const code = lowering.emit(expr);  // Generate GLSL code
    lines.push(`  ${glslType(expr.type)} ${expr.id} = ${code};`);
  });
  
  lines.push('  return mx_output;');
  lines.push('}');
  
  return {
    code: lines.join('\n'),
    entryPoint: 'main',
    uniforms: [...],
    textures: [...],
    samplers: [...],
  };
}
```

## Node Lowering System

The `nodes.ts` file defines how each MaterialX node is lowered per backend:

```typescript
// src/compiler/nodes.ts

export interface NodeLowering {
  wgsl?: string;      // WGSL emit template
  glsl?: string;      // GLSL emit template
  hlsl?: string;      // HLSL emit template
  osl?: string;       // OSL emit template
  // ...
}

export const NODE_LOWERINGS: Record<string, NodeLowering> = {
  'multiply': {
    wgsl: '(a: f32, b: f32) -> f32 { return a * b; }',
    glsl: 'float multiply(float a, float b) { return a * b; }',
    hlsl: 'float multiply(float a, float b) { return a * b; }',
    // ...
  },
  'dot': {
    wgsl: 'dot($a, $b)',
    glsl: 'dot($a, $b)',
    hlsl: 'dot($a, $b)',
    // ...
  },
};
```

## Closure Library Strategy

Each backend needs language-specific closure implementations:

### WGSL Closures (current)
- Located in: `src/compiler/closure-library.ts`
- Supports: BSDF, EDF, VDF, BSSRDF
- Includes: Fresnel, microfacet distributions, clearcoat

### GLSL Closures (to implement)
```glsl
// glsl/closures.glsl

struct MxBsdf {
  vec3 radiance;
  vec3 transparency;
  // Closure data
};

vec3 mx_eval_bsdf(MxBsdf bsdf, vec3 vIn, vec3 vOut) {
  // OpenPBR evaluation
}

vec3 mx_sample_bsdf(MxBsdf bsdf, vec3 vIn, vec2 u, out vec3 vOut, out float pdf) {
  // Monte Carlo sampling
}
```

### Metal/HSL Closures
```metal
// metal/closures.metal

struct MxBsdf {
  float3 radiance;
  float3 transparency;
};

float3 mx_eval_bsdf(MxBsdf bsdf, float3 vIn, float3 vOut) {
  // Metal implementation
}
```

### OSL Closures
```osl
// osl/closures.osl

closure color mx_bsdf(color radiance, color transparency, ...) {
  // OSL closure - integrates with renderer
}
```

## Current Status

| Language | IR Support | Code Gen | Closures | Testing | Status |
|----------|-----------|----------|----------|---------|--------|
| **WGSL** | ✅ Full   | ✅ Done  | ✅ Done  | ✅ Yes  | 🟢 PRODUCTION |
| **GLSL** | ✅ Full   | 🔲 TODO  | 🔲 TODO  | 🔲 No   | 🔴 PLANNED |
| **HLSL** | ✅ Full   | 🔲 TODO  | 🔲 TODO  | 🔲 No   | 🔴 PLANNED |
| **OSL**  | ⚠️ Partial| 🔲 TODO  | 🔲 TODO  | 🔲 No   | 🔴 PLANNED |
| **MSL**  | ✅ Full   | 🔲 TODO  | 🔲 TODO  | 🔲 No   | 🔴 PLANNED |
| **SPIR-V**| ✅ Full  | 🔲 TODO  | 🔲 TODO  | 🔲 No   | 🔴 PLANNED |

## How to Add a New Backend

### Step 1: Create Backend Module
```typescript
// src/compiler/glsl.ts
export function emitGlslModule(ir: ShaderIr): GlslModule { ... }
export function glslType(type: IrType): string { ... }
```

### Step 2: Implement Node Lowering
```typescript
// Update src/compiler/nodes.ts
export const NODE_LOWERINGS: Record<string, NodeLowering> = {
  'multiply': {
    glsl: 'float multiply(float a, float b) { return a * b; }',
    ...
  },
};
```

### Step 3: Implement Closure Library
```typescript
// src/compiler/closures-glsl.ts
export const GLSL_CLOSURE_LIBRARY = `
  struct MxBsdf { ... }
  vec3 mx_eval_bsdf(...) { ... }
  ...
`;
```

### Step 4: Add Tests
```typescript
// tests/compiler-glsl.test.ts
describe('GLSL Code Generation', () => {
  it('should emit valid GLSL from IR', () => {
    const ir = createTestIr();
    const module = emitGlslModule(ir);
    expect(module.code).toBeDefined();
    expect(module.code).toContain('#version 450');
  });
});
```

### Step 5: Integration
```typescript
// src/render/engine.ts
import { emitGlslModule } from './compiler/glsl.ts';

export async function compileToGlsl(mtlxPath: string): Promise<GlslModule> {
  const mtlx = await loadMaterialX(mtlxPath);
  const ir = compileToIr(mtlx);
  return emitGlslModule(ir);
}
```

## Benefits of IR-Based Architecture

1. **Code Reuse:** Graph parsing, optimization, type checking once for all backends
2. **Consistency:** Same BSDF evaluation logic across languages
3. **Maintainability:** Fix node lowering in one place
4. **Extensibility:** Add new backends without rewriting compiler
5. **Testing:** Test IR independently of backend

## Limitations & Future Work

1. **Texture Binding:** Different models per language (uniform samplers, resource views, etc.)
2. **Compute vs Graphics:** Not all backends support compute shaders
3. **Closure Semantics:** OSL/MDL have fundamentally different closure systems
4. **Platform Constraints:** Some targets (e.g., WebGL) limit precision/features
5. **Performance:** Backend-specific optimizations may be needed

## References

- MaterialX Spec: https://materialx.org/
- WGSL: https://www.w3.org/TR/wgsl/
- GLSL: https://www.khronos.org/registry/OpenGL/specs/gl/glslangspec.4.60.pdf
- HLSL: https://docs.microsoft.com/en-us/windows/win32/direct3dhlsl/dx-graphics-hlsl
- OSL: https://github.com/AcademySoftwareFoundation/OpenShadingLanguage
- MSL: https://developer.apple.com/metal/
