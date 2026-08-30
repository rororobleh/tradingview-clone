// ============================================================
// 09-csv-toolbars-workspace.js
// Chargement CSV, drag & drop, barres d'outils (sidebar, timeframe, layout), persistance du workspace (dessins/panes), restauration au démarrage
// Fait partie de renderer.js (sectionné en modules le 2026-08-28).
// Chargé comme <script> classique dans index.html : les variables/fonctions
// top-level restent globales et partagées entre tous ces fichiers, exactement
// comme dans l'ancien renderer.js monolithique — aucun changement de comportement.
// ============================================================
// ============ Chargement CSV ============
async function loadCsvFromPath(filePath, opts = {}) {
  showLoading('Lecture du fichier...');

  // Mémorise les dessins du fichier précédent avant de basculer
  if (!opts.skipDrawingRestore && currentFilePath && currentFilePath !== filePath) {
    stashCurrentFileDrawings();
  }

  // Empêche un auto-save concurrent d'écrire un état mi-migré pendant le chargement
  const prevRestoring = workspaceRestoring;
  workspaceRestoring = true;

  // NOUVEAU : sonde la taille avant de charger le contenu en mémoire, pour donner un retour
  // visuel honnête sur les gros fichiers (le spinner générique laissait croire à un blocage).
  const fileSize = await window.api.getCsvFileSize?.(filePath);
  if (fileSize && fileSize > LARGE_FILE_WARN_BYTES) {
    showLoading(`Lecture d'un gros fichier (${formatBytes(fileSize)})... cela peut prendre un moment`);
  }

  const rawCsv = await window.api.readCsvFile(filePath);

  try {
  if (!rawCsv) {
    updateTitlebar(null, 'Impossible de lire le fichier');
    return;
  }

    const { data, skipped, skippedDetails } = await parseCsvInWorker(rawCsv, (percent) => {
      document.getElementById('loading-text').textContent = `Analyse du CSV... ${percent}%`;
    });

    lastSkippedDetails = skippedDetails || [];
    rawCandleData = data;
    baseTimeframeSeconds = detectBaseTimeframeSeconds(data);
    priceFormat = detectPriceFormat(data);
    applyPriceFormatToAllPanes(priceFormat);
    currentFilePath = filePath;
    resetReplayForNewData();

    // TF adapté à la résolution native (ex. CSV journalier → 1D, pas 5m)
    let suggestedTf = suggestTimeframeMinutes(baseTimeframeSeconds);
    // NOUVEAU : le TF par défaut choisi dans Paramètres > Graphique prime s'il reste
    // compatible avec la résolution native du fichier (jamais plus fin que les données sources)
    const preferredTf = Number(APP_SETTINGS.chart.defaultTimeframe) || 0;
    if (preferredTf > 0 && preferredTf * 60 >= baseTimeframeSeconds) {
      suggestedTf = preferredTf;
    }

    // Restaure layout + dessins de CE fichier (s'ils existent) avant le setData
    if (!opts.skipDrawingRestore) {
      const cached = drawingsByFile[filePath];
      // CORRECTIF : au premier démarrage (panes encore vide, ex. après restoreWorkspace()),
      // il faut appeler setLayout() même si le layout en cache est identique au défaut
      // ('1x1' === currentLayout) — sinon aucune pane n'est jamais créée et le graphique
      // reste vide tant que l'utilisateur ne clique pas manuellement sur un bouton de disposition.
      if (panes.length === 0 || (cached?.layout && cached.layout !== currentLayout)) {
        setLayout(cached?.layout || currentLayout);
      }
      // Si le cache a des timeframes sauvegardés, applyPanesState les posera plus bas ;
      // sinon on applique le TF suggéré sur toutes les grilles.
      if (!cached?.panes?.length) {
        panes.forEach(p => { p.timeframe = suggestedTf; });
        updateTimeframeButtons(suggestedTf);
      }
    } else {
      panes.forEach(p => { p.timeframe = suggestedTf; });
      updateTimeframeButtons(suggestedTf);
    }

    await refreshAllPanes();

    // Attache les dessins APRÈS que les séries aient des données (coordonnées valides)
    if (!opts.skipDrawingRestore) {
      const cached = drawingsByFile[filePath];
      if (cached?.panes) {
        applyPanesState(cached.panes);
      } else {
        // Pas de cache : nettoie les dessins d'un éventuel fichier précédent restés en mémoire
        // (sauf si on vient d'un restoreWorkspace qui a déjà posé les panes)
        if (opts.clearDrawingsIfNoCache) {
          panes.forEach(p => {
            p.drawings.forEach(d => {
              try {
                if (d.type === 'horizontal' && d.priceLine) p.series.removePriceLine(d.priceLine);
                else if (d._primitive) p.series.detachPrimitive(d._primitive);
              } catch {}
            });
            p.drawings = [];
          });
        }
      }
    }

    updateTitlebar(window.api.getFileName(filePath), null);
    updateTitlebarForPane(panes[activePaneIndex]);

    // NOUVEAU (fix reprise de session) : reprend le replay là où l'utilisateur l'avait laissé sur
    // ce fichier, plutôt que de forcer un retour à zéro (voir resetReplayForNewData() plus haut).
    if (!opts.skipDrawingRestore) {
      const cachedReplay = drawingsByFile[filePath]?.replay;
      if (cachedReplay?.enabled) await restoreReplayForFile(cachedReplay);
    }

    if (!opts.skipHistory) {
      const updatedList = await window.api.addRecentFile(filePath);
      populateRecentDropdown(updatedList);
    }

    // (save reportée après finally — scheduleWorkspaceSave est no-op pendant restoring)
  } catch (err) {
    updateTitlebar(null, err.message);
    if (!panes.length || !rawCandleData.length) {
      rawCandleData = generateMockData(300);
      baseTimeframeSeconds = detectBaseTimeframeSeconds(rawCandleData);
      priceFormat = detectPriceFormat(rawCandleData);
      applyPriceFormatToAllPanes(priceFormat);
      resetReplayForNewData();
      await refreshAllPanes();
    }
  } finally {
    workspaceRestoring = prevRestoring;
    hideLoading();
  }
  // Maintenant que restoring est levé : enregistre l'état (filePath + dessins)
  if (!opts.skipDrawingRestore) scheduleWorkspaceSave();
}

