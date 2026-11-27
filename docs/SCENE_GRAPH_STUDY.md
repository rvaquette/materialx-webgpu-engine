# Étude : graphe de scène équivalent au script

## Recommandation

Adopter un **graphe de données typé de scène**, distinct du graphe MaterialX,
avec un ordre explicite pour les opérations à effets de bord. Le modèle relie
des références d’objets et de matériaux sans les copier ; ses nœuds de rendu
forment un petit workflow dont les sorties (image, capture ou fichier) sont
des valeurs typées. Le graphe représente une scène et son exécution, pas
l’arbre syntaxique JavaScript qui l’a éventuellement produite.

Ce modèle hybride répond mieux au besoin que les deux options extrêmes :

| Modèle | Atouts | Limites |
|---|---|---|
| Étendre seulement le graphe MaterialX | Réutilise les ports, types et éditeurs de shaders ; partage naturel des terminaux. | Ne peut pas représenter proprement les objets, les transformations, la scène, le backend ni les commandes de rendu et de sauvegarde. |
| Visualiser tout le JavaScript comme un AST | Fidélité apparente au texte ; peut montrer les expressions et le contrôle de flux. | Un AST n’est pas un modèle de scène ; les boucles, fonctions, mutations, appels dynamiques et effets de bord rendent l’édition visuelle opaque et la conversion fragile. |
| Graphe de scène typé (recommandé) | Références partagées, dépendances vérifiables, exécution explicite, conversions définies par un sous-ensemble. | Nécessite des nœuds d’adaptation pour les expressions et opérations non graphiques ; ne promet pas d’encoder tous les scripts. |

Ne pas remplacer l’éditeur de script ni le graphe de matériau : chacun reste
meilleur pour son domaine. Le graphe de scène doit composer leurs modèles et
les exposer comme des sous-graphes réutilisables.

## Modèle de données

- **Identité stable** : chaque nœud possède un identifiant indépendant de son
  titre et de sa position à l’écran. Un objet est une référence typée ; déplacer,
  masquer ou modifier le nœud source met à jour tous ses consommateurs.
- **Ports typés** : valeurs MaterialX (`float`, `integer`, `boolean`, vecteurs,
  couleurs, chaînes), terminaux shader (`surfaceshader`, `displacementshader`,
  `volumeshader`), références (`material`, `object`, `scene`, `camera`) et
  résultats d’opération (`render-result`, chemin de fichier). Une connexion
  n’est permise que si les types correspondent ou si un adaptateur explicite
  existe ; une entrée scalaire ne devient jamais implicitement un shader.
- **Shader et matériau** : un graphe MaterialX conserve ses nœuds et ses
  connexions. Un nœud de matériau regroupe les terminaux `surface`,
  `displacement` et, plus tard, volume ou autres terminaux. Plusieurs objets
  consomment la même sortie de matériau ; ils ne reçoivent pas des copies
  indépendantes.
- **Objets et scène** : les nœuds géométriques produisent des références
  d’objet. Les transformations, la visibilité et les affectations sont des
  entrées de ces objets. Une scène regroupe des références, et non des copies
  de géométries.
- **Workflow de rendu** : un nœud `Render` prend une scène, une caméra et les
  réglages explicites (backend, résolution, qualité) ; sa sortie est un
  résultat. Des nœuds `Capture`/`Save` consomment ce résultat. Les dépendances
  de données imposent les prérequis, tandis que les opérations à effets de bord
  gardent un ordre déterministe.
- **Cycles** : refuser les cycles dans les dépendances exécutables avant tout
  rendu et rapporter le nœud et le port impliqués. Les éventuels cycles
  temporels de simulation devront être des opérations d’état explicites, pas
  des boucles implicites du graphe.
- **Sous-graphes** : exposer des ports nommés, typés et documentés, avec des
  valeurs par défaut et une identité d’instance. Les sous-graphes MaterialX
  restent réutilisables comme unités de matériau ; les sous-graphes de scène
  pourront encapsuler des assemblages d’objets.

## Contrat de conversion

