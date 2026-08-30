const { contextBridge, ipcRenderer, webUtils } = require('electron');
const fs = require('fs');
const path = require('path');

const ALLOWED_DATA_EXTS = new Set(['.csv', '.ctf']);

function isAllowedDataFile(filePath) {
  return ALLOWED_DATA_EXTS.has(path.extname(filePath).toLowerCase());
}

function isBinaryCtfBuffer(buf) {
  if (!buf || buf.length < 16) return false;
  const sampleLen = Math.min(buf.length, 4096);
  let nonPrintable = 0;
  for (let i = 0; i < sampleLen; i++) {
    const c = buf[i];
    if (c === 0 || (c < 32 && c !== 9 && c !== 10 && c !== 13)) nonPrintable++;
  }
  return nonPrintable / sampleLen > 0.15;
}

/**
 * Facteur d'échelle soft4FX.
 * PRIORITÉ FOREX (0.5–3) avant indices, sinon GBPUSD ~1.34e6 / 1000 = 1340
 * (faux) au lieu de /1e6 = 1.34 (correct).
 */
function detectPriceScale(medianRaw) {
  if (!(medianRaw > 0) || !Number.isFinite(medianRaw)) return 1000;

  // 1) Forex majeurs (EURUSD, GBPUSD…) : raw typiquement ≥ ~5e5 (prix×1e5 ou ×1e6)
  for (const s of [1000000, 100000]) {
    const p = medianRaw / s;
    if (p >= 0.5 && p <= 3.5 && medianRaw >= 400000) return s;
  }
  // 2) Paires JPY (~30–200)
  for (const s of [1000, 10000, 100]) {
    const p = medianRaw / s;
    if (p >= 20 && p <= 250) return s;
  }
  // 3) Indices (ASX200, NAS100, DAX…) cotés en milliers
  for (const s of [1000, 100, 10, 1]) {
    const p = medianRaw / s;
    if (p >= 500 && p <= 100000) return s;
  }
  // 4) Fallback : ramener vers ~4 chiffres
  const mag = Math.floor(Math.log10(medianRaw));
  const exp = Math.max(0, mag - 3);
  return Math.pow(10, exp);
}

function bucket1m(unixSec) {
  return Math.floor(Number(unixSec) / 60) * 60;
}

/**
 * CTF soft4FX binaire → CSV OHLCV en barres 1 minute (style TradingView).
 */