function populateRecentDropdown(list) {
  const select = document.getElementById('recent-dropdown');
  select.innerHTML = '<option value="">🕑 Fichiers récents</option>';
  for (const filePath of list) {
    const opt = document.createElement('option');
    opt.value = filePath;
    opt.textContent = filePath.split(/[\\/]/).pop();
    select.appendChild(opt);
  }
}

// ============ Drag & drop ============
function setupDragAndDrop() {
  let dragCounter = 0;
  document.addEventListener('dragenter', (e) => { e.preventDefault(); dragCounter++; showDropOverlay(true); });
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('dragleave', (e) => { e.preventDefault(); dragCounter--; if (dragCounter <= 0) { dragCounter = 0; showDropOverlay(false); } });
  document.addEventListener('drop', (e) => {
    e.preventDefault(); dragCounter = 0; showDropOverlay(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.csv')) { updateTitlebar(null, 'Seuls les fichiers .csv sont acceptés'); return; }
    const filePath = window.api.getPathForFile(file);
    if (filePath) loadCsvFromPath(filePath);
  });
}

// ============ Toolbars ============
function updateTimeframeButtons(activeMinutes) {
  const tf = Number(activeMinutes);
  let matchedInMore = false;
  document.querySelectorAll('.tf-btn[data-tf]').forEach(b => {
    const v = parseInt(b.dataset.tf, 10);
    const on = v === tf;
    b.classList.toggle('active', on);
    if (on && b.closest('#tf-more-menu')) matchedInMore = true;
  });
  // Indique que le TF actif est dans le sous-menu
  document.getElementById('tf-more-btn')?.classList.toggle('active', matchedInMore);
}

function setupTimeframeBar() {
  // REDESIGN (délégation d'événements) : un seul listener sur le document plutôt qu'un
  // addEventListener par bouton — indispensable pour que les timeframes personnalisées
  // ajoutées dynamiquement (bouton "+") fonctionnent sans code supplémentaire.
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.tf-btn[data-tf]');
    if (!btn || btn.closest('#tf-add-popup')) return;
    const pane = panes[activePaneIndex];
    if (!pane) return;
    const tf = parseInt(btn.dataset.tf, 10);
    if (!Number.isFinite(tf) || tf <= 0) return;
    pane.timeframe = tf;
    updateTimeframeButtons(tf);
    document.getElementById('tf-more-menu')?.classList.remove('visible');
    refreshPaneData(pane, { fit: true });
    scheduleWorkspaceSave();
  });
  // NOUVEAU : menu "▾" pour les timeframes moins courants (1D/1W/1M)
  const moreBtn = document.getElementById('tf-more-btn');
  const moreMenu = document.getElementById('tf-more-menu');
  moreBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const willShow = !moreMenu.classList.contains('visible');
    if (willShow) {
      const r = moreBtn.getBoundingClientRect();
      moreMenu.style.top = `${r.bottom + 4}px`;
      moreMenu.style.left = `${r.left}px`;
    }
    moreMenu.classList.toggle('visible', willShow);
  });
  document.addEventListener('click', (e) => {
    if (!moreMenu.contains(e.target) && e.target !== moreBtn) moreMenu.classList.remove('visible');
  });

  loadCustomTimeframes();
  setupTfAddButton();
}

