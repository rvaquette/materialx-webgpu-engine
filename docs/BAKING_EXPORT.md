# Cuisson et export des matériaux

Le graphe du matériau offre trois actions de cuisson et d'export :

- **Cuire les cartes** télécharge une archive ZIP avec un document MaterialX
  relié aux cartes `baseColor`, `roughness`, `metalness`, `normal` et `height`.
- **Exporter scène glTF** télécharge un GLB avec les géométries visibles, les
  transformations de la scène et les cartes cuites au format PBR métallique/
  rugosité. Le déplacement actif est déjà appliqué aux sommets, car glTF ne
  définit pas de déplacement de surface standard.
- **Exporter scène USD** télécharge un ZIP avec une scène USDA utilisant
  la hiérarchie composée, ses caméras et lumières, les maillages cuits, et un
  document MaterialX par matériau lié depuis le réseau USD.

La cuisson évalue le graphe MaterialX sur la CPU aux centres des pixels et
utilise les textures résolues par le chargeur de scène. La résolution par
défaut est 512 × 512 pour chaque carte. La carte de couleur est convertie en
sRGB ; les cartes numériques et normales restent des données linéaires. Les
cartes de hauteur sont normalisées dans le PNG et leur plage est réappliquée
dans le document MaterialX. Pour les exports de scène, un rasteriseur UV
barycentrique interpole les positions, normales et tangentes du maillage ; une
géométrie ou une instance reçoit ses propres cartes.

La cuisson d'un matériau de scène requiert des coordonnées UV sur la géométrie.
Un graphe contenant une texture dont le fichier ne peut être résolu ou décodé
est refusé explicitement. Les matériaux non compilés sont exportés avec leurs
constantes raster disponibles. L'USDA conserve la hiérarchie composée, les
attributs de scène, les caméras et les lumières ; les maillages rendus sont
écrits comme géométrie triangulée à la pose courante. L'export glTF reste un
GLB avec géométries visibles, transformations et matériaux PBR cuits.
L'USDA sérialise la composition déjà résolue plutôt que les arcs vers les
couches USD sources ; les maillages exportés ne conservent donc pas leur
animation de géométrie.

Les sorties numériques `float`, `integer`, `boolean`, `color3` et `vector3` des
aperçus de nœuds sont évaluées en CPU comme une image UV plane, sans déformation
par une géométrie sphérique. Les autres types d'outputs utilisent l'aperçu
raster existant ; un type ou un nœud que le backend CPU ne peut pas évaluer
signale une erreur au lieu de produire une image de repli.

L'exemple [p13-baked-material.js](../examples/scripts/p13-baked-material.js)
crée un matériau procédural rendu en raster et en path tracing. Après son
exécution, ouvrir le graphe du matériau dans le viewer pour déclencher la
cuisson et les exports.
