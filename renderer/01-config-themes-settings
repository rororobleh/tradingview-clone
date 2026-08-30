// ============================================================
// 01-config-themes-settings.js
// Thèmes, réglages de l'application (APP_SETTINGS), i18n (FR/EN), utilitaires de détection de timeframe/format de prix, variables globales de base (panes, currentTool, etc.)
// Fait partie de renderer.js (sectionné en modules le 2026-08-28).
// Chargé comme <script> classique dans index.html : les variables/fonctions
// top-level restent globales et partagées entre tous ces fichiers, exactement
// comme dans l'ancien renderer.js monolithique — aucun changement de comportement.
// ============================================================
// --- Thèmes (amélioration : vrais dégradés colorés visibles, pas juste des liserés) ---
const THEMES = {
  dark: {
    background: '#0b0e14',
    text: '#e6e9f0', grid: '#241f3d', border: '#3a2f5c',
    upColor: '#00d9a3', downColor: '#ff4d6d',
    drawColor: '#5b8cff',
    // NOUVEAU : couleurs par défaut dédiées aux outils Segment et Texte, distinctes de
    // drawColor (utilisée par tendance/flèche/rectangle/etc.), pour qu'on les distingue au
    // premier coup d'œil sans avoir à changer la couleur manuellement à chaque tracé.
    segmentColor: '#00e5ff', textColor: '#ffca28',
    accent: '#2962ff', accent2: '#7c5cff', accent3: '#00d9a3', advancedColor: '#ffb020',
    // NOUVEAU : couleurs "graines" personnalisables (panneau Couleurs) — les dégradés
    // (barBg/panelBg/buttonBg/chartTop/chartBottom) sont dérivés automatiquement de ces graines.
    barSeed: '#201a3a', chartSeed: '#120f22'
  },
  light: {
    background: '#ffffff',
    text: '#1a1f2e', grid: '#e3ddfb', border: '#c9bdf7',
    upColor: '#00b386', downColor: '#ff3b5c',
    drawColor: '#3d5afe',
    segmentColor: '#00acc1', textColor: '#ef6c00',
    accent: '#3d5afe', accent2: '#8e5cff', accent3: '#00b386', advancedColor: '#ff8f00',
    barSeed: '#eef0ff', chartSeed: '#f6f2ff'
  },
  // NOUVEAU : thèmes additionnels (plus de choix pour l'environnement visuel)
  midnight: {
    background: '#05070f',
    text: '#dfe6ff', grid: '#12182c', border: '#1f2a4d',
    upColor: '#3ddc97', downColor: '#ff5d8f',
    drawColor: '#5ec8ff',
    segmentColor: '#7c4dff', textColor: '#ffd54f',
    accent: '#2f6fed', accent2: '#00c2ff', accent3: '#3ddc97', advancedColor: '#ffb020',
    barSeed: '#0d1330', chartSeed: '#060a1a'
  },
  solarized: {
    background: '#00212b',
    text: '#e8dfc7', grid: '#0a3a46', border: '#155263',
    upColor: '#2aa198', downColor: '#dc7c3f',
    drawColor: '#b58900',
    segmentColor: '#6c71c4', textColor: '#d33682',
    accent: '#268bd2', accent2: '#b58900', accent3: '#2aa198', advancedColor: '#cb4b16',
    barSeed: '#0a3140', chartSeed: '#00232e'
  },
  graphite: {
    background: '#1b1c1f',
    text: '#e4e4e6', grid: '#2c2d31', border: '#3a3b40',
    upColor: '#8fd694', downColor: '#e08a8a',
    drawColor: '#c7c9cf',
    segmentColor: '#5c9ded', textColor: '#e0c068',
    accent: '#8a8d96', accent2: '#c7c9cf', accent3: '#8fd694', advancedColor: '#d9b45c',
    barSeed: '#232427', chartSeed: '#1a1b1e'
  },
  highContrast: {
    background: '#000000',
    text: '#ffffff', grid: '#2a2a2a', border: '#ffffff',
    upColor: '#00ff6a', downColor: '#ff3b3b',
    drawColor: '#ffe600',
    segmentColor: '#ff00ff', textColor: '#39ff14',
    accent: '#00b3ff', accent2: '#ffe600', accent3: '#00ff6a', advancedColor: '#ff9d00',
    barSeed: '#0a0a0a', chartSeed: '#000000'
  },
  ocean: {
    background: '#eef7fb',
    text: '#0d2b3a', grid: '#d5eaf3', border: '#a9d7ea',
    upColor: '#0aa88f', downColor: '#e0577a',
    drawColor: '#1276b5',
    segmentColor: '#7e57c2', textColor: '#c2185b',
    accent: '#1276b5', accent2: '#22b6d4', accent3: '#0aa88f', advancedColor: '#e08a2b',
    barSeed: '#dcf0f7', chartSeed: '#f3fafd'
  },
  // NOUVEAU : thème "Acier" — reproduit le rendu gris clair type TradingView (toolbar/sidebar
  // quasi noirs, fond de graphique gris acier, bougies vert/rouge sourds, sélection bleu vif) —
  // couleurs relevées directement sur une capture d'écran de référence (échantillonnage pixel).
  steel: {
    background: '#dbdbdb',
    text: '#131722', grid: '#c7c7c7', border: '#a8a8a8',
    upColor: '#2f9461', downColor: '#dc2941',
    drawColor: '#2962ff',
    segmentColor: '#00acc1', textColor: '#d32f2f',
    accent: '#2962ff', accent2: '#4caf50', accent3: '#2f9461', advancedColor: '#ffc107',
    barSeed: '#0f0f0f', chartSeed: '#d0d0d0'
  }
};

