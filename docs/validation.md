# Méthodologie de validation

Ce document décrit comment le moteur est validé : la méthodologie de comparaison,
les sources d'oracle, les tolérances appliquées par type de nœud et par scène, les
cas qui ne sont pas reproductibles bit à bit, et la procédure d'exécution.

Il est la contrepartie lisible des fixtures et des tests :

- Tolérances (source de vérité unique) : [`tests/fixtures/tolerances.ts`](../tests/fixtures/tolerances.ts)
- Cas de nœuds et enveloppes : [`tests/fixtures/node-cases.ts`](../tests/fixtures/node-cases.ts)
- Scènes de contrôle déterministes : [`tests/fixtures/control-scenes.json`](../tests/fixtures/control-scenes.json)
- Matrice de conformité : [`docs/conformance.md`](conformance.md)

## Principe général

La validation repose sur une **comparaison oracle** : chaque sortie (une valeur de
nœud, un pixel raster, un pixel path-tracé) est confrontée à une référence calculée
indépendamment, et l'écart doit rester sous une tolérance déclarée.

Deux dimensions sont vérifiées séparément pour éviter de mélanger les sources
d'erreur :

1. **Exactitude du modèle** (CPU vs CPU) — la référence CPU est comparée à une
   seconde dérivation (forme close, transport non biaisé, ou implémentation naïve).
   Ces tests tournent sous Node, sans GPU, et sont donc déterministes et rejouables
   partout.
2. **Fidélité du GPU** (device vs oracle CPU) — le GPU réel du mobile évalue le même
   modèle sur des **entrées partagées** avec l'oracle, de sorte que le seul écart
   mesuré soit l'arithmétique fp32 du GPU face au fp64 du CPU, et non une différence
   de visibilité ou d'échantillonnage.

## Profils raster et réactivité du viewer mobile

Le viewer propose deux profils explicitement sélectionnables :

- **Interactive (filtered IBL)**, par défaut dans le viewer : 16 échantillons
  BSDF par intégration, environnement HDR filtré par mipmaps et LOD calculé à
  partir de la PDF et de l'angle solide des texels latlong. Ce profil est une
  **approximation** : il supprime la stratégie d'importance environnement/CDF et
  son MIS complémentaire. Les reflets quasi spéculaires gardent le niveau zéro
  pour ne pas flouter les miroirs et le verre lisse.
- **Reference (64 samples)** : intégration historique à 64 échantillons avec
  CDF et MIS. C'est toujours le défaut de `assembleIrForwardShader`, donc des
  captures et tests qui ne demandent pas explicitement le profil interactif.
  Les comparaisons oracle ne doivent pas substituer implicitement l'interactif
  à cette référence.

Les mipmaps HDR sont générées sur le GPU, sans modifier le niveau zéro utilisé
par le path tracer. La qualité raster ne change pas l'intégrateur path tracing.
L'interactif soumet une image en une commande ; la référence conserve les bandes
de 65 536 pixels pour éviter les watchdogs des pilotes mobiles.

Les changements de résolution remplacent uniquement les cibles HDR/profondeur,
et le buffer d'accumulation si le path tracer a déjà été initialisé. Géométrie,
textures et pipelines sont conservés ; les deux jeux de pipelines raster sont
mis en cache après leur première compilation. La préparation CPU/BVH et GPU du
path tracer est différée jusqu'à sa première utilisation. Les bibliothèques
MaterialX sont partagées pendant la vie du Core, téléchargées en parallèle,
puis parsées dans l'ordre des dépendances ; un chargement échoué peut être retenté.
Le viewer limite les images en vol pour ne pas accumuler une file de mouvements
de caméra obsolètes.

### Panorama visible, raster et path tracing

La caméra des objets reste **orthographique**. Employer ses rayons parallèles
pour le panorama produisait un fond presque uniforme. Le viewer utilise désormais
une projection perspective dédiée au **fond visible**, de même orientation et
FOV dans les deux modes ; le zoom orthographique ne change pas ce FOV.
Dans le path tracer, cette direction ne remplace que l'environnement rencontré
sur le segment caméra, y compris à travers les événements d'opacité nulle.
Après une interaction avec une surface, les réflexions, transmissions et autres
rebonds continuent d'échantillonner leurs véritables directions de transport.
Il s'agit d'une convention d'affichage, pas d'une conversion de toute la scène
en perspective. Les autres consommateurs du path tracer conservent leur caméra
habituelle tant qu'ils ne fournissent pas `backgroundInvViewProj`.

### Mesures et vérifications sur téléphone

Mesures locales via ADB/CDP, Samsung SM-F731B, Adreno 740, Chrome 155,
scène **Simple shader ball**, après compilation des pipelines :

| Résolution | Ancien raster 64 échantillons | Interactif avec panorama corrigé |
|---|---:|---:|
| 512 × 512 | environ 166 ms | 39–48 ms |
| 1024 × 1024 | environ 324 ms | 50–55 ms |

Ce sont des délais entre soumission et `queue.onSubmittedWorkDone`, **pas des
timestamps GPU matériels ni des durées garanties de présentation**. Les mesures
dépendent aussi de l'état thermique du téléphone. Elles montrent un gain
d'environ 3,5–4× à 512² et 6× à 1024², sans garantir 60 images/s. La référence
conserve un coût similaire à l'ancien rendu (environ 173–177 ms à 512² lors
de cette vérification).

Les vérifications sur GPU réel ont couvert :

- panorama visible dans les deux modes, sans erreur WGSL/WebGPU ;
- profils interactif/référence et retour sur un profil déjà compilé sans
  compilation ni allocation supplémentaire ;
- redimensionnement sans nouveau pipeline ni shader ; deux textures raster,
  plus un buffer d'accumulation si le path tracer est déjà initialisé ;
- progression du path tracing et réutilisation de son pipeline au resize ;
- compilation/rendu raster de carpaint OpenPBR, verre dispersif glTF et
  soapbubble OpenPBR ; ces essais ne constituent pas une preuve de parité
  photométrique du profil approximatif ;
- quinze requêtes de bibliothèques MaterialX, sans nouvelle requête après ces
  changements de matériaux.

Les tests ciblés de cycle de vie, shaders, caméra, ressources et bibliothèques
passent (99 tests), ainsi que `npm run typecheck` et `npm run build`. La suite
complète donne 1343 succès, un test ignoré et trois échecs dans des tests/compiler
non modifiés : comptage des catégories de nœuds, signature d'échantillonnage
de transmission et unité d'épaisseur thin-film. Une exécution isolée sur HEAD
n'a pas été autorisée ; leur préexistence n'est donc pas confirmée par un
comparatif exécuté. Ces écarts restent hors du périmètre de cette optimisation.

## Présentation progressive du path tracing

Le viewer applique maintenant la même fonction d'affichage que le raster :
exposition en EV, ACES filmique puis encodage sRGB. Cela corrige le rendu
artificiellement sombre du précédent resolve Reinhard sans encodage sRGB.
Cela ne rend pas identiques les intégrateurs raster et path tracing.

### Aperçu et raffinement

- Une première image complète est toujours calculée à résolution réduite, même
  si la compilation se termine après l'arrêt des gestes.
- Pendant les mouvements, la résolution est divisée par 2, 4 ou 8 sur chaque axe.
  Le contrôleur part de 4 et ajuste après quatre mesures de complétion GPU, avec
  une fenêtre d'hystérésis de 22–55 ms autour d'un budget indicatif de 40 ms.
  Ces délais incluent la soumission et l'affichage ; ce ne sont pas des
  timestamps matériels. Aucune cadence minimale n'est garantie.
- La reconstruction bilinéaire remplace l'ancien agrandissement en gros pixels.
  Après 200 ms sans changement de caméra, l'aperçu est conservé sur le GPU ;
  seules les tuiles déjà calculées à pleine résolution le remplacent. L'aperçu
  n'est jamais réutilisé après un changement de caméra ou de dimensions.
- Le jitter des rayons caméra utilise une séquence Halton 2/3 décalée par pixel
  pour mieux répartir les échantillons progressifs. Les tirages de transport
  restent PCG, le nombre de rebonds et les modèles de matériaux sont inchangés.
- La vraie CDF HDR est partagée avec le compute, au lieu du buffer factice d'un
  seul élément précédemment fourni par le viewer à l'importance sampling.

### Fond et débruitage

Dans le viewer, le compute accumule séparément radiance de premier plan
et couverture. Le panorama visible est échantillonné directement
à la résolution de sortie, puis composé en HDR avec le premier plan. Il est net
sans attendre les samples du fond, y compris durant la compilation initiale.
La couverture Monte Carlo conserve les silhouettes et les événements d'opacité
nulle ; les réflexions et réfractions continuent à transporter le véritable HDR.
La convention de caméra de fond perspective décrite plus haut reste inchangée.

Le précédent filtre spatial WGSL **PT denoise** a été supprimé, ainsi que ses
guides normale/profondeur. Le contrôle **Denoiser JS (neural)** le remplace et
reste **désactivé par défaut**. Il charge à la demande le bundle `denoiser.js`
fourni dans le projet GLSL-PathTracer-JS et le modèle local `rt_ldr_small.tza`.
Les fichiers originaux sont conservés sans modification dans `public/denoiser`,
avec leurs notices et empreintes SHA256. Vite les copie dans le build statique ;
aucun poids n'est téléchargé depuis un CDN et aucune image n'est envoyée à un
service distant. Ce bundle JS utilise TensorFlow.js et le GPU WebGPU du viewer :
ce n'est pas un filtre exécuté uniquement sur le CPU.

L'inférence est lancée après le premier passage complet à pleine résolution,
puis tous les huit passages supplémentaires, jamais sur chaque tuile ni sur
l'aperçu pendant un geste. Un seul calcul neuronal est autorisé à la fois ;
l'accumulation est suspendue pendant ce calcul, sans modifier le choix
Pause/Reprendre de l'utilisateur. Un mouvement de caméra, un redimensionnement,
un changement de scène/mode ou la désactivation invalide le résultat en cours.
Le dernier résultat valide peut être affiché jusqu'à l'inférence suivante.
L'API de statut distingue attente d'un passage complet, chargement/calcul,
résultat prêt et erreur ; une erreur conserve le rendu brut et reste visible.

Le modèle disponible est **LDR couleur seule** : son entrée est une ImageData
sRGB après exposition et ACES, en ordre haut-vers-bas, avec conversion BGRA/RGBA
si nécessaire. La sortie n'est donc pas tonemappée ou encodée une seconde fois.
Le panorama visible est restauré hors de la couverture des objets pour rester
net. Ce traitement neuronal est une approximation d'affichage : il peut lisser
des textures, modifier des détails/reflets ou reconstruire des informations
absentes à faible nombre de samples. Il ne modifie pas l'accumulation HDR.
Désactiver le contrôle réaffiche le brut, y compris en pause, sans effacer
les samples ni recompiler les pipelines.

Les AOVs sont stockés avec la radiance dans le même buffer pour respecter les
limites mobiles de bindings storage. Le viewer utilise 32 octets par pixel
d'accumulation, plus un buffer d'aperçu d'au plus un quart du nombre de pixels
(environ 40 Mio pour ces deux buffers en 1024²), plus une texture RGBA8 de résultat
(4 Mio). L'inférence alloue temporairement une capture et un buffer de lecture,
en plus des ressources propres au réseau neuronal. Le redimensionnement remplace
les deux buffers et la texture de résultat,
sans reconstruire les données de scène ou les pipelines. Les harness de référence
conservent par défaut leur layout de 16 octets par pixel et leur jitter antérieur :
l'option `displayAovs` est activée explicitement par le viewer uniquement.

### Vérifications de cette amélioration

