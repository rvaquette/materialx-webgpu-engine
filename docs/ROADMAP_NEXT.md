# Pistes d'évolution du moteur

Le moteur sait déjà charger des scènes USD variées, compiler des graphes
MaterialX multi-matériaux, rendre avec des backends raster et path tracing, et
valider la fidélité des BSDF sur GPU. Les prochaines évolutions doivent donc
prioriser la transformation de ce socle technique en outil de rendu complet,
mesurable, réutilisable et extensible.

## Priorité 1 : rendu progressif intelligent

Faire de l'accumulation path tracing un processus pilotable par une cible de
qualité plutôt que par un nombre fixe d'échantillons.

- Estimation du bruit résiduel et de la convergence par zone.
- Échantillonnage adaptatif avec priorité aux pixels les plus bruités.
- Arrêt automatique à une cible de convergence ou à un budget de temps.
- Affichage du nombre d'échantillons, du débit, du temps estimé et de la variance.
- Denoising progressif spatial, puis éventuellement temporel.
- AOV albédo, normales, profondeur, émission, transmission et variance.
- Comparaison déterministe du rendu brut et du rendu débruité.

**Première étape implémentée :** le path tracer estime l'intervalle de confiance
relatif à 95 % de la luminance, réduit les mesures dans une grille de 8 × 8
zones et affiche une carte de convergence dans le viewer. La mesure commence à
8 samples par pixel et est recalculée environ tous les 8 balayages, en pleine résolution.
Elle est informative uniquement : elle ne modifie ni l'ordre d'échantillonnage
ni l'arrêt du rendu.

**Deuxième étape implémentée :** la case « Echantillonnage adaptatif » du backend
Path tracing MaterialX active un mode optionnel, désactivé par défaut. Après au
moins 64 samples effectifs par pixel, les pixels dont l'incertitude estimée est
inférieure ou égale à la cible de bruit (5 % par défaut, désormais configurable)
sont calculés une fois tous les 8 balayages. Les pixels encore bruités restent
calculés à chaque balayage. Les sondes sont décalées entre pixels et peuvent
réactiver un pixel après un événement lumineux rare.

La séquence aléatoire et le jitter utilisent alors le nombre de samples propre
au pixel ; les balayages sautés ne consomment pas de samples. Le mode uniforme
de référence est conservé. Changer de mode relance l'accumulation ; la prévisualisation
basse résolution reste uniforme. Le compteur affiche des **balayages**, et non
des spp identiques partout, lorsque l'adaptatif est actif. La carte continue
d'utiliser les comptes et moments effectivement accumulés par pixel.

Cette première version évite du travail par retour anticipé dans le shader :
elle ne compacte pas les files GPU et ne garantit pas de gain de temps sur
toutes les scènes. Une scène très bruitée peut rester échantillonnée partout.
La décision porte sur la luminance de la radiance accumulée, pas sur la
chrominance ni la variance du fond recomposé aux contours. Le seuil statistique
n'est pas une garantie d'erreur : l'arrêt intermittent dépend des échantillons
observés, peut introduire un biais de sélection et manquer des événements rares
malgré les sondes régulières.

**Troisième étape implémentée :** le backend Path tracing MaterialX propose deux
limites optionnelles, désactivées par défaut :

- « Arret automatique (convergence) » exige que tous les pixels soient mesurables
  et sous la cible configurable, après au moins 64 balayages pleine résolution.
  Trois mesures distinctes consécutives doivent satisfaire cette condition.
  Un pixel encore bruité, une zone incomplète ou une erreur de lecture GPU
  interrompt cette série. Cet arrêt reste fondé sur une estimation de luminance,
  avec les limites statistiques décrites ci-dessus.
- « Budget actif (secondes) » limite le temps cumulé des lots GPU pleine
  résolution terminés. La valeur 0 signifie illimité. Le temps de compilation,
  de prévisualisation, de pause, d'inactivité entre lots et de débruitage CPU
  n'est pas compté. Ce n'est pas un chronométrage GPU précis : la durée inclut
  la soumission et l'attente de fin du lot. L'arrêt intervient à la fin d'un
  lot, donc le budget peut être dépassé de la durée d'un lot.

