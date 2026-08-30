// ============================================================
// 11-replay.js
// Mode Replay (backtesting façon FX Replay) : lecture, vitesse, navigation, visibilité des dessins pendant le replay
// Fait partie de renderer.js (sectionné en modules le 2026-08-28).
// Chargé comme <script> classique dans index.html : les variables/fonctions
// top-level restent globales et partagées entre tous ces fichiers, exactement
// comme dans l'ancien renderer.js monolithique — aucun changement de comportement.
// ============================================================
// ============ NOUVEAU : mode Replay (style FX Replay) pour le backtesting ============
const replayState = {
  enabled: false,
  index: 0,
  playing: false,
  timer: null,
  intervalMs: speedSliderToIntervalMsInit(), // vitesse (jauge) — dépend du réglage par défaut
  indEvery: 8,
  pickStartOnChart: false // mode « cliquer sur le graphique pour démarrer »
};
function speedSliderToIntervalMsInit() {
  const pct = Number(APP_SETTINGS.replay.defaultSpeedPct);
  const v = Number.isFinite(pct) ? Math.max(0, Math.min(100, pct)) : 50;
  return Math.round(2000 - (v / 100) * 1950);
}
let replayIndCounter = 0;

/** Mappe la position de la jauge (0–100) → intervalle ms (lent → rapide). */
function speedSliderToIntervalMs(sliderValue) {
  const v = Math.max(0, Math.min(100, Number(sliderValue) || 50));
  // 0 → 2000ms (0.25×), 50 → 500ms (1×), 100 → 50ms (~10×)
  return Math.round(2000 - (v / 100) * 1950);
}
function intervalMsToSpeedLabel(ms) {
  const base = 500;
  const ratio = base / Math.max(50, ms);
  if (ratio < 0.4) return '0.25×';
  if (ratio < 0.75) return '0.5×';
  if (ratio < 1.5) return '1×';
  if (ratio < 3) return '2×';
  if (ratio < 6) return '4×';
  return Math.round(ratio) + '×';
}

// PERF : rawCandleData est déjà trié par temps croissant (garanti par csvWorker.js et par
// generateMockData()). L'ancienne implémentation faisait un .filter() sur TOUT le tableau à
// chaque appel — coûteux en O(n), et cette fonction est appelée à chaque pixel de déplacement
// du slider de replay (potentiellement des dizaines d'appels par seconde). Comme le tableau est
// trié, "toutes les barres jusqu'à l'index" est simplement une tranche contiguë : un .slice()
// est O(k) (k = nombre de barres gardées) au lieu de O(n) (n = taille totale du dataset), et
// évite de revisiter les barres déjà exclues à chaque frame.
function getReplayFilteredData() {
  if (!replayState.enabled || !rawCandleData.length) return rawCandleData;
  const idx = Math.max(0, Math.min(replayState.index, rawCandleData.length - 1));
  return rawCandleData.slice(0, idx + 1);
}

/** Temps max visible en mode replay (null = tout l'historique). */
function getReplayCutoffTime() {
  if (!replayState.enabled || !rawCandleData.length) return null;
  const idx = Math.max(0, Math.min(replayState.index, rawCandleData.length - 1));
  return rawCandleData[idx]?.time ?? null;
}

/**
 * Dessin "dans le futur" : toutes ses ancres temporelles sont après le curseur replay.
 * Les horizontales (prix seul) restent toujours visibles. Les positions longues/courtes
 * (fix demandé) restent aussi toujours visibles : c'est précisément l'usage prévu de l'outil en
 * mode replay — placer une position AVANT que le curseur n'atteigne son heure d'entrée, pour
 * ensuite avancer le replay et vérifier si le stop ou l'objectif est touché. La détection de
 * stop/objectif (evaluatePositionHits) ne regarde de toute façon que les bougies dont
 * `bar.time >= entryTime` et déjà révélées par le replay, donc rien n'est "spoilé" en gardant
 * la position visible à l'avance.
 */