Sur le même SM-F731B / Adreno 740, le modèle neuronal local a produit une
ImageData valide en 64² sans erreur GPU (environ 0,86 s avec le premier chargement
et la compilation). Ce délai n'est ni un temps d'inférence à pleine résolution
ni une garantie de cadence. L'intégration sur Simple shader ball en 256² à
deux passages, y compris activation en pause, a affiché le résultat neuronal
sans erreur WGSL/WebGPU.
En 512², une inférence à chaud a pris environ 0,71 s sur six passages en pause,
sans modifier ce nombre au retour au brut. Le resize/désactivation pendant une
inférence a été suivi d'une nouvelle inférence réussie en 256², sans erreur GPU
ni réaffichage de l'ancien résultat. Ce sont des mesures ponctuelles, pas une
garantie de cadence.

Les vérifications antérieures de l'aperçu ont effectivement déclenché le passage
de 128² à 64² pour l'aperçu ; le raffinement a conservé son buffer précédent.
Carpaint OpenPBR et verre
dispersif glTF ont également compilé et progressé sur ce GPU, sans erreur
WGSL/WebGPU observée. Le raffinement de Simple shader ball en 1024² a aussi
atteint deux passages complets sans erreur GPU.

Les tests couvrent également le partage du transform d'affichage, la séparation
des layouts de référence/viewer, les bornes d'adaptation, la conservation de
l'aperçu, son invalidation au resize, le débruitage en pause et la vraie CDF.
Les tests du nouvel adaptateur couvrent aussi le chargement paresseux, la
réutilisation, l'exclusion mutuelle, les erreurs/retries et la libération différée.
Les tests du viewer vérifient qu'une erreur d'inférence est visible et qu'une
image devenue obsolète après resize/désactivation n'est jamais téléversée.
Ils couvrent aussi le réveil d'une nouvelle scène en pause lorsque l'ancienne
inférence libère le modèle partagé.

Les six fichiers ciblés totalisent 76 tests réussis ; le typage et le build
passent. Le build statique a également été exécuté sur le téléphone sous le
sous-chemin `/materialx-webgpu-engine/` : aucun chargement neuronal avant
activation, module et poids chargés localement au bon emplacement, résultat en
pause puis retour au brut sans changer les deux samples, zéro erreur GPU/WGSL.
La suite complète totalise 1356 succès, un test ignoré et les trois échecs du
compilateur déjà observés avant cette amélioration, décrits plus haut.

## Indicateur de compilation

La barre d'outils affiche un indicateur animé pendant le chargement d'une scène,
la compilation d'un matériau/profil raster et la compilation différée du path
tracer, y compris en pause. Il disparaît lorsque la compilation se termine ou
échoue. Le canvas expose également `aria-busy` ; l'animation respecte la préférence
de réduction des mouvements. La ligne descriptive « Backend … objets … Glisser »
n'est plus affichée. Une zone masquée au repos reste réservée aux erreurs.
Le compteur `N spp` reste affiché dans la barre d'outils en path tracing après
compilation, avec la mention `(pause)` lorsque l'accumulation est suspendue.
Il est masqué en raster et pendant la compilation.
Les tests d'entrée couvrent chargement, compilation PT en pause, échec de
compilation et absence de WebGPU.

## Contour gris de Simple shader ball

Le contour gris en raster a ete reproduit sur PC. Un affichage de diagnostic
des normales montre des normales de shading orientees derriere le plan de vue
sur des faces geometriquement visibles, au bord du modele. Leur inversion
brutale par l'orientation de la closure produisait la bande d'eclairage.
Le fragment raster corrige maintenant ces normales de faces avant par reflexion
continue dans l'hemisphere visible, avant l'orientation de la closure. Les
faces arriere, notamment les interfaces de sortie du verre, gardent leur logique.
Un essai GPU temporaire dans le navigateur a confirme la disparition de la
bande ; la version deployee n'a pas ete modifiee. Tests raster/backend/viewer
et compilation de production verifies. Cette correction est propre au raster.

## Chargement raster du playground simplifie

Source locale : `D:\WebGL2\MaterialX\OpenPBRShaderPlayground\ShdrPlygrnd`,
entrée `ShdrPlygrnd_OpenPBR.usda`. Scène externe servie par Vite sous
`/playground/`, sans ajout de ses assets au dépôt ni au build de production.
Profil raster interactif, sortie 512², GPU Intel `gen-12lp` non fallback.
Mesure ponctuelle en serveur de développement, pas un benchmark de production
ni une garantie de cadence.

| Étape | Durée observée |
| --- | ---: |
| Composition USD, lecture/export des crates et parsing | 133,37 s |
| Chargement des documents MaterialX et bibliothèques | 5,22 s |
| Préparation géométrie, compilation IR des matériaux et environnement | 29,60 s |
| Préparation raster : uploads, bindings et pipelines | 102,38 s |
| Début du chargement → complétion GPU du premier rendu raster | **273,23 s** |

La scène composée contient 797 prims, 341 géométries, 3 056 274 triangles,
54 références de documents MaterialX et 53 ressources de matériaux compilées
(aucun matériau en attente), huit caméras et six lumières. Le panorama EXR a
été chargé en flottant. Les 39 requêtes d'images observées pour cette passe
(textures effectivement demandées et environnement) ont toutes répondu HTTP 200,
pour environ 11,68 Mo transférés. Ce nombre n'est pas l'ensemble des 109
références de fichiers du dossier de matériaux.

Aucune erreur GPU non capturée n'a été observée. **Ce résultat valide le
raccordement et le chargement, pas la fidélité complète de la scène** : 110
avertissements ont été émis, dont des NodeDefs non résolus (`colorcorrect`,
certains `image`), des `geompropvalue` non abaissés et des prototypes sans
géométrie pour les caméras/lumières. Des contributions de graphes sont encore
remplacées par les valeurs neutres signalées par le compilateur. Ces limites
préexistantes expliquent notamment pourquoi toutes les textures ne sont pas
échantillonnées ; elles ne doivent pas être confondues avec une erreur de chemin.
Subdivision, affectations par face et conformité visuelle globale ne sont pas
qualifiées par cet essai.

Correction des avertissements apres cette mesure :

- `geompropvalue` vector2 `st` / `UV0` utilise maintenant les UV interpolees,
  sans constante neutre ; meme IR en raster et path tracing.
- Les signatures `image` exportees avec `uvtiling` sont declarees via heritage
  de la bibliotheque standard et leur transformation UV est appliquee.
- Une collision entre le noeud auteur `ND_colorcorrect_color3` et la definition
  importee est resolue par renommage interne avec preservation des connexions.
- Les cameras/lumieres portant des primvars ne deviennent plus des prototypes
  de maillage, ce qui supprime leurs faux diagnostics de geometrie manquante.

Le test `tests/materialx/core-resolution.test.ts` utilise le vrai Core WASM et
les bibliotheques locales (`MX_CORE_DIR`, `MX_LIB_ROOT`) : il verifie une
collision de noms, une image avec tiling, le maintien d'un diagnostic pour une
entree inconnue, et la compilation des 54 documents du Playground sans
diagnostic de materiau (`MX_PLAYGROUND_ROOT`). Ces tests sont ignores si les
assets externes correspondants ne sont pas disponibles. Des tests IR numeriques
verifient les UV et le tiling ; l'emission fragment/compute est couverte.
Cette verification ne remplace pas une nouvelle qualification visuelle GPU de
la scene complete : les temps et les 39 requetes ci-dessus sont ceux de la
mesure precedente, avant correction.

Sur SM-F731B / Adreno 740, essai raster en 256² : l'import a échoué avant le
premier rendu, avec `Unterminated list` dans la géométrie exportée. Une tentative
isolée d'export de la même crate a ensuite déclenché une exception native WASM.
Le statut d'échec est visible et aucun temps de premier rendu mobile n'est
annoncé. Une limite mémoire est une piste, **pas une cause confirmée** par ces
observations. Le chargement mobile de la scène complète n'est donc pas validé.

Instrumentation persistante via les mesures Performance API
`usd:composition`, `usd:materials`, `usd:resources`, `viewer:raster-build` et
`viewer:first-frame`. Les détails incluent l'entrée, les comptes de ressources
et le backend. Le dernier marqueur attend la complétion de la file GPU :
il ne s'agit pas de timestamps matériels.

## Audit de compilation des fichiers MaterialX

`npm run audit:mtlx` parcourt les fichiers `.mtlx` du workspace, hors dependances,
sorties `dist` et stockage interne, et compile chaque `surfacematerial` sur le GPU
du mobile Android autorise via ADB. Node.js 22+, Chrome avec WebGPU et les assets
MaterialX servis par Vite sont requis. Le script cree son propre serveur et ses
propres tunnels ADB, puis les libere. Il ne bascule jamais implicitement sur le PC.

```sh
npm run audit:mtlx
npm run audit:mtlx -- --target local
npm run audit:mtlx -- --root scenes --filter artistic_ior --limit 10
npm run audit:mtlx -- --device R5CW900CHQD --out docs/generated/copper-audit.json
npm run audit:mtlx -- --resume
npm run audit:mtlx -- --list
npm run audit:mtlx -- --target local --modules-only --retest docs/generated/mtlx-compile-audit.json --out docs/generated/mtlx-compile-audit-local.json
```

Les deux shaders, raster et path tracing, passent par le compilateur de graphes
reel, `getCompilationInfo()` et la creation asynchrone des pipelines. Le rapport
JSON contient les entrees nommees, NodeDefs, diagnostics, lignes WGSL et echecs
de pipeline. Le Markdown associe resume les fichiers a corriger. Par defaut :
`docs/generated/mtlx-compile-audit.json` et `.md`, sauvegardes progressivement.

Les statuts sont `compiled`, `incomplete` (noeud non pris en charge ou repli neutre),
`failed` et `skipped` (aucun terminal `surfacematerial`). Le code de sortie vaut 1
si un echec ou un materiau incomplet est trouve ; 0 sinon. `complete: false`
signale une interruption ou un echec d'infrastructure. `MX_ADB`, `MX_DEVICE` et
`MX_CHROME` permettent de personnaliser les executables/la cible ; `--port` choisit
le port prefere du serveur. `--timeout` borne chaque fichier (60000 ms par defaut).
Un timeout est consigne comme echec, puis le contexte navigateur est recharge pour
poursuivre ; il est aussi recharge tous les 10 fichiers pour liberer les pipelines.
Si la connexion ADB se renouvelle, les tunnels et la cible CDP sont recrees ; une
deconnexion persistante interrompt le run avec un rapport partiel explicite.
La reprise recree l'onglet Chrome si celui-ci a disparu. `--resume` relit le rapport
choisi par `--out`, conserve les resultats enregistres et retente les fichiers
interrompus par CDP. La cible, le repertoire et le filtre doivent correspondre au
rapport initial ; ne pas utiliser cette option apres modification des materiaux
ou du compilateur si leurs anciens resultats doivent etre revalides.
`--retest rapport.json` ne reprend que les fichiers non `compiled` d'un rapport
precedent. `--modules-only` valide le WGSL (`getCompilationInfo()`) sans creer les
pipelines : beaucoup plus rapide sur GPU Intel (compilation pilote du megakernel
path tracing), mais ne detecte pas les echecs propres a la creation de pipeline.
Un rechargement inattendu de la page est retente une fois ; le serveur d'audit
desactive le HMR.
Aucun fichier MaterialX ni lowering n'est modifie.

Cet audit ne charge pas les images et ne rend pas de pixels : une compilation
reussie ne prouve ni la disponibilite des textures ni la fidelite du rendu.

## Rendus de la scène standard-shader-ball

`npm run test:shaderball` rend `scenes/standard-shader-ball/standard-shader-ball.usda`
sur le GPU local (par défaut) ou le mobile, en raster et en path tracing, via
`usd-image-harness.html`. `--materials <filtre>|all` sélectionne les fichiers
`.mtlx` de `scenes/mtlx-library` liés à `OpenPBRMaterial`.
Sans `--materials`, seuls `scene__raster` et `scene__pathtracing` sont rendus :
les matériaux et bindings du USDA sont conservés, sans parcourir la bibliothèque
ni ajouter de variante. Avec `--materials`, seules les variantes sélectionnées
sont rendues ; `--materials all` parcourt toute la bibliothèque.
Pour comparer les matériaux aux rendus de référence de la boule frontale,
utiliser la scène OpenPBR sur mobile. La scène par défaut utilise une géométrie
et une caméra différentes ; les rendus GPU locaux ne sont pas l'oracle de ces
comparaisons.

