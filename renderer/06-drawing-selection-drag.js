// ============================================================
// 06-drawing-selection-drag.js
// Sélection d'un dessin (hit-test, menu flottant) et déplacement/redimensionnement (drag) des dessins et positions
// Fait partie de renderer.js (sectionné en modules le 2026-08-28).
// Chargé comme <script> classique dans index.html : les variables/fonctions
// top-level restent globales et partagées entre tous ces fichiers, exactement
// comme dans l'ancien renderer.js monolithique — aucun changement de comportement.
// ============================================================
// ============ NOUVEAU : sélection d'un dessin + menu flottant (configurer / supprimer) ============
const HIT_TOLERANCE = 6; // pixels

function distanceToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

// Distance approximative (en pixels écran) entre le point cliqué et un dessin donné ; Infinity si
// le dessin est hors du viewport actuel ou si le type est inconnu.
function hitTestDrawing(pane, d, x, y) {
  const ts = safeTimeScale(pane);
  if (d.type === 'horizontal') {
    const py = pane.series.priceToCoordinate(d.price);
    return py === null ? Infinity : Math.abs(y - py);
  }
  if (d.type === 'vertical') {
    const px = ts.timeToCoordinate(d.time);
    return px === null ? Infinity : Math.abs(x - px);
  }
  if (d.type === 'text') {
    const tx = ts.timeToCoordinate(d.time), ty = pane.series.priceToCoordinate(d.price);
    if (tx === null || ty === null) return Infinity;
    // Correspond à l'ancrage du texte dans ShapePrimitive.draw() (x+4, y-4)
    const boxX = tx + 4, boxY = ty - 16, boxW = Math.max(20, (d.text || '').length * 6.5), boxH = 16;
    return (x >= boxX - 2 && x <= boxX + boxW + 2 && y >= boxY - 2 && y <= boxY + boxH + 2) ? 0 : Infinity;
  }
  if (d.type === 'breakCross') {
    const cx = ts.timeToCoordinate(d.time), cy = pane.series.priceToCoordinate(d.price);
    if (cx === null || cy === null) return Infinity;
    return Math.hypot(x - cx, y - cy);
  }
  if (d.type === 'horizontalRay') {
    const ax = ts.timeToCoordinate(d.time), ay = pane.series.priceToCoordinate(d.price);
    if (ax === null || ay === null) return Infinity;
    // Le rayon ne s'étend qu'à droite de son ancre : un clic nettement à gauche ne compte pas,
    // même si la coordonnée y correspond au bon prix (avec une petite tolérance pour l'ancre elle-même).
    if (x < ax - HIT_TOLERANCE) return Infinity;
    return Math.abs(y - ay);
  }
  if (d.type === 'trend' || d.type === 'arrow' || d.type === 'segment') {
    const x1 = ts.timeToCoordinate(d.p1.time), y1 = pane.series.priceToCoordinate(d.p1.price);
    const x2 = ts.timeToCoordinate(d.p2.time), y2 = pane.series.priceToCoordinate(d.p2.price);
    if ([x1, y1, x2, y2].some(v => v === null)) return Infinity;
    return distanceToSegment(x, y, x1, y1, x2, y2);
  }
  if (d.type === 'rectangle') {
    if (!d.p1 || !d.p2) return Infinity;
    const y1 = pane.series.priceToCoordinate(d.p1.price), y2 = pane.series.priceToCoordinate(d.p2.price);
    if (y1 === null || y2 === null) return Infinity;
    const ry = Math.min(y1, y2), rh = Math.abs(y2 - y1);
    const ext = getRectExtend(d);
    if (ext.left && ext.right) return (y >= ry && y <= ry + rh) ? 0 : Math.max(ry - y, 0, y - (ry + rh));
    const x1 = ts.timeToCoordinate(d.p1.time), x2 = ts.timeToCoordinate(d.p2.time);
    if (x1 === null || x2 === null) return Infinity;
    const paneW = pane.inner.clientWidth;
    const rx = ext.left ? 0 : Math.min(x1, x2);
    const rEnd = ext.right ? paneW : Math.max(x1, x2);
    const rw = Math.max(0, rEnd - rx);
    if (x >= rx && x <= rx + rw && y >= ry && y <= ry + rh) return 0; // à l'intérieur de la zone : hit direct
    const dx = Math.max(rx - x, 0, x - (rx + rw));
    const dy = Math.max(ry - y, 0, y - (ry + rh));
    return Math.hypot(dx, dy);
  }
  // NOUVEAU : position longue / courte — hit sur la zone couvrant stop↔target et entryTime↔endTime
  if (d.type === 'longPosition' || d.type === 'shortPosition') {
    const x1 = ts.timeToCoordinate(d.entryTime), x2 = ts.timeToCoordinate(d.endTime);
    const yE = pane.series.priceToCoordinate(d.entryPrice);
    const yS = pane.series.priceToCoordinate(d.stopPrice);
    const yT = pane.series.priceToCoordinate(d.targetPrice);
    if ([x1, x2, yE, yS, yT].some(v => v === null)) return Infinity;
    const rx = Math.min(x1, x2), rw = Math.abs(x2 - x1);
    const ry = Math.min(yE, yS, yT), rh = Math.max(yE, yS, yT) - ry;
    if (x >= rx && x <= rx + rw && y >= ry && y <= ry + rh) return 0;
    const dx = Math.max(rx - x, 0, x - (rx + rw));
    const dy = Math.max(ry - y, 0, y - (ry + rh));
    return Math.hypot(dx, dy);
  }
  // Cercle natif : centre p1, rayon = distance écran à p2 — hit si à l'intérieur du disque
  // (ou près du bord), pas un test de boîte englobante comme les autres outils à 2 points.
  if (d.type === 'circle') {
    const x1 = ts.timeToCoordinate(d.p1.time), y1 = pane.series.priceToCoordinate(d.p1.price);
    const x2 = ts.timeToCoordinate(d.p2.time), y2 = pane.series.priceToCoordinate(d.p2.price);
    if ([x1, y1, x2, y2].some(v => v === null)) return Infinity;
    const radius = Math.hypot(x2 - x1, y2 - y1);
    const dist = Math.hypot(x - x1, y - y1);
    return dist <= radius ? 0 : dist - radius;
  }
  // Outils avancés à 2 points (fib, ray, priceRange, ellipse)
  if (d.type === 'fibRetracement' || d.type === 'ray' || d.type === 'priceRange' || d.type === 'ellipse') {
    const x1 = ts.timeToCoordinate(d.p1.time), y1 = pane.series.priceToCoordinate(d.p1.price);
    const x2 = ts.timeToCoordinate(d.p2.time), y2 = pane.series.priceToCoordinate(d.p2.price);
    if ([x1, y1, x2, y2].some(v => v === null)) return Infinity;
    if (d.type === 'priceRange' || d.type === 'ellipse' || d.type === 'fibRetracement') {
      const rx = Math.min(x1, x2), ry = Math.min(y1, y2);
      const rw = Math.abs(x2 - x1), rh = Math.abs(y2 - y1);
      // Fib : hit proche d'une ligne de niveau ou du trend
      if (d.type === 'fibRetracement') {
        const seg = distanceToSegment(x, y, x1, y1, x2, y2);
        if (seg < HIT_TOLERANCE) return seg;
        const priceRange = d.p2.price - d.p1.price;
        for (const level of (d.levels || FIB_LEVELS)) {
          const py = pane.series.priceToCoordinate(d.p1.price + priceRange * level);
          if (py !== null && Math.abs(y - py) < HIT_TOLERANCE && x >= Math.min(x1, x2) - 4) return Math.abs(y - py);
        }
        return Infinity;
      }
      if (x >= rx && x <= rx + rw && y >= ry && y <= ry + rh) return 0;
      const dx = Math.max(rx - x, 0, x - (rx + rw));
      const dy = Math.max(ry - y, 0, y - (ry + rh));
      return Math.hypot(dx, dy);
    }
    return distanceToSegment(x, y, x1, y1, x2, y2);
  }
  // Outils à 3 points (triangle fermé)
  if (d.type === 'fibExtension' || d.type === 'parallelChannel' || d.type === 'pitchfork' || d.type === 'triangle') {
    if (!d.p1 || !d.p2 || !d.p3) return Infinity; // dessin à 3 points incomplet : jamais "touché"
    const pts = [d.p1, d.p2, d.p3].map(p => ({
      x: ts.timeToCoordinate(p.time),
      y: pane.series.priceToCoordinate(p.price)
    }));
    if (pts.some(p => p.x === null || p.y === null)) return Infinity;
    let best = Infinity;
    for (let i = 0; i < 3; i++) {
      const a = pts[i], b = pts[(i + 1) % 3];
      best = Math.min(best, distanceToSegment(x, y, a.x, a.y, b.x, b.y));
    }
    return best;
  }
  // NOUVEAU : zigzag à nombre de points libre — chemin OUVERT (pas de segment de fermeture
  // dernier→premier point, contrairement au triangle ci-dessus).
  if (d.type === 'zigzagArrow') {
    const raw = getZigzagPoints(d);
    if (!raw) return Infinity; // dessin incomplet : jamais "touché"
    const pts = raw.map(p => ({
      x: ts.timeToCoordinate(p.time),
      y: pane.series.priceToCoordinate(p.price)
    }));
    if (pts.some(p => p.x === null || p.y === null)) return Infinity;
    let best = Infinity;
    for (let i = 0; i < pts.length - 1; i++) {
      best = Math.min(best, distanceToSegment(x, y, pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y));
    }
    return best;
  }
  return Infinity;
}

