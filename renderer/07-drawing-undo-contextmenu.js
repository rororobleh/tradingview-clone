// ============================================================
// 07-drawing-undo-contextmenu.js
// Undo/redo des dessins, menu contextuel de dessin, sélection d'outil, gestion des clics de dessin, fin du tracé zigzag
// Fait partie de renderer.js (sectionné en modules le 2026-08-28).
// Chargé comme <script> classique dans index.html : les variables/fonctions
// top-level restent globales et partagées entre tous ces fichiers, exactement
// comme dans l'ancien renderer.js monolithique — aucun changement de comportement.
// ============================================================
// ============ NOUVEAU : undo / redo des dessins ============
function getUndoStack(pane) {
  let s = undoStacks.get(pane);
  if (!s) { s = { undo: [], redo: [] }; undoStacks.set(pane, s); }
  return s;
}

function snapshotDrawing(drawing) {
  // Copie sérialisable (sans priceLine / _primitive)
  const { priceLine, _primitive, ...rest } = drawing;
  return JSON.parse(JSON.stringify(rest));
}

function pushUndo(pane, action) {
  // action: { type: 'add'|'remove'|'modify', before?, after?, drawingRef? }
  const s = getUndoStack(pane);
  s.undo.push(action);
  if (s.undo.length > MAX_UNDO) s.undo.shift();
  s.redo.length = 0;
}

function addDrawingToPane(pane, drawing, opts = {}) {
  if (drawing.type === 'horizontal') createNativePriceLine(pane, drawing);
  else attachDrawingToPane(pane, drawing);
  pane.drawings.push(drawing);
  if (!opts.skipUndo) pushUndo(pane, { type: 'add', snapshot: snapshotDrawing(drawing) });
  redrawPane(pane);
  if (!opts.skipSave) scheduleWorkspaceSave();
  // CORRECTIF : le menu flottant (configurer/supprimer) doit apparaître immédiatement à la
  // création d'un dessin, comme sur TradingView — il n'était auparavant jamais affiché.
  if (!opts.skipSelect) selectAndShowDrawingMenu(pane, drawing);
}

function removeDrawing(pane, drawing, opts = {}) {
  if (!opts.skipUndo) pushUndo(pane, { type: 'remove', snapshot: snapshotDrawing(drawing) });
  if (drawing.type === 'horizontal' && drawing.priceLine) pane.series.removePriceLine(drawing.priceLine);
  else if (drawing._primitive) pane.series.detachPrimitive(drawing._primitive);
  pane.drawings = pane.drawings.filter(d => d !== drawing);
  redrawPane(pane);
  if (!opts.skipSave) scheduleWorkspaceSave();
}

function restoreDrawingFromSnapshot(pane, snapshot) {
  const drawing = JSON.parse(JSON.stringify(snapshot));
  if (drawing.type === 'horizontal') createNativePriceLine(pane, drawing);
  else attachDrawingToPane(pane, drawing);
  pane.drawings.push(drawing);
  return drawing;
}

function applySnapshotToDrawing(pane, drawing, snap) {
  if (!drawing || !snap) return;
  const keep = { priceLine: drawing.priceLine, _primitive: drawing._primitive };
  for (const key of Object.keys(drawing)) {
    if (key === 'priceLine' || key === '_primitive' || key === '_hiddenByReplay') continue;
    delete drawing[key];
  }
  Object.assign(drawing, JSON.parse(JSON.stringify(snap)), keep);
  if (drawing.type === 'horizontal' && drawing.priceLine) {
    try {
      drawing.priceLine.applyOptions({
        price: drawing.price,
        color: drawing.color || THEMES[currentTheme].drawColor,
        title: drawing.text || '',
        lineWidth: drawing.lineWidth || DEFAULT_LINE_WIDTH.horizontal || 1
      });
    } catch {}
  } else if (drawing._primitive) {
    try { drawing._primitive.refresh(); } catch {}
  }
  redrawPane(pane);
}

function drawingsMatchSnapshot(d, snap) {
  if (d.type !== snap.type) return false;
  if (snap.price != null && d.price === snap.price) return true;
  if (snap.time != null && d.time === snap.time && (d.type === 'vertical' || d.type === 'text')) return true;
  if (snap.p1 && d.p1 && d.p1.time === snap.p1.time && d.p1.price === snap.p1.price) return true;
  if (snap.text != null && d.text === snap.text && d.time === snap.time) return true;
  // Positions longue/courte
  if ((snap.type === 'longPosition' || snap.type === 'shortPosition') &&
      d.entryTime === snap.entryTime && d.entryPrice === snap.entryPrice &&
      d.stopPrice === snap.stopPrice && d.targetPrice === snap.targetPrice) return true;
  // Outils avancés p1/p2(/p3)
  if (snap.p1 && d.p1 && d.p1.time === snap.p1.time && d.p1.price === snap.p1.price) {
    if (snap.p2 && d.p2 && d.p2.time === snap.p2.time && d.p2.price === snap.p2.price) return true;
  }
  // NOUVEAU : zigzagArrow à nombre de points libre — mêmes deux premiers points comme signature
  // (même logique que p1/p2 ci-dessus, adaptée au tableau d.points).
  if (Array.isArray(snap.points) && Array.isArray(d.points) &&
      snap.points[0] && d.points[0] &&
      d.points[0].time === snap.points[0].time && d.points[0].price === snap.points[0].price) {
    if (snap.points[1] && d.points[1] &&
        d.points[1].time === snap.points[1].time && d.points[1].price === snap.points[1].price) return true;
  }
  return false;
}

