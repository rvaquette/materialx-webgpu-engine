# Practical Guide: Using MaterialX IR for Multi-Backend Compilation

## Quick Answer to Your Question

**Yes, the IR can be converted to multiple languages!**

Here's what's currently implemented and how to extend it:

### Current Status
- ✅ **WGSL:** Fully implemented (src/compiler/wgsl.ts)
- 🔲 **GLSL, HLSL, OSL, Metal:** Architecture ready, backends not yet implemented
- ✅ **Infrastructure:** All necessary pieces in place for new backends

---

## Architecture: From MaterialX to Any Language

### The Pipeline

```
1. Load MaterialX (.mtlx) File
   ↓
2. Resolve Graph (resolve node connections)
   ↓
3. Compile to Shader IR (language-independent)
   ↓
4. Choose Backend: WGSL | GLSL | HLSL | OSL | Metal
   ↓
5. Emit Target Language Code
```

### Actual File Locations

```
materialx-webgpu-engine/
├── src/
│   ├── materialx/
│   │   ├── graph.ts           ← Parse .mtlx files
│   │   └── loader.ts          ← Load MaterialX library
│   │
│   ├── compiler/
│   │   ├── ir.ts              ← IR Types (renderer-independent)
│   │   ├── nodes.ts           ← Node definitions & lowering
│   │   ├── closure-library.ts ← BSDF/EDF implementations
│   │   │
│   │   ├── wgsl.ts            ← WGSL Backend ✅ DONE
│   │   ├── glsl.ts            ← GLSL Backend 🔲 TODO (template ready)
│   │   ├── hlsl.ts            ← HLSL Backend 🔲 TODO (template ready)
│   │   └── osl.ts             ← OSL Backend 🔲 TODO (template ready)
```

---

## Step-by-Step: How to Extract and Use IR

### Step 1: Load and Compile MaterialX to IR

```typescript
// src/materialx/compiler-api.ts (your entry point)

import { loadMaterialXLibraries } from './loader.ts';
import { resolveGraph } from './graph.ts';
import { compileToIr } from './compiler.ts';

export async function compileMaterialXToIr(mtlxPath: string) {
  // Load MaterialX standard library
  const libraries = await loadMaterialXLibraries();
  
  // Load your .mtlx file
  const doc = await loadDocument(mtlxPath);
  doc.importLibraries(libraries);
  
  // Resolve the graph (validate connections)
  const resolved = resolveGraph(doc);
  
  // Compile to IR (renderer-independent)
  const ir = compileToIr(resolved);
  
  // Now `ir` contains the complete shader graph in IR form
  return ir;
}
```

### Step 2: Inspect the IR

```typescript
import type { ShaderIr, IrExpr, IrType } from './compiler/ir.ts';

function inspectIr(ir: ShaderIr) {
  console.log('=== Shader IR ===');
  
  // 1. Parameters
  console.log('\n--- Parameters (Editable Uniforms) ---');
  ir.uniforms.forEach(uniform => {
    console.log(`  ${uniform.name}: ${uniform.type} (group ${uniform.group})`);
  });
  
  // 2. Textures
  console.log('\n--- Textures ---');
  ir.textures.forEach(tex => {
    console.log(`  ${tex.name}: ${tex.fileRef}`);
  });
  
  // 3. Expressions (sorted by ID)
  console.log('\n--- Expression DAG ---');
  ir.exprs.forEach(expr => {
    const inputsStr = expr.inputs?.map(id => `expr_${id}`).join(', ') || 'none';
    console.log(`  expr_${expr.id}: ${expr.kind} → ${expr.type}`);
    console.log(`    inputs: [${inputsStr}]`);
    console.log(`    provenance: ${expr.provenance?.location || 'unknown'}`);
  });
  
  // 4. Outputs
  console.log('\n--- Shader Outputs ---');
  ir.outputs?.forEach(output => {
    console.log(`  ${output.name}: ${output.type}`);
  });
  
  // 5. Graph Statistics
  console.log('\n--- Statistics ---');
  console.log(`  Total expressions: ${ir.exprs.length}`);
  console.log(`  Uniforms: ${ir.uniforms.length}`);
  console.log(`  Textures: ${ir.textures.length}`);
  console.log(`  Closures used: ${ir.closures.length}`);
}
```

