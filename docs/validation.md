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
simplifié reste distinct du backend raster exécutable, dont le fragment
`forwardOpaqueWgsl` évalue désormais la composition OpenPBR complète (T045),
validée séparément contre `ref.evaluateSurface`.

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
émettent la réflectance pondérée. La surface composée `mx_openpbr_surface` assemble
un workflow métallique (`F0 = baseColor` via Schlick) et un spéculaire diélectrique
en couche sur une base diffus/transmission/subsurface, en miroir exact de
`ref.evaluateSurface`.

Le path tracer ajoute pour chaque lobe un triplet cohérent `eval`/`pdf`/`sample`
([`src/render/pathtracing/bsdf.ts`](../src/render/pathtracing/bsdf.ts), T044),
validé par des tests intrinsèques (white furnace, accord eval/pdf, estimateur non
biaisé) sans réutiliser l'oracle raster.

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

# Validation GPU sur le mobile cible autorisé (confirme le GPU réel).
# Démarre Vite, pilote Chrome via ADB/CDP, collecte le rapport, puis compare.
npm run test:device         # par nœud + lobes + surfaces (T034/T042/T043)
npm run test:scene-device   # OpenPBR par scène (T045)
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