function isDrawingInFuture(drawing, cutoffTime) {
  if (cutoffTime == null) return false;
  if (!drawing || drawing.type === 'horizontal' || drawing.type === 'longPosition' || drawing.type === 'shortPosition') return false;
  const times = [];
  if (drawing.time != null) times.push(drawing.time);
  if (drawing.entryTime != null) times.push(drawing.entryTime);
  if (drawing.endTime != null) times.push(drawing.endTime);
  if (drawing.p1?.time != null) times.push(drawing.p1.time);
  if (drawing.p2?.time != null) times.push(drawing.p2.time);
  if (drawing.p3?.time != null) times.push(drawing.p3.time);
  // NOUVEAU : zigzagArrow à nombre de points libre — toutes les ancres de d.points comptent
  // (rétrocompatible : sur un dessin ancien format non encore migré, p1/p2/p3 sont déjà pris
  // en compte ci-dessus).
  if (Array.isArray(drawing.points)) {
    for (const p of drawing.points) if (p?.time != null) times.push(p.time);
  }
  if (!times.length) return false;
  return Math.min(...times) > cutoffTime;
}

function applyReplayDrawingVisibility(pane) {
  if (!pane) return;
  const cutoff = getReplayCutoffTime();
  for (const d of pane.drawings || []) {
    const future = isDrawingInFuture(d, cutoff);
    d._hiddenByReplay = future;
    if (d.type === 'horizontal' && d.priceLine) {
      try { d.priceLine.applyOptions({ axisLabelVisible: !future }); } catch {}
    }
    if (d._primitive) {
      try { d._primitive.refresh(); } catch {}
    }
  }
  redrawPane(pane);
}

function applyReplayDrawingVisibilityAll() {
  panes.forEach(applyReplayDrawingVisibility);
}

/**
 * Détecte si une position long/short a touché stop ou TP sur les barres visibles jusqu'au curseur.
 * Priorité au premier événement chronologique (stop ou target).
 */
function evaluatePositionHits(drawing, bars) {
  if (!drawing || (drawing.type !== 'longPosition' && drawing.type !== 'shortPosition')) return;
  if (!bars || !bars.length) {
    drawing._hitStatus = null;
    drawing._hitTime = null;
    return;
  }
  const isLong = drawing.type === 'longPosition';
  const entryT = drawing.entryTime;
  for (const bar of bars) {
    if (bar.time < entryT) continue;
    // Une fois entrée « active », on regarde high/low de chaque barre
    if (isLong) {
      // Stop en premier si les deux touchés sur la même barre (conservateur)
      if (bar.low <= drawing.stopPrice) {
        drawing._hitStatus = 'stop';
        drawing._hitTime = bar.time;
        return;
      }
      if (bar.high >= drawing.targetPrice) {
        drawing._hitStatus = 'target';
        drawing._hitTime = bar.time;
        return;
      }
    } else {
      if (bar.high >= drawing.stopPrice) {
        drawing._hitStatus = 'stop';
        drawing._hitTime = bar.time;
        return;
      }
      if (bar.low <= drawing.targetPrice) {
        drawing._hitStatus = 'target';
        drawing._hitTime = bar.time;
        return;
      }
    }
  }
  drawing._hitStatus = null;
  drawing._hitTime = null;
}

function evaluateAllPositionHits() {
  const bars = getReplayFilteredData();
  for (const pane of panes) {
    let changed = false;
    for (const d of pane.drawings || []) {
      if (d.type !== 'longPosition' && d.type !== 'shortPosition') continue;
      if (d._hiddenByReplay) {
        if (d._hitStatus) { d._hitStatus = null; d._hitTime = null; changed = true; }
        continue;
      }
      const prev = d._hitStatus;
      evaluatePositionHits(d, bars);
      if (d._hitStatus !== prev) {
        changed = true;
        // Toast uniquement quand on passe de « ouvert » → stop/TP (pas l'inverse)
        if (d._hitStatus && !prev) {
          const qty = Number(d.quantity) > 0 ? Number(d.quantity) : 1;
          const mark = d._hitStatus === 'stop' ? d.stopPrice : d.targetPrice;
          const pnl = computePositionPnl(d, mark);
          const side = d.type === 'longPosition' ? 'Long' : 'Short';
          if (d._hitStatus === 'stop') {
            showTradeToast(
              `⛔ ${side} ×${formatQty(qty)} — STOP touché` +
              (pnl ? ` · PnL ${pnl.pnl >= 0 ? '+' : ''}${formatPriceLabel(pnl.pnl)}` : ''),
              'stop'
            );
          } else {
            showTradeToast(
              `✅ ${side} ×${formatQty(qty)} — Take-profit touché` +
              (pnl ? ` · PnL ${pnl.pnl >= 0 ? '+' : ''}${formatPriceLabel(pnl.pnl)}` : ''),
              'target'
            );
          }
        }
      }
    }
    if (changed) {
      for (const d of pane.drawings) {
        if (d._primitive) try { d._primitive.refresh(); } catch {}
      }
      redrawPane(pane);
    }
  }
  // NOUVEAU : recalcule le solde/les règles du mode Prop Firm après chaque évaluation des
  // positions (toutes grilles confondues), puisque de nouveaux trades ont pu se clôturer.
  if (propFirmState.enabled) recomputePropFirmEquity();
}

