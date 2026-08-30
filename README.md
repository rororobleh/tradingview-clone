# TradingView Clone (hors-ligne)

Application de bureau Electron pour visualiser des données de marché (OHLCV) à partir
de fichiers CSV, sans connexion réseau : chandeliers, dessin technique, grille
multi-graphiques et mode replay pour le backtesting.

## Démarrage

```bash
npm install
npm start
```

Au premier lancement, l'app essaie de charger `data/eurusd.csv` si le fichier existe ;
sinon elle affiche des données fictives générées localement. Utilisez **Fichier > Ouvrir
un CSV...** (ou `Ctrl/Cmd+O`) pour charger vos propres données.

## Format de fichier CSV attendu

- Délimiteur : virgule, point-virgule ou tabulation (détecté automatiquement).
- Colonnes obligatoires (insensibles à la casse) : une variante de `open`, `high`, `low`, `close`
  (ex. `o/h/l/c`, `ouverture/haut/bas/clôture`).
- Colonne de date/heure : soit une colonne unique (`time`, `timestamp`, `gmt time`, `local time`,
  `date time`, `datetime`...), soit deux colonnes séparées `date` + `time`/`heure` (format
  MetaTrader). Une colonne `date` seule est acceptée pour des barres journalières.
- Colonne optionnelle : `volume` (ou `vol`, `tick volume`...).
- Dates reconnues : timestamp Unix (secondes ou millisecondes), ISO 8601, `DD.MM.YYYY HH:mm:ss`
  (Dukascopy), `YYYY.MM.DD HH:mm:ss` (MetaTrader), `MM/DD/YYYY HH:mm:ss` (US). Un éventuel
  suffixe `GMT+HHMM`/`UTC-HHMM` (exports "Local time" de Dukascopy) est pris en compte pour
  convertir vers UTC.
- Nombres : le point et la virgule sont tous deux acceptés comme séparateur décimal — utile pour
  les exports Excel européens (délimiteur `;`, décimales à virgule).

Concrètement, les exports **Dukascopy** (`Gmt time,Open,High,Low,Close,Volume`) et **MetaTrader**
(`Date,Time,Open,High,Low,Close,Volume`) sont pris en charge directement, sans reformatage manuel.

Les lignes invalides sont ignorées individuellement (le fichier n'est pas rejeté en bloc) ;
le détail (numéro de ligne + raison, y compris une date non reconnue) est consultable en cliquant
sur le compteur de bougies dans la barre de titre.


## Personnalisation & Paramètres (nouveau)

- **7 thèmes de couleurs** au lieu de 2 : Sombre, Clair, Minuit, Solarisé, Graphite, Contraste
  élevé, Océan — sélecteur déroulant dans la barre d'outils (remplace l'ancien bouton bascule
  jour/nuit). Chaque thème reste personnalisable via le panneau **🎨 Couleurs**.
- **Panneau ⚙️ Paramètres** (nouveau bouton dans la toolbar), à onglets :
  - **Apparence** : thème, police de l'interface (Système / Arrondie / Monospace), densité
    (Confortable / Compacte — barres plus fines), arrondi des angles (Anguleux / Doux / Arrondi),
    affichage de la grille du graphique, filigrane (texte personnalisé ou nom du fichier chargé).
  - **Graphique** : type de graphique, disposition et timeframe par défaut au démarrage/à
    l'ouverture d'un CSV (le timeframe par défaut n'est utilisé que s'il reste compatible avec la
    résolution native du fichier — jamais plus fin que les données sources).
  - **Replay** : vitesse et point de départ par défaut (ou "toujours demander"), son (bip généré
    localement, sans fichier externe) sur déclenchement Stop / Take Profit.
  - **Général** : langue de l'interface (FR/EN — traduit la barre d'outils, la sidebar de dessin,
    le panneau Couleurs et le panneau Paramètres lui-même), confirmation avant "Restaurer par
    défaut", sauvegarde automatique du workspace (désactivée / 30s / 1min / 5min).
- Tous ces réglages sont persistés localement (`localStorage`) et n'affectent jamais le format
  des données ni les fichiers CSV.

**Limite connue** : la traduction anglaise couvre les menus/infobulles principaux et le panneau
Paramètres, mais pas encore les messages dynamiques (erreurs de parsing CSV, toasts Stop/Take
Profit, aide raccourcis clavier détaillée) ni la barre d'outils flottante dupliquée.