function undoLastDrawing() {
  const pane = panes[activePaneIndex];
  if (!pane) return;
  const s = getUndoStack(pane);
  const action = s.undo.pop();
  if (!action) return;
  if (action.type === 'add') {
    const snap = action.snapshot;
    const match = pane.drawings.find(d => drawingsMatchSnapshot(d, snap));
    if (match) removeDrawing(pane, match, { skipUndo: true, skipSave: true });
    s.redo.push(action);
  } else if (action.type === 'remove') {
    restoreDrawingFromSnapshot(pane, action.snapshot);
    s.redo.push(action);
    redrawPane(pane);
  } else if (action.type === 'modify') {
    let target = action.drawingRef;
    if (!target || !pane.drawings.includes(target)) {
      target = pane.drawings.find(d => drawingsMatchSnapshot(d, action.after || action.before));
    }
    if (target && action.before) applySnapshotToDrawing(pane, target, action.before);
    s.redo.push(action);
  }
  scheduleWorkspaceSave();
}

function redoLastDrawing() {
  const pane = panes[activePaneIndex];
  if (!pane) return;
  const s = getUndoStack(pane);
  const action = s.redo.pop();
  if (!action) return;
  if (action.type === 'add') {
    restoreDrawingFromSnapshot(pane, action.snapshot);
    s.undo.push(action);
    redrawPane(pane);
  } else if (action.type === 'remove') {
    const snap = action.snapshot;
    const match = pane.drawings.find(d => drawingsMatchSnapshot(d, snap));
    if (match) removeDrawing(pane, match, { skipUndo: true, skipSave: true });
    s.undo.push(action);
  } else if (action.type === 'modify') {
    let target = action.drawingRef;
    if (!target || !pane.drawings.includes(target)) {
      target = pane.drawings.find(d => drawingsMatchSnapshot(d, action.before || action.after));
    }
    if (target && action.after) applySnapshotToDrawing(pane, target, action.after);
    s.undo.push(action);
  }
  scheduleWorkspaceSave();
}

function applyDrawingWidth(pane, drawing, width) {
  drawing.lineWidth = width;
  if (drawing.type === 'horizontal' && drawing.priceLine) drawing.priceLine.applyOptions({ lineWidth: width });
  else drawing._primitive?.refresh();
  scheduleWorkspaceSave();
}

// ============ NOUVEAU : palette de couleurs façon macOS/Keynote ============
// Remplace le sélecteur natif Windows par une grille de swatches (gris, teintes vives,
// dégradés clair→foncé) — l'input[type=color] natif reste disponible en secours via le
// swatch arc-en-ciel "Plus de couleurs..." en bas de la palette.
const PALETTE_GRAYS = ['#ffffff', '#d9d9d9', '#bfbfbf', '#a6a6a6', '#8c8c8c', '#666666', '#404040', '#262626', '#000000'];
// 9 teintes de base réparties sur le cercle chromatique (rouge, orange, jaune, vert, sarcelle,
// cyan, bleu, violet, magenta) — mêmes colonnes pour toutes les lignes de dégradés.
const PALETTE_HUES = [4, 30, 48, 130, 168, 190, 214, 265, 320];

function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = x => Math.round(255 * x).toString(16).padStart(2, '0');
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}

function buildColorPaletteGrid() {
  const rows = [PALETTE_GRAYS];
  rows.push(PALETTE_HUES.map(h => hslToHex(h, 85, 50))); // ligne "vive" (saturation max)
  // Lignes de dégradés : du plus clair (pastel) au plus foncé, mêmes teintes en colonnes.
  for (const l of [85, 72, 60, 40, 25]) {
    rows.push(PALETTE_HUES.map(h => hslToHex(h, 70, l)));
  }
  return rows;
}

// NOUVEAU : couleurs personnalisées ajoutées par l'utilisateur (persistées, 16 max, les plus
// récentes en premier — pas de doublon).
const CUSTOM_PALETTE_KEY = 'customPaletteColors';
function loadCustomPaletteColors() {
  try {
    const saved = JSON.parse(localStorage.getItem(CUSTOM_PALETTE_KEY));
    return Array.isArray(saved) ? saved : [];
  } catch { return []; }
}
function addCustomPaletteColor(hex) {
  const list = loadCustomPaletteColors().filter(c => c.toLowerCase() !== hex.toLowerCase());
  list.unshift(hex);
  if (list.length > 16) list.length = 16;
  localStorage.setItem(CUSTOM_PALETTE_KEY, JSON.stringify(list));
  return list;
}

// NOUVEAU : conversion couleur <-> {hex, alpha}, pour supporter l'opacité tout en gardant
// l'input[type=color] natif compatible (qui n'accepte que du hex 6 chiffres, jamais rgba()).
function parseColorToHexAlpha(str) {
  if (!str) return { hex: '#000000', alpha: 1 };
  str = str.trim();
  if (str.startsWith('#')) {
    const hex = str.length === 4 ? '#' + [...str.slice(1)].map(c => c + c).join('') : str;
    return { hex, alpha: 1 };
  }
  const m = str.match(/rgba?\(([^)]+)\)/i);
  if (m) {
    const [r, g, b, a = 1] = m[1].split(',').map(s => parseFloat(s));
    const toHex = v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
    return { hex: `#${toHex(r)}${toHex(g)}${toHex(b)}`, alpha: a };
  }
  return { hex: '#000000', alpha: 1 };
}
function hexAlphaToColor(hex, alpha) {
  if (alpha >= 1) return hex; // reste en hex pur quand pleinement opaque (compat priceLine/native)
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${Math.round(alpha * 100) / 100})`;
}

// Recalcule le dégradé (damier de transparence + couleur pleine) affiché sous la jauge.
function updateOpacitySliderTrack(slider, hex) {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  slider.style.backgroundImage =
    `linear-gradient(to right, rgba(${r},${g},${b},0), rgba(${r},${g},${b},1)),` +
    `linear-gradient(45deg, #4a4a52 25%, transparent 25%), linear-gradient(-45deg, #4a4a52 25%, transparent 25%),` +
    `linear-gradient(45deg, transparent 75%, #4a4a52 75%), linear-gradient(-45deg, transparent 75%, #4a4a52 75%)`;
  slider.style.backgroundSize = '100% 100%, 8px 8px, 8px 8px, 8px 8px, 8px 8px';
  slider.style.backgroundPosition = '0 0, 0 0, 0 4px, 4px -4px, -4px 0px';
}

