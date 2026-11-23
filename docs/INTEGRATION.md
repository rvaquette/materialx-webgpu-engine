# Intégration, capacités et limites

Ce document complète [ENGINE_API.md](ENGINE_API.md) (contrat de l'API) pour un
usage en production : ce que le moteur demande au GPU, comment il réagit quand
une limite est atteinte, et comment diagnostiquer un problème. Principe commun :
une limite ou un échec prévisible produit un diagnostic avec un `code` stable,
ou rejette la promesse de l'opération ; il n'est jamais converti silencieusement
en image incomplète.

## Intégrer le moteur

```ts
import { MaterialXEngine } from 'materialx-webgpu-engine';

const engine = await MaterialXEngine.create(canvas, {
  runtimeAssets: { materialxCore: '/engine-assets/core/', materialxLibraries: '/engine-assets/libraries/' },
  streaming: true,                 // scènes partielles pendant le chargement
  memoryBudget: 512 * 2 ** 20,     // octets
  telemetry: true,                 // mesures locales, lues par engine.telemetry()
  onDiagnostic: d => console.log(d.code ?? '', d.message),
  onDeviceLost: ({ recovery }) => recovery.then(ok => console.log(ok ? 'restauré' : 'perdu')),
});
if (!engine.capabilities.backends.pathtracing.supported) {
  console.warn(engine.capabilities.backends.pathtracing.reason);
}
await engine.loadUsd('/scenes/scene.usda');
await engine.render({ backend: 'pathtracing' });
```

- L'hôte sert les fichiers d'exécution MaterialX (JsMaterialXCore et
  bibliothèques) et OpenUSD (couches binaires) ; `runtimeAssets` donne leurs URL.
- Le moteur demande l'adaptateur `high-performance` et, au périphérique, les
  limites maximales de l'adaptateur pour le stockage, les textures et les
  échantillonneurs, ainsi que `timestamp-query` quand il existe. Un périphérique
  fourni par `options.device` est utilisé tel quel.
- `engine.capabilities` décrit l'adaptateur, ses fonctionnalités, les limites
  utiles et, pour chaque backend, s'il peut fonctionner et pourquoi sinon.
- Le rendu hors écran (`createHeadless`, `capture`) produit des images
  reproductibles : il n'utilise ni streaming ni repli de backend.

## Exigences par backend

| Backend | Limites minimales vérifiées à la création | Limites dépendant de la scène (vérifiées à la construction) |
|---|---|---|
| Raster | `maxBindGroups` ≥ 4, `maxTextureDimension2D` ≥ 2048 | textures et échantillonneurs par étape, taille des textures |
| Path tracing | `maxBindGroups` ≥ 4, `maxStorageBuffersPerShaderStage` ≥ 7, groupes de travail 8×8 | 7 tampons de stockage + 1 par lumière analytique, volume et environnement ; taille de chaque tampon (`maxStorageBufferBindingSize`, `maxBufferSize`) ; textures par étape ; couches de tableaux de textures |
| Disney | `maxBindGroups` ≥ 2, `maxStorageBuffersPerShaderStage` ≥ 2, `maxTextureArrayLayers` ≥ 16, groupes de travail 8×8 | taille des textures de géométrie et de matériaux, tampons d'accumulation et de lumières, dimension des dispatchs |

Toutes les limites WebGPU par défaut satisfont les minimums ; les limites
dépendant de la scène peuvent ne pas l'être (par exemple 9 tampons de stockage
pour une scène avec lumières analytiques et volume, contre 8 par défaut).

## Politiques de repli

- **Backend au-delà d'une limite.** Une `GpuLimitError` pendant la
  construction du path tracer ou du backend Disney produit le diagnostic
  `backend-fallback` (limite, valeur demandée et disponible dans `detail`) ;
  les images interactives sont rendues en raster et `EngineStatus.fallback`
  indique la raison. `capture({ backend: 'pathtracing' })` rejette sa promesse
  avec la même erreur : une capture ne change jamais de backend.
