// ============================================================
// 08-panes-layouts-theme-ui.js
// Panes et layouts, application des thèmes, panneau Couleurs, sélecteur de thème, panneau Paramètres, création des séries/panes, zoom, rafraîchissement des panes
// Fait partie de renderer.js (sectionné en modules le 2026-08-28).
// Chargé comme <script> classique dans index.html : les variables/fonctions
// top-level restent globales et partagées entre tous ces fichiers, exactement
// comme dans l'ancien renderer.js monolithique — aucun changement de comportement.
// ============================================================
// ============ NOUVEAU : placement fluide des outils par glisser-déposer (un seul geste) ============
// Outils natifs à 2 ancres (ou 3, dont on ne glisse que les 2 premières) : presser sur le
// graphique, glisser, relâcher = dessin posé en un seul geste, sans avoir besoin d'un second
// clic séparé. Le zigzag (points libres) et les outils à une seule ancre (horizontal, vertical,
// texte, croix) n'en ont pas besoin — ils sont déjà posés en un clic. longPosition/shortPosition
// non plus : ils se posent désormais entièrement en un seul clic (voir handlePaneCanvasClick).
const DRAG_CREATABLE_TOOLS = new Set([
  'trend', 'arrow', 'rectangle', 'segment', 'ray', 'fibRetracement', 'priceRange', 'ellipse', 'circle',
  'fibExtension', 'parallelChannel', 'pitchfork', 'triangle'
]);

// Démarre le suivi d'un glisser en cours juste après la pose du premier point (via mousedown).
// Si l'utilisateur relâche sans avoir bougé de plus de DRAG_THRESHOLD_PX, rien ne se passe : on
// retombe simplement sur l'ancien flux clic-clic (le point 1 reste posé, en attente d'un second
// clic ailleurs) — 100% rétrocompatible. S'il a réellement glissé, on simule un second clic (ou
// troisième, pour les outils à 3 ancres) à la position de relâchement : le dessin se termine (ou
// avance d'une ancre) sans action supplémentaire de l'utilisateur.
//
// CORRECTIF : l'ancienne implémentation posait deux listeners *séparés* sur `window`
// (mousemove + mouseup) dans une closure indépendante des listeners déjà posés sur `canvas`
// juste en dessous. Résultat, constaté en test : l'aperçu élastique (géré par le mousemove du
// canvas) fonctionnait bien pendant le glisser, mais le relâchement ne finalisait pas toujours
// le dessin — le 2e point n'était jamais pose, et il ne restait que le point de départ (l'ancre)
// visible à l'écran. Plutôt que de continuer à maintenir deux mécanismes de suivi de souris en
// parallèle (source d'incohérences), tout est maintenant regroupé dans les MÊMES listeners
// `canvas` (mousedown/mousemove/mouseup ci-dessous), avec un `mouseup` de secours sur `window`
// pour le cas où le relâchement se produit hors du canvas — les deux appellent la même fonction
// `finishDragArm`, qui se neutralise elle-même après le premier appel pour ne jamais s'exécuter
// deux fois pour un même geste.


function applyThemeToPane(pane, themeName) {
  const t = THEMES[themeName];
  pane.chart.applyOptions({
    layout: {
      background: {
        type: LightweightCharts.ColorType.VerticalGradient,
        topColor: t.chartTop,
        bottomColor: t.chartBottom
      },
      textColor: t.text,
      // NOUVEAU : sans ceci, changer de thème réinitialiserait fontFamily à la police par
      // défaut de la lib (appliquée une seule fois à la création dans createPane).
      fontFamily: "'Calibri Light', 'Calibri', -apple-system, BlinkMacSystemFont, Roboto, sans-serif"
    },
    grid: { vertLines: { color: t.grid }, horzLines: { color: t.grid } },
    rightPriceScale: { borderColor: t.border },
    timeScale: { borderColor: t.border }
  });
  const type = pane.chartType || chartType;
  if (type === 'candles') {
    pane.series.applyOptions({
      upColor: t.upColor, downColor: t.downColor, wickUpColor: t.upColor, wickDownColor: t.downColor
    });
  } else if (type === 'bars') {
    pane.series.applyOptions({ upColor: t.upColor, downColor: t.downColor });
  } else if (type === 'line') {
    pane.series.applyOptions({ color: t.accent });
  }
  if (pane.volumeSeries && pane.lastAggregated) {
    pane.volumeSeries.setData(buildVolumeData(pane.lastAggregated, t.upColor, t.downColor));
  }
  if (pane.smaSeries) {
    for (const period of [20, 50, 200]) {
      pane.smaSeries[period]?.applyOptions({ color: SMA_COLORS[period] });
    }
  }
  if (pane.emaSeries) {
    for (const period of [9, 21]) {
      pane.emaSeries[period]?.applyOptions({ color: EMA_COLORS[period] });
    }
  }
  if (pane.legend) {
    pane.wrapper.style.setProperty('--up-color', t.upColor);
    pane.wrapper.style.setProperty('--down-color', t.downColor);
  }
  pane.drawings.forEach(d => {
    if (d.type === 'horizontal' && d.priceLine) d.priceLine.applyOptions({ color: d.color || t.drawColor });
    else if (d._primitive) d._primitive.refresh();
  });
  redrawPane(pane);
}

