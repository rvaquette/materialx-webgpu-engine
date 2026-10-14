# Méthodologie de validation

Ce document décrit comment le moteur est validé : la méthodologie de comparaison,
les sources d'oracle, les tolérances appliquées par type de nœud et par scène, les
cas qui ne sont pas reproductibles bit à bit, et la procédure d'exécution.

Il est la contrepartie lisible des fixtures et des tests :

- Tolérances (source de vérité unique) : [`tests/fixtures/tolerances.ts`](../tests/fixtures/tolerances.ts)
- Cas de nœuds et enveloppes : [`tests/fixtures/node-cases.ts`](../tests/fixtures/node-cases.ts)
- Scènes de contrôle déterministes : [`tests/fixtures/control-scenes.json`](../tests/fixtures/control-scenes.json)
- Matrice de conformité : [`docs/conformance.md`](conformance.md)

## Principe général

La validation repose sur une **comparaison oracle** : chaque sortie (une valeur de
nœud, un pixel raster, un pixel path-tracé) est confrontée à une référence calculée
indépendamment, et l'écart doit rester sous une tolérance déclarée.

Deux dimensions sont vérifiées séparément pour éviter de mélanger les sources
d'erreur :

1. **Exactitude du modèle** (CPU vs CPU) — la référence CPU est comparée à une
   seconde dérivation (forme close, transport non biaisé, ou implémentation naïve).
   Ces tests tournent sous Node, sans GPU, et sont donc déterministes et rejouables
   partout.
2. **Fidélité du GPU** (device vs oracle CPU) — le GPU réel du mobile évalue le même
   modèle sur des **entrées partagées** avec l'oracle, de sorte que le seul écart
   mesuré soit l'arithmétique fp32 du GPU face au fp64 du CPU, et non une différence
   de visibilité ou d'échantillonnage.

## Sources d'oracle

| Domaine | Oracle | Nature |
| --- | --- | --- |
| Nœuds d'expression (`expr`) | Fonction de référence en fp64 recalculée dans le test | Forme close |
| Nœuds de texture (`texture`) | Échantillon unorm 8 bits décodé sur CPU | Quantifié 1/255 |
| Fermetures par lobe (`closure`, T042) | `src/render/bsdf/reference.ts` — lobes BSDF/EDF/VDF analytiques fp64, **implémentation séparée du WGSL** | Forme close |
| Surface composée (T043) | `ref.evaluateSurface` — composition OpenPBR des lobes (5 lobes + 3 ops) en fp64 | Forme close |
| OpenPBR raster exécutable par scène (T045) | `ref.evaluateSurface` sur les échantillons de visibilité partagés | Forme close |
| Visibilité de scène | Lancer de rayon primaire + BVH, recoupé par un scan brute-force | Référence vs référence |
| Ombrage raster de scène-compare | `rasterShade` — miroir CPU Lambert simplifié (T035c) | Forme close |
| Ombrage path tracing | `integratePath` — transport unidirectionnel non biaisé (NEE + MIS) | Référence non biaisée |
| Rendu GPU par nœud / lobe / surface | GPU réel (T034/T042/T043) | Lecture arrière |
| Rendu OpenPBR GPU par scène | GPU réel (T045) | Lecture arrière |

> **Fin des oracles circulaires (P8).** Jusqu'à P8, les fermetures (`closure`)
> étaient comparées à des oracles qui reproduisaient les mêmes stubs
> `Closure(color·weight, weight)` que le WGSL : la validation était circulaire.
> La référence analytique indépendante de [`src/render/bsdf/reference.ts`](../src/render/bsdf/reference.ts)
> (T041) ré-implémente les formules **sans lire le WGSL**, de sorte que la
> comparaison device teste réellement l'arithmétique du shader et non une
> tautologie. Voir la section « Évaluation physique des fermetures (P8) ».

La comparaison **raster vs path tracing** par scène (T035c) partage un **albédo
diffus unique** (`effectiveAlbedo = baseColor·(1−metalness)·(1−transmission)`) et
une lumière normalisée par `π`, si bien que leurs termes directs coïncident : leur
seule différence systématique est l'ambiant plat du raster (`0.03`) face à
l'environnement constant intégré par le path tracer (`0.05`). Ce miroir Lambert
simplifié reste distinct du backend raster exécutable, dont le fragment exécute le
variant WGSL compilé du matériau et évalue sa `LayeredClosure` via la bibliothèque
de fermetures partagée (`mx_closure_eval`, T058), validée séparément contre
`ref.evaluateSurface`.