```sh
npm run test:shaderball
npm run test:shaderball -- --target local
npm run test:shaderball -- --entry /scenes/pathtracer/ajax.usda
npm run test:shaderball -- --entry /scenes/standard-shader-ball/openpbr-rva-standard-shader-ball.usda --target mobile
npm run test:shaderball -- --target local --materials open_pbr_surface --spp 32
npm run test:shaderball -- --backends raster --materials all --list
```

Les PNG et `report.json` sont écrits dans `renders/shaderball/<cible>/`. Un cas est
`ok`, `black` (moins de 2 % de pixels non noirs, réglable par `--black-threshold`)
ou `failed` (exception, perte du device, délai `--timeout` de 600000 ms dépassé).
Le code de sortie vaut 1 si un cas n'est pas `ok`. Autres options : `--res`
(256), `--spp` (16), `--port`, `--device`, `--out-dir`.
Chrome démarre sur une page neutre : aucun rendu raster préalable n'est lancé,
même pour une commande limitée au path tracing. Seuls les backends demandés
sont exécutés.
Le runner conserve maintenant une page et un `GPUDevice` pendant la commande.
Chaque cas est lancé par un appel JavaScript, sans navigation supplémentaire.
Les modules WGSL, layouts et pipelines compatibles sont réutilisés ; un shader
ou un état de pipeline différent conserve sa propre entrée. Les compteurs
`sessionCache.hits/misses` sont affichés et sauvegardés par cas dans le rapport.
Les buffers et textures du cas précédent sont détruits avant le cas suivant.
Une reprise après erreur recrée la page et donc la session GPU et ses caches.
Ces caches ne persistent pas entre deux commandes ; les pipelines raster et
compute restent distincts. La phase `pageLoadAndModules` n'est comptée que
pour le premier rendu réussi de chaque page.

### Affichage sans capture

```sh
npm run test:shaderball -- --headed --server static --backends pathtracing --res 512 --spp 16 --entry /scenes/pathtracer/ajax.usda
npm run test:shaderball -- --integrated --server static --backends pathtracing --res 512 --spp 16 --entry /scenes/pathtracer/ajax.usda
```

`--headed` ouvre Chrome visible avec un profil temporaire. `--integrated`
ne lance pas Chrome : copier une URL affichée dans le navigateur intégré de
VS Code (commande « Browser: Open Integrated Browser » ou « Simple Browser: Show »).
Le support WebGPU dépend du navigateur intégré. Ces modes locaux sont exclusifs,
ne sauvegardent ni PNG ni rapport JSON et ne prennent pas en charge `--resume`.
Le serveur reste actif jusqu'à Ctrl+C ; fermer Chrome termine aussi `--headed`.
Chaque combinaison matériau/backend dispose d'une URL (un onglet en mode headed).
Ces modes ouvrent le viewer avec un vrai canvas WebGPU : rotation à la souris
et zoom à la molette, rendu raster ou path tracing progressif. Les paramètres
`--entry`, `--res` (256, 512 ou 1024), `--backends` et les overrides matériaux
sont transmis au viewer. `--spp` ne limite pas le rendu interactif : les samples
s'accumulent et repartent après un mouvement de caméra. Le mode statique doit
être recompilé pour inclure le viewer (`npm run build:shaderball`).
Sans ces options, le mode automatique headless reste inchangé.

### Compilation statique

Compiler une fois le harnais, puis utiliser le serveur HTTP Node statique :

```sh
npm run build:shaderball
npm run test:shaderball -- --server static --target local --backends pathtracing --entry /scenes/pathtracer/ajax.usda
```

Le build utilise Vite, mais les rendus `--server static` ne le chargent pas.
Recompiler après un changement du moteur ou du harnais. Les scènes et matériaux
restent lus directement dans `scenes/` ; leur modification ne nécessite pas de
rebuild. Les fichiers compilés sont dans `dist-shaderball/` (ignoré par Git).
Ce mode est local, pas un paquet autonome : MaterialX/WASM et les bibliothèques
restent accessibles via `MX_CORE_DIR`, `MX_LIB_ROOT` et `MX_PLAYGROUND_ROOT`,
avec les mêmes valeurs par défaut que le serveur de développement. Aucun gros
asset n'est recopié. Un build absent produit une erreur explicite.
Le port statique demandé doit être disponible. Le mode `--server vite` reste
le défaut pour le développement ; `--materials`, les backends, les chronos et
les sorties PNG/JSON fonctionnent dans les deux modes.

Les lignes `[shaderball] timing` détaillent les durées en millisecondes.
En fin d'exécution, un tableau `Phase | Durée` récapitule ces mesures en
secondes, démarrage et nettoyage inclus. Les phases sont cumulées pour les cas
exécutés dans la commande courante (hors résultats conservés par `--resume`).
La ligne « Autres opérations et nettoyage » est le reste du temps total :
lecture des pixels, encodage/transfert/écriture PNG, attente, reprises et nettoyage.
Les totaux intermédiaires ne sont pas additionnés aux phases.
Un second tableau détaille la mémoire en Mio (également sauvegardée dans
`memory` pour chaque cas et dans le rapport). Le CPU Node expose RSS, pic RSS
du processus, tas JS, mémoire externe et ArrayBuffers (déjà inclus dans externe).
Sous Windows en cible locale, Chrome inclut uniquement le processus lancé par
le script et ses enfants : somme des working sets (RSS) et mémoire privée
engagée. Le RSS cumulé peut compter des pages partagées plusieurs fois.
Ces relevés sont effectués en fin de cas et avant nettoyage ; leur maximum
n'est pas un pic continu. La mesure processus Chrome est indisponible sur mobile
et hors Windows, sans empêcher les rendus.

Le GPU expose les pics des buffers, des textures et de leur total simultané,
en comptabilisant les créations et destructions explicites sur le device du
harnais (mips, couches et MSAA inclus). Ce sont des estimations logiques :
pas la VRAM réelle, ni les allocations du pilote, pipelines ou alignements ;
les formats depth24 sont estimés à 4 octets/texel. Les formats non pris en
charge sont signalés, pas comptés comme zéro silencieusement. La récupération
implicite par le GC n'est pas mesurée. Pour plusieurs cas, le tableau prend le
maximum, pas la somme de leurs pics. Les résultats repris ne sont pas inclus.
Recompiler avec `npm run build:shaderball` pour actualiser ces mesures en mode statique.
Chaque cas expose `timings` dans `report.json` : initialisation WebGPU, import
USD, environnement, documents MaterialX, chargement de géométrie, ressources
de scène (dont compilation des graphes), puis préparation du backend, rendu,
lecture des pixels et encodage PNG. Pour le path tracing, la préparation sépare
BVH/upload d'environnement, dispatch/textures, compilation du pipeline et
ressources GPU restantes. Le raster regroupe sa préparation sous
`rasterPreparation`.

`total` couvre le harnais après le chargement des modules ;
`pageLoadAndModules` couvre le temps écoulé depuis l'origine temporelle de la
navigation jusqu'à son entrée. `caseWall` mesure le cas côté Node, navigation,
attente de disponibilité, transfert CDP et écriture PNG inclus.
Ces totaux se recouvrent : ne pas les additionner aux phases.
Les durées globales du rapport séparent `serverStartup`, `browserStartup`,
`cleanup` et `commandTotal`. Ce dernier couvre le script, pas le démarrage npm
ou Node ; les éventuelles reprises y sont incluses. Les mesures sont des temps
écoulés CPU/GPU avec synchronisation, pas des timestamps GPU purs.

Le rapport est sauvegardé après chaque cas ; `--resume` (mêmes options, même
`--res`/`--spp`) conserve les cas `ok`/`black` déjà rendus et relance les `failed`
puis les cas restants.
En cours de run, un plantage (connexion CDP perdue, onglet ou Chrome fermé, perte
du device GPU, mobile déconnecté puis reconnecté dans les 2 minutes, délai dépassé)
déclenche une reprise automatique : Chrome ou l'onglet est relancé, les tunnels ADB
sont recréés et le cas est retenté une fois. Au-delà de `--max-recoveries` (20)
reprises, le run s'arrête ; `--resume` permet alors de continuer.

Le harness path tracing utilise le meme decoupage 4x4 que le viewer, avec attente
de fin GPU entre les tuiles. Chaque pixel conserve son indice global, sa graine
aleatoire et tous ses echantillons ; le compteur de samples n'avance qu'apres
les 16 tuiles. Il ne s'agit ni d'une reduction de resolution ni d'une diminution
du nombre de rebonds ou des tests de visibilite alpha. L'ancien dispatch
plein cadre provoquait une perte du device mobile (`VK_ERROR_DEVICE_LOST`)
avec `surfaces/gltf_pbr/gltf_pbr_sweep_alpha_0_75`, meme a 256x256 et 16 spp.
Le controle suivant a reussi avec le decoupage, sans modifier le materiau :

```sh
node scripts/run-shaderball-renders.mjs --entry /scenes/standard-shader-ball/openpbr-rva-standard-shader-ball.usda --target mobile --materials /surfaces/gltf_pbr/gltf_pbr_sweep_alpha_0_75 --backends pathtracing --out-dir renders/shaderball-alpha-075-validation
```

Ce succes valide la stabilite et la production du PNG, pas la conformite
visuelle complete ; le rendu path trace a 16 spp reste bruite.

## Arguments des noeuds MaterialX

Les noeuds `tiledimage` appliquent `((texcoord * uvtiling - uvoffset) /
realworldimagesize) * realworldtilesize`, puis la conversion V vers l'espace
image, avec adressage periodique sur les deux axes. Les parametres connectes
et les valeurs NodeDef restent actifs pour les sorties couleur, float et
normale. Brick procedural demande notamment `uvtiling = (3, 3)` : l'ignorer
produit des briques trois fois trop grandes. Les tests de `surface-ir` verifient
les coordonnees numeriques et l'emission raster/compute du meme sous-graphe.
Les normales connectees des surfaces MaterialX sont conservees dans la fermeture
WGSL, puis utilisees pour le repere BSDF et l'irradiance dans les deux backends.
La normale geometrique reste le repli des surfaces sans normale connectee.
Le graphe `normalmap` de Brick et sa texture ne doivent pas etre elimines comme
des expressions inutilisees lors de l'emission de la surface.

Pour le verre refractif, orienter le demi-vecteur de reflexion vers le rayon
incident, pas toujours vers +Z. Sinon les reflexions internes (dont la reflexion
totale) sont rejetees avec une PDF nulle et les trajets deviennent noirs.
`tests/fixtures/glass-reflection-probe.ts` expose `runGlassReflectionProbe(device)` :
les trois cas WebGPU (exterieur, interieur, reflexion totale) doivent rester
valides et conserver une energie unitaire a `1e-4` pres.
L'interface `gltf_pbr` conserve aussi l'IOR auteur (`1.52` pour le showcase glass).
La validation du verre est faite sur mobile avec la scene OpenPBR.
En raster, les dielectriques quasi delta suivent le meme critere que le path
tracer (`mx_closure_is_specular`) : quadrature BSDF conservee a 64 echantillons,
sans echantillonnage concurrent de l'environnement ni attenuation MIS.
Les autres lobes conservent les deux strategies et leurs poids MIS.
Cela evite la perte du GPU mobile observee a 256x256 dans la passe verre
avec la double quadrature, sans reduire la resolution ou le nombre d'echantillons.
Le raster reste une approximation a une interface ; il ne reproduit pas les
refractions successives du path tracer.