// NOUVEAU : couleur par défaut d'un dessin selon son type — Segment et Texte ont leur propre
// couleur (segmentColor / textColor), distincte de drawColor utilisée par les autres outils
// (tendance, flèche, rectangle, ligne horizontale/verticale...). d.color (choisie explicitement
// par l'utilisateur via le menu contextuel) reste toujours prioritaire, cette fonction ne sert
// que de valeur par défaut tant qu'aucune couleur n'a été choisie pour ce dessin précis.
function drawingDefaultColor(type) {
  const t = THEMES[currentTheme] || THEMES.dark;
  if (type === 'text') return t.textColor || t.drawColor;
  if (type === 'segment') return t.segmentColor || t.drawColor;
  // NOUVEAU : outil Croix (marque un break de structure) — rouge/alerte par défaut,
  // distinct de drawColor, pour ressortir visuellement comme un signal important.
  if (type === 'breakCross') return t.downColor || '#ff4d6d';
  return t.drawColor;
}
// Libellés affichés dans les sélecteurs de thème (toolbar + panneau Paramètres)
const THEME_META = {
  dark: { emoji: '🌙', fr: 'Sombre', en: 'Dark' },
  light: { emoji: '☀️', fr: 'Clair', en: 'Light' },
  midnight: { emoji: '🌌', fr: 'Minuit', en: 'Midnight' },
  solarized: { emoji: '🌇', fr: 'Solarisé', en: 'Solarized' },
  graphite: { emoji: '⬛', fr: 'Graphite', en: 'Graphite' },
  highContrast: { emoji: '⚡', fr: 'Contraste élevé', en: 'High contrast' },
  ocean: { emoji: '🌊', fr: 'Océan', en: 'Ocean' },
  steel: { emoji: '⚙️', fr: 'Acier', en: 'Steel' }
};
const THEME_ORDER = ['dark', 'light', 'midnight', 'solarized', 'graphite', 'highContrast', 'ocean', 'steel'];
// Snapshot des valeurs d'origine, pour le bouton "Réinitialiser" du panneau Couleurs
const DEFAULT_THEMES = JSON.parse(JSON.stringify(THEMES));