// ============ NOUVEAU : timeframes personnalisées (bouton "+") ============
const CUSTOM_TF_STORAGE_KEY = 'customTimeframes';

function getCustomTimeframes() {
  try {
    const raw = JSON.parse(localStorage.getItem(CUSTOM_TF_STORAGE_KEY));
    return Array.isArray(raw) ? raw.filter(v => Number.isFinite(v) && v > 0) : [];
  } catch { return []; }
}

function saveCustomTimeframes(list) {
  localStorage.setItem(CUSTOM_TF_STORAGE_KEY, JSON.stringify(list));
}

/** Libellé lisible pour une timeframe en minutes, réutilise TF_LABELS quand ça correspond. */
function formatCustomTfLabel(minutes) {
  if (TF_LABELS[minutes]) return TF_LABELS[minutes];
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440 && minutes % 60 === 0) return `${minutes / 60}h`;
  if (minutes < 10080 && minutes % 1440 === 0) return `${minutes / 1440}D`;
  if (minutes % 10080 === 0) return `${minutes / 10080}W`;
  return `${minutes}m`;
}

/** Vrai si une timeframe (défaut ou personnalisée) existe déjà pour cette valeur en minutes. */
function timeframeAlreadyExists(minutes) {
  return !!document.querySelector(`.tf-btn[data-tf="${minutes}"]`);
}

function buildCustomTfButton(minutes) {
  const btn = document.createElement('button');
  btn.className = 'tf-btn tf-btn-custom';
  btn.dataset.tf = String(minutes);
  const label = document.createElement('span');
  label.textContent = formatCustomTfLabel(minutes);
  const removeBtn = document.createElement('span');
  removeBtn.className = 'tf-custom-remove';
  removeBtn.title = 'Supprimer cette timeframe';
  removeBtn.textContent = '×';
  removeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const list = getCustomTimeframes().filter(v => v !== minutes);
    saveCustomTimeframes(list);
    btn.remove();
    const customList = document.getElementById('tf-custom-list');
    document.getElementById('tf-custom-sep').style.display = (customList && customList.children.length) ? '' : 'none';
  });
  btn.appendChild(label);
  btn.appendChild(removeBtn);
  return btn;
}

/** Recrée au démarrage les boutons des timeframes personnalisées sauvegardées (localStorage). */
function loadCustomTimeframes() {
  const list = getCustomTimeframes();
  const container = document.getElementById('tf-custom-list');
  const sep = document.getElementById('tf-custom-sep');
  if (!container) return;
  container.innerHTML = '';
  list.forEach(minutes => {
    if (timeframeAlreadyExists(minutes)) return; // évite les doublons avec les TF par défaut
    container.appendChild(buildCustomTfButton(minutes));
  });
  if (sep) sep.style.display = container.children.length ? '' : 'none';
}