let activeColorPalettePopover = null;
let activeColorPaletteOutsideHandler = null;

function closeColorPalettePopover() {
  if (activeColorPaletteOutsideHandler) {
    document.removeEventListener('mousedown', activeColorPaletteOutsideHandler, true);
    activeColorPaletteOutsideHandler = null;
  }
  activeColorPalettePopover?.remove();
  activeColorPalettePopover = null;
}

// anchorBtn : élément déclencheur (pour le positionnement) ; currentColor : couleur actuelle
// (hex OU rgba(), pour supporter l'opacité) ; onPick(color) : appelé à chaque changement
// (swatch cliqué, jauge d'opacité bougée, ou nouvelle couleur perso ajoutée).
function openColorPalettePopover(anchorBtn, currentColor, onPick) {
  closeColorPalettePopover();
  const pop = document.createElement('div');
  pop.className = 'color-palette-popover';
  let { hex: currentHex, alpha: currentAlpha } = parseColorToHexAlpha(currentColor);

  const emit = () => onPick(hexAlphaToColor(currentHex, currentAlpha));

  function renderSwatchRow(hexList, extraClass) {
    const rowEl = document.createElement('div');
    rowEl.className = 'cp-swatch-row' + (extraClass ? ' ' + extraClass : '');
    hexList.forEach(hex => {
      const sw = document.createElement('div');
      sw.className = 'cp-swatch';
      sw.style.background = hex;
      if (hex.toLowerCase() === currentHex.toLowerCase()) sw.classList.add('selected');
      sw.addEventListener('click', () => {
        currentHex = hex;
        pop.querySelectorAll('.cp-swatch.selected').forEach(el => el.classList.remove('selected'));
        sw.classList.add('selected');
        updateOpacitySliderTrack(opacitySlider, currentHex);
        emit();
      });
      rowEl.appendChild(sw);
    });
    return rowEl;
  }

  buildColorPaletteGrid().forEach(row => pop.appendChild(renderSwatchRow(row)));

  // NOUVEAU : ligne des couleurs personnalisées déjà ajoutées (masquée si vide)
  const customColors = loadCustomPaletteColors();
  let customRow = null;
  if (customColors.length) {
    customRow = renderSwatchRow(customColors, 'cp-custom-row');
    pop.appendChild(customRow);
  }

  // Ligne du bas : "+" (ajouter une couleur perso) et arc-en-ciel (couleur libre, non conservée)
  const moreRow = document.createElement('div');
  moreRow.className = 'cp-swatch-row cp-swatch-more-row';

  const addSw = document.createElement('div');
  addSw.className = 'cp-swatch cp-swatch-add';
  addSw.title = 'Ajouter une couleur personnalisée';
  addSw.textContent = '+';
  const addInput = document.createElement('input');
  addInput.type = 'color';
  addInput.value = currentHex;
  addInput.addEventListener('change', (e) => {
    const hex = e.target.value;
    addCustomPaletteColor(hex);
    currentHex = hex;
    updateOpacitySliderTrack(opacitySlider, currentHex);
    emit();
    // Réaffiche la palette pour montrer la nouvelle couleur perso dans sa ligne dédiée.
    openColorPalettePopover(anchorBtn, hexAlphaToColor(currentHex, currentAlpha), onPick);
  });
  addSw.appendChild(addInput);
  moreRow.appendChild(addSw);

  const customSw = document.createElement('div');
  customSw.className = 'cp-swatch cp-swatch-custom';
  customSw.title = 'Couleur libre (non enregistrée)';
  const nativeInput = document.createElement('input');
  nativeInput.type = 'color';
  nativeInput.value = currentHex;
  nativeInput.addEventListener('input', (e) => {
    currentHex = e.target.value;
    updateOpacitySliderTrack(opacitySlider, currentHex);
    emit();
  });
  customSw.appendChild(nativeInput);
  moreRow.appendChild(customSw);

  pop.appendChild(moreRow);

  // NOUVEAU : jauge d'opacité (0-100%), piste damier + dégradé transparent→couleur pleine.
  const opacityRow = document.createElement('div');
  opacityRow.className = 'cp-opacity-row';
  const opacitySlider = document.createElement('input');
  opacitySlider.type = 'range';
  opacitySlider.className = 'cp-opacity-slider';
  opacitySlider.min = '0';
  opacitySlider.max = '100';
  opacitySlider.value = String(Math.round(currentAlpha * 100));
  const opacityLabel = document.createElement('span');
  opacityLabel.className = 'cp-opacity-label';
  opacityLabel.textContent = `${opacitySlider.value}%`;
  opacitySlider.addEventListener('input', (e) => {
    currentAlpha = parseInt(e.target.value, 10) / 100;
    opacityLabel.textContent = `${e.target.value}%`;
    emit();
  });
  updateOpacitySliderTrack(opacitySlider, currentHex);
  opacityRow.appendChild(opacitySlider);
  opacityRow.appendChild(opacityLabel);
  pop.appendChild(opacityRow);

  document.body.appendChild(pop);
  const r = anchorBtn.getBoundingClientRect();
  const popRect = pop.getBoundingClientRect();
  let left = r.left;
  let top = r.bottom + 4;
  if (left + popRect.width > window.innerWidth - 8) left = window.innerWidth - popRect.width - 8;
  if (top + popRect.height > window.innerHeight - 8) top = r.top - popRect.height - 4;
  pop.style.left = `${Math.max(4, left)}px`;
  pop.style.top = `${Math.max(4, top)}px`;
  activeColorPalettePopover = pop;

  activeColorPaletteOutsideHandler = (e) => {
    if (!pop.contains(e.target) && e.target !== anchorBtn && !anchorBtn.contains(e.target)) {
      closeColorPalettePopover();
    }
  };
  document.addEventListener('mousedown', activeColorPaletteOutsideHandler, true);
}