function findDrawingAtPoint(pane, x, y) {
  let best = null, bestDist = HIT_TOLERANCE;
  const cutoff = getReplayCutoffTime();
  for (const d of pane.drawings) {
    if (d._hiddenByReplay || isDrawingInFuture(d, cutoff)) continue;
    const dist = hitTestDrawing(pane, d, x, y);
    if (dist <= bestDist) { bestDist = dist; best = d; }
  }
  return best;
}

let selectedDrawing = null; // { pane, drawing }

// ============ Déplacement / redimensionnement des dessins ============
const HANDLE_HIT = 8;
let dragState = null; // { pane, drawing, handleId, snapshot, moved, ... }
let justFinishedDrag = false;
let pendingDrag = null; // { pane, drawing, handleId, startClientX, startClientY }
const DRAG_THRESHOLD_PX = 6; // clic simple = sélection ; au-delà = déplacement

function getDrawingHandles(pane, d) {
  const ts = safeTimeScale(pane);
  const handles = [];
  const push = (id, time, price, cursor = 'nwse-resize') => {
    const x = time != null ? ts.timeToCoordinate(time) : null;
    const y = price != null ? pane.series.priceToCoordinate(price) : null;
    if (x == null && y == null) return;
    handles.push({
      id,
      x: x != null ? x : (pane.inner.clientWidth / 2),
      y: y != null ? y : (pane.inner.clientHeight / 2),
      cursor
    });
  };
  switch (d.type) {
    case 'horizontal':
      push('price', null, d.price, 'ns-resize');
      break;
    case 'vertical':
      push('time', d.time, null, 'ew-resize');
      break;
    case 'text':
    case 'breakCross':
    case 'horizontalRay':
      push('p1', d.time, d.price, 'move');
      break;
    case 'trend':
    case 'arrow':
    case 'ray':
    case 'fibRetracement':
    case 'priceRange':
    case 'ellipse':
    case 'rectangle':
    case 'segment':
      if (d.p1) push('p1', d.p1.time, d.p1.price);
      if (d.p2) push('p2', d.p2.time, d.p2.price);
      break;
    // NOUVEAU : centre (déplacer) / rayon (redimensionner) — voir applyHandleDrag()
    case 'circle':
      if (d.p1) push('p1', d.p1.time, d.p1.price, 'move');
      if (d.p2) push('p2', d.p2.time, d.p2.price, 'nwse-resize');
      break;
    case 'fibExtension':
    case 'parallelChannel':
    case 'pitchfork':
    case 'triangle':
      if (d.p1) push('p1', d.p1.time, d.p1.price);
      if (d.p2) push('p2', d.p2.time, d.p2.price);
      if (d.p3) push('p3', d.p3.time, d.p3.price);
      break;
    case 'zigzagArrow': {
      // Migre au vol un dessin ancien format (p1/p2/p3) vers d.points, AVANT que le drag ne
      // prenne son instantané — pour que les ids de poignée pt0/pt1/... restent cohérents avec
      // applyHandleDrag() ci-dessous, quel que soit le format d'origine du dessin.
      migrateZigzagDrawing(d);
      const pts = getZigzagPoints(d);
      if (pts) pts.forEach((p, i) => push('pt' + i, p.time, p.price));
      break;
    }
    case 'longPosition':
    case 'shortPosition': {
      const midT = (d.entryTime + d.endTime) / 2;
      push('entry', midT, d.entryPrice, 'ns-resize');
      push('stop', midT, d.stopPrice, 'ns-resize');
      push('target', midT, d.targetPrice, 'ns-resize');
      push('left', d.entryTime, d.entryPrice, 'ew-resize');
      push('right', d.endTime, d.entryPrice, 'ew-resize');
      break;
    }
    default:
      break;
  }
  return handles;
}

