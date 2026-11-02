# Réponse Détaillée: Conversion IR → Multi-Langages de Shading

## La Réponse Courte: OUI

**Oui, la représentation IR construite par le compilateur MaterialX peut être convertie en d'autres langages de shading (GLSL, HLSL, OSL, Metal, etc.).**

---

## 1. Architecture Actuelle du Compilateur

```
MaterialX (.mtlx)
    ↓ [Parse]
Graph (avec résolution de types)
    ↓ [Compile]
Shader IR (indépendant du renderer)
    ↓ [Emit]
WGSL Code ✅ (actuellement implémenté)
```

### Fichier Principal: `src/compiler/ir.ts`

C'est le cœur du système. Il définit une représentation **complètement indépendante** du langage:

```typescript
export interface ShaderIr {
  uniforms: IrUniform[];        // Paramètres éditables
  exprs: IrExpr[];              // Expressions (DAG)
  textures: TextureResource[];  // Références de textures
  samplers: SamplerResource[];  // Références de samplers
  outputs: ShaderOutput[];      // Sorties du shader
  closures: Closure[];          // Composition de closures (BSDF, EDF, etc.)
}
```

### Chaque Expression est Indépendante du Langage

```typescript
export interface IrExpr {
  id: IrRef;                    // Identifiant unique
  kind: string;                 // Type d'opération ("multiply", "dot", etc.)
  type: IrType;                 // Type du résultat (float, vec3, etc.)
  inputs?: IrRef[];             // Références aux expressions d'entrée
  value?: IrConstValue;         // Valeur constante si applicable
  provenance?: Provenance;      // Localisation dans le graphe MaterialX
}
```

**Exemple concret:**

```typescript
// Une multiplication: 0.5 * input_color
{
  id: 42,
  kind: "multiply",
  type: vector(3, 'float'),
  inputs: [37, 41],  // Références aux expressions précédentes
  provenance: "material.mtlx:line 15"
}

// Cette représentation peut être convertie en:
// WGSL:  let result = 0.5 * inputColor;
// GLSL:  vec3 result = 0.5 * inputColor;
// HLSL:  float3 result = 0.5 * inputColor;
// Metal: float3 result = 0.5 * inputColor;
// OSL:   color result = 0.5 * inputColor;
```

---

## 2. Comment Fonctionne la Conversion WGSL (Implémentée)

Le fichier `src/compiler/wgsl.ts` montre exactement comment convertir IR → Code:

```typescript
export function emitWgslModule(ir: ShaderIr): WgslModule {
  // 1. Créer le header WGSL
  // 2. Pour chaque type IrType → type WGSL (f32, vec3f, etc.)
  // 3. Pour chaque IrExpr → instruction WGSL
  // 4. Inclure la librairie de closures
  // 5. Générer la fonction mx_shade()
  
  return {
    code: "// Code WGSL complet",
    uniforms: [...],
    textures: [...],
  };
}
```

**Traduction de Types:**
```
IrType                     WGSL
──────────────────────────────
scalar(float)       →      f32
scalar(int)         →      i32
vector(3, float)    →      vec3f
vector(4, int)      →      vec4i
matrix(4)           →      mat4x4f
closure(bsdf)       →      MxBsdf
```

**Traduction d'Opérations:**
```
IrExpr.kind            WGSL Code
──────────────────────────────────
"constant"       →     let x = 0.5;
"multiply"       →     a * b
"add"            →     a + b
"dot"            →     dot(a, b)
"normalize"      →     normalize(v)
"sample_texture" →     textureSample(tex, sampler, uv)
"mx_fresnel_*"   →     Call mx_fresnel_*(...)
```

---

## 3. Comment Ajouter Support GLSL

C'est très simple! Voici le processus:

### Étape 1: Créer `src/compiler/glsl.ts`