La première limite atteinte arrête l'accumulation sans modifier la pause manuelle.
Le temps actif et le motif sont affichés ; exposition et tonemapping restent
utilisables. « Relancer le rendu » remet à zéro l'image, le chronomètre et les
mesures, puis reprend le rendu. Changer les limites conserve l'accumulation et
le temps déjà écoulé ; désactiver la limite atteinte permet de continuer.
Une nouvelle scène, une modification de caméra ou de transport, un changement
de résolution ou de mode adaptatif réinitialise également la progression.
Les limites ne s'appliquent ni au raster ni au backend Disney et sont conservées
lors d'une récupération du périphérique WebGPU.

La cible de bruit relative se règle de 0,5 % à 25 % (5 % par défaut). Le même
seuil pilote l'échantillonnage adaptatif, la réduction des mesures, l'arrêt de
convergence et l'estimation du temps restant. Le modifier conserve les samples
et le temps actif, mais remet à zéro la série de confirmation et relance la
mesure par zone sur l'accumulation pleine résolution existante, même en pause.

**Quatrième étape implémentée :** le viewer affiche le débit moyen depuis la
dernière remise à zéro, en spp/s uniformes ou en balayages/s adaptatifs. Ce débit
utilise les balayages complets et le temps actif des lots terminés : ce n'est ni
le nombre de rayons/s, ni un débit de samples effectifs en mode adaptatif.
Le budget restant est affiché séparément, borné à zéro ; un budget nul reste
présenté comme illimité. Les pauses et périodes d'inactivité ne le font pas diminuer.

Après une mesure complète à au moins 64 spp uniformes, le temps actif restant
vers la cible de bruit configurée est extrapolé avec la loi en `1/sqrt(N)`, à partir
du pire pixel mesuré et du débit moyen. Cette projection reste informative même
si l'arrêt automatique est désactivé ; elle exclut les trois mesures de
confirmation et ne prédit pas le temps mural. Une valeur nulle indique que la
cible de bruit est estimée atteinte, pas que l'arrêt automatique est confirmé.
Des événements rares ou une évolution de la variance peuvent invalider la projection.
En mode adaptatif, l'estimation de convergence est explicitement indisponible :
les balayages ne correspondent plus à un nombre uniforme de samples.

Le bruit RMS des zones et le bruit maximal sont affichés à partir de la dernière
mesure complète. En mode uniforme, la variance normalisée moyenne est reconstruite
par `RMS^2 * N / 1.96^2` : c'est la variance de luminance divisée par
`max(abs(luminance), 0.01)^2`, pas une variance HDR absolue. Cette reconstruction
est indisponible en adaptatif, faute de comptes par pixel dans la réduction CPU.
Une mesure incomplète ou une erreur de lecture GPU n'alimente pas ces estimations.
Tous les indicateurs suivent les remises à zéro existantes, sans lecture GPU supplémentaire.

L'exposition et le choix du tonemapping (linéaire, Reinhard ou ACES Filmic) s'appliquent à
l'affichage des trois backends, y compris en pause ou après arrêt automatique,
sans réinitialiser les échantillons accumulés. Une image débruitée mise en cache
est invalidée puis recalculée avec les nouveaux réglages d'affichage.

**Cinquième étape implémentée :** le sélecteur d'affichage du Path tracing
MaterialX propose « Rendu final », « Albedo diffus », « Normales (monde) »,
« Profondeur », « Variance de luminance », « Émission primaire » et
« Transmission matériau ». Changer entre rendu final et variance conserve les
samples. Sélectionner un guide réinitialise l'accumulation ; en pause, il faut
la reprendre. Seul le guide choisi est stocké ; les limites configurées sont
conservées.
Les AOV sont bruts : ni exposition, ni tonemapping, ni débruitage. Le rendu final
retrouve ses réglages et son éventuelle image débruitée ; aucun débruitage
supplémentaire n'est lancé tant qu'une vue AOV est sélectionnée.

Les guides sont moyennés sur les mêmes rayons primaires que la radiance, après
le test d'opacité, sans tirage aléatoire ni intersection supplémentaire. L'albédo
est celui des lobes diffus de la closure évaluée (textures incluses), avec encodage
sRGB pour l'affichage : un matériau purement spéculaire apparaît noir. Les normales
de shading, orientées vers le rayon incident, sont exprimées en espace monde,
renormalisées puis remappées de [-1, 1] à [0, 1]. La profondeur est la distance
depuis l'origine du rayon primaire, en unités de scène ; le gris vaut `1/(1+d)`.
Les valeurs sont conditionnées aux impacts de surface : le fond et les volumes
sans surface primaire sont noirs. Ce ne sont pas des passes après réfraction.