function applyTheme(themeName) {
  currentTheme = themeName;
  localStorage.setItem('theme', themeName);
  const t = THEMES[themeName];
  document.body.style.background = t.panelBg;
  document.body.style.color = t.text;
  document.getElementById('titlebar').style.background = t.barBg;
  document.getElementById('toolbar').style.background = t.barBg;
  document.getElementById('timeframe-bar').style.background = t.barBg;
  document.getElementById('drawing-sidebar').style.background = t.barBg;
  // Nouveau : les dégradés d'accent (bordures, boutons actifs) + le fond des boutons suivent le thème
  document.documentElement.style.setProperty('--accent', t.accent);
  document.documentElement.style.setProperty('--accent2', t.accent2);
  document.documentElement.style.setProperty('--accent3', t.accent3);
  document.documentElement.style.setProperty('--btn-bg', t.buttonBg);
  panes.forEach(p => applyThemeToPane(p, themeName));
  refreshColorPanelInputs(); // NOUVEAU : garde le panneau Couleurs synchro avec le thème actif
  // NOUVEAU : garde les sélecteurs de thème (toolbar + Paramètres) synchro
  const themeSelect = document.getElementById('theme-select');
  if (themeSelect && themeSelect.value !== themeName) themeSelect.value = themeName;
  const setThemeSelect = document.getElementById('set-theme');
  if (setThemeSelect && setThemeSelect.value !== themeName) setThemeSelect.value = themeName;
}

// ============ NOUVEAU : panneau "Couleurs" (personnalisation live) ============
const COLOR_PANEL_FIELDS = [
  { id: 'cp-upColor', key: 'upColor', label: 'Bougies haussières' },
  { id: 'cp-downColor', key: 'downColor', label: 'Bougies baissières' },
  { id: 'cp-accent', key: 'accent', label: 'Accent 1' },
  { id: 'cp-accent2', key: 'accent2', label: 'Accent 2' },
  { id: 'cp-accent3', key: 'accent3', label: 'Accent 3' },
  { id: 'cp-segmentColor', key: 'segmentColor', label: 'Outil Segment' },
  { id: 'cp-textColor', key: 'textColor', label: 'Outil Texte' },
  { id: 'cp-barSeed', key: 'barSeed', label: "Barres d'interface" },
  { id: 'cp-chartSeed', key: 'chartSeed', label: 'Fond du graphique' }
];

function refreshColorPanelInputs() {
  const t = THEMES[currentTheme];
  COLOR_PANEL_FIELDS.forEach(f => {
    const input = document.getElementById(f.id);
    if (input) input.value = t[f.key];
  });
}

function setupColorPanel() {
  const panel = document.getElementById('color-panel');
  const toggleBtn = document.getElementById('btn-color-panel');

  toggleBtn.addEventListener('click', () => {
    refreshColorPanelInputs();
    panel.classList.toggle('visible');
  });
  document.getElementById('cp-close').addEventListener('click', () => panel.classList.remove('visible'));

  COLOR_PANEL_FIELDS.forEach(f => {
    const input = document.getElementById(f.id);
    if (!input) return;
    input.addEventListener('input', () => {
      THEMES[currentTheme][f.key] = input.value;
      regenerateDerivedColors(currentTheme);
      persistCustomTheme(currentTheme);
      applyTheme(currentTheme);
    });
  });

  document.getElementById('cp-reset').addEventListener('click', () => {
    Object.assign(THEMES[currentTheme], JSON.parse(JSON.stringify(DEFAULT_THEMES[currentTheme])));
    localStorage.removeItem('customTheme_' + currentTheme);
    regenerateDerivedColors(currentTheme);
    applyTheme(currentTheme);
  });

  document.getElementById('cp-open-settings')?.addEventListener('click', () => {
    panel.classList.remove('visible');
    document.getElementById('settings-modal')?.classList.add('visible');
    refreshSettingsInputs();
  });
}

// ============ NOUVEAU : sélecteur de thème (toolbar + Paramètres) ============
function populateThemeSelects() {
  const lang = APP_SETTINGS.general.language === 'en' ? 'en' : 'fr';
  [document.getElementById('theme-select'), document.getElementById('set-theme')].forEach(sel => {
    if (!sel) return;
    const prevValue = sel.value;
    sel.innerHTML = '';
    THEME_ORDER.forEach(key => {
      const meta = THEME_META[key] || { emoji: '', fr: key, en: key };
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = `${meta.emoji} ${meta[lang]}`.trim();
      sel.appendChild(opt);
    });
    sel.value = THEME_ORDER.includes(prevValue) ? prevValue : currentTheme;
  });
}

