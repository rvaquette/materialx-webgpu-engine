# Rendu distant

Le viewer publié sur GitHub Pages est statique : il peut envoyer un **script de
matériau** ([SCRIPTING.md](SCRIPTING.md)) à un serveur de rendu équipé d'un GPU,
qui l'exécute et renvoie le rendu au fil de sa progression.

```
Viewer (https://rvaquette.github.io/...)  ── script, HTTPS ──▶  tunnel / proxy HTTPS
        ▲                                                            │
        └── images progressives, log, fichiers save() (SSE) ◀──  npm run render:remote (127.0.0.1:8787)
                                                                     │
                                         Chrome headless + GPU ── viewer de dist/, réseau confiné
```

## Serveur

```bash
npm run build          # dist/ : le viewer exécuté par le serveur
npm run render:remote -- [--port 8787] [--origin https://rvaquette.github.io] [--timeout 1800] [--max-pause 1800]
                         [--frame-interval 1000] [--max-queue 4] [--gpu high-performance|low-power|default]
```

| Variable | Rôle |
|---|---|
| `MX_REMOTE_TOKEN` | Jeton partagé (32 caractères minimum), saisi une fois dans le viewer |
| `MX_REMOTE_ACCESS_TEAM`, `MX_REMOTE_ACCESS_AUD` | Vérification du JWT Cloudflare Access (domaine d'équipe, tag AUD de l'application) |
| `MX_REMOTE_EMAILS` | Liste d'e-mails Access autorisés (facultative) |
| `MX_REMOTE_ORIGINS` | Origines web autorisées en plus de `--origin` (défaut : `https://rvaquette.github.io`) |
| `MX_CHROME`, `MX_CHROME_ARGS` | Exécutable de Chrome ; options supplémentaires (VM Linux) |

Au moins une authentification est obligatoire ; quand les deux sont configurées,
les deux sont exigées. Générer un jeton :

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

API (`127.0.0.1` uniquement) :

- `POST /jobs` (`application/json`, `{ "script": "..." }`, 512 Kio maximum) répond un flux
  `text/event-stream` : `job` (`{ id }`), `status` (`queued`, `loading`, `running`, `paused`),
  `progress` (même contenu que `stats()`), `frame` (canvas du viewer en WebP), `log`, `file`
  (`save(...)`, en base64), puis `done` (`{ ok, message, line, logs }`). Fermer la connexion annule le script.
