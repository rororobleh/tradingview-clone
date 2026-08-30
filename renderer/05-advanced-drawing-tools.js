// ============================================================
// 05-advanced-drawing-tools.js
// Outils de dessin avancés natifs : Fibonacci, canal parallèle, rayon, pitchfork, mesure prix/temps, triangle, ellipse, flèche zigzag + rattachement/rendu des dessins sur un pane
// Fait partie de renderer.js (sectionné en modules le 2026-08-28).
// Chargé comme <script> classique dans index.html : les variables/fonctions
// top-level restent globales et partagées entre tous ces fichiers, exactement
// comme dans l'ancien renderer.js monolithique — aucun changement de comportement.
// ============================================================
// ============ Outils de dessin avancés natifs (Fibonacci, canal, rayon, pitchfork…) ============

function fibPrice(p1, p2, level) {
  return p1 + (p2 - p1) * level;
}

function drawFibRetracement(ctx, pane, series, ts, d) {
  const x1 = ts.timeToCoordinate(d.p1.time), y1 = series.priceToCoordinate(d.p1.price);
  const x2 = ts.timeToCoordinate(d.p2.time), y2 = series.priceToCoordinate(d.p2.price);
  if ([x1, y1, x2, y2].some(v => v === null)) return;
  const color = d.color || THEMES[currentTheme].drawColor;
  const levels = d.levels || FIB_LEVELS;
  const left = Math.min(x1, x2);
  const right = Math.max(x1, x2);
  const extendRight = d.extendRight !== false;
  const xRight = extendRight ? pane.inner.clientWidth : right;
  const xLeft = Math.min(left, right);

  // Ligne de trend entre les 2 ancres
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  ctx.setLineDash([]);

  const priceRange = d.p2.price - d.p1.price;
  for (const level of levels) {
    const price = d.p1.price + priceRange * level;
    const y = series.priceToCoordinate(price);
    if (y === null) continue;
    // Couleur par niveau (0 et 1 plus marqués)
    const alpha = (level === 0 || level === 1 || level === 0.618 || level === 0.5) ? 0.9 : 0.55;
    ctx.strokeStyle = hexToRgba(color, alpha);
    ctx.lineWidth = (level === 0 || level === 1) ? 1.5 : 1;
    ctx.beginPath();
    ctx.moveTo(xLeft, y);
    ctx.lineTo(xRight, y);
    ctx.stroke();
    const label = `${(level * 100).toFixed(level % 1 === 0 ? 0 : 1)}%  (${formatPriceLabel(price)})`;
    drawLabelBox(ctx, xRight - 4, y, label, color, 'right');
  }
  drawHandle(ctx, x1, y1, color);
  drawHandle(ctx, x2, y2, color);
  if (d.text) drawLabelBox(ctx, (x1 + x2) / 2, Math.min(y1, y2) - 12, d.text, color, 'center');
}

function drawFibExtension(ctx, pane, series, ts, d) {
  if (!d.p1 || !d.p2 || !d.p3) return; // dessin incomplet : rien à tracer plutôt que de planter
  // 3 points A-B-C : projection depuis C dans le sens A→B
  const pts = [d.p1, d.p2, d.p3];
  const coords = pts.map(p => ({
    x: ts.timeToCoordinate(p.time),
    y: series.priceToCoordinate(p.price)
  }));
  if (coords.some(c => c.x === null || c.y === null)) return;
  const color = d.color || THEMES[currentTheme].drawColor;
  const levels = d.levels || FIB_EXT_LEVELS;

  // Segments A-B et B-C
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(coords[0].x, coords[0].y);
  ctx.lineTo(coords[1].x, coords[1].y);
  ctx.lineTo(coords[2].x, coords[2].y);
  ctx.stroke();
  ctx.setLineDash([]);

  const move = d.p2.price - d.p1.price;
  const xRight = pane.inner.clientWidth;
  const xLeft = Math.min(coords[0].x, coords[1].x, coords[2].x);
  for (const level of levels) {
    const price = d.p3.price + move * level;
    const y = series.priceToCoordinate(price);
    if (y === null) continue;
    ctx.strokeStyle = hexToRgba(color, 0.7);
    ctx.lineWidth = level === 1 || level === 1.618 ? 1.5 : 1;
    ctx.beginPath();
    ctx.moveTo(xLeft, y);
    ctx.lineTo(xRight, y);
    ctx.stroke();
    drawLabelBox(ctx, xRight - 4, y, `Ext ${(level * 100).toFixed(1)}%  (${formatPriceLabel(price)})`, color, 'right');
  }
  coords.forEach(c => drawHandle(ctx, c.x, c.y, color));
  if (d.text) drawLabelBox(ctx, coords[2].x, coords[2].y - 14, d.text, color, 'center');
}