Les fermetures speculaires avec un seul lobe dielectrique actif utilisent
directement `mx_dielectric_transmission_sample/eval` dans la quadrature raster.
Le lobe contient deja les branches Fresnel de reflexion et de refraction :
repasser par le dispatch de toute la fermeture a chaque echantillon est inutile
et provoquait `VK_ERROR_DEVICE_LOST` sur le mobile avec `glass_tinted`
(rugosite 0.15). Les 64 echantillons, les deux strategies d'environnement,
leurs PDF, les poids MIS et le poids auteur du lobe sont conserves.
Les fermetures multicouches ou multilobes gardent la voie generale ; la voie
analytique des feuilles strictement lisses reste prioritaire.
`tests/fixtures/single-dielectric-probe.ts` expose
`runSingleDielectricProbe(device, code)` : 24 cas couvrent le
selecteur et la parite avec la quadrature complete (verre teinte, poids partiel,
vue interieure, reflexion totale, feuille mince, plusieurs rugosites et rejets
des couches/melanges, ainsi que la reflexion dielectrique seule isotrope et
anisotrope, et quatre cas conducteur/Schlick). La tolerance absolue est `2e-5` ;
sur les 24 cas, l'ecart maximal observe
sur le mobile R5CW900CHQD est `4.77e-7`. Les 12 cas de feuille lisse et les
3 cas de reflexion du verre restent valides.

## Relief heighttonormal et repere des normales

`heighttonormal` reevalue le sous-graphe de hauteur aux quatre UV voisins dans
les deux backends. Les differences centrales utilisent un pas d'un texel de la
premiere texture amont, ou 1/1024 en UV pour un graphe sans texture. Le graphe
amont, ses transformations UV et le repere `texcoord` explicite sont reevalues ;
le facteur MaterialX `scale / 16` et l'encodage [0, 1] sont conserves.
Le compute ne remplace plus le resultat par une normale plate.

Cette approximation utilise le niveau de texture 0. Elle n'est pas un filtre
Sobel 3x3 ni une reproduction exacte des differences entre fragments du GLSL
MaterialX ; les details sous-pixel restent sujets a l'aliasing.

`normalmap` utilise les trois vecteurs N, T et B, y compris une bitangente auteur,
au lieu de reconstruire inconditionnellement B par `cross(N, T)`. Le signe du
repere tangent est transporte en raster et dans le buffer PT (12 floats par
triangle : trois tangentes vec4 avec le signe en w). Les transformations miroir
du modele sont prises en compte. Le vecteur echantillonne nul retrouve la
normale N, conformement a MaterialX. L'oracle CPU suit la meme convention et
accepte aussi une echelle XY distincte.

`tests/fixtures/heighttonormal-probe.ts` expose
`runHeightToNormalProbe(device)` : 14 controles GPU verifient des hauteurs
constantes, des rampes, une image bilineaire connue, une echelle nulle, des UV
inverses ou degeneres, puis la conversion dans un repere monde tourne, avec les
deux signes de bitangente. Ils ont reussi sur R5CW900CHQD avec une tolerance
absolue de `2e-5`. Les 187 tests cibles du compilateur, des buffers PT et des
shaders raster/PT passent, ainsi que `npm run typecheck`.

```sh
node scripts/run-shaderball-renders.mjs --entry /scenes/standard-shader-ball/openpbr-rva-standard-shader-ball.usda --target mobile --materials /surfaces/standard_surface/heighttonormal_normal_input --out-dir renders/shaderball-heighttonormal-final-validation --port 5198
```

Les controles standards a 256x256/16 spp et le controle distinct a 512x512/64 spp
ont produit les deux images sans perte du device. Le relief est present en PT,
mais le raster reste plus plat et les contours different de la reference :
la fidelite visuelle complete n'est pas validee par les seuls tests de normales.
L'orientation opaque face a la vue reste celle de
`mx_forward_facing_normal` de MaterialX ; la retourner uniquement d'apres la
normale geometrique cree des zones noires avec les fortes pentes de ce materiau
et n'est pas une correction conforme a cet oracle.

## Dispersion et aspect rugueux

La dispersion utilise une approximation RGB de `KHR_materials_dispersion` :
`halfSpread = (ior - 1) * 0.025 * dispersion`. Les trois IOR sont
`ior - halfSpread`, `ior`, `ior + halfSpread`, bornes a 1 au minimum.
Le parametre Abbe de standard_surface est converti en `20 / Abbe` lorsqu'il
est positif ; OpenPBR applique aussi son facteur de dispersion.
Le raster evalue trois fermetures et conserve le canal correspondant de chacune.
Le path tracer choisit un canal au premier verre dispersif, compense son poids
par 3 et conserve ce canal aux interfaces suivantes. Les trajets sans dispersion,
les feuilles minces et les conducteurs sans transmission active ne passent pas
par cette selection. Ce modele n'est pas un transport spectral continu.

Ne pas confondre les deux materiaux suivants lors de la comparaison :

- `surfaces/gltf_pbr/feature_dispersion` omet metallic et roughness ; leurs
  valeurs par defaut sont toutes deux 1. Sa reference est mate. La transmission
  auteur vaut 1, mais son poids effectif est nul avec metallic = 1.
- `showcase/gltf_pbr/glass_dispersion` declare metallic = 0 et roughness = 0.02 :
  c'est un verre lisse, pas un substitut pour valider la reference precedente.

Les materiaux et les references restent inchanges. La dispersion ne doit pas
servir a modifier la rugosite ou a activer la transmission d'un metal.

La provenance de la reference `feature_dispersion` a ete verifiee par SHA-256 :
le fichier `surfaces__gltf_pbr__feature_dispersion__feature_dispersion__ref.avif`
est identique a `beauty/blender-eevee-nodes.avif` dans la bibliotheque
`material-samples/materials/surfaces/gltf_pbr/feature_dispersion`
(`9201c9162736385ad20cdb1b8537e5d0e77572c103d9dcaf8460572fb0f9275e`).
Ce n'est donc pas le rendu `materialx-glsl` du meme dossier. Le fichier auteur
est identique a celui embarque dans le moteur. L'aspect depoli/translucide de
cette reference ne suffit pas a justifier un changement des poids MaterialX :
la conversion Blender et ses valeurs implicites restent a verifier avant de
revendiquer une parite de modele ou de changer les valeurs par defaut.
Decision de validation : conserver la semantique MaterialX stricte et signaler
cette reference comme incompatible pour le critere de transmission. Le moteur
doit donc rester opaque pour ce fichier (metallic implicite = 1) ; ne pas
ajouter d'alpha ou de transmission forcee pour imiter le rendu Eevee.

```sh
node scripts/run-shaderball-renders.mjs --entry /scenes/standard-shader-ball/openpbr-rva-standard-shader-ball.usda --target mobile --materials /surfaces/gltf_pbr/feature_dispersion --spp 64 --out-dir renders/shaderball-feature-dispersion-validation
node scripts/run-shaderball-renders.mjs --entry /scenes/standard-shader-ball/openpbr-rva-standard-shader-ball.usda --target mobile --materials /showcase/gltf_pbr/glass_dispersion --spp 64 --out-dir renders/shaderball-dispersion-validation
```

Ces controles a 64 spp sont distincts de la commande standard a 16 spp.
Les deux cas de chaque commande ont produit des images sur mobile sans crash.
Cela ne valide pas leur fidelite : la comparaison de `feature_dispersion` montre
une teinte trop grise/bleue par rapport aux reflets chauds et doux de sa reference.
Cet ecart visuel reste ouvert ;
la reference Eevee est incompatible comme oracle de transmission, selon la
decision de conserver la semantique MaterialX stricte.
Le verre dispersif presente aussi un bruit chromatique important a 64 spp ;
le raster reste limite a une interface. Les entrees de volume non reconnues
(`thickness`, `attenuation_distance`, `attenuation_color`) du showcase sont
signalees par les diagnostics et leur effet n'est pas valide.

`tests/fixtures/dispersion-probe.ts` expose `runDispersionProbe(device)` :
15 cas WebGPU confrontent les directions a Snell et a la reflexion totale,
avec entree, sortie, dispersion nulle et feuille mince pour les trois canaux.
La tolerance absolue est `2e-5`. Ils ont reussi sur le mobile R5CW900CHQD,
ainsi que les 24 cas de parite de quadrature cites plus haut.
Ces preuves numeriques ne remplacent pas la comparaison visuelle.

### Routage raster des metaux sans transmission effective

Un metal constant a 1 annule la transmission dielectrique. Il doit donc rester
dans la passe opaque avec ecriture de profondeur, meme si l'entree auteur
`transmission` vaut 1 ou si l'analyse conservative marque une passe transmissive.
La passe sans ecriture de profondeur laissait des triangles arriere ecraser les
faces visibles de `feature_transmission` et `feature_dispersion` : grands aplats
et contours internes incorrects, reproduits sur GPU mobile et local.
Le choix de passe tient maintenant compte du metal constant resolu pour les
familles de surface. Une metalness connectee conserve le routage conservatif ;
une vraie couverture alpha BLEND et le mode MASK gardent leurs passes respectives.
Le BSDF, les valeurs par defaut MaterialX et les fichiers auteur sont inchanges.

```sh
node scripts/run-shaderball-renders.mjs --entry /scenes/standard-shader-ball/openpbr-rva-standard-shader-ball.usda --target mobile --materials /surfaces/gltf_pbr/feature_transmission --backends raster --out-dir renders/shaderball-transmission-validation
```

Le rendu mobile 256x256 ne presente plus les grands aplats. Le meme controle
raster de `feature_dispersion` retablit les gradients et l'occultation des faces.
Le vrai verre `showcase/gltf_pbr/glass_dispersion` reste refractif et se rend
sans perte du device. Ces controles ne prouvent pas la parite visuelle complete
avec les references.

## Coat colore : substrat et echantillonnage

Le graphe MaterialX standard_surface multiplie le substrat par
`mix(white, coat_color, coat)`. Le coat reflechit une lumiere non teintee.
Le moteur conserve les deux facteurs Fresnel de passage et utilise maintenant
cette teinte lineaire, sans exposant d'absorption dependant du trajet qui
saturait et assombrissait artificiellement le substrat aux angles rasants.
Le lowering et les fichiers auteur ne sont pas modifies.

Les PDF et le choix du lobe coat emploient la meme probabilite
`min(coat_weight * Fresnel(wo), 0.95)` sur CPU et GPU, plutot que d'allouer 95 %
des samples au coat pour un reflecteur normal d'environ 4 %. Les tests verifient
la teinte a plusieurs angles, les poids partiels, la PDF du melange,
la coherence eval/sample et la conservation d'energie.

En raster, le diffus d'une surface avec coat actif, sans fuzz, n'est plus ajoute
comme un terme SH non colore. Il integre l'environnement HDR avec la meme teinte
et les facteurs Fresnel, par quadrature cosine + CDF, 64 samples par strategie
avec MIS. Le speculaire reste separe pour ne pas compter le diffus deux fois.
Les stacks coat simples sans fuzz, film ni transmission utilisent une quadrature
directe de chaque lobe et du coat, avec attenuation du substrat ; le dispatch
multicouche complet pouvait perdre le device mobile. Les autres stacks gardent
la voie generale. La combinaison coat/fuzz conserve la voie SH/LTC existante
et n'est pas couverte par cette correction.

```sh
node scripts/run-shaderball-renders.mjs --entry /scenes/standard-shader-ball/openpbr-rva-standard-shader-ball.usda --target mobile --materials /surfaces/standard_surface/coat_color_variation --out-dir renders/shaderball-coat-validation
```

Les controles de convergence a 64 ou 256 spp sont distincts du controle standard
a 16 spp. Ne pas assimiler le statut `ok` a une parite visuelle : le raster
n'integre pas les rebonds multiples et sa visibilite differe du path tracer.
`tests/fixtures/coat-probe.ts` expose `runCoatProbe(device, code)` pour comparer
le diffus coat GPU a une integrale analytique sous environnement constant :
six cas (poids 0, 0.5, 1 ; vues normale et rasante), tolerance absolue `2e-4`.

## Couverture alpha glTF

Les entrees `alpha_mode` et `alpha_cutoff` font partie de l'interface resolue
de `gltf_pbr`, au meme titre que `alpha`. Le lowering CPU et WGSL applique :

- OPAQUE (0) : opacite 1, independamment d'alpha ;
- MASK (1) : opacite 0 si `alpha < alpha_cutoff`, sinon 1 (egalite incluse) ;
- BLEND (2) : alpha borne entre 0 et 1.