// Relie un bouton dcm-*-btn à la palette : au clic, ouvre la grille avec la couleur actuelle
// du dessin (lue via getValue, hex OU rgba — l'input natif n'est plus dans la boucle, il ne sert
// qu'en interne au popover pour "Plus de couleurs..."/"Ajouter..."). applyFn reçoit la couleur
// choisie (hex ou rgba selon l'opacité) et l'applique directement au dessin sélectionné.
function wireColorPaletteButton(btnId, getValue, applyFn) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    openColorPalettePopover(btn, getValue(), applyFn);
  });
}

function setupColorPalettePopovers() {
  wireColorPaletteButton('dcm-color-btn',
    () => selectedDrawing?.drawing.color, applyDcmColor);
  wireColorPaletteButton('dcm-bgcolor-btn',
    () => selectedDrawing?.drawing.bgColor, applyDcmBgColor);
  wireColorPaletteButton('dcm-stopcolor-btn',
    () => selectedDrawing?.drawing.stopColor, applyDcmStopColor);
  wireColorPaletteButton('dcm-targetcolor-btn',
    () => selectedDrawing?.drawing.targetColor, applyDcmTargetColor);
  wireColorPaletteButton('dcm-textcolor-btn',
    () => selectedDrawing?.drawing.textColor, applyDcmTextColor);
}

// NOUVEAU : couleur de bordure — extrait de l'ancien listener 'input' sur #dcm-color pour être
// appelable à la fois par cet input natif (compat couleur libre) et par la palette custom
// (qui peut fournir un rgba() si une opacité < 100% a été choisie sur la jauge).
function applyDcmColor(value) {
  if (!selectedDrawing || selectedDrawing.drawing.locked) return;
  const { drawing } = selectedDrawing;
  drawing.color = value;
  document.getElementById('dcm-color-dot').style.background = drawing.color;
  if (drawing.type === 'horizontal' && drawing.priceLine) drawing.priceLine.applyOptions({ color: drawing.color });
  else drawing._primitive?.refresh();
  scheduleWorkspaceSave();
}

// NOUVEAU : couleur de fond (rectangle uniquement — le segment n'a pas de remplissage)
function applyDcmBgColor(value) {
  if (!selectedDrawing || selectedDrawing.drawing.locked) return;
  const { drawing } = selectedDrawing;
  if (drawing.type !== 'rectangle') return;
  drawing.bgColor = value;
  document.getElementById('dcm-bgcolor-dot').style.background = drawing.bgColor;
  drawing._primitive?.refresh();
  scheduleWorkspaceSave();
}

// NOUVEAU : couleur du stop (positions longue/courte uniquement)
function applyDcmStopColor(value) {
  if (!selectedDrawing || selectedDrawing.drawing.locked) return;
  const { drawing } = selectedDrawing;
  if (drawing.type !== 'longPosition' && drawing.type !== 'shortPosition') return;
  drawing.stopColor = value;
  document.getElementById('dcm-stopcolor-dot').style.background = drawing.stopColor;
  drawing._primitive?.refresh();
  scheduleWorkspaceSave();
}

// NOUVEAU : couleur de l'objectif (positions longue/courte uniquement)
function applyDcmTargetColor(value) {
  if (!selectedDrawing || selectedDrawing.drawing.locked) return;
  const { drawing } = selectedDrawing;
  if (drawing.type !== 'longPosition' && drawing.type !== 'shortPosition') return;
  drawing.targetColor = value;
  document.getElementById('dcm-targetcolor-dot').style.background = drawing.targetColor;
  drawing._primitive?.refresh();
  scheduleWorkspaceSave();
}

// NOUVEAU : couleur du texte attaché au dessin (segment, tendance, flèche, verticale,
// rectangle...), indépendante de la couleur du tracé — l'utilisateur la choisit librement.
function applyDcmTextColor(value) {
  if (!selectedDrawing || selectedDrawing.drawing.locked) return;
  const { drawing } = selectedDrawing;
  drawing.textColor = value;
  document.getElementById('dcm-textcolor-dot').style.background = drawing.textColor;
  if (drawing.type === 'horizontal' && drawing.priceLine) {
    // La ligne horizontale affiche son texte via le "title" natif de lightweight-charts, qui
    // suit toujours la couleur de la ligne — pas de couleur de texte distincte possible ici.
  } else {
    drawing._primitive?.refresh();
  }
  scheduleWorkspaceSave();
}