function decodeSoft4FxCtfToCsv(buf) {
  const n = buf.length;
  if (n < 32) throw new Error('Fichier CTF trop petit');

  const startDay = buf.readUInt32LE(0);
  const endDay = buf.readUInt32LE(4);
  const version = buf.readUInt32LE(8);

  const MIN_TS = 1420070400;
  const MAX_TS = 2051222400;

  let i = 0;
  while (i < n - 5) {
    if (buf[i] === 0xff) {
      const t = buf.readUInt32LE(i + 1);
      if (t >= MIN_TS && t <= MAX_TS) break;
    }
    i++;
  }
  if (i >= n - 5) {
    throw new Error(
      'CTF soft4FX : aucun horodatage trouvé (v' + version +
      ', jours ' + startDay + '→' + endDay + ').'
    );
  }

  const rawTicks = [];
  let currentTime = 0;
  let guard = 0;
  const GUARD_MAX = 50_000_000;

  let refMid = 0;
  const warmupPool = [];
  const WARMUP_TARGET = 50;
  let warmupDone = false;

  function looksLikePricePair(bidRaw, askRaw) {
    if (bidRaw < 100 || askRaw < 100) return false;
    if (bidRaw > 500_000_000 || askRaw > 500_000_000) return false;
    // Spread : forex souvent très serré ; indices un peu plus large
    if (askRaw < bidRaw * 0.95 || askRaw > bidRaw * 1.1) return false;
    if (warmupDone) {
      const mid = (bidRaw + askRaw) / 2;
      if (mid < refMid * 0.75 || mid > refMid * 1.25) return false;
    }
    return true;
  }

  function acceptPair(bidRaw, askRaw) {
    const mid = (bidRaw + askRaw) / 2;
    if (!warmupDone) {
      warmupPool.push(mid);
      if (warmupPool.length >= WARMUP_TARGET) {
        const sorted = warmupPool.slice().sort((a, b) => a - b);
        refMid = sorted[Math.floor(sorted.length / 2)];
        warmupDone = true;
      }
    } else {
      refMid = refMid * 0.997 + mid * 0.003;
    }
    rawTicks.push({ time: currentTime, bidRaw, askRaw });
  }

  while (i < n - 5 && guard++ < GUARD_MAX) {
    if (buf[i] === 0xff) {
      const t = buf.readUInt32LE(i + 1);
      if (t >= MIN_TS && t <= MAX_TS) {
        if (rawTicks.length > 50 && currentTime > 0 && t > currentTime + 86400 * 45) {
          i += 5;
          continue;
        }
        currentTime = t;
        i += 5;
        let first = true;
        while (i + 8 <= n) {
          if (buf[i] === 0xff && i + 5 <= n) {
            const t2 = buf.readUInt32LE(i + 1);
            if (t2 >= MIN_TS && t2 <= MAX_TS) break;
          }
          if (!first) {
            i += 1;
            if (i + 8 > n) break;
            if (buf[i] === 0xff && i + 5 <= n) {
              const t2 = buf.readUInt32LE(i + 1);
              if (t2 >= MIN_TS && t2 <= MAX_TS) break;
            }
          }
          const bidRaw = buf.readUInt32LE(i);
          const askRaw = buf.readUInt32LE(i + 4);
          if (!looksLikePricePair(bidRaw, askRaw)) {
            let synced = false;
            for (let s = 1; s <= 12 && i + 8 + s <= n; s++) {
              if (buf[i + s] === 0xff && i + s + 5 <= n) {
                const t2 = buf.readUInt32LE(i + s + 1);
                if (t2 >= MIN_TS && t2 <= MAX_TS) {
                  i += s;
                  synced = true;
                  break;
                }
              }
              const b2 = buf.readUInt32LE(i + s);
              const a2 = buf.readUInt32LE(i + s + 4);
              if (looksLikePricePair(b2, a2)) {
                i += s;
                acceptPair(b2, a2);
                i += 8;
                first = false;
                synced = true;
                break;
              }
            }
            if (!synced) break;
            continue;
          }
          acceptPair(bidRaw, askRaw);
          i += 8;
          first = false;
          if (rawTicks.length >= 8_000_000) break;
        }
        if (rawTicks.length >= 8_000_000) break;
        continue;
      }
    }
    i++;
  }

  if (rawTicks.length === 0) {
    throw new Error('CTF soft4FX : aucun tick décodé');
  }

  // Médiane robuste (milieu du fichier) pour l'échelle
  const sampleStart = Math.min(
    Math.floor(rawTicks.length * 0.15),
    Math.max(0, rawTicks.length - 800)
  );
  const sampleEnd = Math.min(rawTicks.length, sampleStart + 800);
  const sampleMids = [];
  for (let k = sampleStart; k < sampleEnd; k++) {
    sampleMids.push((rawTicks[k].bidRaw + rawTicks[k].askRaw) / 2);
  }
  sampleMids.sort((a, b) => a - b);
  const medianRaw = sampleMids[Math.floor(sampleMids.length / 2)] || 1;
  const scale = detectPriceScale(medianRaw);

  // Barres 1 MINUTE OHLCV (TradingView)
  const bars = [];
  let curBucket = -1;
  let o = 0, h = 0, l = 0, c = 0, vol = 0;

  for (let k = 0; k < rawTicks.length; k++) {
    const t = rawTicks[k];
    const bucket = bucket1m(t.time);
    if (bucket < curBucket) continue;

    const mid = (t.bidRaw + t.askRaw) / (2 * scale);

    if (bucket !== curBucket) {
      if (curBucket >= 0) {
        bars.push({ time: curBucket, open: o, high: h, low: l, close: c, volume: vol });
      }
      curBucket = bucket;
      o = h = l = c = mid;
      vol = 1;
    } else {
      if (mid > h) h = mid;
      if (mid < l) l = mid;
      c = mid;
      vol += 1;
    }
  }
  if (curBucket >= 0) {
    bars.push({ time: curBucket, open: o, high: h, low: l, close: c, volume: vol });
  }

  if (bars.length === 0) {
    throw new Error('CTF soft4FX : aucune barre 1m');
  }

  // Filtre final : écarter les barres dont le close est hors 5× la médiane des closes
  // (sécurité anti-outlier résiduel qui explose l'axe Y)
  const closes = bars.map(b => b.close).slice().sort((a, b) => a - b);
  const medClose = closes[Math.floor(closes.length / 2)] || 1;
  const lo = medClose * 0.2;
  const hi = medClose * 5;
  const clean = bars.filter(b =>
    b.close >= lo && b.close <= hi &&
    b.open >= lo && b.open <= hi &&
    b.high >= lo && b.high <= hi &&
    b.low >= lo && b.low <= hi &&
    b.high >= b.low
  );

  const out = clean.length >= Math.max(10, bars.length * 0.5) ? clean : bars;

  const lines = new Array(out.length + 1);
  lines[0] = 'time,open,high,low,close,volume';
  for (let k = 0; k < out.length; k++) {
    const b = out[k];
    lines[k + 1] =
      b.time + ',' + b.open + ',' + b.high + ',' + b.low + ',' + b.close + ',' + b.volume;
  }
  return lines.join('\n');
}

