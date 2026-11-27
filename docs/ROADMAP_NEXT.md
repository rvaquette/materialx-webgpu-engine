# Pistes d'évolution du moteur

Le moteur sait déjà charger des scènes USD variées, compiler des graphes
MaterialX multi-matériaux, rendre avec des backends raster et path tracing, et
valider la fidélité des BSDF sur GPU. Les prochaines évolutions doivent donc
prioriser la transformation de ce socle technique en outil de rendu complet,
mesurable, réutilisable et extensible.

Les priorités 1 (rendu progressif), 2 (API de bibliothèque), 3 (éditeur de
matériaux MaterialX), 3bis (scripting), 4 (accélération du path tracer), 5
(scènes dynamiques), 6 (volumes et effets avancés), 7 (robustesse,
portabilité et exploitation), 8 (primitives et scènes par script), 9
(displacement procédural), 10 (documentation intégrée des nœuds), 11
(aperçus par nœud et bibliothèque de matériaux), 12 (environnement et
post-traitement), 13 (baking et export de scènes), 14 (lookdev et projets),
15 (opérations booléennes), 16 (shaders d'extension), 17 (surfaces complexes)
et 18 (déformation volumique),
ainsi que l'étude urgente de la priorité 21 (chargement des bibliothèques
MaterialX sans WASM), la priorité 22 (build minimal du Core WASM) et l'étude de
la priorité 25 (graphe de scène équivalent au script) et la priorité 23
(paramètres de shaders déclarés par script) sont traitées ; leur
historique est dans
[ROADMAP_DONE.md](ROADMAP_DONE.md). Les limites connues sont recensées dans
[INTEGRATION.md](INTEGRATION.md#limites-connues).

Les priorités suivantes visent à passer d'un moteur de rendu MaterialX à un
outil de création : construire des scènes, explorer et documenter les nœuds,
étendre MaterialX à de nouveaux types de shaders, exporter le résultat et
continuer à optimiser le runtime livré au navigateur.

Pour les animations restituer un fichier vidéo et non pas une série d'images.

## Priorité 20 : systèmes de particules animés

Compléter le scatter shader de la priorité 16, qui répartit des instances sur
une surface, par des systèmes évoluant dans le temps :

- émission continue ou par impulsion, durée de vie, vitesse, taille et couleur
  initiales, avec graine déterministe pour des rendus reproductibles ;
- forces configurables : gravité, vent et turbulence procédurale, avec
  collisions simples contre le sol et les objets de la scène ;
- simulation sur GPU, intégrée à la timeline des scènes dynamiques ; historique
  des positions pour le flou de mouvement en path tracing ;
- rendu en points, sprites orientés caméra ou instances de géométrie, avec
  matériau MaterialX par système (émission pour les étincelles, transmission
  pour les gouttes) ;
- presets scriptables, notamment chute d'eau (gouttes et embruns), étincelles
  avec traînées, pluie et neige ; le preset de feu de la priorité 17 peut
  réutiliser ce système pour ses braises.

**Critère d'aboutissement :** une chute d'eau et une gerbe d'étincelles animées
s'obtiennent par script, restent reproductibles à graine fixée et se rendent
en raster comme en path tracing, avec flou de mouvement en path tracing.

## Priorité 21 : création et rendu de poils et de cheveux

Ajouter un système de mèches générées sur une surface, adapté au pelage comme
aux cheveux :

- création scriptable et par graphe à partir d'une surface émettrice, avec
  densité, longueur, épaisseur, orientation, graine et matériau MaterialX ;
- contrôles de peignage, courbure, ondulation et regroupement des mèches, avec
  limites explicites pour garder une géométrie et un temps de rendu maîtrisés ;
- représentation partagée et compacte, sans créer un objet indépendant par
  poil, consommable par les chemins raster et path tracing ;
- statut documenté pour les courbes, les ombres, la transparence et les
  backends, ainsi que des scripts d'exemple pour un pelage court et une coiffure.

**Critère d'aboutissement :** un script et un graphe produisent un pelage et une
coiffure reproductibles à graine fixée ; les deux se rendent avec ombres en
raster et en path tracing, sans explosion du nombre d'objets de scène.

## Priorité 26 : sélection, édition et mouvements de caméra

- Sélectionner les caméras présentes dans la scène et enregistrer des vues
  nommées pour passer rapidement d'un cadrage à l'autre.
- Piloter la vue par orbite, panoramique et déplacement avant/arrière, avec
  recentrage sur la sélection et commandes de réinitialisation.
- Modifier les paramètres de caméra (projection, focale ou champ de vision,
  plans de clipping, cible et profondeur de champ lorsque le backend le permet).
- Créer des mouvements et transitions reproductibles entre des poses ou vues
  nommées ; permettre leur lecture, leur arrêt et leur édition sur la timeline.
- Inclure les modifications de caméra dans l'annuler/rétablir, les projets et
  l'API de script. Garder la même caméra pour les rendus raster et path tracing.
- Coordonner l'export des séquences avec la priorité 24, sans redéfinir ici le
  format vidéo ou la stratégie de rendu hors ligne.

**Critère d'aboutissement :** enregistrer deux vues, passer de l'une à l'autre,
créer et relire un mouvement de caméra, puis annuler/rétablir et sauvegarder/
rouvrir le projet sans dérive de cadrage entre les backends.

## Priorité 28 : écarts avec l'implémentation officielle de MaterialX

Documenter précisément ce que le moteur conserve, étend, approxime ou ne prend
pas en charge par rapport à MaterialX officiel, pour éviter de confondre un
document `.mtlx` valide avec un matériau portable et un rendu fidèle :

- **référence explicite** : préciser la version de la spécification, des
  bibliothèques standard et des générateurs de shaders officiels utilisés pour
  la comparaison ; distinguer conformité du document, résolution des
  `nodedef`/`nodegraph` et équivalence du rendu ;
- **matrice de compatibilité** : recenser nœuds, types, entrées, valeurs par
  défaut, espaces géométriques, unités, espaces colorimétriques, textures et
  closures ; qualifier chaque cas comme conforme, partiel, approximé,
  non pris en charge ou extension, séparément pour raster, path tracing
  MaterialX, Disney et évaluation CPU/baking ;
- **extensions du moteur** : inventorier les nœuds et types ajoutés, notamment
  les shaders d'environnement, de caméra/lentille, d'image/AOV, les filtres de
  lumière/gobos, le scatter et les préréglages de surfaces complexes ;
  distinguer les graphes composés de nœuds standard des catégories ou
  sémantiques propres au moteur, ainsi que l'API JavaScript et les attributs
  USD `engine:` qui ne font pas partie de MaterialX ;
- **interopérabilité et export** : expliquer ce qui reste utilisable dans un
  outil MaterialX externe, ce qui exige les définitions d'extension, ce qui
  peut être développé en graphes standard ou baké, et ce qui ne dispose
  d'aucun équivalent ; ne pas présenter le baking comme une équivalence
  procédurale ou animée ;
- **écarts vérifiés** : associer chaque écart à sa source officielle, au code
  concerné, à son effet visible et aux tests disponibles ; documenter les
  rejets explicites et les éventuels replis, sans déduire la fidélité d'une
  simple compilation réussie ;
- **livrables** : un guide comparatif central relié à
  [INTEGRATION.md](INTEGRATION.md) et à
  [SCRIPT_REFERENCE.md](SCRIPT_REFERENCE.md), une matrice consultable et de
  petits exemples comparant un graphe standard, une extension exportable et
  une fonctionnalité propre au moteur ;
- **maintenance** : mettre à jour cette documentation lors d'un ajout
  d'extension, d'un changement de sémantique ou d'une mise à jour de la
  bibliothèque officielle ; séparer les limites actuelles des travaux prévus.

**Critère d'aboutissement :** pour un matériau donné, la documentation permet
de déterminer ses dépendances au moteur, les différences selon le backend et
la stratégie d'export vers un outil MaterialX officiel. Les écarts sont sourcés
et illustrés par des cas reproductibles, sans annoncer une conformité globale
non démontrée.

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
5. Lookdev et projets (14), puis opérations booléennes (15).
6. Surfaces complexes (17), puis systèmes de particules (20) pour les effets
   animés comme les gouttes et les braises.
7. Création de poils et cheveux (21), après le scatter et les particules, pour
   réutiliser leurs surfaces émettrices, graines et instances.
8. Rendu distribué (19), dès que les scènes de la priorité 17 rendent le path
   tracing trop long sur un seul GPU.
9. Étude du format vidéo de transport des rendus (24), après les scènes
    dynamiques (5) et l'export des rendus (13).
10. Sélection, édition et mouvements de caméra (26), après le lookdev et les
    projets (14), les scènes dynamiques (5) et l'étude de format vidéo (24).
11. Déploiement Azure du rendu distribué (27), après le socle multi-serveur
    (19) ; la validation d'une VM GPU peut commencer dès maintenant.
12. Écarts avec MaterialX officiel (28), à mener en parallèle des shaders
    d'extension (16) et des surfaces complexes (17), puis à maintenir avec
    chaque évolution du compilateur et des exports.
