// ============================================================
// 02-favorites-drawinglib-utils.js
// Chargement de lightweight-charts-drawing, outils favoris (étoile + barre flottante), utilitaires UI (loading/erreurs/titlebar), données mock, parsing CSV (Worker), agrégation OHLCV (Worker), SMA/EMA, aimant, volume
// Fait partie de renderer.js (sectionné en modules le 2026-08-28).
// Chargé comme <script> classique dans index.html : les variables/fonctions
// top-level restent globales et partagées entre tous ces fichiers, exactement
// comme dans l'ancien renderer.js monolithique — aucun changement de comportement.
// ============================================================
// ============ NOUVEAU : lightweight-charts-drawing (outils avancés : Fibonacci, Gann, canaux, etc.) ============
// Chargée en import dynamique pour ne pas transformer renderer.js en module ES et ne pas bloquer
// le démarrage de l'app si le package n'est pas encore installé (npm install requis).
let drawingLib = null;
let drawingLibLoadPromise = null;

// Liste des outils avancés exposés dans le panneau, avec le nombre de points (clics) requis
// pour chacun. Ce sont des classes documentées de lightweight-charts-drawing, chacune prenant
// un id, un tableau d'ancres {time, price} et un objet d'options — même signature que
// FibRetracement dans le quick-start du package.
// Outils avancés : prioritairement natifs (ShapePrimitive, toujours dispo).
// Les clés "native*" passent par currentTool ; les autres tentent lightweight-charts-drawing.
const ADVANCED_TOOLS = [
  { key: 'fibRetracement',  label: 'Fibonacci Retracement', anchors: 2, native: true },
  { key: 'fibExtension',    label: 'Fibonacci Extension',   anchors: 3, native: true },
  { key: 'parallelChannel', label: 'Canal parallèle',       anchors: 3, native: true },
  { key: 'ray',             label: 'Rayon (infini)',        anchors: 2, native: true },
  { key: 'pitchfork',       label: 'Pitchfork (Andrews)',   anchors: 3, native: true },
  { key: 'priceRange',      label: 'Mesure prix / temps',   anchors: 2, native: true },
  { key: 'triangle',        label: 'Triangle',              anchors: 3, native: true },
  { key: 'ellipse',         label: 'Ellipse',               anchors: 2, native: true },
  // CORRECTIF : HorizontalRay dépendait du package externe lightweight-charts-drawing
  // (native: false) et ne dessinait donc rien tant que 'npm install' n'avait pas été fait
  // (échec silencieux, voir addAdvancedDrawing()). Réimplémenté nativement en ShapePrimitive,
  // comme les 8 outils ci-dessus : plus de dépendance externe pour cet outil.
  { key: 'horizontalRay',   label: 'Rayon horizontal',      anchors: 1, native: true },
  // Fallback package externe (si installé)
  { key: 'GannFan',         label: 'Gann Fan (lib)',        anchors: 2, native: false },
  // CORRECTIF : même bug que HorizontalRay ci-dessus — dépendait de lightweight-charts-drawing
  // (échec silencieux tant que le package n'est pas installé). Réimplémenté nativement en
  // ShapePrimitive : centre (p1) + point de rayon (p2), cercle parfait à l'écran (pas une
  // ellipse déformée par les échelles prix/temps — voir drawCircle()).
  { key: 'circle',          label: 'Cercle',                anchors: 2, native: true }
];

// Niveaux Fibonacci standards (TradingView)
const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.272, 1.618, 2.618];
const FIB_EXT_LEVELS = [0, 0.618, 1, 1.272, 1.618, 2, 2.618];

// ============ NOUVEAU : outils favoris (étoile devant chaque outil → barre flottante) ============
// `favoriteTools` est un tableau de clés d'outils (data-tool des outils "maison", ou key
// d'ADVANCED_TOOLS pour les outils avancés/lib), persisté localement. L'ordre du tableau est
// l'ordre d'affichage dans la barre flottante.
let favoriteTools = [];
try { favoriteTools = JSON.parse(localStorage.getItem('favoriteTools') || '[]'); } catch { favoriteTools = []; }
if (!Array.isArray(favoriteTools)) favoriteTools = [];

function saveFavoriteTools() {
  try { localStorage.setItem('favoriteTools', JSON.stringify(favoriteTools)); } catch {}
}

function isFavoriteTool(key) { return favoriteTools.includes(key); }

function toggleFavoriteTool(key) {
  if (!key) return;
  const i = favoriteTools.indexOf(key);
  if (i === -1) favoriteTools.push(key); else favoriteTools.splice(i, 1);
  saveFavoriteTools();
  syncFavStars();
  renderFavoritesBar();
}