## Tolérances par type de nœud

Source : `NODE_TOLERANCE` dans [`tests/fixtures/tolerances.ts`](../tests/fixtures/tolerances.ts).
Tolérance absolue par composante, appliquée à la comparaison device vs oracle CPU
(T034) et aux évaluations par nœud.

| Classe d'exécution | Tolérance absolue | Justification |
| --- | --- | --- |
| `expr` | `2e-3` | Proche de l'ulp fp32 après une passe de calcul. |
| `closure` | `2e-3` | Idem, fermeture analytique. |
| `texture` | `1/255 + 1e-4` | Un texel unorm 8 bits : quantification pire cas `1/255`. |
| `graph` | `2e-3` | Jamais comparé à une lecture GPU (complétude). |
| `implicit` | `2e-3` | Idem. |
| `multi` | `2e-3` | Idem. |

Défaut défensif : `DEFAULT_NODE_TOLERANCE = 2e-3`.

## Tolérances par scène

Source : `SCENE_FOCUS_TOLERANCE` dans [`tests/fixtures/tolerances.ts`](../tests/fixtures/tolerances.ts).
Appliquée à la comparaison raster vs path tracing au niveau scène (T035c4). Une
scène peut déclarer plusieurs focus ; `sceneTolerance` retient la borne la plus
permissive par champ.

| Focus | `maxAbs` | `rmse` | Justification |
| --- | --- | --- | --- |
| `base` | `0.05` | `0.035` | Seul écart systématique : ambiant `0.03` vs environnement `0.05`, soit au pire `albédo·0.05 ≈ 0.04` côté ombre pour un albédo `0.8`. |
| `transmission` | `0.08` | `0.05` | Élargie : la référence diffuse omet la réfraction. |
| `subsurface` | `0.08` | `0.05` | Élargie : la référence diffuse omet la diffusion multiple. |

Défaut : `DEFAULT_SCENE_TOLERANCE = { maxAbs: 0.08, rmse: 0.05 }`.

La comparaison **GPU par scène** (T035d) est bien plus stricte (`2e-3` absolu) : la
visibilité et l'ombrage de référence sont partagés avec l'oracle, donc seule
subsiste la différence fp32 GPU vs fp64 CPU du même modèle raster.

## Tolérances des fermetures physiques (P8)

Depuis P8, les fermetures BSDF/EDF/VDF, les surfaces composées et le backend
raster exécutable sont évalués physiquement (voir plus bas) et comparés à la
référence analytique indépendante par cible GPU. Les bornes s'élargissent avec la
profondeur de composition fp32 avant la lecture arrière, et le mobile reçoit une
marge supplémentaire pour l'arrondi des `pow`/divisions des lobes spéculaires.

| Axe | Fixture | Local (Intel) | Mobile (Adreno) | Justification |
| --- | --- | --- | --- | --- |
| Lobe unique (T042) | `CLOSURE_TARGET_TOLERANCE` | `2e-3` | `4e-3` | Une évaluation microfacette GGX/Fresnel par lobe, un seul dispatch. |
| Surface composée (T043) | `SURFACE_TARGET_TOLERANCE` | `3e-3` | `6e-3` | 5 lobes + 3 ops de composition (2 mix + 1 layer) en fp32. |
| OpenPBR raster par scène (T045) | `SCENE_SURFACE_TARGET_TOLERANCE` | `4e-3` | `7e-3` | Métaux à faible rugosité (laiton, aluminium brossé) : le pic spéculaire GGX pousse la division par `N·V` et le `pow` Schlick. |

La cible est choisie automatiquement d'après l'adapter du rapport
(`deviceTargetOf` : `qualcomm|adreno|mali|arm|apple|powervr` → `mobile`).

## Évaluation physique des fermetures (P8)

Le correctif P8 (plan §9.5) remplace les stubs non physiques `Closure(color·weight,
weight)` du lowering initial (T014) par une évaluation réelle. Chaque lobe reçoit
la direction de lumière `L`, la vue `V` et la normale `N`, et intègre sa BRDF sur
les lumières de la scène plus un terme ambiant d'environnement. Les formules sont
ré-implémentées deux fois indépendamment : en WGSL
([`src/compiler/nodes.ts`](../src/compiler/nodes.ts) côté corpus,
[`src/render/raster/shaders.ts`](../src/render/raster/shaders.ts) côté backend
exécutable) et en TypeScript fp64 comme oracle
([`src/render/bsdf/reference.ts`](../src/render/bsdf/reference.ts)).