```typescript
import type { ShaderIr, IrType } from './ir.ts';

export function emitGlslModule(ir: ShaderIr): GlslModule {
  const lines = [];
  
  // 1. Header
  lines.push('#version 450');
  
  // 2. Traduire les types IrType → GLSL
  function glslType(type: IrType): string {
    if (type.kind === 'scalar') {
      return type.scalar === 'float' ? 'float' : 'int';
    }
    if (type.kind === 'vector') {
      const prefix = type.scalar === 'float' ? 'vec' : 'ivec';
      return `${prefix}${type.size}`;
    }
    if (type.kind === 'matrix') {
      return `mat${type.size}`;
    }
    return 'float';  // Default
  }
  
  // 3. Émettre les uniforms
  lines.push('layout(std140, binding = 0) uniform MxParams {');
  ir.uniforms.forEach(uniform => {
    lines.push(`  ${glslType(uniform.type)} ${uniform.name};`);
  });
  lines.push('};');
  
  // 4. Émettre chaque expression
  ir.exprs.forEach(expr => {
    let code = '';
    
    if (expr.kind === 'constant') {
      code = `${glslType(expr.type)} expr_${expr.id} = ${expr.value};`;
    } else if (expr.kind === 'multiply') {
      const [a, b] = expr.inputs!;
      code = `${glslType(expr.type)} expr_${expr.id} = expr_${a} * expr_${b};`;
    } else if (expr.kind === 'dot') {
      const [a, b] = expr.inputs!;
      code = `${glslType(expr.type)} expr_${expr.id} = dot(expr_${a}, expr_${b});`;
    }
    // ... continuer pour toutes les opérations
    
    lines.push(`  ${code}`);
  });
  
  // 5. Retourner la sortie
  lines.push('  outColor = vec4(expr_final, 1.0);');
  lines.push('}');
  
  return {
    code: lines.join('\n'),
    uniforms: [...],
  };
}
```

### Étape 2: Intégrer dans `src/compiler/nodes.ts`

Le fichier `nodes.ts` définit comment chaque nœud MaterialX est implémenté par backend.

Ajouter les cas GLSL:

```typescript
export const NODE_LOWERINGS = {
  'multiply': {
    wgsl: '(a * b)',
    glsl: '(a * b)',           // ← Ajouter
    hlsl: '(a * b)',
  },
  'dot': {
    wgsl: 'dot(a, b)',
    glsl: 'dot(a, b)',         // ← Ajouter
    hlsl: 'dot(a, b)',
  },
  // ... etc
};
```

### Étape 3: Inclure la Librairie de Closures GLSL

```typescript
// closures-glsl.ts
export const GLSL_CLOSURE_LIBRARY = `
  struct MxBsdf {
    vec3 radiance;
    vec3 transparency;
    // ... members
  };
  
  vec3 mx_eval_bsdf(MxBsdf bsdf, vec3 vIn, vec3 vOut) {
    // OpenPBR implementation en GLSL
  }
  
  vec3 mx_sample_bsdf(MxBsdf bsdf, vec3 vIn, vec2 u, out vec3 vOut) {
    // Importance sampling en GLSL
  }
`;
```

### Étape 4: Exporter l'API Publique

```typescript
// compiler/api.ts
export async function compileMaterialXToGlsl(mtlxPath: string): Promise<string> {
  const ir = await compileMaterialXToIr(mtlxPath);
  const module = emitGlslModule(ir);
  return module.code;
}
```

---

## 4. État Actuel des Backends

### Exécution web ou native par cible

Ce tableau décrit les environnements capables d'exécuter chaque cible, pas les backends déjà implémentés dans ce moteur. Générer du code dans un navigateur ne signifie pas que celui-ci peut l'exécuter.