/** Recalc SMA/EMA uniquement (sans retoucher la série principale) — utilisé pendant le play. */
async function refreshPaneIndicators(pane) {
  if (!pane) return;
  try {
    const source = getReplayFilteredData();
    const aggregated = await aggregateAsync(source, pane.timeframe);
    pane.lastAggregated = aggregated;
    if (pane.smaSeries) {
      for (const period of [20, 50, 200]) {
        const s = pane.smaSeries[period];
        if (!s) continue;
        if (indicatorState.sma[period]) {
          s.setData(computeSMA(aggregated, period));
          s.applyOptions({ visible: true });
        }
      }
    }
    if (pane.emaSeries) {
      for (const period of [9, 21]) {
        const s = pane.emaSeries[period];
        if (!s) continue;
        if (indicatorState.ema[period]) {
          s.setData(computeEMA(aggregated, period));
          s.applyOptions({ visible: true });
        }
      }
    }
  } catch (err) {
    console.warn('refreshPaneIndicators:', err);
  }
}

// Réinitialise le replay quand un nouveau jeu de données est chargé (CSV ou mock)
function resetReplayForNewData() {
  stopReplayPlayback();
  replayState.index = rawCandleData.length ? rawCandleData.length - 1 : 0;
  const slider = document.getElementById('rb-slider');
  slider.max = String(Math.max(0, rawCandleData.length - 1));
  slider.value = String(replayState.index);
}

function updateReplayUI() {
  const slider = document.getElementById('rb-slider');
  const label = document.getElementById('rb-label');
  const speedVal = document.getElementById('rb-speed-value');
  // Jauge = VITESSE (0–100), pas la position dans l'historique
  if (slider) {
    slider.min = '0';
    slider.max = '100';
    const ms = replayState.intervalMs || 500;
    const approx = Math.max(0, Math.min(100, ((2000 - ms) / 1950) * 100));
    if (document.activeElement !== slider) slider.value = String(Math.round(approx));
  }
  if (speedVal) speedVal.textContent = intervalMsToSpeedLabel(replayState.intervalMs || 500);
  if (label) {
    if (!replayState.enabled) label.textContent = t('replayOff');
    else if (!rawCandleData.length) label.textContent = t('replayNoData');
    else if (replayState.pickStartOnChart) label.textContent = t('replayClickChart');
    else label.textContent = `${replayState.index + 1} / ${rawCandleData.length}`;
  }
}

function updateReplayPlayIcon() {
  const btn = document.getElementById('rb-play');
  btn.classList.toggle('playing', replayState.playing);
  btn.innerHTML = replayState.playing
    ? '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="6,4 20,12 6,20"/></svg>';
}

function setReplayIndex(idx, opts = {}) {
  replayState.index = Math.max(0, Math.min(idx, rawCandleData.length - 1));
  updateReplayUI();
  refreshAllPanes({ fit: opts.fit === true }).then(() => {
    applyReplayDrawingVisibilityAll();
    evaluateAllPositionHits();
    scheduleWorkspaceSave(); // NOUVEAU (fix reprise de session) : mémorise la nouvelle position
  });
}

