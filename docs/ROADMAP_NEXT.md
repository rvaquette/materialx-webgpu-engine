# Pistes d'évolution du moteur

Le moteur sait déjà charger des scènes USD variées, compiler des graphes
MaterialX multi-matériaux, rendre avec des backends raster et path tracing, et
valider la fidélité des BSDF sur GPU. Les prochaines évolutions doivent donc
prioriser la transformation de ce socle technique en outil de rendu complet,
mesurable, réutilisable et extensible.

Les priorités 1 (rendu progressif), 2 (API de bibliothèque), 3 (éditeur de
matériaux MaterialX) et 3bis (scripting) sont traitées ; leur historique est dans
[ROADMAP_DONE.md](ROADMAP_DONE.md). Il en reste les travaux suivants.

## Reliquats des priorités traitées

### Rendu progressif (priorité 1)

- débruitage guidé et temporel, différé afin de ne pas augmenter les buffers
  GPU persistants sans décision explicite sur le compromis mémoire et temps de
  calcul.

### API de bibliothèque (priorité 2)

- enregistrer un runner auto-hébergé `webgpu` et activer `WEBGPU_RUNNER` pour
  exécuter le path tracing en CI (le workflow est prêt) ;
- publication du paquet dans un registre, si elle devient souhaitée ;
- adaptateurs React ou Three.js, si un besoin apparaît.

## Priorité 4 : accélération du path tracer

Optimiser principalement les cas où le moteur est aujourd'hui limité par le
nombre de sources, de matériaux ou de triangles :

- ReSTIR ou reservoirs pour les lumières nombreuses ;
- échantillonnage adaptatif de l'environnement ;
- importance sampling basée sur les distributions observées ;
- blue-noise temporel et reconstruction adaptative ;
- Wavefront plus spécialisé et compaction plus efficace ;
- cache BVH partagé avec le viewer, y compris entre chargements ;
- streaming progressif des textures, tuiles UDIM et géométries ;
- réduction des variantes de shaders pour les matériaux structurellement proches.

Ces optimisations doivent être mesurées séparément : temps CPU, temps GPU,
occupation mémoire, convergence et latence d'interaction.

**Critère d'aboutissement :** un gain de performance est démontré sur les bancs
existants sans modifier la sortie de référence au-delà des tolérances déclarées.

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
- streaming avec placeholders de qualité progressive ;
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

1. ReSTIR, streaming et optimisations mesurées.
2. Dynamisme des scènes.
3. Volumes et effets avancés.
4. Portabilité et exploitation continue.