La variance est la variance HDR absolue de luminance des samples, `M2/(N-1)`,
et non celle de la moyenne ni la mesure relative de convergence. Elle utilise
le compte effectif du pixel, même en adaptatif ; l'affichage en gris `V/(1+V)`
compresse la dynamique, et le magenta signale moins de deux samples. Les tuiles non encore calculées reprennent les AOV de la prévisualisation basse
résolution. Ces vues ne sont pas proposées en raster ni dans le backend Disney.
L'émission primaire est la valeur EDF du matériau au premier impact accepté,
moyennée sur tous les rayons (les rayons sans surface contribuent zéro). Elle
ne comprend ni l'émission rencontrée aux rebonds indirects ni les sources
analytiques/environnementales ; l'affichage compresse les valeurs HDR par
`E/(1+E)` puis les encode en sRGB. L'AOV de transmission additionne les teintes
pondérées des lobes `translucent` et `dielectric_transmission`, puis clampe à
[0, 1] et encode en sRGB. Il ne comprend ni atténuation Fresnel ni radiance
réfractée. Le viewer n'accumule que l'AOV sélectionné : un vec4 par pixel, soit
16 octets/pixel en plus du préfixe radiance/moments de 32 octets. Beauté et
variance n'allouent pas ce sidecar ; le buffer fait alors 32 octets/pixel,
contre 48 pour une vue AOV. La prévisualisation basse résolution utilise le
même format à un quart du nombre de pixels, soit environ 40 octets par pixel
de sortie en beauté/variance et 60 en vue AOV pour les deux buffers réunis.
Changer d'AOV réinitialise l'accumulation pour éviter de mélanger des guides ;
passer d'une vue AOV à beauté/variance copie le préfixe radiance/moments et
libère le sidecar. Les buffers suivent les remises à zéro et redimensionnements
existants, sans nouvelle liaison storage ni changement du format de référence.
L'AOV sélectionné peut être exporté à la demande en PNG 8 bits, tel qu'affiché,
ou en PFM flottant 32 bits sans transformation d'affichage. Le PFM est
monochrome pour la variance et RGB pour les autres vues ; les lignes suivent
l'ordre bas-vers-haut du format. Les guides conditionnés aux impacts sont
moyennés par leur couverture, tandis que l'émission reste moyennée sur tous les
rayons. Les pixels non encore échantillonnés et la variance calculée avec moins
de deux samples sont marqués NaN. Le fichier reflète la résolution courante du
path tracer, qui peut être inférieure à la résolution finale pendant la
prévisualisation. La lecture GPU pour l'export est temporaire et n'ajoute pas de
buffer persistant.

Le débruiteur spatial actuel reste inchangé. Le débruitage guidé et temporel
est différé afin de ne pas augmenter les buffers GPU persistants sans décision
explicite sur le compromis mémoire et temps de calcul.

La comparaison brute/débruitée est accessible en vue « Rendu final » lorsque le
débruiteur est activé et l'accumulation en pause. Le viewer recalcule alors le
débruitage depuis l'image figée et affiche le brut à gauche, le résultat
débruité à droite. Les deux côtés correspondent ainsi à la même accumulation ;
la comparaison disparaît à la reprise ou à toute modification de caméra,
résolution, exposition, tonemapping ou paramètres de rendu. Aucun buffer GPU
persistant supplémentaire n'est nécessaire.

La compilation des modules WGSL indépendants est lancée par lots concurrents,
avec un maximum de quatre tâches, et les pipelines GPU utilisent les API
asynchrones quand elles sont disponibles. La génération du code WGSL reste
synchrone sur le thread principal, mais le viewer cède l'exécution entre les
générations d'un lot ; cette approche n'utilise pas de Web Worker.

**Critère d'aboutissement :** le viewer peut atteindre une qualité cible sans
réglage manuel du nombre de samples, tout en exposant une mesure reproductible
de la convergence.

## Priorité 2 : API de bibliothèque réutilisable

Séparer le moteur du viewer ImGui afin de pouvoir l'intégrer dans d'autres
applications.

**Première étape implémentée :** le point d'entrée TypeScript
[`src/engine.ts`](../src/engine.ts) charge une scène USD et pilote les backends
du moteur sur un canvas WebGPU, sans démarrer ImGui.