// NOUVEAU : ajoute des bougies brutes à une pane via series.update() (upsert) au lieu de
// series.setData() — pas de reconstruction complète, pas de flash/rescale à chaque bougie.
// lightweight-charts met à jour la dernière bougie si le "time" est identique, ou en ajoute
// une nouvelle si le "time" est postérieur (comportement natif de streaming temps réel).
function appendBarsToPane(pane, newBars) {
  const tf = Math.max(1, pane.timeframe || 1);
  const tfSec = tf * 60;
  // Même règle que aggregateAsync : agrège si TF >= résolution native (alignement inclus).
  const canAggregate = tfSec >= baseTimeframeSeconds;
  for (const bar of newBars) {
    const bucketTime = canAggregate ? bucketStart(bar.time, tf) : bar.time;
    if (!pane.replayLastBucket || pane.replayLastBucket.time !== bucketTime) {
      pane.replayLastBucket = {
        time: bucketTime, open: bar.open, high: bar.high, low: bar.low, close: bar.close,
        volume: bar.volume || 0
      };
      pane.candleCount = (pane.candleCount || 0) + 1;
    } else {
      const b = pane.replayLastBucket;
      b.high = Math.max(b.high, bar.high);
      b.low = Math.min(b.low, bar.low);
      b.close = bar.close;
      b.volume += (bar.volume || 0);
    }
    const type = pane.chartType || chartType;
    if (type === 'line') {
      pane.series.update({ time: pane.replayLastBucket.time, value: pane.replayLastBucket.close });
    } else {
      pane.series.update(pane.replayLastBucket);
    }
    if (pane.volumeSeries) {
      const t = THEMES[currentTheme];
      const b = pane.replayLastBucket;
      pane.volumeSeries.update({
        time: b.time,
        value: b.volume || 0,
        color: b.close >= b.open ? hexToRgba(t.upColor, 0.45) : hexToRgba(t.downColor, 0.45)
      });
    }
  }
  // SMA/EMA : recalc périodique (tous les N pas) pour rester cohérent sans tuer la perf
  pane._replayBarsSinceInd = (pane._replayBarsSinceInd || 0) + newBars.length;
  if (pane._replayBarsSinceInd >= (replayState.indEvery || 8)) {
    pane._replayBarsSinceInd = 0;
    refreshPaneIndicators(pane);
  }
  updateOhlcLegend(pane, null);
  redrawPane(pane);
  if (pane.index === activePaneIndex) updateTitlebarForPane(pane);
}

// Avance le replay de l'ancien index vers le nouveau en n'ajoutant QUE les bougies brutes
// intermédiaires (fluide, sans reconstruire tout le graphique)
function applyReplayStepIncremental(oldIndex, newIndex) {
  const newBars = rawCandleData.slice(oldIndex + 1, newIndex + 1);
  if (!newBars.length) return;
  panes.forEach(pane => appendBarsToPane(pane, newBars));
  replayState.index = newIndex;
  updateReplayUI();
  applyReplayDrawingVisibilityAll();
  evaluateAllPositionHits();
  // NOUVEAU (fix reprise de session) : mémorise la progression du replay au fil de l'eau, pour
  // ne jamais perdre plus de quelques bougies si l'app se ferme brutalement (crash, coupure...).
  // scheduleWorkspaceSave() (debounce 800ms) suffit en pas-à-pas ; en lecture continue rapide, le
  // debounce ne se déclenche jamais tant qu'on avance — on force donc un flush non-débouncé tous
  // les 20 pas pour garder un enregistrement quasi instantané même en lecture accélérée.
  scheduleWorkspaceSave();
  replayState._stepsSinceFlush = (replayState._stepsSinceFlush || 0) + 1;
  if (replayState._stepsSinceFlush >= 20) {
    replayState._stepsSinceFlush = 0;
    saveWorkspaceNow({ silent: true });
  }
}

/** Avance exactement d'une bougie source (1 barre du CSV). */
function advanceReplayStep() {
  if (!rawCandleData.length) return;
  if (replayState.index >= rawCandleData.length - 1) {
    stopReplayPlayback();
    return;
  }
  applyReplayStepIncremental(replayState.index, replayState.index + 1);
}

function startReplayPlayback() {
  if (!replayState.enabled || !rawCandleData.length) return;
  replayState.playing = true;
  updateReplayPlayIcon();
  const ms = Math.max(50, Number(replayState.intervalMs) || 500);
  replayState.timer = setInterval(advanceReplayStep, ms);
}

