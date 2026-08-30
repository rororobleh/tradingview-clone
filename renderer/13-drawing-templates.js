// ============================================================
// 13-drawing-templates.js
// Modèles de dessin, façon TradingView, en deux volets :
//  1) Modèles de GRILLE nommés ("Save/Load drawing template") : instantané de tous les dessins
//     de la grille active, réutilisable sur n'importe quel autre fichier CSV ou grille.
//  2) Modèles de STYLE par dessin ("Save as default" / styles nommés) : enregistre l'apparence
//     (couleurs, épaisseur...) d'UN dessin déjà modifié, pour la réappliquer à un autre dessin
//     du même type depuis son propre menu contextuel (clic sur le dessin → 🔖 Modèles de style).
// Les deux sont indépendants de la sauvegarde automatique par fichier CSV (workspace.json /
// drawingsByFile) : ce sont des points de départ qu'on applique volontairement, pas un état
// restauré tout seul.
// Fait partie de renderer.js (sectionné en modules). Chargé comme <script> classique dans
// index.html : les variables/fonctions top-level restent globales et partagées avec les autres
// fichiers du dossier renderer/, exactement comme dans l'ancien renderer.js monolithique.
// ============================================================

// ============ 1) Modèles de grille (tous les dessins d'une pane) ============

let drawingTemplates = {}; // { [id]: { name, drawings, createdAt, updatedAt } }