```ts
import { MaterialXEngine } from './src/engine.ts';

const engine = await MaterialXEngine.create(canvas);
await engine.loadUsd(sceneUrl);
await engine.render({
  backend: 'pathtracing',
  targetNoise: 0.05,
});

// Quand le rendu n'est plus nécessaire :
engine.dispose();
```

`render()` applique la configuration sans attendre une image ni la convergence ;
`onStatus` permet de suivre le rendu. En path tracing MaterialX, `targetNoise`
active l'arrêt automatique ; sans cible explicite le rendu reste progressif.
Le moteur configure le canvas et, par défaut, possède son périphérique WebGPU.
Si un périphérique est fourni, `dispose()` le laisse au code appelant.
L'[exemple minimal](../examples/engine/index.html) est accessible à
`/examples/engine/` avec `npm run dev`. Ce point d'entrée est utilisable
depuis les sources Vite ; aucun paquet autonome n'est encore publié.

**Deuxième étape implémentée :** `engine.objects` liste les objets rendus et leur
chemin de prim USD. `engine.setMaterial()` remplace le matériau d'un objet sans
réécrire le fichier de scène. Sans deuxième argument, la méthode restaure
l'affectation d'origine.

```ts
await engine.setMaterial('/World/Triangle', { url: './orange.mtlx' });
await engine.setMaterial('/World/Triangle'); // Restaurer le matériau USD
```

Les URL relatives sont résolues par rapport à la page hôte. Si
`engine.isCompiledScene` vaut `true`, fournir aussi `compiledUrl`, l'URL du
manifeste `material.json` compatible avec la scène. L'exemple minimal permet
d'appliquer puis de restaurer un matériau dans une scène source.

**Troisième étape implémentée :** `createHeadless()` permet de capturer un
rendu raster sans canvas, ImGui ni boucle d'animation. `capture()` déclenche
le rendu puis renvoie les pixels `RGBA8` après tonemapping, de haut en bas,
sans octets de remplissage entre les lignes.

```ts
const engine = await MaterialXEngine.createHeadless({ width: 640, height: 480 });
try {
  await engine.loadUsd(sceneUrl);
  const { width, height, rgba } = await engine.capture();
  // Passer les pixels à un encodeur ou les comparer à une image de référence.
} finally {
  engine.dispose();
}
```

**Quatrième étape implémentée :** remplacer `capture()` par
`capture({ backend: 'pathtracing', samples: 16 })` pour lancer le path tracing
MaterialX hors écran. Chaque appel repart de zéro et calcule le nombre demandé
d'échantillons par pixel à pleine résolution, sans aperçu, convergence
automatique, échantillonnage adaptatif ni débruitage. Les lots GPU sont bornés
et l'image n'est résolue qu'après le dernier balayage. `capture()` sans option
reste en raster.

Ces captures sont prévues pour un navigateur compatible WebGPU, y compris sans
fenêtre visible si le runner donne accès à WebGPU. L'API ne fournit pas de
runtime Node.js, d'encodeur PNG ni de capture Disney.

**Cinquième étape :** `npm run test:headless-capture` vérifie dans Chrome les
captures raster et path tracing du triangle USD source, sans canvas. Le test
contrôle le format RGBA8 à une largeur non alignée, distingue le triangle du
fond et compare les captures entre elles sur le même périphérique, sans image
de référence propre à un GPU. Il nécessite Node.js 22 ou plus, Chrome et les
assets MaterialX (`MX_CORE_DIR`, `MX_LIB_ROOT`).

Le workflow GitHub Actions lance le raster sur Linux avec SwiftShader
(`MX_CAPTURE_RASTER_ONLY=1`) et échoue si aucun adaptateur WebGPU n'est
disponible. Le test complet a réussi sous Windows ; sous Linux avec
SwiftShader, la première capture path tracing n'a pas terminé dans le délai
de six minutes. L'exécution sur le runner GitHub Actions reste à confirmer.

**Sixième étape :** l'application hôte peut choisir où servir les fichiers
d'exécution via `runtimeAssets`, avec `create()` ou `createHeadless()` :

```ts
const engine = await MaterialXEngine.createHeadless({
  width: 640,
  height: 480,
  runtimeAssets: {
    materialxCore: '/engine-assets/core/',
    materialxLibraries: '/engine-assets/libraries/',
    openUsd: '/engine-assets/openusd/',
  },
});
```