function restartReplayTimerIfPlaying() {
  if (!replayState.playing) return;
  if (replayState.timer) clearInterval(replayState.timer);
  const ms = Math.max(50, Number(replayState.intervalMs) || 500);
  replayState.timer = setInterval(advanceReplayStep, ms);
}

function stopReplayPlayback() {
  replayState.playing = false;
  if (replayState.timer) clearInterval(replayState.timer);
  replayState.timer = null;
  updateReplayPlayIcon();
  // Align indicators with the exact state at pause
  panes.forEach(p => refreshPaneIndicators(p));
  evaluateAllPositionHits();
}

/**
 * NOUVEAU (remplace les boutons % par une date) : retrouve, par recherche dichotomique, l'index
 * de la dernière bougie dont l'heure est <= à la date choisie (rawCandleData est trié par temps
 * croissant). Si la date est avant/après toute la plage, on borne au début/à la fin.
 */
function findReplayIndexForDate(targetTs) {
  if (!rawCandleData.length) return 0;
  if (targetTs <= rawCandleData[0].time) return 0;
  if (targetTs >= rawCandleData[rawCandleData.length - 1].time) return rawCandleData.length - 1;
  let lo = 0, hi = rawCandleData.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (rawCandleData[mid].time <= targetTs) lo = mid; else hi = mid - 1;
  }
  return lo;
}

function showReplayStartModal() {
  const modal = document.getElementById('rb-start-modal');
  if (!modal) return Promise.resolve(0.7);

  // Pré-remplit le sélecteur avec la vraie plage de dates du CSV chargé (min/max), et une
  // valeur par défaut à 70% du chemin — reprend l'ancien réglage par défaut, mais exprimé en date.
  const dateInput = document.getElementById('rb-start-date-input');
  if (dateInput && rawCandleData.length) {
    const toISODate = (ts) => new Date(ts * 1000).toISOString().slice(0, 10);
    dateInput.min = toISODate(rawCandleData[0].time);
    dateInput.max = toISODate(rawCandleData[rawCandleData.length - 1].time);
    const defaultTs = rawCandleData[Math.floor((rawCandleData.length - 1) * 0.7)].time;
    dateInput.value = toISODate(defaultTs);
  }

  modal.classList.add('visible');
  return new Promise((resolve) => {
    const onClick = (e) => {
      const btn = e.target.closest('button[data-start]');
      if (!btn) return;
      const v = btn.dataset.start;
      if (v === 'date') {
        // Ne ferme pas la modale tant qu'aucune date n'est choisie
        if (!dateInput || !dateInput.value) return;
        const chosenTs = Math.floor(new Date(dateInput.value + 'T00:00:00Z').getTime() / 1000);
        modal.classList.remove('visible');
        modal.removeEventListener('click', onClick);
        resolve({ date: chosenTs });
        return;
      }
      modal.classList.remove('visible');
      modal.removeEventListener('click', onClick);
      if (v === 'cancel') { resolve(null); return; }
      if (v === 'chart') { resolve('chart'); return; }
      resolve(parseFloat(v));
    };
    modal.addEventListener('click', onClick);
  });
}

// NOUVEAU : boutons de zoom +/- et "zoom par défaut" (façon TradingView), en bas à droite du
// graphique. Le zoom molette natif de lightweight-charts reste inchangé (handleScale.mouseWheel) ;
// ces boutons offrent la même action au clic, pratique sur trackpad ou pour un contrôle précis.
function zoomActivePane(factor) {
  const pane = panes[activePaneIndex] || panes[0];
  if (!pane) return;
  const ts = pane.chart.timeScale();
  const range = ts.getVisibleLogicalRange();
  if (!range) return;
  const center = (range.from + range.to) / 2;
  const half = ((range.to - range.from) / 2) * factor;
  ts.setVisibleLogicalRange({ from: center - half, to: center + half });
}

