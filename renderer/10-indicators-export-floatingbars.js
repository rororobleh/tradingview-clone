// ============================================================
// 10-indicators-export-floatingbars.js
// Indicateurs (Volume + SMA), export PNG, barres flottantes déplaçables (favoris + replay)
// Fait partie de renderer.js (sectionné en modules le 2026-08-28).
// Chargé comme <script> classique dans index.html : les variables/fonctions
// top-level restent globales et partagées entre tous ces fichiers, exactement
// comme dans l'ancien renderer.js monolithique — aucun changement de comportement.
// ============================================================
// ============ Indicateurs (Volume + SMA) & export PNG ============
function persistIndicatorState() {
  localStorage.setItem('ind_volume', indicatorState.volume ? '1' : '0');
  for (const p of [20, 50, 200]) {
    localStorage.setItem('ind_sma' + p, indicatorState.sma[p] ? '1' : '0');
  }
  for (const p of [9, 21]) {
    localStorage.setItem('ind_ema' + p, indicatorState.ema[p] ? '1' : '0');
  }
}

function applyIndicatorsToAllPanes() {
  panes.forEach(pane => {
    if (pane.volumeSeries) pane.volumeSeries.applyOptions({ visible: indicatorState.volume });
  });
  // SMA recalculées depuis les données (filtre replay inclus) sans recentrer le graphique
  refreshAllPanes({ fit: false });
}

function setupIndicatorsMenu() {
  const toggleBtn = document.getElementById('btn-indicators-toggle');
  const menu = document.getElementById('indicators-menu');
  if (!toggleBtn || !menu) return;
  toggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const willShow = !menu.classList.contains('visible');
    if (willShow) {
      const r = toggleBtn.getBoundingClientRect();
      menu.style.top = `${r.bottom + 4}px`;
      menu.style.left = `${r.left}px`;
    }
    menu.classList.toggle('visible', willShow);
  });
  document.addEventListener('click', (e) => {
    if (!menu.contains(e.target) && e.target !== toggleBtn && !toggleBtn.contains(e.target)) {
      menu.classList.remove('visible');
    }
  });
}

