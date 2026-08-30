// ============================================================
// 03-drawing-primitives.js
// Utilitaires de dessin bas niveau (labels, handles, conversions prix/temps) et primitives natives lightweight-charts v5 (ShapePrimitive)
// Fait partie de renderer.js (sectionné en modules le 2026-08-28).
// Chargé comme <script> classique dans index.html : les variables/fonctions
// top-level restent globales et partagées entre tous ces fichiers, exactement
// comme dans l'ancien renderer.js monolithique — aucun changement de comportement.
// ============================================================
// ============ Dessin (Étape 3, style TradingView) ============
function formatPriceLabel(price) {
  if (price == null || Number.isNaN(price)) return '—';
  const prec = (priceFormat && priceFormat.precision != null) ? priceFormat.precision : 5;
  return Number(price).toFixed(prec);
}

// NOUVEAU : taille d'un pip déduite de la précision détectée du fichier chargé (convention
// forex : le pip est un ordre de grandeur au-dessus du plus petit incrément affiché — ex.
// précision 5 (EURUSD 1.23456) → pip = 0.0001 ; précision 3 (USDJPY 123.456) → pip = 0.01).
function getPipSize() {
  const prec = (priceFormat && priceFormat.precision != null) ? priceFormat.precision : 5;
  return Math.pow(10, -(prec - 1));
}

function priceToPips(priceDiff) {
  const pip = getPipSize();
  return pip > 0 ? priceDiff / pip : 0;
}

function formatPips(priceDiff) {
  const p = priceToPips(priceDiff);
  return `${p >= 0 ? '+' : ''}${p.toFixed(1)} pips`;
}

function formatTimeLabel(unixSeconds, timeframeMinutes) {
  const d = new Date(unixSeconds * 1000);
  if (timeframeMinutes >= 43200) {
    return d.toLocaleDateString('fr-FR', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  }
  if (timeframeMinutes >= 1440) {
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit', timeZone: 'UTC' });
  }
  if (timeframeMinutes >= 60) {
    return d.toLocaleString('fr-FR', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'UTC'
    });
  }
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
}

// Étiquette texte "plate", sans fond — toujours centrée sur son point d'ancrage, quel que soit
// l'appelant. Le paramètre `align` est conservé uniquement pour compatibilité des appels
// existants mais n'est plus utilisé : TOUT texte de dessin est désormais centré et sans fond
// (voir drawPlainLabel juste en dessous).
function drawLabelBox(ctx, x, y, text, color, align = 'left', fontSize) {
  drawPlainLabel(ctx, x, y, text, color, fontSize);
}

// Étiquette texte "plate", sans encart de fond — juste le texte coloré, avec un léger contour
// sombre pour rester lisible par-dessus les bougies. Utilisée pour le texte de TOUS les dessins :
// toujours centrée sur (x, y), jamais de fond plein.
function drawPlainLabel(ctx, x, y, text, color, fontSize) {
  // NOUVEAU : taille réglable par dessin (14px par défaut, au lieu de 11px fixe), et texte en
  // gras pour une meilleure lisibilité — demandé suite au halo illisible de l'ancien rendu.
  const size = fontSize || DEFAULT_FONT_SIZE;
  ctx.font = `bold ${size}px 'Calibri', -apple-system, BlinkMacSystemFont, Roboto, sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  // CORRECTIF : l'ancien contour épais (strokeText, lineWidth 3) formait un "halo" noir flou
  // autour de chaque lettre, disproportionné avec une police fine (Calibri Light) — rendant le
  // texte illisible au lieu de l'aider. Remplacé par une ombre portée douce (shadowBlur), qui
  // garde la lisibilité sur les bougies sans épaissir/déformer les lettres elles-mêmes.
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.85)';
  ctx.shadowBlur = 3;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
  ctx.textAlign = 'left'; // reset pour ne pas affecter d'autres dessins de la même frame
}

// Petite poignée circulaire aux extrémités des lignes (comme les points d'ancrage TradingView)
function drawHandle(ctx, x, y, color) {
  ctx.beginPath();
  ctx.arc(x, y, 3.5, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
}

// CORRECTIF : plusieurs outils (Fibonacci Retracement/Extension, etc.) appliquent leur PROPRE
// opacité par-dessus la couleur du dessin via hexToRgba(color, alphaDuNiveau). Si `color` est
// déjà un rgba() (bordure avec opacité choisie via la jauge de la palette custom), le slice()
// hex ci-dessous produisait des canaux NaN → couleur CSS invalide → bordure invisible. On
// détecte maintenant ce cas et on MULTIPLIE les deux opacités au lieu de planter.
function hexToRgba(hex, alpha) {
  if (typeof hex === 'string' && hex.startsWith('rgba')) {
    const parsed = parseColorToHexAlpha(hex);
    const r = parseInt(parsed.hex.slice(1, 3), 16), g = parseInt(parsed.hex.slice(3, 5), 16), b = parseInt(parsed.hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${parsed.alpha * alpha})`;
  }
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// Ligne horizontale native (comme TradingView : l'étiquette de prix vit dans l'échelle de prix,
// pas dessinée par-dessus le graphique)
function createNativePriceLine(pane, drawing) {
  drawing.priceLine = pane.series.createPriceLine({
    price: drawing.price,
    color: drawing.color || THEMES[currentTheme].drawColor,
    lineWidth: drawing.lineWidth || DEFAULT_LINE_WIDTH.horizontal,
    lineStyle: LightweightCharts.LineStyle.Solid,
    axisLabelVisible: true,
    // NOUVEAU : le texte ajouté via le menu contextuel s'affiche directement sur la ligne
    // (lightweight-charts rend nativement ce "title" à côté de l'étiquette de prix).
    title: drawing.text || ''
  });
}