function setupTfAddButton() {
  const addBtn = document.getElementById('tf-add-btn');
  const popup = document.getElementById('tf-add-popup');
  const valueInput = document.getElementById('tf-add-value');
  const unitSelect = document.getElementById('tf-add-unit');
  const errorEl = document.getElementById('tf-add-error');
  const cancelBtn = document.getElementById('tf-add-cancel');
  const confirmBtn = document.getElementById('tf-add-confirm');
  if (!addBtn || !popup) return;

  function closePopup() {
    popup.classList.remove('visible');
    errorEl.textContent = '';
  }

  addBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const willShow = !popup.classList.contains('visible');
    if (willShow) {
      const r = addBtn.getBoundingClientRect();
      popup.style.top = `${r.bottom + 4}px`;
      popup.style.left = `${Math.max(4, r.left - 190)}px`;
      errorEl.textContent = '';
      valueInput.focus();
      valueInput.select();
    }
    popup.classList.toggle('visible', willShow);
  });
  document.addEventListener('click', (e) => {
    if (!popup.contains(e.target) && e.target !== addBtn) closePopup();
  });
  cancelBtn.addEventListener('click', closePopup);

  function confirmAdd() {
    const rawValue = parseInt(valueInput.value, 10);
    const unitMinutes = parseInt(unitSelect.value, 10);
    if (!Number.isFinite(rawValue) || rawValue <= 0) {
      errorEl.textContent = 'Entrez un nombre valide (> 0).';
      return;
    }
    const minutes = rawValue * unitMinutes;
    if (minutes > 525600) { // > 1 an, pas de sens pour un graphique
      errorEl.textContent = 'Valeur trop grande.';
      return;
    }
    if (timeframeAlreadyExists(minutes)) {
      errorEl.textContent = 'Cette timeframe existe déjà.';
      return;
    }
    const list = getCustomTimeframes();
    list.push(minutes);
    list.sort((a, b) => a - b);
    saveCustomTimeframes(list);
    document.getElementById('tf-custom-list')?.appendChild(buildCustomTfButton(minutes));
    document.getElementById('tf-custom-sep').style.display = '';
    closePopup();
    // Bascule immédiatement la grille active sur la nouvelle timeframe créée
    const pane = panes[activePaneIndex];
    if (pane) {
      pane.timeframe = minutes;
      updateTimeframeButtons(minutes);
      document.getElementById('tf-more-menu')?.classList.remove('visible');
      refreshPaneData(pane, { fit: true });
      scheduleWorkspaceSave();
    }
  }
  confirmBtn.addEventListener('click', confirmAdd);
  valueInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') confirmAdd(); });
}

// Construit dynamiquement les boutons du panneau "Outils avancés" à partir d'ADVANCED_TOOLS
function setupAdvancedToolsPanel() {
  const toggleBtn = document.getElementById('tool-advanced');
  const panel = document.getElementById('advanced-tools-panel');
  const list = panel.querySelector('.adv-tools-list');

  ADVANCED_TOOLS.forEach(tool => {
    const btn = document.createElement('button');
    btn.className = 'adv-tool-btn';
    btn.dataset.advTool = tool.key;
    // Natifs toujours actifs ; outils lib désactivés tant que le package n'est pas chargé
    btn.disabled = !tool.native;
    const clicLabel = tool.anchors === 1 ? '1 clic' : `${tool.anchors} clics`;
    btn.innerHTML = `<span>${tool.label}</span><span class="adv-tool-anchors">${clicLabel}</span>`;
    btn.addEventListener('click', () => {
      const isActive = (tool.native && currentTool === tool.key) ||
        (!tool.native && advTool && advTool.key === tool.key);
      setAdvancedTool(isActive ? null : tool);
    });
    addFavStar(btn, tool.key, { adv: true }); // NOUVEAU : étoile de favori devant le label
    list.appendChild(btn);
  });

  toggleBtn.addEventListener('click', () => panel.classList.toggle('visible'));
  document.getElementById('ft-tool-advanced')?.addEventListener('click', () => panel.classList.toggle('visible'));
}