function removeFavoriteTool(key) {
  const i = favoriteTools.indexOf(key);
  if (i === -1) return;
  favoriteTools.splice(i, 1);
  saveFavoriteTools();
  syncFavStars();
  renderFavoritesBar();
}

// Crée et attache la petite étoile de favori sur un bouton d'outil de la sidebar (coin,
// superposée) ou une ligne du panneau "Outils avancés" (à gauche du label). Le clic sur
// l'étoile n'active jamais l'outil (stopPropagation) : il ne fait que basculer le favori.
function addFavStar(container, key, { adv = false } = {}) {
  // NOUVEAU : <span role="button"> plutôt qu'un vrai <button> imbriqué — un <button> DOM à
  // l'intérieur d'un autre <button> (les outils de la sidebar) reste fonctionnel en pur DOM
  // (pas de re-parsing HTML ici), mais un <span> cliquable évite toute ambiguïté sémantique/
  // accessibilité et le comportement est identique pour un clic simple.
  const star = document.createElement('span');
  star.setAttribute('role', 'button');
  star.tabIndex = -1;
  star.className = adv ? 'adv-fav-star' : 'tool-fav-star';
  star.dataset.favKey = key;
  star.title = 'Ajouter/retirer des favoris';
  star.textContent = '★';
  star.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    toggleFavoriteTool(key);
  });
  if (adv) container.insertBefore(star, container.firstChild);
  else container.appendChild(star);
  return star;
}

// Rafraîchit l'état visuel (doré/rempli) de toutes les étoiles selon `favoriteTools`
function syncFavStars() {
  document.querySelectorAll('.tool-fav-star, .adv-fav-star').forEach(star => {
    star.classList.toggle('is-fav', isFavoriteTool(star.dataset.favKey));
  });
}

// Icône / libellé d'un outil favori pour le rendu de la barre flottante : réutilise le SVG déjà
// présent dans la sidebar quand il existe, sinon retombe sur des initiales (outils avancés/lib
// sans icône dédiée, ex. Gann Fan, Cercle).
function getFavToolIconHtml(key) {
  const sidebarBtn = document.querySelector(`#drawing-sidebar .tool-btn[data-tool="${key}"]`);
  const svg = sidebarBtn?.querySelector('svg');
  if (svg) return svg.outerHTML;
  const advDef = ADVANCED_TOOLS.find(t => t.key === key);
  const label = advDef ? advDef.label : key;
  const initials = label.replace(/\(.*?\)/g, '').trim().split(/\s+/).map(w => w[0] || '').join('').slice(0, 2).toUpperCase();
  return `<span class="fav-bar-initials">${initials || '?'}</span>`;
}

function getFavToolLabel(key) {
  const sidebarBtn = document.querySelector(`#drawing-sidebar .tool-btn[data-tool="${key}"]`);
  if (sidebarBtn) return sidebarBtn.getAttribute('title') || key;
  const advDef = ADVANCED_TOOLS.find(t => t.key === key);
  return advDef ? advDef.label : key;
}

// Active l'outil correspondant à une clé favorite, qu'il s'agisse d'un outil "maison" (pipeline
// natif currentTool) ou d'un outil avancé/lib (pipeline advTool) — même logique d'activation/
// désactivation que le panneau "Outils avancés".
function activateFavoriteTool(key) {
  const advDef = ADVANCED_TOOLS.find(t => t.key === key);
  if (advDef) {
    const isActive = (advDef.native && currentTool === advDef.key) || (!advDef.native && advTool && advTool.key === advDef.key);
    setAdvancedTool(isActive ? null : advDef);
  } else {
    setTool(currentTool === key ? null : key);
  }
}

// Reconstruit le contenu de la barre flottante à partir de `favoriteTools`
function renderFavoritesBar() {
  const list = document.getElementById('ft-fav-list');
  if (!list) return;
  list.innerHTML = '';
  if (favoriteTools.length === 0) {
    const hint = document.createElement('span');
    hint.className = 'fav-bar-empty-hint';
    hint.textContent = '☆ Cliquez l\'étoile d\'un outil pour l\'ajouter ici';
    list.appendChild(hint);
    return;
  }
  favoriteTools.forEach(key => {
    const item = document.createElement('div');
    item.className = 'fav-bar-item';

    const btn = document.createElement('button');
    btn.className = 'tool-btn';
    btn.dataset.favKey = key;
    btn.title = getFavToolLabel(key);
    btn.innerHTML = getFavToolIconHtml(key);
    btn.addEventListener('click', () => activateFavoriteTool(key));

    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'fav-bar-remove';
    rm.title = 'Retirer des favoris';
    rm.textContent = '×';
    rm.addEventListener('click', (e) => { e.stopPropagation(); removeFavoriteTool(key); });

    item.appendChild(btn);
    item.appendChild(rm);
    list.appendChild(item);
  });
  syncFavBarActiveState();
}

