# Pistes d'évolution du moteur

Le moteur sait déjà charger des scènes USD variées, compiler des graphes
MaterialX multi-matériaux, rendre avec des backends raster et path tracing, et
valider la fidélité des BSDF sur GPU. Les prochaines évolutions doivent donc
prioriser la transformation de ce socle technique en outil de rendu complet,
mesurable, réutilisable et extensible.

Les priorités 1 (rendu progressif), 2 (API de bibliothèque), 3 (éditeur de
matériaux MaterialX), 3bis (scripting), 4 (accélération du path tracer), 5
(scènes dynamiques), 6 (volumes et effets avancés), 7 (robustesse,
portabilité et exploitation) et 8 (primitives et scènes par script) sont
traitées ; leur historique est dans
[ROADMAP_DONE.md](ROADMAP_DONE.md). Les limites connues sont recensées dans
[INTEGRATION.md](INTEGRATION.md#limites-connues).

Les priorités suivantes visent à passer d'un moteur de rendu MaterialX à un
outil de création : construire des scènes, explorer et documenter les nœuds,
étendre MaterialX à de nouveaux types de shaders et exporter le résultat.

## Reliquats des priorités traitées

Aucun.

## Priorité 9 : displacement procédural

Le displacement actuel (`src/render/displacement.ts`) déplace les sommets sur
CPU à partir d'une seule texture de hauteur. L'étendre à tout le graphe :

- évaluation complète du `displacementshader` (bruits, fractales, ondes,
  textures combinées) dans une passe compute WebGPU ; repli sur l'évaluateur IR
  CPU pour les petits maillages ;
- displacement vectoriel en plus du displacement scalaire selon la normale ;
- recalcul des normales et tangentes, puis reconstruction du BVH ;
- displacement animé via l'entrée `time` (eau, vent, drapeau) en s'appuyant sur
  les scènes dynamiques de la priorité 5 ;
- subdivision adaptative en option.

**Critère d'aboutissement :** un `Plane` subdivisé (priorité 8) devient un terrain ou une
surface d'eau animée décrits uniquement par un graphe MaterialX.

## Priorité 10 : documentation intégrée des nœuds MaterialX

Un panneau dockview de référence, généré autant que possible :

- signature de chaque nœud (entrées, types, valeurs par défaut, variantes de
  type) lue dans les nodedefs chargées ;
- description tirée de la spécification MaterialX (Apache-2.0, avec
  attribution) ;
- statut de support par backend, repris de
  [materialx-node-coverage.md](materialx-node-coverage.md) ;
- cas d'usage : un exemple de script exécutable par nœud (« Ouvrir dans
  l'éditeur »), rédigé à la main pour les 40 à 50 nœuds les plus courants,
  minimal pour les autres ;
- vignette rendue du nœud appliqué sur une sphère (priorité 8) ;
- aide contextuelle : infobulle ou F1 sur un nœud du graphe et dans
  l'autocomplétion CodeMirror.

**Critère d'aboutissement :** chaque nœud de la bibliothèque standard a une page
avec signature, statut et exemple exécutable, vérifiée par un test qui exécute
tous les exemples.

## Priorité 11 : aperçus par nœud et bibliothèque de matériaux

- Vignette de la sortie intermédiaire de chaque nœud dans le graphe, mise à jour
  à l'édition.
- Bibliothèque de matériaux avec vignettes générées hors écran, recherche et
  glisser-déposer sur un objet.
- Import depuis des bibliothèques ouvertes (MaterialX Library de GPUOpen,
  AmbientCG, Physically Based).

**Critère d'aboutissement :** créer un matériau ne demande plus de lancer un
rendu complet pour voir l'effet d'un nœud.

## Priorité 12 : environnement et post-traitement

Deux nouveaux types de shaders, déclarés comme `typedef` de sémantique `shader`
et `nodedef` dans une bibliothèque d'extension, pour que les documents restent
du MaterialX valide :

- **environment shader** : ciel ou fond procédural évalué selon la direction
  (dégradé, ciel physique, studio), animable et échantillonné par le path tracer
  comme une carte HDR ;
- **image shader de post-traitement** : graphe appliqué à l'image finale et aux
  AOV (tone mapping, étalonnage, LUT, vignettage, bloom), `texcoord` désignant
  les coordonnées écran ; appliqué après l'accumulation, sans toucher au cœur du
  rendu.

**Critère d'aboutissement :** une scène s'éclaire sans HDRI et son rendu final
est étalonné par un graphe, en raster comme en path tracing.

## Priorité 13 : baking et export

- **Bake shader** : rendu d'un graphe vers une texture, réutilisé par les
  vignettes (priorités 10 et 11).
- Cuisson d'un matériau procédural en cartes (couleur de base, rugosité,
  métal, normales, hauteur).