function setupSidebarTools() {
  document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
    btn.addEventListener('click', () => {
      const tool = btn.dataset.tool;
      setTool(currentTool === tool ? null : (tool || null));
    });
    // NOUVEAU : étoile de favori sur chaque outil de dessin (pas sur le curseur "")
    if (btn.dataset.tool) addFavStar(btn, btn.dataset.tool);
  });
  setupAdvancedToolsPanel();
  syncFavStars();     // reflète les favoris déjà enregistrés (localStorage) sur les étoiles
  renderFavoritesBar(); // construit la barre flottante à partir des favoris enregistrés

  document.getElementById('tool-clear').addEventListener('click', () => {
    hideDrawingMenu(); // NOUVEAU : le dessin sélectionné va être effacé
    const pane = panes[activePaneIndex];
    if (pane) {
      pane.drawings.forEach(d => {
        if (d.type === 'horizontal' && d.priceLine) pane.series.removePriceLine(d.priceLine);
        else if (d._primitive) pane.series.detachPrimitive(d._primitive);
      });
      pane.drawings = [];
      redrawPane(pane);
      scheduleWorkspaceSave();
    }
  });
}

function setupLayoutButtons() {
  document.querySelectorAll('.layout-btn').forEach(btn => {
    btn.addEventListener('click', () => setLayout(btn.dataset.layout));
  });
}

// ============ Persistance des dessins / workspace ============
// - Sauvegarde manuelle (bouton 💾)
// - Auto-save différé après chaque ajout/suppression/modification de dessin
// - Cache des dessins par fichier CSV (changement de fichier restaure les dessins de ce fichier)
// - Restauration au démarrage après chargement des données (primitives recréées)

let drawingsByFile = {}; // { [filePath]: { layout, panes, updatedAt } }
let workspaceSaveTimer = null;
let workspaceDirty = false;
let workspaceRestoring = false;   // bloque les auto-saves pendant restore/load
let workspaceRevision = 0;        // révision connue du client (conflits disque)
let workspaceSaveInFlight = null; // Promise de la sauvegarde en cours
let workspaceSaveQueued = false;  // une autre save a été demandée pendant l'en-cours
const WORKSPACE_AUTOSAVE_MS = 800;

function serializePaneDrawings(pane) {
  return (pane.drawings || []).map(({ priceLine, _primitive, ...rest }) => {
    // Deep-clone pour éviter toute référence vivante
    try { return JSON.parse(JSON.stringify(rest)); }
    catch { return { ...rest }; }
  });
}

function serializePanesState() {
  return panes.map(p => ({
    timeframe: p.timeframe,
    drawings: serializePaneDrawings(p)
  }));
}

function touchFileDrawingsCache(filePath) {
  if (!filePath) return;
  drawingsByFile[filePath] = {
    layout: currentLayout,
    panes: serializePanesState(),
    // NOUVEAU (fix reprise de session) : on mémorise aussi où en est le replay sur CE fichier,
    // pour ne pas obliger l'utilisateur à tout rejouer depuis le début après avoir fermé l'app.
    replay: { enabled: replayState.enabled, index: replayState.index, intervalMs: replayState.intervalMs },
    updatedAt: Date.now()
  };
}

function buildWorkspaceObject() {
  // Met à jour le cache du fichier courant avant de sérialiser
  if (currentFilePath) touchFileDrawingsCache(currentFilePath);
  return {
    version: 2,
    revision: workspaceRevision,
    filePath: currentFilePath,
    layout: currentLayout,
    chartType,
    theme: currentTheme,
    magnet: magnetEnabled,
    syncPanes: syncPanesEnabled,
    indicators: {
      volume: indicatorState.volume,
      sma: { ...indicatorState.sma },
      ema: { ...indicatorState.ema }
    },
    panes: serializePanesState(),
    drawingsByFile
  };
}

/**
 * Sauvegarde avec file d'attente : une seule écriture IPC à la fois.
 * Si une save est déjà en vol, on en file une autre qui partira juste après
 * (avec l'état le plus récent), plutôt que d'écrire un snapshot périmé en parallèle.
 */