- **Texture trop grande.** Une image plus grande que `maxTextureDimension2D`
  est divisée par deux (filtre 2×2) jusqu'à tenir ; chaque réduction produit
  `texture-downscaled`. Les tuiles UDIM sont réduites de la même façon.
- **Shader ou pipeline invalide.** `onShaderErrors` et les diagnostics
  `shader-compilation` (avec ligne et colonne WGSL) ou `backend-preparation`.

## Budget mémoire GPU

WebGPU n'expose pas la mémoire utilisée. Le moteur intercepte `createBuffer` et
`createTexture` sur son périphérique et additionne les octets des ressources
vivantes (toutes les mips, couches et échantillons), retirées à `destroy()` ou
au ramasse-miettes. Les surcoûts du pilote (alignements, pipelines, swapchain)
ne sont pas comptés. `engine.gpuMemory` donne les octets des tampons, des
textures, le total, le pic, le budget et la taille maximale courante des
textures de matériaux.

Quand le total dépasse `memoryBudget` (vérifié après chaque chargement et à
chaque allocation qui franchit le budget), le moteur applique dans l'ordre :

1. **Réduction des textures** : la taille maximale des textures de matériaux
   est divisée par deux (jusqu'à 256 px) et le jeu de rendu reconstruit sans
   relire l'USD ; diagnostic `memory-budget-reduced` (et `texture-downscaled`,
   niveau `info`, par texture) ;
2. **Repli raster** : le path tracer ou le backend Disney est libéré et les
   images sont rendues en raster (`backend-fallback`, `EngineStatus.fallback`),
   sauf pendant une capture ;
3. **Signalement** : `memory-budget-exceeded` (niveau `error`) si le total
   reste au-dessus du budget.

Mesure (`diningroom`, raster 128², budget 40 Mio) : textures 93,2 → 6,0 Mio,
total 201,1 → 113,9 Mio ; la géométrie et les tampons de rendu restant au-dessus
du budget, `memory-budget-exceeded` est émis et l'image reste complète.

## Streaming

Avec `streaming: true` (moteur sur canvas, application), le chargement affiche
des scènes partielles de qualité croissante. `loadUsd()` se résout toujours sur
la scène complète, et `EngineStatus.loading` décrit l'étape affichée :

| Étape | Contenu |
|---|---|
| `geometry` | maillages préparés jusque-là (cache de géométrie compris) et boîtes englobantes des autres, surfaces neutres grises |
| `textures` | géométrie et matériaux complets ; textures (512 px au plus) arrivant une à une, tuiles UDIM comprises |

- **Géométrie.** Les fichiers de géométrie externes sont téléchargés ensemble ;
  leur empreinte (clé du cache de géométrie) n'est calculée qu'au besoin. Une
  boîte englobante remplace chaque maillage non encore préparé : sommets des
  maillages USD, ou balayage des lignes `v` d'un fichier OBJ (par objet
  `o`/`g`), sans analyser les faces. Les aperçus de cette étape utilisent un
  seul pipeline neutre : les pipelines des matériaux dépendent du format de
  sommets de chaque maillage et ne sont compilés qu'une fois la géométrie
  complète.