- `POST /jobs/<id>/pause`, `/resume`, `/cancel` (`application/json`, réservé à l'auteur du job) :
  la pause gèle le script avant sa prochaine instruction et l'accumulation du path tracer.
- `GET /status` : `{ busy, queued, maxQueue }`. `GET /` : page de connexion pour Cloudflare Access.

Un script à la fois ; les suivants attendent dans une file (`--max-queue`, sinon HTTP 429).

### Sécurité

Un script est du JavaScript exécuté par le serveur. Les protections sont :

1. **Authentification** avant tout traitement : jeton comparé en temps constant et/ou JWT
   Cloudflare Access vérifié (signature RS256, émetteur, audience, expiration, e-mails).
2. **Origines** : un appel navigateur d'une autre origine que celles autorisées est refusé
   (403) ; `POST /jobs` exige `application/json`, donc un pré-vol CORS.
3. **Confinement** : chaque script tourne dans un contexte Chrome neuf (bac à sable actif), qui
   ne peut joindre que le serveur statique local de `dist/`. Les autres requêtes, WebSockets,
   WebRTC et service workers sont bloqués : pas d'accès au réseau local ni d'exfiltration. Le serveur
   ne sert que `dist/` (pas les sources) et `save()` n'écrit rien sur le disque du serveur.
4. **Limites** : temps de rendu par script (`--timeout`, pauses exclues), pause annulée au-delà de
   `--max-pause`, 256 Mio de fichiers par script, file bornée.
5. **Exposition** : le serveur n'écoute que sur `127.0.0.1` ; seul un tunnel ou un proxy HTTPS
   l'expose. Le jeton n'est jamais dans le site publié : il est saisi dans le viewer et gardé
   dans le `localStorage` du navigateur.

Les scènes et textures référencées par le script doivent être dans `dist/` (chemins relatifs,
ex. `./scenes/...`) ; les URL externes sont bloquées. Le serveur active l'isolation cross-origin :
les USD binaires s'y chargent, contrairement à GitHub Pages.

## Viewer

Éditeur de script (icône **Script** ou F2) → **Rendu distant** : URL du serveur (HTTPS, ou HTTP sur
`localhost`) et jeton, enregistrés dès la saisie, puis l'icône nuage. Les images du serveur remplacent
celles du viewer pendant le rendu, avec le nombre d'échantillons, le débit et le bruit. **Pause /
Reprendre** (dans la vue ou la barre d'outils de l'éditeur, F6) gèle le script au début de sa
prochaine instruction et l'accumulation du path tracer sur le serveur ; **Arrêter** annule le job ;
**Fermer** revient au viewer local. Les messages `log` s'affichent dans la console de l'éditeur et
les fichiers `save(...)` sont téléchargés. Code : [src/remote-render.ts](../src/remote-render.ts).

## Exposer le serveur avec Cloudflare Tunnel

Prérequis : un domaine géré par Cloudflare (le plan gratuit suffit, Zero Trust gratuit jusqu'à 50 utilisateurs).

1. **Tunnel** (Zero Trust → *Networks* → *Tunnels* → *Create a tunnel*, type *Cloudflared*) :
   installer `cloudflared` (`winget install --id Cloudflare.cloudflared`) puis lancer la commande
   affichée, `cloudflared service install <jeton>` (service Windows, connexion sortante seule).
   À l'étape *Route tunnel* de l'assistant, ou plus tard dans *Tunnels* → le tunnel → *Configure* →
   onglet *Public Hostname* (*Published application routes* dans l'interface récente) → *Add* :
   sous-domaine `render`, domaine `example.com`, service `HTTP` et URL `127.0.0.1:8787`.
   Cloudflare crée l'enregistrement DNS ; le HTTPS public est assuré par Cloudflare.
2. **Identité** (*Settings* → *Authentication* → *Login methods*) : ajouter GitHub (application
   OAuth GitHub dont l'URL de callback est `https://<équipe>.cloudflareaccess.com/cdn-cgi/access/callback`).
3. **Application Access** (*Access* → *Applications* → *Self-hosted*) sur `render.example.com` :
   - politique *Allow* limitée à votre e-mail (ou login GitHub) ;
   - *Settings* → *CORS* : activer seulement *Bypass OPTIONS requests to origin*, sans autre
     en-tête CORS : le serveur répond lui-même aux pré-vols pour les origines autorisées (des
     en-têtes ajoutés aussi par Access seraient en double et refusés par le navigateur) ;
   - *Cookie settings* : `SameSite=None` (le cookie est envoyé par un appel depuis github.io) ;
   - relever le tag **AUD** (*Overview*).
4. **Serveur** :

   ```powershell
   $env:MX_REMOTE_TOKEN = '<jeton généré>'
   $env:MX_REMOTE_ACCESS_TEAM = '<équipe>.cloudflareaccess.com'
   $env:MX_REMOTE_ACCESS_AUD = '<tag AUD>'
   npm run build; npm run render:remote
   ```

5. **Viewer** : ouvrir une fois `https://render.example.com/` (connexion GitHub), puis dans le
   viewer publié saisir `https://render.example.com/` et le jeton.

Si le navigateur bloque les cookies tiers (Safari, navigation privée), l'appel échoue faute de
session Access : utiliser Chrome/Edge, ou une politique Access *Bypass* et le jeton seul (moins sûr :
seul le jeton protège alors le serveur).

### Sans domaine

Sans domaine géré par Cloudflare, pas de *Public Hostname* ni d'Access ; le serveur est alors
protégé par `MX_REMOTE_TOKEN` seul (ne pas définir `MX_REMOTE_ACCESS_*`) :

- **Quick Tunnel** (tests, sans compte) : `cloudflared tunnel --url http://127.0.0.1:8787` affiche
  une URL `https://….trycloudflare.com`, différente à chaque lancement et sans garantie de service.
- **Tailscale Funnel** (gratuit, URL fixe) : `tailscale funnel --bg 8787` publie
  `https://<machine>.<tailnet>.ts.net`.
- Pour garder Access, enregistrer un domaine chez Cloudflare (*Domain Registration*, au prix coûtant).

## Alternative : VM Azure GPU Spot

Le serveur est identique sur une VM ; seuls l'hôte et l'exposition changent.

- **Taille** : `Standard_NC4as_T4_v3` (NVIDIA T4) ou `Standard_NV6ads_A10_v5` (fraction d'A10),
  en **Spot** (souvent 60 à 90 % moins cher) avec la politique d'éviction *Deallocate*. Une éviction
  (préavis de 30 s) coupe le rendu en cours : le viewer affiche « connexion interrompue ».
- **Système** : Windows Server avec le pilote NVIDIA (extension *NVIDIA GPU Driver*), même
  configuration Chrome/D3D12 qu'en local ; ou Ubuntu 22.04/24.04 avec pilote NVIDIA, `libvulkan1`,
  Google Chrome et `MX_CHROME_ARGS` pour Vulkan (à valider avec `capabilities()` dans un script).
- **Exposition** : de préférence `cloudflared` sur la VM, sans IP publique et NSG fermé en entrée,
  avec la même application Access. Sinon : IP publique, NSG ouvert seulement en 443 (et 80 pour
  ACME), proxy HTTPS (Caddy ou nginx + Let's Encrypt) vers `127.0.0.1:8787`, et le jeton seul.
- **Exploitation** : service (systemd ou service Windows) sous un compte sans privilèges, secrets
  dans un fichier protégé ou Azure Key Vault, arrêt automatique planifié et alerte de budget ;
  démarrage à la demande avec `az vm start` (ou un workflow GitHub `workflow_dispatch`).
- `dist/` se construit sur la VM comme dans [pages.yml](../.github/workflows/pages.yml), ou se copie.