Conventions d'éclairage partagées : `L = normalize(−direction)`,
`radiance = color·intensity`, terme ambiant `= terme·environment` ajouté une fois
par lobe.

| Fermeture | Modèle | Limites déclarées |
| --- | --- | --- |
| `oren_nayar_diffuse_bsdf`, `burley_diffuse_bsdf` | Diffus rugueux (Oren-Nayar / Burley), tête-bêche → `1/π` | — |
| `dielectric_bsdf` | Microfacette GGX : distribution GGX, Smith séparable, Fresnel diélectrique, `F·D·G/(4·N·V)` | Réflexion directe ; réfraction complète au path tracer |
| `conductor_bsdf` | GGX + Fresnel conducteur (ior/extinction complexes) | — |
| `generalized_schlick_bsdf` | GGX + Fresnel Schlick `F0`/`F90` (workflow métallique `F0 = baseColor`) | — |
| `sheen_bsdf` | NDF Charlie + Fresnel | — |
| `translucent_bsdf` | Transmission diffuse (hémisphère opposé) | — |
| `subsurface_bsdf` | Approximation raster : repli diffus `w = 0.5` | BSSRDF non biaisé réservé au path tracer (`subsurface.ts`) |
| `uniform_edf` | Émission `Closure(color, 0)` (ne bloque pas) | — |
| `generalized_schlick_edf` | Émission à facteur Schlick directionnel `pow(1−N·V, 5)` entre `color0`/`color90` | — |
| `anisotropic_vdf` | Single-scattering à profondeur optique unité, phase Henyey-Greenstein | Transport volumique complet réservé aux milieux P6 / raster T025 |
| `chiang_hair_bsdf` / `simple_hair` | Stub documenté (pas de miroir analytique raster) | Modèle cheveux exact au path tracer uniquement |

Composition énergétique : `mx_layer` couple la base par le throughput du dessus
(`1 − reflectance`) et composite la couverture ; `mx_closure_mix`/`add`/`multiply`
émettent la réflectance pondérée. La surface composée assemble un workflow
métallique (`F0 = baseColor` via Schlick) et un spéculaire diélectrique en couche
sur une base diffus/transmission/subsurface : construite par la `LayeredClosure`
de l'IR et évaluée via `mx_closure_eval`, en miroir exact de `ref.evaluateSurface`.

Le path tracer ajoute pour chaque lobe un triplet cohérent `eval`/`pdf`/`sample`
([`src/render/pathtracing/bsdf.ts`](../src/render/pathtracing/bsdf.ts), T044),
validé par des tests intrinsèques (white furnace, accord eval/pdf, estimateur non
biaisé) sans réutiliser l'oracle raster.

### Backend path tracer : mégakernel sur l'IR (T057)

Le backend path tracer GPU ([`src/render/pathtracing/compute.ts`](../src/render/pathtracing/compute.ts))
ne porte plus de bloc de surface « sept paramètres » en dur. Le mégakernel
reconstruit à chaque impact la `LayeredClosure` depuis l'enregistrement matériau
compacté (157 floats, [`src/render/pathtracing/material-record.ts`](../src/render/pathtracing/material-record.ts),
T057b/c) puis l'évalue via la **bibliothèque de fermetures partagée**
([`src/compiler/closure-library.ts`](../src/compiler/closure-library.ts),
[`src/compiler/surface-wgsl.ts`](../src/compiler/surface-wgsl.ts), T056) —
exactement la même pile que le raster, l'IR du compilateur étant la source
d'ombrage unique. Le packing CPU (`createSceneSampler` ré-évalue
`layeredSurfaceBsdf`) et le lecteur WGSL partagent le même layout, de sorte que
l'oracle CPU et le shader device ne divergent que par l'arithmétique fp32.

