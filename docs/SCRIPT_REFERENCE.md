# Référence des commandes de script

Liste complète de ce qu'un script de matériau peut utiliser. Le guide d'ensemble
(syntaxe, éditeur, exemples) est dans [SCRIPTING.md](SCRIPTING.md) ; le code est
dans [src/materialx/script-api.ts](../src/materialx/script-api.ts).

Un script est du JavaScript (boucles, fonctions, `await`, objets). Les noms
ci-dessous sont fournis par le moteur ; tout autre nom non déclaré produit
l'erreur `xxx is not defined.`

**Sommaire** — [Nœuds](#nœuds-materialx) · [Valeurs et types](#valeurs-et-types) ·
[Opérateurs et Math](#opérateurs-et-fonctions-math) · [Conditions](#conditions-par-pixel) ·
[Matériaux](#matériaux-et-documents) · [Scène](#scène-et-objets) · [Primitives](#primitives-scène-par-script) · [Booléens](#opérations-booléennes) ·
[Shaders d'environnement et d'image](#shaders-denvironnement-et-dimage) · [Rendu](#rendu) ·
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

### Préréglages de surfaces complexes

Les NodeDefs fournis par le moteur sont aussi instanciables par leur classe PascalCase :
`Water`, `WaterCaustics`, `Lava`, `Fire`, `Smoke`, `Clouds`, `Ice`, `Mud` et `WetSand`.
Leurs entrées sont validées et complétées automatiquement, comme celles des autres nœuds.

| Classe | Entrées principales |
|---|---|
| `Water` | `speed`, `scale`, `waveHeight`, `color`, `foamColor`, `absorptionColor`, `depth`, `roughness`, `ior` |
| `WaterCaustics` | `color`, `scale`, `speed`, `intensity` |
| `Lava` | `speed`, `scale`, `crustColor`, `temperature`, `emission`, `relief` |
| `Fire` | `density`, `scale`, `speed`, `temperature`, `emission`, `radius`, `centerHeight`, `center` |
| `Smoke` | `density`, `scale`, `speed`, `wind`, `spread`, `albedo`, `color`, `anisotropy`, `center` |
| `Clouds` | `coverage`, `density`, `scale`, `speed`, `profile`, `baseHeight`, `center`, `wind`, `color`, `anisotropy` |
| `Ice` | `color`, `roughness`, `depth`, `inclusionScale` |
| `Mud`, `WetSand` | `color`, `wetColor`, `wetness`, `scale`, `roughness` |

`Water` et `Lava` sont des matériaux de surface ; `Fire`, `Smoke` et `Clouds` sont des
matériaux de volume à affecter à une primitive `Volume`. Pour ces derniers, `center` donne
le centre mondial XZ de la forme ; `Clouds.baseHeight` est l'altitude mondiale du bas de
la couche et `Fire.centerHeight` celle du centre de la flamme. Aligner ces valeurs sur la
primitive lorsque la scène est déplacée. `Clouds.profile` vaut `0` (cumulus), `1` (stratus)
ou `2` (cirrus). `WaterCaustics` projette un motif émissif animé, décoratif et destiné
au raster ; le path tracer calcule les caustiques physiques (voir plus bas).

Les horloges `time`/`frame` des volumes sont mises à jour par `setTime()` :
le champ de coefficients est réévalué et la grille volumique reconstruite,
même lorsque la primitive reste immobile. Les flammes et les panaches utilisent
une déformation bruitée de leur enveloppe ; les nuages adaptent aussi l'échelle
directionnelle du bruit au profil. La lave et le motif de caustiques utilisent
la différence des deux distances Worley les plus proches, et non une couleur
aléatoire par cellule. Boue et sable mouillé combinent masque d'humidité,
normales de détail et couche réfléchissante.

Le raster marche les volumes avec une diffusion multiple approchée : à la
diffusion simple s'ajoutent trois octaves (anisotropie et épaisseur optique
d'ombre divisées par deux à chaque ordre, poids proportionnel à l'albédo). Elles
ne restituent que la lumière atténuée sur le chemin d'ombre : nulles dans un
milieu mince ou absorbant, elles atteignent la limite de diffusion (trois fois la
diffusion simple) au cœur d'un nuage. Les nuages raster sont ainsi à quelques
pourcents du path tracer, au lieu d'apparaître gris foncé. L'éclairage ambiant
est atténué selon deux directions ciel/sol, sans intégration complète du ciel.
Le path tracer utilise la diffusion multiple Henyey-Greenstein, sans multiplier
artificiellement la densité des nuages pour simuler un effet « powder ».
Les surfaces reçoivent aussi l'émission réelle des volumes : sélection par
puissance et échantillonnage des cellules proportionnel à la luminance émise,
avec une composante uniforme conservant le support des cellules peu lumineuses.
Les chemins caméra, spéculaires et diffusés dans le volume intègrent directement
l'émission ; les chemins de surface déjà couverts par cet échantillonnage ne la
comptent pas une seconde fois. La lumière ponctuelle de l'exemple de feu est
réservée au raster et désactivée en path tracing. `p17-emissive-volume.js`
illustre cet éclairage sans lumière de substitution ni environnement lumineux.

Les exemples de nuages utilisent un `DistantLight` solaire, et non une lumière
ponctuelle proche du panache : cette dernière surexposait la diffusion multiple
et augmentait fortement sa variance. Le soleil directionnel n'a pas de
décroissance en distance ; le ciel fournit l'éclairage diffus, sans second
soleil émissif. Le PT des exemples utilise 1 024 échantillons et une profondeur
de 24 sur ordinateur (128 échantillons sur mobile), sans changer l'exposition.
Lors d'un retour du PT au raster, `save()` attend aussi la préparation des
pipelines raster, puis rend dans une texture hors écran avant de capturer
l'image : la capture ne dépend pas de la conservation du tampon du canvas.

Les volumes peuvent se superposer ou s'imbriquer, y compris plusieurs instances
du même matériau, sur les deux moteurs : chaque instance est suivie séparément,
extinction et émission s'additionnent, et une collision de diffusion conserve
l'anisotropie du volume qui l'a produite. Le raster additionne de même les
coefficients le long de sa marche et de ses rayons d'ombre.
`p17-fire-smoke-light.js` fait ainsi envelopper la pointe de la flamme par la
fumée.

Les caustiques de l'eau sont calculées physiquement par le path tracer : sous
un soleil de taille angulaire non nulle (`sunAngularDiameter`), la lumière
focalisée par la houle atteint le fond par l'estimation directe à travers la
transmission rugueuse de l'interface. `p17-caustics.js` les montre à 256,
1 024 et 4 096 échantillons ; l'écart à l'image de référence décroît en
1/√N. Les houles longues ou très rugueuses focalisent loin sous la surface et
produisent peu de contraste sur un fond proche. Une source ponctuelle ou un
`DistantLight` sans taille ne donne pas de caustiques réfractées : aucun chemin
échantillonné ne peut l'atteindre à travers une interface lisse. `WaterCaustics`
reste un motif décoratif pour le raster. Le feu représente une flamme lumineuse
de suie (corps noir orange/jaune), pas une simulation chimique de flamme bleue.

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

## Primitives (scène par script)

| Écriture | Effet |
|---|---|
| `x = new Sphere()` | Crée une primitive ; la variable donne son nom à l'objet (`/World/x`). |
| `new Cube({ size: 2, material: m })` | Propriétés données à la création (mêmes noms que ci-dessous). |
| `x.radius = 0.5` | Modifie une propriété ; la lecture retourne la valeur courante (ou la valeur par défaut). |
| `x.material = m` | Matériau : shader de surface ou `surfacematerial` du script (avec ses nœuds en amont), ou chemin `.mtlx` ; `undefined` le retire. |
| `x.deform = (p, uv, n) => [x, y, z]` | Déplace chaque sommet (position, coordonnées de texture, normale) ; les normales sont recalculées. |
| `x.deformers = [twist, wave]` | Applique une pile ordonnée de déformeurs spatiaux aux primitives ou maillages importés, après `deform`. |
| `x.path` | Chemin de l'objet dans la scène. |
| `x.remove()` | Supprime l'objet ; le modifier ensuite est une erreur. |

| Classe | Propriétés (valeurs par défaut) |
|---|---|
| `Sphere` | `radius` (0,5), `resolution` (48) |
| `PointLight` | `color` (ambre), `intensity` (20), `exposure` (0), `radius` (0,1), `translate` |
| `DistantLight` | `color` (blanc), `intensity` (1), `exposure` (0), `rotate` ; rayons parallèles suivant l'axe local −Z, position sans effet |
| `Cube` | `size` (1), `resolution` (1) |
| `Cylinder`, `Cone` | `radius` (0,5), `height` (1), `axis` (`"Y"`), `resolution` (48) ; sommet du cône vers +`axis` |
| `Capsule` | `radius` (0,25), `height` (0,5 : partie cylindrique), `axis`, `resolution` (48) |
| `Torus` | `radius` (0,5), `minorRadius` (0,15), `axis`, `resolution` (48) |
| `Plane` | `width` (1), `length` (1), `axis` (normale), `resolution` (1), `maxEdgeLength` (0 : désactivé), `maxScreenEdgeLength` (0 : désactivé), `vertexBudget` (65 536) |
| `Disk` | `radius` (0,5), `axis` (normale), `resolution` (48) |

Propriétés communes des primitives géométriques : `translate` (`[0, 0, 0]`), `rotate` (degrés
autour de X, puis Y, puis Z), `scale` (nombre ou `[x, y, z]`), `visible` (`true`), `material`,
`deform` et `deformers`. `PointLight` expose `translate`, `rotate`, `visible`, `color` (trois composantes
non négatives), `intensity` (finie et positive ou nulle), `exposure` (stops) et `radius` (strictement
positif) ; elle est exportée comme un prim USD `PointLight` et éclaire en raster comme en path tracing.

- `resolution` : segments autour de l'axe (minimum 3) pour les formes rondes, subdivisions par
  côté (minimum 1) pour `Cube` et `Plane` ; au plus 1024. Les longueurs sont strictement positives
  et `axis` vaut `"X"`, `"Y"` ou `"Z"`.
- Pour `Plane`, `maxEdgeLength` adapte la grille afin qu'aucune arête de triangle ne dépasse cette
  longueur en espace objet ; `0` conserve la grille déterminée par `resolution`. Quand cette
  adaptation est active, `vertexBudget` borne le nombre de sommets (4 à 1 000 000) ; une demande
  qui dépasserait ce budget est rejetée.
- `maxScreenEdgeLength` choisit le mode caméra : il borne la longueur projetée des arêtes en pixels,
  puis le viewer recalcule la grille après un changement de caméra, de projection, de transformation
  d'objet ou de résolution. Les deux modes adaptatifs sont exclusifs et partagent `vertexBudget`.
- **Scène** : les primitives forment une scène USD en mémoire (`/World/<nom>`, matériaux sous
  `/World/Looks`) qui remplace la scène chargée ; un `scene(...)` ultérieur la remplace à son tour
  (ses primitives ne sont alors plus modifiables). Les primitives ne s'ajoutent pas à une scène
  chargée par `scene()`.
- **Mise à jour** : les modifications sont envoyées au viewer avant la commande suivante
  (`render`, `save`, `setCamera`, réglage `render.*`…) et à la fin du script. Si seuls
  `translate`, `rotate`, `scale` ou `visible` ont changé, les objets sont déplacés sans
  rechargement ; sinon (forme, résolution, matériau, valeurs de ses nœuds, `deform`, ajout ou
  suppression) la scène est reconstruite en gardant la caméra.
- **Matériau par défaut** : sans `material`, l'objet reçoit un `standard_surface` par défaut.
- **Noms** : `Plane` couvre les grilles ; aucun nom de primitive ne masque de nœud de la
  bibliothèque standard. Si une bibliothèque chargée définit un nœud de même nom de classe, la
  primitive l'emporte et `log` le signale.
- `objects()` retourne les chemins des primitives tant que la scène scriptée est affichée ;
  `setTransform`, `assign`… acceptent ces chemins (un `assign` est perdu à la reconstruction
  suivante : préférer `x.material`).

```js
surface = new StandardSurface();
surface.base_color = [0.8, 0.2, 0.1];
floor = new Plane({ width: 6, length: 6 });
ball = new Sphere({ radius: 0.5, translate: [0, 0.5, 0], material: surface });
setCamera({ eye: [3, 2, 4], target: [0, 0.3, 0], fov: 40 });
await render(64);
await save("primitives.usda");   // scène USD + ses documents MaterialX
```

### Déformeurs spatiaux (première étape P18)

`new Bend()`, `Twist`, `Taper`, `Shear`, `Wave`, `Wind`, `Spherize`, `Lattice` et `Field`
créent des déformeurs partageables. Chacun agit en espace objet selon `axis`
(`"X"`, `"Y"` ou `"Z"`), entre `min` et `max` (−1 et 1 par défaut).
`falloff` est la largeur d'atténuation à chaque extrémité, de 0 à la moitié
de l'intervalle. Les points hors intervalle ne bougent pas.

| Classe | Propriétés supplémentaires |
|---|---|
| `Bend`, `Twist` | `angle` en degrés (0) ; 0 au début et angle complet en fin d'intervalle |
| `Taper`, `Shear` | `factor` (0) : variation d'échelle ou cisaillement le long de l'axe |
| `Wave` | `amplitude` (0), `frequency` (1), `phase` en radians (0) |
| `Wind` | `amplitude` (0), `frequency` (1), `phase` (0), `seed` entier non signé (0) ; bruit 3D vectoriel, nul au début de l'intervalle |
| `Spherize` | `radius` (1), `strength` de 0 à 1 (0), centrée sur l'origine |
| `Lattice` | `boundsMin`, `boundsMax` (−1 et 1 sur chaque axe), `dimensions` (2, 2, 2), `offsets` |
| `Field` | `field` : sortie MaterialX `vector3` ou grille NanoVDB ; `strength` (1), `steps` (1 à 64, défaut 1), `start` (0), `end` (24), `samples` (2 à 256, défaut 25) |

`Field` intègre le vecteur en espace objet par pas d'Euler : à chaque pas, il
réévalue le graphe à la position déplacée et avance de `strength / steps` fois
le vecteur. Un pas correspond à un déplacement direct. Le graphe peut utiliser
`Position` en espace `"object"` ou `"model"` et les nœuds `Time`/`Frame`.
Les textures et les autres données géométriques ne sont pas prises en charge ;
les nœuds sans évaluation CPU sont refusés. Les modifications de nœuds partagés
reconstruisent les objets concernés. L'export inclut le graphe dans
`engine:deformers` ainsi que la géométrie résultante.

```js
position = new Position(); position.space = "object";
noise = new Noise3d("vector3"); noise.position = position.out;
flow = new Field({ strength: 0.3, steps: 4 }); flow.field = noise.out;
ball = new Sphere(); ball.deformers = [flow];
```

Une grille de vitesses peut être chargée avec
`velocity = await loadVelocityField("velocity.nvdb", "velocity"); flow.field = velocity;`.
Le nom est facultatif si le fichier contient une seule grille vectorielle ;
sinon il est obligatoire. Les types Vec3f et Vec3d, les fichiers `.nvdb` ou
`.nvdb.gz` et les grilles MAC décalées sont acceptés. Les valeurs sont
interpolées trilinéairement dans l'espace monde de la grille, interprété ici
comme l'espace objet ; hors de l'arbre, sa valeur de fond est utilisée.
Le fichier doit rester accessible pour réutiliser les paramètres : l'USD
exporté contient son URL et son nom dans `engine:deformers`, mais incorpore
uniquement la géométrie déformée, pas le fichier de grille.

Un graphe contenant `Time` ou `Frame` est échantillonné entre `start` et `end`
en `samples` points, en codes temporels USD. Ces temps s'ajoutent aux clés des
autres déformeurs ; entre les échantillons, USD interpole les positions.

Le treillis interpole les déplacements en Bézier. Chaque dimension contient 2 à
6 points ; `offsets` est vide ou contient trois nombres par point, X variant le
plus vite, puis Y et Z. Pour modifier un tableau, réassigner la propriété entière.
Les modifications d'un déformeur partagé reconstruisent les objets concernés à la
prochaine commande du viewer. Le maillage de départ est conservé pendant l'exécution
du script ; l'export USD contient le maillage résultant et `engine:deformers`.

Animer les valeurs numériques ou les tableaux de longueur fixe avec
`wind.keyframes = [{ time: 0, phase: 0 }, { time: 24, phase: 3 }]`. Toutes les
clés doivent comporter les mêmes propriétés, et leurs temps être croissants ;
`axis`, `dimensions`, `seed`, `steps`, `start`, `end` et `samples` ne sont pas animables. De 2 à 256 clés sont
acceptées. L'union des temps de toutes les clés de la pile est évaluée sur CPU,
dans la limite de 4 000 000 de couples sommet-temps par objet. Le résultat est
exporté en échantillons USD de positions et normales ; entre deux clés, USD
interpole les positions, pas les paramètres. Ajouter des clés intermédiaires
pour mieux approcher une trajectoire non linéaire. `setTime` et la capture
path tracing avec obturateur exploitent ces échantillons.

Cette étape reste calculée sur CPU. L'import de maillages est limité comme indiqué dans
[Animation et transformations](#animation-et-transformations).

## Opérations booléennes

| Écriture | Effet |
|---|---|
| `cut = new Difference()` | Crée une différence entre deux objets de la scène scriptée. |
| `cut.base = body` | Définit l'opérande de base. |
| `cut.tool = cutter` | Définit l'opérande soustrait (ou combiné/intersecté selon l'opération). |
| `cut.material = surface` | Matériau de la géométrie résultante ; les matériaux des opérandes ne sont pas repris. |

`Union`, `Difference` et `Intersection` acceptent aussi leurs propriétés dans le constructeur :
`cut = new Difference({ base: body, tool: cutter, material: surface })`. Les deux opérandes
doivent être des objets créés par script ; les arbres peuvent être imbriqués. Les opérandes
deviennent automatiquement invisibles dans la scène, mais restent modifiables par leurs
variables. Leurs transformations sont appliquées à la géométrie avant l'opération ; celles du
résultat s'appliquent ensuite.

Les maillages doivent être fermés et orientés de façon cohérente. Les primitives solides
(`Sphere`, `Cube`, `Cylinder`, `Cone`, `Capsule`, `Torus`) conviennent ; `Plane` et `Disk` sont
ouverts et déclenchent un diagnostic explicite. Les normales et les coordonnées `st` sont
conservées sur le résultat, y compris les faces créées par une soustraction. Les cycles, les
opérandes manquants et les objets supprimés sont refusés. Une opération booléenne n'accepte pas
`deform` directement ; une primitive déformée peut servir d'opérande si son maillage reste fermé.

```js
left = new Union({ base: new Sphere({ translate: [-0.25, 0, 0] }), tool: new Sphere({ translate: [0.25, 0, 0] }) });
body = new Cylinder({ radius: 0.65, height: 1.6 });
drill = new Sphere({ radius: 0.42, translate: [0.2, 0.3, 0] });
cut = new Difference({ base: body, tool: drill });
overlap = new Intersection({ base: new Cube({ translate: [-0.25, 0, 0] }), tool: new Cube({ translate: [0.25, 0, 0] }) });
left.translate = [-2, 0, 0];
overlap.translate = [2, 0, 0];
```

## Shaders d'environnement et d'image

| Écriture | Effet |
|---|---|
| `env = new EnvironmentShader()` | Ciel, dégradé ou éclairage studio procédural évalué par direction puis converti en carte HDR lat-long ; ses paramètres sont scriptables et animables. |
| `await environment(env.out)` | Active cet environnement pour le fond et l'éclairage raster/path tracing ; sa carte et sa CDF d'échantillonnage sont mises à jour ensemble au changement de temps. |
| `grade = new ImageShader()` / `lens = new LensShader()` | Définit l'étalonnage écran et les effets optiques de lentille. |
| `await postprocess(grade.out)` | Applique l'étalonnage après l'affichage raster ou path tracing, y compris les AOV, sans modifier l'accumulation. |
| `output = new AovShader(); await aov(output.out)` | Sélectionne un AOV path tracing intégré : albedo, normal, profondeur, variance, émission ou transmission. |
| `output = new CustomAovShader(); await aov(output.out)` | Sélectionne un AOV nommé de données ou de masque, parmi les sources limitées décrites ci-dessous. |
| `filter = new LightFilterShader(); filter.lightPath = "/World/Spot"; await lightFilter(filter.out)` | Applique un gobo procédural à une lumière spot du path tracer MaterialX. |
| `settings = new ScatterShader(); await scatter(settings.out)` | Répartit des instances sur une surface scriptée, avec densité scalaire ou graphe spatial et graine reproductible. |

`EnvironmentShader.model` accepte `"gradient"`, `"sky"` ou `"studio"`. Les entrées couleur,
direction du soleil, intensité, diamètre angulaire, exposition, rotation et vitesse d'animation
sont définies par le NodeDef `ND_engine_environment_shader`. `ImageShader` et `LensShader` appliquent une partie de leurs réglages dans l'espace écran ; `distortion` règle
la distorsion radiale (-1 à 1) et `chromaticAberration` la séparation rouge/bleu (0 à 0,1).
Le tone mapping intégré reste contrôlé par `render.tonemap`. Ces nœuds
acceptent actuellement des paramètres littéraux, pas des entrées connectées depuis d'autres nœuds.

La distorsion et l'aberration chromatique sont des post-traitements disponibles sur raster,
path tracing MaterialX et Disney. `LensShader` expose aussi `projection` (`"perspective"` par
défaut, `"fisheye"` ou `"equirectangular"`), `apertureRadius` (rayon de l'ouverture en unités
de scène, 0 par défaut), `focusDistance` (distance positive en unités de scène, 5 par défaut),
`bokehBlades` (0 pour une ouverture circulaire, sinon entier de 3 à 16) et `bokehRotation`
(degrés). Une ouverture non nulle échantillonne physiquement l'objectif et converge vers le plan
de mise au point de la caméra perspective ou orthographique. Les projections angulaires utilisent
une sphère de mise au point centrée sur la caméra. Le fisheye équidistant couvre 180° dans le
cercle inscrit, noir à l'extérieur ; l'équirectangulaire couvre 360° horizontalement et 180°
verticalement. Ces options de caméra exigent le path tracer MaterialX : raster et Disney sont
refusés, de même qu'un repli raster. Les modifier réinitialise l'accumulation. L'option
`"perspective"` conserve la projection de la caméra, y compris si elle est orthographique.

`AovShader` sélectionne les AOV intégrés. `CustomAovShader` définit une sortie nommée pour le path
tracer MaterialX, par exemple :

```js
p = new Position(); p.space = "world";
parts = new Separate3("ND_separate3_vector3"); parts.in = p.out;
output = new CustomAovShader();
output.name = "height";
output.source = "scalar";
output.scalar = parts.outy;
await aov(output.out);
```

Le nom doit commencer par une lettre ASCII ou `_`, puis contenir au plus 63 lettres ASCII,
chiffres, `_` ou `-`. Les sources admises sont :

- `position` : connecter `position` à `Position` en espace `world` (trois composantes) ;
- `scalar` : un float littéral, `Constant("float")` littéral, ou `Separate3("ND_separate3_vector3")`
  connecté directement à `Position` en espace `world` (`outx`, `outy` ou `outz`) ;
- `material_id` : indice numérique du matériau dans les buffers de la scène ;
- `material_mask` : 1 si cet indice est égal à `materialId` (entier 0 à 16777215), sinon 0.

Les autres graphes, espaces, connexions et entrées sans effet sont rejetés, sans approximation.
Les indices de matériau sont locaux à la scène compilée et peuvent changer au rechargement ou après
modification de la scène ; ce ne sont pas des identifiants persistants d'objet ou d'instance.
Les valeurs sont prises au premier hit de surface visible après le test d'opacité, puis moyennées
sur les hits ; les pixels sans hit valent zéro et ceux sans échantillon sont NaN au readback.
Aux contours, un ID peut donc être fractionnaire et un masque donner une couverture partielle.
Une seule sortie est accumulée à la fois (+16 octets/pixel), et changer sa définition relance
l'accumulation. L'affichage est un aperçu linéaire borné à [0, 1], sans tonemapping ni conversion
sRGB ; le PNG contient cet aperçu, le PFM conserve les valeurs flottantes brutes (1 canal pour les
scalaires, 3 pour la position), au nom de l'AOV. Les AOV ne sont pas disponibles en raster ou Disney.
Les expressions MaterialX arbitraires, textures, données d'instance et plusieurs sorties simultanées
ne sont pas prises en charge.

`LightFilterShader` propose les motifs cercle, rayures et grille, avec échelle, rotation et douceur
réglables. Il ne prend en charge que les lumières spot du path tracer MaterialX ; le raster, Disney,
les textures de gobo et les profils IES ne sont pas pris en charge.

`ScatterShader` prend `surfacePath`, `prototypePath`, `density`, `seed`, `scale` et `hidePrototype`.
Il crée un `PointInstancer` et un prototype géométrique partagé par ses placements, compatibles avec
raster, path tracing MaterialX et Disney. La surface et le prototype doivent être des primitives
scriptées (éventuellement déformées), pas des objets importés ou booléens. `hidePrototype` masque
l'objet source sans masquer les instances. La densité littérale est en instances par unité de
surface : le nombre reste `round(surface × density)`.

La densité peut aussi être connectée à un graphe MaterialX évalué sur CPU lors de `scatter()` :
`position` en espace `object` ou `world`, `separate3` vector3, et les nœuds float `constant`,
`add`, `subtract`, `multiply`, `divide`, `min`, `max`, `clamp`. Les autres nœuds (notamment
textures, bruit et coordonnées UV), espaces et backends d'évaluation GPU ne sont pas pris en charge
et sont rejetés, sans repli silencieux. Le résultat doit rester fini et dans [0, 100] à chaque
échantillon. Le graphe est évalué sur des candidats uniformes puis accepté selon la densité locale ;
le nombre est donc statistique, déterministe pour une graine donnée, et limité à 5000 instances
et 1 000 000 de candidats. Les changements ultérieurs du graphe ou de la surface ne redistribuent
pas automatiquement les instances : appeler à nouveau `scatter()` crée un nouvel instancer.

```js
pos = new Position(); pos.space = "world";
xyz = new Separate3("ND_separate3_vector3"); xyz.in = pos.out;
mask = new Clamp("float"); mask.in = xyz.outx; mask.low = 0; mask.high = 1;
d = new Multiply("float"); d.in1 = mask.out; d.in2 = 20;
settings.density = d.out;
await scatter(settings.out);
```

```js
sky = new EnvironmentShader();
sky.model = "sky";
sky.animationSpeed = 12;
await environment(sky.out);

grade = new ImageShader();
grade.contrast = 1.1;
grade.vignette = 0.25;
await postprocess(grade.out);
```

## Rendu

| Fonction | Retour | Effet |
|---|---|---|
| `render.<paramètre> = v` | — | Réglage de rendu (table suivante) ; lecture : valeur courante. |
| `await render()` | échantillons | Relance le rendu et attend une image. |
| `await render(n)` | échantillons | Relance et attend `n` échantillons par pixel du path tracer (ou son arrêt sur convergence / budget de temps). En raster : une image. |
| `await converge(secondes = 600)` | `stats()` | Attend l'arrêt du path tracer ; demande `render.backend = "pathtracing"` et `render.stopOnConvergence = true` ou un `render.timeBudget`. |
| `await capture("x.png", { samples })` | — | Rendu path tracing de `samples` échantillons enregistré en PNG (indépendant de l'accumulation affichée). |
| `await capture("x.png", { samples, shutter: [t0, t1], steps })` | — | Idem avec flou de mouvement sur l'intervalle de temps `[t0, t1]`, réparti sur `steps` sous-images (16 par défaut). |
| `await video("x.mp4", { start, end, fps, samples, shutter, steps })` | — | Rend l'intervalle animé dans une vidéo MP4 ou WebM. |
| `stats()` | objet | État du rendu (ci-dessous). |

`video` capture `[start, end[` en codes temporels USD. `fps` est la cadence de
la vidéo (24 par défaut, au plus 120) ; la cadence USD sert à convertir les
codes temporels en secondes (24 si la scène n'en définit pas). Au plus 3 600
images sont encodées. En path tracing, `samples` (1 par défaut) donne les
échantillons par image et `shutter: [ouverture, fermeture]` donne des décalages
relatifs à chaque image, en codes temporels ; `steps` règle les sous-images.
L'obturateur n'est pas disponible en raster et le moteur Disney n'est pas pris
en charge. L'instant initial est restauré après l'export ; la lecture est mise
en pause. L'encodage nécessite WebCodecs et le codec du format choisi.

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
| `await save("scene.usda")` | scène des primitives du script : couche USD (gprims `Sphere`, `Cube`, `Cylinder`, `Cone`, `Capsule`, `Plane`, `PointLight` ; tore, disque et objets déformés en `Mesh`) et un `<matériau>.mtlx` par matériau, écrits dans le même dossier |
| `await capture("x.png", { … })` | voir [Rendu](#rendu) |
| `await video("animation.mp4", { start: 0, end: 24 })` | vidéo MP4 (ou WebM) ; voir [Rendu](#rendu) |

Les noms peuvent contenir des sous-dossiers (`"seq/frame-01.png"`), pas `..`. Destination :
téléchargement dans le viewer, dossier `--out` avec `npm run script`, téléchargement côté client
pour un [rendu distant](REMOTE_RENDER.md).

## Animation et transformations

`await importMesh("objet.usda", "/Chemin/Mesh")` importe la géométrie locale
d'un prim USD `Mesh` comme objet scriptable. On peut lui affecter `material`,
`translate`, `rotate`, `scale` et une pile `deformers` ; la géométrie triangulée
et ses échantillons de déformation sont incorporés à l'export USD. Seuls les
points, normales et coordonnées `primvars:st` sont conservés : les
transformations et matériaux USD d'origine ne sont pas importés et doivent
être définis sur l'objet du script. Les couches doivent être en USDA et la
géométrie source statique, sans trous ni GeomSubsets, avec
`subdivisionScheme = "none"` et sans autres primvars. Ces cas non pris en
charge sont signalés par une erreur.

| Fonction | Retour | Effet |
|---|---|---|
| `timeline()` | `{ start, end, fps }` ou `undefined` | Intervalle d'une scène animée. |
| `time()` | nombre | Instant courant (code temporel). |
| `await setTime(t)` | — | Évalue la scène à l'instant `t`. |
| `transform({ translate, rotate, scale })` | `number[16]` | Matrice : échelle (nombre ou `[x, y, z]`), puis rotations X, Y, Z en degrés, puis translation. |

La vue affiche une barre de temps pour les scènes animées et les matériaux
utilisant `time` ou `frame`. Elle permet de lire, arrêter et choisir l'instant ;
déplacer le curseur met la lecture en pause. Sans intervalle USD, elle utilise
par défaut les codes 0 à 240 à 24 codes par seconde.

## Lumières et caméra

| Fonction | Retour | Effet |
|---|---|---|
| `lights()` | `{ path, type }[]` | Lumières de la scène. |
| `setLight("/lumière", { intensity, exposure, color, transform })` | — | Modifie les champs donnés (`color` : 3 nombres, `transform` : 16) ; sans changements : valeurs de la scène. |
| `setCamera({ eye, target, fov })` | — | Place la caméra ; `eye`, `target` : 3 nombres ; `fov` : champ vertical en degrés (0–180, facultatif). |

## Variantes USD et paramètres de matériau

| Fonction | Retour | Effet |
|---|---|---|
| `expose(nœud, "entrée", "libellé"?)` | — | Déclare une entrée littérale modifiable dans l'onglet **Paramètres** du script exécuté. |
| `variants()` | `{ path, set, variants, selection }[]` | Variant sets de la scène. |
| `await setVariant("/prim", "set", "variante")` | — | Sélectionne une variante (recomposition). |
| `materialParameters("/objet")` | `{ id, label, type, value, min, max }[]` | Paramètres exposés en uniformes. |
| `await setMaterialParameters("/objet", { id: valeur })` | — | Modifie des paramètres sans recompilation ; valeur : nombre, booléen ou tableau. |

`expose` accepte une entrée littérale ou son défaut du NodeDef, pas une connexion.
Une entrée ne peut être déclarée qu'une fois. L'onglet conserve les types numériques,
booléens, chaînes, énumérations, couleurs, vecteurs et matrices ; il ne liste que les
entrées déclarées par le dernier script exécuté. Les modifications ne changent pas le
texte du script et ne réexécutent pas ses commandes. Elles réappliquent les matériaux
et les shaders d'environnement, d'image, d'AOV ou de filtre de lumière concernés ;
la dispersion est reconstruite sans réexécuter le script. La réapplication d'un
matériau peut nécessiter une recompilation. Pour les presets développés en graphes,
les autres modifications sont conservées ; si une entrée nécessaire a été reconnectée
ou que son nœud ne peut plus être identifié, la modification est refusée.
Les entrées non liées à un shader actif sont refusées. Une erreur pendant une
modification touchant plusieurs cibles peut laisser certaines cibles déjà modifiées :
vérifier le rendu.

Les contrôles appartiennent à l'exécution courante : ils deviennent périmés si la
scène est remplacée et ne sont pas restaurés à l'ouverture d'un projet. Relancer le
script les recrée avec les valeurs du script. Le panneau général des paramètres de
matériau reste indépendant de cet onglet. La reconstruction de la dispersion et le
déplacement d'un filtre de lumière effacent l'historique d'annulation.

## Messages, vérifications et diagnostic

| Fonction | Retour | Effet |
|---|---|---|
| `log(a, b, …)` | — | Message dans la console de l'éditeur (`npm run script` : sortie standard) ; nœuds affichés par leur nom, primitives par leur chemin, objets en JSON. |
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
  `stats`, `converge`, `video`, `importMesh`, `diagnostics`, `capabilities`, `timeline`, `setTime`, `setTransform`,
  `setVisibility`, `lights`, `setLight`, `setCamera`, `variants`, `setVariant`,
  `materialParameters`, `setMaterialParameters`, `expose`, `Math`, les classes de nœuds et les classes de
  primitives (`Sphere`, `Cube`, `Cylinder`, `Cone`, `Capsule`, `Torus`, `Plane`, `Disk`, `PointLight`) ne
  peuvent pas être réaffectés. `material`, `node`, `time`, `transform` et `capture` peuvent servir
  de noms de nœuds (la variable masque alors la fonction). `window`, `document`… restent ceux du
  navigateur : ne pas les utiliser comme noms de variables.
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