### Step 3: Generate WGSL (Current Implementation)

```typescript
import { emitWgslModule } from './compiler/wgsl.ts';

export async function compileMaterialXToWgsl(mtlxPath: string): Promise<string> {
  const ir = await compileMaterialXToIr(mtlxPath);
  
  // Generate WGSL code
  const wgslModule = emitWgslModule(ir);
  
  return wgslModule.code;
}

// Usage:
const wgslCode = await compileMaterialXToWgsl('my_material.mtlx');
console.log(wgslCode);
// Outputs complete WGSL module with:
// - Uniform blocks
// - Texture/sampler bindings
// - mx_shade() entry point
// - Closure implementations
```

### Step 4: Generate GLSL (Example for New Backend)

```typescript
// src/compiler/glsl.ts - Example implementation

import type { ShaderIr, IrType } from './ir.ts';

export interface GlslModule {
  code: string;
  entryPoint: string;
  version: string;
  uniforms: Array<{ name: string; type: string }>;
  textures: Array<{ name: string; binding: number }>;
}

/**
 * Translate IR type to GLSL type
 */
function glslType(type: IrType): string {
  switch (type.kind) {
    case 'scalar':
      switch (type.scalar) {
        case 'float': return 'float';
        case 'int': return 'int';
        case 'bool': return 'bool';
      }
      break;
    case 'vector':
      const prefix = type.scalar === 'float' ? 'vec' : 'ivec';
      return `${prefix}${type.size}`;
    case 'matrix':
      return `mat${type.size}`;
    case 'closure':
      return 'MxBsdf';  // Custom type for closures
    case 'shader':
      return 'void';
    case 'string':
    case 'filename':
      return 'sampler2D';  // String → texture reference
  }
  throw new Error(`Unknown IR type: ${type.kind}`);
}

/**
 * Emit expression evaluation in GLSL
 */
function emitGlslExpression(expr: IrExpr, context: EmitContext): string {
  const id = `expr_${expr.id}`;
  const type = glslType(expr.type);
  
  switch (expr.kind) {
    case 'constant':
      return `${type} ${id} = ${expr.value};`;
    
    case 'multiply': {
      const [a, b] = expr.inputs!;
      return `${type} ${id} = expr_${a} * expr_${b};`;
    }
    
    case 'dot': {
      const [a, b] = expr.inputs!;
      return `${type} ${id} = dot(expr_${a}, expr_${b});`;
    }
    
    case 'sample_texture': {
      const [texId, coordId] = expr.inputs!;
      const texName = context.textures[texId];
      return `${type} ${id} = texture(${texName}, expr_${coordId}).rgb;`;
    }
    
    // Add more operations...
    default:
      throw new Error(`Unsupported operation: ${expr.kind}`);
  }
}

/**
 * Main GLSL code generator
 */
export function emitGlslModule(ir: ShaderIr): GlslModule {
  const lines: string[] = [];
  
  // Header
  lines.push('#version 450');
  lines.push('#extension GL_ARB_bindless_texture : enable');
  lines.push('');
  
  // Uniform block
  if (ir.uniforms.length > 0) {
    lines.push('layout(std140, binding = 0) uniform MxParams {');
    ir.uniforms.forEach(uniform => {
      const type = glslType(uniform.type);
      lines.push(`  ${type} ${uniform.name};`);
    });
    lines.push('};');
    lines.push('');
  }
  
  // Texture/sampler bindings
  ir.textures.forEach((tex, i) => {
    lines.push(`layout(binding = ${i}) uniform sampler2D ${tex.name};`);
  });
  lines.push('');
  
  // Varyings (interpolated from vertex shader)
  lines.push('in MxVaryings {');
  lines.push('  vec3 position;');
  lines.push('  vec3 normal;');
  lines.push('  vec2 texcoord;');
  lines.push('} vary;');
  lines.push('');
  
  // Output
  lines.push('out vec4 outColor;');
  lines.push('');
  
  // Closure library (must be included)
  lines.push(GLSL_CLOSURE_LIBRARY);
  lines.push('');
  
  // Main shader function
  lines.push('void main() {');
  
  // Declare all expression variables
  const context = { textures: new Map(ir.textures.map((t, i) => [i, t.name])) };
  ir.exprs.forEach(expr => {
    const code = emitGlslExpression(expr, context);
    lines.push(`  ${code}`);
  });
  
  // Return output
  ir.outputs?.forEach(output => {
    if (output.name === 'surface') {
      lines.push(`  outColor = vec4(expr_${output.expr}, 1.0);`);
    }
  });
  
  lines.push('}');
  
  return {
    code: lines.join('\n'),
    entryPoint: 'main',
    version: '450',
    uniforms: ir.uniforms.map(u => ({ name: u.name, type: glslType(u.type) })),
    textures: ir.textures.map((t, i) => ({ name: t.name, binding: i })),
  };
}

// Usage:
export async function compileMaterialXToGlsl(mtlxPath: string): Promise<string> {
  const ir = await compileMaterialXToIr(mtlxPath);
  const glslModule = emitGlslModule(ir);
  return glslModule.code;
}
```