function setupDrawingContextMenu() {
  const menu = document.getElementById('drawing-context-menu');
  if (!menu) return;
  buildWidthPopover();
  const popover = document.getElementById('dcm-width-popover');
  buildFontSizePopover();
  const fontSizePopover = document.getElementById('dcm-fontsize-popover');
  buildTextPosPopover();
  const textPosPopover = document.getElementById('dcm-textpos-popover');
  setupColorPalettePopovers(); // NOUVEAU : palette de couleurs custom (remplace le picker natif)

  document.getElementById('dcm-color').addEventListener('input', (e) => applyDcmColor(e.target.value));

  // NOUVEAU : couleur de fond (rectangle uniquement — le segment n'a pas de remplissage)
  document.getElementById('dcm-bgcolor').addEventListener('input', (e) => applyDcmBgColor(e.target.value));

  // NOUVEAU : couleur du stop (positions longue/courte uniquement)
  document.getElementById('dcm-stopcolor').addEventListener('input', (e) => applyDcmStopColor(e.target.value));

  // NOUVEAU : couleur de l'objectif (positions longue/courte uniquement)
  document.getElementById('dcm-targetcolor').addEventListener('input', (e) => applyDcmTargetColor(e.target.value));

  // NOUVEAU : couleur du texte attaché au dessin (segment, tendance, flèche, verticale,
  // rectangle...), indépendante de la couleur du tracé — l'utilisateur la choisit librement.
  document.getElementById('dcm-textcolor').addEventListener('input', (e) => applyDcmTextColor(e.target.value));

  // NOUVEAU : extension gauche / droite (rectangle uniquement), indépendantes l'une de l'autre —
  // les deux peuvent être actives en même temps (zone étendue des deux côtés), comme dans le
  // panneau Style > Prolonger de TradingView.
  document.getElementById('dcm-extend-left').addEventListener('click', () => {
    if (!selectedDrawing || selectedDrawing.drawing.locked) return;
    const { pane, drawing } = selectedDrawing;
    if (drawing.type !== 'rectangle') return;
    const before = snapshotDrawing(drawing);
    const ext = getRectExtend(drawing);
    drawing.extendLeft = !ext.left;
    drawing.extendRight = ext.right; // migre l'ancien booléen `infinite` vers les deux champs explicites
    delete drawing.infinite;
    document.getElementById('dcm-extend-left').classList.toggle('is-active', drawing.extendLeft);
    pushUndo(pane, { type: 'modify', drawingRef: drawing, before, after: snapshotDrawing(drawing) });
    drawing._primitive?.refresh();
    scheduleWorkspaceSave();
  });
  document.getElementById('dcm-extend-right').addEventListener('click', () => {
    if (!selectedDrawing || selectedDrawing.drawing.locked) return;
    const { pane, drawing } = selectedDrawing;
    if (drawing.type !== 'rectangle') return;
    const before = snapshotDrawing(drawing);
    const ext = getRectExtend(drawing);
    drawing.extendLeft = ext.left;
    drawing.extendRight = !ext.right;
    delete drawing.infinite;
    document.getElementById('dcm-extend-right').classList.toggle('is-active', drawing.extendRight);
    pushUndo(pane, { type: 'modify', drawingRef: drawing, before, after: snapshotDrawing(drawing) });
    drawing._primitive?.refresh();
    scheduleWorkspaceSave();
  });

  document.getElementById('dcm-qty')?.addEventListener('click', async () => {
    if (!selectedDrawing || selectedDrawing.drawing.locked) return;
    const { pane, drawing } = selectedDrawing;
    if (drawing.type !== 'longPosition' && drawing.type !== 'shortPosition') return;
    const current = Number(drawing.quantity) > 0 ? Number(drawing.quantity) : 1;
    const raw = await showTextPrompt(String(current), 'Taille de position (quantité)');
    if (raw === null) return;
    const q = parseFloat(String(raw).replace(',', '.'));
    if (!Number.isFinite(q) || q <= 0) return;
    const before = snapshotDrawing(drawing);
    drawing.quantity = q;
    document.getElementById('dcm-qty-label').textContent = '×' + formatQty(q);
    pushUndo(pane, { type: 'modify', drawingRef: drawing, before, after: snapshotDrawing(drawing) });
    drawing._primitive?.refresh();
    redrawPane(pane);
    scheduleWorkspaceSave();
  });

  // NOUVEAU : SL/TP en pips — boîte de dialogue dédiée à deux champs (au lieu de faire glisser
  // les poignées) pour choisir directement le nombre de pips de stop et de take profit, comme
  // le panneau de propriétés d'une position TradingView.
  document.getElementById('dcm-pips')?.addEventListener('click', async () => {
    if (!selectedDrawing || selectedDrawing.drawing.locked) return;
    const { pane, drawing } = selectedDrawing;
    if (drawing.type !== 'longPosition' && drawing.type !== 'shortPosition') return;
    const isLong = drawing.type === 'longPosition';
    const currentSl = Math.abs(priceToPips(drawing.entryPrice - drawing.stopPrice));
    const currentTp = Math.abs(priceToPips(drawing.targetPrice - drawing.entryPrice));
    const result = await showPipsPrompt(currentSl, currentTp);
    if (!result) return;
    const pip = getPipSize();
    const before = snapshotDrawing(drawing);
    if (Number.isFinite(result.sl) && result.sl > 0) {
      drawing.stopPrice = isLong
        ? drawing.entryPrice - result.sl * pip
        : drawing.entryPrice + result.sl * pip;
    }
    if (Number.isFinite(result.tp) && result.tp > 0) {
      drawing.targetPrice = isLong
        ? drawing.entryPrice + result.tp * pip
        : drawing.entryPrice - result.tp * pip;
    }
    document.getElementById('dcm-pips-label').textContent =
      `${Math.abs(priceToPips(drawing.entryPrice - drawing.stopPrice)).toFixed(1)} / ${Math.abs(priceToPips(drawing.targetPrice - drawing.entryPrice)).toFixed(1)} pips`;
    pushUndo(pane, { type: 'modify', drawingRef: drawing, before, after: snapshotDrawing(drawing) });
    drawing._primitive?.refresh();
    redrawPane(pane);
    scheduleWorkspaceSave();
  });

  document.getElementById('dcm-width-btn').addEventListener('click', () => {
    if (!selectedDrawing || selectedDrawing.drawing.locked) return;
    const willShow = !popover.classList.contains('visible');
    if (willShow) {
      positionPopoverAboveMenu(popover, menu);
      popover.querySelectorAll('.dcm-width-option').forEach(btn => {
        btn.classList.toggle('active', parseInt(btn.dataset.width, 10) === (selectedDrawing.drawing.lineWidth || DEFAULT_LINE_WIDTH[selectedDrawing.drawing.type]));
      });
    }
    popover.classList.toggle('visible', willShow);
  });

  popover.addEventListener('click', (e) => {
    const btn = e.target.closest('.dcm-width-option');
    if (!btn || !selectedDrawing) return;
    const width = parseInt(btn.dataset.width, 10);
    applyDrawingWidth(selectedDrawing.pane, selectedDrawing.drawing, width);
    document.getElementById('dcm-width-icon').innerHTML = widthLineSvg(width).match(/<line.*?\/>/)[0];
    document.getElementById('dcm-width-label').textContent = `${width}px`;
    hideWidthPopover();
  });

  // NOUVEAU : opacité du remplissage (rectangle / positions), réglable via jauge au lieu d'être
  // fixée en dur — voir applyFillOpacity() et le rendu dans 03-drawing-primitives.js / 04-propfirm.js.
  const fillOpacityBtn = document.getElementById('dcm-fillopacity-btn');
  const fillOpacityPopover = document.getElementById('dcm-fillopacity-popover');
  const fillOpacitySlider = document.getElementById('dcm-fillopacity-slider');
  fillOpacityBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!selectedDrawing || selectedDrawing.drawing.locked) return;
    const { drawing } = selectedDrawing;
    const willShow = !fillOpacityPopover.classList.contains('visible');
    if (willShow) {
      const defaultOpacity = drawing.type === 'rectangle' ? 0.25 : 0.22;
      fillOpacitySlider.value = String(Math.round((drawing.fillOpacity ?? drawing.bgOpacity ?? defaultOpacity) * 100));
      positionPopoverAboveMenu(fillOpacityPopover, menu);
    }
    fillOpacityPopover.classList.toggle('visible', willShow);
  });
  fillOpacitySlider.addEventListener('input', (e) => {
    if (!selectedDrawing || selectedDrawing.drawing.locked) return;
    const { drawing } = selectedDrawing;
    const pct = parseInt(e.target.value, 10);
    drawing.fillOpacity = pct / 100;
    document.getElementById('dcm-fillopacity-label').textContent = `${pct}%`;
    drawing._primitive?.refresh();
    scheduleWorkspaceSave();
  });

  // NOUVEAU : taille du texte — même mécanique que le popover d'épaisseur (options fixes).
  const fontSizeBtn = document.getElementById('dcm-fontsize-btn');
  fontSizeBtn.addEventListener('click', () => {
    if (!selectedDrawing || selectedDrawing.drawing.locked) return;
    const willShow = !fontSizePopover.classList.contains('visible');
    if (willShow) {
      positionPopoverAboveMenu(fontSizePopover, menu);
      fontSizePopover.querySelectorAll('.dcm-width-option').forEach(btn => {
        btn.classList.toggle('active', parseInt(btn.dataset.fontsize, 10) === (selectedDrawing.drawing.fontSize || DEFAULT_FONT_SIZE));
      });
    }
    fontSizePopover.classList.toggle('visible', willShow);
  });
  fontSizePopover.addEventListener('click', (e) => {
    const btn = e.target.closest('.dcm-width-option');
    if (!btn || !selectedDrawing) return;
    const { drawing } = selectedDrawing;
    drawing.fontSize = parseInt(btn.dataset.fontsize, 10);
    document.getElementById('dcm-fontsize-label').textContent = `${drawing.fontSize}px`;
    drawing._primitive?.refresh();
    scheduleWorkspaceSave();
    fontSizePopover.classList.remove('visible');
  });

  document.getElementById('dcm-edit-text').addEventListener('click', async () => {
    if (!selectedDrawing || selectedDrawing.drawing.locked) return;
    const { drawing } = selectedDrawing;
    const txt = await showTextPrompt(drawing.text || '', 'Texte du dessin');
    if (txt === null) return; // annulé : on ne touche à rien
    drawing.text = txt;
    if (drawing.type === 'horizontal' && drawing.priceLine) {
      drawing.priceLine.applyOptions({ title: txt });
    } else {
      drawing._primitive?.refresh();
    }
    refreshTextColorButton(drawing); // NOUVEAU : montre/cache le bouton "Couleur du texte" selon le texte désormais présent (ou vidé)
    scheduleWorkspaceSave();
  });

  // NOUVEAU : position du texte du rectangle (Haut / Bas / Intérieur)
  document.getElementById('dcm-textpos-btn').addEventListener('click', () => {
    if (!selectedDrawing || selectedDrawing.drawing.locked) return;
    const willShow = !textPosPopover.classList.contains('visible');
    if (willShow) {
      positionPopoverAboveMenu(textPosPopover, menu);
      const current = selectedDrawing.drawing.textPosition || 'top';
      textPosPopover.querySelectorAll('.dcm-textpos-option').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.pos === current);
      });
    }
    textPosPopover.classList.toggle('visible', willShow);
  });

  textPosPopover.addEventListener('click', (e) => {
    const btn = e.target.closest('.dcm-textpos-option');
    if (!btn || !selectedDrawing || selectedDrawing.drawing.locked) return;
    const { pane, drawing } = selectedDrawing;
    const before = snapshotDrawing(drawing);
    drawing.textPosition = btn.dataset.pos;
    pushUndo(pane, { type: 'modify', drawingRef: drawing, before, after: snapshotDrawing(drawing) });
    document.getElementById('dcm-textpos-label').textContent = TEXT_POSITION_LABELS[drawing.textPosition];
    drawing._primitive?.refresh();
    scheduleWorkspaceSave();
    hideTextPosPopover();
  });

  document.getElementById('dcm-lock').addEventListener('click', () => {
    if (!selectedDrawing) return;
    const { pane, drawing } = selectedDrawing;
    drawing.locked = !drawing.locked;
    showDrawingMenu(pane, drawing, parseFloat(menu.style.left), parseFloat(menu.style.top)); // rafraîchit l'état visuel
    scheduleWorkspaceSave();
  });

  document.getElementById('dcm-delete').addEventListener('click', () => {
    if (!selectedDrawing || selectedDrawing.drawing.locked) return;
    const { pane, drawing } = selectedDrawing;
    removeDrawing(pane, drawing);
    hideDrawingMenu();
  });

  // Ferme le menu (et les popovers d'épaisseur / opacité / taille de texte / position du texte) au clic ailleurs
  document.addEventListener('mousedown', (e) => {
    if (popover.classList.contains('visible') && !popover.contains(e.target) && !document.getElementById('dcm-width-btn').contains(e.target)) hideWidthPopover();
    if (fillOpacityPopover.classList.contains('visible') && !fillOpacityPopover.contains(e.target) && !fillOpacityBtn.contains(e.target)) fillOpacityPopover.classList.remove('visible');
    if (fontSizePopover.classList.contains('visible') && !fontSizePopover.contains(e.target) && !fontSizeBtn.contains(e.target)) fontSizePopover.classList.remove('visible');
    if (textPosPopover.classList.contains('visible') && !textPosPopover.contains(e.target) && !document.getElementById('dcm-textpos-btn').contains(e.target)) hideTextPosPopover();
    if (menu.classList.contains('visible') && !menu.contains(e.target) && !popover.contains(e.target) && !fillOpacityPopover.contains(e.target) && !fontSizePopover.contains(e.target) && !textPosPopover.contains(e.target)) hideDrawingMenu();
  });
}