function setupZoomControls() {
  const inBtn = document.getElementById('zoom-in-btn');
  const outBtn = document.getElementById('zoom-out-btn');
  const resetBtn = document.getElementById('zoom-reset-btn');
  // Resserre/élargit la plage visible de ~30% par clic, en gardant le même centre — un clic
  // répété donne un zoom progressif fluide, comme les boutons +/- de TradingView.
  inBtn?.addEventListener('click', () => zoomActivePane(0.7));
  outBtn?.addEventListener('click', () => zoomActivePane(1 / 0.7));
  // "Zoom par défaut" = revenir à la vue initiale : une fenêtre récente à espacement normal
  // (DEFAULT_VISIBLE_BARS bougies + marge), comme au premier affichage du fichier.
  resetBtn?.addEventListener('click', () => {
    const pane = panes[activePaneIndex] || panes[0];
    applyDefaultZoom(pane);
  });
}

function setupReplayBar() {
  const toggle = document.getElementById('rb-toggle');
  const slider = document.getElementById('rb-slider');
  const playBtn = document.getElementById('rb-play');
  const stepBtn = document.getElementById('rb-step-btn');
  const skipEndBtn = document.getElementById('rb-skip-end');
  const controls = [slider, playBtn, stepBtn, skipEndBtn].filter(Boolean);

  async function enableReplay() {
    if (!rawCandleData.length) {
      toggle.checked = false;
      replayState.enabled = false;
      return;
    }
    // NOUVEAU : si un point de départ par défaut est configuré (Paramètres > Replay),
    // on saute la boîte de dialogue et on démarre directement à ce pourcentage.
    const defaultStart = APP_SETTINGS.replay.defaultStart;
    const choice = (defaultStart !== undefined && defaultStart !== 'ask')
      ? parseFloat(defaultStart)
      : await showReplayStartModal();
    if (choice === null) {
      toggle.checked = false;
      replayState.enabled = false;
      updateReplayUI();
      return;
    }
    replayState.enabled = true;
    controls.forEach(c => { c.disabled = false; });
    if (choice === 'chart') {
      replayState.pickStartOnChart = true;
      replayState.index = 0;
    } else if (choice && typeof choice === 'object' && choice.date != null) {
      // NOUVEAU : démarrage à une date précise choisie dans la modale (remplace les %)
      replayState.pickStartOnChart = false;
      replayState.index = findReplayIndexForDate(choice.date);
    } else {
      replayState.pickStartOnChart = false;
      const pct = typeof choice === 'number' ? choice : 0.7;
      replayState.index = Math.max(0, Math.min(
        rawCandleData.length - 1,
        Math.floor(rawCandleData.length * pct)
      ));
    }
    updateReplayUI();
    await refreshAllPanes({ fit: true });
    applyReplayDrawingVisibilityAll();
    evaluateAllPositionHits();
    scheduleWorkspaceSave(); // NOUVEAU (fix reprise de session)
  }

  function disableReplay() {
    stopReplayPlayback();
    replayState.enabled = false;
    replayState.pickStartOnChart = false;
    controls.forEach(c => { c.disabled = true; });
    panes.forEach(p => {
      (p.drawings || []).forEach(d => { d._hiddenByReplay = false; });
    });
    updateReplayUI();
    refreshAllPanes({ fit: true });
    scheduleWorkspaceSave(); // NOUVEAU (fix reprise de session)
  }

  toggle.addEventListener('change', () => {
    if (toggle.checked) enableReplay();
    else disableReplay();
  });

  // Jauge = vitesse uniquement
  slider.addEventListener('input', () => {
    if (!replayState.enabled) return;
    replayState.intervalMs = speedSliderToIntervalMs(slider.value);
    const speedVal = document.getElementById('rb-speed-value');
    if (speedVal) speedVal.textContent = intervalMsToSpeedLabel(replayState.intervalMs);
    restartReplayTimerIfPlaying();
  });

  playBtn.addEventListener('click', () => {
    if (!replayState.enabled) return;
    if (replayState.playing) stopReplayPlayback();
    else startReplayPlayback();
  });

  // Suivant = +1 bougie
  stepBtn?.addEventListener('click', () => {
    if (!replayState.enabled) return;
    stopReplayPlayback();
    advanceReplayStep();
  });

  skipEndBtn.addEventListener('click', () => {
    if (!replayState.enabled) return;
    stopReplayPlayback();
    setReplayIndex(rawCandleData.length - 1, { fit: true });
  });

  updateReplayUI();
}