function drawParallelChannel(ctx, pane, series, ts, d) {
  if (!d.p1 || !d.p2 || !d.p3) return; // dessin incomplet : rien à tracer plutôt que de planter
  // p1-p2 = base trend, p3 définit la largeur (offset parallèle)
  const x1 = ts.timeToCoordinate(d.p1.time), y1 = series.priceToCoordinate(d.p1.price);
  const x2 = ts.timeToCoordinate(d.p2.time), y2 = series.priceToCoordinate(d.p2.price);
  const x3 = ts.timeToCoordinate(d.p3.time), y3 = series.priceToCoordinate(d.p3.price);
  if ([x1, y1, x2, y2, x3, y3].some(v => v === null)) return;
  const color = d.color || THEMES[currentTheme].drawColor;

  // Offset : distance perpendiculaire de p3 à la ligne p1-p2, en espace écran puis répliquée
  // Approximation en prix : on projette p3 sur le segment prix/temps
  const dx = x2 - x1 || 1;
  const dy = y2 - y1;
  // Point parallèle : p3 définit le décalage vertical "moyen"
  // Formule : ligne parallèle passant par p3 avec même pente
  // y = y3 + (dy/dx)*(x - x3)
  // Aux extrémités du canal on étend
  const extend = d.extend !== false;
  const w = pane.inner.clientWidth;
  let xa = extend ? 0 : Math.min(x1, x2);
  let xb = extend ? w : Math.max(x1, x2);
  const yA1 = y1 + (dy / dx) * (xa - x1);
  const yB1 = y1 + (dy / dx) * (xb - x1);
  // Offset en pixels de p3 par rapport à la ligne
  const t = ((x3 - x1) * dx + (y3 - y1) * dy) / (dx * dx + dy * dy);
  const projX = x1 + t * dx, projY = y1 + t * dy;
  const offX = x3 - projX, offY = y3 - projY;

  const yA2 = yA1 + offY;
  const yB2 = yB1 + offY;

  // Remplissage
  ctx.fillStyle = hexToRgba(color, 0.1);
  ctx.beginPath();
  ctx.moveTo(xa, yA1); ctx.lineTo(xb, yB1); ctx.lineTo(xb, yB2); ctx.lineTo(xa, yA2);
  ctx.closePath(); ctx.fill();

  // Lignes
  ctx.strokeStyle = color;
  ctx.lineWidth = d.lineWidth || 1.5;
  ctx.beginPath(); ctx.moveTo(xa, yA1); ctx.lineTo(xb, yB1); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(xa, yA2); ctx.lineTo(xb, yB2); ctx.stroke();
  // Médiane
  ctx.setLineDash([4, 3]);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(xa, (yA1 + yA2) / 2);
  ctx.lineTo(xb, (yB1 + yB2) / 2);
  ctx.stroke();
  ctx.setLineDash([]);

  drawHandle(ctx, x1, y1, color);
  drawHandle(ctx, x2, y2, color);
  drawHandle(ctx, x3, y3, color);
  if (d.text) drawLabelBox(ctx, (x1 + x2) / 2, (y1 + y2) / 2 - 12, d.text, color, 'center');
}

function drawRay(ctx, pane, series, ts, d) {
  const x1 = ts.timeToCoordinate(d.p1.time), y1 = series.priceToCoordinate(d.p1.price);
  const x2 = ts.timeToCoordinate(d.p2.time), y2 = series.priceToCoordinate(d.p2.price);
  if ([x1, y1, x2, y2].some(v => v === null)) return;
  const color = d.color || THEMES[currentTheme].drawColor;
  const w = pane.inner.clientWidth, h = pane.inner.clientHeight;
  const dx = x2 - x1, dy = y2 - y1;
  // Étend dans la direction p1→p2 jusqu'au bord
  let tMax = 1e6;
  if (dx > 0) tMax = Math.min(tMax, (w - x1) / dx);
  else if (dx < 0) tMax = Math.min(tMax, (0 - x1) / dx);
  if (dy > 0) tMax = Math.min(tMax, (h - y1) / dy);
  else if (dy < 0) tMax = Math.min(tMax, (0 - y1) / dy);
  const xEnd = x1 + dx * tMax, yEnd = y1 + dy * tMax;

  ctx.strokeStyle = color;
  ctx.lineWidth = d.lineWidth || 2;
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(xEnd, yEnd); ctx.stroke();
  drawHandle(ctx, x1, y1, color);
  drawHandle(ctx, x2, y2, color);
  if (d.text) drawLabelBox(ctx, (x1 + x2) / 2, (y1 + y2) / 2 - 12, d.text, color, 'center');
}

// NOUVEAU : rayon horizontal natif — une seule ancre (time, price), s'étend horizontalement de
// cette ancre jusqu'au bord droit du pane. Remplace l'ancien outil "HorizontalRay (lib)" qui
// dépendait de lightweight-charts-drawing (voir ADVANCED_TOOLS dans 02-favorites-drawinglib-utils.js).
function drawHorizontalRay(ctx, pane, series, ts, d) {
  const x1 = ts.timeToCoordinate(d.time), y = series.priceToCoordinate(d.price);
  if (x1 === null || y === null) return;
  const color = d.color || THEMES[currentTheme].drawColor;
  const xEnd = pane.inner.clientWidth;

  ctx.strokeStyle = color;
  ctx.lineWidth = d.lineWidth || DEFAULT_LINE_WIDTH.horizontalRay;
  ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(xEnd, y); ctx.stroke();
  drawHandle(ctx, x1, y, color);
  // Étiquette de prix collée au bord droit, comme les autres outils étendus à l'infini
  drawLabelBox(ctx, xEnd - 4, y, formatPriceLabel(d.price), color, 'right');
  if (d.text) drawLabelBox(ctx, x1 + 40, y - 12, d.text, color, 'center');
}