// Appelé par chart.subscribeClick() (branché dans createPane) : ignoré tant qu'un outil de
// placement est actif, puisque l'overlay pane.canvas capte alors les clics avant qu'ils
// n'atteignent le graphique natif.
function handlePaneChartClick(pane, param) {
  if (currentTool || advTool) return;
  // Replay : choisir le départ en cliquant une bougie
  if (replayState.enabled && replayState.pickStartOnChart && param?.time != null) {
    const t = typeof param.time === 'object' ? param.time : param.time;
    let idx = 0;
    for (let i = 0; i < rawCandleData.length; i++) {
      if (rawCandleData[i].time <= t) idx = i;
      else break;
    }
    replayState.pickStartOnChart = false;
    setReplayIndex(idx, { fit: true });
    return;
  }
  if (dragState || justFinishedDrag || pendingDrag) return;
  if (!param.point) { clearDrawingSelection(); return; }
  setActivePane(pane.index);
  const hit = findDrawingAtPoint(pane, param.point.x, param.point.y);
  if (hit) {
    // CORRECTIF : le menu flottant n'était jamais réellement ouvert ici (le clic droit évoqué
    // dans l'ancien commentaire n'était géré nulle part) — on l'affiche dès la sélection, comme
    // pour tout autre dessin, afin d'avoir un comportement cohérent avec TradingView.
    selectAndShowDrawingMenu(pane, hit);
    redrawPane(pane);
  } else {
    clearDrawingSelection();
  }
}