// ============ NOUVEAU : panneau "Paramètres" (apparence, graphique, replay, général) ============
function refreshSettingsInputs() {
  const a = APP_SETTINGS.appearance, c = APP_SETTINGS.chart, r = APP_SETTINGS.replay, g = APP_SETTINGS.general;
  const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
  const setChecked = (id, val) => { const el = document.getElementById(id); if (el) el.checked = !!val; };
  const themeSel = document.getElementById('set-theme');
  if (themeSel) themeSel.value = currentTheme;
  setVal('set-font', a.font);
  setVal('set-density', a.density);
  setVal('set-radius', a.radius);
  setChecked('set-grid', a.gridVisible);
  setChecked('set-watermark', a.watermark);
  setVal('set-watermark-text', a.watermarkText || '');
  setVal('set-default-charttype', c.defaultChartType);
  setVal('set-default-layout', c.defaultLayout);
  setVal('set-default-tf', String(c.defaultTimeframe));
  setVal('set-day-boundary', String(c.dayBoundaryOffsetHours || 0));
  setVal('set-replay-speed', String(r.defaultSpeedPct));
  setVal('set-replay-start', String(r.defaultStart));
  setChecked('set-replay-sound', r.sound);
  setVal('set-language', g.language);
  setChecked('set-confirm-reset', g.confirmReset);
  setVal('set-autosave', String(g.autosaveSeconds));
}

let autosaveTimer = null;
function restartAutosaveTimer() {
  if (autosaveTimer) { clearInterval(autosaveTimer); autosaveTimer = null; }
  const secs = Number(APP_SETTINGS.general.autosaveSeconds) || 0;
  if (secs > 0) {
    autosaveTimer = setInterval(() => { saveWorkspaceNow({ silent: true }); }, secs * 1000);
  }
}

function setupSettingsModal() {
  const modal = document.getElementById('settings-modal');
  if (!modal) return;
  const openBtn = document.getElementById('btn-settings');
  const closeBtn = document.getElementById('set-close');
  const tabs = document.querySelectorAll('.settings-tab-btn');
  const tabPanes = document.querySelectorAll('.settings-pane');

  openBtn?.addEventListener('click', () => {
    refreshSettingsInputs();
    modal.classList.add('visible');
  });
  closeBtn?.addEventListener('click', () => modal.classList.remove('visible'));
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('visible'); });

  tabs.forEach(btn => {
    btn.addEventListener('click', () => {
      tabs.forEach(b => b.classList.remove('active'));
      tabPanes.forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.querySelector(`.settings-pane[data-pane="${btn.dataset.tab}"]`)?.classList.add('active');
    });
  });

  document.getElementById('set-open-colors')?.addEventListener('click', () => {
    modal.classList.remove('visible');
    refreshColorPanelInputs();
    document.getElementById('color-panel')?.classList.add('visible');
  });

  // --- Apparence ---
  document.getElementById('set-theme')?.addEventListener('change', (e) => applyTheme(e.target.value));
  document.getElementById('set-font')?.addEventListener('change', (e) => {
    APP_SETTINGS.appearance.font = e.target.value; persistAppSettings(); applyAppearance();
  });
  document.getElementById('set-density')?.addEventListener('change', (e) => {
    APP_SETTINGS.appearance.density = e.target.value; persistAppSettings(); applyAppearance();
    panes.forEach(p => { try { p.chart.applyOptions({ width: p.inner.clientWidth, height: p.inner.clientHeight }); redrawPane(p); } catch {} });
  });
  document.getElementById('set-radius')?.addEventListener('change', (e) => {
    APP_SETTINGS.appearance.radius = e.target.value; persistAppSettings(); applyAppearance();
  });
  document.getElementById('set-grid')?.addEventListener('change', (e) => {
    APP_SETTINGS.appearance.gridVisible = e.target.checked; persistAppSettings(); applyAppearance();
  });
  document.getElementById('set-watermark')?.addEventListener('change', (e) => {
    APP_SETTINGS.appearance.watermark = e.target.checked; persistAppSettings(); applyWatermarkToAllPanes();
  });
  document.getElementById('set-watermark-text')?.addEventListener('input', (e) => {
    APP_SETTINGS.appearance.watermarkText = e.target.value; persistAppSettings(); applyWatermarkToAllPanes();
  });

  // --- Graphique ---
  document.getElementById('set-default-charttype')?.addEventListener('change', (e) => {
    APP_SETTINGS.chart.defaultChartType = e.target.value; persistAppSettings();
  });
  document.getElementById('set-default-layout')?.addEventListener('change', (e) => {
    APP_SETTINGS.chart.defaultLayout = e.target.value; persistAppSettings();
  });
  document.getElementById('set-default-tf')?.addEventListener('change', (e) => {
    APP_SETTINGS.chart.defaultTimeframe = Number(e.target.value); persistAppSettings();
  });
  document.getElementById('set-day-boundary')?.addEventListener('change', (e) => {
    const h = Math.max(0, Math.min(23, parseInt(e.target.value, 10) || 0));
    e.target.value = h;
    APP_SETTINGS.chart.dayBoundaryOffsetHours = h;
    dayBoundaryOffsetHours = h; // NOUVEAU : relu par bucketStart() (thread principal + replay)
    persistAppSettings();
    // Les bougies 1D/1W/1M déjà affichées doivent être ré-agrégées avec le nouveau décalage.
    refreshAllPanes({ fit: false });
  });

  // --- Replay ---
  document.getElementById('set-replay-speed')?.addEventListener('change', (e) => {
    APP_SETTINGS.replay.defaultSpeedPct = Number(e.target.value); persistAppSettings();
  });
  document.getElementById('set-replay-start')?.addEventListener('change', (e) => {
    APP_SETTINGS.replay.defaultStart = e.target.value; persistAppSettings();
  });
  document.getElementById('set-replay-sound')?.addEventListener('change', (e) => {
    APP_SETTINGS.replay.sound = e.target.checked; persistAppSettings();
  });

  // --- Général ---
  document.getElementById('set-language')?.addEventListener('change', (e) => {
    APP_SETTINGS.general.language = e.target.value; persistAppSettings();
    applyLanguage(); populateThemeSelects();
  });
  document.getElementById('set-confirm-reset')?.addEventListener('change', (e) => {
    APP_SETTINGS.general.confirmReset = e.target.checked; persistAppSettings();
  });
  document.getElementById('set-autosave')?.addEventListener('change', (e) => {
    APP_SETTINGS.general.autosaveSeconds = Number(e.target.value); persistAppSettings(); restartAutosaveTimer();
  });

  document.getElementById('set-reset-all')?.addEventListener('click', () => {
    if (APP_SETTINGS.general.confirmReset && !confirm('Réinitialiser tous les paramètres (apparence, graphique, replay, général) ?')) return;
    APP_SETTINGS = JSON.parse(JSON.stringify(DEFAULT_APP_SETTINGS));
    dayBoundaryOffsetHours = APP_SETTINGS.chart.dayBoundaryOffsetHours || 0; // NOUVEAU
    persistAppSettings();
    applyAppearance();
    applyLanguage();
    populateThemeSelects();
    applyWatermarkToAllPanes();
    restartAutosaveTimer();
    refreshSettingsInputs();
    refreshAllPanes({ fit: false }); // NOUVEAU : ré-agrège 1D/1W/1M si le décalage a changé
  });
}