| Cible | Web (navigateur) | Natif | Conditions |
|---|---|---|---|
| **WGSL** | **Oui**, via WebGPU | **Oui**, via une implémentation WebGPU native acceptant WGSL, comme Dawn ou wgpu | Cible actuelle du moteur. WebGPU permet le raster et le compute, sous réserve de disponibilité dans le navigateur et sur le matériel. |
| **GLSL ES** | **Oui**, via WebGL 1 (GLSL ES 1.00) ou WebGL 2 (GLSL ES 3.00) | **Oui**, via OpenGL ES | Il faut un émetteur adapté au profil WebGL : le GLSL desktop n'est pas accepté tel quel. WebGL ne fournit pas de compute shaders. |
| **GLSL desktop** | **Non**, pas directement | **Oui**, via OpenGL ; via Vulkan après compilation vers SPIR-V avec un profil adapté | L'exemple `#version 450` de ce document est une cible native, pas WebGL. Les compute shaders sont disponibles à partir d'OpenGL 4.3. |
| **HLSL** | **Non**, pas directement | **Oui**, via Direct3D après compilation ; via Vulkan après compilation vers SPIR-V avec un compilateur adapté | Pour le web, une chaîne de traduction vers WGSL ou GLSL ES est nécessaire : le navigateur n'exécute alors plus du HLSL. |
| **OSL** | **Non**, pas via WebGL/WebGPU | **Oui**, dans un moteur de rendu intégrant OSL | Le support CPU/GPU dépend du moteur. Un éventuel portage de l'exécution en WebAssembly serait un projet distinct, pas un backend shader web directement utilisable. |
| **Metal Shading Language (MSL)** | **Non**, pas directement | **Oui**, via Metal sur les plateformes Apple | Safari peut utiliser Metal en interne pour WebGPU, mais l'application web fournit du WGSL, pas du MSL. |
| **SPIR-V** (format binaire intermédiaire) | **Non**, pas accepté directement par les API WebGL/WebGPU standard | **Oui**, principalement via Vulkan | Cible supplémentaire envisageable, généralement obtenue en compilant GLSL ou HLSL. Pour le navigateur, il faut traduire vers WGSL ou GLSL ES. |
| **MDL** (cible supplémentaire envisageable) | **Non**, pas directement | **Oui**, via un environnement intégrant le SDK MDL et ses backends | Langage de description de matériaux, pas un remplacement direct de WGSL. Une intégration dédiée est nécessaire pour ses sémantiques et son exécution. |

**Pour ce moteur web :** conserver WGSL/WebGPU pour le raster et le path tracing compute. GLSL ES/WebGL peut constituer une cible de compatibilité pour le raster, mais ne permet pas de réutiliser directement le path tracer compute actuel. Les autres cibles servent principalement à des intégrations natives.

### Compatibilité avec ce poste Windows et le Samsung Galaxy Z Flip5

Le système de ce poste est Windows, mais son GPU, ses pilotes et les capacités de son navigateur n'ont pas été vérifiés. Le Galaxy Z Flip5 dispose d'un Snapdragon 8 Gen 2 for Galaxy avec GPU Adreno 740 : c'est une plateforme adaptée à OpenGL ES et Vulkan, et à WebGPU dans un navigateur Android compatible. Les mentions « oui » ci-dessous indiquent une voie d'exécution disponible sur la plateforme, pas un test réussi sur ces deux appareils.

| Cible | Ce poste Windows : web | Ce poste Windows : natif | Galaxy Z Flip5 : web | Galaxy Z Flip5 : natif |
|---|---|---|---|---|
| **WGSL** | Oui, avec WebGPU dans Chrome/Edge compatibles, sous réserve du GPU et des pilotes | Oui, avec Dawn/wgpu et un backend GPU compatible, généralement Direct3D 12 ou Vulkan | Oui, avec WebGPU dans un Chrome Android compatible ; à vérifier selon la version Android, le navigateur et les pilotes | Oui, avec une intégration WebGPU native compatible Android, par exemple wgpu sur Vulkan |
| **GLSL ES** | Oui, via WebGL 1/2 si activé | Oui, notamment via ANGLE traduisant OpenGL ES vers une API Windows | Oui, via WebGL 1/2 dans un navigateur compatible | Oui, via OpenGL ES ; le compute nécessite OpenGL ES 3.1+ et n'est pas exposé par WebGL |
| **GLSL desktop** | Non directement | Oui, via OpenGL si le pilote expose la version requise | Non directement | Pas via l'API OpenGL desktop standard ; possible après compilation d'un profil Vulkan adapté vers SPIR-V, ou adaptation vers GLSL ES |
| **HLSL** | Non directement | Oui, via Direct3D, selon le shader model et le GPU | Non directement | Pas via Direct3D ; oui après compilation compatible vers SPIR-V pour Vulkan |
| **OSL** | Non directement | Oui, dans un moteur intégrant OSL ; accélération GPU selon le moteur et le matériel | Non directement | Pas une voie prête à l'emploi : nécessite un portage d'un environnement OSL compatible Android |
| **Metal / MSL** | Non | Non, Metal est une API Apple | Non | Non, Metal est une API Apple |
| **SPIR-V** | Non directement | Oui, via Vulkan si GPU/pilotes compatibles | Non directement | Oui, via Vulkan avec des shaders respectant les fonctionnalités et limites de l'appareil |
| **MDL** | Non directement | Oui, avec un SDK/moteur MDL compatible ; exigences GPU selon le backend | Non directement | Pas une voie Android standard prête à l'emploi ; nécessite une chaîne de génération et une intégration compatibles, à valider séparément |