function setTool(tool) {
  hideDrawingMenu();
  if (tool) clearDrawingSelection();
  currentTool = tool || null;
  advTool = null;
  panes.forEach(p => { p.pendingPoints = []; p.advPendingPoints = []; });
  updateCanvasPointerEvents();
  document.querySelectorAll('.tool-btn[data-tool]').forEach(b => b.classList.toggle('active', (b.dataset.tool || '') === (currentTool || '')));
  document.querySelectorAll('#advanced-tools-panel .adv-tool-btn').forEach(b => b.classList.remove('active'));
  syncFavBarActiveState();
}

function finishDrawingAction() { setTool(null); }

async function handlePaneCanvasClick(pane, e) {
  if (!currentTool && !advTool) return;
  setActivePane(pane.index);

  const resolveCoords = () => {
    const rect = pane.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    return {
      time: coordinateToTimeSafe(pane, pane.chart.timeScale(), x),
      price: pane.series.coordinateToPrice(y)
    };
  };

  let { time, price } = resolveCoords();
  // CORRECTIF : au tout premier clic juste après l'activation d'un outil, l'échelle interne
  // du graphique (timeScale/priceScale) n'a parfois pas fini son recalcul de layout au moment
  // exact du clic (le canvas overlay vient de passer de pointer-events:none à auto) —
  // coordinateToTime/coordinateToPrice renvoient alors null et le clic était jusqu'ici
  // silencieusement ignoré, obligeant à cliquer une 2e fois. On attend une frame et on retente
  // une fois avant d'abandonner : le placement devient fiable dès le 1er clic.
  if (time === null || price === null) {
    await new Promise(requestAnimationFrame);
    ({ time, price } = resolveCoords());
  }
  if (time === null || price === null) return;

  // NOUVEAU : aimant OHLC
  ({ time, price } = snapToMagnet(pane, time, price));

  // NOUVEAU : placement interactif d'un outil avancé (lightweight-charts-drawing) —
  // on accumule les clics jusqu'à atteindre le nombre d'ancres requis par l'outil.
  if (advTool) {
    if (!pane.advPendingPoints) pane.advPendingPoints = [];
    pane.advPendingPoints.push({ time, price });
    if (pane.advPendingPoints.length >= advTool.anchors) {
      addAdvancedDrawing(pane, advTool, pane.advPendingPoints);
      pane.advPendingPoints = [];
      setAdvancedTool(null);
    }
    return;
  }

  if (currentTool === 'horizontal') {
    addDrawingToPane(pane, { type: 'horizontal', price });
    finishDrawingAction();
  } else if (currentTool === 'vertical') {
    addDrawingToPane(pane, { type: 'vertical', time });
    finishDrawingAction();
  } else if (currentTool === 'horizontalRay') {
    // NOUVEAU : rayon horizontal natif (ShapePrimitive), 1 seul clic pose l'ancre —
    // remplace l'ancien outil dépendant de lightweight-charts-drawing (voir ADVANCED_TOOLS).
    addDrawingToPane(pane, { type: 'horizontalRay', time, price });
    finishDrawingAction();
  } else if (currentTool === 'text') {
    finishDrawingAction(); // désactive l'outil pendant que la boîte de dialogue est ouverte
    const txt = await showTextPrompt('', 'Ajouter un texte');
    if (txt) {
      addDrawingToPane(pane, { type: 'text', time, price, text: txt });
    }
  } else if (currentTool === 'trend' || currentTool === 'arrow' || currentTool === 'rectangle' || currentTool === 'segment') {
    pane.pendingPoints.push({ time, price });
    if (pane.pendingPoints.length === 2) {
      const drawing = { type: currentTool, p1: pane.pendingPoints[0], p2: pane.pendingPoints[1] };
      addDrawingToPane(pane, drawing);
      pane.pendingPoints = [];
      finishDrawingAction();
    } else {
      redrawPane(pane);
    }
  } else if (currentTool === 'longPosition' || currentTool === 'shortPosition') {
    // NOUVEAU : un seul clic place la position ENTIÈRE (entrée + stop + cible) avec des valeurs
    // par défaut — plus besoin de 3 clics successifs. Le stop et la cible restent ensuite
    // ajustables à tout moment en glissant leurs poignées (comme avant), le ratio par défaut
    // étant 1:2 (récompense = 2× le risque).
    // CORRECTIF : capturer le type AVANT finishDrawingAction(), qui remet currentTool à null —
    // sinon le dessin était créé avec type: null (invisible, rien ne s'affichait).
    const toolType = currentTool;
    const isLong = toolType === 'longPosition';
    finishDrawingAction();
    // Plage de prix actuellement visible à l'écran (indépendante de l'instrument : fonctionne
    // pareil sur le forex, les indices ou les actions, contrairement à un nombre de pips fixe).
    const h = pane.inner.clientHeight;
    const topPrice = pane.series.coordinateToPrice(0);
    const bottomPrice = pane.series.coordinateToPrice(h);
    let visibleRange = (topPrice != null && bottomPrice != null) ? Math.abs(topPrice - bottomPrice) : null;
    if (!visibleRange || !Number.isFinite(visibleRange) || visibleRange <= 0) {
      visibleRange = getPipSize() * 200; // repli si la plage visible n'est pas disponible
    }
    const stopOffset = visibleRange * 0.15;
    const targetOffset = visibleRange * 0.30;
    const stopPrice = isLong ? price - stopOffset : price + stopOffset;
    const targetPrice = isLong ? price + targetOffset : price - targetOffset;
    addDrawingToPane(pane, {
      type: toolType,
      entryTime: time,
      entryPrice: price,
      stopPrice,
      targetPrice,
      quantity: 1,
      endTime: time + Math.max(60, (pane.timeframe || 5) * 60 * 20)
    });
  } else if (['fibRetracement', 'ray', 'priceRange', 'ellipse', 'circle'].includes(currentTool)) {
    pane.pendingPoints.push({ time, price });
    if (pane.pendingPoints.length === 2) {
      addDrawingToPane(pane, {
        type: currentTool,
        p1: pane.pendingPoints[0],
        p2: pane.pendingPoints[1]
      });
      pane.pendingPoints = [];
      finishDrawingAction();
    } else {
      redrawPane(pane);
    }
  } else if (['fibExtension', 'parallelChannel', 'pitchfork', 'triangle'].includes(currentTool)) {
    pane.pendingPoints.push({ time, price });
    if (pane.pendingPoints.length === 3) {
      addDrawingToPane(pane, {
        type: currentTool,
        p1: pane.pendingPoints[0],
        p2: pane.pendingPoints[1],
        p3: pane.pendingPoints[2]
      });
      pane.pendingPoints = [];
      finishDrawingAction();
    } else {
      redrawPane(pane);
    }
  } else if (currentTool === 'zigzagArrow') {
    // NOUVEAU : nombre de points libre — chaque clic ajoute un point ; le tracé se termine par
    // double-clic ou touche Entrée (voir finishZigzagDrawing), jamais automatiquement sur un
    // décompte fixe.
    pane.pendingPoints.push({ time, price });
    redrawPane(pane);
  }
}