function genTemplateId() {
  return 'tpl_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

async function loadDrawingTemplatesFromDisk() {
  try {
    const data = await window.api.getDrawingTemplates?.();
    drawingTemplates = (data && typeof data === 'object') ? data : {};
  } catch {
    drawingTemplates = {};
  }
}

async function persistDrawingTemplates() {
  try { await window.api.saveDrawingTemplates?.(drawingTemplates); }
  catch (err) { console.error('Erreur sauvegarde des modèles de dessin :', err); }
}

/** Clone hydraté d'un tableau de dessins sérialisés : mêmes garanties que applyPanesState
 * (priceLine/_primitive remis à null, migration zigzag), pour être réattaché à une pane. */
function hydrateTemplateDrawings(rawDrawings) {
  return (rawDrawings || []).map(d => {
    const clone = JSON.parse(JSON.stringify(d));
    clone.priceLine = null;
    clone._primitive = null;
    if (typeof migrateZigzagDrawing === 'function') migrateZigzagDrawing(clone);
    return clone;
  });
}

function flashTemplatesButton(kind) {
  const btn = document.getElementById('btn-templates-toggle');
  if (!btn) return;
  const cls = kind === 'warn' ? 'tb-flash-warn' : 'tb-flash-ok';
  btn.classList.add(cls);
  setTimeout(() => btn.classList.remove(cls), 1000);
}

/** Enregistre les dessins de la grille active comme nouveau modèle nommé. */
async function saveCurrentPaneAsTemplate() {
  const pane = panes[activePaneIndex];
  if (!pane) return;
  if (!pane.drawings || !pane.drawings.length) {
    flashTemplatesButton('warn');
    return;
  }
  const name = await showTextPrompt('', 'Nom du modèle de dessin');
  if (!name) return;
  const id = genTemplateId();
  const now = Date.now();
  drawingTemplates[id] = {
    name: name.slice(0, 60),
    drawings: serializePaneDrawings(pane),
    createdAt: now,
    updatedAt: now
  };
  await persistDrawingTemplates();
  renderTemplatesMenu();
  flashTemplatesButton('ok');
}

/** Applique un modèle sur la grille active : remplace ses dessins actuels. */
function applyTemplateToActivePane(id) {
  const template = drawingTemplates[id];
  const pane = panes[activePaneIndex];
  if (!template || !pane) return;

  hideDrawingMenu?.();
  pane.drawings.forEach(d => {
    try {
      if (d.type === 'horizontal' && d.priceLine) pane.series.removePriceLine(d.priceLine);
      else if (d._primitive) pane.series.detachPrimitive(d._primitive);
    } catch { /* dessin déjà détaché */ }
  });
  pane.drawings = hydrateTemplateDrawings(template.drawings);
  syncPaneDrawings(pane);
  scheduleWorkspaceSave(); // le fichier CSV courant mémorise ces dessins comme les siens désormais
  document.getElementById('templates-menu')?.classList.remove('visible');
  flashTemplatesButton('ok');
}

async function renameTemplate(id) {
  const template = drawingTemplates[id];
  if (!template) return;
  const name = await showTextPrompt(template.name, 'Renommer le modèle');
  if (!name) return;
  template.name = name.slice(0, 60);
  template.updatedAt = Date.now();
  await persistDrawingTemplates();
  renderTemplatesMenu();
}

async function deleteTemplate(id) {
  const template = drawingTemplates[id];
  if (!template) return;
  if (APP_SETTINGS?.general?.confirmReset !== false &&
      !confirm(`Supprimer le modèle "${template.name}" ?`)) return;
  delete drawingTemplates[id];
  await persistDrawingTemplates();
  renderTemplatesMenu();
}

function buildTemplateMenuItem(id, template) {
  const row = document.createElement('div');
  row.className = 'tpl-item';

  const applyBtn = document.createElement('button');
  applyBtn.type = 'button';
  applyBtn.className = 'tpl-apply-btn';
  applyBtn.textContent = template.name;
  applyBtn.title = `Appliquer "${template.name}" à la grille active`;
  applyBtn.addEventListener('click', () => applyTemplateToActivePane(id));
  row.appendChild(applyBtn);

  const actions = document.createElement('div');
  actions.className = 'tpl-item-actions';

  const renameBtn = document.createElement('button');
  renameBtn.type = 'button';
  renameBtn.className = 'tpl-icon-btn';
  renameBtn.title = 'Renommer';
  renameBtn.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
  renameBtn.addEventListener('click', (e) => { e.stopPropagation(); renameTemplate(id); });
  actions.appendChild(renameBtn);

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'tpl-icon-btn tpl-icon-delete';
  deleteBtn.title = 'Supprimer';
  deleteBtn.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4,7 20,7"/><path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/></svg>';
  deleteBtn.addEventListener('click', (e) => { e.stopPropagation(); deleteTemplate(id); });
  actions.appendChild(deleteBtn);

  row.appendChild(actions);
  return row;
}

function renderTemplatesMenu() {
  const list = document.getElementById('templates-list');
  const empty = document.getElementById('templates-empty');
  if (!list) return;
  list.innerHTML = '';
  const entries = Object.entries(drawingTemplates).sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0));
  entries.forEach(([id, template]) => list.appendChild(buildTemplateMenuItem(id, template)));
  if (empty) empty.style.display = entries.length ? 'none' : 'block';
}

function setupTemplatesMenu() {
  const toggleBtn = document.getElementById('btn-templates-toggle');
  const menu = document.getElementById('templates-menu');
  const saveBtn = document.getElementById('templates-save-current');
  if (!toggleBtn || !menu) return;

  toggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const willShow = !menu.classList.contains('visible');
    if (willShow) {
      const r = toggleBtn.getBoundingClientRect();
      menu.style.top = `${r.bottom + 4}px`;
      menu.style.left = `${Math.max(4, r.right - 240)}px`;
      renderTemplatesMenu();
    }
    menu.classList.toggle('visible', willShow);
  });
  document.addEventListener('click', (e) => {
    if (!menu.contains(e.target) && e.target !== toggleBtn && !toggleBtn.contains(e.target)) {
      menu.classList.remove('visible');
    }
  });
  saveBtn?.addEventListener('click', () => saveCurrentPaneAsTemplate());
}

