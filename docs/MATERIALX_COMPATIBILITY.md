# MaterialX officiel : compatibilité et interopérabilité

Ce guide répond à trois questions différentes : le document est-il valide,
ses définitions et graphes sont-ils résolus, et le rendu est-il équivalent ?
Une réponse positive à l'une ne prouve pas les autres. Les résultats ci-dessous
ne constituent pas une certification générale MaterialX.

## Référence et méthode

La référence documentaire est la [spécification MaterialX 1.39](https://github.com/AcademySoftwareFoundation/MaterialX/blob/bea1e9251d8f936a73930ad19a6f3b37265d46f5/documents/Specification/MaterialX.Specification.md),
les [nœuds standard](https://github.com/AcademySoftwareFoundation/MaterialX/blob/bea1e9251d8f936a73930ad19a6f3b37265d46f5/documents/Specification/MaterialX.StandardNodes.md)
et les [nœuds PBR](https://github.com/AcademySoftwareFoundation/MaterialX/blob/bea1e9251d8f936a73930ad19a6f3b37265d46f5/documents/Specification/MaterialX.PBRSpec.md).
Les définitions et sources de référence sont celles du dépôt officiel au commit
`bea1e9251d8f936a73930ad19a6f3b37265d46f5`, MaterialX **1.39.6** :
[bibliothèques](https://github.com/AcademySoftwareFoundation/MaterialX/tree/bea1e9251d8f936a73930ad19a6f3b37265d46f5/libraries),
[générateur GLSL](https://github.com/AcademySoftwareFoundation/MaterialX/tree/bea1e9251d8f936a73930ad19a6f3b37265d46f5/source/MaterialXGenGlsl)
et [générateur OSL](https://github.com/AcademySoftwareFoundation/MaterialX/tree/bea1e9251d8f936a73930ad19a6f3b37265d46f5/source/MaterialXGenOsl).
Ces sources servent de référence ; aucun générateur officiel GLSL ou OSL n'est
exécuté dans le pipeline WGSL du moteur, et les exemples ci-dessous ne sont pas
une comparaison de pixels avec un renderer officiel.

Le moteur emploie le Core officiel pour la lecture et la validation structurelle,
puis son propre IR et ses générateurs WGSL. Les 28 fichiers chargés par défaut
sont listés dans [default-library-files.json](../src/materialx/default-library-files.json)
et le Core minimal est épinglé à ce commit ; voir [dependencies.md](dependencies.md#materialx-javascript-core-wasm).
La validation `Document.validate()` ne vérifie ni la prise en charge de tous les
nœuds par un backend, ni la fidélité des pixels.

## Comment examiner un matériau

1. Relever les catégories, NodeDefs, types, entrées connectées et littérales,
   les sorties, espaces, unités, couleurs et chemins de textures. L'interface
   **Documentation des nœuds** donne les variantes et entrées des bibliothèques
   chargées ; l'[inventaire consultable](generated/materialx-nodedefs.json)
   contient les NodeDefs sélectionnables par le script, leurs types, entrées,
   valeurs littérales par défaut reconnues et sorties. `library` désigne les
   fichiers officiels chargés ; `engine`, les définitions du moteur. Une valeur
   absente de l'inventaire ne prouve pas l'absence de `defaultgeomprop`, de
   valeur héritée ou de sémantique dans la bibliothèque officielle. Les anciennes
   versions résolubles par nom explicite ne sont pas toutes listées.
2. Identifier les éventuelles catégories et types `engine` dans la
   [matrice](#matrice-par-famille-et-backend), et consulter les diagnostics du
   graphe et du backend. Une entrée non renseignée hérite de sa NodeDef
   résolue ; une connexion ou une version explicite peut changer le résultat.
3. Vérifier les restrictions de chaque backend et les textures réellement
   disponibles. Un diagnostic de repli, une valeur neutre ou une approximation
   n'est pas une équivalence. La [liste historique du corpus](materialx-node-coverage.md)
   et [conformance.md](conformance.md) ne couvrent que leurs cas de test, pas
   toute la bibliothèque officielle.
4. Choisir l'[export](#export-et-exemples) adapté et tester le fichier, ses
   dépendances et le rendu dans l'application cible.

## Matrice par famille et backend

`P` : partiel ou limité aux cas indiqués ; `A` : approximation ; `N` : non
pris en charge pour ce cas ; `E` : extension moteur ; `?` : équivalence non
établie. `P` ne signifie pas conforme pour toutes les variantes. Raster et
PT désignent les deux backends MaterialX ; Disney est le backend Disney séparé.
CPU désigne l'évaluation de valeurs et la cuisson, pas un renderer complet.

| Cas / types et entrées concernés | Raster | PT | Disney | CPU / cuisson | Détails et preuves |
| --- | --- | --- | --- | --- | --- |
| `constant`, `add`, `multiply`, `mix` numériques | P | P | P | P | IR partagé et tests par cas ; variantes et conversions dépendent des types. Disney n'accepte que certains graphes convertibles. |
| `standard_surface`, paramètres de surface | P | P | A | P | Raster/PT évaluent des closures ; Disney convertit un sous-ensemble, avec avertissements et rejets ; la cuisson produit des cartes, pas la closure entière. |
| `open_pbr_surface`, `gltf_pbr`, `UsdPreviewSurface` | P | P | N | P | Prise en charge dépendant des entrées et du graphe ; Disney refuse les familles autres que `standard_surface` et `disney_principled`. |
| `disney_principled` littéral | P | P | A | P | Les conventions du modèle Disney diffèrent ; des entrées connectées sont refusées par sa conversion directe. |
| `BSDF`, `EDF`, `VDF`, `surfaceshader` | P/A | P | P/A | N | Transport et éclairage diffèrent ; l'interpréteur numérique ne retourne pas une closure. La cuisson extrait des cartes de paramètres. |
| Sous-surface `subsurface_bsdf` | A | P | A | P | Raster : repli diffus sans propagation sous la surface ; Disney remplace rayon, couleur et anisotropie ; PT utilise son transport. |
| Transmission / réfraction | A | P | P/A | P | Raster : réfraction de l'environnement, pas des objets derrière ; Disney accepte seulement certains paramètres de milieu. |
| Volume spatial `volumeshader`, `VDF` | A | A | N | P | Champ échantillonné sur une grille CPU 32³ ; les algorithmes raster et PT diffèrent. |
| `image`, `tiledimage`, UDIM et filtres | P | P | P/A | P | Décodage, couleurs, adressage et ressources influencent le résultat ; Disney utilise un échantillonnage au plus proche pour ses graphes acceptés. |
| `triplanarprojection.filtertype="cubic"` | A | A | N | A | Filtre cubique remplacé par linéaire avec avertissement. |
| `position`, `normal`, `tangent`, `bitangent`, `space` | P | P | P | P | Cas objet/modèle/monde pris en charge dans les chemins concernés ; un espace non résolu ou non supporté déclenche un avertissement et un repli. Tangente index 0 seulement dans ces transformations. |
| `geompropvalue` | P | P | P | P | `st`/`UV0` vector2 et certains champs de volume ; autres propriétés : avertissement et valeur par défaut déclarée. |
| `float`, `integer`, `boolean`, `color3`, `vector3` | P | P | P | P | Types numériques des aperçus CPU ; chaque nœud et sortie doit aussi être évaluable. |
| `vector2`, `vector4`, `color4`, matrices | P | P | ? | P | Types et opérations IR existent ; les sorties d'aperçu CPU prises en charge sont plus limitées. |
| `string`, `filename`, types tableau | P | P | P | N | Utilisés pour la résolution et certains paramètres ; pas des valeurs numériques arbitraires à cuire. |
| Unités `unit`, `unittype` | ? | ? | ? | ? | Métadonnées conservées dans le graphe et l'export ; leur conservation ne démontre pas une conversion générale des unités. |
| Espaces colorimétriques et conversions | P | P | A | P | Conversions explicites et ensemble fini de transformations ; les textures, le décodage et le tonemapping doivent être vérifiés séparément. Pas de garantie OCIO générale. |
| Shaders `environment_shader`, `image_shader`, `lens_shader`, AOV, filtre et scatter | E | E | E/? | N | Définitions et sémantiques moteur ; la disponibilité dépend de la fonction et du backend, pas d'un shader de surface MaterialX standard. |
| Préréglages `water`, `lava`, `fire`, etc. | E/P | E/P | ? | P | NodeDefs moteur ; certains s'exportent développés en nœuds standard. Le rendu et les capacités de l'hôte restent à vérifier. |

Un espace `?` ou une variante non listée doit être vérifié, pas supposé
conforme. Les catégories exactes, signatures et défauts se recherchent dans
l'inventaire, l'interface et les définitions officielles : ils ne sont pas
indépendamment certifiés par cette matrice.

Pour `standard_surface` dans Disney, `base` est multiplié dans `base_color`,
`diffuse_roughness` est remplacé par le carré de `specular_roughness`, et la
couleur de transmission par la couleur de base. La sous-surface, le sheen et
le coat sont approximés ; l'opacité colorée est moyennée. La conversion rejette
notamment les terminaux de volume ou displacement, la face arrière, les films
minces, `thin_walled`, certains milieux de transmission et les connexions non
reconnues. Seuls certains graphes de textures sont convertis, avec filtrage au
plus proche et adressage périodique. Les avertissements et erreurs détaillés
figurent dans [disney-standard-material.ts](../src/render/pathtracing/disney-standard-material.ts)
et [disney-texture-graphs.test.ts](../tests/render/pathtracing/disney-texture-graphs.test.ts).

## Écarts et replis vérifiés

| Cas et effet visible | Référence officielle | Code du moteur | Test |
| --- | --- | --- | --- |
| Espace caméra non résolu : avertissement et données monde ; index de tangente non nul : index 0. Placement ou normale peuvent changer. | [Nœuds géométriques 1.39](https://github.com/AcademySoftwareFoundation/MaterialX/blob/bea1e9251d8f936a73930ad19a6f3b37265d46f5/documents/Specification/MaterialX.StandardNodes.md#geometric-nodes) | [surface-ir.ts](../src/compiler/surface-ir.ts) | [surface-ir.test.ts](../tests/compiler/surface-ir.test.ts) |
| Propriété géométrique non prise en charge : avertissement et défaut déclaré, pas la donnée de l'objet. | [geompropvalue](https://github.com/AcademySoftwareFoundation/MaterialX/blob/bea1e9251d8f936a73930ad19a6f3b37265d46f5/libraries/stdlib/stdlib_defs.mtlx) | [surface-ir.ts](../src/compiler/surface-ir.ts) | [surface-ir.test.ts](../tests/compiler/surface-ir.test.ts) |
| `splitlr` et `splittb` utilisent une frontière dure plutôt que l'antialiasing GLSL de référence : contour différent. | [mx_splitlr_float.glsl](https://github.com/AcademySoftwareFoundation/MaterialX/blob/bea1e9251d8f936a73930ad19a6f3b37265d46f5/libraries/stdlib/genglsl/mx_splitlr_float.glsl) | [surface-ir.ts](../src/compiler/surface-ir.ts) | [surface-ir.test.ts](../tests/compiler/surface-ir.test.ts) |
| `triplanarprojection` cubique devient linéaire avec avertissement ; l'image est moins lisse que le filtre demandé. | [NodeDefs standard](https://github.com/AcademySoftwareFoundation/MaterialX/blob/bea1e9251d8f936a73930ad19a6f3b37265d46f5/libraries/stdlib/stdlib_defs.mtlx) | [surface-ir.ts](../src/compiler/surface-ir.ts) | [surface-ir.test.ts](../tests/compiler/surface-ir.test.ts) |
| La conversion Disney de `standard_surface` replie notamment l'opacité colorée sur sa moyenne et refuse les milieux non représentables ; la couleur ou le transport changent. | [standard_surface](https://github.com/AcademySoftwareFoundation/MaterialX/blob/bea1e9251d8f936a73930ad19a6f3b37265d46f5/libraries/bxdf/standard_surface.mtlx) | [disney-standard-material.ts](../src/render/pathtracing/disney-standard-material.ts) | [disney-standard-material.test.ts](../tests/render/pathtracing/disney-standard-material.test.ts) |
| Une texture nécessaire non résolue ou non décodée est refusée par la cuisson ; l'interpréteur IR bas niveau peut lui utiliser une valeur neutre si aucun sampler n'est fourni. | [nœuds de texture](https://github.com/AcademySoftwareFoundation/MaterialX/blob/bea1e9251d8f936a73930ad19a6f3b37265d46f5/documents/Specification/MaterialX.StandardNodes.md#texture-nodes) | [bake.ts](../src/materialx/bake.ts), [ir-eval.ts](../src/compiler/ir-eval.ts) | [ir-eval.test.ts](../tests/compiler/ir-eval.test.ts) |
| Nœud amont sans abaissement WGSL : avertissement et constante neutre ; la contribution peut disparaître. | [nœuds standard](https://github.com/AcademySoftwareFoundation/MaterialX/blob/bea1e9251d8f936a73930ad19a6f3b37265d46f5/documents/Specification/MaterialX.StandardNodes.md) | [surface-ir.ts](../src/compiler/surface-ir.ts) | [surface-ir.test.ts](../tests/compiler/surface-ir.test.ts) |
| Volume spatial discrétisé : les détails plus fins que la grille peuvent disparaître. | [VDF PBR](https://github.com/AcademySoftwareFoundation/MaterialX/blob/bea1e9251d8f936a73930ad19a6f3b37265d46f5/documents/Specification/MaterialX.PBRSpec.md) | [volume-field.ts](../src/render/volume-field.ts) | [volume-field.test.ts](../tests/render/volume-field.test.ts) |

Les limites GPU et les replis du viewer sont décrits dans
[INTEGRATION.md](INTEGRATION.md#politiques-de-repli). Les captures peuvent
rejeter une erreur au lieu de changer de backend.

## Extensions du moteur

[engine-shaders.ts](../src/materialx/engine-shaders.ts) définit les types
`engine_environment_shader`, `engine_image_shader`, `engine_aov_shader`,
`engine_light_filter_shader` et `engine_scatter_shader`, et les catégories
`environment_shader`, `image_shader`, `lens_shader`, `aov_shader`,
`custom_aov_shader`, `light_filter_shader`, `scatter_shader` ainsi que
`ND_engine_volume_material`. Ils ne sont pas des définitions officielles :
fournir la NodeDef seule ne fournit pas son implémentation dans un autre outil.
La lentille, les AOV, gobos et scatter ont des restrictions de backend et
d'entrées précisées dans [SCRIPT_REFERENCE.md](SCRIPT_REFERENCE.md).

[engine-presets.ts](../src/materialx/engine-presets.ts) ajoute `water`,
`water_caustics`, `lava`, `fire`, `smoke`, `clouds`, `ice`, `mud` et
`wet_sand`. Ce sont des catégories propres au moteur, dont les graphes internes
emploient de nombreux nœuds standard ; il ne faut pas les confondre avec des
NodeDefs officielles. L'API JavaScript (`new Sphere()`, `render.*`,
`postprocess()`, etc.), les réglages de scène et les attributs USD `engine:`
ne sont pas des éléments de la spécification MaterialX.

## Export et exemples

Lancer [p28-materialx-compatibility.js](../examples/scripts/p28-materialx-compatibility.js)
depuis le menu Scripts ou avec
`npm run script -- examples\scripts\p28-materialx-compatibility.js --out docs\images\p28`.
Il affiche une sphère standard et une sphère `Water`, avec un `ImageShader`
moteur appliqué à l'image :

- [p28-standard.mtlx](images/p28/p28-standard.mtlx) : `standard_surface` et
  terminal standard, sans nœud moteur ;
- [p28-water.mtlx](images/p28/p28-water.mtlx) : le préréglage `Water` est
  développé à l'export en nœuds standard, y compris les terminaux surface et
  déplacement. Un hôte externe doit néanmoins implémenter ces nœuds, le temps,
  le déplacement et leurs sémantiques ; la validation ne garantit pas son rendu ;
- le post-traitement `ImageShader`, la caméra et la scène sont des opérations
  du moteur et ne sont **pas** contenus dans ces exports de matériau.

Les deux fichiers fournis ont été validés structurellement avec le Core et les
bibliothèques officielles épinglés par
[core-resolution.test.ts](../tests/materialx/core-resolution.test.ts), sans
promesse d'équivalence de rendu. Ils ne référencent aucune texture. Le lanceur
de script ajoute un `fileprefix` correspondant à son serveur local ; dans ces
copies sans fichiers externes, il a été retiré. Pour un matériau texturé, il
faut au contraire empaqueter les textures et réécrire leurs chemins, par
exemple avec l'export du graphe.

Pour une extension sans implémentation dans l'outil cible, fournir la définition
**et** une implémentation compatible, développer le graphe si possible, ou cuire
les cartes pertinentes. Certains préréglages de volume utilisent le terminal
`ND_engine_volume_material` et ne deviennent donc pas automatiquement
portables à l'export. La [cuisson](BAKING_EXPORT.md) fige les valeurs, UV,
géométrie et temps évalués : elle ne préserve ni la procédure, ni l'animation,
ni nécessairement tous les lobes ou effets de transport. Les shaders d'image,
de caméra, AOV et certaines opérations de scène n'ont pas d'équivalent
MaterialX portable général ; reconstruire l'effet dans l'outil cible.

![Comparaison des matériaux et du post-traitement](images/p28/p28-materialx-compatibility.png)

## Maintenance

À chaque ajout de NodeDef, changement de lowering, backend ou bibliothèque :
actualiser cette matrice, les écarts et leurs tests, les exemples et leurs
exports. Régénérer l'inventaire avec un checkout officiel propre au commit
épinglé :

```powershell
npx vite-node scripts\materialx-compatibility-inventory.ts <chemin-vers-libraries>
```

Le script refuse un autre commit ou des bibliothèques modifiées. Il reflète les
NodeDefs sélectionnables du script, pas la couverture de rendu. Lors d'une mise
à jour MaterialX, changer explicitement la référence épinglée, relancer les
tests de résolution et de rendu pertinents, et conserver les cas non vérifiés
comme tels. Les pistes futures ne sont pas des capacités actuelles.