// Termine un tracé de flèche zigzag en cours (nombre de points libre). Le second clic d'un
// double-clic a déjà ajouté un point quasi identique au précédent via handlePaneCanvasClick
// (mousedown) ; on le retire avant de finaliser, puis on crée le dessin si au moins 2 points
// valides restent. Appelée par le double-clic sur le canvas et par la touche Entrée.
function finishZigzagDrawing(pane) {
  if (!pane || !pane.pendingPoints) return;
  const pts = pane.pendingPoints;
  const ts = pane.chart.timeScale();
  const sameSpot = (a, b) => {
    const ax = ts.timeToCoordinate(a.time), ay = pane.series.priceToCoordinate(a.price);
    const bx = ts.timeToCoordinate(b.time), by = pane.series.priceToCoordinate(b.price);
    if (ax === null || ay === null || bx === null || by === null) return false;
    return Math.hypot(ax - bx, ay - by) <= 4;
  };
  while (pts.length >= 2 && sameSpot(pts[pts.length - 1], pts[pts.length - 2])) pts.pop();
  pane.pendingPoints = [];
  if (pts.length >= 2) {
    addDrawingToPane(pane, { type: 'zigzagArrow', points: pts });
  } else {
    redrawPane(pane);
  }
  finishDrawingAction();
}