function hitTestHandle(pane, d, x, y) {
  const handles = getDrawingHandles(pane, d);
  let best = null, bestDist = HANDLE_HIT;
  for (const h of handles) {
    const dist = Math.hypot(x - h.x, y - h.y);
    if (dist <= bestDist) { bestDist = dist; best = h; }
  }
  return best;
}

function setChartInteraction(pane, enabled) {
  try {
    pane.chart.applyOptions({ handleScroll: enabled, handleScale: enabled });
  } catch {}
}

function refreshDrawingVisual(pane, drawing) {
  if (drawing.type === 'horizontal' && drawing.priceLine) {
    drawing.priceLine.applyOptions({ price: drawing.price, title: drawing.text || '' });
  } else if (drawing._primitive) {
    drawing._primitive.refresh();
  }
  redrawPane(pane);
}

function applyHandleDrag(pane, drawing, handleId, time, price, snapshot) {
  if (time == null && price == null) return;
  switch (drawing.type) {
    case 'horizontal':
      if (price != null) drawing.price = price;
      break;
    case 'vertical':
      if (time != null) drawing.time = time;
      break;
    case 'text':
    case 'breakCross':
      if (time != null) drawing.time = time;
      if (price != null) drawing.price = price;
      break;
    case 'horizontalRay':
      if (handleId === 'body') {
        // Glisser n'importe où le long de la ligne (pas forcément sur l'ancre) : décalage
        // relatif, comme pour trend/ray/segment, plutôt qu'un repositionnement absolu de l'ancre.
        const dt = time != null && snapshot._startTime != null ? time - snapshot._startTime : 0;
        const dp = price != null && snapshot._startPrice != null ? price - snapshot._startPrice : 0;
        drawing.time = snapshot.time + dt;
        drawing.price = snapshot.price + dp;
      } else {
        if (time != null) drawing.time = time;
        if (price != null) drawing.price = price;
      }
      break;
    // NOUVEAU : cercle — comportement volontairement différent du groupe générique ci-dessus :
    // glisser le centre (p1) ou le corps du cercle déplace l'ensemble (rayon conservé), alors que
    // glisser la poignée de rayon (p2) redimensionne seule (centre fixe), comme un outil cercle
    // classique (TradingView) plutôt qu'un simple point de boîte englobante.
    case 'circle':
      if (handleId === 'p2' && drawing.p2) {
        if (time != null) drawing.p2.time = time;
        if (price != null) drawing.p2.price = price;
      } else if (drawing.p1 && drawing.p2) {
        const dt = time != null && snapshot._startTime != null ? time - snapshot._startTime : 0;
        const dp = price != null && snapshot._startPrice != null ? price - snapshot._startPrice : 0;
        if (snapshot.p1) { drawing.p1.time = snapshot.p1.time + dt; drawing.p1.price = snapshot.p1.price + dp; }
        if (snapshot.p2) { drawing.p2.time = snapshot.p2.time + dt; drawing.p2.price = snapshot.p2.price + dp; }
      }
      break;
    case 'trend':
    case 'arrow':
    case 'ray':
    case 'fibRetracement':
    case 'priceRange':
    case 'ellipse':
    case 'rectangle':
    case 'segment':
      if (handleId === 'p1' && drawing.p1) {
        if (time != null) drawing.p1.time = time;
        if (price != null) drawing.p1.price = price;
      } else if (handleId === 'p2' && drawing.p2) {
        if (time != null) drawing.p2.time = time;
        if (price != null) drawing.p2.price = price;
      } else if (handleId === 'body') {
        const dt = time != null && snapshot._startTime != null ? time - snapshot._startTime : 0;
        const dp = price != null && snapshot._startPrice != null ? price - snapshot._startPrice : 0;
        if (drawing.p1 && snapshot.p1) {
          drawing.p1.time = snapshot.p1.time + dt;
          drawing.p1.price = snapshot.p1.price + dp;
        }
        if (drawing.p2 && snapshot.p2) {
          drawing.p2.time = snapshot.p2.time + dt;
          drawing.p2.price = snapshot.p2.price + dp;
        }
      }
      break;
    case 'fibExtension':
    case 'parallelChannel':
    case 'pitchfork':
    case 'triangle':
      if (handleId === 'p1' && drawing.p1) {
        if (time != null) drawing.p1.time = time;
        if (price != null) drawing.p1.price = price;
      } else if (handleId === 'p2' && drawing.p2) {
        if (time != null) drawing.p2.time = time;
        if (price != null) drawing.p2.price = price;
      } else if (handleId === 'p3' && drawing.p3) {
        if (time != null) drawing.p3.time = time;
        if (price != null) drawing.p3.price = price;
      } else if (handleId === 'body') {
        const dt = time != null && snapshot._startTime != null ? time - snapshot._startTime : 0;
        const dp = price != null && snapshot._startPrice != null ? price - snapshot._startPrice : 0;
        for (const key of ['p1', 'p2', 'p3']) {
          if (drawing[key] && snapshot[key]) {
            drawing[key].time = snapshot[key].time + dt;
            drawing[key].price = snapshot[key].price + dp;
          }
        }
      }
      break;
    // NOUVEAU : zigzag à nombre de points libre — poignées 'pt0'..'ptN' indexées sur
    // drawing.points / snapshot.points (déjà migré vers ce format par getDrawingHandles()).
    case 'zigzagArrow': {
      const m = /^pt(\d+)$/.exec(handleId || '');
      if (m && drawing.points) {
        const i = Number(m[1]);
        if (drawing.points[i]) {
          if (time != null) drawing.points[i].time = time;
          if (price != null) drawing.points[i].price = price;
        }
      } else if (handleId === 'body' && drawing.points && snapshot.points) {
        const dt = time != null && snapshot._startTime != null ? time - snapshot._startTime : 0;
        const dp = price != null && snapshot._startPrice != null ? price - snapshot._startPrice : 0;
        drawing.points.forEach((pt, i) => {
          const sp = snapshot.points[i];
          if (pt && sp) {
            pt.time = sp.time + dt;
            pt.price = sp.price + dp;
          }
        });
      }
      break;
    }
    case 'longPosition':
    case 'shortPosition': {
      const isLong = drawing.type === 'longPosition';
      // Tick minimal pour éviter stop === entrée
      const tick = Math.max(1e-8, Math.abs(drawing.entryPrice || 1) * 1e-6);
      if (handleId === 'entry' && price != null) {
        drawing.entryPrice = price;
        // Recale stop/cible du bon côté après déplacement de l'entrée
        if (isLong) {
          if (drawing.stopPrice >= drawing.entryPrice) drawing.stopPrice = drawing.entryPrice - tick;
          if (drawing.targetPrice <= drawing.entryPrice) drawing.targetPrice = drawing.entryPrice + tick;
        } else {
          if (drawing.stopPrice <= drawing.entryPrice) drawing.stopPrice = drawing.entryPrice + tick;
          if (drawing.targetPrice >= drawing.entryPrice) drawing.targetPrice = drawing.entryPrice - tick;
        }
      } else if (handleId === 'stop' && price != null) {
        drawing.stopPrice = isLong
          ? Math.min(price, drawing.entryPrice - tick)
          : Math.max(price, drawing.entryPrice + tick);
      } else if (handleId === 'target' && price != null) {
        drawing.targetPrice = isLong
          ? Math.max(price, drawing.entryPrice + tick)
          : Math.min(price, drawing.entryPrice - tick);
      } else if (handleId === 'left' && time != null) {
        drawing.entryTime = time;
        if (drawing.entryTime > drawing.endTime) {
          const tmp = drawing.endTime;
          drawing.endTime = drawing.entryTime;
          drawing.entryTime = tmp;
        }
      } else if (handleId === 'right' && time != null) {
        drawing.endTime = time;
        if (drawing.endTime < drawing.entryTime) {
          const tmp = drawing.entryTime;
          drawing.entryTime = drawing.endTime;
          drawing.endTime = tmp;
        }
      } else if (handleId === 'body') {
        const dt = time != null && snapshot._startTime != null ? time - snapshot._startTime : 0;
        const dp = price != null && snapshot._startPrice != null ? price - snapshot._startPrice : 0;
        drawing.entryTime = snapshot.entryTime + dt;
        drawing.endTime = snapshot.endTime + dt;
        drawing.entryPrice = snapshot.entryPrice + dp;
        drawing.stopPrice = snapshot.stopPrice + dp;
        drawing.targetPrice = snapshot.targetPrice + dp;
      }
      break;
    }
    default:
      break;
  }
}

