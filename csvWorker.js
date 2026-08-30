// Web Worker : parse le CSV sans jamais bloquer l'UI.
// Reçoit { rawText }, renvoie des messages 'progress' puis un message final 'done' ou 'error'.
//
// AMÉLIORATION : tolère désormais les formats des principaux fournisseurs de données, pas
// seulement le format "maison" (time,open,high,low,close,volume) :
//   - Dukascopy  : colonnes "Gmt time,Open,High,Low,Close,Volume", dates "01.01.2020 00:00:00.000"
//   - MetaTrader : colonnes "Date,Time,Open,High,Low,Close,Volume" (date + heure séparées),
//                  dates au format "2020.01.01"
//   - Exports Excel européens : séparateur ';' et décimales à virgule ("1,08500")
//   - Dates ISO, timestamps Unix (secondes ou millisecondes), et formats US "MM/DD/YYYY"

function detectDelimiter(headerLine) {
  const commaCount = (headerLine.match(/,/g) || []).length;
  const semicolonCount = (headerLine.match(/;/g) || []).length;
  const tabCount = (headerLine.match(/\t/g) || []).length;
  if (tabCount > commaCount && tabCount > semicolonCount) return '\t';
  return semicolonCount > commaCount ? ';' : ',';
}

// Normalise une cellule d'en-tête : minuscules, espaces multiples réduits, guillemets/chevrons
// retirés (utile pour les en-têtes MetaTrader du style "<DATE>" ou Dukascopy entre guillemets).
function normalizeHeaderCell(cell) {
  return cell.trim().toLowerCase().replace(/^["'<]+|["'>]+$/g, '').replace(/\s+/g, ' ');
}

function stripQuotes(cell) {
  return (cell ?? '').trim().replace(/^"+|"+$/g, '');
}

// NOUVEAU (compatibilité) : découpage d'une ligne CSV qui gère les champs entre guillemets
// contenant le délimiteur (ex. `"Paris, France";1.0850;...`) et les guillemets échappés au
// format RFC 4180 (`""` à l'intérieur d'un champ = un seul `"` littéral). L'ancien code faisait
// un simple `line.split(delimiter)`, qui coupait au milieu d'un champ entre guillemets dès que
// celui-ci contenait le délimiteur — cas rencontré sur certains exports (courtiers/Excel) dont
// une colonne texte (commentaire, symbole composé...) est entre guillemets.
function splitCsvLineQuoted(line, delimiter) {
  const fields = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { field += '"'; i++; } // guillemet échappé
        else inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delimiter) {
      fields.push(field);
      field = '';
    } else {
      field += c;
    }
  }
  fields.push(field);
  return fields;
}

// PERF : la grande majorité des exports (Dukascopy, MetaTrader...) ne contiennent aucun
// guillemet — dans ce cas on garde le `split()` natif, nettement plus rapide qu'un parcours
// caractère par caractère, ce qui compte sur des fichiers de plusieurs millions de lignes.
// Le parcours dédié (splitCsvLineQuoted) n'est utilisé que pour les lignes qui en ont besoin.
function splitCsvLine(line, delimiter) {
  return line.indexOf('"') === -1 ? line.split(delimiter) : splitCsvLineQuoted(line, delimiter);
}

function findColumn(header, aliases, exclude = []) {
  for (const alias of aliases) {
    const i = header.indexOf(alias);
    if (i !== -1 && !exclude.includes(i)) return i;
  }
  return -1;
}

// Convertit une valeur numérique en tenant compte des exports européens (Excel, certains
// courtiers) où la virgule sert de séparateur décimal quand le délimiteur de colonnes est ';' ou
// une tabulation (donc la virgule ne peut pas être un séparateur de champ dans ce cas).
function parseNumber(raw, delimiter) {
  let s = stripQuotes(raw);
  if (!s) return NaN;
  if (delimiter !== ',' && s.includes(',')) {
    // "1.234,56" (milliers + décimales) ou simplement "1,08500"
    s = s.replace(/\./g, '').replace(',', '.');
  }
  return parseFloat(s);
}