async function saveWorkspaceNow(opts = {}) {
  if (!window.api?.saveWorkspace) return false;
  if (workspaceRestoring && !opts.force) return false;

  if (workspaceSaveInFlight) {
    workspaceSaveQueued = true;
    try { await workspaceSaveInFlight; } catch {}
    // Si personne d'autre n'a déjà relancé, on enchaîne
    if (!workspaceSaveInFlight && workspaceSaveQueued) {
      workspaceSaveQueued = false;
      return saveWorkspaceNow(opts);
    }
    return true;
  }

  const run = (async () => {
    try {
      const payload = buildWorkspaceObject();
      const result = await window.api.saveWorkspace(payload);
      // Compat : ancien main.js renvoyait un booléen
      const ok = result === true || (result && result.ok === true);
      if (ok) {
        workspaceDirty = false;
        if (result && typeof result.revision === 'number') {
          workspaceRevision = result.revision;
        } else {
          workspaceRevision = (workspaceRevision || 0) + 1;
        }
        // Si le main a fusionné avec une version disque plus récente, réinjecte
        // le drawingsByFile fusionné pour rester cohérent en mémoire
        if (result?.mergedFromConflict) {
          try {
            const fresh = await window.api.loadWorkspace();
            if (fresh?.drawingsByFile) {
              drawingsByFile = { ...fresh.drawingsByFile, ...drawingsByFile };
              // L'entrée du fichier courant (session active) reste prioritaire
              if (currentFilePath) touchFileDrawingsCache(currentFilePath);
            }
          } catch {}
        }
        if (!opts.silent) {
          // NOUVEAU (redesign toolbar icône seule) : le bouton n'a plus de texte à remplacer
          // temporairement — on donne le retour visuel via un flash de couleur + tooltip,
          // sans jamais toucher au contenu SVG du bouton.
          const saveBtn = document.getElementById('btn-save-workspace');
          if (saveBtn) {
            const originalTitle = saveBtn.dataset.origTitle || saveBtn.title;
            saveBtn.dataset.origTitle = originalTitle;
            saveBtn.title = result?.mergedFromConflict ? 'Fusionné' : 'Sauvegardé';
            saveBtn.classList.add('tb-flash-ok');
            setTimeout(() => {
              saveBtn.classList.remove('tb-flash-ok');
              saveBtn.title = saveBtn.dataset.origTitle;
            }, 1400);
          }
        }
      } else if (!opts.silent) {
        const saveBtn = document.getElementById('btn-save-workspace');
        if (saveBtn) {
          const originalTitle = saveBtn.dataset.origTitle || saveBtn.title;
          saveBtn.dataset.origTitle = originalTitle;
          saveBtn.title = 'Conflit de sauvegarde';
          saveBtn.classList.add('tb-flash-warn');
          setTimeout(() => {
            saveBtn.classList.remove('tb-flash-warn');
            saveBtn.title = saveBtn.dataset.origTitle;
          }, 1800);
        }
      }
      return ok;
    } catch (err) {
      console.error('Erreur sauvegarde workspace:', err);
      return false;
    } finally {
      workspaceSaveInFlight = null;
      if (workspaceSaveQueued) {
        workspaceSaveQueued = false;
        // Relance avec l'état courant (pas le snapshot périmé)
        scheduleWorkspaceSave();
      }
    }
  })();

  workspaceSaveInFlight = run;
  return run;
}

function scheduleWorkspaceSave() {
  if (workspaceRestoring) return;
  workspaceDirty = true;
  if (workspaceSaveTimer) clearTimeout(workspaceSaveTimer);
  workspaceSaveTimer = setTimeout(() => {
    workspaceSaveTimer = null;
    saveWorkspaceNow({ silent: true });
  }, WORKSPACE_AUTOSAVE_MS);
}