function beginDrawingDrag(pane, drawing, handleId, clientX, clientY, duplicated = false) {
  if (drawing.locked) return false;
  // NOUVEAU : Ctrl/Cmd + glisser un dessin en fait une copie indépendante (comportement
  // TradingView) — on clone le dessin d'origine (qui reste immobile) et c'est la copie
  // qui suit le curseur pour le reste du drag.
  let targetDrawing = drawing;
  if (duplicated) {
    const snap = snapshotDrawing(drawing);
    targetDrawing = restoreDrawingFromSnapshot(pane, snap);
  }
  const rect = pane.inner.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  let time = coordinateToTimeSafe(pane, pane.chart.timeScale(), x);
  let price = pane.series.coordinateToPrice(y);
  if (typeof snapToMagnet === 'function' && magnetEnabled && time != null && price != null) {
    ({ time, price } = snapToMagnet(pane, time, price));
  }
  const snapshot = snapshotDrawing(targetDrawing);
  snapshot._startTime = time;
  snapshot._startPrice = price;
  dragState = {
    pane, drawing: targetDrawing,
    handleId: handleId || 'body',
    startClientX: clientX,
    startClientY: clientY,
    snapshot,
    beforeSnapshot: snapshotDrawing(targetDrawing),
    moved: false,
    duplicated: !!duplicated
  };
  setChartInteraction(pane, false);
  pane.canvas.style.pointerEvents = 'auto';
  pane.canvas.style.cursor = duplicated ? 'copy' : (handleId && handleId !== 'body' ? 'grabbing' : 'move');
  hideDrawingMenu();
  selectedDrawing = { pane, drawing: targetDrawing };
  updateCanvasPointerEvents();
  redrawPane(pane);
  return true;
}