L'intégrateur applique le MIS complet (heuristique de puissance) entre
l'échantillonnage de lumière et l'échantillonnage BSDF, en miroir de
`integratePath` : la lumière distante directionnelle reste une **delta** (poids 1,
sans contrepartie BSDF), tandis que l'environnement constant combine une
next-event estimation en cosinus et la capture par échantillonnage BSDF via la
pondération `power_heuristic` (T057e). La parité numérique cross-backend du
mégakernel reste couverte par le harnais device (T059).

### Backend raster : ombrage sur l'IR (T058)

Le backend raster converge vers la même source d'ombrage que le path tracer :
plutôt qu'un bloc OpenPBR écrit à la main (retiré en T058f), le fragment
exécute le variant WGSL compilé du matériau — `mx_shade` (IR → `LayeredClosure`,
[`src/compiler/wgsl.ts`](../src/compiler/wgsl.ts),
[`src/compiler/surface-wgsl.ts`](../src/compiler/surface-wgsl.ts)) — puis évalue
la fermeture obtenue contre l'unique lumière directionnelle et l'environnement
constant via la **bibliothèque de fermetures partagée** (`mx_closure_eval`,
[`src/compiler/closure-library.ts`](../src/compiler/closure-library.ts), T056),
c'est-à-dire exactement le terme direct que le mégakernel path tracer calcule par
rebond. L'IR du compilateur devient ainsi la source d'ombrage unique des deux
backends.

Approximations raster déclarées : éclairage **direct uniquement** (un échantillon
par lumière, pas de next-event estimation ni de MIS multi-rebonds), **pas
d'ombres**, environnement **constant**. Côté uniformes, le bloc frame
(`model`/`viewProj`/`eye`/lumière/environnement) est séparé des `MxUniforms`
matériau émis par le variant (`@group(0) @binding(0)`) et déplacé sur son propre
binding ; un pipeline est compilé par variant de matériau (clé `pipelineKey`).

Le bloc OpenPBR écrit à la main (`openPbrSurfaceWgsl`/`forwardOpaqueWgsl`/
`sceneForwardWgsl`) a été **retiré** en T058f2 : l'oracle analytique du raster est
désormais directement `ref.evaluateSurface`
([`src/render/bsdf/reference.ts`](../src/render/bsdf/reference.ts)). Le câblage est
livré par la série T058b-e. La **parité source-IR raster ↔ path tracer** — les deux
backends dérivent le terme direct de la même `LayeredClosure` via la même pile
`mx_closure_eval` — est prouvée par
[`tests/render/raster/ir-parity.test.ts`](../tests/render/raster/ir-parity.test.ts)
(T058f1) : parité structurelle des WGSL émis (même struct `LayeredClosure`, même
appel `mx_closure_eval`, raster sans lancer d'ombre) et parité numérique CPU via
l'oracle partagé. La validation **device** (local + mobile, WebGPU indisponible sous
Node) est câblée en T059 (voir « Parité device des familles BxDF »).

### Parité device des familles BxDF (T059)

P10 ferme la boucle sur le GPU réel : chaque famille de surface avancée est rendue
**sur le device** par les deux backends depuis la **sortie unique du compilateur**,
puis comparée à l'oracle analytique indépendant. Le harnais
([`tests/render/bxdf-device.harness.ts`](../tests/render/bxdf-device.harness.ts),
T059c) reconstruit pour chaque cas de
[`tests/fixtures/bxdf-families.ts`](../tests/fixtures/bxdf-families.ts) la
`LayeredClosure` depuis l'enregistrement matériau compacté
(`packLayeredMaterial` → `mx_material_closure`,
[`src/render/pathtracing/material-record.ts`](../src/render/pathtracing/material-record.ts))
et l'évalue via la bibliothèque de fermetures partagée
(`mx_closure_eval`, [`src/compiler/closure-library.ts`](../src/compiler/closure-library.ts),
[`src/compiler/surface-wgsl.ts`](../src/compiler/surface-wgsl.ts)). Deux passes
compute dérivent le terme direct dans les deux conventions — raster `max(N·L, 0)`
et path tracer `|N·L|` — chacune augmentée d'un échantillon d'environnement
constant, sur des frames et une lumière **partagés avec l'oracle**
(`BXDF_DEVICE_GEOMS` / `BXDF_DEVICE_LIGHT`). Le seul écart mesuré reste donc
l'arithmétique fp32 du GPU face au fp64 CPU de
[`src/render/bsdf/reference.ts`](../src/render/bsdf/reference.ts) (`referenceClosureDirect`).

