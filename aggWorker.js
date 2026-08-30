// Web Worker : agrège les données OHLCV sans jamais bloquer l'UI (amélioration #2)

// PERF (gros fichiers) : l'ancienne implémentation passait par une Map (hachage du bucketTime
// à chaque barre + Array.from + un second tri final) même si l'entrée est déjà triée par temps
// croissant (garanti par csvWorker.js / generateMockData()). Avec des données triées, les barres
// d'un même bucket sont TOUJOURS contiguës : pas besoin de structure de hachage, un simple
// pointeur "bucket courant" suffit. Ça élimine le coût de hachage par barre, le tri final
// redondant, et la structure intermédiaire Map (remplacée par un tableau pré-dimensionné).
// Sur un fichier de plusieurs millions de barres, c'est la différence entre un aller-retour
// mémoire par barre et un simple compteur incrémenté.
/**
 * Alignement du début de bougie (UTC) selon le timeframe.
 * - Intraday : multiples exacts de N minutes depuis l'epoch
 * - 1D : minuit UTC (ou dayBoundaryHourUtc si réglé dans Paramètres > Graphique)
 * - 1W : lundi (décalé) 00:00+offset UTC (ISO)
 * - 1M : 1er du mois (décalé) 00:00+offset UTC
 */
function bucketStart(unixSec, timeframeMinutes, dayBoundaryHourUtc) {
  const t = Number(unixSec);
  if (!Number.isFinite(t)) return 0;
  const offsetSec = ((Number(dayBoundaryHourUtc) || 0) % 24) * 3600;

  // Jour calendaire UTC (décalé)
  if (timeframeMinutes === 1440) {
    return Math.floor((t - offsetSec) / 86400) * 86400 + offsetSec;
  }
  // Semaine ISO (lundi 00:00+offset UTC)
  if (timeframeMinutes === 10080) {
    const day = Math.floor((t - offsetSec) / 86400); // jours depuis epoch
    // epoch (1970-01-01) = jeudi → (day + 3) % 7 === 0 pour un lundi
    // lundi = day - ((day + 3) % 7)
    const mondayDay = day - ((day + 3) % 7);
    return mondayDay * 86400 + offsetSec;
  }
  // Mois calendaire UTC (décalé)
  if (timeframeMinutes === 43200) {
    const d = new Date((t - offsetSec) * 1000);
    return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000) + offsetSec;
  }

  const bucketSize = Math.max(1, timeframeMinutes) * 60;
  return Math.floor(t / bucketSize) * bucketSize;
}

function aggregateOHLCV(data, timeframeMinutes, dayBoundaryHourUtc) {
  if (!data || data.length === 0) return [];
  const tf = Number(timeframeMinutes) || 1;
  // CORRECTIF : l'ancien garde-fou `if (tf <= 1) return data;` sautait TOUJOURS l'agrégation
  // pour "1m", même quand la résolution native des données est plus fine que la minute (ticks,
  // secondes) — dans ce cas on veut au contraire regrouper en vraies bougies de 60 secondes,
  // pas renvoyer les lignes brutes sous l'étiquette "1m". La décision de sauter l'agrégation
  // quand le TF demandé est ≤ la résolution native (ex. "1m" sur un fichier déjà en 5m) doit se
  // prendre en AMONT, côté renderer.js::aggregateAsync — seul endroit qui connaît
  // baseTimeframeSeconds (résolution native détectée). Si ce Worker est appelé, un vrai
  // regroupement est voulu : on l'exécute systématiquement, quel que soit tf.

  const result = new Array(data.length);
  let count = 0;
  let current = null;

  for (let i = 0; i < data.length; i++) {
    const bar = data[i];
    const bucketTime = bucketStart(bar.time, tf, dayBoundaryHourUtc);
    if (current === null || bucketTime !== current.time) {
      current = {
        time: bucketTime,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume || 0
      };
      result[count++] = current;
    } else {
      if (bar.high > current.high) current.high = bar.high;
      if (bar.low < current.low) current.low = bar.low;
      current.close = bar.close;
      current.volume += bar.volume || 0;
    }
  }

  result.length = count;
  return result;
}

self.onmessage = function (e) {
  const { id, data, minutes, dayBoundaryHourUtc } = e.data;
  try {
    const result = aggregateOHLCV(data, minutes, dayBoundaryHourUtc);
    self.postMessage({ id, type: 'done', data: result });
  } catch (err) {
    self.postMessage({ id, type: 'error', message: err.message });
  }
};