function updateDrawingDrag(clientX, clientY) {
  if (!dragState) return;
  const { pane, drawing, handleId, snapshot } = dragState;
  const rect = pane.inner.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  let time = coordinateToTimeSafe(pane, pane.chart.timeScale(), x);
  let price = pane.series.coordinateToPrice(y);
  if (typeof snapToMagnet === 'function' && magnetEnabled && time != null && price != null) {
    ({ time, price } = snapToMagnet(pane, time, price));
  }
  if (Math.abs(clientX - dragState.startClientX) > 3 || Math.abs(clientY - dragState.startClientY) > 3) {
    dragState.moved = true;
  }
  applyHandleDrag(pane, drawing, handleId, time, price, snapshot);
  refreshDrawingVisual(pane, drawing);
}

function endDrawingDrag() {
  pendingDrag = null;
  if (!dragState) return;
  const { pane, drawing, moved, beforeSnapshot, duplicated } = dragState;
  setChartInteraction(pane, true);
  try { pane.canvas.style.cursor = ''; } catch {}
  dragState = null;
  // CORRECTIF : réaffiche le menu flottant une fois le déplacement/redimensionnement terminé
  // (comportement TradingView), au lieu de laisser seulement les poignées sans menu.
  selectAndShowDrawingMenu(pane, drawing);
  redrawPane(pane);
  justFinishedDrag = true;
  setTimeout(() => { justFinishedDrag = false; }, 100);
  if (duplicated) {
    // NOUVEAU : le dessin est une copie fraîchement créée (Ctrl/Cmd + glisser) — une seule
    // action "add" dans l'historique (undo = supprime la copie), qu'elle ait bougé ou non.
    pushUndo(pane, { type: 'add', snapshot: snapshotDrawing(drawing) });
    if (typeof scheduleWorkspaceSave === 'function') scheduleWorkspaceSave();
  } else if (moved) {
    pushUndo(pane, {
      type: 'modify',
      drawingRef: drawing,
      before: beforeSnapshot,
      after: snapshotDrawing(drawing)
    });
    if (typeof scheduleWorkspaceSave === 'function') scheduleWorkspaceSave();
  }
}

function pointerPosOnPane(pane, clientX, clientY) {
  const rect = pane.inner.getBoundingClientRect();
  return { x: clientX - rect.left, y: clientY - rect.top, rect };
}