// Éclaircit (percent > 0) ou assombrit (percent < 0) une couleur hex
function shadeColor(hex, percent) {
  hex = (hex || '#808080').replace('#', '');
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
  const num = parseInt(hex, 16);
  const amount = Math.round(255 * percent / 100);
  const clamp = v => Math.max(0, Math.min(255, v));
  const r = clamp((num >> 16) + amount);
  const g = clamp(((num >> 8) & 0xff) + amount);
  const b = clamp((num & 0xff) + amount);
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

// Régénère les dégradés (barBg, panelBg, buttonBg, chartTop/Bottom) à partir des graines
function regenerateDerivedColors(themeName) {
  const t = THEMES[themeName];
  t.barBg = `linear-gradient(135deg, ${shadeColor(t.barSeed, 12)} 0%, ${shadeColor(t.barSeed, -12)} 100%)`;
  t.buttonBg = `linear-gradient(135deg, ${shadeColor(t.barSeed, 20)} 0%, ${shadeColor(t.barSeed, -4)} 100%)`;
  t.panelBg = `linear-gradient(160deg, ${shadeColor(t.barSeed, -14)} 0%, ${shadeColor(t.barSeed, -2)} 100%)`;
  t.chartTop = shadeColor(t.chartSeed, 14);
  t.chartBottom = shadeColor(t.chartSeed, -14);
}

// Charge les couleurs personnalisées sauvegardées (localStorage) pour tous les thèmes
function loadCustomThemeOverrides() {
  Object.keys(THEMES).forEach(name => {
    try {
      const saved = JSON.parse(localStorage.getItem('customTheme_' + name));
      if (saved) Object.assign(THEMES[name], saved);
    } catch { /* rien de sauvegardé / JSON invalide : on garde les valeurs par défaut */ }
    regenerateDerivedColors(name);
  });
}

function persistCustomTheme(themeName) {
  const t = THEMES[themeName];
  const toSave = {
    upColor: t.upColor, downColor: t.downColor,
    accent: t.accent, accent2: t.accent2, accent3: t.accent3,
    segmentColor: t.segmentColor, textColor: t.textColor,
    barSeed: t.barSeed, chartSeed: t.chartSeed
  };
  localStorage.setItem('customTheme_' + themeName, JSON.stringify(toSave));
}

// ============ NOUVEAU : Paramètres de l'application (apparence, graphique, replay, général) ============
const DEFAULT_APP_SETTINGS = {
  appearance: { font: 'system', density: 'comfortable', radius: 'soft', gridVisible: true, watermark: false, watermarkText: '' },
  chart: { defaultChartType: 'candles', defaultLayout: '1x1', defaultTimeframe: 5, dayBoundaryOffsetHours: 0 },
  replay: { defaultSpeedPct: 50, defaultStart: 'ask', sound: false },
  general: { language: 'fr', confirmReset: true, autosaveSeconds: 0 }
};

function loadAppSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem('appSettings'));
    if (!saved || typeof saved !== 'object') return JSON.parse(JSON.stringify(DEFAULT_APP_SETTINGS));
    // Fusion superficielle par section pour tolérer l'ajout de nouveaux champs plus tard
    const merged = JSON.parse(JSON.stringify(DEFAULT_APP_SETTINGS));
    for (const section of Object.keys(merged)) {
      if (saved[section] && typeof saved[section] === 'object') Object.assign(merged[section], saved[section]);
    }
    return merged;
  } catch {
    return JSON.parse(JSON.stringify(DEFAULT_APP_SETTINGS));
  }
}

let APP_SETTINGS = loadAppSettings();

function persistAppSettings() {
  localStorage.setItem('appSettings', JSON.stringify(APP_SETTINGS));
}

// Applique police / densité / arrondi / grille / filigrane à l'ensemble de l'interface
function applyAppearance() {
  const a = APP_SETTINGS.appearance;
  document.documentElement.setAttribute('data-font', a.font || 'system');
  document.documentElement.setAttribute('data-density', a.density || 'comfortable');
  document.documentElement.setAttribute('data-radius', a.radius || 'soft');
  panes.forEach(p => {
    try {
      p.chart.applyOptions({ grid: { vertLines: { visible: !!a.gridVisible }, horzLines: { visible: !!a.gridVisible } } });
    } catch {}
    applyWatermarkToPane(p);
  });
}

function watermarkLabelForPane() {
  const a = APP_SETTINGS.appearance;
  if (a.watermarkText && a.watermarkText.trim()) return a.watermarkText.trim();
  if (currentFilePath) {
    try { return (window.api.getFileName(currentFilePath) || '').replace(/\.csv$/i, ''); } catch { return ''; }
  }
  return '';
}