/** Applique un état de panes (timeframes + dessins) après que les séries existent. */
function applyPanesState(savedPanes, opts = {}) {
  if (!savedPanes || !savedPanes.length) return;
  savedPanes.forEach((saved, i) => {
    if (!panes[i]) return;
    if (saved.timeframe) panes[i].timeframe = saved.timeframe;
    // Détache d'éventuelles primitives existantes avant de remplacer
    panes[i].drawings.forEach(d => {
      try {
        if (d.type === 'horizontal' && d.priceLine) panes[i].series.removePriceLine(d.priceLine);
        else if (d._primitive) panes[i].series.detachPrimitive(d._primitive);
      } catch {}
    });
    panes[i].drawings = (saved.drawings || []).map(d => {
      const clone = JSON.parse(JSON.stringify(d));
      clone.priceLine = null;
      clone._primitive = null;
      // Rétrocompatibilité : migre un zigzagArrow ancien format (p1/p2/p3) vers d.points, dès
      // l'hydratation — tout le reste du code ne connaît plus qu'un seul format.
      migrateZigzagDrawing(clone);
      return clone;
    });
    syncPaneDrawings(panes[i]);
  });
  // Rafraîchir les boutons TF pour la pane active
  if (opts.updateTf !== false) {
    const pane = panes[activePaneIndex];
    if (pane) {
      updateTimeframeButtons(pane.timeframe);
      updateTitlebarForPane(pane);
    }
  }
}

/** Avant de changer de fichier : mémorise les dessins du fichier courant. */
function stashCurrentFileDrawings() {
  if (!currentFilePath) return;
  touchFileDrawingsCache(currentFilePath);
  scheduleWorkspaceSave();
}

/** Après chargement d'un fichier : restaure les dessins associés s'il y en a. */
function restoreDrawingsForFile(filePath) {
  const cached = drawingsByFile[filePath];
  if (!cached) return false;
  if (cached.layout && cached.layout !== currentLayout) {
    // setLayout recrée les panes ; on réappliquera les dessins juste après
    setLayout(cached.layout);
  }
  applyPanesState(cached.panes);
  return true;
}

// NOUVEAU (fix reprise de session) : restaure le curseur de replay là où l'utilisateur l'avait
// laissé sur ce fichier, au lieu de systématiquement repartir de zéro (resetReplayForNewData()).
// Appelé après refreshAllPanes() + applyPanesState(), donc avec des bougies et des dessins déjà
// en place — nécessaire pour que applyReplayDrawingVisibilityAll()/evaluateAllPositionHits()
// calculent un résultat cohérent dès l'affichage.
async function restoreReplayForFile(saved) {
  if (!saved || !saved.enabled || !rawCandleData.length) return;
  replayState.enabled = true;
  replayState.pickStartOnChart = false;
  replayState.index = Math.max(0, Math.min(
    Number.isFinite(saved.index) ? saved.index : rawCandleData.length - 1,
    rawCandleData.length - 1
  ));
  if (Number.isFinite(saved.intervalMs) && saved.intervalMs > 0) replayState.intervalMs = saved.intervalMs;
  replayState.playing = false; // on ne relance jamais la lecture automatique tout seul au chargement

  const toggle = document.getElementById('rb-toggle');
  const slider = document.getElementById('rb-slider');
  const playBtn = document.getElementById('rb-play');
  const stepBtn = document.getElementById('rb-step-btn');
  const skipEndBtn = document.getElementById('rb-skip-end');
  if (toggle) toggle.checked = true;
  [slider, playBtn, stepBtn, skipEndBtn].forEach(c => { if (c) c.disabled = false; });

  updateReplayUI();
  // Le chart avait déjà été peuplé avec les données complètes par le chargement initial du CSV :
  // il faut le rafraîchir pour qu'il ne montre que jusqu'au curseur de replay restauré.
  await refreshAllPanes({ fit: true });
  applyReplayDrawingVisibilityAll();
  evaluateAllPositionHits();
}