// NOUVEAU : crée la série principale selon le type demandé (candles / bars / line)
function createMainSeries(chart, type) {
  const t = THEMES[currentTheme];
  const pf = priceFormat || { type: 'price', precision: 5, minMove: 1e-5 };
  if (type === 'bars') {
    return chart.addSeries(LightweightCharts.BarSeries, {
      upColor: t.upColor, downColor: t.downColor,
      thinBars: false,
      priceFormat: pf
    });
  }
  if (type === 'line') {
    return chart.addSeries(LightweightCharts.LineSeries, {
      color: t.accent, lineWidth: 2,
      crosshairMarkerVisible: true,
      priceFormat: pf
    });
  }
  return chart.addSeries(LightweightCharts.CandlestickSeries, {
    upColor: t.upColor, downColor: t.downColor, borderVisible: false,
    wickUpColor: t.upColor, wickDownColor: t.downColor,
    priceFormat: pf
  });
}

// NOUVEAU : convertit OHLCV en points de ligne (close) si besoin
function seriesDataForType(aggregated, type) {
  if (type === 'line') {
    return aggregated.map(b => ({ time: b.time, value: b.close }));
  }
  return aggregated;
}

function createPane(index) {
  const wrapper = document.createElement('div');
  wrapper.className = 'chart-pane';
  wrapper.dataset.paneIndex = index;

  const inner = document.createElement('div');
  inner.className = 'pane-chart-inner';
  wrapper.appendChild(inner);

  const canvas = document.createElement('canvas');
  canvas.className = 'pane-canvas';
  wrapper.appendChild(canvas);

  // NOUVEAU : logo maison à la place du logo d'attribution TradingView natif
  // (attributionLogo:false ci-dessus). Même emplacement (bas-gauche).
  const appLogo = document.createElement('img');
  appLogo.className = 'pane-app-logo';
  appLogo.src = './assets/app-logo.png';
  appLogo.alt = '';
  appLogo.draggable = false;
  wrapper.appendChild(appLogo);

  document.getElementById('chart-grid').appendChild(wrapper);

  const chart = LightweightCharts.createChart(inner, {
    width: inner.clientWidth,
    height: inner.clientHeight,
    // NOUVEAU : attributionLogo:false désactive le logo TradingView natif de lightweight-charts
    // (coin bas-gauche) — remplacé par notre propre logo (voir .pane-app-logo ci-dessous).
    // NOUVEAU : attributionLogo:false désactive le logo TradingView natif de lightweight-charts
    // (coin bas-gauche) — remplacé par notre propre logo (voir .pane-app-logo ci-dessous).
    // NOUVEAU : police fine et cohérente pour tout le texte natif du graphique (axes, heures,
    // crosshair, filigrane) — Segoe UI (dispo nativement sous Windows) remplace la police par
    // défaut de la lib, jugée peu esthétique.
    layout: {
      background: { color: '#131722' }, textColor: '#d1d4dc', attributionLogo: false,
      fontFamily: "'Calibri Light', 'Calibri', -apple-system, BlinkMacSystemFont, Roboto, sans-serif"
    },
    grid: { vertLines: { color: '#1e222d' }, horzLines: { color: '#1e222d' } },
    rightPriceScale: { borderColor: '#2a2e39', scaleMargins: { top: 0.05, bottom: 0.22 } },
    timeScale: { borderColor: '#2a2e39', timeVisible: true, secondsVisible: false },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
    handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
    handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true }
  });
  const series = createMainSeries(chart, chartType);

  // Volume en overlay (bas du graphique), masquable
  const volumeSeries = chart.addSeries(LightweightCharts.HistogramSeries, {
    priceFormat: { type: 'volume' },
    priceScaleId: '',
    lastValueVisible: false,
    priceLineVisible: false
  });
  volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.78, bottom: 0 } });

  // Moyennes mobiles (séries ligne, données injectées selon indicatorState)
  const smaSeries = {};
  for (const period of [20, 50, 200]) {
    smaSeries[period] = chart.addSeries(LightweightCharts.LineSeries, {
      color: SMA_COLORS[period],
      lineWidth: period === 200 ? 2 : 1,
      lastValueVisible: false,
      priceLineVisible: false,
      crosshairMarkerVisible: false,
      visible: !!indicatorState.sma[period]
    });
  }

  // NOUVEAU : EMA
  const emaSeries = {};
  for (const period of [9, 21]) {
    emaSeries[period] = chart.addSeries(LightweightCharts.LineSeries, {
      color: EMA_COLORS[period],
      lineWidth: 1,
      lastValueVisible: false,
      priceLineVisible: false,
      crosshairMarkerVisible: false,
      visible: !!indicatorState.ema[period]
    });
  }

  // Légende OHLC au survol
  const legend = document.createElement('div');
  legend.className = 'ohlc-legend';
  legend.textContent = '';
  wrapper.appendChild(legend);

  const pane = {
    index, wrapper, inner, canvas, chart, series, volumeSeries, smaSeries, emaSeries, legend,
    chartType,
    timeframe: 5, drawings: [], pendingPoints: [], candleCount: 0, mousePos: null,
    replayLastBucket: null, lastAggregated: null
  };

  chart.timeScale().subscribeVisibleTimeRangeChange((range) => {
    redrawPane(pane);
    // Sync plage visible — ignore les rebonds provoqués par setVisibleRange sur les autres panes
    if (!syncPanesEnabled || !range || panes.length < 2) return;
    if (syncTimeRangeSource && syncTimeRangeSource !== pane) return;
    syncTimeRangeSource = pane;
    for (const other of panes) {
      if (other === pane) continue;
      try {
        // Ne sync que si la plage diffère vraiment (évite les setVisibleRange no-op → re-entrées)
        const cur = other.chart.timeScale().getVisibleRange();
        if (cur && Math.abs(cur.from - range.from) < 1e-6 && Math.abs(cur.to - range.to) < 1e-6) continue;
        other.chart.timeScale().setVisibleRange(range);
      } catch {}
    }
    if (syncTimeRangeRaf) cancelAnimationFrame(syncTimeRangeRaf);
    syncTimeRangeRaf = requestAnimationFrame(() => {
      syncTimeRangeSource = null;
      syncTimeRangeRaf = null;
    });
  });
  chart.subscribeClick((param) => handlePaneChartClick(pane, param));
  chart.subscribeCrosshairMove((param) => {
    updateOhlcLegend(pane, param);
    if (!syncPanesEnabled || panes.length < 2) return;
    // Ignore les events générés par setCrosshairPosition sur les panes suiveuses
    if (syncCrosshairSource && syncCrosshairSource !== pane) return;
    syncCrosshairSource = pane;

    if (param?.time != null) {
      // Prix : close/value de la série source, sinon dernier close connu de la cible
      const srcPrice = param.seriesData?.get(pane.series)?.close
        ?? param.seriesData?.get(pane.series)?.value
        ?? null;
      for (const other of panes) {
        if (other === pane) continue;
        try {
          let price = srcPrice;
          if (price == null && other.lastAggregated?.length) {
            // Trouve la barre au même temps (ou la plus proche) sur l'autre TF
            const bars = other.lastAggregated;
            let lo = 0, hi = bars.length - 1;
            while (lo < hi) {
              const mid = (lo + hi) >> 1;
              if (bars[mid].time < param.time) lo = mid + 1;
              else hi = mid;
            }
            price = bars[lo]?.close ?? bars[Math.max(0, lo - 1)]?.close;
          }
          if (price == null) continue;
          other.chart.setCrosshairPosition(price, param.time, other.series);
        } catch {}
      }
    } else {
      for (const other of panes) {
        if (other === pane) continue;
        try { other.chart.clearCrosshairPosition(); } catch {}
      }
    }
    if (syncCrosshairRaf) cancelAnimationFrame(syncCrosshairRaf);
    syncCrosshairRaf = requestAnimationFrame(() => {
      syncCrosshairSource = null;
      syncCrosshairRaf = null;
    });
  });
  // État du geste "presser → glisser → relâcher" en cours pour CETTE pane (partagé par les 3
  // listeners canvas ci-dessous via cette closure commune — voir le commentaire au-dessus de
  // DRAG_CREATABLE_TOOLS pour le détail du correctif).
  let dragArm = null; // { startX, startY, tool, confirmed }

  canvas.addEventListener('mousedown', (e) => {
    // Placement d'outils uniquement ici ; le drag est géré en pointerdown (évite le double-start)
    if (currentTool || advTool) {
      e.preventDefault(); // évite la sélection de texte/ghost-drag pendant un glisser rapide
      const wasFirstPoint = pane.pendingPoints.length === 0;
      // CORRECTIF : initialise mousePos DÈS le clic, pas seulement au premier "mousemove" qui
      // suit. Sans ça, entre la pose du 1er point et le tout premier mouvement de souris détecté,
      // pane.mousePos reste à son ancienne valeur (souvent null) et l'aperçu élastique du 2e
      // point (voir redrawPane) ne peut rien tracer — d'où l'impression que la flèche ne se
      // dessine "que d'un coup" à la fin du glisser au lieu de suivre la souris dès le départ.
      const rect = canvas.getBoundingClientRect();
      pane.mousePos = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      handlePaneCanvasClick(pane, e);
      // NOUVEAU : si ce clic vient de poser la 1ère ancre d'un outil à 2 (ou 3) ancres, on
      // arme le suivi du glisser — voir finishDragArm plus bas, déclenché au relâchement.
      if (wasFirstPoint && pane.pendingPoints.length === 1 && DRAG_CREATABLE_TOOLS.has(currentTool)) {
        dragArm = { startX: e.clientX, startY: e.clientY, tool: currentTool, confirmed: false };
      } else {
        dragArm = null;
      }
    }
  });
  canvas.addEventListener('mousemove', (e) => {
    // Confirme le glisser dès que le déplacement dépasse le seuil — indépendamment de la logique
    // d'aperçu ci-dessous, pour rester fiable même si celle-ci ne s'applique pas à cet outil.
    if (dragArm && dragArm.tool === currentTool && !dragArm.confirmed &&
        Math.hypot(e.clientX - dragArm.startX, e.clientY - dragArm.startY) > DRAG_THRESHOLD_PX) {
      dragArm.confirmed = true;
    }
    if (dragState && dragState.pane === pane) {
      updateDrawingDrag(e.clientX, e.clientY);
      return;
    }
    if (!currentTool || pane.pendingPoints.length < 1) {
      if (selectedDrawing && selectedDrawing.pane === pane && !currentTool && !advTool) {
        const rect = canvas.getBoundingClientRect();
        const hx = e.clientX - rect.left, hy = e.clientY - rect.top;
        const h = hitTestHandle(pane, selectedDrawing.drawing, hx, hy);
        if (h) canvas.style.cursor = h.cursor || 'grab';
        // NOUVEAU : indique visuellement (curseur "copy") que Ctrl/Cmd + glisser dupliquera le dessin.
        else canvas.style.cursor = findDrawingAtPoint(pane, hx, hy) ? ((e.ctrlKey || e.metaKey) ? 'copy' : 'move') : '';
      }
      // NOUVEAU : curseur "+" avec prix/heure même AVANT la pose du 1er point (outil sélectionné
      // mais aucune ancre encore posée). Le crosshair natif de lightweight-charts ne reçoit plus
      // les mouvements de souris tant que ce canvas de dessin est par-dessus lui (pointer-events
      // auto), donc sans ça on perd toute indication de prix/heure pendant tout le placement.
      if ((currentTool || advTool) && pane.pendingPoints.length < 1) {
        const rect = canvas.getBoundingClientRect();
        pane.mousePos = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        redrawPane(pane);
      }
      return;
    }
    // NOUVEAU : longPosition/shortPosition ne sont plus dans cette liste — posés entièrement en
    // un seul clic (voir handlePaneCanvasClick), ils n'ont plus de phase d'aperçu multi-clic.
    const multi = ['fibExtension', 'parallelChannel', 'pitchfork', 'triangle'];
    const two = ['trend', 'arrow', 'rectangle', 'segment', 'fibRetracement', 'ray', 'priceRange', 'ellipse', 'circle', 'zigzagArrow', ...multi];
    const rect = canvas.getBoundingClientRect();
    pane.mousePos = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    if (!two.includes(currentTool)) { redrawPane(pane); return; } // curseur "+" seul, pas d'aperçu élastique
    if (multi.includes(currentTool) && pane.pendingPoints.length > 2) { redrawPane(pane); return; }
    // NOUVEAU : zigzagArrow n'a pas de plafond de points — l'aperçu doit continuer à suivre la
    // souris quel que soit le nombre de points déjà posés.
    if (currentTool === 'zigzagArrow') {
      if (pane.pendingPoints.length < 1) { redrawPane(pane); return; }
    } else if (!multi.includes(currentTool) && pane.pendingPoints.length !== 1) { redrawPane(pane); return; }
    redrawPane(pane);
  });
  // Termine le geste presser→glisser→relâcher : pose le 2e point (ou avance d'une ancre pour un
  // outil à 3 points) exactement comme le ferait un 2e clic séparé. Posé à la fois sur `canvas`
  // (cas normal) et sur `window` (relâchement hors du canvas, ex. bord de fenêtre) — les deux
  // appellent la même fonction, qui se neutralise (dragArm = null) dès le premier appel utile,
  // donc jamais de double déclenchement même si le canvas ET window reçoivent l'évènement.
  function finishDragArm(e) {
    if (!dragArm) return;
    const arm = dragArm;
    dragArm = null;
    if (!arm.confirmed) return; // simple clic sans glisser : l'ancien flux clic-clic prend le relais
    // Sécurité : si l'outil a changé (Échap, autre outil sélectionné...) entre-temps, on annule
    // plutôt que de poser un point avec un état incohérent.
    if (currentTool !== arm.tool || pane.pendingPoints.length !== 1) return;
    handlePaneCanvasClick(pane, e);
  }
  canvas.addEventListener('mouseup', finishDragArm);
  window.addEventListener('mouseup', finishDragArm);
  // NOUVEAU : efface le curseur "+" (et l'aperçu élastique) dès que la souris quitte le canvas —
  // sinon il restait figé à la dernière position connue au lieu de disparaître.
  canvas.addEventListener('mouseleave', () => {
    if ((currentTool && pane.pendingPoints.length < 1) || advTool) {
      pane.mousePos = null;
      redrawPane(pane);
    }
  });
  // NOUVEAU : double-clic pour terminer un tracé de zigzag à nombre de points libre (le simple
  // clic, lui, ne fait qu'ajouter un point de plus — voir handlePaneCanvasClick).
  canvas.addEventListener('dblclick', (e) => {
    if (currentTool === 'zigzagArrow') {
      e.preventDefault();
      finishZigzagDrawing(pane);
    }
  });
  wrapper.addEventListener('pointerdown', (e) => {
    setActivePane(index);
    if (currentTool || advTool) return;
    if (tryBeginDragFromEvent(pane, e)) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);

  // ResizeObserver : réagit aux changements de taille du conteneur (layout, panneaux, DPI)
  // sans dépendre uniquement de window.resize
  if (typeof ResizeObserver !== 'undefined') {
    let resizeRaf = null;
    pane._resizeObserver = new ResizeObserver(() => {
      if (resizeRaf) cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(() => {
        if (!pane.chart || !pane.inner) return;
        const cw = pane.inner.clientWidth, ch = pane.inner.clientHeight;
        if (cw > 0 && ch > 0) {
          try { pane.chart.applyOptions({ width: cw, height: ch }); } catch {}
          redrawPane(pane);
        }
      });
    });
    pane._resizeObserver.observe(pane.inner);
  }

  panes.push(pane);
  applyThemeToPane(pane, currentTheme);
  attachDrawingManager(pane);
  volumeSeries.applyOptions({ visible: indicatorState.volume });
  // NOUVEAU : applique les préférences d'environnement (grille, filigrane) à la nouvelle pane
  try {
    chart.applyOptions({ grid: { vertLines: { visible: !!APP_SETTINGS.appearance.gridVisible }, horzLines: { visible: !!APP_SETTINGS.appearance.gridVisible } } });
  } catch {}
  applyWatermarkToPane(pane);
  return pane;
}