**Choix recommandé pour les deux appareils :**

- **Même application web : WGSL + WebGPU**, pour conserver le raster et le path tracer compute actuels. Détecter `navigator.gpu`, puis vérifier que `requestAdapter()` renvoie un adaptateur et que `requestDevice()` réussit. L'exposition de l'API seule ne garantit pas l'exécution. Utiliser HTTPS (ou localhost pour le développement).
- **Compatibilité web plus large : GLSL ES + WebGL 2**, avec un backend à implémenter et un chemin raster adapté, sans réutilisation directe du path tracer compute.
- **Application native commune Windows/Android : Vulkan + SPIR-V**, ou une couche WebGPU native acceptant WGSL, avec intégration et validation sur les deux plateformes.
- **Sur le Z Flip5 :** prévoir une résolution et un nombre d'échantillons réduits pour le path tracing ; compatibilité compute ne signifie pas performances équivalentes au PC, notamment avec les limites thermiques et énergétiques du mobile.

### ✅ WGSL (PRODUCTION)
- **Status:** Complètement implémenté
- **Utilisé pour:** Path tracer et forward raster
- **Code:** `src/compiler/wgsl.ts`
- **Tests:** Existants et passants

### 🔲 GLSL (READY TO IMPLEMENT)
- **Status:** Template ready
- **Avantages:** Compatibilité desktop, ancien matériel
- **Challenges:** Distinguer GLSL desktop (natif, compute dès OpenGL 4.3) et GLSL ES pour WebGL (web, sans compute)
- **Effort:** ~500 lignes de code
- **Code template:** Fourni ci-dessus

### 🔲 HLSL (READY TO IMPLEMENT)
- **Status:** Template ready
- **Avantages:** Écosystème DirectX, optimisations Xbox
- **Challenges:** Modèle de binding différent
- **Effort:** ~600 lignes de code

### 🔲 OSL (PARTIAL)
- **Status:** IR support, backend à faire
- **Avantages:** Intégration DCC (Arnold, RenderMan)
- **Challenges:** Système de closure fondamentalement différent
- **Effort:** ~800 lignes de code

### 🔲 Metal (READY TO IMPLEMENT)
- **Status:** Template ready
- **Avantages:** Optimisation Apple, iOS/macOS
- **Challenges:** Modèle de binding MSL différent
- **Effort:** ~600 lignes de code

---

## 5. Cas Concret: Convertir un Matériau

### Input: MaterialX (.mtlx)
```xml
<open_pbr_surface name="gold">
  <input name="base_color" type="color3" value="0.8, 0.6, 0.2" />
  <input name="metalness" type="float" value="1.0" />
  <input name="roughness" type="float" value="0.2" />
</open_pbr_surface>
```

### IR Intermédiaire (indépendant du langage)
```
IrExpr [id:1] constant, type:color3, value:(0.8, 0.6, 0.2)
IrExpr [id:2] constant, type:float, value:1.0
IrExpr [id:3] constant, type:float, value:0.2
IrExpr [id:4] open_pbr_surface, type:closure(bsdf), inputs:[1,2,3]
```

### Output WGSL (actuellement généré)
```wgsl
@group(0) @binding(0) var<uniform> params: MxParams;

fn mx_shade(vary: MxVaryings) -> MxBsdf {
  let base_color = vec3f(0.8, 0.6, 0.2);
  let metalness = 1.0;
  let roughness = 0.2;
  
  let result = mx_open_pbr_surface(
    base_color, metalness, roughness
  );
  
  return result;
}
```