L'alpha n'est ni une couleur de transmission ni un IOR. Le path tracer tire
l'acceptation de chaque intersection selon cette couverture avant toute emission
ou evaluation BSDF. Un rejet continue le rayon droit sans changer le throughput,
la PDF precedente ou l'etat MIS. Les rayons d'ombre accumulent le produit des
`1 - opacite` le long du segment vers la lumiere ou l'environnement.
Les limites de securite restent 64 intersections par trajet et 128 pour les
rayons d'ombre ; les empilements au-dela de ces limites ne sont pas valides.
Le raster rejette les fragments de couverture nulle et retourne l'alpha reel.
MASK utilise une passe `masked` double face, sans blending, avec test et ecriture
de profondeur : les fragments conserves sont opaques et s'occultent selon leur
profondeur, pas l'ordre des triangles. BLEND utilise la composition alpha sans
ecriture de profondeur ; OPAQUE garde la passe opaque.
Le tri/OIT raster reste approximatif pour les couches qui se chevauchent.

Les faces opaques exposees par une decoupe sont evaluees dans un repere oriente
vers la vue, dans les deux backends. Les interfaces de verre solide conservent
leur normale signee pour distinguer l'entree de la sortie et ne pas casser
la refraction ou la reflexion totale.

L'eclairage diffus d'environnement du path tracer, hors voie fuzz/LTC existante,
utilise la fermeture complete dans la NEE avec visibilite alpha et conserve les
contributions d'environnement des rebonds diffus avec MIS. Il ne remplit plus
les cavites avec une irradiance SH non occultee. Les surfaces masquees peuvent
ainsi projeter de vraies ombres sur les autres surfaces et recevoir des rebonds
indirects, plutot qu'un facteur d'occlusion ambiante applique a posteriori.
La voie SH du fuzz n'est pas modifiee par ce correctif et reste une limite pour
les ombres de materiaux avec fuzz actif.

```sh
node scripts/run-shaderball-renders.mjs --entry /scenes/standard-shader-ball/openpbr-rva-standard-shader-ball.usda --target mobile --materials /surfaces/gltf_pbr/alpha_mode_ --spp 64 --out-dir renders/shaderball-alpha-validation
```

Verifier les six sorties, pas seulement leur statut : BLEND laisse apparaitre
le decor sans refraction, MASK presente une decoupe franche suivant l'UV et
OPAQUE reste opaque meme si l'alpha auteur est inferieur a 1. Le controle a
64 spp est distinct de la commande standard a 16 spp et ne modifie pas celle-ci.

Le materiau de demonstration `surfaces/gltf_pbr/feature_alpha` declare
explicitement `alpha_mode = 2` avec `alpha = 0.5`. Sans cette declaration,
le mode glTF par defaut est OPAQUE : la reference transparente ne correspondait
pas au fichier auteur. Ne pas changer le defaut global pour compenser cette
omission. Son lobe conducteur unique utilise aussi la quadrature directe
64 echantillons, avec les memes PDF et MIS que le dispatch complet ; cela evite
la perte du device mobile observee dans la passe BLEND de ce materiau.

```sh
node scripts/run-shaderball-renders.mjs --entry /scenes/standard-shader-ball/openpbr-rva-standard-shader-ball.usda --target mobile --materials /showcase/standard_surface/glass_tinted
```

Cette commande doit produire les deux PNG sans perte du device. Ce controle de
stabilite ne vaut pas conformite visuelle a la reference : en particulier,
le raster a une interface garde une transmission et des reflets differents
d'un rendu volumique a refractions multiples.

Les feuilles dielectriques strictement lisses (rugosite et anisotropie nulles,
transmission thin-walled active, sans coat ni autre lobe speculaire) integrent
directement les deux directions delta de l'environnement : reflexion et
transmission droite. Le Fresnel et les interferences de couche mince restent
actifs, mais ne sont plus recalcules 64 fois par fragment. Cela evite la perte
du GPU Adreno sur `soapbubble` a 256x256. Les feuilles sont evaluees des deux
cotes ; le verre refractif et les materiaux rugueux conservent la quadrature.
Cette voie conserve le modele existant de transmission, sans lui ajouter une
attenuation coloree complementaire au film.
`tests/fixtures/smooth-sheet-probe.ts` expose `runSmoothSheetProbe(device, code)`
pour verifier sur WebGPU le selecteur, les directions, le Fresnel et le film
de 500 nm a IOR 1.4, a partir du code produit par `assembleIrForwardShader`.

La couche `fuzz` d'OpenPBR utilise le sheen Zeltner/LTC de MaterialX, pas le
sheen Charlie des autres surfaces. Son albedo directionnel `E(N.V, roughness)`
attenue le BSDF sous-jacent par `1 - fuzz_weight * E` ; un poids de 1 ne masque
donc pas completement le substrat. L'eclairage indirect suit MaterialX :
irradiance SH multipliee par `fuzz_color * fuzz_weight * E`, sans compter le
fuzz une deuxieme fois dans la quadrature d'environnement. Le BSDF direct et
les rebonds utilisent le lobe LTC et sa PDF transformee. Les tests `OpenPBR
fuzz layer` verifient l'albedo, l'attenuation, la coherence evaluation/PDF et
l'energie dans un environnement uniforme aux vues normale et rasante.

Pour `worleynoise2d/3d`, `style=0` retourne les distances triees F1/F2/F3,
et `style=1` retourne une couleur constante par cellule (Solid), pas une
distance. Le placement des germes et les couleurs utilisent le hachage
Jenkins MaterialX. En mode Solid, le resultat scalaire et les composantes
vectorielles utilisent des hachages distincts, comme `mx_noise.glsl`.
Les valeurs numeriques de regression sont dans `tests/fixtures/worley-cases.ts`.
Comparer `worleynoise2d_vector2` sur mobile avec la scene OpenPBR : les cellules
doivent etre polygonales et uniformes, sans gradients radiaux.

Pour les modes Cell et Fractal de `unifiednoise2d/3d`, respecter le graphe
`stdlib/stdlib_ng.mtlx` : appliquer frequence et offset, puis une rotation
de `(jitter - 1) * 90000` degres (axe `(0.1, 1, 0)` en 3D). Les cellules
et les gradients du fractal utilisent le hachage entier Jenkins de MaterialX,
pas le hachage des autres bruits du moteur. Le fractal conserve sa somme signee,
sans appliquer `* 0.5 + 0.5` avant le remapping vers `outmin/outmax` :
ce biais rendrait le materiau trop clair et supprimerait ses zones noires.
En 2D, le fractal utilise la position non tournee et l'angle de jitter comme
troisieme coordonnee. Worley conserve aussi la position non tournee.
Les cas `unifiednoise3d_omit_position` et `unifiednoise3d_type3` sont
valides visuellement avec la scene
OpenPBR sur mobile, en raster et en path tracing ; un statut `ok` du rapport
ne suffit pas a prouver la correspondance avec l'image de reference.

Pour `smoothstep`, appliquer l'ordre des tests de MaterialX
(`stdlib/genglsl/mx_smoothstep_float.glsl`) sur chaque composante :
`in >= high` retourne 1 en priorité, puis `in <= low` retourne 0 ;
seules les valeurs restantes sont interpolées. Les bornes égales retournent
donc 1 à l'égalité. Les bornes inversées ne sont pas triées : elles produisent
un seuil à `high`, pas une rampe. CPU et WGSL suivent la même règle ; le WGSL
protège aussi le dénominateur des branches non sélectionnées.

Pour `ln`, les entrees finies negatives ou nulles renvoient explicitement zero,
comme la reference `ln_degenerate_nonpositive_input`. Le logarithme GPU ne
recoit que des arguments positifs : les composantes hors domaine sont remplacees
par 1 avant `log`, puis leur resultat par 0. Le CPU applique la meme regle.
Les entrees strictement positives, meme tres petites, restent inchangees
(pas de seuil epsilon). Cette convention explicite evite de dependre du resultat
indefini de `log(x <= 0)` selon le pilote.

Les textures SVG du viewer et du harness sont rasterisees via
`HTMLImageElement.decode()` puis un canvas 2D. Chromium ne prend pas en charge
leur decodage direct par `createImageBitmap(Blob)`. Les formats bitmap conservent
ce dernier chemin. Les URL objet et les bitmaps sont liberes, meme en cas
d'erreur. Un fichier trouve mais impossible a decoder produit un diagnostic
et un echec explicite, pas une texture noire silencieuse. Le cas
`image_format_svg` valide le rendu sur les deux backends.

Les noeuds `image` conservent `uaddressmode`, `vaddressmode` et `filtertype`
depuis les entrees MaterialX (ou leurs valeurs NodeDef) jusqu'aux samplers
raster et path tracing. `clamp` utilise `clamp-to-edge`, `periodic` utilise
`repeat`, `mirror` utilise `mirror-repeat`, et `closest` utilise `nearest`.
Sans reglage, le comportement reste `repeat` / `linear`. Le filtre `cubic`
reste une approximation bilineaire. Le mode `constant` utilise l'entree
`default` hors de `[0, 1]` sur l'axe concerne. Le sampler CPU applique les
memes modes. Pour `image`, la transformation `uv_scale` / `uv_offset` est
suivie de l'inversion V avant l'echantillonnage. Le cas
`image_addressmode_clamp` etend les UV a `[-1, 2]` et permet de verifier que
les bords sont prolonges, sans repetition ni inversion haut/bas.

Pour `hextiledimage`, le lowering partage applique le `tiling` aux UV puis
inverse V dans l'espace image : `(u * tiling.x, 1 - v * tiling.y)`, en raster
comme en path tracing. Le test `hextiledimage_probe_tiling` utilise `(2, 1.5)`
avec rotation, scale et offset aleatoires desactives. Les tests unitaires
verifient les coordonnees echantillonnees, y compris hors de `[0, 1]`, avec
tiling litteral, connecte ou omis. Le lowering construit ensuite la grille
triangulaire, trois coordonnees aleatoires (rotation, echelle, decalage) et
leur melange avec poids de luminance, contraste et falloff. `rotation` est
une amplitude de randomisation ; `rotationrange` donne les angles en degres,
et non une rotation globale des UV. Un oracle numerique independant teste
ces calculs pour les sorties color3 et color4, avec des poids alpha separes.
Pour comparer ce probe aux references utilisant la boule frontale, passer
`--entry /scenes/standard-shader-ball/openpbr-rva-standard-shader-ball.usda`
au script `test:shaderball` ; la scene par defaut utilise une autre geometrie
et une autre camera.

Les espaces couleur declares sur les fichiers sont conserves dans les bindings
raster et path tracing. Une texture `srgb_texture` est envoyee en
`rgba8unorm-srgb` pour decoder RGB en lineaire avant le filtrage ; alpha reste
lineaire. Les textures lineaires et les entrees sans espace declare conservent
`rgba8unorm`. Un meme fichier utilise comme couleur et comme donnees partage
son decodage, mais pas son interpretation couleur. Le sampler CPU suit la
meme convention. Cette correction ne change ni l'exposition ni le tonemapping.

Le raster fournit aux matériaux les tangentes interpolées de la géométrie,
transformées dans le monde et orthogonalisées à la normale, comme le path tracing.
La bitangente est dérivée par `normalize(cross(normal, tangent))` avec la même
convention que le path tracing. Sans tangente valide, les deux axes proviennent
du repère orthonormal de secours. Les nœuds `tangent`, `bitangent` et `normalmap`
ne reçoivent donc plus des vecteurs nuls dans le raster.

