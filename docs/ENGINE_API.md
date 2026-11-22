# API publique du moteur

Le paquet `materialx-webgpu-engine` expose deux points d'entrée. Tout le reste du
code (`src/**`) est interne et peut changer sans préavis, même lorsqu'un de ses
types apparaît dans le rapport d'API.

| Point d'entrée | Contenu |
|---|---|
| `materialx-webgpu-engine` | `MaterialXEngine` et ses types d'options, de capture et de statut |
| `materialx-webgpu-engine/element` | l'élément `<materialx-viewer>` et `defineMaterialXViewer()` |

Les signatures exactes, y compris les types internes qu'elles atteignent
(`EngineStatus`, `PathTraceMetrics`…), sont figées dans
[engine-api.md](engine-api.md).

## Garanties d'exécution

En plus des signatures, le contrat comprend les comportements suivants :

- une instance n'exécute qu'une opération à la fois : un appel pendant
  `loadUsd()`, `setMaterial()`, `render()` ou `capture()` est refusé avec une
  erreur, et toute méthode échoue après `dispose()` ;
- un périphérique fourni par `options.device` reste à l'appelant ; sinon le
  moteur crée son périphérique et le détruit dans `dispose()` ;
- les URL relatives (`setMaterial`, `src` de l'élément) sont résolues par
  rapport à `document.baseURI` ;
- `capture()` renvoie des pixels RGBA8 après tonemapping, de haut en bas, sans
  octets de remplissage. En path tracing, chaque capture repart de zéro et
  calcule exactement le nombre d'échantillons demandé ; avec `shutter`, ces
  échantillons sont répartis sur `steps` sous-images (16 par défaut) à des
  instants tirés dans des strates de l'intervalle, puis le temps courant est
  rétabli ;
- `setTime()`, `setTransform()`, `setVisibility()`, `setLight()`,
  `setCamera()` et `setMaterialParameters()` (pour les valeurs envoyées en
  uniformes) modifient la scène chargée sans la recharger. Les transformations,
  visibilités et lumières modifiées restent prioritaires sur l'animation ; les
  appeler sans valeur rétablit celles de la scène. Une caméra animée remplace
  celle de `setCamera()` à son prochain changement. `setVariant()` recompose et recharge la scène
  en conservant caméra, temps et modifications ; comme `loadUsd()`, il bloque
  les autres opérations ;
- après un changement de scène, le path tracing interactif repart de zéro, ou
  garde au plus `temporalHistory` échantillons par pixel si cette option de
  `render()` est non nulle ;
- `render()` applique une configuration sans attendre d'image ni la convergence ;
- les fichiers d'exécution MaterialX/OpenUSD ne sont pas inclus dans le paquet ;
  l'hôte les sert et peut indiquer leurs URL avec `runtimeAssets`.

Les champs de diagnostic de `EngineStatus` (`pathTracingMetrics`,
`convergence`, `denoiser`, `warnings`, `passes`) sont informatifs : leurs
valeurs peuvent évoluer d'une version mineure à l'autre. Ne pas les utiliser
pour piloter une logique applicative critique.

## Règles de compatibilité

Le paquet suit le versionnement sémantique, avec les règles usuelles des
versions `0.x` :

- **version de correctif** (`0.1.x`) : corrections et ajouts compatibles,
  comme un nouveau champ optionnel en entrée ou en sortie, ou une nouvelle
  méthode ou fonction ;
- **version mineure** (`0.x.0`) : tout changement incompatible. Par exemple :
  supprimer ou renommer un export, une méthode, un attribut ou un événement
  de l'élément ; rendre un paramètre obligatoire ou restreindre son type ;
  élargir un type renvoyé ; ajouter une valeur à une union renvoyée
  (`BackendKind`, `stopReason`…) ; modifier une des garanties ci-dessus.

À partir de `1.0.0`, seuls les changements de version majeure pourront être
incompatibles.

## Modifier l'API

`npm test` exécute [engine-api.test.mjs](../scripts/engine-api.test.mjs), qui
compare l'API actuelle au rapport figé et indique la première ligne modifiée.
Pour un changement voulu :

1. classer le changement selon les règles ci-dessus et ajuster `version` dans
   `package.json` ;
2. régénérer le rapport avec `npm run api:engine` ;
3. ajouter une entrée au journal ci-dessous ;
4. relancer `npm run test:engine-package`, qui installe le paquet et vérifie
   ses types et son rendu dans Chrome.

## Élément `<materialx-viewer>`

```html
<materialx-viewer src="./scene.usda" backend="pathtracing" target-noise="0.05"
  width="640" height="480"></materialx-viewer>
<script type="module">
  import { defineMaterialXViewer } from 'materialx-webgpu-engine/element';

  defineMaterialXViewer({ engineOptions: { runtimeAssets: { materialxCore: '/engine-assets/core/' } } });
  const viewer = document.querySelector('materialx-viewer');
  viewer.addEventListener('materialx-load', event => console.log(event.detail.objects));
  viewer.addEventListener('materialx-error', event => console.error(event.detail.error));
</script>
```

| Attribut | Effet |
|---|---|
| `src` | scène USD à charger ; une nouvelle valeur recharge la scène |
| `backend` | `raster` (défaut), `pathtracing` ou `disney` |
| `target-noise` | arrêt automatique du path tracing à ce bruit relatif |
| `width`, `height` | taille du canvas en pixels (256 par défaut) ; un changement recrée le moteur |
| `orbit-controls` | interaction caméra, sauf avec la valeur `"false"` |

L'élément crée son moteur à la connexion au document et le libère à la
déconnexion. Les changements d'attributs et `setMaterial()` sont exécutés dans
l'ordre ; `updateComplete` se résout quand tout est terminé. Les événements
`materialx-load`, `materialx-status` et `materialx-error` remplacent les
callbacks du moteur. `setMaterial()` signale ses erreurs en rejetant sa
promesse ; les autres erreurs produisent `materialx-error`. Pour les opérations
non couvertes, `element.engine` donne accès à l'instance `MaterialXEngine`.
Importer le point d'entrée déclare aussi `'materialx-viewer'` dans
`HTMLElementTagNameMap`, si bien que `document.querySelector('materialx-viewer')`
est typé ; cette déclaration fait partie du contrat.

## Exemples

- [examples/engine/index.html](../examples/engine/index.html) : `MaterialXEngine`
  sur un canvas, avec remplacement de matériau ;
- [examples/engine/element.html](../examples/engine/element.html) :
  `<materialx-viewer>` dans une page existante, avec choix du moteur et
  remplacement de matériau ;
- [examples/engine/batch.ts](../examples/engine/batch.ts) : rendu automatisé
  hors écran d'une scène et de variantes de matériaux, en PNG.

Avec `npm run dev`, les pages sont servies sous `/examples/engine/`. Le rendu
automatisé se lance en ligne de commande :

```powershell
npm run render:engine -- --scene examples/engine/triangle.usda --material examples/engine/orange.mtlx --backend pathtracing --samples 16 --width 320 --height 240 --out renders
```

La commande ouvre Chrome ou Edge sans fenêtre (`MX_CHROME` désigne
l'exécutable). Elle rend la scène avec ses matériaux USD, puis avec chaque
`--material` appliqué à `--object` (le premier objet par défaut). Elle écrit
`<scène>-original.png` et `<scène>-<matériau>.png`.

## Journal

### 0.1.1

- Scènes dynamiques : `timeline`, `time`, `setTime`, `setTransform`,
  `setVisibility`, `lights`, `setLight`, `setCamera`, `variantSets`,
  `setVariant`, `materialParameters` et `setMaterialParameters`.
- Options `shutter` de `capture()` (motion blur) et `temporalHistory` de
  `render()` (accumulation temporelle).
- Nouveaux types `EngineShutter`, `EngineTimeline`, `EngineLight`,
  `EngineLightChanges`, `EngineCamera`, `EngineVariantSet` et
  `EngineMaterialParameter`.

### 0.1.0

- Premier contrat public : `MaterialXEngine` (`create`, `createHeadless`,
  `loadUsd`, `objects`, `isCompiledScene`, `setMaterial`, `render`, `capture`,
  `dispose`) et ses types.
- Nouveau point d'entrée `materialx-webgpu-engine/element` avec
  `<materialx-viewer>`.