- **Ordonnancement.** Le premier aperçu est demandé 200 ms après le début du
  chargement (les chargements plus courts n'en ont pas) ; la préparation des
  maillages et le démarrage du runtime MaterialX, dont le travail synchrone
  retarderait l'affichage, attendent qu'il soit présenté (500 ms au plus pour
  la géométrie, 1 s pour MaterialX). Ensuite, un aperçu au plus par seconde, et
  jamais plus souvent que vingt fois le coût du précédent.
- **Textures.** Elles se décodent en arrière-plan (4 à la fois) une fois la
  géométrie complète, pour ne pas concurrencer ses téléchargements. Si elles ne
  sont pas toutes prêtes 300 ms plus tard, la scène complète s'affiche avec des
  substituts, remplacés au fur et à mesure : gris moyen pour une texture de
  couleur sRGB, normale plate (0,5 ; 0,5 ; 1) pour une texture de données ; une
  tuile UDIM manquante prend la taille des tuiles déjà décodées. Cet aperçu
  utilise les pipelines du rendu final.
- Non concernés : scènes précompilées (`scene.json`), rendu hors écran,
  backend Disney. Sans caméra dans la scène, le cadrage est recalculé sur la
  scène complète.

Mesures : voir [ROADMAP_DONE.md](ROADMAP_DONE.md#priorité-7--robustesse-portabilité-et-exploitation)
et `npm run bench:streaming`.

## Perte du périphérique

- **Périphérique créé par le moteur** : diagnostic `device-lost`, puis
  nouveau périphérique (trois tentatives), reconfiguration du canvas et
  restauration de la scène : entrée, sélections de variants, temps, caméra,
  matériaux remplacés, paramètres modifiés, transformations, visibilités et
  lumières modifiées, réglages de rendu. Diagnostic `device-restored`, ou
  `device-recovery-failed` si la restauration échoue (l'instance devient alors
  inutilisable). Pendant la restauration, les opérations sont refusées avec
  une erreur explicite. `onDeviceLost` reçoit une promesse `recovery`.
- **Périphérique fourni par l'appelant** : `device-lost` puis
  `device-recovery-failed` ; l'appelant crée un nouveau moteur.
- **Application** : même restauration ; les modifications de graphe faites
  dans l'éditeur de matériaux ne sont pas conservées.

Vérifié dans Chrome headless en tuant le processus GPU du navigateur : le
moteur reçoit `device-lost`, recrée le périphérique, recharge la scène
(`device-restored`) et reprend le rendu en environ 1 s sur l'exemple du
triangle.

## Diagnostics structurés

`engine.diagnostics` conserve les 1000 derniers diagnostics (date ISO, niveau,
message, `code`, `detail` converti en JSON, emplacement WGSL pour les erreurs de
shader). `engine.exportDiagnostics()` renvoie un document JSON :

```json
{
  "format": "materialx-webgpu-diagnostics", "version": 1, "exportedAt": "…", "userAgent": "…",
  "scene": "…", "backend": "raster", "deviceLost": false,
  "capabilities": { "adapter": {}, "features": [], "limits": {}, "backends": {} },
  "gpuMemory": { "buffers": 0, "textures": 0, "total": 0, "peak": 0, "textureLimit": 16384 },
  "droppedDiagnostics": 0,
  "diagnostics": [{ "time": "…", "level": "warning", "code": "backend-fallback", "message": "…", "detail": {} }]
}
```

L'application propose le même export avec le bouton **Exporter les diagnostics**.

| Code | Niveau | Signification |
|---|---|---|
| `backend-fallback` | warning | path tracing ou Disney rendu en raster (limite GPU ou budget mémoire) |
| `backend-preparation` | error | échec de préparation d'un backend (hors erreur WGSL localisée) |
| `shader-compilation` | error | erreur de compilation WGSL, avec ligne et colonne |
| `texture-downscaled` | warning / info | texture réduite (limite GPU / budget mémoire) |
| `memory-budget-reduced` | warning | taille maximale des textures abaissée par le budget |
| `memory-budget-exceeded` | error | budget toujours dépassé après toutes les réductions |
| `device-lost` | warning | perte du périphérique GPU |
| `device-restored` | info | scène restaurée sur un nouveau périphérique |
| `device-recovery-failed` | error | restauration impossible ou périphérique emprunté |
| `uncaptured-gpu-error` | error | erreur WebGPU non capturée par une portée d'erreur |
| `scene-load-failed` | error | échec de `loadUsd()` (la promesse est aussi rejetée) |
| `streaming-preview-failed` | warning | échec d'un aperçu partiel (le chargement continue) |

Les autres diagnostics (import USD, MaterialX, géométrie) n'ont pas encore de
code ; leur message reste stable d'une version de correctif à l'autre.

## Télémétrie locale

Avec `telemetry: true`, `engine.telemetry()` renvoie (rien n'est transmis) :

- `phases` : nombre, total, maximum et dernière durée des mesures
  `performance.measure` du moteur (`usd:*`, `viewer:*`, `pathtracing:*`,
  `assets:*`, `engine:load`) ;
- `gpu` : temps GPU des passes (somme par tampon de commandes soumis, via
  `timestamp-query`, quantifié par le navigateur), par catégorie : `load`,
  `capture:raster`, `capture:pathtracing` ou le backend des images
  interactives ; absent sans `timestamp-query` ;
- `uploads` : nombre et octets de `writeBuffer` / `writeTexture` ;
- `memory` : mémoire GPU courante, pic et budget ;
- `convergence` : échantillons, bruit relatif, balayages par seconde et durée
  du dernier rendu progressif.

Les mesures de phases sont celles de la page : plusieurs moteurs dans la même
page voient les phases des autres.

## Tests navigateurs, GPU et rendu golden

- `npm run test:gpu-matrix` exécute les captures raster et path tracing dans
  chaque navigateur Chromium installé (Chrome, Edge) et sur chaque adaptateur
  (GPU haute performance, basse consommation, SwiftShader).
- `npm run test:playwright:browsers` exécute l'exemple du moteur dans Chromium,
  Firefox et WebKit (Playwright) : il doit afficher le triangle, ou indiquer
  pourquoi WebGPU est indisponible.
- `npm run test:golden` compare les rendus raster sur SwiftShader aux
  références de `tests/golden/` (erreur absolue moyenne et part de pixels
  écartés de plus de 16/255) ; `-- --gpu` compare les rendus path tracing sur
  le GPU (moyennes par blocs 8×8). `--update` régénère les références. La CI
  GitHub exécute la partie raster à chaque push ; la partie path tracing tourne
  sur l'exécuteur auto-hébergé `webgpu`.

Résultats sur la machine de développement (NVIDIA T500 et Intel Iris Xe,
Windows) :

| Navigateur | Adaptateur | Raster | Path tracing | `timestamp-query` |
|---|---|---|---|---|
| Chrome, Edge | NVIDIA Turing (haute performance) | ok | ok | oui |
| Chrome, Edge | Intel Xe gen-12lp (basse consommation) | ok | ok | oui |
| Chrome, Edge | SwiftShader | ok | non exécuté | oui |
| Chromium Playwright (headless shell) | aucun | « No WebGPU adapter found. » | – | – |
| Firefox Playwright | adaptateur sans contexte de canvas | « No WebGPU canvas context. » | – | – |
| WebKit Playwright | aucun | « WebGPU is not available in this browser. » | – | – |

Les références golden path tracing produites sur NVIDIA passent sur Intel
(moyennes 8×8 : écart 0,0002 pour une tolérance de 0,01).

## Limites connues

- WebGPU est requis : sans `navigator.gpu`, `create()` et `createHeadless()`
  rejettent avec « WebGPU is not available in this browser. ».
- SwiftShader convient au raster mais est trop lent pour le path tracing ;
  sous Windows, il demande le backend Vulkan de Dawn (`--enable-features=Vulkan`,
  voir `SWIFTSHADER_ARGS` dans `scripts/export-browser-session.mjs`).
- Firefox et WebKit ne rendent pas encore : le moteur le signale explicitement.
- Le streaming n'accélère pas le chargement complet ; à froid il le laisse
  inchangé à quelques pour cent près, à chaud il ajoute 0,1 à 0,3 s. Le premier
  aperçu d'une scène faite d'un seul gros maillage attend le téléchargement de
  ce fichier.
- Le budget mémoire est une estimation (ressources créées par le moteur, hors
  surcoûts du pilote) ; seules les textures de matériaux sont réduites.
- Pendant une reconstruction (changement de matériau, de topologie, budget),
  l'ancien et le nouveau jeu de rendu coexistent brièvement : le pic de mémoire
  peut atteindre le double.
- Les limites propres aux matériaux, à l'import USD et aux effets sont décrites
  dans [conformance.md](conformance.md), [usd-import.md](usd-import.md) et
  [validation.md](validation.md).