Le raster intègre les reflets spéculaires depuis la HDR de la scène, avec les
mêmes coordonnées latlong que le path tracing. Une quadrature déterministe
combine 64 échantillons BSDF et 64 échantillons de la CDF de luminance avec MIS ;
elle remplace l'ancien gradient ciel/sol artificiel. La rugosité provient des
lobes partagés et l'intensité, la teinte et l'échelle HDR sont conservées.
Le diffus reste éclairé par les SH. Cette approximation sans occlusion des
reflets ne reproduit pas les rebonds ni les ombres du path tracing.
La quadrature utilise une copie de la closure dont seuls les lobes spéculaires
et le coat restent actifs. Les valeurs et PDF sont issus de cette même closure,
sans réévaluation séparée de la réponse spéculaire. Cela évite les calculs
redondants qui provoquaient une perte du périphérique Vulkan sur le mobile
avec `fractal2d_defaults`, sans réduire les 64 + 64 échantillons.
Une scène ne contenant qu'une `DomeLight` n'ajoute aucune lumière directionnelle
implicite : raster et path tracing sont éclairés uniquement par l'environnement.
Les lumières explicitement présentes dans la scène restent actives.

La couleur `base_color` de `standard_surface` est bornée par composante à
`[0, 1]` lors de la construction des lobes diffus et conducteurs, sur CPU et GPU.
Les valeurs intermédiaires du graphe (notamment les sorties de `artistic_ior`)
restent inchangées. L'émission HDR n'est pas bornée. Cette limite de réflectance
empêche les couleurs supérieures à 1 d'amplifier l'énergie à chaque rebond
jusqu'au débordement de l'accumulation du path tracing.

### Domaine de `acos`

Pour une entrée finie hors de `[-1, 1]`, `acos` renvoie explicitement zéro
par composante, conformément aux canaux noirs des références de tests dégénérés.
Le comportement GLSL hors domaine n'est pas portable entre pilotes :
un appel direct peut produire des NaN sur GPU local et des couleurs différentes
sur mobile. Le WGSL borne l'argument avant l'appel intrinsèque, puis sélectionne
zéro hors domaine ; l'évaluateur CPU applique la même règle.

Les graphes MaterialX conservent leurs entrees par nom dans `IrExpr.call.namedArgs`.
Les lowerings WGSL et l'evaluateur CPU lisent ces noms, independamment de l'ordre
des entrees dans le XML. Les valeurs explicites priment sur les valeurs par defaut
typees du NodeDef actif, y compris ses entrees heritees. Un parametre optionnel
absent garde son fallback de lowering ; un parametre requis absent declenche une
erreur, sans insertion d'un zero pour remplir une position.

Les anciens IR `call.args` restent acceptes pour compatibilite. La table
`CATEGORY_INPUT_ORDER` n'est plus utilisee. Les tests de `surface-ir`, `graph` et
`optimize` couvrent les entrees permutees, les defauts types, les trous optionnels,
les entrees requises absentes et la conservation des arguments nommes apres CSE.

## Sources d'oracle

| Domaine | Oracle | Nature |
| --- | --- | --- |
| Nœuds d'expression (`expr`) | Fonction de référence en fp64 recalculée dans le test | Forme close |
| Nœuds de texture (`texture`) | Échantillon unorm 8 bits décodé sur CPU | Quantifié 1/255 |
| Fermetures par lobe (`closure`, T042) | `src/render/bsdf/reference.ts` — lobes BSDF/EDF/VDF analytiques fp64, **implémentation séparée du WGSL** | Forme close |
| Surface composée (T043) | `ref.evaluateSurface` — composition OpenPBR des lobes (5 lobes + 3 ops) en fp64 | Forme close |
| OpenPBR raster exécutable par scène (T045) | `ref.evaluateSurface` sur les échantillons de visibilité partagés | Forme close |
| Visibilité de scène | Lancer de rayon primaire + BVH, recoupé par un scan brute-force | Référence vs référence |
| Ombrage raster de scène-compare | `rasterShade` — miroir CPU Lambert simplifié (T035c) | Forme close |
| Ombrage path tracing | `integratePath` — transport unidirectionnel non biaisé (NEE + MIS) | Référence non biaisée |
| Rendu GPU par nœud / lobe / surface | GPU réel (T034/T042/T043) | Lecture arrière |
| Rendu OpenPBR GPU par scène | GPU réel (T045) | Lecture arrière |

> **Fin des oracles circulaires (P8).** Jusqu'à P8, les fermetures (`closure`)
> étaient comparées à des oracles qui reproduisaient les mêmes stubs
> `Closure(color·weight, weight)` que le WGSL : la validation était circulaire.
> La référence analytique indépendante de [`src/render/bsdf/reference.ts`](../src/render/bsdf/reference.ts)
> (T041) ré-implémente les formules **sans lire le WGSL**, de sorte que la
> comparaison device teste réellement l'arithmétique du shader et non une
> tautologie. Voir la section « Évaluation physique des fermetures (P8) ».

La comparaison **raster vs path tracing** par scène (T035c) partage un **albédo
diffus unique** (`effectiveAlbedo = baseColor·(1−metalness)·(1−transmission)`) et
une lumière normalisée par `π`, si bien que leurs termes directs coïncident : leur
seule différence systématique est l'ambiant plat du raster (`0.03`) face à
l'environnement constant intégré par le path tracer (`0.05`). Ce miroir Lambert
simplifié reste distinct du backend raster exécutable, dont le fragment exécute le
variant WGSL compilé du matériau et évalue sa `LayeredClosure` via la bibliothèque
de fermetures partagée (`mx_closure_eval`, T058), validée séparément contre
`ref.evaluateSurface`.

## Tolérances par type de nœud

Source : `NODE_TOLERANCE` dans [`tests/fixtures/tolerances.ts`](../tests/fixtures/tolerances.ts).
Tolérance absolue par composante, appliquée à la comparaison device vs oracle CPU
(T034) et aux évaluations par nœud.

| Classe d'exécution | Tolérance absolue | Justification |
| --- | --- | --- |
| `expr` | `2e-3` | Proche de l'ulp fp32 après une passe de calcul. |
| `closure` | `2e-3` | Idem, fermeture analytique. |
| `texture` | `1/255 + 1e-4` | Un texel unorm 8 bits : quantification pire cas `1/255`. |
| `graph` | `2e-3` | Jamais comparé à une lecture GPU (complétude). |
| `implicit` | `2e-3` | Idem. |
| `multi` | `2e-3` | Idem. |

Défaut défensif : `DEFAULT_NODE_TOLERANCE = 2e-3`.

## Tolérances par scène

Source : `SCENE_FOCUS_TOLERANCE` dans [`tests/fixtures/tolerances.ts`](../tests/fixtures/tolerances.ts).
Appliquée à la comparaison raster vs path tracing au niveau scène (T035c4). Une
scène peut déclarer plusieurs focus ; `sceneTolerance` retient la borne la plus
permissive par champ.

| Focus | `maxAbs` | `rmse` | Justification |
| --- | --- | --- | --- |
| `base` | `0.05` | `0.035` | Seul écart systématique : ambiant `0.03` vs environnement `0.05`, soit au pire `albédo·0.05 ≈ 0.04` côté ombre pour un albédo `0.8`. |
| `transmission` | `0.08` | `0.05` | Élargie : la référence diffuse omet la réfraction. |
| `subsurface` | `0.08` | `0.05` | Élargie : la référence diffuse omet la diffusion multiple. |

Défaut : `DEFAULT_SCENE_TOLERANCE = { maxAbs: 0.08, rmse: 0.05 }`.

La comparaison **GPU par scène** (T035d) est bien plus stricte (`2e-3` absolu) : la
visibilité et l'ombrage de référence sont partagés avec l'oracle, donc seule
subsiste la différence fp32 GPU vs fp64 CPU du même modèle raster.

## Tolérances des fermetures physiques (P8)

Depuis P8, les fermetures BSDF/EDF/VDF, les surfaces composées et le backend
raster exécutable sont évalués physiquement (voir plus bas) et comparés à la
référence analytique indépendante par cible GPU. Les bornes s'élargissent avec la
profondeur de composition fp32 avant la lecture arrière, et le mobile reçoit une
marge supplémentaire pour l'arrondi des `pow`/divisions des lobes spéculaires.

| Axe | Fixture | Local (Intel) | Mobile (Adreno) | Justification |
| --- | --- | --- | --- | --- |
| Lobe unique (T042) | `CLOSURE_TARGET_TOLERANCE` | `2e-3` | `4e-3` | Une évaluation microfacette GGX/Fresnel par lobe, un seul dispatch. |
| Surface composée (T043) | `SURFACE_TARGET_TOLERANCE` | `3e-3` | `6e-3` | 5 lobes + 3 ops de composition (2 mix + 1 layer) en fp32. |
| OpenPBR raster par scène (T045) | `SCENE_SURFACE_TARGET_TOLERANCE` | `4e-3` | `7e-3` | Métaux à faible rugosité (laiton, aluminium brossé) : le pic spéculaire GGX pousse la division par `N·V` et le `pow` Schlick. |

La cible est choisie automatiquement d'après l'adapter du rapport
(`deviceTargetOf` : `qualcomm|adreno|mali|arm|apple|powervr` → `mobile`).

## Évaluation physique des fermetures (P8)

Le correctif P8 (plan §9.5) remplace les stubs non physiques `Closure(color·weight,
weight)` du lowering initial (T014) par une évaluation réelle. Chaque lobe reçoit
la direction de lumière `L`, la vue `V` et la normale `N`, et intègre sa BRDF sur
les lumières de la scène plus un terme ambiant d'environnement. Les formules sont
ré-implémentées deux fois indépendamment : en WGSL
([`src/compiler/nodes.ts`](../src/compiler/nodes.ts) côté corpus,
[`src/render/raster/shaders.ts`](../src/render/raster/shaders.ts) côté backend
exécutable) et en TypeScript fp64 comme oracle
([`src/render/bsdf/reference.ts`](../src/render/bsdf/reference.ts)).

Conventions d'éclairage partagées : `L = normalize(−direction)`,
`radiance = color·intensity`, terme ambiant `= terme·environment` ajouté une fois
par lobe.

| Fermeture | Modèle | Limites déclarées |
| --- | --- | --- |
| `oren_nayar_diffuse_bsdf`, `burley_diffuse_bsdf` | Diffus rugueux (Oren-Nayar / Burley), tête-bêche → `1/π` | — |
| `dielectric_bsdf` | Microfacette GGX : distribution GGX, Smith séparable, Fresnel diélectrique, `F·D·G/(4·N·V)` | Réflexion directe ; réfraction complète au path tracer |
| `conductor_bsdf` | GGX + Fresnel conducteur (ior/extinction complexes) | — |
| `generalized_schlick_bsdf` | GGX + Fresnel Schlick `F0`/`F90` (workflow métallique `F0 = baseColor`) | — |
| `sheen_bsdf` | NDF Charlie + Fresnel | — |
| `translucent_bsdf` | Transmission diffuse (hémisphère opposé) | — |
| `subsurface_bsdf` | Approximation raster : repli diffus `w = 0.5` | BSSRDF non biaisé réservé au path tracer (`subsurface.ts`) |
| `uniform_edf` | Émission `Closure(color, 0)` (ne bloque pas) | — |
| `generalized_schlick_edf` | Émission à facteur Schlick directionnel `pow(1−N·V, 5)` entre `color0`/`color90` | — |
| `anisotropic_vdf` | Single-scattering à profondeur optique unité, phase Henyey-Greenstein | Transport volumique complet réservé aux milieux P6 / raster T025 |
| `chiang_hair_bsdf` / `simple_hair` | Stub documenté (pas de miroir analytique raster) | Modèle cheveux exact au path tracer uniquement |

Composition énergétique : `mx_layer` couple la base par le throughput du dessus
(`1 − reflectance`) et composite la couverture ; `mx_closure_mix`/`add`/`multiply`
émettent la réflectance pondérée. La surface composée assemble un workflow
métallique (`F0 = baseColor` via Schlick) et un spéculaire diélectrique en couche
sur une base diffus/transmission/subsurface : construite par la `LayeredClosure`
de l'IR et évaluée via `mx_closure_eval`, en miroir exact de `ref.evaluateSurface`.

Le path tracer ajoute pour chaque lobe un triplet cohérent `eval`/`pdf`/`sample`
([`src/render/pathtracing/bsdf.ts`](../src/render/pathtracing/bsdf.ts), T044),
validé par des tests intrinsèques (white furnace, accord eval/pdf, estimateur non
biaisé) sans réutiliser l'oracle raster.