Le test [`tests/render/bxdf-device.test.ts`](../tests/render/bxdf-device.test.ts)
compare `raster[]` et `pathtracing[]` de chaque famille à l'oracle via
`compareSignals` et vérifie l'accord raster ↔ path tracer ; il se **skippe**
proprement quand le rapport est vide. Deux orchestrateurs produisent ce rapport,
tous deux servant [`bxdf-device-harness.html`](../bxdf-device-harness.html) et
collectant `__MX_BXDF_REPORT__` via CDP :

- **Local (poste de dev)** — [`scripts/run-local-bxdf.mjs`](../scripts/run-local-bxdf.mjs)
  (`npm run test:local-bxdf`) pilote Chrome WebGPU sans adb.
- **Mobile (cible Adreno 7xx)** — [`scripts/run-bxdf-device.mjs`](../scripts/run-bxdf-device.mjs)
  (`npm run test:bxdf-device`) pilote Chrome Android via ADB/CDP ; sans appareil
  autorisé il réécrit un rapport vide et la suite se skippe.

Les tolérances par famille (`BXDF_FAMILY_TARGET_TOLERANCE`,
[`tests/fixtures/tolerances.ts`](../tests/fixtures/tolerances.ts)) sont choisies
automatiquement d'après l'adapter du rapport (`deviceTargetOf` → `local`/`mobile`),
sans logique de test dédiée :

| Famille | Local | Mobile (Adreno) | Justification |
| --- | --- | --- | --- |
| `standard_surface`, `open_pbr_surface`, `disney_principled` | `5e-3` | `8e-3` | Surface composée (diffus + spéculaire diélectrique + couche) en fp32. |
| `gltf_pbr`, `UsdPreviewSurface` | `4e-3` | `7e-3` | Workflow métallique Schlick plus plat, moins de composition. |
| `lama_assembly`, `procedural_nodegraph` | `6e-3` | `9e-3` | Assemblages profonds de lobes + arrondi d'interpolation texture/expression. |

Le mobile reçoit ~`3e-3` de marge supplémentaire sur les arrondis `pow`/division
des lobes spéculaires, comme pour les bornes par lobe et par scène.

**Approximations raster restantes** (déclarées, identiques à T058) : éclairage
**direct uniquement** (un échantillon par lumière, pas de next-event estimation ni
de MIS), **pas d'ombres**, environnement **constant**. Au-dessus de l'horizon,
les termes directs raster `max(N·L, 0)` et path tracer `|N·L|` coïncident et
matchent l'oracle ; sous l'horizon seul le path tracer prolonge le transport.
Le run device réel (local et mobile) reste une étape **manuelle** ; le rapport
committé [`tests/render/bxdf-device-report.json`](../tests/render/bxdf-device-report.json)
est vide pour garder `npm test` déterministe.

### Scènes couvertes (raster + path tracing)

`standard_surface_default`, `standard_surface_glass`, `standard_surface_jade`,
`open_pbr_default`, `open_pbr_glass`, `disney_principled_default`,
`disney_principled_glass`, `gltf_pbr_default`, `gltf_pbr_glass`,
`usd_preview_surface_default`.

## Cas non reproductibles

Certains nœuds abaissent vers un hachage fp chaotique (`fract(sin(x)·k)`). Le fp32
du GPU et le fp64 du CPU ne peuvent pas coïncider bit à bit ; ces cas sont donc
validés par **enveloppe** (valeur finie et comprise dans `[min, max]`) plutôt que
par égalité. Ils portent `reproducible: false` et une `envelope` dans
[`tests/fixtures/node-cases.ts`](../tests/fixtures/node-cases.ts) ; le prédicat
`isEnvelopeCase` les aiguille vers ce mode.

| Nœud | Enveloppe | Raison |
| --- | --- | --- |
| `fractal3d` (amplitude 1.0, 3 octaves) | `[0, 1.75]` | Bruit `fract(sin)` : non reproductible fp32/fp64 ; borné par la somme des amplitudes. |

L'enveloppe `[0, 1.75]` correspond à la somme des amplitudes des octaves : le bruit
ne peut sortir de cet intervalle, ce qui reste vérifiable même sans accord numérique
exact.

## Procédure d'exécution