function applyWatermarkToPane(pane) {
  if (!pane || !pane.wrapper) return;
  const a = APP_SETTINGS.appearance;
  let el = pane.wrapper.querySelector('.pane-watermark');
  if (!el) {
    el = document.createElement('div');
    el.className = 'pane-watermark';
    // Inséré avant le canvas de dessin pour rester sous les dessins/légende
    pane.wrapper.insertBefore(el, pane.canvas || null);
  }
  const label = watermarkLabelForPane();
  el.textContent = label;
  el.classList.toggle('visible', !!a.watermark && !!label);
}

function applyWatermarkToAllPanes() {
  panes.forEach(applyWatermarkToPane);
}

// ---- Mini i18n : traduit les éléments d'interface porteurs de data-i18n / data-i18n-title ----
const I18N = {
  fr: {
    recentFiles: '🕑 Fichiers récents', chooseTheme: 'Choisir un thème',
    settingsTitle: "Paramètres de l'application",
    loadCsvTitle: 'Charger un CSV', recentFilesTitle: 'Fichiers récents', colorsTitle: 'Personnaliser les couleurs',
    indicatorsMenu: 'Indicateurs (Volume, SMA, EMA)',
    toggleVolume: 'Afficher/masquer le volume (V)', toggleMagnet: 'Aimant : accroche les dessins aux prix OHLC (M)',
    toggleSync: 'Synchroniser crosshair & zoom entre grilles',
    exportPngTitle: 'Exporter le graphique en PNG', shortcuts: 'Raccourcis clavier (?)',
    summaryTitle: 'Tableau récapitulatif des données',
    saveWorkspaceTitle: 'Sauvegarder le workspace', resetWorkspaceTitle: 'Restaurer la configuration par défaut',
    layout1x1Title: 'Grille simple (1x1)', layout2x1Title: 'Deux grilles côte à côte (2x1)', layout2x2Title: 'Quatre grilles (2x2)',
    toolCursor: 'Curseur', toolTrend: 'Ligne de tendance', toolHorizontal: 'Ligne horizontale',
    toolVertical: 'Ligne verticale', toolText: 'Texte', toolArrow: 'Flèche', toolRectangle: 'Rectangle / Zone',
    toolSegment: 'Segment (ligne bornée, sans mode infini)',
    toolLong: 'Position longue (1 clic, puis ajustez stop/cible)', toolShort: 'Position courte (1 clic, puis ajustez stop/cible)',
    toolZigzagArrow: 'Flèche en zigzag (clics libres, double-clic ou Entrée pour terminer)', toolPipsMeasure: 'Mesure (prix / pips / % / temps)',
    toolBreakCross: 'Croix (signaler un break)',
    toolAdvanced: 'Outils avancés (lightweight-charts-drawing)', toolClear: 'Effacer les dessins de la grille active',
    cpTitle: '🎨 Personnaliser les couleurs', cpUp: 'Bougies haussières', cpDown: 'Bougies baissières',
    cpAccent1: 'Accent 1', cpAccent2: 'Accent 2', cpAccent3: 'Accent 3', cpBar: "Barres d'interface",
    cpSegment: 'Outil Segment', cpText: 'Outil Texte',
    cpChart: 'Fond du graphique', reset: '↺ Réinitialiser', close: 'Fermer',
    cpMoreOptions: "Plus d'options d'apparence (police, arrondi, densité...) →",
    tabAppearance: 'Apparence', tabChart: 'Graphique', tabReplay: 'Replay', tabGeneral: 'Général',
    groupTheme: 'Thème', rowThemeColors: 'Thème de couleurs', rowCustomizeColors: 'Personnaliser les couleurs',
    openColorPanel: '🎨 Ouvrir le panneau Couleurs', groupFontLayout: 'Police & mise en page',
    rowFont: "Police de l'interface", fontSystem: 'Système (par défaut)', fontRounded: 'Arrondie', fontMono: 'Monospace',
    rowDensity: "Densité de l'interface", rowDensityHint: 'Compacte = barres plus fines',
    densityComfortable: 'Confortable', densityCompact: 'Compacte',
    rowRadius: 'Arrondi des angles', radiusSharp: 'Anguleux', radiusSoft: 'Doux (par défaut)', radiusRound: 'Arrondi',
    groupChart: 'Graphique', rowShowGrid: 'Afficher la grille', rowWatermark: 'Filigrane sur le graphique',
    rowWatermarkText: 'Texte du filigrane', rowWatermarkTextHint: 'Vide = nom du fichier chargé',
    groupDefaults: 'Valeurs par défaut au démarrage', rowDefaultChartType: 'Type de graphique par défaut',
    rowDefaultLayout: 'Disposition par défaut', rowDefaultTf: "Timeframe par défaut à l'ouverture d'un CSV",
    rowDefaultTfHint: 'Utilisé si compatible avec la résolution du fichier',
    groupDayBoundary: 'Alignement des bougies 1D / 1W / 1M',
    rowDayBoundary: 'Heure UTC de début de journée',
    rowDayBoundaryHint: "0 = minuit UTC (standard). La plupart des courtiers MetaTrader démarrent la journée vers 21h-22h UTC — regarde l'heure d'ouverture d'une bougie journalière sur ton compte MT pour trouver la bonne valeur. Ne change rien aux bougies intraday (1m à 12h).",
    groupReplayDefaults: 'Comportement par défaut', rowReplaySpeed: 'Vitesse de lecture par défaut',
    rowReplayStart: 'Point de départ par défaut', replayAlwaysAsk: 'Toujours demander',
    replayStartBeginning: 'Début des données', replayStartMiddle: 'Milieu (50%)',
    rowReplaySound: 'Son sur Stop / Take Profit', groupInterface: 'Interface',
    rowLanguage: 'Langue', rowLanguageHint: 'Traduit les menus et infobulles principaux',
    groupSaveSafety: 'Sécurité & sauvegarde', rowConfirmReset: 'Confirmer avant "Restaurer par défaut"',
    rowAutosave: 'Sauvegarde automatique du workspace', autosaveOff: 'Désactivée',
    autosave30: 'Toutes les 30s', autosave60: 'Toutes les minutes', autosave300: 'Toutes les 5 minutes',
    resetSettings: '↺ Réinitialiser les paramètres',
    replayOff: 'Replay off', replayNoData: 'Aucune donnée', replayClickChart: 'Cliquez le chart…'
  },
  en: {
    recentFiles: '🕑 Recent files', chooseTheme: 'Choose a theme',
    settingsTitle: 'Application settings',
    loadCsvTitle: 'Load a CSV', recentFilesTitle: 'Recent files', colorsTitle: 'Customize colors',
    indicatorsMenu: 'Indicators (Volume, SMA, EMA)',
    toggleVolume: 'Show/hide volume (V)', toggleMagnet: 'Magnet: snaps drawings to OHLC prices (M)',
    toggleSync: 'Sync crosshair & zoom across panes',
    exportPngTitle: 'Export chart as PNG', shortcuts: 'Keyboard shortcuts (?)',
    summaryTitle: 'Data summary table',
    saveWorkspaceTitle: 'Save workspace', resetWorkspaceTitle: 'Restore default configuration',
    layout1x1Title: 'Single grid (1x1)', layout2x1Title: 'Two grids side by side (2x1)', layout2x2Title: 'Four grids (2x2)',
    toolCursor: 'Cursor', toolTrend: 'Trend line', toolHorizontal: 'Horizontal line',
    toolVertical: 'Vertical line', toolText: 'Text', toolArrow: 'Arrow', toolRectangle: 'Rectangle / Zone',
    toolSegment: 'Segment (bounded line, no infinite mode)',
    toolLong: 'Long position (1 click, then adjust stop/target)', toolShort: 'Short position (1 click, then adjust stop/target)',
    toolZigzagArrow: 'Zigzag arrow (free clicks, double-click or Enter to finish)', toolPipsMeasure: 'Measure (price / pips / % / time)',
    toolBreakCross: 'Cross (mark a break)',
    toolAdvanced: 'Advanced tools (lightweight-charts-drawing)', toolClear: 'Clear drawings on the active pane',
    cpTitle: '🎨 Customize colors', cpUp: 'Bullish candles', cpDown: 'Bearish candles',
    cpAccent1: 'Accent 1', cpAccent2: 'Accent 2', cpAccent3: 'Accent 3', cpBar: 'Interface bars',
    cpSegment: 'Segment tool', cpText: 'Text tool',
    cpChart: 'Chart background', reset: '↺ Reset', close: 'Close',
    cpMoreOptions: 'More appearance options (font, corners, density...) →',
    tabAppearance: 'Appearance', tabChart: 'Chart', tabReplay: 'Replay', tabGeneral: 'General',
    groupTheme: 'Theme', rowThemeColors: 'Color theme', rowCustomizeColors: 'Customize colors',
    openColorPanel: '🎨 Open the color panel', groupFontLayout: 'Font & layout',
    rowFont: 'Interface font', fontSystem: 'System (default)', fontRounded: 'Rounded', fontMono: 'Monospace',
    rowDensity: 'Interface density', rowDensityHint: 'Compact = thinner bars',
    densityComfortable: 'Comfortable', densityCompact: 'Compact',
    rowRadius: 'Corner roundness', radiusSharp: 'Sharp', radiusSoft: 'Soft (default)', radiusRound: 'Round',
    groupChart: 'Chart', rowShowGrid: 'Show grid', rowWatermark: 'Chart watermark',
    rowWatermarkText: 'Watermark text', rowWatermarkTextHint: 'Empty = loaded file name',
    groupDefaults: 'Startup defaults', rowDefaultChartType: 'Default chart type',
    rowDefaultLayout: 'Default layout', rowDefaultTf: 'Default timeframe when opening a CSV',
    rowDefaultTfHint: "Used when compatible with the file's resolution",
    groupDayBoundary: '1D / 1W / 1M candle alignment',
    rowDayBoundary: 'UTC hour when the trading day starts',
    rowDayBoundaryHint: "0 = UTC midnight (standard). Most MetaTrader brokers start the day around 21:00-22:00 UTC — check the open time of a daily candle on your MT account to find the right value. Does not affect intraday candles (1m to 12h).",
    groupReplayDefaults: 'Default behavior', rowReplaySpeed: 'Default playback speed',
    rowReplayStart: 'Default start point', replayAlwaysAsk: 'Always ask',
    replayStartBeginning: 'Start of data', replayStartMiddle: 'Middle (50%)',
    rowReplaySound: 'Sound on Stop / Take Profit', groupInterface: 'Interface',
    rowLanguage: 'Language', rowLanguageHint: 'Translates the main menus and tooltips',
    groupSaveSafety: 'Safety & saving', rowConfirmReset: 'Confirm before "Restore defaults"',
    rowAutosave: 'Auto-save workspace', autosaveOff: 'Disabled',
    autosave30: 'Every 30s', autosave60: 'Every minute', autosave300: 'Every 5 minutes',
    resetSettings: '↺ Reset settings',
    replayOff: 'Replay off', replayNoData: 'No data', replayClickChart: 'Click the chart…'
  }
};

