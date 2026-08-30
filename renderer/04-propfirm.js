// ============================================================
// 04-propfirm.js
// Mode Prop Firm (capital, objectifs, règles de trading) et rendu de l'outil position longue/courte
// Fait partie de renderer.js (sectionné en modules le 2026-08-28).
// Chargé comme <script> classique dans index.html : les variables/fonctions
// top-level restent globales et partagées entre tous ces fichiers, exactement
// comme dans l'ancien renderer.js monolithique — aucun changement de comportement.
// ============================================================
// ============ NOUVEAU : mode Prop Firm (capital, objectifs, règles de trading — comme FX Replay) ============
// Règles pré-remplies pour quelques firmes courantes ; l'utilisateur peut tout modifier ensuite,
// quelle que soit la firme choisie. Valeurs indicatives — à vérifier auprès de la firme réelle.
const PROPFIRM_PRESETS = {
  custom: null,
  ftmo1: { label: 'FTMO — Challenge (Phase 1)', startingBalance: 100000, profitTargetPct: 10, maxDailyLossPct: 5, maxTotalDrawdownPct: 10, drawdownType: 'static', minTradingDays: 4 },
  ftmo2: { label: 'FTMO — Vérification (Phase 2)', startingBalance: 100000, profitTargetPct: 5, maxDailyLossPct: 5, maxTotalDrawdownPct: 10, drawdownType: 'static', minTradingDays: 4 },
  fundedTrader: { label: 'The Funded Trader', startingBalance: 100000, profitTargetPct: 8, maxDailyLossPct: 5, maxTotalDrawdownPct: 10, drawdownType: 'trailing', minTradingDays: 0 },
  myFundedFx: { label: 'MyFundedFX', startingBalance: 100000, profitTargetPct: 8, maxDailyLossPct: 5, maxTotalDrawdownPct: 10, drawdownType: 'trailing', minTradingDays: 0 },
  fundingPips: { label: 'Funding Pips', startingBalance: 100000, profitTargetPct: 8, maxDailyLossPct: 5, maxTotalDrawdownPct: 10, drawdownType: 'static', minTradingDays: 0 },
  e8: { label: 'E8 Markets', startingBalance: 100000, profitTargetPct: 8, maxDailyLossPct: 5, maxTotalDrawdownPct: 8, drawdownType: 'static', minTradingDays: 0 }
};

let propFirmState = {
  enabled: false,
  preset: 'custom',
  startingBalance: 100000,
  profitTargetPct: 10,
  maxDailyLossPct: 5,
  maxTotalDrawdownPct: 10,
  drawdownType: 'static',   // 'static' (depuis le capital de départ) | 'trailing' (depuis le plus haut atteint)
  minTradingDays: 4,
  pipValuePerLot: 10,       // $ par pip et par unité de "quantity" — convertit le PnL en $ réels
  startTime: null,          // NOUVEAU : timestamp à partir duquel les trades comptent (null = tout l'historique) ; réinitialisé par "Réinitialiser le compte"
  traderName: '',           // NOUVEAU : nom affiché sur le certificat de réussite
  certificateShown: false,  // NOUVEAU : évite de rouvrir le certificat à chaque recalcul une fois déjà félicité pour CE run
  lossAnalysisShown: false, // NOUVEAU : idem pour l'analyse de perte
  closedTrades: [],         // NOUVEAU : trades clôturés du run courant (pour l'analyse en cas d'échec)
  // --- Champs calculés (recalculés à chaque évaluation, ne pas éditer directement) ---
  balance: 100000,
  peakBalance: 100000,
  profitPct: 0,
  currentDrawdownPct: 0,
  dayPnL: {},
  currentDayPnL: 0,
  worstDayLossPct: 0,
  tradingDaysCount: 0,
  closedTradesCount: 0,
  status: 'idle',           // 'idle' | 'running' | 'passed' | 'failed'
  failReason: null
};

function savePropFirmSettings() {
  try {
    const { balance, peakBalance, profitPct, currentDrawdownPct, dayPnL, currentDayPnL,
      worstDayLossPct, tradingDaysCount, closedTradesCount, status, failReason, closedTrades, ...cfg } = propFirmState;
    localStorage.setItem('propFirmSettings', JSON.stringify(cfg));
  } catch { /* stockage indisponible : les réglages ne seront simplement pas mémorisés */ }
}

function loadPropFirmSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem('propFirmSettings') || 'null');
    if (saved && typeof saved === 'object') Object.assign(propFirmState, saved);
  } catch { /* pas de réglages sauvegardés valides : on garde les valeurs par défaut */ }
}

function dayKeyFromUnix(t) {
  return new Date(t * 1000).toISOString().slice(0, 10); // clé YYYY-MM-DD en UTC
}

function formatUsd(n) {
  const v = Number(n) || 0;
  return (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** PnL réel en $ d'une position clôturée, converti via la valeur du pip configurée. */
function computePositionPnlUsd(d) {
  if (!d._hitStatus) return 0;
  const isLong = d.type === 'longPosition';
  const exit = d._hitStatus === 'stop' ? d.stopPrice : d.targetPrice;
  if (exit == null || d.entryPrice == null) return 0;
  const rawDiff = isLong ? (exit - d.entryPrice) : (d.entryPrice - exit);
  const pips = priceToPips(rawDiff);
  const qty = Number(d.quantity) > 0 ? Number(d.quantity) : 1;
  return pips * (propFirmState.pipValuePerLot || 10) * qty;
}

// Recalcule TOUT l'état du challenge à partir de zéro à chaque appel (solde, jours de trading,
// pire perte quotidienne...) en rejouant les positions actuellement clôturées (stop/TP touché)
// sur les grilles, filtrées par propFirmState.startTime. Idempotent : robuste au fait de reculer/
// avancer le curseur de replay, annuler/rétablir un dessin, ou en supprimer un.
function recomputePropFirmEquity() {
  if (!propFirmState.enabled) return;
  const closed = [];
  for (const pane of panes) {
    for (const d of pane.drawings || []) {
      if ((d.type === 'longPosition' || d.type === 'shortPosition') && d._hitStatus && !d._hiddenByReplay) {
        if (propFirmState.startTime != null && d._hitTime < propFirmState.startTime) continue;
        closed.push({ time: d._hitTime, pnl: computePositionPnlUsd(d) });
      }
    }
  }
  closed.sort((a, b) => a.time - b.time);

  let balance = propFirmState.startingBalance;
  let peak = balance;
  const dayPnL = {};
  for (const tr of closed) {
    balance += tr.pnl;
    if (balance > peak) peak = balance;
    const day = dayKeyFromUnix(tr.time);
    dayPnL[day] = (dayPnL[day] || 0) + tr.pnl;
  }

  propFirmState.balance = balance;
  propFirmState.peakBalance = peak;
  propFirmState.dayPnL = dayPnL;
  propFirmState.tradingDaysCount = Object.keys(dayPnL).length;
  propFirmState.closedTradesCount = closed.length;
  propFirmState.closedTrades = closed;

  const cutoff = getReplayCutoffTime();
  const refTime = cutoff != null ? cutoff : (closed.length ? closed[closed.length - 1].time : null);
  const curDay = refTime != null ? dayKeyFromUnix(refTime) : null;
  propFirmState.currentDayPnL = curDay ? (dayPnL[curDay] || 0) : 0;

  evaluatePropFirmRules();
  updatePropFirmPanel();

  // NOUVEAU : délivre automatiquement le certificat (challenge réussi) ou l'analyse de perte
  // (challenge échoué), une seule fois par run — tant que "Réinitialiser le compte" ou un nouveau
  // "Démarrer / Appliquer" ne relance pas le challenge (voir startPropFirmChallenge).
  if (propFirmState.status === 'passed' && !propFirmState.certificateShown) {
    propFirmState.certificateShown = true;
    savePropFirmSettings();
    showPropFirmCertificate();
  } else if (propFirmState.status === 'failed' && !propFirmState.lossAnalysisShown) {
    propFirmState.lossAnalysisShown = true;
    savePropFirmSettings();
    showPropFirmLossAnalysis();
  }
}

function evaluatePropFirmRules() {
  const s = propFirmState;
  if (!s.enabled) { s.status = 'idle'; s.failReason = null; return; }

  // Perte quotidienne max : on regarde le PIRE jour de tout l'historique compté (pas seulement
  // "aujourd'hui"), sinon reculer le curseur de replay masquerait artificiellement une règle
  // déjà cassée plus tôt dans le backtest.
  let worstDayLossPct = 0;
  for (const day in s.dayPnL) {
    const lossPct = (-s.dayPnL[day] / s.startingBalance) * 100;
    if (lossPct > worstDayLossPct) worstDayLossPct = lossPct;
  }
  s.worstDayLossPct = worstDayLossPct;

  const ddReferenceBalance = s.drawdownType === 'trailing' ? s.peakBalance : s.startingBalance;
  const floorBalance = ddReferenceBalance * (1 - s.maxTotalDrawdownPct / 100);
  s.currentDrawdownPct = Math.max(0, ((ddReferenceBalance - s.balance) / s.startingBalance) * 100);
  s.profitPct = ((s.balance - s.startingBalance) / s.startingBalance) * 100;

  if (s.balance <= floorBalance && s.maxTotalDrawdownPct > 0) {
    s.status = 'failed';
    s.failReason = '⛔ Drawdown maximum dépassé';
  } else if (worstDayLossPct > s.maxDailyLossPct && s.maxDailyLossPct > 0) {
    s.status = 'failed';
    s.failReason = '⛔ Perte quotidienne maximum dépassée';
  } else if (s.profitPct >= s.profitTargetPct && s.tradingDaysCount >= s.minTradingDays) {
    s.status = 'passed';
    s.failReason = null;
  } else {
    s.status = 'running';
    s.failReason = null;
  }
}

function setPfBar(id, value, max, danger) {
  const bar = document.getElementById(id);
  if (!bar) return;
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  bar.style.width = pct + '%';
  if (danger) {
    bar.classList.toggle('pf-bar-danger', pct >= 80);
    bar.classList.toggle('pf-bar-warn', pct >= 50 && pct < 80);
  }
}

function updatePropFirmPanel() {
  const panel = document.getElementById('propfirm-panel');
  if (!panel) return;
  const s = propFirmState;
  panel.classList.toggle('visible', s.enabled);
  if (!s.enabled) return;

  const badge = document.getElementById('pf-badge');
  badge.className = 'pf-badge pf-' + s.status;
  badge.textContent = s.status === 'passed' ? '✅ RÉUSSI' : s.status === 'failed' ? '⛔ ÉCHOUÉ' : '🟢 EN COURS';

  document.getElementById('pf-balance').textContent = formatUsd(s.balance);
  const diffEl = document.getElementById('pf-balance-diff');
  diffEl.textContent = (s.profitPct >= 0 ? '+' : '') + s.profitPct.toFixed(2) + '%';
  diffEl.className = 'pf-diff ' + (s.profitPct >= 0 ? 'pf-up' : 'pf-down');

  setPfBar('pf-target-bar', Math.max(0, s.profitPct), s.profitTargetPct, false);
  document.getElementById('pf-target-label').textContent = `${s.profitPct.toFixed(2)}% / ${s.profitTargetPct}%`;

  const todayLossPct = Math.max(0, (-s.currentDayPnL / s.startingBalance) * 100);
  setPfBar('pf-daily-bar', todayLossPct, s.maxDailyLossPct, true);
  document.getElementById('pf-daily-label').textContent = `${todayLossPct.toFixed(2)}% / ${s.maxDailyLossPct}%`;

  setPfBar('pf-dd-bar', s.currentDrawdownPct, s.maxTotalDrawdownPct, true);
  document.getElementById('pf-dd-label').textContent = `${s.currentDrawdownPct.toFixed(2)}% / ${s.maxTotalDrawdownPct}%`;

  document.getElementById('pf-days').textContent = `${s.tradingDaysCount} / ${s.minTradingDays}`;
  const failEl = document.getElementById('pf-fail-reason');
  failEl.textContent = s.failReason || '';
  failEl.style.display = s.failReason ? '' : 'none';
}

// "Réinitialiser le compte" : repart du capital de départ à partir de la position ACTUELLE du
// curseur de replay — les trades déjà clôturés avant ce point ne sont plus comptés. Pratique pour
// démarrer officiellement le challenge après une phase d'essai sur les mêmes données.
function startPropFirmChallenge() {
  const cutoff = getReplayCutoffTime();
  propFirmState.startTime = cutoff != null
    ? cutoff
    : (rawCandleData.length ? rawCandleData[rawCandleData.length - 1].time : null);
  propFirmState.certificateShown = false;
  propFirmState.lossAnalysisShown = false;
  recomputePropFirmEquity();
}

function setupPropFirmModal() {
  loadPropFirmSettings();
  const modal = document.getElementById('propfirm-modal');
  const openBtn = document.getElementById('btn-propfirm');
  const gearBtn = document.getElementById('pf-settings-btn');
  const presetSelect = document.getElementById('pf-preset');
  const fields = {
    startingBalance: document.getElementById('pf-starting-balance'),
    profitTargetPct: document.getElementById('pf-profit-target'),
    maxDailyLossPct: document.getElementById('pf-daily-loss'),
    maxTotalDrawdownPct: document.getElementById('pf-max-drawdown'),
    drawdownType: document.getElementById('pf-drawdown-type'),
    minTradingDays: document.getElementById('pf-min-days'),
    pipValuePerLot: document.getElementById('pf-pip-value'),
    traderName: document.getElementById('pf-trader-name')
  };

  presetSelect.innerHTML = Object.entries(PROPFIRM_PRESETS).map(([key, p]) =>
    `<option value="${key}">${p ? p.label : 'Personnalisé'}</option>`
  ).join('');

  function fillFieldsFromState() {
    presetSelect.value = propFirmState.preset || 'custom';
    fields.startingBalance.value = propFirmState.startingBalance;
    fields.profitTargetPct.value = propFirmState.profitTargetPct;
    fields.maxDailyLossPct.value = propFirmState.maxDailyLossPct;
    fields.maxTotalDrawdownPct.value = propFirmState.maxTotalDrawdownPct;
    fields.drawdownType.value = propFirmState.drawdownType;
    fields.minTradingDays.value = propFirmState.minTradingDays;
    fields.pipValuePerLot.value = propFirmState.pipValuePerLot;
    fields.traderName.value = propFirmState.traderName || '';
  }

  // Choisir une firme pré-remplit les règles ; tout reste ensuite modifiable librement.
  presetSelect.addEventListener('change', () => {
    const preset = PROPFIRM_PRESETS[presetSelect.value];
    if (!preset) return;
    fields.startingBalance.value = preset.startingBalance;
    fields.profitTargetPct.value = preset.profitTargetPct;
    fields.maxDailyLossPct.value = preset.maxDailyLossPct;
    fields.maxTotalDrawdownPct.value = preset.maxTotalDrawdownPct;
    fields.drawdownType.value = preset.drawdownType;
    fields.minTradingDays.value = preset.minTradingDays;
  });

  function openModal() { fillFieldsFromState(); modal.classList.add('visible'); }
  function closeModal() { modal.classList.remove('visible'); }
  openBtn.addEventListener('click', openModal);
  gearBtn?.addEventListener('click', openModal);
  modal.addEventListener('mousedown', (e) => { if (e.target === modal) closeModal(); });

  document.getElementById('pf-apply-btn').addEventListener('click', () => {
    propFirmState.preset = presetSelect.value;
    propFirmState.startingBalance = Math.max(1, parseFloat(fields.startingBalance.value) || 100000);
    propFirmState.profitTargetPct = Math.max(0, parseFloat(fields.profitTargetPct.value) || 0);
    propFirmState.maxDailyLossPct = Math.max(0, parseFloat(fields.maxDailyLossPct.value) || 0);
    propFirmState.maxTotalDrawdownPct = Math.max(0, parseFloat(fields.maxTotalDrawdownPct.value) || 0);
    propFirmState.drawdownType = fields.drawdownType.value === 'trailing' ? 'trailing' : 'static';
    propFirmState.minTradingDays = Math.max(0, parseInt(fields.minTradingDays.value, 10) || 0);
    propFirmState.pipValuePerLot = Math.max(0.01, parseFloat(fields.pipValuePerLot.value) || 10);
    propFirmState.traderName = (fields.traderName.value || '').trim();
    propFirmState.enabled = true;
    savePropFirmSettings();
    startPropFirmChallenge(); // démarre (ou redémarre) le challenge à partir de maintenant
    closeModal();
  });

  document.getElementById('pf-reset-btn').addEventListener('click', () => {
    if (!propFirmState.enabled) return;
    startPropFirmChallenge();
  });

  document.getElementById('pf-disable-btn').addEventListener('click', () => {
    propFirmState.enabled = false;
    savePropFirmSettings();
    updatePropFirmPanel();
    closeModal();
  });

  makeDraggable(document.getElementById('propfirm-panel'), document.querySelector('#propfirm-panel .pf-grip'), 'propfirmPanelPos');
  setupPfReportModals(); // NOUVEAU : certificat de réussite + analyse de perte

  if (propFirmState.enabled) recomputePropFirmEquity();
  else updatePropFirmPanel();
}

// ============ NOUVEAU : certificat de réussite + analyse de perte (challenge Prop Firm) ============

/** Dessine un "rapport" (certificat ou analyse) sur un canvas — pas de dépendance externe,
 * réutilise directement l'API Canvas 2D déjà utilisée ailleurs dans l'app (voir drawLabelBox). */
function renderPfReportCanvas(canvas, opts) {
  const w = canvas.width, h = canvas.height;
  const ctx = canvas.getContext('2d');
  const accent = opts.kind === 'certificate' ? '#00d9a3' : '#ff4d6d';

  const bgGrad = ctx.createLinearGradient(0, 0, w, h);
  bgGrad.addColorStop(0, '#15132a');
  bgGrad.addColorStop(1, '#1c1836');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = accent;
  ctx.lineWidth = 4;
  ctx.strokeRect(14, 14, w - 28, h - 28);
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = 1;
  ctx.strokeRect(24, 24, w - 48, h - 48);

  ctx.textAlign = 'center';
  ctx.font = '46px sans-serif';
  ctx.fillText(opts.kind === 'certificate' ? '🏆' : '📉', w / 2, 92);

  ctx.fillStyle = '#ffffff';
  ctx.font = "700 28px 'Segoe UI', Arial, sans-serif";
  ctx.fillText(opts.title, w / 2, 134);

  ctx.fillStyle = '#9aa0c0';
  ctx.font = "14px 'Segoe UI', Arial, sans-serif";
  ctx.fillText(opts.subtitle, w / 2, 158);

  ctx.strokeStyle = accent;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(w / 2 - 70, 174);
  ctx.lineTo(w / 2 + 70, 174);
  ctx.stroke();

  ctx.textAlign = 'left';
  const startY = 212;
  const rowH = 58;
  const colX = [64, w / 2 + 20];
  opts.rows.forEach((row, i) => {
    const col = i % 2;
    const line = Math.floor(i / 2);
    const x = colX[col];
    const y = startY + line * rowH;
    ctx.fillStyle = '#9aa0c0';
    ctx.font = "12px 'Segoe UI', Arial, sans-serif";
    ctx.fillText(row.label, x, y);
    ctx.fillStyle = row.color || '#ffffff';
    ctx.font = "700 17px 'Segoe UI', Arial, sans-serif";
    ctx.fillText(row.value, x, y + 22);
  });

  ctx.textAlign = 'center';
  ctx.fillStyle = '#6b7094';
  ctx.font = "11px 'Segoe UI', Arial, sans-serif";
  ctx.fillText(opts.footer, w / 2, h - 32);
}

function downloadCanvasAsPng(canvas, filename) {
  const link = document.createElement('a');
  link.download = filename;
  link.href = canvas.toDataURL('image/png');
  link.click();
}

/** Statistiques de trades (gains/pertes/win-rate/etc.) à partir des trades clôturés du run. */
function computeTradeStats(closed) {
  const wins = closed.filter(t => t.pnl > 0);
  const losses = closed.filter(t => t.pnl <= 0);
  const sum = arr => arr.reduce((a, t) => a + t.pnl, 0);
  const avgWin = wins.length ? sum(wins) / wins.length : 0;
  const avgLoss = losses.length ? sum(losses) / losses.length : 0;
  const biggestLoss = losses.length ? Math.min(...losses.map(t => t.pnl)) : 0;
  const winRate = closed.length ? (wins.length / closed.length) * 100 : 0;
  return { wins: wins.length, losses: losses.length, winRate, avgWin, avgLoss, biggestLoss };
}

function showPropFirmCertificate() {
  const s = propFirmState;
  const modal = document.getElementById('pf-certificate-modal');
  const canvas = document.getElementById('pf-cert-canvas');
  if (!modal || !canvas) return;
  const firmLabel = (PROPFIRM_PRESETS[s.preset] && PROPFIRM_PRESETS[s.preset].label) || 'Défi personnalisé';
  const name = s.traderName?.trim() || 'Trader';
  renderPfReportCanvas(canvas, {
    kind: 'certificate',
    title: 'CERTIFICAT DE RÉUSSITE',
    subtitle: `Décerné à ${name}`,
    rows: [
      { label: 'FIRME / CHALLENGE', value: firmLabel },
      { label: 'DATE DE RÉUSSITE', value: new Date().toLocaleDateString('fr-FR') },
      { label: 'CAPITAL DE DÉPART', value: formatUsd(s.startingBalance) },
      { label: 'SOLDE FINAL', value: formatUsd(s.balance), color: '#00d9a3' },
      { label: 'PROFIT RÉALISÉ', value: `+${s.profitPct.toFixed(2)}%`, color: '#00d9a3' },
      { label: 'JOURS DE TRADING', value: `${s.tradingDaysCount}` }
    ],
    footer: 'Certificat généré automatiquement par l\'application — à des fins de suivi personnel uniquement.'
  });
  modal.classList.add('visible');
}

function showPropFirmLossAnalysis() {
  const s = propFirmState;
  const modal = document.getElementById('pf-loss-modal');
  const canvas = document.getElementById('pf-loss-canvas');
  const tipsEl = document.getElementById('pf-loss-tips');
  if (!modal || !canvas) return;
  const stats = computeTradeStats(s.closedTrades || []);
  renderPfReportCanvas(canvas, {
    kind: 'loss',
    title: 'ANALYSE DU CHALLENGE ÉCHOUÉ',
    subtitle: s.failReason || 'Règle du challenge non respectée',
    rows: [
      { label: 'SOLDE FINAL', value: formatUsd(s.balance), color: '#ff4d6d' },
      { label: 'RÉSULTAT', value: `${s.profitPct >= 0 ? '+' : ''}${s.profitPct.toFixed(2)}%`, color: '#ff4d6d' },
      { label: 'PIRE PERTE QUOTIDIENNE', value: `${s.worstDayLossPct.toFixed(2)}%`, color: '#ff4d6d' },
      { label: 'DRAWDOWN ATTEINT', value: `${s.currentDrawdownPct.toFixed(2)}%`, color: '#ff4d6d' },
      { label: 'TRADES GAGNANTS', value: `${stats.wins} (${stats.winRate.toFixed(0)}% win rate)` },
      { label: 'TRADES PERDANTS', value: `${stats.losses}` },
      { label: 'GAIN MOYEN', value: formatUsd(stats.avgWin), color: '#00d9a3' },
      { label: 'PERTE MOYENNE', value: formatUsd(stats.avgLoss), color: '#ff4d6d' }
    ],
    footer: 'Analyse générée automatiquement à partir des trades clôturés de ce run.'
  });

  // Quelques pistes génériques pour la prochaine tentative — texte HTML (pas dans l'image, pour
  // rester lisible/évolutif sans avoir à régénérer le rendu canvas).
  if (tipsEl) {
    const tips = [];
    if (s.failReason?.includes('quotidienne')) {
      tips.push('Réduis la taille de tes positions pour qu\'une seule mauvaise journée ne dépasse pas la limite quotidienne.');
    }
    if (s.failReason?.includes('Drawdown')) {
      tips.push('Espace davantage tes prises de position et évite d\'enchaîner les trades après une perte (revenge trading).');
    }
    if (stats.losses > 0 && Math.abs(stats.avgLoss) > stats.avgWin * 1.5) {
      tips.push('Tes pertes moyennes sont nettement plus grosses que tes gains moyens : resserre tes stops ou vise un meilleur ratio risque/récompense.');
    }
    if (stats.winRate < 40 && stats.wins + stats.losses >= 5) {
      tips.push('Ton taux de réussite est bas : revois tes critères d\'entrée avant la prochaine tentative.');
    }
    if (!tips.length) tips.push('Revois le journal de tes trades clôturés pour identifier le moment précis où la règle a été cassée, puis ajuste ta gestion du risque avant de retenter le challenge.');
    tipsEl.innerHTML = tips.map(t => `<li>${t}</li>`).join('');
  }

  modal.classList.add('visible');
}

function setupPfReportModals() {
  const certModal = document.getElementById('pf-certificate-modal');
  const lossModal = document.getElementById('pf-loss-modal');
  document.getElementById('pf-cert-close')?.addEventListener('click', () => certModal.classList.remove('visible'));
  document.getElementById('pf-cert-download')?.addEventListener('click', () => {
    downloadCanvasAsPng(document.getElementById('pf-cert-canvas'), 'certificat-propfirm.png');
  });
  certModal?.addEventListener('mousedown', (e) => { if (e.target === certModal) certModal.classList.remove('visible'); });

  document.getElementById('pf-loss-close')?.addEventListener('click', () => lossModal.classList.remove('visible'));
  document.getElementById('pf-loss-download')?.addEventListener('click', () => {
    downloadCanvasAsPng(document.getElementById('pf-loss-canvas'), 'analyse-perte-propfirm.png');
  });
  lossModal?.addEventListener('mousedown', (e) => { if (e.target === lossModal) lossModal.classList.remove('visible'); });
}

let tradeToastTimer = null;
function showTradeToast(message, kind) {
  const el = document.getElementById('trade-toast');
  if (!el) return;
  el.textContent = message;
  el.className = 'trade-toast visible ' + (kind === 'target' ? 'target' : 'stop');
  if (tradeToastTimer) clearTimeout(tradeToastTimer);
  tradeToastTimer = setTimeout(() => { el.classList.remove('visible'); }, 3200);
  if (APP_SETTINGS.replay.sound) playAlertSound(kind);
}

// NOUVEAU : bip généré en WebAudio (pas de fichier externe requis par la CSP) pour les
// alertes Stop (grave) / Take Profit (aigu) en mode replay, activable dans Paramètres > Replay.
let alertAudioCtx = null;
function playAlertSound(kind) {
  try {
    if (!alertAudioCtx) alertAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const ctx = alertAudioCtx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = kind === 'target' ? 880 : 220;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.4);
  } catch { /* audio indisponible : on ignore silencieusement */ }
}

// NOUVEAU : rendu Position longue / courte (style TradingView)
// Zones risque (rouge) et récompense (vert) + lignes entrée/stop/cible + ratio R:R
function drawPositionTool(ctx, pane, series, ts, d) {
  const x1 = ts.timeToCoordinate(d.entryTime);
  const yEntry = series.priceToCoordinate(d.entryPrice);
  const yStop = series.priceToCoordinate(d.stopPrice);
  const yTarget = series.priceToCoordinate(d.targetPrice);
  if ([x1, yEntry, yStop, yTarget].some(v => v === null)) return;

  // CORRECTIF : d.endTime (~20 bougies après l'entrée) tombe souvent hors de la plage que
  // timeToCoordinate() sait convertir (ex. entrée proche de la dernière bougie chargée) — il
  // renvoyait alors null et annulait TOUT le rendu de la position (rien ne s'affichait, alors
  // que le dessin existait bien en mémoire). On retombe sur une largeur fixe en pixels dans ce
  // cas, comme le fait déjà l'aperçu élastique pendant le placement.
  let x2 = ts.timeToCoordinate(d.endTime);
  if (x2 === null) x2 = x1 + Math.max(80, pane.inner.clientWidth * 0.12);

  const rx = Math.min(x1, x2);
  const rw = Math.max(4, Math.abs(x2 - x1));
  const isLong = d.type === 'longPosition';

  // Couleurs TradingView-like — désormais personnalisables indépendamment (stop / objectif),
  // comme le panneau de propriétés natif de TradingView ("Couleur du stop" / "Couleur de
  // l'objectif"). Rétrocompatible : sans couleur explicite, on retombe sur les teintes par défaut.
  const riskStroke = d.stopColor || d.color || '#ef5350';
  const rewardStroke = d.targetColor || '#26a69a';
  // CORRECTIF : riskStroke/rewardStroke peuvent maintenant être des rgba() (opacité de bordure
  // choisie via la jauge de la palette). hexToRgba(rgba(...), x) multipliait alors les deux
  // opacités en cascade (ex: bordure à 40% -> fond à x*0.4, imprévisible). Le fond des zones
  // isole désormais la teinte de base (sans alpha) avant de lui appliquer l'opacité, ET cette
  // opacité est réglable par dessin (d.fillOpacity, via la jauge dcm-fillopacity) au lieu
  // d'être fixée en dur à 0.22 — indépendamment de l'opacité choisie pour la bordure.
  const riskFill = hexToRgba(parseColorToHexAlpha(riskStroke).hex, d.fillOpacity ?? 0.22);
  const rewardFill = hexToRgba(parseColorToHexAlpha(rewardStroke).hex, d.fillOpacity ?? 0.22);
  const entryColor = d.color || '#d1d4dc';

  // Zone risque (entre entrée et stop)
  const riskTop = Math.min(yEntry, yStop);
  const riskH = Math.abs(yStop - yEntry);
  ctx.fillStyle = riskFill;
  ctx.fillRect(rx, riskTop, rw, riskH);
  ctx.strokeStyle = riskStroke;
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  ctx.strokeRect(rx, riskTop, rw, riskH);

  // Zone récompense (entre entrée et cible)
  const rewardTop = Math.min(yEntry, yTarget);
  const rewardH = Math.abs(yTarget - yEntry);
  ctx.fillStyle = rewardFill;
  ctx.fillRect(rx, rewardTop, rw, rewardH);
  ctx.strokeStyle = rewardStroke;
  ctx.strokeRect(rx, rewardTop, rw, rewardH);

  // Ligne d'entrée
  ctx.strokeStyle = entryColor;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(rx, yEntry);
  ctx.lineTo(rx + rw, yEntry);
  ctx.stroke();

  // Ligne stop
  ctx.strokeStyle = riskStroke;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(rx, yStop);
  ctx.lineTo(rx + rw, yStop);
  ctx.stroke();
  ctx.setLineDash([]);

  // Ligne cible
  ctx.strokeStyle = rewardStroke;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(rx, yTarget);
  ctx.lineTo(rx + rw, yTarget);
  ctx.stroke();
  ctx.setLineDash([]);

  // Calcul risque / récompense / ratio
  const risk = Math.abs(d.entryPrice - d.stopPrice);
  const reward = Math.abs(d.targetPrice - d.entryPrice);
  const rr = risk > 0 ? reward / risk : 0;
  // NOUVEAU : distances affichées EN PIPS UNIQUEMENT (plus lisible qu'un mélange
  // prix/distance/pourcentage — simplification demandée : le prix brut, la distance en devise et
  // le pourcentage sont retirés des étiquettes Stop/Cible, qui ne montrent plus que l'essentiel).
  const riskPips = Math.abs(priceToPips(d.entryPrice - d.stopPrice));
  const rewardPips = Math.abs(priceToPips(d.targetPrice - d.entryPrice));

  // Étiquettes — simplifiées : Entrée garde son prix (référence utile), Stop/Cible n'affichent
  // plus que les pips.
  const labelX = rx + rw + 6;
  drawLabelBox(ctx, labelX, yEntry, `Entrée ${formatPriceLabel(d.entryPrice)}`, entryColor, 'left');
  drawLabelBox(ctx, labelX, yStop, `Stop  −${riskPips.toFixed(1)} pips`, riskStroke, 'left');
  drawLabelBox(ctx, labelX, yTarget, `Cible  +${rewardPips.toFixed(1)} pips`, rewardStroke, 'left');

  // Badge R:R + taille + PnL au centre de la zone
  const midY = (Math.min(yEntry, yStop, yTarget) + Math.max(yEntry, yStop, yTarget)) / 2;
  const qty = Number(d.quantity) > 0 ? Number(d.quantity) : 1;
  // Prix de marque : dernière close agrégée de la pane
  const mark = pane.lastAggregated?.length
    ? pane.lastAggregated[pane.lastAggregated.length - 1].close
    : d.entryPrice;
  const pnlInfo = computePositionPnl(d, mark);
  let rrText = `${isLong ? 'Long' : 'Short'} ×${formatQty(qty)}  ·  R:R 1:${rr.toFixed(2)}`;
  if (d._hitStatus === 'stop') {
    const p = pnlInfo ? `  ·  PnL ${pnlInfo.pnl >= 0 ? '+' : ''}${formatPriceLabel(pnlInfo.pnl)}` : '';
    rrText = `⛔ STOP  ×${formatQty(qty)}${p}`;
  } else if (d._hitStatus === 'target') {
    const p = pnlInfo ? `  ·  PnL ${pnlInfo.pnl >= 0 ? '+' : ''}${formatPriceLabel(pnlInfo.pnl)}` : '';
    rrText = `✅ TP  ×${formatQty(qty)}${p}`;
  } else if (pnlInfo) {
    const sign = pnlInfo.pnl >= 0 ? '+' : '';
    rrText += `  ·  uPnL ${sign}${formatPriceLabel(pnlInfo.pnl)}`;
  }
  // Risque monétaire (qty × distance stop) — SUPPRIMÉ : redondant avec les pips affichés
  // ci-dessus et le badge R:R ci-dessous (simplification demandée).
  const badgeColor = d._hitStatus === 'stop' ? riskStroke
    : d._hitStatus === 'target' ? rewardStroke
    : (isLong ? rewardStroke : riskStroke);
  drawLabelBox(ctx, rx + rw / 2, midY, rrText, badgeColor, 'center');

  // Texte custom optionnel
  if (d.text) {
    drawLabelBox(ctx, rx + 4, Math.min(yEntry, yStop, yTarget) - 12, d.text, entryColor, 'left');
  }

  // Poignées aux 3 niveaux sur le bord gauche
  drawHandle(ctx, rx, yEntry, entryColor);
  drawHandle(ctx, rx, yStop, riskStroke);
  drawHandle(ctx, rx, yTarget, rewardStroke);
}