```powershell
# Vérification de types stricte
npm run typecheck

# Suite complète sous Node (déterministe, sans GPU).
# Les comparaisons device sautent proprement si aucun rapport n'est présent.
npm test

# Validation GPU locale (poste de dev, Chrome WebGPU via CDP, sans adb).
npm run test:local-gpu      # par nœud + lobes + surfaces (T034/T042/T043)
npm run test:local-scene    # OpenPBR par scène (T045)
npm run test:local-bxdf     # familles BxDF, deux backends (T059)

# Validation GPU sur le mobile cible autorisé (confirme le GPU réel).
# Démarre Vite, pilote Chrome via ADB/CDP, collecte le rapport, puis compare.
npm run test:device         # par nœud + lobes + surfaces (T034/T042/T043)
npm run test:scene-device   # OpenPBR par scène (T045)
npm run test:bxdf-device    # familles BxDF, deux backends (T059)
```

## Résultats des runs GPU (dernière exécution)

Les fermetures physiques P8 sont validées sur deux cibles : le GPU local du poste
de développement (pendant permanent des tests CPU) et le mobile Android cible
(confirmation sur le GPU réel visé). Dernière double exécution :

| Cible | Adapter | Navigateur | OS | Par nœud (T034) | Lobes (T042) | Surfaces (T043) | OpenPBR scène (T045) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Locale | Intel `gen-12lp` | Chrome 154 (WebGPU, CDP) | Windows (NT 10.0, x64) | 27/27 | 11/11 @ `2e-3` | 6/6 @ `3e-3` | 47/47 @ `4e-3` |
| Mobile | Qualcomm `adreno-7xx` (SM-F731B, `R5CW900CHQD`) | Chrome 154 Mobile | Android 10 | 27/27 | 11/11 @ `4e-3` | 6/6 @ `6e-3` | 47/47 @ `7e-3` |

Les deux cibles passent sans erreur. Les rapports committés
([`tests/render/device-report.json`](../tests/render/device-report.json),
[`tests/render/scene-device-report.json`](../tests/render/scene-device-report.json))
conservent la dernière exécution mobile ; le run local reproduit les mêmes résultats
avec les bornes `local` plus strictes.

### Saut propre sans mobile

Les tests device consomment un rapport JSON committé vide
([`tests/render/device-report.json`](../tests/render/device-report.json),
[`tests/render/scene-device-report.json`](../tests/render/scene-device-report.json)).
Lorsqu'aucun mobile autorisé n'est détecté, l'orchestrateur réécrit un rapport vide
et le test se **skippe** avec une raison documentée, au lieu de passer en silence.
Un run réel sur device remplit temporairement le rapport ; l'état committé reste
vide pour garder `npm test` déterministe.

### Pré-requis pour un run device

- Mobile avec débogage USB autorisé et un navigateur WebGPU (Chrome).
- ADB disponible (par défaut `D:\platform-tools\adb.exe`, surchargé par `MX_ADB`).
- Port du serveur Vite surchargé par `MX_PORT` (défaut `5173`).

## Validation bout-en-bout par scène (T053a)

Première passe de validation de bout en bout sur **une seule scène réelle**,
`scenes/test_material_disney_gold/test_material_disney_gold.usda` (OpenPBR
MaterialX, convertie depuis le corpus GLSL-PathTracer). Elle prépare le terrain
pour la validation complète T053 (scène de référence + scène tierce + mobile).

Le run est piloté par
[`scripts/validate-disney-gold.ts`](../scripts/validate-disney-gold.ts) et rejoue
la chaîne d'exécution réelle sur les **mêmes assets** :
`importUsdStage` (chargement composé) → `importLights`/`importCameras` →
`buildSceneResources` (géométrie + BLAS, instances + TLAS, surfaces MaterialX) →
`buildSceneFrame` (raster) **et** `buildPathTraceScene` (path tracing) dérivés
d'un **unique** `SceneResources`, recoupés par `compareSceneBackends`. La scène
étant un artefact local non versionné, ce run n'est pas un test committé : il
s'exécute à la demande et écrit un rapport JSON sous
[`docs/generated/t053a-disney-gold.json`](generated/t053a-disney-gold.json).

```powershell
# Node >=23.6 ne supporte pas les parameter properties de l'importateur en mode
# strip-only ; le run passe par vite-node (transpilation complète, fournie par vitest).
npm run validate:scene
```

### Chargement composé