// Met en surbrillance, dans la barre de favoris, l'outil actuellement actif (currentTool ou
// advTool) — appelé depuis setTool()/setAdvancedTool() pour rester synchronisé.
function syncFavBarActiveState() {
  document.querySelectorAll('#ft-fav-list .tool-btn').forEach(b => {
    const key = b.dataset.favKey;
    const active = currentTool === key || (advTool && advTool.key === key);
    b.classList.toggle('active', !!active);
  });
}

function loadDrawingLib() {
  if (drawingLibLoadPromise) return drawingLibLoadPromise;
  drawingLibLoadPromise = import('./node_modules/lightweight-charts-drawing/dist/lightweight-charts-drawing.es.js')
    .then((mod) => {
      drawingLib = mod;
      // Attache un DrawingManager aux panes déjà créées avant la fin du chargement
      panes.forEach(attachDrawingManager);
      document.querySelectorAll('#advanced-tools-panel .adv-tool-btn').forEach(b => b.disabled = false);
      return mod;
    })
    .catch((err) => {
      console.error("⚠️ lightweight-charts-drawing indisponible (lancez 'npm install' pour l'ajouter) :", err);
      const panel = document.getElementById('advanced-tools-panel');
      if (panel) panel.querySelector('.adv-tools-hint').textContent =
        "Indisponible — exécutez 'npm install' pour installer lightweight-charts-drawing.";
      return null;
    });
  return drawingLibLoadPromise;
}

// Attache un DrawingManager de lightweight-charts-drawing à une pane (outils avancés,
// séparés des outils "maison" dessinés sur le canvas de la sidebar de dessin ci-dessus)
function attachDrawingManager(pane) {
  if (!drawingLib || pane.advManager) return;
  try {
    pane.advManager = new drawingLib.DrawingManager();
    pane.advManager.attach(pane.chart, pane.series, pane.inner);
  } catch (err) {
    console.error('Erreur attach DrawingManager (lightweight-charts-drawing) :', err);
  }
}

// Active/désactive le mode de placement d'un outil avancé (exclusif avec les outils "maison")
function setAdvancedTool(toolConfig) {
  hideDrawingMenu(); // NOUVEAU
  panes.forEach(p => { p.pendingPoints = []; p.advPendingPoints = []; });

  if (toolConfig && toolConfig.native) {
    // Outil natif : réutilise le pipeline currentTool / pendingPoints / ShapePrimitive
    advTool = null;
    currentTool = toolConfig.key;
  } else {
    advTool = toolConfig || null;
    currentTool = null;
  }
  updateCanvasPointerEvents();
  document.querySelectorAll('.tool-btn[data-tool]').forEach(b => {
    const t = b.dataset.tool || '';
    b.classList.toggle('active', !advTool && !currentTool && t === '');
  });
  document.querySelectorAll('#advanced-tools-panel .adv-tool-btn').forEach(b => {
    const active = (toolConfig && b.dataset.advTool === toolConfig.key) ||
      (currentTool && b.dataset.advTool === currentTool);
    b.classList.toggle('active', !!active);
  });
  syncFavBarActiveState();
  document.getElementById('advanced-tools-panel')?.classList.remove('visible');
}

function updateCanvasPointerEvents() {
  panes.forEach(p => {
    const selectedHere = selectedDrawing && selectedDrawing.pane === p;
    p.canvas.style.pointerEvents = (currentTool || advTool || dragState || selectedHere) ? 'auto' : 'none';
  });
}

// Instancie et ajoute un dessin avancé une fois tous les points (ancres) recueillis par clics
function addAdvancedDrawing(pane, toolConfig, points) {
  if (!drawingLib || !pane.advManager) return;
  const ToolClass = drawingLib[toolConfig.key];
  if (!ToolClass) { console.error(`Outil "${toolConfig.key}" introuvable dans lightweight-charts-drawing.`); return; }
  const t = THEMES[currentTheme];
  try {
    const drawing = new ToolClass(`${toolConfig.key}-${Date.now()}`, points, { lineColor: t.advancedColor });
    pane.advManager.addDrawing(drawing);
  } catch (err) {
    console.error(`Erreur lors de la création de "${toolConfig.key}" :`, err);
  }
}