Le premier répertoire contient `JsMaterialXCore.js` et son WASM ; le deuxième
contient l'arborescence standard MaterialX ; le troisième contient `index.js`
et les fichiers associés aux bindings OpenUSD. OpenUSD n'est chargé qu'à la
rencontre d'une couche binaire et nécessite toujours l'isolation inter-origines
(COOP/COEP). Les chemins relatifs utilisent l'URL de base de la page ; les
champs omis conservent les emplacements du viewer. Si les fichiers sont servis
depuis une autre origine, celle-ci doit autoriser leur chargement par CORS.

**Septième étape :** le moteur peut être installé comme paquet npm local.
Depuis le dépôt, générer l'archive :

```powershell
npm run build:engine-package
npm pack .\build-engine
```

Installer le `.tgz` produit avec `npm install <chemin-vers-le-tgz>` dans
l'application hôte, puis utiliser le point d'entrée public :

```ts
import { MaterialXEngine } from 'materialx-webgpu-engine';
```

Le paquet fournit un module ESM pour navigateur et ses déclarations
TypeScript, sans ImGui, scènes de démonstration ni fichiers d'exécution
MaterialX/OpenUSD. L'application hôte sert ces fichiers et indique leurs URL
via `runtimeAssets`. Le paquet reste privé ; cette étape ne publie rien.

`npm run test:engine-package` installe l'archive dans une application
TypeScript temporaire, vérifie ses types, compile l'application avec Vite
et valide une capture raster WebGPU dans Chrome depuis les URL de l'hôte.
Le test nécessite Node.js 22 ou plus, Chrome et les assets MaterialX
(`MX_CORE_DIR`, `MX_LIB_ROOT`).

Avec `MX_CAPTURE_PATH_TRACING=1`, ce même test vérifie aussi le path tracing
du paquet installé : il capture le triangle à 1, 2, puis de nouveau à 1
échantillon par pixel. Les deux captures à 1 échantillon doivent être
identiques octet pour octet ; celle à 2 doit différer. Le test du paquet reste
en raster par défaut. Les deux modes ont été vérifiés dans Chrome sous
Windows ; le workflow Linux n'exécute pas le path tracing.

Travaux restants :

- stabilisation du contrat public ;
- intégration du path tracing en CI sur un runner WebGPU adapté ;
- publication du paquet dans un registre, si souhaitée ;
- adaptateurs optionnels pour Three.js, React ou une application existante ;
- exemples d'intégration au viewer et de rendu automatisé.

**Critère d'aboutissement atteint :** une application extérieure peut charger
une scène et effectuer un rendu raster ou path tracing avec le paquet installé,
sans dépendre du code interne du viewer.

## Priorité 3 : éditeur de matériaux MaterialX

Étendre l'édition de paramètres actuelle vers un véritable atelier MaterialX
dans le navigateur :

**Première étape :** dans **Matériaux → Graphe du matériau**, le viewer affiche
le graphe de surface résolu de l'objet sélectionné. Les terminaux et les entrées
connectées permettent de naviguer entre les nœuds. Les types et les valeurs
résolues sont consultables sans relancer la compilation. Si le graphe n'est pas
fourni, par exemple pour une scène uniquement précompilée, le panneau l'indique.

**Deuxième étape :** le bouton **Voir le graphe**, à côté du rendu, ouvre
un diagramme défilable de l'objet sélectionné. Les nœuds sont disposés
des entrées vers les sorties ; sélectionner un nœud met ses liens en
surbrillance et affiche ses entrées. Le diagramme reste en lecture seule.

**Troisième étape :** les nœuds du diagramme sont déplaçables à la souris
ou avec les flèches du clavier. Les liens suivent le déplacement et le bouton
**Réinitialiser la disposition** restaure le placement automatique. La
disposition est conservée à la réouverture tant que le même graphe est chargé ;
elle ne modifie pas le matériau et n'est pas enregistrée dans le fichier USD.

**Quatrième étape :** le diagramme permet de modifier les entrées numériques
et booléennes déjà éditables dans le viewer. **Appliquer les valeurs** met à
jour l'aperçu via le même mécanisme que le panneau de paramètres ; les entrées
connectées restent en lecture seule. Les changements ne sont pas sauvegardés
dans les fichiers source.