- Export de la scène et des matériaux modifiés en USD et `.mtlx`, et en glTF
  avec textures cuites.

**Critère d'aboutissement :** une scène créée et éditée dans l'application
s'ouvre dans un autre outil avec un rendu équivalent.

## Priorité 14 : lookdev et projets

- Comparaison A/B de deux matériaux en écran partagé.
- Turntable (objet ou lumière) avec capture d'image ou de séquence.
- Préréglages d'éclairage (HDRI de studio, extérieur, environnements de la
  priorité 12).
- Annuler/rétablir global sur la scène et les matériaux, au-delà de l'éditeur de
  script.
- Sauvegarde et réouverture d'un projet (scène, matériaux modifiés, réglages,
  script) dans un seul fichier.

**Critère d'aboutissement :** une session de lookdev se reprend à l'identique
après fermeture du navigateur.

## Priorité 15 : opérations booléennes

- Union, différence et intersection de maillages fermés via `manifold-3d`
  (WASM, Apache-2.0), qui conserve les attributs par sommet (UV, normales).
- Arbre non destructif décrit par script dans le même style objet
  (`cut = new Difference(); cut.base = box; cut.tool = ball; cut.material = surface;`),
  évalué en maillage puis traité comme une géométrie ordinaire par les deux
  backends ; les opérandes deviennent invisibles.
- Diagnostic explicite pour les maillages non fermés.
- Hors périmètre : chanfreins, historique de modélisation, édition interactive.

**Critère d'aboutissement :** une pièce construite par booléens à partir des
primitives se rend sans défaut de normales ni de UV.

## Priorité 16 : shaders d'extension

Autres types de shaders, sur le même principe que la priorité 12 :

- **light filter / gobo** : masque procédural ou profil IES sur une lumière,
  levant le rejet actuel du light shaping (voir [usd-import.md](usd-import.md)) ;
- **camera / lens shader** : forme du bokeh, distorsion, aberration chromatique,
  projections fisheye et panoramiques ;
- **AOV shader** : sorties personnalisées (masques, identifiants, données) pour
  le compositing et le débogage de matériaux ;
- **scatter shader** : densité MaterialX répartissant des instances sur une
  surface (herbe, cailloux, gouttes), via l'instanciation existante.

**Critère d'aboutissement :** chaque type est utilisable par script et dans le
graphe, avec son statut de support par backend documenté.

## Priorité 17 : surfaces complexes (eau, lave, feu, fumée, nuages, …)

Des surfaces « vivantes » prêtes à l'emploi, construites uniquement avec les
briques précédentes (primitives 2D, displacement procédural animé, volumes,
émission) et livrées comme matériaux MaterialX paramétrables :

- **eau** : houle et vagues procédurales (somme d'ondes de Gerstner ou spectre
  de bruit) en displacement animé, normales de détail, transmission et IOR,
  absorption volumique par profondeur, écume selon la pente ou la crête ;
- **lave** : croûte sombre fissurée (Worley/Voronoi), émission par température
  (corps noir) dans les fissures, écoulement animé par advection de bruit,
  displacement de la croûte ;
- **feu** : flammes en volume émissif borné par une primitive (cône ou
  capsule), densité et température tirées d'un bruit 3D advecté vers le haut et
  atténué avec la hauteur, émission par corps noir (cœur bleu-blanc, pointes
  orangées), surmontées de fumée (ci-dessous) ; éclairage de la scène par
  le feu en path tracing (volume émissif échantillonné, scintillement animé) et
  repli raster en lumière ponctuelle teintée ; braises en particules (`Points`)
  émissives optionnelles ;