// ============ 2) Modèles de style par dessin (appliqués depuis le menu d'un dessin) ============
// Champs purement visuels d'un dessin (jamais sa géométrie : points, prix, temps, texte, ou
// quantité) — la seule "apparence" qu'un style-modèle doit transporter d'un dessin à un autre.
const DRAWING_STYLE_FIELDS = [
  'color', 'bgColor', 'stopColor', 'targetColor', 'textColor',
  'lineWidth', 'textPosition', 'extendLeft', 'extendRight'
];

let styleTemplates = {}; // { [drawingType]: { [id]: { name, style, createdAt, updatedAt } } }

async function loadStyleTemplatesFromDisk() {
  try {
    const data = await window.api.getDrawingStyleTemplates?.();
    styleTemplates = (data && typeof data === 'object') ? data : {};
  } catch {
    styleTemplates = {};
  }
}

async function persistStyleTemplates() {
  try { await window.api.saveDrawingStyleTemplates?.(styleTemplates); }
  catch (err) { console.error('Erreur sauvegarde des styles de dessin :', err); }
}

/** Ne garde que les champs de style réellement présents sur ce dessin. */
function captureStyleFromDrawing(drawing) {
  const style = {};
  DRAWING_STYLE_FIELDS.forEach(f => {
    if (drawing[f] !== undefined) style[f] = drawing[f];
  });
  return style;
}

/** Applique un style enregistré au dessin actuellement sélectionné (undo + re-render inclus). */
function applyStyleToSelectedDrawing(style) {
  if (!selectedDrawing || selectedDrawing.drawing.locked) return;
  const { pane, drawing } = selectedDrawing;
  const before = snapshotDrawing(drawing);

  DRAWING_STYLE_FIELDS.forEach(f => {
    if (Object.prototype.hasOwnProperty.call(style, f)) drawing[f] = style[f];
  });

  if (drawing.type === 'horizontal' && drawing.priceLine) {
    drawing.priceLine.applyOptions({ color: drawing.color, lineWidth: drawing.lineWidth });
  } else {
    drawing._primitive?.refresh();
  }

  pushUndo(pane, { type: 'modify', drawingRef: drawing, before, after: snapshotDrawing(drawing) });
  scheduleWorkspaceSave();

  // Rafraîchit l'état visuel du menu (pastilles de couleur, épaisseur...) déjà ouvert
  const menu = document.getElementById('drawing-context-menu');
  if (menu?.classList.contains('visible')) {
    showDrawingMenu(pane, drawing, parseFloat(menu.style.left), parseFloat(menu.style.top));
  }
}

async function saveSelectedDrawingStyleAsTemplate() {
  if (!selectedDrawing) return;
  const { drawing } = selectedDrawing;
  const style = captureStyleFromDrawing(drawing);
  if (!Object.keys(style).length) return; // rien de stylable sur ce type (cas limite)

  const name = await showTextPrompt('', 'Nom du style');
  if (!name) return;

  const type = drawing.type;
  if (!styleTemplates[type]) styleTemplates[type] = {};
  const id = genTemplateId();
  const now = Date.now();
  styleTemplates[type][id] = { name: name.slice(0, 60), style, createdAt: now, updatedAt: now };
  await persistStyleTemplates();
}

function applyStyleTemplate(type, id) {
  const tpl = styleTemplates[type]?.[id];
  if (!tpl || !selectedDrawing || selectedDrawing.drawing.type !== type) return;
  applyStyleToSelectedDrawing(tpl.style);
  document.getElementById('dcm-style-popover')?.classList.remove('visible');
}

async function renameStyleTemplate(type, id) {
  const tpl = styleTemplates[type]?.[id];
  if (!tpl) return;
  const name = await showTextPrompt(tpl.name, 'Renommer le style');
  if (!name) return;
  tpl.name = name.slice(0, 60);
  tpl.updatedAt = Date.now();
  await persistStyleTemplates();
  renderStylePopoverContent(type);
}