### Backend path tracer : mégakernel sur l'IR (T057)

Le backend path tracer GPU ([`src/render/pathtracing/compute.ts`](../src/render/pathtracing/compute.ts))
ne porte plus de bloc de surface « sept paramètres » en dur. Le mégakernel
reconstruit à chaque impact la `LayeredClosure` depuis l'enregistrement matériau
compacté (157 floats, [`src/render/pathtracing/material-record.ts`](../src/render/pathtracing/material-record.ts),
T057b/c) puis l'évalue via la **bibliothèque de fermetures partagée**
([`src/compiler/closure-library.ts`](../src/compiler/closure-library.ts),
[`src/compiler/surface-wgsl.ts`](../src/compiler/surface-wgsl.ts), T056) —
exactement la même pile que le raster, l'IR du compilateur étant la source
d'ombrage unique. Le packing CPU (`createSceneSampler` ré-évalue
`layeredSurfaceBsdf`) et le lecteur WGSL partagent le même layout, de sorte que
l'oracle CPU et le shader device ne divergent que par l'arithmétique fp32.

L'intégrateur applique le MIS complet (heuristique de puissance) entre
l'échantillonnage de lumière et l'échantillonnage BSDF, en miroir de
`integratePath` : la lumière distante directionnelle reste une **delta** (poids 1,
sans contrepartie BSDF), tandis que l'environnement constant combine une
next-event estimation en cosinus et la capture par échantillonnage BSDF via la
pondération `power_heuristic` (T057e). La parité numérique cross-backend du
mégakernel reste couverte par le harnais device (T059).

**Nodegraph arbitraire fidèle (§9.6, T057g-m).** Le mégakernel ne se limite plus
aux matériaux à entrées constantes (enregistrement 157 floats). Pour un matériau
« graphe », le compilateur abaisse le nodegraph de surface complet — entrées
**texturées et procédurales** (`image`, `noise`, `mix`, `normalmap`, expressions
mathématiques…) — directement dans le shader généré, au lieu de l'aplatir en
sept scalaires. Les textures de **tous** les matériaux de la scène sont décodées
et liées simultanément via un registre de textures dédupliqué par `fileRef`
([`src/render/pathtracing/compute.ts`](../src/render/pathtracing/compute.ts),
T057j/k) ; les UV proviennent du primvar géométrique `st` interpolé au hit
(`vary.v_st`, T057h), et le harnais USD résout le `ResolvedGraph`/`ResolvedSurface`
complet plutôt que le modèle canonique réduit (T057m). Résultat validé par run
device (local + mobile) sur la scène `test_material_brick_procedural` : le motif
de briques procédural et sa carte de rugosité/normale sont restitués fidèlement,
sans régression visible sur `disney_gold`/`velvet`/`metal_brushed`. Le raster
dérive le même motif via les mêmes bind groups de textures et le même feed de
primvar `st` (voir ci-dessous), ce qui ferme l'exigence 9.6 : un `mtlx` quelconque
est rendu par abaissement IR, pas par réduction à 7 paramètres.

### Backend raster : ombrage sur l'IR (T058)

Le backend raster converge vers la même source d'ombrage que le path tracer :
plutôt qu'un bloc OpenPBR écrit à la main (retiré en T058f), le fragment
exécute le variant WGSL compilé du matériau — `mx_shade` (IR → `LayeredClosure`,
[`src/compiler/wgsl.ts`](../src/compiler/wgsl.ts),
[`src/compiler/surface-wgsl.ts`](../src/compiler/surface-wgsl.ts)) — puis évalue
la fermeture obtenue contre l'unique lumière directionnelle et l'environnement
constant via la **bibliothèque de fermetures partagée** (`mx_closure_eval`,
[`src/compiler/closure-library.ts`](../src/compiler/closure-library.ts), T056),
c'est-à-dire exactement le terme direct que le mégakernel path tracer calcule par
rebond. L'IR du compilateur devient ainsi la source d'ombrage unique des deux
backends.

Approximations raster déclarées : éclairage **direct uniquement** (un échantillon
par lumière, pas de next-event estimation ni de MIS multi-rebonds), **pas
d'ombres**, environnement **constant**. Côté uniformes, le bloc frame
(`model`/`viewProj`/`eye`/lumière/environnement) est séparé des `MxUniforms`
matériau émis par le variant (`@group(0) @binding(0)`) et déplacé sur son propre
binding ; un pipeline est compilé par variant de matériau (clé `pipelineKey`).

Le bloc OpenPBR écrit à la main (`openPbrSurfaceWgsl`/`forwardOpaqueWgsl`/
`sceneForwardWgsl`) a été **retiré** en T058f2 : l'oracle analytique du raster est
désormais directement `ref.evaluateSurface`
([`src/render/bsdf/reference.ts`](../src/render/bsdf/reference.ts)). Le câblage est
livré par la série T058b-e. La **parité source-IR raster ↔ path tracer** — les deux
backends dérivent le terme direct de la même `LayeredClosure` via la même pile
`mx_closure_eval` — est prouvée par
[`tests/render/raster/ir-parity.test.ts`](../tests/render/raster/ir-parity.test.ts)
(T058f1) : parité structurelle des WGSL émis (même struct `LayeredClosure`, même
appel `mx_closure_eval`, raster sans lancer d'ombre) et parité numérique CPU via
l'oracle partagé. La validation **device** (local + mobile, WebGPU indisponible sous
Node) est câblée en T059 (voir « Parité device des familles BxDF »).

### Parité device des familles BxDF (T059)

P10 ferme la boucle sur le GPU réel : chaque famille de surface avancée est rendue
**sur le device** par les deux backends depuis la **sortie unique du compilateur**,
puis comparée à l'oracle analytique indépendant. Le harnais
([`tests/render/bxdf-device.harness.ts`](../tests/render/bxdf-device.harness.ts),
T059c) reconstruit pour chaque cas de
[`tests/fixtures/bxdf-families.ts`](../tests/fixtures/bxdf-families.ts) la
`LayeredClosure` depuis l'enregistrement matériau compacté
(`packLayeredMaterial` → `mx_material_closure`,
[`src/render/pathtracing/material-record.ts`](../src/render/pathtracing/material-record.ts))
et l'évalue via la bibliothèque de fermetures partagée
(`mx_closure_eval`, [`src/compiler/closure-library.ts`](../src/compiler/closure-library.ts),
[`src/compiler/surface-wgsl.ts`](../src/compiler/surface-wgsl.ts)). Deux passes
compute dérivent le terme direct dans les deux conventions — raster `max(N·L, 0)`
et path tracer `|N·L|` — chacune augmentée d'un échantillon d'environnement
constant, sur des frames et une lumière **partagés avec l'oracle**
(`BXDF_DEVICE_GEOMS` / `BXDF_DEVICE_LIGHT`). Le seul écart mesuré reste donc
l'arithmétique fp32 du GPU face au fp64 CPU de
[`src/render/bsdf/reference.ts`](../src/render/bsdf/reference.ts) (`referenceClosureDirect`).

Le test [`tests/render/bxdf-device.test.ts`](../tests/render/bxdf-device.test.ts)
compare `raster[]` et `pathtracing[]` de chaque famille à l'oracle via
`compareSignals` et vérifie l'accord raster ↔ path tracer ; il se **skippe**
proprement quand le rapport est vide. Deux orchestrateurs produisent ce rapport,
tous deux servant [`bxdf-device-harness.html`](../bxdf-device-harness.html) et
collectant `__MX_BXDF_REPORT__` via CDP :

- **Local (poste de dev)** — [`scripts/run-local-bxdf.mjs`](../scripts/run-local-bxdf.mjs)
  (`npm run test:local-bxdf`) pilote Chrome WebGPU sans adb.
- **Mobile (cible Adreno 7xx)** — [`scripts/run-bxdf-device.mjs`](../scripts/run-bxdf-device.mjs)
  (`npm run test:bxdf-device`) pilote Chrome Android via ADB/CDP ; sans appareil
  autorisé il réécrit un rapport vide et la suite se skippe.

Les tolérances par famille (`BXDF_FAMILY_TARGET_TOLERANCE`,
[`tests/fixtures/tolerances.ts`](../tests/fixtures/tolerances.ts)) sont choisies
automatiquement d'après l'adapter du rapport (`deviceTargetOf` → `local`/`mobile`),
sans logique de test dédiée :

| Famille | Local | Mobile (Adreno) | Justification |
| --- | --- | --- | --- |
| `standard_surface`, `open_pbr_surface`, `disney_principled` | `5e-3` | `8e-3` | Surface composée (diffus + spéculaire diélectrique + couche) en fp32. |
| `gltf_pbr`, `UsdPreviewSurface` | `4e-3` | `7e-3` | Workflow métallique Schlick plus plat, moins de composition. |
| `lama_assembly`, `procedural_nodegraph` | `6e-3` | `9e-3` | Assemblages profonds de lobes + arrondi d'interpolation texture/expression. |

Le mobile reçoit ~`3e-3` de marge supplémentaire sur les arrondis `pow`/division
des lobes spéculaires, comme pour les bornes par lobe et par scène.

**Approximations raster restantes** (déclarées, identiques à T058) : éclairage
**direct uniquement** (un échantillon par lumière, pas de next-event estimation ni
de MIS), **pas d'ombres**, environnement **constant**. Au-dessus de l'horizon,
les termes directs raster `max(N·L, 0)` et path tracer `|N·L|` coïncident et
matchent l'oracle ; sous l'horizon seul le path tracer prolonge le transport.
Le run device réel (local et mobile) reste une étape **manuelle** ; le rapport
committé [`tests/render/bxdf-device-report.json`](../tests/render/bxdf-device-report.json)
est vide pour garder `npm test` déterministe.

### Scènes couvertes (raster + path tracing)

`standard_surface_default`, `standard_surface_glass`, `standard_surface_jade`,
`open_pbr_default`, `open_pbr_glass`, `disney_principled_default`,
`disney_principled_glass`, `gltf_pbr_default`, `gltf_pbr_glass`,
`usd_preview_surface_default`.

## Cas non reproductibles

Certains nœuds abaissent vers un hachage fp chaotique (`fract(sin(x)·k)`). Le fp32
du GPU et le fp64 du CPU ne peuvent pas coïncider bit à bit ; ces cas sont donc
validés par **enveloppe** (valeur finie et comprise dans `[min, max]`) plutôt que
par égalité. Ils portent `reproducible: false` et une `envelope` dans
[`tests/fixtures/node-cases.ts`](../tests/fixtures/node-cases.ts) ; le prédicat
`isEnvelopeCase` les aiguille vers ce mode.

| Nœud | Enveloppe | Raison |
| --- | --- | --- |
| `fractal3d` (amplitude 1.0, 3 octaves) | `[0, 1.75]` | Bruit `fract(sin)` : non reproductible fp32/fp64 ; borné par la somme des amplitudes. |

L'enveloppe `[0, 1.75]` correspond à la somme des amplitudes des octaves : le bruit
ne peut sortir de cet intervalle, ce qui reste vérifiable même sans accord numérique
exact.

## Procédure d'exécution

```powershell
# Vérification de types stricte
npm run typecheck

# Suite complète sous Node (déterministe, sans GPU).
# Les comparaisons device sautent proprement si aucun rapport n'est présent.
npm test

# Validation GPU locale (poste de dev, Chrome WebGPU via CDP, sans adb).
npm run test:local-gpu      # par nœud + lobes + surfaces (T034/T042/T043)
npm run test:local-scene    # OpenPBR par scène (T045)
npm run test:local-bxdf     # familles BxDF, deux backends (T059)

# Validation GPU sur le mobile cible autorisé (confirme le GPU réel).
# Démarre Vite, pilote Chrome via ADB/CDP, collecte le rapport, puis compare.
npm run test:device         # par nœud + lobes + surfaces (T034/T042/T043)
npm run test:scene-device   # OpenPBR par scène (T045)
npm run test:bxdf-device    # familles BxDF, deux backends (T059)
```