// ============ Utilitaires UI ============
function showLoading(text) {
  document.getElementById('loading-text').textContent = text;
  document.getElementById('loading-overlay').classList.add('visible');
}
function hideLoading() { document.getElementById('loading-overlay').classList.remove('visible'); }
function showDropOverlay(show) { document.getElementById('drop-overlay').classList.toggle('visible', show); }

function openErrorModal() {
  const list = document.getElementById('error-modal-list');
  list.innerHTML = '';
  if (!lastSkippedDetails.length) {
    const empty = document.createElement('div');
    empty.textContent = 'Aucun détail disponible';
    list.appendChild(empty);
  } else {
    // NOUVEAU (sécurité) : le contenu brut des lignes CSV (ex. valeur de timestamp invalide)
    // peut se retrouver dans "reason". On utilise textContent (jamais innerHTML) pour éviter
    // toute injection HTML/JS si un fichier CSV malveillant contient des balises.
    for (const d of lastSkippedDetails) {
      const row = document.createElement('div');
      row.textContent = `Ligne ${d.line} — ${d.reason}`;
      list.appendChild(row);
    }
  }
  document.getElementById('error-modal').classList.add('visible');
}
function closeErrorModal() { document.getElementById('error-modal').classList.remove('visible'); }

function updateTitlebar(filename, errorMsg = null) {
  const filenameEl = document.getElementById('filename');
  if (errorMsg) {
    filenameEl.textContent = `⚠️ ${errorMsg}`;
    filenameEl.classList.add('error-msg');
  } else if (filename) {
    filenameEl.textContent = filename;
    filenameEl.classList.remove('error-msg');
  }
  applyWatermarkToAllPanes(); // NOUVEAU : le filigrane par défaut suit le nom du fichier chargé
}

function updateTitlebarForPane(pane) {
  if (!pane) return;
  const countEl = document.getElementById('candle-count');
  const tfLabel = TF_LABELS[pane.timeframe] || `${pane.timeframe}m`;
  const paneLabel = panes.length > 1 ? ` — Grille ${pane.index + 1}/${panes.length}` : '';
  const baseLabel = formatBaseResolutionLabel(baseTimeframeSeconds);
  const tfSec = Math.max(1, pane.timeframe || 1) * 60;
  const note = tfSec < baseTimeframeSeconds
    ? ` ⚠ source ${baseLabel} (CSV)`
    : (baseLabel !== tfLabel ? ` · source ${baseLabel}` : '');
  if (lastSkippedDetails.length > 0) {
    countEl.textContent = `${pane.candleCount || 0} bougies (${tfLabel})${note}${paneLabel} — ${lastSkippedDetails.length} lignes ignorées (clic pour détails)`;
    countEl.classList.add('clickable');
    countEl.onclick = openErrorModal;
  } else {
    countEl.textContent = `${pane.candleCount || 0} bougies (${tfLabel})${note}${paneLabel}`;
    countEl.classList.remove('clickable');
    countEl.onclick = null;
  }
}

// ============ Données fictives ============
function generateMockData(count = 300) {
  const data = [];
  let time = Math.floor(Date.now() / 1000) - count * 60;
  let lastClose = 1.0850;
  for (let i = 0; i < count; i++) {
    const open = lastClose;
    const change = (Math.random() - 0.5) * 0.002;
    const close = open + change;
    const high = Math.max(open, close) + Math.random() * 0.0008;
    const low = Math.min(open, close) - Math.random() * 0.0008;
    const volume = Math.floor(Math.random() * 1000) + 100;
    data.push({ time, open, high, low, close, volume });
    lastClose = close;
    time += 60;
  }
  return data;
}

// ============ Parsing CSV via Worker ============
function parseCsvInWorker(rawText, onProgress) {
  return new Promise((resolve, reject) => {
    if (csvWorker) csvWorker.terminate();
    csvWorker = new Worker('csvWorker.js');
    csvWorker.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === 'progress') onProgress?.(msg.percent);
      else if (msg.type === 'done') { resolve(msg); csvWorker.terminate(); }
      else if (msg.type === 'error') { reject(new Error(msg.message)); csvWorker.terminate(); }
    };
    csvWorker.onerror = (err) => { reject(new Error(err.message || 'Erreur du Worker de parsing')); csvWorker.terminate(); };
    csvWorker.postMessage({ rawText });
  });
}

// ============ Agrégation OHLCV via Worker persistant (Étape 2, branché à l'Étape 5) ============
let aggWorkerInstance = null;
let aggRequestId = 0;
const aggPending = new Map();