function drawSelectionHandles(ctx, pane, drawing) {
  const handles = getDrawingHandles(pane, drawing);
  const color = drawing.color || drawingDefaultColor(drawing.type);
  for (const h of handles) {
    ctx.beginPath();
    ctx.arc(h.x, h.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = color;
    ctx.stroke();
  }
}

function setupDrawingDragListeners() {
  window.addEventListener('pointermove', (e) => {
    // Promotion pending → vrai drag après un petit mouvement
    if (pendingDrag && !dragState) {
      const dx = e.clientX - pendingDrag.startClientX;
      const dy = e.clientY - pendingDrag.startClientY;
      if (Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX) {
        const { pane, drawing, handleId, startClientX, startClientY, duplicated } = pendingDrag;
        pendingDrag = null;
        // NOUVEAU : Ctrl/Cmd toujours enfoncé au moment de franchir le seuil → on duplique.
        beginDrawingDrag(pane, drawing, handleId, startClientX, startClientY, duplicated && (e.ctrlKey || e.metaKey));
        try { e.target?.setPointerCapture?.(e.pointerId); } catch {}
      }
      return;
    }
    if (!dragState) return;
    e.preventDefault();
    updateDrawingDrag(e.clientX, e.clientY);
  });
  window.addEventListener('pointerup', (e) => {
    if (pendingDrag) {
      // Clic simple : sélection uniquement, pas de déplacement
      const { pane, drawing } = pendingDrag;
      pendingDrag = null;
      // CORRECTIF : affiche le menu flottant du dessin sélectionné (n'était jamais appelé,
      // seule la sélection — poignées — était appliquée).
      selectAndShowDrawingMenu(pane, drawing);
      redrawPane(pane);
      justFinishedDrag = true;
      setTimeout(() => { justFinishedDrag = false; }, 80);
      return;
    }
    endDrawingDrag();
  });
  window.addEventListener('pointercancel', () => {
    pendingDrag = null;
    endDrawingDrag();
  });
}

/**
 * Prépare un éventuel drag. Les poignées démarrent immédiatement ;
 * le corps attend un mouvement (seuil) pour ne pas « coller » au simple clic.
 */
function tryBeginDragFromEvent(pane, e) {
  if (currentTool || advTool || dragState || pendingDrag) return false;
  if (e.button != null && e.button !== 0) return false;
  const { x, y } = pointerPosOnPane(pane, e.clientX, e.clientY);

  // 1) Poignée de la sélection courante → drag immédiat
  if (selectedDrawing && selectedDrawing.pane === pane && !selectedDrawing.drawing.locked) {
    const h = hitTestHandle(pane, selectedDrawing.drawing, x, y);
    if (h) {
      beginDrawingDrag(pane, selectedDrawing.drawing, h.id, e.clientX, e.clientY);
      try { e.currentTarget?.setPointerCapture?.(e.pointerId); } catch {}
      return true;
    }
  }

  // 2) Clic sur un dessin → sélection ; drag corps seulement après seuil
  const hit = findDrawingAtPoint(pane, x, y);
  if (hit && !hit.locked) {
    const h = hitTestHandle(pane, hit, x, y);
    selectedDrawing = { pane, drawing: hit };
    updateCanvasPointerEvents();
    redrawPane(pane);
    if (h) {
      beginDrawingDrag(pane, hit, h.id, e.clientX, e.clientY);
      try { e.currentTarget?.setPointerCapture?.(e.pointerId); } catch {}
    } else {
      pendingDrag = {
        pane, drawing: hit, handleId: 'body',
        startClientX: e.clientX, startClientY: e.clientY,
        // NOUVEAU : Ctrl/Cmd tenu au clic → dès que le seuil de drag sera franchi,
        // le corps du dessin sera dupliqué au lieu d'être déplacé (cf. pointermove ci-dessous).
        duplicated: !!(e.ctrlKey || e.metaKey)
      };
    }
    return true;
  }

  // 3) Clic dans le vide → désélection
  if (selectedDrawing && selectedDrawing.pane === pane) {
    selectedDrawing = null;
    hideDrawingMenu();
    updateCanvasPointerEvents();
    redrawPane(pane);
  }
  return false;
}

// Construit l'icône SVG "ligne" utilisée pour représenter une épaisseur donnée
function widthLineSvg(width, w = 22, h = 10) {
  const y = h / 2;
  return `<svg viewBox="0 0 ${w} ${h}"><line x1="2" y1="${y}" x2="${w - 2}" y2="${y}" stroke="currentColor" stroke-width="${width}" stroke-linecap="round"/></svg>`;
}

function buildWidthPopover() {
  const pop = document.getElementById('dcm-width-popover');
  pop.innerHTML = WIDTH_PRESETS.map(w =>
    `<button type="button" class="dcm-width-option" data-width="${w}" title="${w}px">${widthLineSvg(w)}</button>`
  ).join('');
}

// NOUVEAU : popover des tailles de texte, même style que celui des épaisseurs mais avec un
// libellé numérique au lieu d'un aperçu de trait.
function buildFontSizePopover() {
  const pop = document.getElementById('dcm-fontsize-popover');
  pop.innerHTML = FONT_SIZE_PRESETS.map(s =>
    `<button type="button" class="dcm-width-option" data-fontsize="${s}" title="${s}px" style="font-size:${Math.min(s, 16)}px">${s}</button>`
  ).join('');
}

function positionPopoverAboveMenu(popover, menu) {
  const r = menu.getBoundingClientRect();
  popover.style.left = `${r.left + r.width / 2}px`;
  popover.style.top = `${r.top - 8}px`;
}

function hideWidthPopover() {
  document.getElementById('dcm-width-popover')?.classList.remove('visible');
}

// NOUVEAU : popover de position du texte (Haut / Bas / Intérieur) — rectangle uniquement
function buildTextPosPopover() {
  const pop = document.getElementById('dcm-textpos-popover');
  pop.innerHTML = Object.entries(TEXT_POSITION_LABELS).map(([pos, label]) =>
    `<button type="button" class="dcm-textpos-option" data-pos="${pos}">${label}</button>`
  ).join('');
}

function hideTextPosPopover() {
  document.getElementById('dcm-textpos-popover')?.classList.remove('visible');
}

// NOUVEAU : boîte de dialogue dédiée pour saisir le Stop Loss et le Take Profit en pips en une
// seule fois (position longue/courte) — plus « professionnelle » qu'une suite de prompts texte
// génériques : deux champs numériques clairement labellisés, avec validation avant application.
function showPipsPrompt(currentSl, currentTp) {
  return new Promise((resolve) => {
    const modal = document.getElementById('pips-input-modal');
    const slField = document.getElementById('pips-sl-field');
    const tpField = document.getElementById('pips-tp-field');
    const okBtn = document.getElementById('pips-input-ok');
    const cancelBtn = document.getElementById('pips-input-cancel');

    slField.value = Number.isFinite(currentSl) ? currentSl.toFixed(1) : '';
    tpField.value = Number.isFinite(currentTp) ? currentTp.toFixed(1) : '';
    modal.classList.add('visible');
    requestAnimationFrame(() => { slField.focus(); slField.select(); });

    function cleanup(result) {
      modal.classList.remove('visible');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      modal.removeEventListener('keydown', onKeydown);
      modal.removeEventListener('mousedown', onBackdrop);
      resolve(result);
    }
    function onOk() {
      const sl = parseFloat(String(slField.value).replace(',', '.'));
      const tp = parseFloat(String(tpField.value).replace(',', '.'));
      cleanup({ sl, tp });
    }
    function onCancel() { cleanup(null); }
    function onKeydown(e) {
      if (e.key === 'Enter') { e.preventDefault(); onOk(); }
      else if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
    }
    function onBackdrop(e) { if (e.target === modal) onCancel(); }

    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    modal.addEventListener('keydown', onKeydown);
    modal.addEventListener('mousedown', onBackdrop);
  });
}


function showTextPrompt(initialValue = '', title = 'Texte à afficher') {
  return new Promise((resolve) => {
    const modal = document.getElementById('text-input-modal');
    const field = document.getElementById('text-input-field');
    const titleEl = document.getElementById('text-input-title');
    const okBtn = document.getElementById('text-input-ok');
    const cancelBtn = document.getElementById('text-input-cancel');

    titleEl.textContent = title;
    field.value = initialValue;
    modal.classList.add('visible');
    requestAnimationFrame(() => { field.focus(); field.select(); });

    function cleanup(result) {
      modal.classList.remove('visible');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      field.removeEventListener('keydown', onKeydown);
      modal.removeEventListener('mousedown', onBackdrop);
      resolve(result);
    }
    function onOk() { cleanup(field.value.trim()); }
    function onCancel() { cleanup(null); }
    function onKeydown(e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onOk(); }
      else if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
    }
    function onBackdrop(e) { if (e.target === modal) onCancel(); }

    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    field.addEventListener('keydown', onKeydown);
    modal.addEventListener('mousedown', onBackdrop);
  });
}