// ============ NOUVEAU : Primitives natives (lightweight-charts v5) ============
// trend / arrow / rectangle / vertical / text sont migrés du canvas overlay maison vers ce
// système, comme `horizontal` (createNativePriceLine) l'était déjà — et qui n'a jamais eu le
// bug de z-index puisqu'il est rendu par le moteur du graphique lui-même, sur le même bitmap
// que les bougies, plutôt que sur un <canvas> HTML séparé superposé par-dessus.
//
// draw() est appelé par le graphique à chaque frame de rendu (pan, zoom, resize, changement de
// données) : pas besoin de recalculer/mémoriser les coordonnées nous-mêmes, ni de rebrancher un
// listener sur subscribeVisibleTimeRangeChange comme pour l'ancien canvas overlay.
class ShapePrimitivePaneView {
  constructor(source) { this._source = source; }
  renderer() {
    const source = this._source;
    return {
      draw(target) {
        target.useBitmapCoordinateSpace((scope) => {
          const ctx = scope.context;
          ctx.save();
          // On travaille en coordonnées "media" (mêmes valeurs que timeToCoordinate /
          // priceToCoordinate) : le scale() gère la conversion vers le bitmap (device pixel ratio).
          ctx.scale(scope.horizontalPixelRatio, scope.verticalPixelRatio);
          source.draw(ctx);
          ctx.restore();
        });
      }
    };
  }
}

// NOUVEAU : épaisseurs proposées dans le menu flottant (mêmes valeurs que LineWidth de
// lightweight-charts pour les price lines natives, réutilisées ici pour toutes les primitives).
const WIDTH_PRESETS = [1, 2, 3, 4];
// NOUVEAU : tailles de texte disponibles pour l'outil Texte et le texte attaché aux dessins
// (segment, tendance, rectangle...) — 14px devient la taille par défaut (au lieu de 11/12px
// fixés en dur), réglable ensuite par dessin via le bouton "Taille du texte" du menu.
const FONT_SIZE_PRESETS = [10, 11, 12, 14, 16, 18, 20, 24];
const DEFAULT_FONT_SIZE = 14;
// NOUVEAU : positions possibles pour le texte d'un rectangle (Haut / Bas / Intérieur)
const TEXT_POSITION_LABELS = { top: 'Haut', bottom: 'Bas', inside: 'Intérieur' };
const DEFAULT_LINE_WIDTH = { horizontal: 1, vertical: 2, trend: 2, arrow: 2, rectangle: 1, segment: 2, zigzagArrow: 2, breakCross: 2, horizontalRay: 2 };
// NOUVEAU : demi-longueur (en pixels) des branches de l'outil Croix (marqueur de break)
const BREAK_CROSS_SIZE = 7;