function setupIndicatorsAndExport() {
  setupIndicatorsMenu(); // NOUVEAU : Volume/SMA/EMA regroupés dans un panneau icônes (▾ toolbar)
  const volBtn = document.getElementById('btn-volume');
  if (volBtn) {
    volBtn.classList.toggle('active', indicatorState.volume);
    volBtn.addEventListener('click', () => {
      indicatorState.volume = !indicatorState.volume;
      volBtn.classList.toggle('active', indicatorState.volume);
      persistIndicatorState();
      applyIndicatorsToAllPanes();
    });
  }
  for (const period of [20, 50, 200]) {
    const btn = document.getElementById('btn-sma' + period);
    if (!btn) continue;
    btn.classList.toggle('active', !!indicatorState.sma[period]);
    btn.addEventListener('click', () => {
      indicatorState.sma[period] = !indicatorState.sma[period];
      btn.classList.toggle('active', indicatorState.sma[period]);
      persistIndicatorState();
      applyIndicatorsToAllPanes();
    });
  }
  for (const period of [9, 21]) {
    const btn = document.getElementById('btn-ema' + period);
    if (!btn) continue;
    btn.classList.toggle('active', !!indicatorState.ema[period]);
    btn.addEventListener('click', () => {
      indicatorState.ema[period] = !indicatorState.ema[period];
      btn.classList.toggle('active', indicatorState.ema[period]);
      persistIndicatorState();
      applyIndicatorsToAllPanes();
    });
  }

  // NOUVEAU : type de graphique
  const typeSelect = document.getElementById('chart-type');
  if (typeSelect) {
    typeSelect.value = chartType;
    typeSelect.addEventListener('change', () => {
      chartType = typeSelect.value;
      localStorage.setItem('chartType', chartType);
      // Recrée les panes pour changer le type de série (lightweight-charts ne permet pas de
      // muter CandlestickSeries → LineSeries in-place).
      // setLayout() détruit/recrée les panes (createMainSeries lit chartType), et préserve déjà
      // en interne timeframe + dessins de chaque pane (à partir de `panes`, avant destruction) —
      // pas besoin de le refaire ici.
      setLayout(currentLayout);
    });
  }

  // NOUVEAU : aimant
  const magnetBtn = document.getElementById('btn-magnet');
  if (magnetBtn) {
    magnetBtn.classList.toggle('active', magnetEnabled);
    magnetBtn.addEventListener('click', () => {
      magnetEnabled = !magnetEnabled;
      localStorage.setItem('magnet', magnetEnabled ? '1' : '0');
      magnetBtn.classList.toggle('active', magnetEnabled);
    });
  }

  // NOUVEAU : sync multi-panes
  const syncBtn = document.getElementById('btn-sync-panes');
  if (syncBtn) {
    syncBtn.classList.toggle('active', syncPanesEnabled);
    syncBtn.addEventListener('click', () => {
      syncPanesEnabled = !syncPanesEnabled;
      localStorage.setItem('syncPanes', syncPanesEnabled ? '1' : '0');
      syncBtn.classList.toggle('active', syncPanesEnabled);
    });
  }

  // NOUVEAU : aide raccourcis
  const helpModal = document.getElementById('help-modal');
  document.getElementById('btn-help')?.addEventListener('click', () => helpModal?.classList.add('visible'));
  document.getElementById('help-close')?.addEventListener('click', () => helpModal?.classList.remove('visible'));
  helpModal?.addEventListener('click', (e) => { if (e.target === helpModal) helpModal.classList.remove('visible'); });

  document.getElementById('btn-screenshot')?.addEventListener('click', () => {
    const pane = panes[activePaneIndex];
    if (!pane?.chart) return;
    try {
      // include top layer (primitives de dessin maison)
      const canvas = pane.chart.takeScreenshot(true);
      const link = document.createElement('a');
      const name = (currentFilePath ? currentFilePath.split(/[\\/]/).pop().replace(/\.csv$/i, '') : 'chart')
        + '_' + (TF_LABELS[pane.timeframe] || pane.timeframe + 'm') + '.png';
      link.download = name;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch (err) {
      console.error('Export PNG échoué :', err);
      updateTitlebar(null, 'Export PNG impossible : ' + (err.message || err));
    }
  });
}

// ============ NOUVEAU : barres flottantes déplaçables (favoris + replay) ============
function makeDraggable(el, gripEl, storageKey) {
  // Restaure la position sauvegardée
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (saved) { el.style.left = saved.left; el.style.top = saved.top; el.style.right = 'auto'; }
  } catch { /* pas de position sauvegardée */ }

  let dragging = false, startX = 0, startY = 0, startLeft = 0, startTop = 0;

  gripEl.addEventListener('mousedown', (e) => {
    dragging = true;
    const parentRect = el.parentElement.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    startX = e.clientX; startY = e.clientY;
    startLeft = elRect.left - parentRect.left;
    startTop = elRect.top - parentRect.top;
    el.style.left = `${startLeft}px`;
    el.style.top = `${startTop}px`;
    el.style.right = 'auto';
    e.preventDefault();
  });

  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const parentRect = el.parentElement.getBoundingClientRect();
    let left = startLeft + (e.clientX - startX);
    let top = startTop + (e.clientY - startY);
    left = Math.max(0, Math.min(left, parentRect.width - el.offsetWidth));
    top = Math.max(0, Math.min(top, parentRect.height - el.offsetHeight));
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  });

  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    localStorage.setItem(storageKey, JSON.stringify({ left: el.style.left, top: el.style.top }));
  });
}

function setupFloatingBars() {
  makeDraggable(document.getElementById('floating-toolbar'), document.querySelector('#floating-toolbar .ft-grip'), 'floatingToolbarPos');
  makeDraggable(document.getElementById('replay-bar'), document.querySelector('#replay-bar .rb-grip'), 'replayBarPos');
}