async function deleteStyleTemplate(type, id) {
  const tpl = styleTemplates[type]?.[id];
  if (!tpl) return;
  if (APP_SETTINGS?.general?.confirmReset !== false &&
      !confirm(`Supprimer le style "${tpl.name}" ?`)) return;
  delete styleTemplates[type][id];
  await persistStyleTemplates();
  renderStylePopoverContent(type);
}

function buildStyleTemplateRow(type, id, tpl) {
  const row = document.createElement('div');
  row.className = 'dcm-style-item';

  const applyBtn = document.createElement('button');
  applyBtn.type = 'button';
  applyBtn.className = 'dcm-style-apply-btn';
  applyBtn.textContent = tpl.name;
  applyBtn.title = `Appliquer le style "${tpl.name}"`;
  applyBtn.addEventListener('click', () => applyStyleTemplate(type, id));
  row.appendChild(applyBtn);

  const actions = document.createElement('div');
  actions.className = 'dcm-style-item-actions';

  const renameBtn = document.createElement('button');
  renameBtn.type = 'button';
  renameBtn.className = 'dcm-style-icon-btn';
  renameBtn.title = 'Renommer';
  renameBtn.innerHTML = '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
  renameBtn.addEventListener('click', (e) => { e.stopPropagation(); renameStyleTemplate(type, id); });
  actions.appendChild(renameBtn);

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'dcm-style-icon-btn dcm-style-icon-delete';
  deleteBtn.title = 'Supprimer';
  deleteBtn.innerHTML = '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4,7 20,7"/><path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/></svg>';
  deleteBtn.addEventListener('click', (e) => { e.stopPropagation(); deleteStyleTemplate(type, id); });
  actions.appendChild(deleteBtn);

  row.appendChild(actions);
  return row;
}

function renderStylePopoverContent(type) {
  const popover = document.getElementById('dcm-style-popover');
  if (!popover) return;
  popover.innerHTML = '';

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'dcm-style-save-btn';
  saveBtn.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3h11l3 3v15H5V3z"/><path d="M8 3v6h8V3"/></svg> Enregistrer le style de ce dessin...';
  saveBtn.addEventListener('click', async () => {
    await saveSelectedDrawingStyleAsTemplate();
    renderStylePopoverContent(type);
  });
  popover.appendChild(saveBtn);

  const templatesForType = styleTemplates[type] || {};
  const entries = Object.entries(templatesForType).sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0));

  if (entries.length) {
    const sep = document.createElement('div');
    sep.className = 'dcm-style-sep';
    popover.appendChild(sep);
    entries.forEach(([id, tpl]) => popover.appendChild(buildStyleTemplateRow(type, id, tpl)));
  } else {
    const empty = document.createElement('div');
    empty.className = 'dcm-style-empty';
    empty.textContent = 'Aucun style enregistré pour ce type de dessin.';
    popover.appendChild(empty);
  }
}

function setupDrawingStyleMenu() {
  const btn = document.getElementById('dcm-style-btn');
  const popover = document.getElementById('dcm-style-popover');
  const menu = document.getElementById('drawing-context-menu');
  if (!btn || !popover || !menu) return;

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!selectedDrawing) return;
    const willShow = !popover.classList.contains('visible');
    if (willShow) {
      renderStylePopoverContent(selectedDrawing.drawing.type);
      positionPopoverAboveMenu(popover, menu);
    }
    popover.classList.toggle('visible', willShow);
  });

  document.addEventListener('mousedown', (e) => {
    if (popover.classList.contains('visible') && !popover.contains(e.target) && !btn.contains(e.target)) {
      popover.classList.remove('visible');
    }
    // Le clic ailleurs qui referme le menu de dessin lui-même (voir setupDrawingContextMenu)
    // referme aussi ce popover, sans dépendre de l'ordre d'exécution des listeners.
    if (!menu.contains(e.target) && !popover.contains(e.target)) {
      popover.classList.remove('visible');
    }
  });
}