### Output GLSL (sera généré avec backend GLSL)
```glsl
layout(std140, binding = 0) uniform MxParams {
  vec3 base_color;
  float metalness;
  float roughness;
};

MxBsdf main() {
  vec3 base_color = vec3(0.8, 0.6, 0.2);
  float metalness = 1.0;
  float roughness = 0.2;
  
  MxBsdf result = mx_open_pbr_surface(
    base_color, metalness, roughness
  );
  
  return result;
}
```

---

## 6. Architecture: Où Tout Se Passe

```
materialx-webgpu-engine/
│
├── src/materialx/
│   ├── graph.ts               ← Parse .mtlx files
│   └── loader.ts              ← Charge la librairie MaterialX
│
├── src/compiler/
│   ├── ir.ts                  ← CORE: Types IR (indépendant du langage)
│   ├── nodes.ts               ← Comment chaque nœud est implémenté
│   ├── closure-library.ts     ← BSDF/EDF implémentations
│   │
│   ├── wgsl.ts                ← ✅ DONE: Backend WGSL
│   ├── glsl.ts                ← 🔲 TODO: Backend GLSL
│   ├── hlsl.ts                ← 🔲 TODO: Backend HLSL
│   ├── osl.ts                 ← 🔲 TODO: Backend OSL
│   └── metal.ts               ← 🔲 TODO: Backend Metal
│
└── src/render/
    ├── raster/shaders.ts      ← Utilise le code WGSL généré
    └── pathtracing/compute.ts ← Utilise le code WGSL généré
```

---

## 7. Avantages de cette Architecture

1. **Code Partagé:** Parsing, résolution, optimisation fait une fois
2. **Cohérence:** Même logique BSDF dans tous les langages
3. **Maintenabilité:** Fixer un bug d'implémentation = fixer partout
4. **Extensibilité:** Ajouter un langage = implémenter un backend
5. **Robustesse:** IR validé indépendamment du backend

---

## 8. Prochaines Étapes pour Vous

Si vous voulez ajouter GLSL:

1. **Copier le template** fourni ci-dessus dans `src/compiler/glsl.ts`
2. **Implémenter `glslType()`** pour mapper IR types → GLSL types
3. **Implémenter `emitGlslExpression()`** pour chaque opération
4. **Ajouter les cas GLSL** dans `nodes.ts`
5. **Inclure la librairie de closures** GLSL
6. **Tester** avec des matériaux simples

**Temps estimé:** 2-3 heures pour un développeur familier avec GLSL

---

## 9. Ressources Importantes

### Fichiers à Consulter
- `src/compiler/ir.ts` - Définition complète de l'IR
- `src/compiler/wgsl.ts` - Référence d'implémentation (420 lignes)
- `src/compiler/nodes.ts` - Catalogue des opérations
- `IR_MULTI_BACKEND_ARCHITECTURE.md` - Documentation technique
- `MULTI_BACKEND_PRACTICAL_GUIDE.md` - Guide pratique d'implémentation

### Concepts Clés
- **IR:** Représentation indépendante du renderer
- **CSE:** Common Subexpression Elimination (déjà appliquée)
- **Closure:** BSDF/EDF composition (propriétaire à chaque langage)
- **Node Lowering:** Comment un nœud MaterialX est implémenté

---

## 10. Limitations Actuelles

1. **Pas de GLSL/HLSL:** Seulement WGSL en production
2. **Compute Shaders:** Implémentés seulement en WGSL dans ce moteur. WebGL n'en propose pas ; les API natives OpenGL 4.3+, Vulkan, Direct3D et Metal en proposent.
3. **Closures Complexes:** OSL/MDL incompatibles avec BSDF standard
4. **Texture Binding:** Modèles différents par langage

---

## Conclusion

**OUI, absolument possible!** L'architecture IR rend très simple l'ajout de nouveaux backends shader.

La représentation IR est le cœur de la solution. C'est un format complètement indépendant qui peut être traduit en n'importe quel langage de shading.

Pour étendre le moteur:
1. L'infrastructure existe déjà
2. Il suffit d'implémenter la traduction IR → Langage cible
3. Le template est fourni
4. ~500-800 lignes de code par langage