function setupWorkspaceButtons() {
  const saveBtn = document.getElementById('btn-save-workspace');
  saveBtn?.addEventListener('click', () => saveWorkspaceNow({ silent: false }));

  document.getElementById('btn-reset-workspace')?.addEventListener('click', async () => {
    // NOUVEAU : la confirmation est désormais désactivable (Paramètres > Général)
    if (APP_SETTINGS.general.confirmReset &&
        !confirm('Restaurer la configuration par défaut ? Les dessins et réglages sauvegardés seront effacés.')) return;
    if (workspaceSaveTimer) { clearTimeout(workspaceSaveTimer); workspaceSaveTimer = null; }
    await window.api.resetWorkspace();
    drawingsByFile = {};
    currentFilePath = null;
    panes.forEach(p => {
      p.drawings.forEach(d => {
        try {
          if (d.type === 'horizontal' && d.priceLine) p.series.removePriceLine(d.priceLine);
          else if (d._primitive) p.series.detachPrimitive(d._primitive);
        } catch {}
      });
      p.drawings = [];
    });
    setLayout(APP_SETTINGS.chart.defaultLayout || '1x1');
    const defaultPath = 'data/eurusd.csv';
    const rawCsv = await window.api.readCsvFile(defaultPath);
    if (rawCsv) {
      await loadCsvFromPath(defaultPath, { skipHistory: true, skipDrawingRestore: true });
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
  });

  // Auto-save à la fermeture de la fenêtre
  window.addEventListener('beforeunload', () => {
    if (workspaceDirty || currentFilePath) {
      // best-effort synchrone impossible via IPC async — on tente quand même
      try { saveWorkspaceNow({ silent: true }); } catch {}
    }
  });
}

// ============ Restauration du workspace au lancement ============
async function restoreWorkspace() {
  const ws = await window.api.loadWorkspace();
  if (!ws) return false;

  workspaceRestoring = true;
  try {
  if (typeof ws.revision === 'number') workspaceRevision = ws.revision;

  // Restaure les réglages globaux
  if (ws.drawingsByFile && typeof ws.drawingsByFile === 'object') {
    drawingsByFile = ws.drawingsByFile;
  }
  if (ws.chartType) {
    chartType = ws.chartType;
    localStorage.setItem('chartType', chartType);
    const sel = document.getElementById('chart-type');
    if (sel) sel.value = chartType;
  }
  if (ws.theme && ws.theme !== currentTheme) {
    applyTheme(ws.theme);
  }
  if (typeof ws.magnet === 'boolean') {
    magnetEnabled = ws.magnet;
    localStorage.setItem('magnet', magnetEnabled ? '1' : '0');
    document.getElementById('btn-magnet')?.classList.toggle('active', magnetEnabled);
  }
  if (typeof ws.syncPanes === 'boolean') {
    syncPanesEnabled = ws.syncPanes;
    localStorage.setItem('syncPanes', syncPanesEnabled ? '1' : '0');
    document.getElementById('btn-sync-panes')?.classList.toggle('active', syncPanesEnabled);
  }
  if (ws.indicators) {
    if (typeof ws.indicators.volume === 'boolean') indicatorState.volume = ws.indicators.volume;
    if (ws.indicators.sma) Object.assign(indicatorState.sma, ws.indicators.sma);
    if (ws.indicators.ema) Object.assign(indicatorState.ema, ws.indicators.ema);
    persistIndicatorState();
    document.getElementById('btn-volume')?.classList.toggle('active', indicatorState.volume);
    for (const p of [20, 50, 200]) {
      document.getElementById('btn-sma' + p)?.classList.toggle('active', !!indicatorState.sma[p]);
    }
    for (const p of [9, 21]) {
      document.getElementById('btn-ema' + p)?.classList.toggle('active', !!indicatorState.ema[p]);
    }
  }

  // Si un fichier est associé et existe encore : charger données puis dessins
  if (ws.filePath && window.api.fileExists(ws.filePath)) {
    // Pré-remplit le cache avec l'état panes du workspace (compat v1)
    if (ws.panes && !drawingsByFile[ws.filePath]) {
      drawingsByFile[ws.filePath] = {
        layout: ws.layout || '1x1',
        panes: ws.panes
      };
    }
    await loadCsvFromPath(ws.filePath, { skipHistory: true });
    // loadCsvFromPath appelle restoreDrawingsForFile via le hook ci-dessous
    setActivePane(0);
    return true;
  }

  // Pas de fichier : applique layout + dessins du workspace sur les données mock
  if (ws.layout) setLayout(ws.layout);
  if (ws.panes) applyPanesState(ws.panes);
  return false;
  } finally {
    workspaceRestoring = false;
  }
}

// ============ Point d'entrée ============
window.addEventListener('error', (e) => {
  console.error('Erreur JS non gérée :', e.error || e.message);
  updateTitlebar(null, `Erreur : ${e.message}`);
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('Promesse rejetée non gérée :', e.reason);
  updateTitlebar(null, `Erreur : ${e.reason?.message || e.reason}`);
});


