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
| Nœuds de fermeture (`closure`) | BSDF/transport analytique évalué sur CPU | Forme close |
| Nœuds de texture (`texture`) | Échantillon unorm 8 bits décodé sur CPU | Quantifié 1/255 |
| Visibilité de scène | Lancer de rayon primaire + BVH, recoupé par un scan brute-force | Référence vs référence |
| Ombrage raster | `rasterShade` — miroir CPU fp64 du fragment `forwardOpaqueWgsl` | Forme close |
| Ombrage path tracing | `integratePath` — transport unidirectionnel non biaisé (NEE + MIS) | Référence non biaisée |
| Rendu GPU par nœud | GPU réel du mobile (T034) | Lecture arrière |
| Rendu GPU par scène | GPU réel du mobile (T035d) | Lecture arrière |

Les deux ombrages de scène partagent un **albédo diffus unique**
(`effectiveAlbedo = baseColor·(1−metalness)·(1−transmission)`) et une lumière
normalisée par `π`, si bien que leurs termes directs coïncident : leur seule
différence systématique est l'ambiant plat du raster (`0.03`) face à
l'environnement constant intégré par le path tracer (`0.05`).

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

# Validation GPU par nœud sur un mobile autorisé (T034).
# Démarre Vite, pilote Chrome via ADB/CDP, collecte le rapport, puis compare.
npm run test:device

# Validation GPU par scène sur un mobile autorisé (T035d).
# Même orchestration ; compare le raster GPU à l'oracle CPU partagé.
npm run test:scene-device
```

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
