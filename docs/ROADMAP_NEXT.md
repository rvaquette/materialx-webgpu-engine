# Pistes d'évolution du moteur

Le moteur sait déjà charger des scènes USD variées, compiler des graphes
MaterialX multi-matériaux, rendre avec des backends raster et path tracing, et
valider la fidélité des BSDF sur GPU. Les prochaines évolutions doivent donc
prioriser la transformation de ce socle technique en outil de rendu complet,
mesurable, réutilisable et extensible.

Les priorités 1 (rendu progressif), 2 (API de bibliothèque), 3 (éditeur de
matériaux MaterialX), 3bis (scripting), 4 (accélération du path tracer), 5
(scènes dynamiques) et 6 (volumes et effets avancés) sont traitées ; leur historique est dans [ROADMAP_DONE.md](ROADMAP_DONE.md). Il en
reste les travaux suivants.

## Reliquats des priorités traitées

Aucun.

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

1. Portabilité et exploitation continue.