**Cinquième étape :** sur une entrée littérale éditable de surface, **Insérer
un Constant** crée et connecte un nœud de même type (`float` ou `color3`)
en conservant la valeur courante. Sur ce nœud, **Revenir à une valeur
littérale** retire le nœud et réinjecte sa valeur dans l'entrée. Cette
première opération de topologie est limitée aux entrées pilotées par un
uniforme, hors entrées à unité ou espace colorimétrique explicites. Le
viewer recompile sans relire l'USD ; le document source n'est pas modifié.

**Sixième étape :** **Exporter .mtlx** télécharge un nouveau document MaterialX
avec les valeurs déjà appliquées et les connexions du graphe résolu. Ce premier
export couvre `standard_surface` et `open_pbr_surface` avec des entrées
littérales ou alimentées par des nœuds `constant` (`float` et `color3`). Il
utilise la bibliothèque standard MaterialX et ne réécrit pas le document source.
Un message explique le refus pour les graphes hors de ce périmètre, par exemple
les shaders USD, les textures, le déplacement et les volumes.

**Septième étape :** le même export accepte aussi certaines variantes
standard de `add`, `multiply`, `clamp`, `mix` et `noise2d` (`float` et
`color3`), ainsi que `checkerboard` (`color3`) et `texcoord` (`vector2`).
Les connexions et les nœuds partagés sont conservés sans fichier de texture.
Les variantes non prises en charge et les définitions personnalisées restent
refusées.

**Huitième étape :** **Exporter .mtlx** produit automatiquement un ZIP
lorsque le graphe utilise des nœuds `image` statiques (`float` ou `color3`).
Décompresser l'archive, puis ouvrir le `.mtlx` : les fichiers originaux sont
dans `textures/` et les chemins du document sont relatifs. Une même URL n'est
embarquée qu'une fois. L'export est refusé si une image HTTP(S) est inaccessible
ou si le total des textures dépasse 64 Mio. Les graphes sans image téléchargent
toujours un `.mtlx` seul ; UDIM, séquences et sources locales temporaires ne
sont pas encore pris en charge.

**Neuvième étape :** le diagramme affiche les diagnostics de résolution
à côté des entrées du nœud de surface : entrée ignorée car absente du NodeDef,
interface introuvable avec repli sur la valeur par défaut, ou connexion vers
un nœud manquant ou non pris en charge. Ces indications ne changent pas le rendu.

**Dixième étape :** le bouton **Bibliothèque de matériaux**, à côté du rendu,
ouvre le catalogue existant. La recherche combine des mots du nom et du dossier,
sans distinction de casse ou d'accent. L'étoile marque un matériau comme favori ;
le filtre **Favoris uniquement** peut être combiné avec la recherche. Les
favoris sont conservés dans le navigateur. Choisir un résultat applique le
matériau à l'objet sélectionné, comme depuis le sélecteur ImGui.

**Onzième étape :** un Constant créé dans le diagramme peut aussi être
connecté à d'autres entrées littérales éditables de la surface. Les entrées
doivent accepter le même type et la plage de valeurs du Constant. Modifier
le Constant met à jour toutes ses connexions ; retirer un lien secondaire
restaure la valeur précédente de l'entrée. Le Constant ne peut être retiré
qu'après ses liens secondaires.

**Douzième étape :** dans **Voir le graphe**, deux emplacements **A** et **B**
permettent de mémoriser puis de réafficher le matériau appliqué à l'objet
sélectionné, valeurs et connexions comprises. **Afficher A/B** remplace l'état
actif sans changer la caméra ; fermer le diagramme permet de voir le rendu
en entier. Les variantes sont propres à l'objet et ne sont conservées qu'en
mémoire, jusqu'au rechargement de la scène.

**Treizième étape :** une fois les deux variantes enregistrées, **Différences
A/B** affiche les nœuds ajoutés ou retirés et présente les valeurs et
connexions modifiées dans deux colonnes. Cette comparaison du graphe résolu
ne bascule pas le matériau actif et ne relance pas le rendu.

**Quatorzième étape :** **Exporter A** et **Exporter B** téléchargent
directement la variante enregistrée sans l'appliquer à l'objet. Le suffixe
`_A` ou `_B` distingue les fichiers. Les règles habituelles s'appliquent :
`.mtlx` seul ou ZIP avec textures. L'export est durable, mais ne recharge
pas automatiquement les emplacements A/B dans le viewer.