---

## Real-World Example: Converting a Material

### Input MaterialX Graph

```xml
<?xml version="1.0"?>
<materialx version="1.39">
  <material name="gold" type="material">
    <input name="surfaceshader" type="surfaceshader" nodename="surface1" />
  </material>
  
  <surface name="surface1" type="surfaceshader">
    <input name="bsdf" type="BSDF" nodename="bsdf1" />
  </surface>
  
  <open_pbr_surface name="bsdf1" type="BSDF">
    <input name="base_color" type="color3" value="0.8, 0.6, 0.2" />
    <input name="metalness" type="float" value="1.0" />
    <input name="roughness" type="float" value="0.2" />
  </open_pbr_surface>
</materialx>
```

### Generated IR (after compilation)

```
ShaderIr {
  uniforms: [
    { name: "base_color", type: vec3, group: 0 },
    { name: "metalness", type: float, group: 0 },
    { name: "roughness", type: float, group: 0 },
  ],
  
  exprs: [
    { id: 0, kind: "param", type: vec3, value: "base_color" },
    { id: 1, kind: "param", type: float, value: "metalness" },
    { id: 2, kind: "param", type: float, value: "roughness" },
    { id: 3, kind: "open_pbr_surface", type: closure<bsdf>,
      inputs: [0, 1, 2] },
    { id: 4, kind: "surface", type: closure<bsdf>,
      inputs: [3] },
  ],
  
  outputs: [
    { name: "surface", expr: 4, type: closure<bsdf> }
  ],
  
  closures: [MxBsdf, ...],
}
```

### Generated WGSL

```wgsl
struct MxParams {
  base_color: vec3f,
  metalness: f32,
  roughness: f32,
};

@group(0) @binding(0) var<uniform> params: MxParams;

// Closure library included...
struct MxBsdf { ... }
fn mx_eval_bsdf(...) { ... }

fn mx_shade(vary: MxVaryings) -> vec4f {
  let base_color = params.base_color;
  let metalness = params.metalness;
  let roughness = params.roughness;
  
  let bsdf = mx_open_pbr_surface(
    base_color, metalness, roughness
  );
  
  let surface = bsdf;
  
  return vec4f(mx_shade_surface(surface), 1.0);
}
```

### Generated GLSL (with proposed backend)

```glsl
#version 450

layout(std140, binding = 0) uniform MxParams {
  vec3 base_color;
  float metalness;
  float roughness;
};

// Closure library included...

void main() {
  vec3 base_color = params.base_color;
  float metalness = params.metalness;
  float roughness = params.roughness;
  
  MxBsdf bsdf = mx_open_pbr_surface(
    base_color, metalness, roughness
  );
  
  MxBsdf surface = bsdf;
  
  outColor = vec4(mx_shade_surface(surface), 1.0);
}
```

---

## Building a Custom Backend

### Template Structure