function updateOhlcLegend(pane, param) {
  if (!pane.legend) return;
  const t = THEMES[currentTheme];
  let bar = null;
  if (param && param.seriesData) {
    bar = param.seriesData.get(pane.series) || null;
  }
  // Pour le mode ligne, seriesData n'a que {time, value} — on retrouve la barre OHLCV
  if (bar && bar.value != null && bar.open == null && pane.lastAggregated) {
    const t = bar.time;
    const found = pane.lastAggregated.find(b => b.time === t);
    if (found) bar = found;
  }
  if (!bar && pane.lastAggregated && pane.lastAggregated.length) {
    bar = pane.lastAggregated[pane.lastAggregated.length - 1];
  }
  if (!bar) { pane.legend.textContent = ''; return; }
  // Si on n'a toujours que value (ligne sans match), afficher le prix seul
  if (bar.open == null && bar.value != null) {
    pane.legend.innerHTML =
      `<span class="ohlc-label">C</span><span class="ohlc-up">${formatOhlcPrice(bar.value)}</span>`;
    return;
  }
  const up = bar.close >= bar.open;
  const cls = up ? 'ohlc-up' : 'ohlc-down';
  const vol = bar.volume != null ? bar.volume : (param?.seriesData?.get(pane.volumeSeries)?.value);
  pane.legend.innerHTML =
    `<span class="ohlc-label">O</span><span class="${cls}">${formatOhlcPrice(bar.open)}</span>` +
    `<span class="ohlc-sep">·</span><span class="ohlc-label">H</span><span class="${cls}">${formatOhlcPrice(bar.high)}</span>` +
    `<span class="ohlc-sep">·</span><span class="ohlc-label">L</span><span class="${cls}">${formatOhlcPrice(bar.low)}</span>` +
    `<span class="ohlc-sep">·</span><span class="ohlc-label">C</span><span class="${cls}">${formatOhlcPrice(bar.close)}</span>` +
    (vol != null && vol !== 0 ? `<span class="ohlc-sep">·</span><span class="ohlc-label">V</span><span>${Number(vol).toLocaleString('fr-FR')}</span>` : '');
}

