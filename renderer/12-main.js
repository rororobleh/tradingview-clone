// ============================================================
// 12-main.js
// Point d'entrée : IIFE main() qui initialise l'application, raccourcis clavier, redimensionnement, ouverture de fichiers
// Fait partie de renderer.js (sectionné en modules le 2026-08-28).
// Chargé comme <script> classique dans index.html : les variables/fonctions
// top-level restent globales et partagées entre tous ces fichiers, exactement
// comme dans l'ancien renderer.js monolithique — aucun changement de comportement.
// ============================================================
(async function main() {
  if (!window.api) {
    updateTitlebar(null, "window.api est introuvable — lance l'app avec 'npm start' (Electron), pas en ouvrant index.html dans un navigateur.");
    console.error("window.api absent : preload.js n'a pas été chargé. L'app doit tourner dans Electron.");
    return;
  }
  if (typeof LightweightCharts === 'undefined') {
    const msg = "lightweight-charts introuvable — exécute 'npm install' dans le dossier du projet, puis relance 'npm start'.";
    updateTitlebar(null, msg);
    console.error(msg);
    const grid = document.getElementById('chart-grid');
    if (grid) {
      grid.innerHTML = '<div style="padding:24px;color:#ef5350;font-size:14px;max-width:520px;line-height:1.5">' +
        '<strong>Dépendances manquantes</strong><br><br>' +
        'Le module <code>lightweight-charts</code> n\'est pas installé (node_modules incomplet).<br><br>' +
        'Dans un terminal :<br>' +
        '<code style="background:#1e222d;padding:8px 12px;display:inline-block;margin-top:8px;border-radius:4px">npm install && npm start</code>' +
        '</div>';
    }
    return;
  }

  loadCustomThemeOverrides(); // NOUVEAU : réapplique les couleurs personnalisées sauvegardées
  populateThemeSelects(); // NOUVEAU : remplit les sélecteurs de thème (toolbar + Paramètres)
  applyLanguage(); // NOUVEAU : applique la langue d'interface sauvegardée (FR/EN)
  applyTheme(currentTheme);
  applyAppearance(); // NOUVEAU : police / densité / arrondi / grille / filigrane
  restartAutosaveTimer(); // NOUVEAU : sauvegarde automatique du workspace si activée
  setupDragAndDrop();
  setupSidebarTools();
  setupLayoutButtons();
  setupTimeframeBar();
  setupWorkspaceButtons();
  setupColorPanel(); // NOUVEAU : panneau de personnalisation des couleurs
  setupSettingsModal(); // NOUVEAU : panneau Paramètres (apparence, graphique, replay, général)
  setupIndicatorsAndExport(); // Volume, SMA, export PNG
  setupFloatingBars(); // NOUVEAU : barre d'outils favoris + barre de replay (déplaçables)
  setupReplayBar(); // NOUVEAU : contrôles du mode replay (backtesting)
  setupZoomControls(); // NOUVEAU : boutons de zoom +/- et réinitialisation (bas du graphique)
  setupPropFirmModal(); // NOUVEAU : mode Prop Firm (capital, objectifs, règles de trading)
  setupDrawingContextMenu(); // NOUVEAU : menu flottant (configurer/supprimer) au clic sur un dessin
  setupDrawingDragListeners(); // Déplacement / resize des dessins et positions
  await loadDrawingTemplatesFromDisk(); // FIX : chargait jamais → drawingTemplates restait vide
  await loadStyleTemplatesFromDisk(); // FIX : chargait jamais → styleTemplates restait vide
  setupTemplatesMenu(); // FIX : jamais appelée → #btn-templates-toggle n'avait aucun listener
  setupDrawingStyleMenu(); // FIX : jamais appelée → #dcm-style-btn n'avait aucun listener
  loadDrawingLib(); // NOUVEAU : charge lightweight-charts-drawing en arrière-plan (n'bloque pas le démarrage)

  document.getElementById('error-modal-close').addEventListener('click', closeErrorModal);
  document.getElementById('error-modal').addEventListener('click', (e) => {
    if (e.target.id === 'error-modal') closeErrorModal();
  });

  document.addEventListener('keydown', (e) => {
    // Ne pas intercepter si l'utilisateur saisit du texte
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable) return;

    if (e.key === 'Escape') {
      if (currentTool || advTool) setTool(null);
      if (dragState) endDrawingDrag();
      clearDrawingSelection();
      document.getElementById('help-modal')?.classList.remove('visible');
    }
    // NOUVEAU : Entrée termine un tracé de zigzag en cours (nombre de points libre), en
    // alternative au double-clic — pratique quand le dernier point doit rester sous la souris.
    if (e.key === 'Enter' && currentTool === 'zigzagArrow') {
      e.preventDefault();
      finishZigzagDrawing(panes[activePaneIndex]);
    }
    // Suppr / Backspace : efface le dessin sélectionné (s'il n'est pas verrouillé)
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedDrawing) {
      if (!selectedDrawing.drawing.locked) {
        const { pane, drawing } = selectedDrawing;
        removeDrawing(pane, drawing);
        hideDrawingMenu();
      }
      e.preventDefault();
    }
    // V : toggle volume
    if (e.key === 'v' || e.key === 'V') {
      document.getElementById('btn-volume')?.click();
    }
    // M : toggle aimant
    if (e.key === 'm' || e.key === 'M') {
      document.getElementById('btn-magnet')?.click();
    }
    // ? : aide
    if (e.key === '?' || (e.shiftKey && e.key === '/')) {
      document.getElementById('help-modal')?.classList.add('visible');
    }
    // Ctrl/Cmd+Z : undo ; Ctrl/Cmd+Shift+Z ou Ctrl/Cmd+Y : redo
    if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      if (e.shiftKey) redoLastDrawing();
      else undoLastDrawing();
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) {
      e.preventDefault();
      redoLastDrawing();
    }
  });

  window.addEventListener('resize', () => {
    panes.forEach(p => {
      p.chart.applyOptions({ width: p.inner.clientWidth, height: p.inner.clientHeight });
      redrawPane(p);
    });
  });

  const recentList = await window.api.getRecentFiles();
  populateRecentDropdown(recentList);

  const restored = await restoreWorkspace();
  if (!restored) {
    setLayout(APP_SETTINGS.chart.defaultLayout || '1x1');
    const defaultPath = 'data/eurusd.csv';
    const rawCsv = await window.api.readCsvFile(defaultPath);
    if (rawCsv) {
      await loadCsvFromPath(defaultPath, { skipHistory: true });
    } else {
      rawCandleData = generateMockData(300);
      baseTimeframeSeconds = detectBaseTimeframeSeconds(rawCandleData);
      priceFormat = detectPriceFormat(rawCandleData);
      applyPriceFormatToAllPanes(priceFormat);
      resetReplayForNewData();
      await refreshAllPanes();
      updateTitlebar('Données fictives (mock)', null);
      updateTitlebarForPane(panes[activePaneIndex]);
    }
  }

  async function openCsvViaDialog() {
    try {
      const filePath = await window.api.openCsvDialog();
      if (filePath) loadCsvFromPath(filePath);
    } catch (err) {
      console.error('Erreur ouverture dialogue CSV :', err);
      updateTitlebar(null, `Impossible d'ouvrir le sélecteur de fichier : ${err.message}`);
    }
  }
  document.getElementById('btn-load-csv').addEventListener('click', openCsvViaDialog);
  // NOUVEAU : raccourci "Fichier > Ouvrir un CSV..." (Ctrl/Cmd+O) du menu applicatif (main.js)
  window.api.onOpenCsvMenu?.(openCsvViaDialog);

  document.getElementById('recent-dropdown').addEventListener('change', (e) => {
    const filePath = e.target.value;
    if (filePath) loadCsvFromPath(filePath);
  });

  document.getElementById('theme-select')?.addEventListener('change', (e) => applyTheme(e.target.value));
})();