```typescript
// src/compiler/my-language.ts

import type { ShaderIr, IrExpr, IrType } from './ir.ts';

// 1. Define output module structure
export interface MyLangModule {
  code: string;
  entryPoint: string;
  uniforms: Array<{ name: string; type: string }>;
  bindings: Array<{ name: string; slot: number }>;
}

// 2. Implement type translator
function myLangType(type: IrType): string {
  switch (type.kind) {
    case 'scalar':
      return type.scalar === 'float' ? 'real' : 'integer';
    case 'vector':
      return `vec${type.size}`;
    // ... etc
  }
}

// 3. Implement expression emitter
function emitExpression(expr: IrExpr): string {
  switch (expr.kind) {
    case 'constant': return `constant(${expr.value})`;
    case 'multiply': return `mul(expr_${expr.inputs![0]}, expr_${expr.inputs![1]})`;
    // ... etc
  }
}

// 4. Main code generator
export function emitMyLangModule(ir: ShaderIr): MyLangModule {
  const code = [];
  
  // Add headers/preamble
  code.push('// Generated shader');
  
  // Emit uniforms
  ir.uniforms.forEach(u => {
    code.push(`uniform ${myLangType(u.type)} ${u.name};`);
  });
  
  // Emit expressions
  ir.exprs.forEach(expr => {
    code.push(`${myLangType(expr.type)} expr_${expr.id} = ${emitExpression(expr)};`);
  });
  
  return {
    code: code.join('\n'),
    entryPoint: 'shade',
    uniforms: [...],
    bindings: [...],
  };
}

// 5. Public API
export async function compileMaterialXToMyLang(mtlxPath: string): Promise<string> {
  const ir = await compileMaterialXToIr(mtlxPath);
  return emitMyLangModule(ir).code;
}
```

---

## Integration with Existing Code

### Option 1: Unified Compiler API

```typescript
// src/compiler/api.ts

export type ShaderBackend = 'wgsl' | 'glsl' | 'hlsl' | 'osl' | 'metal';

export async function compileMaterialX(
  mtlxPath: string,
  backend: ShaderBackend
): Promise<string> {
  const ir = await compileMaterialXToIr(mtlxPath);
  
  switch (backend) {
    case 'wgsl': return emitWgslModule(ir).code;
    case 'glsl': return emitGlslModule(ir).code;
    case 'hlsl': return emitHlslModule(ir).code;
    case 'osl': return emitOslModule(ir).code;
    case 'metal': return emitMetalModule(ir).code;
  }
}

// Usage:
const wgslCode = await compileMaterialX('material.mtlx', 'wgsl');
const glslCode = await compileMaterialX('material.mtlx', 'glsl');
const hlslCode = await compileMaterialX('material.mtlx', 'hlsl');
```

### Option 2: Direct Backend Functions

```typescript
// Direct imports and usage
import { compileMaterialXToWgsl } from './compiler/wgsl.ts';
import { compileMaterialXToGlsl } from './compiler/glsl.ts';

const wgsl = await compileMaterialXToWgsl('mat.mtlx');
const glsl = await compileMaterialXToGlsl('mat.mtlx');
```

---

## Testing Your Backend

```typescript
// tests/compiler-backend.test.ts

describe('Custom Backend Code Generation', () => {
  it('should compile MaterialX to target language', async () => {
    const ir = await createTestIr();
    const module = emitTargetLanguage(ir);
    
    expect(module.code).toBeDefined();
    expect(module.code.length).toBeGreaterThan(0);
    expect(module.uniforms).toBeDefined();
    expect(module.bindings).toBeDefined();
  });
  
  it('should handle all closure types', async () => {
    const closures = ['bsdf', 'edf', 'vdf'];
    for (const closure of closures) {
      const ir = createIrWithClosure(closure);
      const module = emitTargetLanguage(ir);
      expect(module.code).toContain(`mx_${closure}`);
    }
  });
  
  it('should map all IR types correctly', async () => {
    const types = [
      { ir: 'float', expected: 'float' },
      { ir: 'vec3', expected: 'vec3' },
      { ir: 'mat4', expected: 'mat4' },
    ];
    types.forEach(({ ir, expected }) => {
      expect(targetType(ir)).toBe(expected);
    });
  });
});
```

---

## Conclusion

The materialx-webgpu-engine's IR-based architecture makes it straightforward to:

1. **Parse** MaterialX graphs (existing code)
2. **Compile** to renderer-independent IR (existing code)
3. **Emit** any target language (template ready for new backends)

**To add GLSL support:** Copy the WGSL backend template, replace `glslType()` and `emitGlslExpression()`, and you're done!

The hard parts (graph resolution, optimization, closure semantics) are done once. Backend emission is just code generation.