**Quinzième étape :** avec le moteur Disney sélectionné, **Voir le graphe**
affiche les approximations ou le motif de refus de conversion du matériau
de l'objet sélectionné. Le diagnostic utilise le même convertisseur que le
rendu, sans compiler de pipeline ni charger de textures. Il est recalculé
après les modifications appliquées et ne valide pas la scène entière.

**Seizième étape :** l'export du matériau courant et des variantes A/B
conserve aussi les nœuds de calcul standard `subtract`, `divide`, `absval`,
`min` et `max` en `float` ou `color3`, y compris les variantes couleur/scalaires
prévues par la bibliothèque standard. Les connexions sont conservées dans le
document `.mtlx` : les calculs ne sont pas remplacés par des constantes.

**Dix-septième étape :** après avoir enregistré A et B, **Comparer les rendus
A/B** génère deux aperçus côte à côte, en raster ou en path tracing avec un
nombre fixe d'échantillons par pixel pour chaque variante (de 1 à 64).
Les captures hors écran reprennent le cadrage de la scène, à une résolution
limitée à 256 pixels sur le plus grand côté. Elles ne changent ni le matériau
actif ni le moteur du viewer. Fermer le graphe annule la comparaison.

**Dix-huitième étape :** l'export conserve les transformations UV standard
`place2d` et `rotate2d`. Dans un ZIP texturé, les images conservent leurs
connexions aux transformations (y compris les nœuds partagés) et les
paramètres de placement et de rotation restent éditables dans le `.mtlx`.

**Dix-neuvième étape :** **Remplacer le lien** redirige une connexion
secondaire créée dans le diagramme vers un autre Constant compatible, en
une seule opération. **Retirer le lien** rétablit toujours la valeur
littérale qui précédait la toute première connexion. Les connexions
primaires et celles du graphe source ne sont pas modifiées par cette commande.

**Vingtième étape :** **Insérer un Multiply** remplace une valeur scalaire
éditable compatible par sa multiplication avec un facteur initial de `1`.
Le facteur s'édite dans `in2`, entre `0` et `1`. **Revenir à une valeur
littérale** supprime le nœud et conserve le produit. Le nœud reste
exportable en `.mtlx` tant qu'il est connecté.

**Vingt-et-unième étape :** **Insérer un Multiply** est aussi proposé sur
les entrées `color3` compatibles. Le même facteur scalaire multiplie R, V
et B. Le `.mtlx` conserve le nœud standard `ND_multiply_color3FA` et le
retrait du nœud conserve le résultat sous forme de littéral `color3`.

**Vingt-deuxième étape :** modifier `in2` met à jour les uniformes des
pipelines raster et path tracing MaterialX déjà prêts, sans les recompiler.
L'accumulation repart pour le nouveau matériau. Disney prépare à nouveau
ses données matériau au prochain rendu Disney, sans reconstruire le raster.
L'insertion et le retrait du Multiply restent des modifications de topologie.

**Vingt-troisième étape :** **Insérer un Add** est proposé sur les entrées
`float` compatibles dont les deux bornes sont connues. Le décalage `in2`
démarre à `0` et peut être négatif ou positif dans les limites de l'entrée
de surface. Son édition réutilise les uniformes des pipelines MaterialX ;
le `.mtlx` conserve le nœud standard `ND_add_float` et son retrait conserve
la somme sous forme de littéral.

Travaux restants :

- étendre l'ajout, la suppression et la connexion au-delà des Constants, du Multiply à facteur scalaire et de l'Add scalaire ;
- étendre la compilation incrémentale aux modifications de topologie ;
- aperçu sur l'objet sélectionné ou sur un shaderball ;
- restauration des emplacements A/B après rechargement ;
- étendre l'export `.mtlx` aux UDIM, séquences et autres nœuds ;
- étendre les diagnostics aux approximations des autres moteurs de rendu.

**Critère d'aboutissement :** un utilisateur peut créer ou modifier un graphe
MaterialX, l'évaluer immédiatement et exporter le document obtenu.

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

1. Rendu progressif, statistiques et AOV.
2. API publique indépendante du viewer.
3. Éditeur de graphe MaterialX.
4. ReSTIR, streaming et optimisations mesurées.
5. Dynamisme des scènes.
6. Volumes et effets avancés.
7. Portabilité et exploitation continue.
