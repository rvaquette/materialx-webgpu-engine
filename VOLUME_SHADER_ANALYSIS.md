# Analyse : Pourquoi volume_cube ne rend pas un cube évanescent

## Problème

La scène `volume_cube.mtlx` n'affiche pas de cube volumétrique malgré la présence d'infrastructure volumétrique complète dans le moteur.

## Causes Racines

### 1. **Fichier MTLx incorrect**
- `volume_cube.mtlx` ne contient QUE une `surfacematerial` avec transmission
- Il n'y a PAS de `volumeshader` ou closure `VDF`
- Commentaire dans le fichier : `"scatter volume remains uncorrected; surface-only conversion cannot preserve it"`

```xml
<!-- ❌ WRONG: Only surface shader, no VDF closure -->
<disney_principled name="volume_surface" type="surfaceshader">
  <input name="baseColor" type="color3" value="1, 1, 1" />
  <input name="roughness" type="float" value="0" />
  <input name="specTrans" type="float" value="1" />
</disney_principled>

<surfacematerial name="volume" type="material">
  <input name="surfaceshader" type="surfaceshader" nodename="volume_surface" />
</surfacematerial>
```

### 2. **Architecture volumétrique détecte mais ne compile pas**

Le système détecte les volumes via tokens dans `src/compiler/features.ts`:

```typescript
const volume = closureKinds.has('vdf') || hasVolumeOutput || anyToken(tokens, ['_vdf', 'absorption', 'anisotropic_vdf']);
```

**Recherche de tokens :**
- `'_vdf'`, `'absorption'`, `'anisotropic_vdf'` 

Mais ces tokens ne sont JAMAIS présents dans la graph parce que :
- `anisotropic_vdf` n'est pas utilisé dans `volume_cube.mtlx`
- `standard_surface`/`disney_principled` ne produisent pas de VDF closure

### 3. **Limitation du compilateur MaterialX**

Le compilateur `src/materialx/surface-from-inputs.ts` et la lowering `src/compiler/ir.ts` ne composent **que** des BSDF (et BSSRDF pour subsurface), **jamais** de VDF.

La architecture volumétrique est présente mais **orpheline** - elle n'est jamais appelée depuis les shaders surface standard.

## Architecture Actuelle

```
Volume Support Layers:
├─ Path Tracer Backend
│  ├─ CPU ref: src/render/pathtracing/media.ts ✅
│  ├─ GPU compute: src/render/pathtracing/compute.ts (WGSL)
│  └─ Henyey-Greenstein phase functions ✅
│
├─ Raster Backend
│  ├─ CPU ref: src/render/raster/volume.ts ✅
│  ├─ Ray marching with Beer-Lambert ✅
│  └─ Single-scattering approximation ✅
│
├─ Asset Layer
│  ├─ OpenVDB decoder (pluggable)
│  └─ Registry: src/assets/volumes.ts ✅
│
└─ Shader Compiler
   ├─ Feature detection ✅ (détecte les VDF)
   ├─ VDF lowering ❌ (never emitted)
   └─ Render pass generation ✅ (marks 'volume' pass if VDF present)
```

## Pourquoi Aucun Render Pass Volume n'est Généré

1. `scene` → USD load → matériau référence MTLx
2. MaterialX MTLx n'a PAS de VDF closure explicite
3. `extractFeatures()` ne trouve pas de token volume
4. `hasVolumeOutput` est false (pas de volumeshader output)
5. `volume` flag reste false
6. `'volume'` render pass n'est PAS créé
7. Aucun code volume n'est généré ou exécuté

## Ce Qu'il Faudrait Faire

### Option A : Support Volumeshader Explicite (Requis pour solution complète)

Implémenter le support des `volumeshader` outputs:

```xml
<!-- ✅ CORRECT: Explicit volumeshader with VDF -->
<anisotropic_vdf name="vol_vdf" type="VDF">
  <input name="absorption" type="color3" value="0.05, 0.05, 0.08" />
  <input name="scattering" type="color3" value="0.1, 0.12, 0.1" />
  <input name="anisotropy" type="float" value="0.3" />
</anisotropic_vdf>

<volumeshader name="volume_shader" type="volumeshader">
  <input name="vdf" type="VDF" nodename="vol_vdf" />
</volumeshader>

<volumematerial name="volume_material" type="material">
  <input name="volumeshader" type="volumeshader" nodename="volume_shader" />
</volumematerial>
```

Modifications requises:
1. `src/materialx/graph.ts` - accepter `volumeshader` comme terminal output
2. `src/materialx/surface-graph.ts` - ajouter résolition des volumeshaders
3. `src/materialx/surface-from-inputs.ts` - gérer les volumematerial
4. `src/compiler/ir.ts` - builder pour VDF closures
5. Tests: `tests/compiler/volume-lowering.test.ts`

### Option B : Activation des Volumes via Tokens (Quick Fix)

Modifier `volume_cube.mtlx` pour inclure des tokens détectables:

```xml
<disney_principled name="volume_surface" type="surfaceshader">
  <input name="baseColor" type="color3" value="1, 1, 1" />
  <!-- Add absorption and anisotropic_vdf tokens to trigger volume detection -->
  <input name="absorption" type="color3" value="0.05, 0.05, 0.08" />
  <input name="anisotropic_vdf" type="float" value="0.3" />
</disney_principled>
```

**Limitation :** Cela trigger la détection mais ne crée pas un vrai volume - juste des approximations surface transmission.

### Option C : Utiliser OpenPBR Volume (Medium Effort)

OpenPBR supporte les volumes via transmission + attenuation:

```xml
<open_pbr_surface name="volume_surface" type="surfaceshader">
  <input name="coat_weight" type="float" value="0" />
  <input name="transmission" type="float" value="1" />
  <input name="attenuation_color" type="color3" value="0.95, 0.95, 0.94" />
  <input name="attenuation_distance" type="float" value="1" />
</open_pbr_surface>
```

**État :** OpenPBR est supporté dans le compilateur mais les volumes OpenPBR ne sont pas spécifiquement lowered.

## Recommandation

**Implémenter Option A (Support Volumeshader Complet)** car :
- ✅ Aligne avec MaterialX standard
- ✅ Permet VDF compositions arbitraires
- ✅ Supporte les volumes hétérogènes 
- ✅ Cohérent avec path tracer + raster backends
- ⏳ Estimation : 3-5h pour PR complète avec tests

## Fichiers Test à Créer

- [x] `scenes/pathtracer/volume_cube_proper.mtlx` - MTLx avec volumeshader explicite
- [x] `scenes/pathtracer/volume_cube_proper.usda` - USDA correspondante
- [ ] `tests/compiler/volume-lowering.test.ts` - VDF + volumeshader composition
- [ ] `tests/materialx/volume-resolution.test.ts` - Graph resolution pour volumeshaders

## Status Implémentation

| Composant | Status | Blocker |
|-----------|--------|---------|
| Path Tracer Media | ✅ Complet | ❌ Aucun |
| Raster Ray Marching | ✅ Complet | ❌ Aucun |
| Feature Detection | ✅ Détecte VDF | ⚠️ Jamais générés |
| Graph Resolution | ⚠️ Surfaces seulement | ✅ Volumeshaders non supportés |
| VDF Lowering | ❌ N'existe pas | ✅ Architecture requise |
| Test Scenes | ❌ N'existe pas | ✅ MTLx avec volumeshader |

## Conclusion

**L'infrastructure est là, mais la chaîne de compilation s'arrête avant la VDF.** 

Les volumes ne rendent pas parce qu'aucune scène ne déclare un `volumeshader` ou ne compose un VDF, et le compilateur ne supporte pas encore ces constructs MaterialX standard. C'est une limitation du compilateur, pas du runtime.

Le fix est d'ajouter ~300-500 lignes de code compilateur pour supporter volumeshaders/volumematerials, exactement comme le système supporte déjà surfaceshaders/surfacematerials.