- **fumée** : volume diffusant et absorbant (albédo élevé, fumée claire de bois ;
  albédo faible, fumée noire d'incendie) borné par une primitive ou un panache ;
  densité tirée d'un bruit fractal 3D advecté vers le haut, qui s'élargit, se
  dilue et se disperse avec la hauteur et le vent ; anisotropie de diffusion
  (Henyey-Greenstein) pour le contre-jour ; variante colorée (fumigène) ;
  ombres portées et diffusion multiple en path tracing, passe volume en raster ;
  source libre ou attachée à un feu, à une cheminée ou à de la lave ;
- **nuages** : volumes à très forte diffusion (albédo proche de 1) en couche
  d'altitude ou en nuages isolés bornés par des primitives ; forme par bruit de
  Perlin-Worley à plusieurs échelles érodé sur les bords, profil vertical par
  type (cumulus à base plate et sommet bourgeonnant, stratus en nappe, cirrus
  fibreux), couverture et densité réglables ; diffusion multiple
  approchée (lobes avant/arrière, assombrissement « powder » sur les bords) et
  liseré argenté en contre-jour ; ombres portées sur le sol, éclairage par le
  ciel de la priorité 12 ; dérive animée par le vent ; repli raster par
  marche de rayons à pas réduit ;
- autres préréglages : glace (diffusion sous-surfacique, inclusions), boue ou
  sable mouillé (mélange selon un masque d'humidité) ;
- chaque surface expose quelques paramètres de haut niveau (vitesse, échelle,
  couleur, intensité) plutôt que tout le graphe, en `nodegraph` réutilisable ;
- script : `water = new Water(); water.speed = 0.5; pool.material = water;` ;
- éclairage cohérent : la lave éclaire la scène en path tracing (émission
  échantillonnée), l'eau réfracte et caustiques au path tracer ;
- vérification raster/path tracing et rendus golden pour chaque préréglage.

**Critère d'aboutissement :** une scène « plan d'eau », une scène « coulée de
lave », un « feu de camp », un panache de fumée et un ciel de cumulus
s'obtiennent en quelques lignes de script, animés et sans texture externe ; le
feu éclaire la scène, sa fumée et les nuages projettent des ombres en path
tracing.

## Priorité 18 : déformation volumique de surfaces complexes

Déformer une surface (primitive, maillage importé, surface complexe de la
priorité 17) par un champ défini dans l'espace plutôt que sommet par sommet,
pour plier, tordre ou faire onduler des objets entiers et les animer :

- **déformeurs paramétriques** : courbure (bend), torsion (twist), effilement
  (taper), cisaillement, vague, sphérisation, chacun avec son axe, sa zone
  d'influence et une atténuation ;
- **déformation par treillis (FFD)** : une grille de points de contrôle
  englobe l'objet ; déplacer ces points déforme tout ce qui est à l'intérieur
  (interpolation de Bézier ou B-spline) ;
- **champs volumiques** : déplacement lu dans un bruit 3D, un graphe MaterialX
  évalué en 3D (`vector3` en fonction de la position) ou une grille NanoVDB de
  vitesses, avec intégration sur plusieurs pas pour suivre un écoulement ;
- **pile de déformeurs** non destructive, appliquée dans l'ordre, partagée par
  plusieurs objets (un même champ de vent courbe tous les brins d'herbe) ;
- évaluation sur GPU (passe compute, comme le displacement procédural de la
  priorité 9), normales et tangentes recalculées, BVH reconstruit ou réajusté
  à chaque image ;
- animation par l'entrée `time` et par les paramètres des déformeurs, avec flou
  de mouvement (positions aux bornes de l'obturateur) ;
- script dans le style objet :
  `bend = new Bend(); bend.angle = 90; bend.axis = "Y"; flag.deformers = [bend, wind];` ;
- export USD : géométrie déformée écrite en `Mesh` (avec échantillons
  temporels si animée), paramètres des déformeurs en attributs `engine:`.

**Critère d'aboutissement :** un drapeau ondulant au vent (champ de bruit), un
ruban tordu (twist) et un objet importé déformé par treillis sont animés en
temps réel en raster, rendus avec flou de mouvement en path tracing, et
exportés en USD.

## Pistes exploratoires

- **Shaders implicites / SDF** (métaboules, fractales, booléens lisses) :
  spectaculaires, mais limités au path tracer et hors du BVH.
- **Shaders NPR / toon** (ombrage cel, contours) : raster uniquement, hors du
  cœur physique du moteur.
- **Ménage de `docs/`** : fusionner ou archiver les rapports intermédiaires
  `VOLUMESHADER_*`.

## Ordre recommandé

1. Displacement procédural (9), puis surfaces complexes (17) qui en sont la
   première application visible, puis déformation volumique (18), qui
   réutilise la passe compute du displacement.
2. Documentation des nœuds (10), qui profite des primitives (8) pour ses vignettes.
3. Environnement et post-traitement (12), à faible risque d'architecture.
4. Baking (13), qui alimente les aperçus et la bibliothèque (11).
5. Lookdev et projets (14), booléens (15), puis shaders d'extension (16).