function destroyAllPanes() {
  panes.forEach(p => {
    try { p._resizeObserver?.disconnect(); } catch {}
    try { p.chart.remove(); } catch {}
  });
  panes = [];
  document.getElementById('chart-grid').innerHTML = '';
}

function setLayout(layout) {
  hideDrawingMenu(); // NOUVEAU : les panes/primitives référencées par une sélection en cours vont être détruites
  const preserved = panes.map(p => ({ timeframe: p.timeframe, drawings: p.drawings }));
  currentLayout = layout;

  destroyAllPanes();

  let cols = 1, rows = 1;
  if (layout === '2x1') { cols = 2; rows = 1; }
  if (layout === '2x2') { cols = 2; rows = 2; }

  const grid = document.getElementById('chart-grid');
  grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  grid.style.gridTemplateRows = `repeat(${rows}, 1fr)`;

  const count = cols * rows;
  for (let i = 0; i < count; i++) {
    const pane = createPane(i);
    if (preserved[i]) {
      pane.timeframe = preserved[i].timeframe;
      pane.drawings = preserved[i].drawings;
      // Les panes précédentes (et leurs series/primitives) ont été détruites par destroyAllPanes() :
      // on efface les références mortes avant de rattacher tout sur la nouvelle série.
      pane.drawings.forEach(d => { d.priceLine = null; d._primitive = null; });
      syncPaneDrawings(pane);
    } else {
      // CORRECTIF : une pane NOUVELLE (grille agrandie, ex. 1x1 → 2x2) ne doit pas garder le
      // TF par défaut codé en dur de createPane() (5m) — s'il est plus fin que la résolution
      // native du fichier chargé, aggregateAsync() renvoie alors les barres brutes non agrégées
      // (voir sa règle tfSec < baseTimeframeSeconds) et la pane affiche en permanence l'avertissement
      // "⚠ source ... (CSV)" au lieu d'un graphique correctement agrégé. On hérite donc du TF
      // d'une pane déjà existante, ou à défaut du TF suggéré pour la résolution native détectée.
      pane.timeframe = preserved[0]?.timeframe || suggestTimeframeMinutes(baseTimeframeSeconds);
    }
  }

  document.querySelectorAll('.layout-btn').forEach(b => b.classList.toggle('active', b.dataset.layout === layout));
  setActivePane(0);
  refreshAllPanes();
  scheduleWorkspaceSave();
}