// NOUVEAU : affiche/masque + synchronise le bouton "Couleur du texte" du menu contextuel selon
// le dessin sélectionné. Appelée à l'ouverture du menu et après ajout/modification du texte.
function refreshTextColorButton(drawing) {
  const btn = document.getElementById('dcm-textcolor-btn');
  if (!btn) return;
  const supportsTextColor = drawing.type !== 'text' && drawing.type !== 'horizontal' && !!drawing.text;
  btn.style.display = supportsTextColor ? '' : 'none';
  if (supportsTextColor) {
    const tc = drawing.textColor || THEMES[currentTheme].textColor;
    document.getElementById('dcm-textcolor').value = tc;
    document.getElementById('dcm-textcolor-dot').style.background = tc;
  }
}

// NOUVEAU : taille du texte — visible pour l'outil Texte (toujours, puisque c'est SA raison
// d'être) et pour tout autre dessin portant un texte attaché (même condition que la couleur du
// texte, sans l'exclusion du type 'text' lui-même).
function refreshFontSizeButton(drawing) {
  const btn = document.getElementById('dcm-fontsize-btn');
  if (!btn) return;
  const supportsFontSize = drawing.type === 'text' || (drawing.type !== 'horizontal' && !!drawing.text);
  btn.style.display = supportsFontSize ? '' : 'none';
  if (supportsFontSize) {
    document.getElementById('dcm-fontsize-label').textContent = `${drawing.fontSize || DEFAULT_FONT_SIZE}px`;
  }
}

function showDrawingMenu(pane, drawing, pageX, pageY) {
  selectedDrawing = { pane, drawing };
  updateCanvasPointerEvents();
  hideWidthPopover();
  const menu = document.getElementById('drawing-context-menu');
  const locked = !!drawing.locked;
  const hasWidth = drawing.type !== 'text' && drawing.type !== 'longPosition' && drawing.type !== 'shortPosition';

  document.getElementById('dcm-color').value = drawing.color || drawingDefaultColor(drawing.type);
  document.getElementById('dcm-color-dot').style.background = drawing.color || drawingDefaultColor(drawing.type);

  // NOUVEAU : couleur de fond, réservée au rectangle (zone remplie). Le segment est une simple
  // ligne bornée — il ne partage avec le rectangle que ce menu, pas l'apparence — donc son texte
  // suit le même rendu que les outils trend/arrow (centré au-dessus de la ligne), sans position réglable.
  const isRectangle = drawing.type === 'rectangle';
  const isPosition = drawing.type === 'longPosition' || drawing.type === 'shortPosition';
  const bgBtn = document.getElementById('dcm-bgcolor-btn');
  const extLeftBtn = document.getElementById('dcm-extend-left');
  const extRightBtn = document.getElementById('dcm-extend-right');
  const qtyBtn = document.getElementById('dcm-qty');
  const pipsBtn = document.getElementById('dcm-pips');
  bgBtn.style.display = isRectangle ? '' : 'none';
  extLeftBtn.style.display = isRectangle ? '' : 'none';
  extRightBtn.style.display = isRectangle ? '' : 'none';

  // NOUVEAU : opacité du remplissage — rectangle (fond) et positions (zones risque/récompense).
  // Défaut par type si jamais réglé explicitement (rétrocompatible avec les valeurs en dur
  // précédentes : 25% rectangle, 22% positions).
  const fillOpacityBtn = document.getElementById('dcm-fillopacity-btn');
  fillOpacityBtn.style.display = (isRectangle || isPosition) ? '' : 'none';
  if (isRectangle || isPosition) {
    const defaultOpacity = isRectangle ? 0.25 : 0.22;
    const opacityPct = Math.round((drawing.fillOpacity ?? drawing.bgOpacity ?? defaultOpacity) * 100);
    document.getElementById('dcm-fillopacity-label').textContent = `${opacityPct}%`;
  }

  // NOUVEAU : couleur du texte attaché au dessin — visible dès qu'un texte est présent, pour
  // tous les types sauf 'text' (dont dcm-color EST déjà la couleur du texte) et 'horizontal'
  // (le texte suit le "title" natif de la ligne de prix, pas de couleur distincte possible).
  refreshTextColorButton(drawing);
  refreshFontSizeButton(drawing);
  if (qtyBtn) {
    qtyBtn.style.display = isPosition ? '' : 'none';
    if (isPosition) {
      const q = Number(drawing.quantity) > 0 ? Number(drawing.quantity) : 1;
      document.getElementById('dcm-qty-label').textContent = '×' + formatQty(q);
    }
  }
  if (pipsBtn) {
    pipsBtn.style.display = isPosition ? '' : 'none';
    if (isPosition) {
      const slPips = Math.abs(priceToPips(drawing.entryPrice - drawing.stopPrice));
      const tpPips = Math.abs(priceToPips(drawing.targetPrice - drawing.entryPrice));
      document.getElementById('dcm-pips-label').textContent =
        `${slPips.toFixed(1)} / ${tpPips.toFixed(1)} pips`;
    }
  }
  // NOUVEAU : couleurs distinctes stop / objectif pour les positions (comme le panneau natif
  // TradingView "Couleur du stop" / "Couleur de l'objectif"), en plus de la couleur de bordure
  // (dcm-color) qui reste la couleur de la ligne d'entrée pour ces dessins.
  const stopColorBtn = document.getElementById('dcm-stopcolor-btn');
  const targetColorBtn = document.getElementById('dcm-targetcolor-btn');
  stopColorBtn.style.display = isPosition ? '' : 'none';
  targetColorBtn.style.display = isPosition ? '' : 'none';
  if (isPosition) {
    document.getElementById('dcm-color-btn').title = 'Couleur de la ligne d\'entrée';
    const stopColor = drawing.stopColor || drawing.color || '#ef5350';
    const targetColor = drawing.targetColor || '#26a69a';
    document.getElementById('dcm-stopcolor').value = stopColor;
    document.getElementById('dcm-stopcolor-dot').style.background = stopColor;
    document.getElementById('dcm-targetcolor').value = targetColor;
    document.getElementById('dcm-targetcolor-dot').style.background = targetColor;
  } else {
    document.getElementById('dcm-color-btn').title = 'Couleur de bordure';
  }
  if (isRectangle) {
    const bgColor = drawing.bgColor || drawing.color || THEMES[currentTheme].drawColor;
    document.getElementById('dcm-bgcolor').value = bgColor;
    document.getElementById('dcm-bgcolor-dot').style.background = bgColor;
    const ext = getRectExtend(drawing);
    extLeftBtn.classList.toggle('is-active', ext.left);
    extRightBtn.classList.toggle('is-active', ext.right);
  }

  document.getElementById('dcm-width-btn').style.display = hasWidth ? '' : 'none';
  if (hasWidth) {
    const width = drawing.lineWidth || DEFAULT_LINE_WIDTH[drawing.type] || 1;
    document.getElementById('dcm-width-icon').innerHTML = widthLineSvg(width).match(/<line.*?\/>/)[0];
    document.getElementById('dcm-width-label').textContent = `${width}px`;
  }

  // NOUVEAU : le bouton "texte" est désormais disponible pour tous les types de dessin (une
  // ligne de tendance, un rectangle, etc. peuvent aussi porter une étiquette de texte), pas
  // seulement l'outil Texte dédié.
  const editTextBtn = document.getElementById('dcm-edit-text');
  editTextBtn.style.display = '';
  editTextBtn.title = drawing.text ? 'Modifier le texte' : 'Ajouter un texte';

  // NOUVEAU : position du texte (Haut / Bas / Intérieur) — uniquement pour l'outil rectangle.
  // Le segment (comme trend/arrow) affiche son texte centré au-dessus de la ligne, sans réglage.
  const textPosBtn = document.getElementById('dcm-textpos-btn');
  textPosBtn.style.display = isRectangle ? '' : 'none';
  if (isRectangle) {
    document.getElementById('dcm-textpos-label').textContent = TEXT_POSITION_LABELS[drawing.textPosition || 'top'];
  }

  const lockIcon = document.getElementById('dcm-lock');
  lockIcon.classList.toggle('is-locked', locked);
  lockIcon.innerHTML = locked
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 7-2.6"/></svg>';
  lockIcon.title = locked ? 'Déverrouiller' : 'Verrouiller';

  // Un dessin verrouillé ne peut plus être recoloré, redimensionné ou supprimé tant qu'il
  // n'est pas déverrouillé (le cadenas, lui, reste toujours cliquable).
  ['dcm-color-btn', 'dcm-bgcolor-btn', 'dcm-width-btn', 'dcm-fillopacity-btn', 'dcm-fontsize-btn', 'dcm-edit-text', 'dcm-textpos-btn', 'dcm-extend-left', 'dcm-extend-right', 'dcm-qty', 'dcm-pips', 'dcm-stopcolor-btn', 'dcm-targetcolor-btn', 'dcm-delete'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('locked-disabled', locked);
  });

  menu.style.left = `${pageX}px`;
  menu.style.top = `${pageY}px`;
  menu.classList.add('visible');
}