function t(key) {
  const lang = APP_SETTINGS.general.language === 'en' ? 'en' : 'fr';
  return (I18N[lang] && I18N[lang][key] != null) ? I18N[lang][key] : (I18N.fr[key] || key);
}

function applyLanguage() {
  const lang = APP_SETTINGS.general.language === 'en' ? 'en' : 'fr';
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n;
    if (I18N[lang][key] != null) el.textContent = I18N[lang][key];
  });
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    const key = el.dataset.i18nTitle;
    if (I18N[lang][key] != null) el.title = I18N[lang][key];
  });
  updateReplayUI();
}

const TF_LABELS = {
  1: '1m', 2: '2m', 3: '3m', 5: '5m', 10: '10m', 15: '15m', 30: '30m', 45: '45m',
  59: '59m', 60: '1h', 61: '61m', 65: '65m', 90: '90m',
  120: '2h', 180: '3h', 240: '4h', 720: '12h',
  1440: '1D', 10080: '1W', 43200: '1M'
};

// Résolution de base détectée sur le CSV chargé (secondes). Empêche d'afficher un TF
// plus fin que les données sources (ex. 1m demandé sur un fichier en 5m).
let baseTimeframeSeconds = 60;
let priceFormat = { type: 'price', precision: 5, minMove: 0.00001 }; // défaut FX-friendly