async function readFileSafe(filePath) {
  try {
    if (typeof filePath !== 'string' || !filePath.trim()) return null;
    if (!isAllowedDataFile(filePath)) return null;
    const fullPath = path.isAbsolute(filePath) ? filePath : path.join(__dirname, filePath);
    const buf = await fs.promises.readFile(fullPath);

    if (isBinaryCtfBuffer(buf)) {
      try {
        return decodeSoft4FxCtfToCsv(buf);
      } catch (err) {
        return 'ERROR_CTF_BINARY:' + (err && err.message ? err.message : String(err));
      }
    }

    let text = buf.toString('utf-8');
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    return text;
  } catch {
    return null;
  }
}

async function getFileSizeSafe(filePath) {
  try {
    if (typeof filePath !== 'string' || !filePath.trim()) return null;
    if (!isAllowedDataFile(filePath)) return null;
    const fullPath = path.isAbsolute(filePath) ? filePath : path.join(__dirname, filePath);
    const stat = await fs.promises.stat(fullPath);
    return stat.size;
  } catch {
    return null;
  }
}

contextBridge.exposeInMainWorld('api', {
  readCsvFile: (filePath) => readFileSafe(filePath),
  getCsvFileSize: (filePath) => getFileSizeSafe(filePath),
  getFileName: (filePath) => path.basename(filePath),
  openCsvDialog: () => ipcRenderer.invoke('dialog:openCsv'),
  getRecentFiles: () => ipcRenderer.invoke('recent:get'),
  addRecentFile: (filePath) => ipcRenderer.invoke('recent:add', filePath),
  getPathForFile: (file) => {
    try { return webUtils.getPathForFile(file); }
    catch { return file.path || null; }
  },
  saveWorkspace: (obj) => ipcRenderer.invoke('workspace:save', obj),
  loadWorkspace: () => ipcRenderer.invoke('workspace:load'),
  resetWorkspace: () => ipcRenderer.invoke('workspace:reset'),
  // NOUVEAU : modèles de dessin nommés (templates.json, séparé du workspace)
  getDrawingTemplates: () => ipcRenderer.invoke('templates:get'),
  saveDrawingTemplates: (obj) => ipcRenderer.invoke('templates:save', obj),
  // NOUVEAU : styles de dessin nommés, par type (drawing-styles.json, séparé de templates.json)
  getDrawingStyleTemplates: () => ipcRenderer.invoke('drawingStyles:get'),
  saveDrawingStyleTemplates: (obj) => ipcRenderer.invoke('drawingStyles:save', obj),
  fileExists: (filePath) => {
    try { return fs.existsSync(filePath); } catch { return false; }
  },
  onOpenCsvMenu: (callback) => ipcRenderer.on('menu:open-csv', callback)
});