| Mesure | Valeur |
| --- | --- |
| Prims composés | 13 (1 racine `/World`) |
| Meshes | 3 — `cube`, `sphere`, `ground` |
| Matériaux MaterialX | 2 — `gold`, `ground` (OpenPBR, liés sans résidu) |
| Caméra | 1 — `mainCamera` (perspective) |
| Lumières | 2 — `SphereLight` + `RectLight` |

Le stage composé expose les 3 meshes avec leur géométrie inline (points /
`faceVertexCounts` / `faceVertexIndices`), les deux matériaux OpenPBR résolus
depuis `gold.mtlx` / `ground.mtlx`, la caméra et les deux lumières. Aucune
géométrie ni aucun matériau n'est resté en attente, et aucun gprim n'est non lié.

### Diagnostics des fonctionnalités non prises en charge

Rien n'est abandonné en silence (REQ-013). Pour cette scène :

| Niveau | Diagnostic |
| --- | --- |
| info | `SphereLight` (`/World/Lights/light_0`) approximée en lumière directionnelle par le backend exécutable. |
| info | `RectLight` (`/World/Lights/light_1`) approximée en lumière directionnelle par le backend exécutable. |

Les lumières d'aire sont **reconnues et importées** (`importLights` les mappe en
`sphere`/`rect` avec leur transform et leurs paramètres de forme), mais les deux
backends exécutables en ligne (`directionalLightFrom`) les réduisent pour l'instant
à une unique lumière directionnelle dominante. L'échantillonnage de surface des
lumières d'aire relève du path tracer complet (P9+). Les autres arcs non pris en
charge (payloads/crate binaires) ne concernent pas cette scène 100 % USDA + MaterialX.

### Rendu des deux backends sur les mêmes assets

| Mesure | Valeur |
| --- | --- |
| Géométries / instances | 3 / 3 |
| Triangles (géométrie préparée) | 974 |
| Draws raster | 3 |
| Triangles path tracing | 974 |
| Surfaces OpenPBR partagées | 2 |
| Caméra partagée (viewProj + eye) | oui |
| Lumière dominante partagée | oui |
| Accord vérité-terrain diffuse (probe) | oui (`maxAbs = 0`) |

Les deux backends consomment le **même** `SceneResources` : ils voient le même
nombre de triangles (974), la même caméra, la même lumière dominante, et les deux
mêmes surfaces OpenPBR — sans ré-import. Le recoupement Lambert à incidence normale
(référence raster `src/render/bsdf/reference.ts` vs fermeture du path tracer
`src/render/pathtracing/bsdf.ts`) coïncide exactement (`maxAbs = 0`).

### Mesures (poste local)

| Étape | Temps indicatif |
| --- | --- |
| Chargement composé (`importUsdStage`) | ~60 ms |
| Import lumières + caméras | ~4 ms |
| `buildSceneResources` (géo + BLAS + TLAS + matériaux) | ~91 ms |
| Rendu CPU (frame raster + scène PT + recoupement) | ~60 ms |
| **Total** | **~216 ms** |

| Mémoire (buffers path tracing) | Taille |
| --- | --- |
| Nœuds BVH | 24,0 Kio |
| Soupe de triangles | 91,3 Kio |
| Matériaux | 0,1 Kio |
| **Total GPU-upload PT** | **115,4 Kio** |

> **Frontière Node vs GPU (honnête).** Node n'expose pas WebGPU : ce run mesure la
> chaîne **CPU** (parsing, composition, construction des ressources, oracle de
> rendu) et la **taille des buffers** qui seraient téléversés au GPU. Les temps
> sont indicatifs (ils incluent la transpilation à froid de vite-node) et la
> mesure de tas (`heapUsed`) est bruitée par le GC — la métrique mémoire fiable est
> la taille des buffers. Les temps de compilation de shader, de rendu et
> d'occupation VRAM **réels sur le GPU local** passent par le harnais device
> navigateur ([`scene-device-harness.html`](../scene-device-harness.html),
> `npm run test:scene-device`) et sont couverts par la validation complète T053.

### Aperçu CPU path-tracé (PNG)