// NOUVEAU : mode infini du rectangle — extension indépendante à gauche et/ou à droite (comme
// le panneau Style > Prolonger de TradingView). Rétrocompatible avec l'ancien booléen unique
// `infinite` des dessins déjà enregistrés dans un workspace (traité comme gauche+droite).
// Ne concerne que le rectangle : le segment est une ligne bornée et ne passe jamais par ici.
function getRectExtend(d) {
  if (d.extendLeft != null || d.extendRight != null) {
    return { left: !!d.extendLeft, right: !!d.extendRight };
  }
  return { left: !!d.infinite, right: !!d.infinite };
}

// NOUVEAU (fix) : ts.timeToCoordinate() natif ne renvoie une coordonnée que si `time` correspond
// exactement au timestamp d'une bougie de la série actuellement affichée. Un dessin créé sur un
// timeframe fin (ex: 1 minute) a un temps qui ne tombe presque jamais pile sur l'ouverture d'une
// bougie d'un timeframe plus large (ex: 1 jour) → la conversion native renvoie null et le dessin
// disparaît. Dans l'autre sens ça marche "par chance" (l'ouverture d'une bougie journalière tombe
// aussi pile sur le début d'une bougie 1 minute). On corrige en interpolant/extrapolant la
// coordonnée à partir des deux bougies de la série actuelle qui encadrent le temps demandé, en
// supposant un espacement régulier entre bougies consécutives (vrai pour une série agrégée).
function timeToCoordinateSafe(pane, ts, time) {
  const direct = ts.timeToCoordinate(time);
  if (direct !== null) return direct;

  const bars = pane.lastAggregated;
  if (!bars || bars.length < 2) return null;

  const last = bars.length - 1;
  let iA, iB;
  if (time <= bars[0].time) {
    iA = 0; iB = 1; // extrapolation à gauche du premier point connu
  } else if (time >= bars[last].time) {
    iA = last - 1; iB = last; // extrapolation à droite du dernier point connu
  } else {
    // Recherche dichotomique de l'intervalle [iA, iB] qui encadre `time`
    let lo = 0, hi = last;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (bars[mid].time <= time) lo = mid; else hi = mid;
    }
    iA = lo; iB = hi;
  }

  const tA = bars[iA].time, tB = bars[iB].time;
  const xA = ts.timeToCoordinate(tA), xB = ts.timeToCoordinate(tB);
  if (xA === null || xB === null || tB === tA) return null;

  const ratio = (time - tA) / (tB - tA);
  return xA + (xB - xA) * ratio;
}