/**
 * Détecte le pas natif des barres (secondes).
 * Mode (delta le plus fréquent) — accepte jusqu'à ~5 jours pour les CSV journaliers
 * (week-end = trou de 3j, ne doit pas dominer face aux jours ouvrés à 86400s).
 */
function detectBaseTimeframeSeconds(data) {
  if (!data || data.length < 2) return 60;
  const counts = new Map();
  const n = Math.min(data.length, 500);
  for (let i = 1; i < n; i++) {
    const d = data[i].time - data[i - 1].time;
    // Ignore trous > 5 jours (vacances longues) ; garde 1j et week-ends
    if (d <= 0 || d > 86400 * 5) continue;
    counts.set(d, (counts.get(d) || 0) + 1);
  }
  if (!counts.size) {
    const deltas = [];
    for (let i = 1; i < n; i++) {
      const d = data[i].time - data[i - 1].time;
      if (d > 0 && d < 86400 * 40) deltas.push(d);
    }
    if (!deltas.length) return 60;
    deltas.sort((a, b) => a - b);
    return deltas[Math.floor(deltas.length / 2)];
  }
  let best = 60, bestN = 0;
  for (const [d, c] of counts) {
    if (c > bestN || (c === bestN && d < best)) {
      best = d;
      bestN = c;
    }
  }
  return best;
}