Pour disposer d'un **aperçu visuel immédiat** sans attendre le GPU, le run écrit
aussi une image PNG path-tracée sur CPU dans `renders/t053a-disney-gold.png`
(artefact local non versionné, comme la scène). Elle rejoue la géométrie, les
matériaux OpenPBR et la soupe de triangles **réels** de la scène via le même
intégrateur que le path tracer (`integratePath` + `createSceneSampler`), avec une
génération de rayon caméra **identique à la fonction WGSL** `camera_ray`
(dé-projection `invViewProj` colonne-major, NDC WebGPU `z ∈ [0,1]`).

Deux ajustements **propres à l'aperçu** (ils ne modifient pas la chaîne de
validation ni le recoupement des backends) assurent la lisibilité :

- une **caméra d'aperçu** cadrée sur le sujet (œil à ~7 u, cible `(0, 0.3, 0)`) ;
- un **environnement neutre** `[0.6, 0.6, 0.6]` en remplacement de l'environnement
  quasi-noir de la scène, afin que l'or métallique pur réfléchisse un studio
  visible plutôt qu'un fond noir.

La fidélité réelle (compilation de shader, rendu et VRAM sur le GPU) reste couverte
par le harnais device T053.

### Aperçu raster CPU (PNG)

Le backend raster est **GPU uniquement** dans le navigateur ; pour qu'il produise
néanmoins **sa propre image** sous Node, le run écrit un second PNG
`renders/t053a-disney-gold-raster.png` (artefact local non versionné) via un
**rasteriseur logiciel CPU** ([`src/render/raster/cpu-raster.ts`](../src/render/raster/cpu-raster.ts)).
Il consomme **exactement le même plan de frame** (`buildSceneFrame`) que le backend
GPU — mêmes `SceneResources`, même caméra, même lumière dominante, même
environnement — et transforme les triangles **comme le path tracer** (`transformPoint`
pour les positions, `transformDirection` + normalisation pour les normales). Le
pipeline est un rasteriseur classique à **fonctions d'arête** avec **tampon de
profondeur** et interpolation d'attributs **corrigée par la perspective** (transform
de clip colonne-major, NDC WebGPU `z ∈ [0,1]`) ; chaque pixel couvert est ombré par
**le même BSDF OpenPBR de référence** (`evaluateSurface`) sous la lumière
directionnelle et l'environnement de la frame.

Pour une comparaison directe **raster CPU vs path-trace CPU**, l'aperçu raster
réutilise la **même caméra d'aperçu** et le **même environnement neutre**
`[0.6, 0.6, 0.6]` : les deux PNG cadrent et éclairent le sujet à l'identique. Le
raster affiche l'ombrage **analytique direct** (lumière + ambiant, sans réflexions),
là où le path tracer ajoute les réflexions multi-rebonds — chaque méthode est
correcte pour son modèle. Le module est pur et testé sous Node
([`tests/render/cpu-raster.test.ts`](../tests/render/cpu-raster.test.ts) : projection,
couverture, ombrage de référence au centre, déterminisme, tampon de profondeur).

La fidélité raster réelle sur le GPU reste couverte par le harnais device T053.

### Correctif moteur : racine BVH à l'index 0

L'aperçu a révélé un **bug de corrélation d'index** latent dans le constructeur
BVH ([`src/geometry/bvh.ts`](../src/geometry/bvh.ts)) : `buildCore` allouait les
nœuds en **post-ordre**, plaçant la racine en **dernière** position du tableau,
alors que **les deux traversées** (CPU `scene-buffers.ts` et WGSL `compute.ts`)
démarrent la pile au nœud **0**. Sur les scènes à un seul nœud (≤ 4 triangles,
utilisées par les tests CPU unitaires) la racine était fortuitement à l'index 0,
masquant le défaut ; dès que la scène produisait un BVH multi-nœuds (comme les
974 triangles de disney gold), la traversée partait d'un nœud feuille arbitraire
et manquait la majorité de la géométrie.

Le correctif réalloue les nœuds en **pré-ordre** (réservation du slot parent avant
la récursion des enfants) pour que la **racine soit toujours à l'index 0**, et
inverse les passes de `refit` (ordre descendant : les enfants, d'index supérieur,
sont rafraîchis avant leurs parents). Il corrige **simultanément** les chemins CPU
et GPU. Les 787 tests restent verts (`tests/geometry/bvh.test.ts` n'assertait que
`nodes.length`, l'ordre des triangles et les bornes, jamais l'index racine ; le
helper de traversée `tests/render/scene-samples.ts` démarre désormais au nœud 0).

