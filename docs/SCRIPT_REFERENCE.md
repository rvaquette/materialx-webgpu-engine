# Référence des commandes de script

Liste complète de ce qu'un script de matériau peut utiliser. Le guide d'ensemble
(syntaxe, éditeur, exemples) est dans [SCRIPTING.md](SCRIPTING.md) ; le code est
dans [src/materialx/script-api.ts](../src/materialx/script-api.ts).

Un script est du JavaScript (boucles, fonctions, `await`, objets). Les noms
ci-dessous sont fournis par le moteur ; tout autre nom non déclaré produit
l'erreur `xxx is not defined.`

**Sommaire** — [Nœuds](#nœuds-materialx) · [Valeurs et types](#valeurs-et-types) ·
[Opérateurs et Math](#opérateurs-et-fonctions-math) · [Conditions](#conditions-par-pixel) ·
[Matériaux](#matériaux-et-documents) · [Scène](#scène-et-objets) · [Rendu](#rendu) ·
[Paramètres `render.*`](#paramètres-de-rendu-render) · [Enregistrement](#enregistrement-de-fichiers) ·
[Animation et transformations](#animation-et-transformations) · [Lumières et caméra](#lumières-et-caméra) ·
[Variantes et paramètres](#variantes-usd-et-paramètres-de-matériau) · [Diagnostic](#messages-vérifications-et-diagnostic) ·
[Exécution](#règles-dexécution)

---

## Nœuds MaterialX

| Écriture | Effet |
|---|---|
| `x = new Classe()` | Crée un nœud de la catégorie MaterialX correspondante ; la variable donne son nom au nœud (`x`). |
| `new Classe("type")` | Variante par type de sortie, ex. `new Fractal3d("float")`. |
| `new Classe("ND_…")` | Variante par nom de NodeDef, ex. `new Mix("ND_mix_color3_color3")`. |
| `x.entree = valeur` | Valeur littérale d'une entrée (type vérifié, voir [Valeurs](#valeurs-et-types)). |
| `x.entree = y.sortie` | Connexion ; les types doivent être identiques. |
| `x.entree = y` | Connexion à la sortie unique de `y` (erreur si `y` a plusieurs sorties). |
| `x.sortie` | Référence à une sortie (`out`, `outr`…), à utiliser à droite d'un `=` ou dans une expression. |
| `x.entree` (lecture) | Valeur littérale assignée, la sortie connectée, ou `undefined`. |
| `x.colorspace = "srgb_texture"` | Attribut `colorspace` (nœuds à entrée `filename`) ; valeurs : `srgb_texture`, `lin_rec709`, `g22_rec709`, `g18_rec709`, `acescg`, `lin_ap1`, `g22_ap1`, `g18_ap1`… |
| `String(x)`, `` `${x}` `` | Nom du nœud. |

- **Classes** : chaque catégorie des bibliothèques chargées (stdlib, pbrlib, cmlib, bxdf), en
  PascalCase : `standard_surface` → `StandardSurface`, `open_pbr_surface` → `OpenPbrSurface`,
  `image` → `Image`, `surfacematerial` → `Surfacematerial`. L'autocomplétion après `new` les liste.
- **Variante par défaut** d'un nœud polymorphe : la première sortie disponible dans l'ordre
  `color3`, `float`, `vector3`, `color4`, `vector2`, `vector4`, `integer`, `boolean`, puis le nom
  de NodeDef le plus court. Un type ou un NodeDef inconnu affiche la liste des types possibles.
- Appeler une classe sans `new` est une erreur.
- **Nommage** : un nœud créé dans une expression prend le nom de la variable qui la reçoit ;
  un nœud jamais affecté à une variable prend le nom de sa catégorie. Les doublons reçoivent un
  suffixe `_2`, `_3`…
- Sans `Surfacematerial`, l'export ajoute un `surfacematerial` nommé `material` relié au dernier
  shader de surface.

## Valeurs et types

| Type d'entrée | Valeurs acceptées |
|---|---|
| `float` | nombre fini |
| `integer` | entier |
| `boolean` | `true` / `false` |
| `string`, `filename` | chaîne (chemins relatifs résolus par rapport à la page) |
| `color3`, `vector3` | tableau de 3 nombres, ou un nombre répété |
| `color4`, `vector4` | 4 nombres, ou un nombre |
| `vector2` | 2 nombres, ou un nombre |
| `matrix33`, `matrix44` | 9 / 16 nombres, ou un nombre |
| `surfaceshader`, `BSDF`, `EDF`, `material`… | connexion uniquement (`x.entree = y.out`) |

Une entrée inconnue, un mauvais type ou une connexion entre types différents arrêtent le script
avec la ligne fautive.

## Opérateurs et fonctions Math

Sur des **sorties de nœud**, ces écritures créent des nœuds ; sur des nombres ou tableaux,
elles calculent normalement (composante par composante pour les tableaux).

| Script | Nœud créé |
|---|---|
| `a + b`, `a - b`, `a * b`, `a / b`, `a % b`, `a ** b` | `add`, `subtract`, `multiply`, `divide`, `modulo`, `power` |
| `a += b` (et `-=`, `*=`, `/=`, `%=`, `**=`) | même nœud, réaffecté à `a` |
| `-a` | `multiply` par -1 |
| `Math.sin` `cos` `tan` `asin` `acos` | `sin`, `cos`, `tan`, `asin`, `acos` |
| `Math.atan2(y, x)` | `atan2` |
| `Math.abs` `floor` `ceil` `round` `sqrt` `exp` `log` `sign` | `absval`, `floor`, `ceil`, `round`, `sqrt`, `exp`, `ln`, `sign` |
| `Math.pow(a, b)` | `power` |
| `Math.min(a, b, …)`, `Math.max(a, b, …)` | `min`, `max` (chaînés au-delà de 2 arguments) |

Les autres membres de `Math` (`Math.PI`, `Math.random()`…) restent ceux de JavaScript. La
variante est choisie d'après les types : couleur × `float` → variante `…FA` ; à défaut, les
opérandes d'une opération commutative sont échangés ou un nœud `convert` est inséré.

## Conditions par pixel

| Script | Nœuds |
|---|---|
| `a > b ? x : y` | `ifgreater(value1=a, value2=b, in1=x, in2=y)` |
| `a < b ? x : y` | `ifgreater` avec `value1`/`value2` échangés |
| `a >= b`, `a <= b` | `ifgreatereq` |
| `a == b`, `a === b` | `ifequal` |
| `a != b`, `a !== b` | `ifequal` avec les branches échangées |
| comparaison utilisée comme valeur | nœud de sortie `boolean` (`ifgreater`, `ifgreatereq`, `ifequal` ; `not(ifequal)` pour `!=`) |
| `c1 && c2`, `c1 \|\| c2`, `!c` | `and`, `or`, `not` |
| `cond ? x : y` sur une sortie `boolean` | `ifequal(cond, true)` |

Les comparaisons portent sur des valeurs `float`, `integer` ou `boolean`. `if`, `while`, `for`
s'exécutent à la construction du graphe : une condition sur une sortie de nœud y est refusée
(« evaluated per pixel »). Sans sortie de nœud, `?:`, `&&`, `||` gardent leur sens JavaScript.

## Matériaux et documents

| Fonction | Retour | Effet |
|---|---|---|
| `await load("chemin.mtlx")` | nœud matériau | Ajoute au script les nœuds du document (nodegraphs aplatis, `xi:include` intégrés, textures en URL absolues) et retourne son `surfacematerial` (ou son dernier shader). |
| `material("/objet")` | nœud matériau | Importe le matériau courant de l'objet tel que le moteur l'a résolu ; modifiable puis réaffectable. |
| `node("nom")` | nœud | Nœud du script par son nom (ex. un nœud issu de `load`). |
| `await assign("/objet", m)` | — | Affecte `m` à l'objet : shader de surface ou `surfacematerial` du script (avec ses nœuds en amont), ou chemin `.mtlx`. |

## Scène et objets

| Fonction | Retour | Effet |
|---|---|---|
| `await scene("./scenes/….usda")` | — | Charge une scène (USD, glTF/GLB, `scene.json` précompilé). |
| `objects()` | `string[]` | Chemins des objets de la scène. |
| `setTransform("/objet", matrice)` | — | Matrice 4×4 en colonnes (16 nombres) ; sans matrice : transformation de la scène. |
| `setVisibility("/objet", visible)` | — | Masque (`false`) ou affiche ; sans valeur : visibilité de la scène. |

## Rendu

| Fonction | Retour | Effet |
|---|---|---|
| `render.<paramètre> = v` | — | Réglage de rendu (table suivante) ; lecture : valeur courante. |
| `await render()` | échantillons | Relance le rendu et attend une image. |
| `await render(n)` | échantillons | Relance et attend `n` échantillons par pixel du path tracer (ou son arrêt sur convergence / budget de temps). En raster : une image. |
| `await converge(secondes = 600)` | `stats()` | Attend l'arrêt du path tracer ; demande `render.backend = "pathtracing"` et `render.stopOnConvergence = true` ou un `render.timeBudget`. |
| `await capture("x.png", { samples })` | — | Rendu path tracing de `samples` échantillons enregistré en PNG (indépendant de l'accumulation affichée). |
| `await capture("x.png", { samples, shutter: [t0, t1], steps })` | — | Idem avec flou de mouvement sur l'intervalle de temps `[t0, t1]`, réparti sur `steps` sous-images (16 par défaut). |
| `stats()` | objet | État du rendu (ci-dessous). |

`stats()` retourne :

| Champ | Contenu |
|---|---|
| `backend`, `drawnBy`, `fallback` | moteur demandé, moteur qui dessine (raster après un repli), raison du repli |
| `pathTracer` | `idle`, `compiling`, `ready`, `error` |
| `samples`, `adaptive`, `paused` | échantillons (balayages en adaptatif), modes |
| `elapsed`, `stopReason` | temps de rendu actif (s), raison de l'arrêt |
| `samplesPerSecond`, `noise`, `maxNoise`, `variance` | débit, bruit relatif moyen et maximal, variance |
| `remaining`, `budgetRemaining` | estimation avant la cible de bruit, budget restant (s) |
| `time`, `warnings` | instant courant, nombre d'avertissements |
| `gpuMemory` | `{ total, peak, textures, buffers, budget?, textureLimit }` (octets) |

## Paramètres de rendu (`render.*`)

| Paramètre | Valeurs |
|---|---|
| `backend` | `"raster"`, `"pathtracing"`, `"disney"` |
| `resolution` | `128`, `256`, `512`, `1024`, `"1024x768"` |
| `depth` | profondeur du path tracing, entier 0–64 |
| `quality` | qualité raster : `"interactive"`, `"reference"` |
| `environment` | éclairage par l'environnement (booléen) |
| `denoise` | débruitage du path tracing (booléen) |
| `exposure` | exposition en EV (nombre) |
| `tonemap` | `"none"`, `"reinhard"`, `"acesFilmic"` |
| `view` | `"beauty"`, `"albedo"`, `"normal"`, `"depth"`, `"variance"`, `"emission"`, `"transmission"` |
| `adaptive` | échantillonnage adaptatif (booléen) |
| `noiseTarget` | cible de bruit relative, 0,005–0,25 |
| `stopOnConvergence` | arrêt automatique à la cible (booléen) |
| `timeBudget` | budget de temps actif en secondes (0 : illimité) |
| `paused` | pause de l'accumulation (booléen) |
| `compare` | comparaison brut/débruité (en pause, débruitage actif) |
| `temporalHistory` | échantillons gardés après un changement dynamique (0 : relance) |
| `memoryBudget` | budget mémoire GPU en Mio (0 : sans budget) |

`exposure`, `tonemap` et `view` ne relancent pas l'accumulation.

## Enregistrement de fichiers

| Appel | Fichier |
|---|---|
| `await save("rendu.png")` | image affichée (PNG) |
| `await save("aov.pfm")` | AOV sélectionnée par `render.view` (PFM 32 bits ; path tracing, `view` ≠ `"beauty"`) |
| `await save("diagnostics.json")` | journal des diagnostics |
| `await save("materiau.mtlx", m)` | document MaterialX du matériau `m` du script |
| `await capture("x.png", { … })` | voir [Rendu](#rendu) |

Les noms peuvent contenir des sous-dossiers (`"seq/frame-01.png"`), pas `..`. Destination :
téléchargement dans le viewer, dossier `--out` avec `npm run script`, téléchargement côté client
pour un [rendu distant](REMOTE_RENDER.md).

## Animation et transformations

| Fonction | Retour | Effet |
|---|---|---|
| `timeline()` | `{ start, end, fps }` ou `undefined` | Intervalle d'une scène animée. |
| `time()` | nombre | Instant courant (code temporel). |
| `await setTime(t)` | — | Évalue la scène à l'instant `t`. |
| `transform({ translate, rotate, scale })` | `number[16]` | Matrice : échelle (nombre ou `[x, y, z]`), puis rotations X, Y, Z en degrés, puis translation. |

## Lumières et caméra

| Fonction | Retour | Effet |
|---|---|---|
| `lights()` | `{ path, type }[]` | Lumières de la scène. |
| `setLight("/lumière", { intensity, exposure, color, transform })` | — | Modifie les champs donnés (`color` : 3 nombres, `transform` : 16) ; sans changements : valeurs de la scène. |
| `setCamera({ eye, target, fov })` | — | Place la caméra ; `eye`, `target` : 3 nombres ; `fov` : champ vertical en degrés (0–180, facultatif). |

## Variantes USD et paramètres de matériau

| Fonction | Retour | Effet |
|---|---|---|
| `variants()` | `{ path, set, variants, selection }[]` | Variant sets de la scène. |
| `await setVariant("/prim", "set", "variante")` | — | Sélectionne une variante (recomposition). |
| `materialParameters("/objet")` | `{ id, label, type, value, min, max }[]` | Paramètres exposés en uniformes. |
| `await setMaterialParameters("/objet", { id: valeur })` | — | Modifie des paramètres sans recompilation ; valeur : nombre, booléen ou tableau. |

## Messages, vérifications et diagnostic

| Fonction | Retour | Effet |
|---|---|---|
| `log(a, b, …)` | — | Message dans la console de l'éditeur (`npm run script` : sortie standard) ; nœuds affichés par leur nom, objets en JSON. |
| `check(condition, "message")` | — | Arrête le script si `condition` est fausse, sinon journalise `OK  message`. Ignorée pendant la validation en direct. |
| `capabilities()` | objet | Adaptateur GPU, limites, `features`, support par backend, `mobile`. |
| `diagnostics()` | `{ level, code, message }[]` | Journal des diagnostics. |

## Règles d'exécution

- **Ordre** : les actions du viewer (`setTime`, `setTransform`, `setVisibility`, `setLight`,
  `setCamera`, `setVariant`, `setMaterialParameters`, réglages `render.*`) s'exécutent dans l'ordre
  du script ; `await` y est facultatif, mais une erreur non attendue arrête les commandes suivantes.
  `scene`, `assign`, `load`, `render(n)`, `converge`, `capture`, `save` sont asynchrones : les
  attendre avec `await`.
- **Validation en direct** (pendant la saisie) : les nœuds sont construits et les commandes
  vérifiées, sans les exécuter ; après `scene()`, `objects()`, `lights()`… répondent comme pour une
  scène vide, `material()` retourne un matériau de substitution et `check` est ignorée. Au-delà de
  2 s, la validation s'arrête (« infinite loop? »).
- **Pause, pas à pas, arrêt** : l'éditeur peut suspendre le script avant chaque instruction
  (et l'accumulation du path tracer) et l'arrêter, y compris pendant une commande du viewer. Les
  fonctions non `async` du script s'exécutent sans pause.
- **Script seul** : sans `scene`, `render`, `assign`… (aucune commande du viewer), **Appliquer**
  affecte le matériau du script à l'objet sélectionné.
- **Noms réservés** : `scene`, `objects`, `render`, `assign`, `load`, `save`, `log`, `check`,
  `stats`, `converge`, `diagnostics`, `capabilities`, `timeline`, `setTime`, `setTransform`,
  `setVisibility`, `lights`, `setLight`, `setCamera`, `variants`, `setVariant`,
  `materialParameters`, `setMaterialParameters`, `Math`, et les classes de nœuds, ne peuvent pas
  être réaffectés. `material`, `node`, `time`, `transform` et `capture` peuvent servir de noms de
  nœuds (la variable masque alors la fonction).
- **Rendu distant** : le script part seul (sans l'état du viewer local) ; il doit charger sa scène,
  et ne peut lire que les fichiers servis par le serveur (`./scenes/…`) — voir
  [REMOTE_RENDER.md](REMOTE_RENDER.md).

## Exemple complet

```js
await scene("./scenes/standard-shader-ball/standard-shader-ball.usda");
render.resolution = 512;
render.backend = "pathtracing";
render.noiseTarget = 0.02;
render.stopOnConvergence = true;
setCamera({ eye: [0, 1.5, 4], target: [0, 0.8, 0], fov: 35 });

n = new Fractal3d("float");
n.octaves = 5;
surface = new StandardSurface();
surface.base_color = n.out > 0 ? [0.9, 0.3, 0.1] : [0.1, 0.2, 0.8];
surface.specular_roughness = Math.abs(n.out) * 0.4 + 0.1;
for (const object of objects()) await assign(object, surface);

const result = await converge(300);
check(result.noise <= 0.02, "bruit sous 2 %");
log(`${result.samples} spp, arrêt : ${result.stopReason}`);
await save("rendu.png");
await save("materiau.mtlx", surface);
```