/**
 * TF d'affichage recommandé selon la résolution native du CSV.
 * Évite d'ouvrir un CSV journalier sur "5m" (chaque bougie serait encore 1 jour).
 */
function suggestTimeframeMinutes(baseSec) {
  const s = Number(baseSec) || 60;
  if (s < 45) return 1;           // ticks / secondes → 1m
  if (s < 90) return 1;           // ~1m
  if (s < 150) return 2;
  if (s < 240) return 3;
  if (s < 450) return 5;          // ~5m
  if (s < 750) return 10;
  if (s < 1200) return 15;
  if (s < 2400) return 30;
  if (s < 4000) return 60;        // ~1h
  if (s < 8000) return 120;
  if (s < 15000) return 240;      // ~4h
  if (s < 50000) return 720;      // ~12h
  if (s < 200000) return 1440;    // ~1 jour (86400)
  if (s < 800000) return 10080;   // ~1 semaine
  return 43200;                   // ~1 mois
}

function formatBaseResolutionLabel(baseSec) {
  const s = Number(baseSec) || 60;
  if (s < 60) return `${s}s`;
  if (s < 3600) {
    const m = Math.round(s / 60);
    return TF_LABELS[m] || `${m}m`;
  }
  if (s < 86400) {
    const h = Math.round(s / 3600);
    return h === 1 ? '1h' : `${h}h`;
  }
  const d = Math.round(s / 86400);
  if (d <= 1) return '1D';
  if (d <= 7) return '1W';
  return '1M';
}

/**
 * Déduit precision / minMove depuis un échantillon OHLCV.
 * Évite le défaut lightweight-charts (2 décimales) catastrophique sur le forex/or.
 */
function detectPriceFormat(data) {
  let maxDecimals = 2;
  if (!data || !data.length) {
    return { type: 'price', precision: 5, minMove: 1e-5 };
  }
  const n = Math.min(data.length, 200);
  for (let i = 0; i < n; i++) {
    for (const key of ['open', 'high', 'low', 'close']) {
      const v = data[i][key];
      if (v == null || !Number.isFinite(v)) continue;
      // toFixed(10) puis strip pour compter les décimales significatives sans artefacts float
      const s = v.toFixed(10).replace(/0+$/, '').replace(/\.$/, '');
      const dot = s.indexOf('.');
      if (dot !== -1) maxDecimals = Math.max(maxDecimals, s.length - dot - 1);
    }
  }
  maxDecimals = Math.min(Math.max(maxDecimals, 2), 8);
  return {
    type: 'price',
    precision: maxDecimals,
    minMove: 1 / Math.pow(10, maxDecimals)
  };
}

function applyPriceFormatToPane(pane, fmt) {
  if (!pane?.series || !fmt) return;
  try { pane.series.applyOptions({ priceFormat: fmt }); } catch {}
  // Alignement des indicateurs sur la même échelle
  if (pane.smaSeries) {
    for (const s of Object.values(pane.smaSeries)) {
      try { s.applyOptions({ priceFormat: fmt }); } catch {}
    }
  }
  if (pane.emaSeries) {
    for (const s of Object.values(pane.emaSeries)) {
      try { s.applyOptions({ priceFormat: fmt }); } catch {}
    }
  }
}