function hideDrawingMenu() {
  // Ne pas effacer selectedDrawing : les poignées restent visibles
  hideWidthPopover();
  hideTextPosPopover();
  document.getElementById('drawing-context-menu')?.classList.remove('visible');
}

// CORRECTIF : calcule un point d'ancrage (coordonnées écran) pour positionner le menu flottant
// au-dessus d'un dessin donné, quel que soit son type. Réutilise getDrawingHandles() (déjà
// exhaustif sur tous les types) plutôt que de dupliquer la géométrie par type.
function computeDrawingMenuAnchor(pane, drawing) {
  const rect = pane.inner.getBoundingClientRect();
  const handles = getDrawingHandles(pane, drawing);
  let minX = Infinity, maxX = -Infinity, minY = Infinity;
  for (const h of handles) {
    if (h.x < minX) minX = h.x;
    if (h.x > maxX) maxX = h.x;
    if (h.y < minY) minY = h.y;
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    // Fallback : aucune poignée exploitable (dessin hors du viewport actuel) → centre du pane
    minX = maxX = pane.inner.clientWidth / 2;
    minY = pane.inner.clientHeight / 2;
  }
  return {
    pageX: rect.left + (minX + maxX) / 2,
    pageY: rect.top + minY
  };
}

// CORRECTIF : point d'entrée unique "sélectionner ce dessin ET afficher son menu flottant"
// (couleur / épaisseur / texte / verrouillage / suppression) — comportement TradingView : le
// menu apparaît systématiquement dès qu'un dessin est sélectionné, pas seulement en le rouvrant.
function selectAndShowDrawingMenu(pane, drawing) {
  const { pageX, pageY } = computeDrawingMenuAnchor(pane, drawing);
  showDrawingMenu(pane, drawing, pageX, pageY);
}

function clearDrawingSelection() {
  selectedDrawing = null;
  hideDrawingMenu();
  updateCanvasPointerEvents();
  panes.forEach(p => { try { redrawPane(p); } catch {} });
}

