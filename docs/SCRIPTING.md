# Scripts de matériaux MaterialX

Le viewer permet de créer un matériau MaterialX avec un script JavaScript
minimal. Ouvrir l'éditeur avec le bouton **Script** ou la touche **F2**.

## Syntaxe

```js
img = new Image();               // créer un nœud : variable = new <Nœud>()
img.file = "textures/wood.jpg";  // valeur d'une entrée
surface = new StandardSurface();
surface.base_color = img.out;    // connexion : entrée = nœud.sortie
surface.specular_roughness = 0.3;
```

- Le nom de la variable devient le nom du nœud MaterialX (`img`, `surface`).
  `const`/`let`/`var` sont acceptés et ignorés.
- Les classes sont les catégories MaterialX en PascalCase :
  `standard_surface` → `StandardSurface`, `fractal3d` → `Fractal3d`,
  `surfacematerial` → `Surfacematerial`.
- Valeurs : nombres, booléens, chaînes et tableaux (`[0.8, 0.2, 0.1]`). Un
  nombre affecté à une couleur ou un vecteur est répété sur chaque composante.
- `noeud.out` (ou une autre sortie, ex. `sep.outr`) connecte une sortie ; un
  nœud à sortie unique peut être affecté directement (`m.fg = img`).
- `noeud.colorspace = "srgb_texture"` fixe l'espace colorimétrique du nœud ;
  l'export l'écrit sur ses entrées `filename`, là où le moteur le lit.
- Sans `Surfacematerial`, l'export ajoute un `surfacematerial` nommé
  `material` relié au dernier shader de surface.
- Le reste du langage JavaScript reste disponible (boucles, `Math`...).

## Nœuds résolus à l'instanciation

Aucun nœud n'est codé en dur : `new Image()` cherche, au moment de son
exécution, les `<nodedef>` de catégorie `image` dans les bibliothèques
MaterialX servies sous `/materialx/libraries` (stdlib, pbrlib, cmlib, bxdf).
Les entrées (type, valeur par défaut, `enum`, bornes UI) et les sorties
viennent du NodeDef choisi ; l'héritage (`inherit`) et la version par défaut
sont pris en compte.

Pour un nœud polymorphe, la variante par défaut est la sortie `color3`, puis
`float`, `vector3`... avec le nom de NodeDef le plus simple. Un argument
choisit une autre variante :

```js
noise = new Fractal3d("float");             // type de sortie
blend = new Mix("ND_mix_color3_color3");    // nom de NodeDef
```

Chaque affectation est vérifiée : entrée inconnue, type de valeur incorrect ou
connexion entre types différents produisent une erreur avec la ligne fautive.

## Éditeur

- **Colorisation** : nœuds, variables, entrées, sorties ; une entrée inconnue
  est soulignée en rouge.
- **IntelliSense** (automatique ou Ctrl+Espace) : classes après `new`, variantes
  dans `new Mix("`, entrées et sorties après `variable.` (les sorties en premier
  à droite d'un `=`).
- **Helpers de valeurs** : sur une ligne `noeud.entree = valeur`, un contrôle
  adapté au type modifie la valeur : sélecteur de couleur, case à cocher,
  curseur et champ numérique (bornes du NodeDef), liste pour les `enum`,
  composantes des vecteurs.
- **Script → XML** / **XML → Script** : conversion dans les deux sens.
- **Matériau → Script** : convertit le matériau de l'objet sélectionné, tel que
  le moteur l'a résolu (valeurs modifiées dans l'interface comprises, textures en
  URL absolues), y compris sur les scènes précompilées. Appliquer ce script
  redonne le même rendu.
- **Appliquer** (Ctrl+Entrée) : remplace le matériau de l'objet sélectionné.
  Sur une scène source (USD, glTF), la scène est rechargée avec le document.
  Sur une scène précompilée, le document est compilé à la volée dans le
  navigateur sur un quad sonde (comme `npm run compile:scenes` pour la
  bibliothèque, sans écrire de paquet) puis lié à l'objet ; raster et path
  tracer l'utilisent. Les textures relatives sont résolues par rapport à la
  page du viewer.
- **Exporter .mtlx** télécharge le document ; Échap ferme l'éditeur.

## Import des documents MaterialX

Un script n'a pas de `nodegraph` : l'import les **aplatit**. Les nœuds des
graphes rejoignent le script (préfixés par le nom du graphe en cas de conflit,
ex. `NG_img`), les sorties de graphe (`nodegraph="NG" output="out"`) se
connectent au nœud qui les produit, et les entrées d'interface (`interfacename`)
sont remplacées par leur valeur ou leur connexion. Les `fileprefix` imbriqués
sont appliqués aux chemins de texture, le `colorspace` des textures est
conservé, et les versions explicites de NodeDef (`nodedef="…_100"`) sont
respectées. Les éléments sans effet sur l'ombrage (`look`, `materialassign`,
`backdrop`...) sont ignorés.

Un nœud dont le NodeDef est **défini dans le document** (`<nodedef>` +
`<nodegraph nodedef="…">`) est remplacé par les nœuds de son implémentation,
préfixés par le nom de l'instance en cas de conflit ; ses entrées, ou à défaut
les valeurs par défaut du NodeDef, alimentent l'interface du graphe. Le script
ne contient ainsi que des nœuds des bibliothèques standard. Une implémentation
en code source ou récursive est refusée avec un message explicite.

Les **`<xi:include>`** sont intégrés avant la conversion (`inlineIncludes`) :
chaque document inclus n'est lu qu'une fois et ses `fileprefix` deviennent
absolus, pour que ses textures restent résolues par rapport à son propre
dossier. Dans l'éditeur, les `href` relatifs d'un XML collé sont résolus par
rapport à la page du viewer.

Sur la bibliothèque `scenes/mtlx-library`, 804 documents sur 869 (dont 507 avec
nodegraphs) se convertissent ; le reste est invalide au sens MaterialX (entrées
inexistantes, conversions implicites, noms dupliqués) ou utilise
`viewdirection`, défini dans `nprlib` que le moteur ne charge pas. Les rendus
d'origine et convertis vérifiés (nodegraphs, `colorspace`, `xi:include`) sont
identiques au pixel près.

## Code

- [src/materialx/script-api.ts](../src/materialx/script-api.ts) : bibliothèque de
  NodeDefs, exécution des scripts, conversions XML ⇄ script.
- [src/materialx/script-editor.ts](../src/materialx/script-editor.ts) : éditeur
  et attachement au viewer.

## Tests

```bash
npx vitest run tests/materialx/script-api.test.ts tests/materialx/script-editor.test.ts
npm run test:playwright        # Chromium headless
npm run test:playwright:demo   # navigateur visible et ralenti
```

L'application du matériau n'est testée que si le navigateur expose WebGPU
(ignorée en headless).