## Nouveautés (amélioration)

- **Volume** : histogramme sous les bougies (activé par défaut, bouton **Vol** ou touche `V`).
- **Moyennes mobiles** : SMA 20 / 50 / 200 et **EMA 9 / 21** (boutons dans la barre d'outils, état mémorisé).
- **Types de graphique** : chandeliers, barres OHLC ou ligne (sélecteur dans la toolbar, mémorisé).
- **Légende OHLC** : O/H/L/C/V de la bougie sous le curseur (coin supérieur gauche de chaque grille).
- **Export PNG** : bouton 📷 exporte le graphique actif (y compris les dessins primitives).
- **Sync multi-grilles** : crosshair et plage temporelle synchronisés entre les panes (bouton 🔗 Sync).
- **Aimant (magnet)** : accroche les points de dessin aux OHLC de la bougie la plus proche (bouton 🧲 ou `M`).
- **Undo / Redo** : `Ctrl/Cmd+Z` annule le dernier dessin, `Ctrl/Cmd+Shift+Z` ou `Ctrl/Cmd+Y` le rétablit.
- **Aide raccourcis** : bouton ❓ ou touche `?`.
- **Raccourcis** : `Suppr` / `Backspace` efface le dessin sélectionné ; `Échap` annule l'outil ; `V` bascule le volume.
- **Packaging** : scripts `npm run pack` / `npm run dist` via electron-builder (après `npm i -D electron-builder`).

## Structure du projet

| Fichier | Rôle |
|---|---|
| `main.js` | Process principal Electron : fenêtre, menu, boîtes de dialogue, persistance (fichiers récents, workspace) |
| `preload.js` | Pont sécurisé (`contextBridge`) entre le renderer et l'API Node/Electron |
| `renderer.js` | Toute la logique UI : graphiques (`lightweight-charts`), thèmes, outils de dessin, replay |
| `csvWorker.js` | Web Worker : parsing CSV hors du thread principal de l'UI |
| `aggWorker.js` | Web Worker : agrégation OHLCV par timeframe |
| `index.html` | Structure et styles de l'interface |

## Sécurité

- `contextIsolation: true`, `nodeIntegration: false` : le renderer n'a accès qu'à l'API
  explicitement exposée dans `preload.js`.
- `preload.js` ne lit que des fichiers avec l'extension `.csv`.
- Une politique `Content-Security-Policy` restreint les ressources chargeables (aucune
  requête réseau, aucun script externe).
- Une seule instance de l'app peut tourner à la fois (évite les écritures concurrentes
  sur les fichiers de configuration locaux).

## Outils de dessin

**Positions longue / courte (style TradingView)** : 3 clics — entrée → stop loss → take profit.
Affiche les zones risque (rouge) et récompense (vert), les niveaux Entrée / Stop / Cible avec
distances et pourcentages, et le ratio Risk:Reward. Aperçu élastique pendant le placement.
Disponibles dans la sidebar et la barre d'outils flottante.

Tous les types de dessin (ligne de tendance, ligne horizontale/verticale, rectangle, flèche,
texte, positions) peuvent désormais porter une étiquette de texte, ajoutée ou modifiée via le bouton
"Ajouter/modifier le texte" du menu qui s'ouvre au clic sur un dessin existant. La saisie se fait
dans une boîte de dialogue intégrée à l'application (et non plus `window.prompt()`, qui n'est pas
supporté par Electron dans ce contexte).