function drawPitchfork(ctx, pane, series, ts, d) {
  if (!d.p1 || !d.p2 || !d.p3) return; // dessin incomplet : rien à tracer plutôt que de planter
  // Andrews: p1 pivot, p2 et p3 définissent la base ; médiane de p1 vers milieu(p2,p3)
  const c = [d.p1, d.p2, d.p3].map(p => ({
    x: ts.timeToCoordinate(p.time),
    y: series.priceToCoordinate(p.price)
  }));
  if (c.some(p => p.x === null || p.y === null)) return;
  const color = d.color || THEMES[currentTheme].drawColor;
  const mid = { x: (c[1].x + c[2].x) / 2, y: (c[1].y + c[2].y) / 2 };
  const w = pane.inner.clientWidth, h = pane.inner.clientHeight;
  const dx = mid.x - c[0].x, dy = mid.y - c[0].y;
  let tMax = 1e6;
  if (Math.abs(dx) > 0.1) tMax = Math.min(tMax, dx > 0 ? (w - c[0].x) / dx : (0 - c[0].x) / dx);
  if (Math.abs(dy) > 0.1) tMax = Math.min(tMax, dy > 0 ? (h - c[0].y) / dy : (0 - c[0].y) / dy);
  tMax = Math.max(tMax, 2);

  const end = { x: c[0].x + dx * tMax, y: c[0].y + dy * tMax };
  const off1 = { x: c[1].x - mid.x, y: c[1].y - mid.y };
  const off2 = { x: c[2].x - mid.x, y: c[2].y - mid.y };

  // Médiane
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(c[0].x, c[0].y); ctx.lineTo(end.x, end.y); ctx.stroke();
  // Branches parallèles
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(c[1].x, c[1].y);
  ctx.lineTo(end.x + off1.x, end.y + off1.y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(c[2].x, c[2].y);
  ctx.lineTo(end.x + off2.x, end.y + off2.y);
  ctx.stroke();
  // Base p2-p3
  ctx.setLineDash([4, 3]);
  ctx.beginPath(); ctx.moveTo(c[1].x, c[1].y); ctx.lineTo(c[2].x, c[2].y); ctx.stroke();
  ctx.setLineDash([]);

  c.forEach(p => drawHandle(ctx, p.x, p.y, color));
  if (d.text) drawLabelBox(ctx, mid.x, mid.y - 12, d.text, color, 'center');
}

function drawPriceRange(ctx, pane, series, ts, d) {
  const x1 = ts.timeToCoordinate(d.p1.time), y1 = series.priceToCoordinate(d.p1.price);
  const x2 = ts.timeToCoordinate(d.p2.time), y2 = series.priceToCoordinate(d.p2.price);
  if ([x1, y1, x2, y2].some(v => v === null)) return;
  const color = d.color || THEMES[currentTheme].accent3 || '#00d9a3';
  const rx = Math.min(x1, x2), ry = Math.min(y1, y2);
  const rw = Math.abs(x2 - x1), rh = Math.abs(y2 - y1);

  ctx.fillStyle = hexToRgba(color, 0.12);
  ctx.fillRect(rx, ry, rw, rh);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.strokeRect(rx, ry, rw, rh);
  ctx.setLineDash([]);

  // Crochets de mesure
  ctx.beginPath();
  ctx.moveTo(x1, y1); ctx.lineTo(x2, y1); ctx.lineTo(x2, y2);
  ctx.stroke();

  const priceDiff = d.p2.price - d.p1.price;
  const pct = d.p1.price !== 0 ? (priceDiff / Math.abs(d.p1.price)) * 100 : 0;
  const bars = Math.round(Math.abs(d.p2.time - d.p1.time) / Math.max(60, (pane.timeframe || 5) * 60));
  // NOUVEAU : ajout du delta en pips (mesure des pips), comme sur TradingView
  const label = `${priceDiff >= 0 ? '+' : ''}${formatPriceLabel(priceDiff)}  ·  ${formatPips(priceDiff)}  (${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%)  ·  ${bars} barres`;
  drawLabelBox(ctx, (x1 + x2) / 2, (y1 + y2) / 2, label, color, 'center');
  drawHandle(ctx, x1, y1, color);
  drawHandle(ctx, x2, y2, color);
}

function drawTriangle(ctx, pane, series, ts, d) {
  if (!d.p1 || !d.p2 || !d.p3) return; // dessin incomplet : rien à tracer plutôt que de planter
  const pts = [d.p1, d.p2, d.p3].map(p => ({
    x: ts.timeToCoordinate(p.time),
    y: series.priceToCoordinate(p.price)
  }));
  if (pts.some(p => p.x === null || p.y === null)) return;
  const color = d.color || THEMES[currentTheme].drawColor;
  ctx.fillStyle = hexToRgba(d.bgColor || color, 0.12);
  ctx.strokeStyle = color;
  ctx.lineWidth = d.lineWidth || 1.5;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  ctx.lineTo(pts[1].x, pts[1].y);
  ctx.lineTo(pts[2].x, pts[2].y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  pts.forEach(p => drawHandle(ctx, p.x, p.y, color));
  if (d.text) drawLabelBox(ctx, (pts[0].x + pts[1].x + pts[2].x) / 3, (pts[0].y + pts[1].y + pts[2].y) / 3, d.text, color, 'center');
}

function drawEllipse(ctx, pane, series, ts, d) {
  const x1 = ts.timeToCoordinate(d.p1.time), y1 = series.priceToCoordinate(d.p1.price);
  const x2 = ts.timeToCoordinate(d.p2.time), y2 = series.priceToCoordinate(d.p2.price);
  if ([x1, y1, x2, y2].some(v => v === null)) return;
  const color = d.color || THEMES[currentTheme].drawColor;
  const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
  const rx = Math.abs(x2 - x1) / 2, ry = Math.abs(y2 - y1) / 2;
  ctx.fillStyle = hexToRgba(d.bgColor || color, 0.12);
  ctx.strokeStyle = color;
  ctx.lineWidth = d.lineWidth || 1.5;
  ctx.beginPath();
  ctx.ellipse(cx, cy, Math.max(1, rx), Math.max(1, ry), 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  drawHandle(ctx, x1, y1, color);
  drawHandle(ctx, x2, y2, color);
  if (d.text) drawLabelBox(ctx, cx, cy - ry - 10, d.text, color, 'center');
}

// NOUVEAU : cercle natif — p1 = centre, p2 = point définissant le rayon (distance écran entre
// les deux). Contrairement à drawEllipse() ci-dessus (boîte englobante p1/p2, donc déformée si
// les échelles prix/temps ne sont pas identiques), reste un cercle parfait quel que soit le zoom.
// Remplace l'ancien outil "Cercle (lib)" qui dépendait de lightweight-charts-drawing.
function drawCircle(ctx, pane, series, ts, d) {
  const x1 = ts.timeToCoordinate(d.p1.time), y1 = series.priceToCoordinate(d.p1.price);
  const x2 = ts.timeToCoordinate(d.p2.time), y2 = series.priceToCoordinate(d.p2.price);
  if ([x1, y1, x2, y2].some(v => v === null)) return;
  const color = d.color || THEMES[currentTheme].drawColor;
  const radius = Math.hypot(x2 - x1, y2 - y1);
  ctx.fillStyle = hexToRgba(d.bgColor || color, 0.12);
  ctx.strokeStyle = color;
  ctx.lineWidth = d.lineWidth || 1.5;
  ctx.beginPath();
  ctx.arc(x1, y1, Math.max(1, radius), 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  drawHandle(ctx, x1, y1, color);
  drawHandle(ctx, x2, y2, color);
  if (d.text) drawLabelBox(ctx, x1, y1 - radius - 10, d.text, color, 'center');
}

// NOUVEAU : flèche en zigzag à nombre de points LIBRE (d.points = [{time,price}, ...], 2 points
// minimum), utile pour annoter un mouvement en plusieurs temps (impulsion, correction, nouvelle
// impulsion, etc.) avec une seule flèche terminale au dernier segment, plutôt que d'empiler des
// flèches simples.
//
// Rétrocompatibilité : les dessins créés par une version antérieure de l'app stockent leurs 3
// points fixes dans d.p1/d.p2/d.p3 plutôt que dans d.points. getZigzagPoints() lit les deux
// formats ; migrateZigzagDrawing() convertit un dessin ancien format vers d.points en place
// (utilisé à l'hydratation du workspace et avant tout déplacement de poignée), afin que le reste
// du code n'ait plus qu'un seul format à connaître.

// Retourne le tableau de points d'un dessin zigzag, quel que soit le format de stockage.
// Ne mute jamais `d`. Retourne null si le dessin n'a pas assez de points pour être tracé.
function getZigzagPoints(d) {
  if (Array.isArray(d.points)) return d.points.length >= 2 ? d.points : null;
  if (d.p1 && d.p2 && d.p3) return [d.p1, d.p2, d.p3]; // ancien format à 3 points fixes
  if (d.p1 && d.p2) return [d.p1, d.p2];
  return null;
}

// Migre un dessin zigzag ancien format (p1/p2/p3) vers le nouveau format (points[]), en place.
// Idempotent : ne fait rien si `d.points` existe déjà ou si `d` n'est pas un zigzagArrow.
function migrateZigzagDrawing(d) {
  if (!d || d.type !== 'zigzagArrow' || Array.isArray(d.points)) return d;
  const pts = getZigzagPoints(d);
  if (pts) {
    d.points = pts;
    delete d.p1; delete d.p2; delete d.p3;
  }
  return d;
}

function drawZigzagArrow(ctx, pane, series, ts, d) {
  // Garde-fou : dessin incomplet (ex. donnée corrompue/partielle provenant d'un ancien
  // workspace, ou appel pendant une transition d'état) — on ne tente pas de le tracer plutôt
  // que de planter sur `.time` d'un point manquant.
  const raw = getZigzagPoints(d);
  if (!raw) return;
  const pts = raw.map(p => ({
    x: ts.timeToCoordinate(p.time),
    y: series.priceToCoordinate(p.price)
  }));
  if (pts.some(p => p.x === null || p.y === null)) return;
  const color = d.color || THEMES[currentTheme].drawColor;
  ctx.strokeStyle = color;
  ctx.lineWidth = d.lineWidth || DEFAULT_LINE_WIDTH.zigzagArrow;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();

  // Tête de flèche uniquement sur le dernier segment (avant-dernier point → dernier point)
  const last = pts[pts.length - 1], prev = pts[pts.length - 2];
  const angle = Math.atan2(last.y - prev.y, last.x - prev.x), headLen = 11;
  ctx.beginPath();
  ctx.moveTo(last.x, last.y);
  ctx.lineTo(last.x - headLen * Math.cos(angle - Math.PI / 6), last.y - headLen * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(last.x - headLen * Math.cos(angle + Math.PI / 6), last.y - headLen * Math.sin(angle + Math.PI / 6));
  ctx.closePath();
  ctx.fill();

  pts.forEach(p => drawHandle(ctx, p.x, p.y, color));
  if (d.text) {
    const midX = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const midY = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    drawLabelBox(ctx, midX, midY - 14, d.text, color, 'center');
  }
}


// Attache la primitive (ou la price line native) manquante pour un dessin donné — utilisé au
// placement initial, après un changement de layout, et à la restauration du workspace.
function attachDrawingToPane(pane, drawing) {
  if (drawing.type === 'horizontal') {
    if (!drawing.priceLine) createNativePriceLine(pane, drawing);
  } else if (!drawing._primitive) {
    const primitive = new ShapePrimitive(pane, drawing);
    drawing._primitive = primitive;
    pane.series.attachPrimitive(primitive);
    // CORRECTIF : attachPrimitive() ne déclenche pas toujours un repaint immédiat — le graphique
    // ne peint le nouveau dessin qu'au prochain rendu interne (déclenché par un mousemove, un
    // clic, un resize...). Résultat : le dessin existait déjà en mémoire après le 1er clic mais
    // restait invisible jusqu'à ce qu'une action ultérieure force un repaint (d'où l'impression
    // qu'il fallait un 2e clic). On force ce repaint tout de suite.
    primitive.refresh();
  }
}


// (Re)crée les price lines / primitives manquantes pour tous les dessins d'une pane (après un
// changement de layout ou une restauration de workspace)
function syncPaneDrawings(pane) {
  for (const d of pane.drawings) attachDrawingToPane(pane, d);
}

// NOUVEAU : repères d'alignement pendant le tracé d'une ligne (trend/flèche/segment). Trace deux
// paires de guides pointillés plein cadre — un couple par point (départ + position souris
// actuelle) — pour voir immédiatement si le 2e point est parfaitement aligné horizontalement
// (même prix) ou verticalement (même instant) avec le 1er, ou au contraire s'il le dépasse. Un
// guide "aligné" (écart <= ALIGN_SNAP_PX) passe en surbrillance jaune ; sinon il reste discret,
// dans la couleur de dessin courante, semi-transparent.
const ALIGN_SNAP_PX = 6;
const ALIGN_GUIDE_COLOR = '#ffd54f';

function drawAlignmentGuides(ctx, w, h, x1, y1, x2, y2, baseColor) {
  const alignedH = Math.abs(y2 - y1) <= ALIGN_SNAP_PX; // même prix (ligne parfaitement horizontale)
  const alignedV = Math.abs(x2 - x1) <= ALIGN_SNAP_PX; // même instant (ligne parfaitement verticale)

  ctx.save();
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 4]);

  // Guides passant par le point de départ
  ctx.strokeStyle = alignedH ? ALIGN_GUIDE_COLOR : hexToRgba(baseColor, 0.35);
  ctx.beginPath(); ctx.moveTo(0, y1); ctx.lineTo(w, y1); ctx.stroke();
  ctx.strokeStyle = alignedV ? ALIGN_GUIDE_COLOR : hexToRgba(baseColor, 0.35);
  ctx.beginPath(); ctx.moveTo(x1, 0); ctx.lineTo(x1, h); ctx.stroke();

  // Guides passant par la position actuelle de la souris (2e point en cours de placement)
  ctx.strokeStyle = alignedH ? ALIGN_GUIDE_COLOR : hexToRgba(baseColor, 0.18);
  ctx.beginPath(); ctx.moveTo(0, y2); ctx.lineTo(w, y2); ctx.stroke();
  ctx.strokeStyle = alignedV ? ALIGN_GUIDE_COLOR : hexToRgba(baseColor, 0.18);
  ctx.beginPath(); ctx.moveTo(x2, 0); ctx.lineTo(x2, h); ctx.stroke();
  ctx.restore();

  // Petite croix sur le point de départ pour bien le repérer même une fois recouvert par la ligne
  ctx.save();
  ctx.strokeStyle = alignedH || alignedV ? ALIGN_GUIDE_COLOR : baseColor;
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(x2 - 6, y2); ctx.lineTo(x2 + 6, y2);
  ctx.moveTo(x2, y2 - 6); ctx.lineTo(x2, y2 + 6);
  ctx.stroke();
  ctx.restore();

  return { alignedH, alignedV };
}

function redrawPane(pane) {
  const canvas = pane.canvas;
  const w = pane.inner.clientWidth, h = pane.inner.clientHeight;
  if (w <= 0 || h <= 0) return;
  // HiDPI / Retina : bitmap en device pixels, dessin en CSS pixels
  const dpr = window.devicePixelRatio || 1;
  const bw = Math.max(1, Math.round(w * dpr));
  const bh = Math.max(1, Math.round(h * dpr));
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  // NOUVEAU : les dessins terminés (trend/arrow/rectangle/vertical/texte) ne sont plus rendus ici
  // — ce sont désormais des ShapePrimitive attachées à la série (voir plus haut), rendues sur le
  // même bitmap que les bougies. Ce canvas ne sert donc plus qu'à l'aperçu "élastique" pendant le
  // placement du 2e point d'un outil.
  const color = THEMES[currentTheme].drawColor;
  const ts = pane.chart.timeScale();

  // Aperçu "élastique" en direct pendant le placement du 2e point (ligne de tendance / flèche / rectangle)
  if (currentTool && (currentTool === 'trend' || currentTool === 'arrow' || currentTool === 'rectangle' || currentTool === 'segment') &&
      pane.pendingPoints.length === 1 && pane.mousePos) {
    const p1 = pane.pendingPoints[0];
    const x1 = ts.timeToCoordinate(p1.time), y1 = pane.series.priceToCoordinate(p1.price);
    if (x1 !== null && y1 !== null) {
      if (currentTool === 'rectangle') {
        const rx = Math.min(x1, pane.mousePos.x), ry = Math.min(y1, pane.mousePos.y);
        const rw = Math.abs(pane.mousePos.x - x1), rh = Math.abs(pane.mousePos.y - y1);
        ctx.fillStyle = hexToRgba(color, 0.12);
        ctx.fillRect(rx, ry, rw, rh);
        ctx.strokeStyle = color;
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(rx, ry, rw, rh);
        ctx.setLineDash([]);
      } else {
        // NOUVEAU : repères d'alignement (voir drawAlignmentGuides) — dessinés AVANT la ligne
        // elle-même pour rester en arrière-plan.
        const { alignedH, alignedV } = drawAlignmentGuides(ctx, w, h, x1, y1, pane.mousePos.x, pane.mousePos.y, color);

        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(pane.mousePos.x, pane.mousePos.y); ctx.stroke();
        ctx.setLineDash([]);
        drawHandle(ctx, x1, y1, color);

        // NOUVEAU : petite étiquette Δ prix (et un repère "H"/"V" si parfaitement aligné/dépassé)
        // pour vérifier précisément la position du 2e point sans avoir à le poser d'abord.
        const p2Price = pane.series.coordinateToPrice(pane.mousePos.y);
        if (p2Price != null) {
          const deltaPrice = p2Price - p1.price;
          const sign = deltaPrice >= 0 ? '+' : '';
          const prec = (priceFormat && priceFormat.precision != null) ? priceFormat.precision : 5;
          let label = `Δ ${sign}${deltaPrice.toFixed(prec)}`;
          if (alignedH) label += '  ⟷ aligné';
          if (alignedV) label += '  ↕ même instant';
          const labelColor = (alignedH || alignedV) ? ALIGN_GUIDE_COLOR : color;
          drawLabelBox(ctx, pane.mousePos.x + 10, pane.mousePos.y - 10, label, labelColor, 'left');
        }
      }
    }
  }

  // NOUVEAU : aperçu position longue/courte pendant le placement (2e et 3e clic)
  if (currentTool && (currentTool === 'longPosition' || currentTool === 'shortPosition') &&
      pane.pendingPoints.length >= 1 && pane.mousePos) {
    const isLong = currentTool === 'longPosition';
    const entry = pane.pendingPoints[0];
    const xEntry = ts.timeToCoordinate(entry.time);
    const yEntry = pane.series.priceToCoordinate(entry.price);
    if (xEntry !== null && yEntry !== null) {
      drawHandle(ctx, xEntry, yEntry, color);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(xEntry - 20, yEntry);
      ctx.lineTo(xEntry + 20, yEntry);
      ctx.stroke();
      ctx.setLineDash([]);

      let stopPrice, targetPrice, endX;
      if (pane.pendingPoints.length === 1) {
        // 2e point en cours : stop + largeur
        const price = pane.series.coordinateToPrice(pane.mousePos.y);
        stopPrice = price != null ? price : entry.price;
        // Cible provisoire à R:R 2:1
        const risk = Math.abs(entry.price - stopPrice) || 0.0001;
        targetPrice = isLong ? entry.price + 2 * risk : entry.price - 2 * risk;
        endX = Math.max(xEntry + 40, pane.mousePos.x);
      } else {
        // 3e point en cours : cible
        const stopPt = pane.pendingPoints[1];
        stopPrice = stopPt.price;
        const price = pane.series.coordinateToPrice(pane.mousePos.y);
        targetPrice = price != null ? price : entry.price;
        const xStop = ts.timeToCoordinate(stopPt.time);
        endX = Math.max(xEntry + 40, xStop != null ? xStop : xEntry, pane.mousePos.x);
      }

      const yStop = pane.series.priceToCoordinate(stopPrice);
      const yTarget = pane.series.priceToCoordinate(targetPrice);
      if (yStop !== null && yTarget !== null) {
        const rx = Math.min(xEntry, endX);
        const rw = Math.abs(endX - xEntry);
        // risque
        ctx.fillStyle = 'rgba(239, 83, 80, 0.18)';
        ctx.fillRect(rx, Math.min(yEntry, yStop), rw, Math.abs(yStop - yEntry));
        // récompense
        ctx.fillStyle = 'rgba(38, 166, 154, 0.18)';
        ctx.fillRect(rx, Math.min(yEntry, yTarget), rw, Math.abs(yTarget - yEntry));
        ctx.strokeStyle = '#ef5350';
        ctx.setLineDash([4, 3]);
        ctx.beginPath(); ctx.moveTo(rx, yStop); ctx.lineTo(rx + rw, yStop); ctx.stroke();
        ctx.strokeStyle = '#26a69a';
        ctx.beginPath(); ctx.moveTo(rx, yTarget); ctx.lineTo(rx + rw, yTarget); ctx.stroke();
        ctx.setLineDash([]);
        const risk = Math.abs(entry.price - stopPrice);
        const reward = Math.abs(targetPrice - entry.price);
        const rr = risk > 0 ? reward / risk : 0;
        drawLabelBox(ctx, rx + rw / 2, (Math.min(yEntry, yStop, yTarget) + Math.max(yEntry, yStop, yTarget)) / 2,
          `${isLong ? 'Long' : 'Short'}  R:R 1:${rr.toFixed(2)}`, isLong ? '#26a69a' : '#ef5350', 'center');
      }
    }
  }

  // Aperçu outils avancés 2 points
  if (currentTool && ['fibRetracement', 'ray', 'priceRange', 'ellipse', 'circle'].includes(currentTool) &&
      pane.pendingPoints.length === 1 && pane.mousePos) {
    const p1 = pane.pendingPoints[0];
    const x1 = ts.timeToCoordinate(p1.time), y1 = pane.series.priceToCoordinate(p1.price);
    if (x1 !== null && y1 !== null) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      if (currentTool === 'priceRange' || currentTool === 'ellipse') {
        const rx = Math.min(x1, pane.mousePos.x), ry = Math.min(y1, pane.mousePos.y);
        const rw = Math.abs(pane.mousePos.x - x1), rh = Math.abs(pane.mousePos.y - y1);
        ctx.fillStyle = hexToRgba(color, 0.1);
        if (currentTool === 'ellipse') {
          ctx.beginPath();
          ctx.ellipse(rx + rw / 2, ry + rh / 2, Math.max(1, rw / 2), Math.max(1, rh / 2), 0, 0, Math.PI * 2);
          ctx.fill(); ctx.stroke();
        } else {
          ctx.fillRect(rx, ry, rw, rh);
          ctx.strokeRect(rx, ry, rw, rh);
        }
      } else if (currentTool === 'circle') {
        // NOUVEAU : rayon = distance écran entre le centre (1er clic) et la souris — cercle
        // parfait à l'écran, contrairement à l'ellipse (boîte englobante p1/p2).
        const radius = Math.hypot(pane.mousePos.x - x1, pane.mousePos.y - y1);
        ctx.fillStyle = hexToRgba(color, 0.1);
        ctx.beginPath();
        ctx.arc(x1, y1, Math.max(1, radius), 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(pane.mousePos.x, pane.mousePos.y);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      drawHandle(ctx, x1, y1, color);
    }
  }

  // Aperçu outils avancés 3 points (montre segments déjà placés + ligne vers souris)
  if (currentTool && ['fibExtension', 'parallelChannel', 'pitchfork', 'triangle'].includes(currentTool) &&
      pane.pendingPoints.length >= 1 && pane.pendingPoints.length < 3 && pane.mousePos) {
    // CORRECTIF : même bug que pour le zigzag (voir plus bas) — on sépare tracé de la ligne et
    // dessin des poignées pour que drawHandle() n'efface plus le chemin en cours de construction.
    const coords3 = [];
    for (let i = 0; i < pane.pendingPoints.length; i++) {
      const p = pane.pendingPoints[i];
      const px = ts.timeToCoordinate(p.time), py = pane.series.priceToCoordinate(p.price);
      if (px === null || py === null) continue;
      coords3.push({ px, py });
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    coords3.forEach((c, i) => { if (i === 0) ctx.moveTo(c.px, c.py); else ctx.lineTo(c.px, c.py); });
    ctx.lineTo(pane.mousePos.x, pane.mousePos.y);
    ctx.stroke();
    ctx.setLineDash([]);
    coords3.forEach(c => drawHandle(ctx, c.px, c.py, color));
  }
  // NOUVEAU : aperçu du zigzag en cours de tracé — nombre de points LIBRE (pas de plafond à 3) :
  // segments déjà posés + segment fantôme vers la souris. Double-clic ou Entrée pour terminer.
  if (currentTool === 'zigzagArrow' && pane.pendingPoints.length >= 1 && pane.mousePos) {
    // CORRECTIF : drawHandle() fait un ctx.beginPath() en interne pour dessiner son cercle —
    // appelé À L'INTÉRIEUR de la boucle qui construit le chemin de la ligne (avant le stroke()),
    // il effaçait le moveTo/lineTo accumulé à chaque point, si bien que la ligne ne se traçait
    // quasiment jamais pendant l'aperçu (seuls les points/poignées apparaissaient). On construit
    // maintenant TOUT le chemin de la ligne d'abord, on le stroke en un seul appel, puis on
    // dessine les poignées séparément (même ordre que drawZigzagArrow() pour la forme finale).
    const coords = [];
    for (let i = 0; i < pane.pendingPoints.length; i++) {
      const p = pane.pendingPoints[i];
      const px = ts.timeToCoordinate(p.time), py = pane.series.priceToCoordinate(p.price);
      if (px === null || py === null) continue;
      coords.push({ px, py });
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    coords.forEach((c, i) => { if (i === 0) ctx.moveTo(c.px, c.py); else ctx.lineTo(c.px, c.py); });
    ctx.lineTo(pane.mousePos.x, pane.mousePos.y);
    ctx.stroke();
    ctx.setLineDash([]);
    coords.forEach(c => drawHandle(ctx, c.px, c.py, color));
  }
  // Poignées de sélection (déplacement / redimensionnement)
  if (selectedDrawing && selectedDrawing.pane === pane && selectedDrawing.drawing) {
    const sel = selectedDrawing.drawing;
    if (!sel._hiddenByReplay && !isDrawingInFuture(sel, getReplayCutoffTime())) {
      drawSelectionHandles(ctx, pane, sel);
    }
  }

  // NOUVEAU : curseur "+" (prix/heure) pendant le placement d'un outil de dessin. Le crosshair
  // natif de lightweight-charts n'est plus utilisable ici : ce canvas de dessin est par-dessus
  // le graphique (pointer-events auto) dès qu'un outil est actif, donc il capte tous les
  // mouvements de souris avant qu'ils n'atteignent le graphique natif. Sans ce curseur "maison",
  // on perdait toute indication de prix/heure pendant tout le placement d'un dessin.
  if ((currentTool || advTool) && pane.mousePos) {
    const mx = pane.mousePos.x, my = pane.mousePos.y;
    const crossColor = hexToRgba(color, 0.6);
    ctx.save();
    ctx.strokeStyle = crossColor;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(0, my); ctx.lineTo(w, my); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(mx, 0); ctx.lineTo(mx, h); ctx.stroke();
    ctx.setLineDash([]);
    // Petite croix pleine au centre, plus visible que le simple croisement des pointillés
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(mx - 7, my); ctx.lineTo(mx + 7, my);
    ctx.moveTo(mx, my - 7); ctx.lineTo(mx, my + 7);
    ctx.stroke();
    ctx.restore();

    // Étiquette de prix, collée au bord droit (comme l'échelle de prix native)
    const priceAtCursor = pane.series.coordinateToPrice(my);
    if (priceAtCursor != null) {
      const prec = (priceFormat && priceFormat.precision != null) ? priceFormat.precision : 5;
      ctx.save();
      ctx.font = "11px 'Calibri Light', 'Calibri', -apple-system, BlinkMacSystemFont, Roboto, sans-serif";
      const text = priceAtCursor.toFixed(prec);
      const tw = ctx.measureText(text).width + 10;
      ctx.fillStyle = color;
      ctx.fillRect(w - tw, my - 8, tw, 16);
      ctx.fillStyle = '#ffffff';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      ctx.fillText(text, w - tw / 2, my + 1);
      ctx.textAlign = 'left';
      ctx.restore();
    }

    // Étiquette d'heure, collée au bord bas (comme l'échelle de temps native)
    const timeAtCursor = coordinateToTimeSafe(pane, ts, mx);
    if (timeAtCursor != null) {
      ctx.save();
      ctx.font = "11px 'Calibri Light', 'Calibri', -apple-system, BlinkMacSystemFont, Roboto, sans-serif";
      const text = formatTimeLabel(timeAtCursor, pane.timeframe);
      const tw = ctx.measureText(text).width + 10;
      ctx.fillStyle = color;
      ctx.fillRect(mx - tw / 2, h - 18, tw, 16);
      ctx.fillStyle = '#ffffff';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      ctx.fillText(text, mx, h - 10);
      ctx.textAlign = 'left';
      ctx.restore();
    }
  }
}


