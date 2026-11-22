# Pistes d'évolution du moteur

Le moteur sait déjà charger des scènes USD variées, compiler des graphes
MaterialX multi-matériaux, rendre avec des backends raster et path tracing, et
valider la fidélité des BSDF sur GPU. Les prochaines évolutions doivent donc
prioriser la transformation de ce socle technique en outil de rendu complet,
mesurable, réutilisable et extensible.

Les priorités 1 (rendu progressif), 2 (API de bibliothèque), 3 (éditeur de
matériaux MaterialX), 3bis (scripting) et 4 (accélération du path tracer) sont
traitées ; leur historique est dans [ROADMAP_DONE.md](ROADMAP_DONE.md). Il en
reste les travaux suivants.

## Reliquats des priorités traitées

## Priorité 5 : scènes dynamiques

Le moteur est actuellement orienté vers les scènes statiques. La dynamique peut
être introduite par étapes :

1. transformations d'instances et de caméras modifiables sans rechargement ;
2. lumières, visibilité et paramètres de matériaux animés ;
3. refit incrémental du BVH ;
4. variants et pistes temporelles USD ;
5. géométrie déformable ;
6. motion blur Monte Carlo et accumulation temporelle.

**Critère d'aboutissement :** une animation simple peut changer les transforms,
la caméra, les lumières et les matériaux en conservant une interaction fluide.

## Priorité 6 : volumes et effets avancés

Explorer les effets qui permettent de dépasser le rendu de matériaux :

- volumes hétérogènes OpenVDB ou NanoVDB ;
- brouillard, fumée, nuages et flammes ;
- caustiques ;
- dispersion chromatique ;
- subsurface multi-échelle ;
- cheveux géométriques et interactions inter-fibres ;
- fourrure, particules et instanciation volumétrique.

Ces travaux doivent annoncer clairement leurs approximations par backend et être
couverts par des scènes de référence dédiées.

**Critère d'aboutissement :** chaque effet possède un modèle documenté, une scène
de contrôle, des tolérances et une couverture raster/path tracing explicite.

## Priorité 7 : robustesse, portabilité et exploitation

Préparer les usages de production :

- budget mémoire GPU explicite et politiques de réduction ;
- streaming avec placeholders de qualité progressive (textures, tuiles UDIM et
  géométries ; mesuré à moins de 5 % du chargement des scènes actuelles) ;
- récupération après perte du device ;
- stratégie de fallback fondée sur les limites du GPU ;
- tests sur plusieurs navigateurs et familles de GPU ;
- rendu golden automatisé en CI ;
- sauvegarde des diagnostics de compilation sous forme structurée ;
- télémétrie locale optionnelle sur compilation, upload, GPU et convergence ;
- documentation de l'intégration, des limites connues et des capacités supportées.

**Critère d'aboutissement :** les limites et échecs prévisibles sont diagnostiqués,
et non convertis silencieusement en rendu incomplet.

## Ordre recommandé

1. Dynamisme des scènes.
2. Volumes et effets avancés.
3. Portabilité et exploitation continue.