function getAggWorker() {
  if (!aggWorkerInstance) {
    aggWorkerInstance = new Worker('aggWorker.js');
    aggWorkerInstance.onmessage = (e) => {
      const { id, type, data, message } = e.data;
      const cb = aggPending.get(id);
      if (!cb) return;
      aggPending.delete(id);
      if (type === 'done') cb.resolve(data);
      else cb.reject(new Error(message));
    };
    aggWorkerInstance.onerror = (err) => {
      for (const cb of aggPending.values()) cb.reject(err);
      aggPending.clear();
    };
  }
  return aggWorkerInstance;
}

function aggregateAsync(data, minutes) {
  return new Promise((resolve, reject) => {
    const tfMin = Math.max(1, Number(minutes) || 1);
    const tfSec = tfMin * 60;
    // Impossible de désagréger en dessous de la résolution native
    // (ex. 1m demandé sur un CSV déjà en 5m) → on renvoie les barres sources.
    // Si TF >= résolution native (y compris égal), on passe TOUJOURS par le worker :
    // - 1m sur ticks/secondes → vraies bougies de 60s
    // - 1m sur 1m → ré-alignement des timestamps sur les frontières de minute
    // - 5m sur 1m → agrégation correcte (chaque bougie = 5 minutes)
    if (tfSec < baseTimeframeSeconds) {
      resolve(data);
      return;
    }
    const id = ++aggRequestId;
    aggPending.set(id, { resolve, reject });
    getAggWorker().postMessage({ id, data, minutes: tfMin, dayBoundaryHourUtc: dayBoundaryOffsetHours });
  });
}

// Calcule une moyenne mobile simple (SMA) sur la clôture. Retourne [] si pas assez de barres.
function computeSMA(data, period) {
  if (!data || data.length < period || period < 1) return [];
  const out = new Array(data.length - period + 1);
  let sum = 0;
  for (let i = 0; i < period; i++) sum += data[i].close;
  out[0] = { time: data[period - 1].time, value: sum / period };
  for (let i = period; i < data.length; i++) {
    sum += data[i].close - data[i - period].close;
    out[i - period + 1] = { time: data[i].time, value: sum / period };
  }
  return out;
}

// NOUVEAU : moyenne mobile exponentielle (EMA) sur la clôture
function computeEMA(data, period) {
  if (!data || data.length < period || period < 1) return [];
  const k = 2 / (period + 1);
  const out = [];
  let ema = 0;
  for (let i = 0; i < period; i++) ema += data[i].close;
  ema /= period;
  out.push({ time: data[period - 1].time, value: ema });
  for (let i = period; i < data.length; i++) {
    ema = data[i].close * k + ema * (1 - k);
    out.push({ time: data[i].time, value: ema });
  }
  return out;
}

// NOUVEAU : accroche un prix/temps au OHLC de la bougie la plus proche (mode aimant)
function snapToMagnet(pane, time, price) {
  if (!magnetEnabled || !pane.lastAggregated || !pane.lastAggregated.length) return { time, price };
  const data = pane.lastAggregated;
  // Recherche dichotomique de la barre au temps le plus proche
  let lo = 0, hi = data.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (data[mid].time < time) lo = mid + 1;
    else hi = mid;
  }
  let bestIdx = lo;
  if (lo > 0 && Math.abs(data[lo - 1].time - time) < Math.abs(data[lo].time - time)) bestIdx = lo - 1;
  const bar = data[bestIdx];
  const candidates = [bar.open, bar.high, bar.low, bar.close];
  let bestPrice = candidates[0];
  let bestDist = Math.abs(price - bestPrice);
  for (let i = 1; i < candidates.length; i++) {
    const d = Math.abs(price - candidates[i]);
    if (d < bestDist) { bestDist = d; bestPrice = candidates[i]; }
  }
  return { time: bar.time, price: bestPrice };
}

// Prépare les données volume colorées (vert si close >= open, rouge sinon)
function buildVolumeData(aggregated, upColor, downColor) {
  const up = hexToRgba(upColor, 0.45);
  const down = hexToRgba(downColor, 0.45);
  return aggregated.map(b => ({
    time: b.time,
    value: b.volume || 0,
    color: b.close >= b.open ? up : down
  }));
}

function formatOhlcPrice(v) {
  if (v == null || Number.isNaN(v)) return '—';
  const prec = (priceFormat && priceFormat.precision != null) ? priceFormat.precision : 5;
  return Number(v).toFixed(prec);
}