**Graphe vers script** est déterministe pour le sous-ensemble pris en charge :
validation des ports et des références, tri topologique stable, déclaration
d’un nœud une seule fois, puis génération des connexions et des opérations dans
l’ordre. La génération n’exécute pas le script ; l’utilisateur peut le relire,
le modifier ou le lancer avec le contrôle déjà fourni par l’éditeur.

**Script vers graphe** analyse maintenant un sous-ensemble déclaratif par AST,
sans exécuter le script : constructeurs MaterialX, propriétés littérales et
connexions directes, suivis de deux sphères partageant un matériau, d'une
caméra, des réglages de rendu, d'un rendu et d'une sauvegarde PNG. Les
constructions non prises en charge (expressions calculées, conditions,
boucles, fonctions, accès dynamiques, autres objets ou commandes) sont
refusées avec un diagnostic ; le script et le graphe existants restent
inchangés. Cette conversion n'est pas une conversion du JavaScript général.

Une représentation intermédiaire commune pourra relier les deux interfaces,
mais elle doit distinguer les valeurs évaluables, les références de scène et
les actions. Le graphe ne doit pas être abaissé au seul document MaterialX,
qui ne contient ni le workflow de rendu ni le script JavaScript.

## UX et intégration

1. Garder les éditeurs script, graphe de matériau et graphe de scène dans le
   même espace de travail, avec sélection synchronisée et navigation vers la
   ligne source lorsqu’elle existe.
2. Afficher les ports compatibles, les valeurs par défaut et les références
   partagées ; distinguer visuellement les nœuds MaterialX, scène et actions.
3. Éditer un graphe sans exécution automatique. Prévisualiser les erreurs de
   type, entrées requises, cycles, ressources manquantes et capacités de
   backend ; le rendu n’est lancé qu’à la demande.
4. Les diagnostics portent un identifiant de nœud/port et, lors d’une
   conversion, la ligne du script ou le nœud MaterialX source. Les erreurs de
   compilation ne remplacent pas le dernier rendu valide.
5. L’animation doit être représentée par des nœuds de temps/courbe ou des
   valeurs échantillonnées reliées à la timeline. Une fonction JavaScript de
   rappel reste un élément script non convertible tant qu’elle n’a pas un
   équivalent typé.
6. Le partage de graphe et les sous-graphes doivent préserver les identifiants,
   les liens, l’ordre des actions et les références d’assets dans les projets.
   L’annuler/rétablir doit porter sur une transaction de graphe cohérente.

## Prototype livré et portée

L’éditeur conserve deux graphes spécialisés : **Graphe** reste consacré aux
nœuds et terminaux MaterialX ; le nouvel onglet **Scène** ne montre que la
référence au matériau MaterialX, deux `Sphere`, `Scene`, `Camera`, `Render` et
`Save`. Un même nœud de référence MaterialX est connecté aux deux sphères. Les
valeurs de scène et les liens sont modifiables ; types incompatibles et entrées
requises absentes sont refusés. **Script → scène** importe le script courant
dans ce graphe ; **Générer le script** conserve ses instructions MaterialX et
génère la scène sans l’exécuter. La validation du script met à jour le graphe
MaterialX dédié, où l’on inspecte les nœuds de surface et de déplacement.
Si le code de scène a été modifié après l'import, la génération est refusée
jusqu'à une nouvelle conversion ; les modifications limitées au matériau
MaterialX sont reprises. Les commentaires de la partie scène ne sont pas
conservés lors de la génération. Le script d’exemple et le graphe de scène
produisent le même rendu de référence.

Le prototype n’est pas encore un éditeur général : ses nœuds et nombres
d’objets sont fixes ; il ne charge pas de graphe depuis un fichier et n’encode
pas les opérations JavaScript
arbitraires, l’animation, les assets, l’import d’objets ni tous les paramètres
des backends. La caméra, le rendu et l’enregistrement sont couverts par ce
premier workflow, pas les autres actions de la bibliothèque de script.

Reproduction :

```powershell
npm run script -- examples\scripts\p25-scene-graph.js --out docs\images\p25
npx vitest run tests\materialx\scene-graph.test.ts
```

Le test vérifie que le code généré depuis le graphe est identique à l’exemple,
que les deux objets partagent bien leur matériau et que les entrées et
connexions invalides sont diagnostiquées.