**Rectangle : couleur de fond, couleur de bordure et mode infini.** Le menu flottant qui s'ouvre
au clic sur un rectangle propose désormais deux pastilles de couleur distinctes — bordure et
fond — au lieu d'une seule couleur appliquée aux deux avec une opacité fixe. Un bouton dédié
("Zone infinie") bascule le rectangle en mode infini : la zone s'étend alors sur toute la largeur
visible du graphique (comme une zone de prix TradingView), seules les deux limites de prix
(haut/bas) restant tracées, et continue de suivre le pan/zoom. Les rectangles déjà enregistrés
dans un workspace restent inchangés (rétrocompatibles avec l'ancien rendu à une seule couleur).

Outils de dessin avancés déjà disponibles via `lightweight-charts-drawing` (panneau "Outils
avancés") : ligne de tendance, rayon, rayon horizontal, canal parallèle, Fibonacci retracement /
extension, Gann Fan, pitchfork d'Andrews, cercle.

## Performance & stabilité (gros fichiers CSV)

Chantier en cours. Premier lot de correctifs :

- **Compatibilité CSV : champs entre guillemets** (`csvWorker.js`) : un champ entre guillemets
  contenant le délimiteur (ex. `"Paris, France";1.0850;...`, ou une colonne texte citée dans un
  export Excel/courtier) coupait la ligne au mauvais endroit avec l'ancien `line.split(delimiter)`.
  Un découpeur dédié (`splitCsvLineQuoted`) gère désormais les guillemets et les guillemets
  échappés (`""`) au format RFC 4180. Pour ne pas ralentir le cas courant (Dukascopy, MetaTrader,
  aucun guillemet), il n'est utilisé que sur les lignes qui contiennent effectivement un `"` —
  toutes les autres lignes continuent d'utiliser le `split()` natif, plus rapide.
- **Lecture de fichier non bloquante** : `preload.js` lisait le CSV avec `fs.readFileSync`,
  ce qui gelait entièrement la fenêtre (aucun repaint, aucun clic possible) le temps de charger
  un gros fichier depuis le disque. La lecture passe désormais par `fs.promises.readFile`
  (asynchrone) ; l'UI (spinner de chargement) reste réactive pendant l'opération. Un avertissement
  s'affiche pour les fichiers de plus de 150 Mo, calculé via un `fs.stat` léger avant lecture.
- **Parsing CSV** (`csvWorker.js`) : l'ancien découpage `text.trim().split('\n').filter(...)`
  doublait temporairement la mémoire occupée par le texte brut avant même de commencer le
  parsing. Remplacé par un parcours à une seule passe (`indexOf`) qui ne matérialise que les
  lignes non vides, sans tableau intermédiaire ni `.trim()` par ligne.
- **Lignes invalides** : sur un fichier très mal formé, le détail de chaque ligne ignorée
  était accumulé sans limite en mémoire (avant d'être tronqué à 50 seulement au moment de
  l'envoi final). Désormais plafonné à 500 entrées suivies en mémoire pendant le parsing ; le
  compteur affiché (`X lignes ignorées`) reste exact au-delà de ce plafond.
- **Agrégation par timeframe** (`aggWorker.js`) : remplacement d'une `Map` (hachage par barre +
  tri final redondant) par une agrégation séquentielle qui exploite le fait que les barres
  arrivent déjà triées par temps croissant — les barres d'un même bucket sont alors forcément
  contiguës, donc un simple pointeur "bucket courant" suffit.
- **Mode replay** : `getReplayFilteredData()` refaisait un `.filter()` sur l'intégralité du
  jeu de données à chaque déplacement du curseur (potentiellement des dizaines d'appels par
  seconde en glissant la souris) — coût O(n) répété. Remplacé par un `.slice()`, qui ne coûte
  que la taille de la portion conservée (O(k)), les données étant déjà triées.

**Limite connue restante** : les barres OHLCV restent des tableaux d'objets JS classiques
(`{time, open, high, low, close, volume}`), transférés par copie (structured clone) entre le
renderer et les Web Workers. Sur des datasets de plusieurs millions de lignes, cela reste plus
coûteux en mémoire/CPU qu'une représentation en `Float64Array` transférable (zero-copy). C'est
la prochaine piste d'optimisation si des fichiers de cette taille deviennent un cas d'usage
courant — actuellement non implémentée pour ne pas complexifier tout le pipeline de données
(parsing, agrégation, rendu, replay) en une seule fois.

## Limites connues

- Un champ entre guillemets contenant un saut de ligne littéral n'est pas géré (le fichier est
  d'abord découpé ligne par ligne) ; les guillemets échappés (`""`) et un délimiteur à l'intérieur
  d'un champ entre guillemets sur une seule ligne sont en revanche pris en charge (voir
  changelog ci-dessous).
- Les outils de dessin avancés (Fibonacci, Gann, etc.) nécessitent le package
  `lightweight-charts-drawing` installé (`npm install`) ; sans lui, le panneau
  "Outils avancés" reste désactivé avec un message explicite.

## Empaqueter l'application

```bash
npm install
npm run dist    # génère les installateurs dans dist/
# ou
npm run pack    # dossier non empaqueté (test rapide)
```

La config `build` dans `package.json` cible AppImage/deb (Linux), NSIS (Windows) et DMG (macOS).
Ajustez `appId`, icônes et cibles selon vos besoins.