## Résultats des runs GPU (dernière exécution)

Les fermetures physiques P8 sont validées sur deux cibles : le GPU local du poste
de développement (pendant permanent des tests CPU) et le mobile Android cible
(confirmation sur le GPU réel visé). Dernière double exécution :

| Cible | Adapter | Navigateur | OS | Par nœud (T034) | Lobes (T042) | Surfaces (T043) | OpenPBR scène (T045) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Locale | Intel `gen-12lp` | Chrome 154 (WebGPU, CDP) | Windows (NT 10.0, x64) | 27/27 | 11/11 @ `2e-3` | 6/6 @ `3e-3` | 47/47 @ `4e-3` |
| Mobile | Qualcomm `adreno-7xx` (SM-F731B, `R5CW900CHQD`) | Chrome 154 Mobile | Android 10 | 27/27 | 11/11 @ `4e-3` | 6/6 @ `6e-3` | 47/47 @ `7e-3` |

Les deux cibles passent sans erreur. Les rapports committés
([`tests/render/device-report.json`](../tests/render/device-report.json),
[`tests/render/scene-device-report.json`](../tests/render/scene-device-report.json))
conservent la dernière exécution mobile ; le run local reproduit les mêmes résultats
avec les bornes `local` plus strictes.

### Saut propre sans mobile

Les tests device consomment un rapport JSON committé vide
([`tests/render/device-report.json`](../tests/render/device-report.json),
[`tests/render/scene-device-report.json`](../tests/render/scene-device-report.json)).
Lorsqu'aucun mobile autorisé n'est détecté, l'orchestrateur réécrit un rapport vide
et le test se **skippe** avec une raison documentée, au lieu de passer en silence.
Un run réel sur device remplit temporairement le rapport ; l'état committé reste
vide pour garder `npm test` déterministe.

### Pré-requis pour un run device

- Mobile avec débogage USB autorisé et un navigateur WebGPU (Chrome).
- ADB disponible (par défaut `D:\platform-tools\adb.exe`, surchargé par `MX_ADB`).
- Port du serveur Vite surchargé par `MX_PORT` (défaut `5173`).

## Validation bout-en-bout par scène (T053a)

Première passe de validation de bout en bout sur **une seule scène réelle**,
`scenes/test_material_disney_gold/test_material_disney_gold.usda` (OpenPBR
MaterialX, convertie depuis le corpus GLSL-PathTracer). Elle prépare le terrain
pour la validation complète T053 (scène de référence + scène tierce + mobile).

Le run est piloté par
[`scripts/validate-disney-gold.ts`](../scripts/validate-disney-gold.ts) et rejoue
la chaîne d'exécution réelle sur les **mêmes assets** :
`importUsdStage` (chargement composé) → `importLights`/`importCameras` →
`buildSceneResources` (géométrie + BLAS, instances + TLAS, surfaces MaterialX) →
`buildSceneFrame` (raster) **et** `buildPathTraceScene` (path tracing) dérivés
d'un **unique** `SceneResources`, recoupés par `compareSceneBackends`. La scène
étant un artefact local non versionné, ce run n'est pas un test committé : il
s'exécute à la demande et écrit un rapport JSON sous
[`docs/generated/t053a-disney-gold.json`](generated/t053a-disney-gold.json).

```powershell
# Node >=23.6 ne supporte pas les parameter properties de l'importateur en mode
# strip-only ; le run passe par vite-node (transpilation complète, fournie par vitest).
npm run validate:scene
```

### Chargement composé

| Mesure | Valeur |
| --- | --- |
| Prims composés | 13 (1 racine `/World`) |
| Meshes | 3 — `cube`, `sphere`, `ground` |
| Matériaux MaterialX | 2 — `gold`, `ground` (OpenPBR, liés sans résidu) |
| Caméra | 1 — `mainCamera` (perspective) |
| Lumières | 2 — `SphereLight` + `RectLight` |

Le stage composé expose les 3 meshes avec leur géométrie inline (points /
`faceVertexCounts` / `faceVertexIndices`), les deux matériaux OpenPBR résolus
depuis `gold.mtlx` / `ground.mtlx`, la caméra et les deux lumières. Aucune
géométrie ni aucun matériau n'est resté en attente, et aucun gprim n'est non lié.

### Diagnostics des fonctionnalités non prises en charge

Rien n'est abandonné en silence (REQ-013). Pour cette scène :

| Niveau | Diagnostic |
| --- | --- |
| info | `SphereLight` (`/World/Lights/light_0`) approximée en lumière directionnelle par le backend exécutable. |
| info | `RectLight` (`/World/Lights/light_1`) approximée en lumière directionnelle par le backend exécutable. |

Les lumières d'aire sont **reconnues et importées** (`importLights` les mappe en
`sphere`/`rect` avec leur transform et leurs paramètres de forme), mais les deux
backends exécutables en ligne (`directionalLightFrom`) les réduisent pour l'instant
à une unique lumière directionnelle dominante. L'échantillonnage de surface des
lumières d'aire relève du path tracer complet (P9+). Les autres arcs non pris en
charge (payloads/crate binaires) ne concernent pas cette scène 100 % USDA + MaterialX.

### Rendu des deux backends sur les mêmes assets

| Mesure | Valeur |
| --- | --- |
| Géométries / instances | 3 / 3 |
| Triangles (géométrie préparée) | 974 |
| Draws raster | 3 |
| Triangles path tracing | 974 |
| Surfaces OpenPBR partagées | 2 |
| Caméra partagée (viewProj + eye) | oui |
| Lumière dominante partagée | oui |
| Accord vérité-terrain diffuse (probe) | oui (`maxAbs = 0`) |

Les deux backends consomment le **même** `SceneResources` : ils voient le même
nombre de triangles (974), la même caméra, la même lumière dominante, et les deux
mêmes surfaces OpenPBR — sans ré-import. Le recoupement Lambert à incidence normale
(référence raster `src/render/bsdf/reference.ts` vs fermeture du path tracer
`src/render/pathtracing/bsdf.ts`) coïncide exactement (`maxAbs = 0`).

### Mesures (poste local)

| Étape | Temps indicatif |
| --- | --- |
| Chargement composé (`importUsdStage`) | ~60 ms |
| Import lumières + caméras | ~4 ms |
| `buildSceneResources` (géo + BLAS + TLAS + matériaux) | ~91 ms |
| Rendu CPU (frame raster + scène PT + recoupement) | ~60 ms |
| **Total** | **~216 ms** |

| Mémoire (buffers path tracing) | Taille |
| --- | --- |
| Nœuds BVH | 24,0 Kio |
| Soupe de triangles | 91,3 Kio |
| Matériaux | 0,1 Kio |
| **Total GPU-upload PT** | **115,4 Kio** |

> **Frontière Node vs GPU (honnête).** Node n'expose pas WebGPU : ce run mesure la
> chaîne **CPU** (parsing, composition, construction des ressources, oracle de
> rendu) et la **taille des buffers** qui seraient téléversés au GPU. Les temps
> sont indicatifs (ils incluent la transpilation à froid de vite-node) et la
> mesure de tas (`heapUsed`) est bruitée par le GC — la métrique mémoire fiable est
> la taille des buffers. Les temps de compilation de shader, de rendu et
> d'occupation VRAM **réels sur le GPU local** passent par le harnais device
> navigateur ([`scene-device-harness.html`](../scene-device-harness.html),
> `npm run test:scene-device`) et sont couverts par la validation complète T053.

### Aperçu CPU path-tracé (PNG)

Pour disposer d'un **aperçu visuel immédiat** sans attendre le GPU, le run écrit
aussi une image PNG path-tracée sur CPU dans `renders/t053a-disney-gold.png`
(artefact local non versionné, comme la scène). Elle rejoue la géométrie, les
matériaux OpenPBR et la soupe de triangles **réels** de la scène via le même
intégrateur que le path tracer (`integratePath` + `createSceneSampler`), avec une
génération de rayon caméra **identique à la fonction WGSL** `camera_ray`
(dé-projection `invViewProj` colonne-major, NDC WebGPU `z ∈ [0,1]`).

Deux ajustements **propres à l'aperçu** (ils ne modifient pas la chaîne de
validation ni le recoupement des backends) assurent la lisibilité :

- une **caméra d'aperçu** cadrée sur le sujet (œil à ~7 u, cible `(0, 0.3, 0)`) ;
- un **environnement neutre** `[0.6, 0.6, 0.6]` en remplacement de l'environnement
  quasi-noir de la scène, afin que l'or métallique pur réfléchisse un studio
  visible plutôt qu'un fond noir.

La fidélité réelle (compilation de shader, rendu et VRAM sur le GPU) reste couverte
par le harnais device T053.

### Aperçu raster CPU (PNG)

Le backend raster est **GPU uniquement** dans le navigateur ; pour qu'il produise
néanmoins **sa propre image** sous Node, le run écrit un second PNG
`renders/t053a-disney-gold-raster.png` (artefact local non versionné) via un
**rasteriseur logiciel CPU** ([`src/render/raster/cpu-raster.ts`](../src/render/raster/cpu-raster.ts)).
Il consomme **exactement le même plan de frame** (`buildSceneFrame`) que le backend
GPU — mêmes `SceneResources`, même caméra, même lumière dominante, même
environnement — et transforme les triangles **comme le path tracer** (`transformPoint`
pour les positions, `transformDirection` + normalisation pour les normales). Le
pipeline est un rasteriseur classique à **fonctions d'arête** avec **tampon de
profondeur** et interpolation d'attributs **corrigée par la perspective** (transform
de clip colonne-major, NDC WebGPU `z ∈ [0,1]`) ; chaque pixel couvert est ombré par
**le même BSDF OpenPBR de référence** (`evaluateSurface`) sous la lumière
directionnelle et l'environnement de la frame.

Pour une comparaison directe **raster CPU vs path-trace CPU**, l'aperçu raster
réutilise la **même caméra d'aperçu** et le **même environnement neutre**
`[0.6, 0.6, 0.6]` : les deux PNG cadrent et éclairent le sujet à l'identique. Le
raster affiche l'ombrage **analytique direct** (lumière + ambiant, sans réflexions),
là où le path tracer ajoute les réflexions multi-rebonds — chaque méthode est
correcte pour son modèle. Le module est pur et testé sous Node
([`tests/render/cpu-raster.test.ts`](../tests/render/cpu-raster.test.ts) : projection,
couverture, ombrage de référence au centre, déterminisme, tampon de profondeur).

La fidélité raster réelle sur le GPU reste couverte par le harnais device T053.

### Correctif moteur : racine BVH à l'index 0

L'aperçu a révélé un **bug de corrélation d'index** latent dans le constructeur
BVH ([`src/geometry/bvh.ts`](../src/geometry/bvh.ts)) : `buildCore` allouait les
nœuds en **post-ordre**, plaçant la racine en **dernière** position du tableau,
alors que **les deux traversées** (CPU `scene-buffers.ts` et WGSL `compute.ts`)
démarrent la pile au nœud **0**. Sur les scènes à un seul nœud (≤ 4 triangles,
utilisées par les tests CPU unitaires) la racine était fortuitement à l'index 0,
masquant le défaut ; dès que la scène produisait un BVH multi-nœuds (comme les
974 triangles de disney gold), la traversée partait d'un nœud feuille arbitraire
et manquait la majorité de la géométrie.

Le correctif réalloue les nœuds en **pré-ordre** (réservation du slot parent avant
la récursion des enfants) pour que la **racine soit toujours à l'index 0**, et
inverse les passes de `refit` (ordre descendant : les enfants, d'index supérieur,
sont rafraîchis avant leurs parents). Il corrige **simultanément** les chemins CPU
et GPU. Les 787 tests restent verts (`tests/geometry/bvh.test.ts` n'assertait que
`nodes.length`, l'ordre des triangles et les bornes, jamais l'index racine ; le
helper de traversée `tests/render/scene-samples.ts` démarre désormais au nœud 0).