function setActivePane(index) {
  if (!panes[index]) return;
  activePaneIndex = index;
  panes.forEach((p, i) => p.wrapper.classList.toggle('active', i === index));
  const pane = panes[index];
  updateTimeframeButtons(pane.timeframe);
  updateTitlebarForPane(pane);
}

// NOUVEAU : zoom par défaut façon TradingView. `fitContent()` compressait TOUT l'historique
// chargé dans la largeur du graphique — avec un fichier d'un an en 5m ça donne des bougies
// sub-pixel, illisibles. On affiche à la place une fenêtre "récente" à un espacement de
// bougies normal (comme au premier affichage d'un symbole sur TradingView), avec une petite
// marge vide à droite.
const DEFAULT_VISIBLE_BARS = 45;
const DEFAULT_RIGHT_MARGIN_BARS = 8;

function applyDefaultZoom(pane) {
  if (!pane) return;
  const total = pane.candleCount || 0;
  const ts = pane.chart.timeScale();
  if (!total) { ts.fitContent(); return; }
  const to = (total - 1) + DEFAULT_RIGHT_MARGIN_BARS;
  const from = to - (DEFAULT_VISIBLE_BARS + DEFAULT_RIGHT_MARGIN_BARS);
  ts.setVisibleLogicalRange({ from, to });
}