// Parse une date/heure dans à peu près n'importe quel format courant et renvoie un timestamp
// Unix en secondes (UTC), ou NaN si le format n'est pas reconnu.
function parseTimestamp(raw) {
  let s = stripQuotes(raw);
  if (!s) return NaN;

  // Timestamp Unix pur : secondes (10 chiffres) ou millisecondes (13 chiffres)
  if (/^\d+$/.test(s)) {
    const n = parseInt(s, 10);
    return s.length >= 13 ? Math.floor(n / 1000) : n;
  }

  // Décalage horaire explicite en suffixe, ex. "01.01.2020 02:00:00.000 GMT+0200"
  // (courant dans les exports "Local time" de Dukascopy) : on le retire puis on corrige
  // le résultat final pour obtenir un timestamp UTC exact.
  let offsetMinutes = 0;
  const gmtMatch = s.match(/\b(?:GMT|UTC)\s*([+-])(\d{1,2}):?(\d{2})?\b/i);
  if (gmtMatch) {
    const sign = gmtMatch[1] === '-' ? -1 : 1;
    offsetMinutes = sign * (parseInt(gmtMatch[2], 10) * 60 + parseInt(gmtMatch[3] || '0', 10));
    s = s.replace(gmtMatch[0], '').trim();
  }

  let m;

  // DD.MM.YYYY[ HH:mm[:ss[.SSS]]]  → format Dukascopy
  m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,3}))?)?$/);
  if (m) {
    const [, d, mo, y, h, mi, se, ms] = m;
    return Math.floor(Date.UTC(+y, +mo - 1, +d, +(h || 0), +(mi || 0), +(se || 0), +(ms || 0)) / 1000) - offsetMinutes * 60;
  }

  // YYYY.MM.DD[ HH:mm[:ss]]  → format MetaTrader
  m = s.match(/^(\d{4})\.(\d{1,2})\.(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) {
    const [, y, mo, d, h, mi, se] = m;
    return Math.floor(Date.UTC(+y, +mo - 1, +d, +(h || 0), +(mi || 0), +(se || 0)) / 1000) - offsetMinutes * 60;
  }

  // MM/DD/YYYY[ HH:mm[:ss]]  → format US (bascule en DD/MM si le 1er nombre dépasse 12)
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) {
    let [, a, b, y, h, mi, se] = m;
    a = +a; b = +b;
    const [mo, d] = a > 12 ? [b, a] : [a, b];
    return Math.floor(Date.UTC(+y, mo - 1, d, +(h || 0), +(mi || 0), +(se || 0)) / 1000) - offsetMinutes * 60;
  }

  // ISO 8601 : YYYY-MM-DD[THH:mm:ss...]
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const t = Date.parse(/[T ]/.test(s) ? s : s + 'T00:00:00Z');
    if (!Number.isNaN(t)) return Math.floor(t / 1000) - offsetMinutes * 60;
  }

  // Dernier recours : moteur de dates natif
  const fallback = Date.parse(s);
  return Number.isNaN(fallback) ? NaN : Math.floor(fallback / 1000) - offsetMinutes * 60;
}

const ALIASES = {
  time: ['time', 'timestamp', 'time (utc)', 'gmt time', 'local time', 'date time', 'datetime', 'date/time', 'datetime', 'bar time', 'bartime'],
  date: ['date'],
  hour: ['time', 'heure', 'hour'],
  open: ['open', 'o', 'ouverture', 'open price', 'openprice', 'px_open', 'bidopen', 'askopen'],
  high: ['high', 'h', 'haut', 'plus haut', 'high price', 'highprice', 'px_high', 'bidhigh', 'askhigh', 'max'],
  low: ['low', 'l', 'bas', 'plus bas', 'low price', 'lowprice', 'px_low', 'bidlow', 'asklow', 'min'],
  close: ['close', 'c', 'cloture', 'clôture', 'fermeture', 'last', 'price', 'close price', 'closeprice', 'px_close', 'bidclose', 'askclose', 'mid', 'midprice'],
  volume: ['volume', 'vol', 'vol.', 'tickvol', 'tick volume', 'real volume', 'tick_volume', 'ticks', 'size', 'qty', 'quantity'],
  // Formats tick (soft4FX / courtiers) : une seule colonne prix ou bid/ask
  bid: ['bid', 'bid price', 'bidprice', 'bid_price'],
  ask: ['ask', 'ask price', 'askprice', 'ask_price', 'offer'],
  tickPrice: ['price', 'last', 'last price', 'lastprice', 'trade', 'trade price', 'mid', 'midprice']
};

