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
- **Script → XML** / **XML → Script** : conversion dans les deux sens. L'import
  lit les documents plats (nœuds et `input`), pas encore les `nodegraph`.
- **Appliquer** (Ctrl+Entrée) : remplace le matériau de l'objet sélectionné.
  Disponible sur les scènes source (USD, glTF) ; les scènes précompilées
  exigent un paquet compilé. Les textures relatives sont résolues par rapport à
  la page du viewer.
- **Exporter .mtlx** télécharge le document ; Échap ferme l'éditeur.

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