// NOUVEAU (fix) : proxy léger autour de la timeScale native — même API pour tout le reste
// (coordinateToTime, getVisibleLogicalRange, etc.), seule timeToCoordinate() est rendue robuste
// aux changements de timeframe via timeToCoordinateSafe() ci-dessus.
function safeTimeScale(pane) {
  const real = pane.chart.timeScale();
  return new Proxy(real, {
    get(target, prop, receiver) {
      if (prop === 'timeToCoordinate') {
        return (time) => timeToCoordinateSafe(pane, target, time);
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
}

// NOUVEAU (fix) : ts.coordinateToTime(x) natif renvoie null pour tout pixel situé après la
// dernière bougie chargée (au-delà de la petite marge de droite par défaut) — donc impossible de
// placer ou déplacer un point de dessin "après le graphique" (ex: une cible de trade prévisionnelle
// loin dans le futur). On calcule alors le temps correspondant via l'index logique du pixel
// (coordinateToLogical, qui lui reste défini même hors des données réelles) converti en temps en
// supposant un espacement régulier entre les bougies de la série actuelle.
function coordinateToTimeSafe(pane, ts, x) {
  const direct = ts.coordinateToTime(x);
  if (direct !== null) return direct;

  const bars = pane.lastAggregated;
  if (!bars || bars.length < 2) return null;
  const logical = ts.coordinateToLogical(x);
  if (logical === null) return null;

  const n = bars.length;
  const step = (bars[n - 1].time - bars[0].time) / (n - 1);
  if (!Number.isFinite(step) || step <= 0) return null;
  return Math.round(bars[0].time + logical * step);
}

class ShapePrimitive {
  constructor(pane, drawing) {
    this._pane = pane;
    this._drawing = drawing;
    this._paneView = new ShapePrimitivePaneView(this);
    this._chart = null;
    this._series = null;
    this._requestUpdate = null;
  }
  attached({ chart, series, requestUpdate }) {
    this._chart = chart;
    this._series = series;
    this._requestUpdate = requestUpdate;
  }
  detached() { this._chart = null; this._series = null; this._requestUpdate = null; }
  updateAllViews() { /* rien à précalculer : draw() lit les coordonnées à la volée */ }
  paneViews() { return [this._paneView]; }
  // Force un nouveau rendu (ex. après un changement de thème, la couleur étant lue dynamiquement)
  refresh() { this._requestUpdate?.(); }

  draw(ctx) {
    if (!this._chart || !this._series) return;
    const d = this._drawing;
    if (d._hiddenByReplay || isDrawingInFuture(d, getReplayCutoffTime())) return;
    const ts = safeTimeScale(this._pane);
    const color = d.color || drawingDefaultColor(d.type);
    // NOUVEAU : couleur du texte attaché à un dessin (segment, tendance, flèche, ligne
    // verticale, rectangle...), indépendante de la couleur du tracé lui-même. Réglable par
    // dessin via le menu contextuel (dcm-textcolor) ; sinon retombe sur la couleur "Texte" du
    // thème (déjà distincte de segmentColor et de drawColor).
    const labelColor = d.textColor || THEMES[currentTheme].textColor || color;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([]);

    if (d.type === 'vertical') {
      const x = ts.timeToCoordinate(d.time);
      if (x === null) return;
      ctx.lineWidth = d.lineWidth || DEFAULT_LINE_WIDTH.vertical;
      const h = this._pane.inner.clientHeight;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
      drawLabelBox(ctx, x, h - 12, formatTimeLabel(d.time, this._pane.timeframe), color, 'center');
      // NOUVEAU : étiquette de texte facultative, en haut de la ligne verticale
      if (d.text) drawLabelBox(ctx, x, 12, d.text, labelColor, 'center', d.fontSize);

    } else if (d.type === 'text') {
      const x = ts.timeToCoordinate(d.time), y = this._series.priceToCoordinate(d.price);
      if (x === null || y === null) return;
      // NOUVEAU : taille réglable (14px par défaut) + gras, cohérent avec drawPlainLabel.
      const size = d.fontSize || DEFAULT_FONT_SIZE;
      ctx.font = `bold ${size}px 'Calibri', -apple-system, BlinkMacSystemFont, Roboto, sans-serif`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      // CORRECTIF : ombre douce au lieu du contour épais (strokeText) qui formait un halo flou
      // illisible avec une police fine — voir drawPlainLabel plus haut pour le détail.
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.85)';
      ctx.shadowBlur = 3;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
      ctx.fillStyle = color;
      ctx.fillText(d.text, x, y);
      ctx.restore();
      ctx.textAlign = 'left'; // reset pour ne pas affecter d'autres dessins de la même frame

    } else if (d.type === 'trend' || d.type === 'arrow' || d.type === 'segment') {
      const x1 = ts.timeToCoordinate(d.p1.time), y1 = this._series.priceToCoordinate(d.p1.price);
      const x2 = ts.timeToCoordinate(d.p2.time), y2 = this._series.priceToCoordinate(d.p2.price);
      if ([x1, y1, x2, y2].some(v => v === null)) return;
      ctx.lineWidth = d.lineWidth || DEFAULT_LINE_WIDTH[d.type];
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();

      if (d.type === 'arrow') {
        const angle = Math.atan2(y2 - y1, x2 - x1), headLen = 10;
        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 6), y2 - headLen * Math.sin(angle - Math.PI / 6));
        ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 6), y2 - headLen * Math.sin(angle + Math.PI / 6));
        ctx.closePath(); ctx.fill();
      }

      // NOUVEAU : étiquette de texte facultative, dans sa propre couleur (labelColor), toujours
      // différente de la couleur du tracé par défaut. Pour trend/arrow, centrée légèrement
      // au-dessus de la ligne (pour ne pas cacher la pointe de la flèche). Pour le segment,
      // écrite directement SUR la ligne, en son centre, comme demandé.
      if (d.text) {
        const textY = d.type === 'segment' ? (y1 + y2) / 2 : (y1 + y2) / 2 - 14;
        drawLabelBox(ctx, (x1 + x2) / 2, textY, d.text, labelColor, 'center', d.fontSize);
      }

    } else if (d.type === 'rectangle') {
      if (!d.p1 || !d.p2) return; // dessin incomplet : rien à tracer plutôt que de planter
      const y1 = this._series.priceToCoordinate(d.p1.price), y2 = this._series.priceToCoordinate(d.p2.price);
      if (y1 === null || y2 === null) return;
      // NOUVEAU : extension indépendante à gauche et/ou à droite (comme TradingView : les deux
      // cases "Prolonger à Gauche" / "Prolonger à Droite" peuvent être cochées ensemble). On
      // recalcule les bords étendus à chaque frame à partir de la largeur visible du pane, donc
      // ça reste "infini" pendant un pan/zoom.
      const ext = getRectExtend(d);
      const x1raw = ts.timeToCoordinate(d.p1.time), x2raw = ts.timeToCoordinate(d.p2.time);
      if (!ext.left && !ext.right && (x1raw === null || x2raw === null)) return;
      const paneW = this._pane.inner.clientWidth;
      let rx, rEnd;
      if (ext.left && ext.right) {
        rx = 0; rEnd = paneW;
      } else if (x1raw === null || x2raw === null) {
        // Un point hors du viewport mais l'autre bord est étendu : on ne peut pas positionner
        // le bord borné, on retombe sur le plein-largeur pour ce côté plutôt que de ne rien tracer.
        rx = ext.left ? 0 : paneW;
        rEnd = ext.right ? paneW : 0;
        if (rx > rEnd) { const t = rx; rx = rEnd; rEnd = t; }
      } else {
        rx = ext.left ? 0 : Math.min(x1raw, x2raw);
        rEnd = ext.right ? paneW : Math.max(x1raw, x2raw);
      }
      const rw = Math.max(0, rEnd - rx);
      const ry = Math.min(y1, y2), rh = Math.abs(y2 - y1);

      // NOUVEAU : couleur de fond indépendante de la couleur de bordure (dcm-bgcolor). Si non
      // définie, on retombe sur l'ancien comportement (couleur de bordure à 15% d'opacité) pour
      // rester rétrocompatible avec les dessins déjà enregistrés dans un workspace.
      // NOUVEAU : opacité réglable via la jauge (dcm-fillopacity) au lieu d'une valeur fixe —
      // d.bgOpacity conservé en compat pour d'anciens dessins sauvegardés avant ce réglage.
      ctx.fillStyle = d.bgColor ? hexToRgba(d.bgColor, d.fillOpacity ?? d.bgOpacity ?? 0.25) : hexToRgba(color, d.fillOpacity ?? 0.15);
      ctx.fillRect(rx, ry, rw, rh);
      ctx.strokeStyle = color;
      ctx.lineWidth = d.lineWidth || DEFAULT_LINE_WIDTH[d.type];
      // Bords horizontaux (haut/bas) toujours tracés ; les bords verticaux ne le sont que du
      // côté non étendu, pour signaler visuellement quelle(s) direction(s) sont "infinies".
      ctx.beginPath();
      ctx.moveTo(rx, ry); ctx.lineTo(rx + rw, ry);
      ctx.moveTo(rx, ry + rh); ctx.lineTo(rx + rw, ry + rh);
      if (!ext.left) { ctx.moveTo(rx, ry); ctx.lineTo(rx, ry + rh); }
      if (!ext.right) { ctx.moveTo(rx + rw, ry); ctx.lineTo(rx + rw, ry + rh); }
      ctx.stroke();

      // NOUVEAU : étiquette de texte facultative, sans fond, toujours centrée horizontalement
      // sur le rectangle — position verticale réglable via le menu contextuel (Haut / Bas /
      // Intérieur), comme le panneau Style > Position du texte de TradingView.
      if (d.text) {
        const textPos = d.textPosition || 'top';
        if (textPos === 'bottom') {
          drawPlainLabel(ctx, rx + rw / 2, ry + rh + 12, d.text, labelColor, d.fontSize);
        } else if (textPos === 'inside') {
          drawPlainLabel(ctx, rx + rw / 2, ry + rh / 2, d.text, labelColor, d.fontSize);
        } else {
          drawPlainLabel(ctx, rx + rw / 2, Math.max(10, ry - 10), d.text, labelColor, d.fontSize);
        }
      }

    } else if (d.type === 'breakCross') {
      // NOUVEAU : marqueur "Croix" — signale un break de structure à un point précis
      // (time, price), façon "X-Cross" de TradingView. Simple dessin à un point, comme
      // 'text' et 'vertical' : pas de p1/p2, juste une ancre unique déplaçable.
      const x = ts.timeToCoordinate(d.time), y = this._series.priceToCoordinate(d.price);
      if (x === null || y === null) return;
      const s = BREAK_CROSS_SIZE;
      ctx.lineWidth = d.lineWidth || DEFAULT_LINE_WIDTH.breakCross;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x - s, y - s); ctx.lineTo(x + s, y + s);
      ctx.moveTo(x + s, y - s); ctx.lineTo(x - s, y + s);
      ctx.stroke();
      // NOUVEAU : étiquette de texte facultative (ex. "Break", "BOS", "CHoCH"), au-dessus de la croix
      if (d.text) drawLabelBox(ctx, x, y - s - 10, d.text, labelColor, 'center', d.fontSize);

    } else if (d.type === 'longPosition' || d.type === 'shortPosition') {
      drawPositionTool(ctx, this._pane, this._series, ts, d);
    } else if (d.type === 'fibRetracement') {
      drawFibRetracement(ctx, this._pane, this._series, ts, d);
    } else if (d.type === 'fibExtension') {
      drawFibExtension(ctx, this._pane, this._series, ts, d);
    } else if (d.type === 'parallelChannel') {
      drawParallelChannel(ctx, this._pane, this._series, ts, d);
    } else if (d.type === 'ray') {
      drawRay(ctx, this._pane, this._series, ts, d);
    } else if (d.type === 'horizontalRay') {
      drawHorizontalRay(ctx, this._pane, this._series, ts, d);
    } else if (d.type === 'pitchfork') {
      drawPitchfork(ctx, this._pane, this._series, ts, d);
    } else if (d.type === 'priceRange') {
      drawPriceRange(ctx, this._pane, this._series, ts, d);
    } else if (d.type === 'triangle') {
      drawTriangle(ctx, this._pane, this._series, ts, d);
    } else if (d.type === 'ellipse') {
      drawEllipse(ctx, this._pane, this._series, ts, d);
    } else if (d.type === 'circle') {
      drawCircle(ctx, this._pane, this._series, ts, d);
    } else if (d.type === 'zigzagArrow') {
      drawZigzagArrow(ctx, this._pane, this._series, ts, d);
    }
  }
}

function formatQty(q) {
  const n = Number(q);
  if (!Number.isFinite(n) || n === 0) return '1';
  if (Math.abs(n) >= 1000) return n.toLocaleString('fr-FR', { maximumFractionDigits: 2 });
  return String(Number(n.toPrecision(6)));
}

/** PnL en « points de prix × quantité » (unité libre, pas de devises broker). */
function computePositionPnl(d, markPrice) {
  const qty = Number(d.quantity) > 0 ? Number(d.quantity) : 1;
  const isLong = d.type === 'longPosition';
  let exit = markPrice;
  if (d._hitStatus === 'stop') exit = d.stopPrice;
  if (d._hitStatus === 'target') exit = d.targetPrice;
  if (exit == null || d.entryPrice == null) return null;
  const raw = isLong ? (exit - d.entryPrice) : (d.entryPrice - exit);
  const risk = Math.abs(d.entryPrice - d.stopPrice);
  const reward = Math.abs(d.targetPrice - d.entryPrice);
  return {
    qty,
    pnl: raw * qty,
    risk: risk * qty,
    reward: reward * qty,
    rMultiple: risk > 0 ? raw / risk : 0,
    closed: !!d._hitStatus
  };
}