async function refreshPaneData(pane, opts = {}) {
  if (!rawCandleData.length) return;
  const source = getReplayFilteredData();
  const aggregated = await aggregateAsync(source, pane.timeframe);
  const type = pane.chartType || chartType;
  // Réapplique le priceFormat (changement de fichier / mock) avant setData
  applyPriceFormatToPane(pane, priceFormat);
  pane.series.setData(seriesDataForType(aggregated, type));
  pane.lastAggregated = aggregated;
  pane.candleCount = aggregated.length;
  pane.replayLastBucket = aggregated.length ? { ...aggregated[aggregated.length - 1] } : null;

  // Volume
  if (pane.volumeSeries) {
    const t = THEMES[currentTheme];
    pane.volumeSeries.setData(buildVolumeData(aggregated, t.upColor, t.downColor));
    pane.volumeSeries.applyOptions({ visible: indicatorState.volume });
  }

  // SMA
  if (pane.smaSeries) {
    for (const period of [20, 50, 200]) {
      const s = pane.smaSeries[period];
      if (!s) continue;
      if (indicatorState.sma[period]) {
        s.setData(computeSMA(aggregated, period));
        s.applyOptions({ visible: true });
      } else {
        s.setData([]);
        s.applyOptions({ visible: false });
      }
    }
  }

  // NOUVEAU : EMA
  if (pane.emaSeries) {
    for (const period of [9, 21]) {
      const s = pane.emaSeries[period];
      if (!s) continue;
      if (indicatorState.ema[period]) {
        s.setData(computeEMA(aggregated, period));
        s.applyOptions({ visible: true });
      } else {
        s.setData([]);
        s.applyOptions({ visible: false });
      }
    }
  }

  // Légende : dernière bougie par défaut
  updateOhlcLegend(pane, null);

  if (opts.fit !== false) applyDefaultZoom(pane);
  applyReplayDrawingVisibility(pane);
  if (pane.index === activePaneIndex) updateTitlebarForPane(pane);
}

function refreshAllPanes(opts) {
  return Promise.all(panes.map(p => refreshPaneData(p, opts)));
}

// PERF : au-delà de ce seuil, on prévient l'utilisateur que le chargement va prendre du temps
// (lecture disque + parsing + désérialisation IPC), plutôt que de le laisser croire que l'app
// a gelé sans explication.
const LARGE_FILE_WARN_BYTES = 150 * 1024 * 1024; // 150 Mo

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(0)} Mo`;
}