// PERF (gros fichiers) : `rawText.trim().split('\n').filter(...)` allouait immédiatement un
// second tableau de chaînes de la même taille que le fichier entier (~doublement du pic
// mémoire pendant le split, avant même de commencer le parsing), plus un `.trim()` par ligne
// juste pour détecter les lignes vides. splitNonEmptyLines() fait un seul passage sur le texte
// avec indexOf, sans jamais matérialiser un tableau intermédiaire filtré ni retrimer chaque ligne.
function splitNonEmptyLines(rawText) {
  const lines = [];
  const len = rawText.length;
  let start = 0;
  while (start < len) {
    let end = rawText.indexOf('\n', start);
    if (end === -1) end = len;
    let lineEnd = end;
    // gère les fins de ligne CRLF sans dupliquer la chaîne (pas de .replace global sur tout le texte)
    if (lineEnd > start && rawText.charCodeAt(lineEnd - 1) === 13) lineEnd--;
    if (lineEnd > start) lines.push(rawText.slice(start, lineEnd)); // ignore les lignes vides
    start = end + 1;
  }
  return lines;
}

// PERF : au-delà de ce nombre de lignes ignorées détaillées, on continue de compter (skipped++)
// mais on arrête d'empiler les objets {line, reason} — un CSV pathologique avec des millions de
// lignes invalides ne doit pas faire grossir la mémoire du worker indéfiniment. Seules les 50
// premières sont de toute façon envoyées au renderer (voir plus bas).
const MAX_SKIPPED_DETAILS_TRACKED = 500;