function applyPriceFormatToAllPanes(fmt) {
  priceFormat = fmt || priceFormat;
  panes.forEach(p => applyPriceFormatToPane(p, priceFormat));
}

// NOUVEAU : heure UTC (0-23) à laquelle démarre la "journée de trading" pour les bougies
// 1D/1W/1M — réglable dans Paramètres > Graphique pour coller à la convention d'un courtier
// MetaTrader (souvent 21h-22h UTC) au lieu du minuit UTC "standard" par défaut. N'affecte
// JAMAIS l'alignement des timeframes intraday (< 1D), qui reste calé sur l'epoch Unix comme
// TradingView/MT4/MT5.
let dayBoundaryOffsetHours = Number(APP_SETTINGS.chart.dayBoundaryOffsetHours) || 0;

/**
 * Alignement du début de bougie (même logique que aggWorker.js).
 * Exportée ici pour le mode replay incrémental.
 */
function bucketStart(unixSec, timeframeMinutes, dayBoundaryHourUtc = dayBoundaryOffsetHours) {
  const t = Number(unixSec);
  if (!Number.isFinite(t)) return 0;
  const offsetSec = ((Number(dayBoundaryHourUtc) || 0) % 24) * 3600;
  if (timeframeMinutes === 1440) return Math.floor((t - offsetSec) / 86400) * 86400 + offsetSec;
  if (timeframeMinutes === 10080) {
    const day = Math.floor((t - offsetSec) / 86400);
    return (day - ((day + 3) % 7)) * 86400 + offsetSec; // lundi (décalé) 00:00+offset UTC
  }
  if (timeframeMinutes === 43200) {
    const d = new Date((t - offsetSec) * 1000);
    return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000) + offsetSec;
  }
  const bucketSize = Math.max(1, timeframeMinutes) * 60;
  return Math.floor(t / bucketSize) * bucketSize;
}

// Indicateurs affichés (persistés en localStorage)
const indicatorState = {
  volume: localStorage.getItem('ind_volume') !== '0', // activé par défaut
  sma: {
    20: localStorage.getItem('ind_sma20') === '1',
    50: localStorage.getItem('ind_sma50') === '1',
    200: localStorage.getItem('ind_sma200') === '1'
  },
  // NOUVEAU : EMA (moyennes exponentielles)
  ema: {
    9: localStorage.getItem('ind_ema9') === '1',
    21: localStorage.getItem('ind_ema21') === '1'
  }
};
const SMA_COLORS = { 20: '#f5a623', 50: '#7c5cff', 200: '#00bcd4' };
const EMA_COLORS = { 9: '#ff6bcb', 21: '#4fc3f7' };

// NOUVEAU : type de série principale (candles | bars | line)
let chartType = localStorage.getItem('chartType') || APP_SETTINGS.chart.defaultChartType || 'candles';
// NOUVEAU : aimant — accroche les points de dessin aux OHLC les plus proches
let magnetEnabled = localStorage.getItem('magnet') === '1';
// NOUVEAU : synchronisation crosshair + plage temporelle entre grilles multi-panes
let syncPanesEnabled = localStorage.getItem('syncPanes') !== '0'; // activé par défaut
// Anti-boucle : on mémorise la pane source et on ignore les events rebond jusqu'au prochain frame
let syncCrosshairSource = null;
let syncTimeRangeSource = null;
let syncCrosshairRaf = null;
let syncTimeRangeRaf = null;

// NOUVEAU : pile d'annulation / rétablissement des dessins (par pane)
const undoStacks = new WeakMap(); // pane -> { undo: [], redo: [] }
const MAX_UNDO = 40;

let currentTheme = localStorage.getItem('theme') || 'dark';
let rawCandleData = [];
let currentFilePath = null;
let lastSkippedDetails = [];
let csvWorker = null;

// NOUVEAU (Étape 5)
let panes = [];
let activePaneIndex = 0;
let currentLayout = '1x1';
// NOUVEAU (Étape 3)
let currentTool = null;
let advTool = null; // NOUVEAU : outil avancé actif (lightweight-charts-drawing), mutuellement exclusif avec currentTool