self.onmessage = function (e) {
  const { rawText } = e.data;

  try {
    const lines = splitNonEmptyLines(rawText);
    if (lines.length < 2) {
      return self.postMessage({ type: 'error', message: 'Fichier CSV vide ou incomplet' });
    }

    // Détection fichier binaire (ex. soft4FX CTF natif) : beaucoup de caractères non-imprimables
    // → message d’erreur explicite plutôt que « colonnes manquantes ».
    {
      const sample = rawText.slice(0, Math.min(rawText.length, 4096));
      let nonPrintable = 0;
      for (let i = 0; i < sample.length; i++) {
        const c = sample.charCodeAt(i);
        if (c === 0 || (c < 32 && c !== 9 && c !== 10 && c !== 13)) nonPrintable++;
      }
      if (sample.length > 0 && nonPrintable / sample.length > 0.15) {
        return self.postMessage({
          type: 'error',
          message: 'Fichier binaire détecté (format CTF propriétaire soft4FX ?). Exportez en CSV texte (DateTime,Bid,Ask ou OHLCV) depuis soft4FX Data Manager, puis rechargez le CSV.'
        });
      }
    }

    const delimiter = detectDelimiter(lines[0]);
    let header = splitCsvLine(lines[0], delimiter).map(normalizeHeaderCell);
    let dataStartLine = 1; // index dans lines[] de la 1re ligne de données

    // Heuristique « en-tête réel » : si la 1re ligne ressemble à des données numériques/dates
    // (pas de libellés open/high/...), on traite le fichier comme sans en-tête.
    function looksLikeHeader(cells) {
      const joined = cells.join(' ');
      if (/open|high|low|close|bid|ask|volume|time|date|timestamp|prix|ouverture/i.test(joined)) return true;
      // Si la majorité des cellules ne sont pas des nombres purs, c’est probablement un header
      let numeric = 0;
      for (const c of cells) {
        const n = parseNumber(c, delimiter);
        if (!Number.isNaN(n)) numeric++;
      }
      return numeric < Math.ceil(cells.length / 2);
    }

    let headerless = false;
    if (!looksLikeHeader(header)) {
      headerless = true;
      dataStartLine = 0;
      // Mapping positionnel courant : time, open, high, low, close [, volume]
      // ou time, bid, ask [, volume]
      const n = header.length;
      if (n >= 5) {
        header = ['time', 'open', 'high', 'low', 'close'].concat(n >= 6 ? ['volume'] : []);
        while (header.length < n) header.push('col' + header.length);
      } else if (n === 4) {
        header = ['time', 'open', 'high', 'close']; // rare
      } else if (n === 3) {
        header = ['time', 'bid', 'ask'];
      } else if (n === 2) {
        header = ['time', 'price'];
      } else {
        return self.postMessage({
          type: 'error',
          message: `Fichier sans en-tête avec ${n} colonne(s) — attendu au minimum time+prix (2) ou time+OHLC (5).`
        });
      }
    }

    let openIdx = findColumn(header, ALIASES.open);
    let highIdx = findColumn(header, ALIASES.high);
    let lowIdx = findColumn(header, ALIASES.low);
    let closeIdx = findColumn(header, ALIASES.close);
    const volumeIdx = findColumn(header, ALIASES.volume);
    const bidIdx = findColumn(header, ALIASES.bid);
    const askIdx = findColumn(header, ALIASES.ask);
    // Prix tick unique : éviter de réutiliser la même colonne que close si déjà mappée OHLC
    let tickPriceIdx = findColumn(header, ALIASES.tickPrice);
    if (tickPriceIdx !== -1 && (tickPriceIdx === openIdx || tickPriceIdx === highIdx || tickPriceIdx === lowIdx || tickPriceIdx === closeIdx)) {
      // Si "price" a été pris comme close dans un vrai OHLC, c’est OK — ne pas forcer le mode tick
      if (openIdx !== -1 && highIdx !== -1 && lowIdx !== -1) tickPriceIdx = -1;
    }

    // Mode tick : bid/ask ou price unique → OHLC synthétique (O=H=L=C)
    const tickMode = (openIdx === -1 || highIdx === -1 || lowIdx === -1 || closeIdx === -1)
      && (bidIdx !== -1 || askIdx !== -1 || tickPriceIdx !== -1);

    if (tickMode) {
      // closeIdx sert de fallback pour le prix de référence dans la boucle
      if (closeIdx === -1) closeIdx = tickPriceIdx !== -1 ? tickPriceIdx : (bidIdx !== -1 ? bidIdx : askIdx);
      if (openIdx === -1) openIdx = closeIdx;
      if (highIdx === -1) highIdx = closeIdx;
      if (lowIdx === -1) lowIdx = closeIdx;
    }

    const missingOHLC = [];
    if (openIdx === -1) missingOHLC.push('open');
    if (highIdx === -1) missingOHLC.push('high');
    if (lowIdx === -1) missingOHLC.push('low');
    if (closeIdx === -1) missingOHLC.push('close');
    if (missingOHLC.length) {
      const found = header.filter(Boolean).slice(0, 12).join(', ');
      return self.postMessage({
        type: 'error',
        message: `Colonne(s) obligatoire(s) manquante(s) : ${missingOHLC.join(', ')}. `
          + `Colonnes détectées : [${found || 'aucune'}]. `
          + `Formats acceptés : OHLCV, ou ticks (time+bid/ask, time+price). `
          + `Si c’est un CTF soft4FX binaire, exportez-le en CSV texte d’abord.`
      });
    }

    // Colonne temporelle : priorité à la paire "date" + "time"/"heure" séparées (format
    // MetaTrader/courtiers) ; sinon une colonne unique date+heure ("time", "gmt time"...) ;
    // sinon une colonne "date" seule (barres journalières, sans heure).
    let dateIdx = findColumn(header, ALIASES.date);
    let hourIdx = dateIdx !== -1 ? findColumn(header, ALIASES.hour, [dateIdx]) : -1;
    let timeIdx = -1;

    if (dateIdx === -1 || hourIdx === -1) {
      timeIdx = findColumn(header, ALIASES.time, dateIdx !== -1 ? [dateIdx] : []);
    }

    if (dateIdx !== -1 && hourIdx !== -1) {
      timeIdx = -1; // la paire date+heure a priorité sur une colonne "time" isolée
    } else if (timeIdx === -1 && dateIdx !== -1) {
      timeIdx = dateIdx; // colonne "date" seule (barres journalières)
      dateIdx = -1;
      hourIdx = -1;
    }

    // Fichier sans en-tête : la 1re colonne est toujours le temps
    if (headerless && timeIdx === -1) timeIdx = 0;

    if (timeIdx === -1 && dateIdx === -1) {
      const found = header.filter(Boolean).slice(0, 12).join(', ');
      return self.postMessage({
        type: 'error',
        message: `Colonne de date/heure introuvable (attendu : time, date, gmt time, timestamp...). Colonnes : [${found}]`
      });
    }

    let data = [];
    const skippedDetails = [];
    let totalSkipped = 0; // compteur exact, indépendant du plafond appliqué à skippedDetails
    const total = Math.max(1, lines.length - dataStartLine);
    const progressStep = Math.max(1, Math.floor(total / 20)); // ~20 mises à jour de progression

    for (let i = dataStartLine; i < lines.length; i++) {
      const cols = splitCsvLine(lines[i], delimiter);
      const neededCols = Math.max(openIdx, highIdx, lowIdx, closeIdx, timeIdx, dateIdx, hourIdx, bidIdx, askIdx, tickPriceIdx) + 1;

      if (cols.length < neededCols) {
        if (skippedDetails.length < MAX_SKIPPED_DETAILS_TRACKED) {
          skippedDetails.push({ line: i + 1, reason: 'Nombre de colonnes insuffisant' });
        }
        totalSkipped++;
        continue;
      }

      const rawTimestamp = timeIdx !== -1
        ? cols[timeIdx]
        : (hourIdx !== -1 ? `${stripQuotes(cols[dateIdx])} ${stripQuotes(cols[hourIdx])}` : cols[dateIdx]);
      const time = parseTimestamp(rawTimestamp);

      let open, high, low, close, volume;
      if (tickMode) {
        // Prix tick : mid(bid,ask) si dispo, sinon price/bid/ask
        let px = NaN;
        const bid = bidIdx !== -1 ? parseNumber(cols[bidIdx], delimiter) : NaN;
        const ask = askIdx !== -1 ? parseNumber(cols[askIdx], delimiter) : NaN;
        if (!Number.isNaN(bid) && !Number.isNaN(ask)) px = (bid + ask) / 2;
        else if (!Number.isNaN(bid)) px = bid;
        else if (!Number.isNaN(ask)) px = ask;
        else if (tickPriceIdx !== -1) px = parseNumber(cols[tickPriceIdx], delimiter);
        else px = parseNumber(cols[closeIdx], delimiter);
        open = high = low = close = px;
        volume = volumeIdx !== -1 ? parseNumber(cols[volumeIdx], delimiter) : 1;
      } else {
        open = parseNumber(cols[openIdx], delimiter);
        high = parseNumber(cols[highIdx], delimiter);
        low = parseNumber(cols[lowIdx], delimiter);
        close = parseNumber(cols[closeIdx], delimiter);
        volume = volumeIdx !== -1 ? parseNumber(cols[volumeIdx], delimiter) : 0;
      }

      if (Number.isNaN(time)) {
        if (skippedDetails.length < MAX_SKIPPED_DETAILS_TRACKED) {
          skippedDetails.push({ line: i + 1, reason: `Date/heure non reconnue : "${stripQuotes(rawTimestamp)}"` });
        }
        totalSkipped++;
        continue;
      }
      if ([open, high, low, close].some(v => Number.isNaN(v))) {
        if (skippedDetails.length < MAX_SKIPPED_DETAILS_TRACKED) {
          skippedDetails.push({ line: i + 1, reason: 'Valeur OHLC/prix non numérique' });
        }
        totalSkipped++;
        continue;
      }

      data.push({ time, open, high, low, close, volume: Number.isNaN(volume) ? 0 : volume });

      if ((i - dataStartLine) % progressStep === 0) {
        self.postMessage({ type: 'progress', percent: Math.round(((i - dataStartLine) / total) * 100) });
      }
    }

    if (data.length === 0) {
      return self.postMessage({ type: 'error', message: 'Aucune ligne valide trouvée dans le CSV' });
    }

    data.sort((a, b) => a.time - b.time);

    // CORRECTIF (robustesse) : lightweight-charts exige des timestamps STRICTEMENT croissants
    // dans series.setData() — deux barres au même "time" (ticks à la même seconde, exports mal
    // nettoyés, colonne date seule pour des données plus fines que la journée...) font planter
    // le rendu ("Assertion failed: data must be asc ordered by time"). On fusionne ici les
    // lignes consécutives de même timestamp (même convention que l'agrégation par timeframe :
    // open = première, high = max, low = min, close = dernière, volume = somme) plutôt que de
    // les rejeter, pour ne pas perdre l'information de prix qu'elles contiennent.
    let dedupCount = 0;
    if (data.length > 1) {
      const deduped = new Array(data.length);
      let count = 0;
      let current = data[0];
      deduped[count++] = current;
      for (let i = 1; i < data.length; i++) {
        const bar = data[i];
        if (bar.time === current.time) {
          if (bar.high > current.high) current.high = bar.high;
          if (bar.low < current.low) current.low = bar.low;
          current.close = bar.close;
          current.volume += bar.volume || 0;
          dedupCount++;
        } else {
          current = bar;
          deduped[count++] = current;
        }
      }
      deduped.length = count;
      data = deduped;
    }

    self.postMessage({
      type: 'done',
      data,
      skipped: totalSkipped,
      skippedDetails: skippedDetails.slice(0, 50), // limite l'envoi à 50 détails
      duplicatesMerged: dedupCount,
      delimiter
    });
  } catch (err) {
    self.postMessage({ type: 'error', message: err.message });
  }
};
