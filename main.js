const { app, BrowserWindow, ipcMain, dialog, Menu, shell, session } = require('electron');
const path = require('path');
const fs = require('fs');

// CSP stricte appliquée en en-tête HTTP (Electron la détecte mieux que la seule balise <meta>).
// Pas de 'unsafe-eval' → plus d'avertissement « Insecure Content-Security-Policy » en dev.
const APP_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",  // styles inline dans index.html (thèmes dynamiques via JS OK)
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "child-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
  "frame-ancestors 'none'"
].join('; ');

function installContentSecurityPolicy() {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...(details.responseHeaders || {}) };
    // Remplace toute CSP existante pour une politique unique et stricte
    headers['Content-Security-Policy'] = [APP_CSP];
    callback({ responseHeaders: headers });
  });
}

const RECENT_FILES_PATH = () => path.join(app.getPath('userData'), 'recent-files.json');
const WORKSPACE_PATH = () => path.join(app.getPath('userData'), 'workspace.json');
// NOUVEAU : modèles de dessin nommés (style "Save/Load drawing template" de TradingView),
// indépendants de la sauvegarde automatique par fichier CSV (workspace.json). Un modèle est
// un instantané des dessins d'une grille, réutilisable sur n'importe quel autre fichier/pane.
const TEMPLATES_PATH = () => path.join(app.getPath('userData'), 'templates.json');
// NOUVEAU : styles de dessin nommés (par TYPE de dessin — trendline, rectangle, position...),
// capturés depuis un dessin précis déjà modifié (couleur, épaisseur, etc.) pour être réappliqués
// à un autre dessin du même type. Distinct de templates.json (qui, lui, mémorise TOUS les
// dessins d'une grille) : ici on ne mémorise que l'apparence d'un seul dessin à la fois.
const DRAWING_STYLES_PATH = () => path.join(app.getPath('userData'), 'drawing-styles.json');
const MAX_RECENT = 5;
const isDev = !app.isPackaged;

app.setName('TradingView Clone');

// Une seule instance à la fois : évite les écritures concurrentes sur recent-files.json /
// workspace.json si l'app est relancée pendant qu'elle tourne déjà.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
}

let mainWindow = null;

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#131722', // évite le flash blanc au démarrage (l'app est en thème sombre par défaut)
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Le sandbox par défaut (Electron 20+) bloque require('fs') et require('path')
      // dans preload.js — nécessaires ici pour lire les CSV directement sur le disque.
      // contextIsolation reste actif : le renderer n'a toujours accès qu'à l'API
      // explicitement exposée via contextBridge dans preload.js.
      sandbox: false
    }
  });
  win.once('ready-to-show', () => win.show());
  win.loadFile('index.html');

  // Empêche l'app de naviguer vers une URL externe ou d'ouvrir une popup depuis le renderer ;
  // tout lien externe éventuel s'ouvre dans le navigateur système plutôt que dans l'app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault();
  });

  // Diagnostic : Electron déclenche cet événement si preload.js échoue à se charger,
  // avec le message d'erreur exact (ex. module manquant, erreur de syntaxe, chemin invalide)
  win.webContents.on('preload-error', (event, preloadPath, error) => {
    console.error('❌ Erreur de chargement du preload :', preloadPath);
    console.error(error);
  });

  return win;
}

function buildMenu() {
  const template = [
    {
      label: 'Fichier',
      submenu: [
        {
          label: 'Ouvrir un CSV / CTF...',
          accelerator: 'CmdOrCtrl+O',
          click: (item, win) => win?.webContents.send('menu:open-csv')
        },
        { type: 'separator' },
        { role: 'quit', label: 'Quitter' }
      ]
    },
    {
      label: 'Affichage',
      submenu: [
        { role: 'reload', label: 'Recharger' },
        { role: 'togglefullscreen', label: 'Plein écran' },
        { role: 'resetZoom', label: 'Zoom normal' },
        { role: 'zoomIn', label: 'Zoom avant' },
        { role: 'zoomOut', label: 'Zoom arrière' },
        ...(isDev ? [{ type: 'separator' }, { role: 'toggleDevTools', label: 'Outils de développement' }] : [])
      ]
    },
    {
      label: 'Aide',
      submenu: [
        {
          label: 'À propos',
          click: () => {
            app.setAboutPanelOptions({
              applicationName: 'TradingView Clone',
              applicationVersion: app.getVersion()
            });
            app.showAboutPanel();
          }
        }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

ipcMain.handle('dialog:openCsv', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(win, {
    title: 'Choisir un fichier CSV ou CTF',
    properties: ['openFile'],
    filters: [
      { name: 'Données de marché (CSV, CTF)', extensions: ['csv', 'ctf'] },
      { name: 'Fichiers CSV', extensions: ['csv'] },
      { name: 'Fichiers CTF', extensions: ['ctf'] },
      { name: 'Tous les fichiers', extensions: ['*'] }
    ]
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('recent:get', () => {
  try { return JSON.parse(fs.readFileSync(RECENT_FILES_PATH(), 'utf-8')); }
  catch { return []; }
});

ipcMain.handle('recent:add', (event, filePath) => {
  if (typeof filePath !== 'string' || !filePath.trim()) return [];
  let list = [];
  try { list = JSON.parse(fs.readFileSync(RECENT_FILES_PATH(), 'utf-8')); } catch { list = []; }
  list = list.filter(p => p !== filePath);
  list.unshift(filePath);
  list = list.slice(0, MAX_RECENT);
  try { fs.writeFileSync(RECENT_FILES_PATH(), JSON.stringify(list, null, 2), 'utf-8'); }
  catch (err) { console.error('Erreur sauvegarde fichiers récents:', err); }
  return list;
});

// ---------- NOUVEAU (Étape 4) : persistance du workspace ----------
// Écriture atomique : évite un workspace.json corrompu si le process est tué en plein write.
function atomicWriteJson(filePath, obj) {
  const dir = path.dirname(filePath);
  const tmp = path.join(dir, `.${path.basename(filePath)}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf-8');
  fs.renameSync(tmp, filePath);
}

function readWorkspaceSafe() {
  try {
    return JSON.parse(fs.readFileSync(WORKSPACE_PATH(), 'utf-8'));
  } catch {
    return null;
  }
}

// Fusionne drawingsByFile disque ↔ mémoire pour ne pas écraser les entrées d'autres fichiers
// mises à jour hors session (ou par une sauvegarde concurrente théorique).
function mergeDrawingsByFile(incoming, onDisk) {
  const out = { ...(onDisk || {}) };
  if (!incoming || typeof incoming !== 'object') return out;
  for (const [filePath, entry] of Object.entries(incoming)) {
    if (!entry || typeof entry !== 'object') continue;
    const existing = out[filePath];
    const inTs = Number(entry.updatedAt) || 0;
    const exTs = existing ? (Number(existing.updatedAt) || 0) : 0;
    // Garde l'entrée la plus récente ; à timestamp égal, privilégie l'incoming (source active)
    if (!existing || inTs >= exTs) {
      out[filePath] = entry;
    }
  }
  return out;
}

ipcMain.handle('workspace:save', (event, workspaceObj) => {
  try {
    if (!workspaceObj || typeof workspaceObj !== 'object') return { ok: false, reason: 'invalid' };

    const onDisk = readWorkspaceSafe();
    // Conflit de révision : le disque a une revision strictement plus récente que celle
    // que le renderer pensait connaître → on fusionne plutôt que d'écraser aveuglément.
    const clientRev = Number(workspaceObj.revision) || 0;
    const diskRev = onDisk ? (Number(onDisk.revision) || 0) : 0;

    const merged = { ...workspaceObj };
    merged.drawingsByFile = mergeDrawingsByFile(
      workspaceObj.drawingsByFile,
      onDisk?.drawingsByFile
    );

    if (onDisk && diskRev > clientRev) {
      // Le disque a avancé : on conserve les clés globales les plus récentes pour les
      // fichiers non courants, mais le filePath / panes / layout de la session active gagnent
      // (l'utilisateur est en train d'éditer).
      merged.revision = diskRev + 1;
      merged._mergedFromConflict = true;
    } else {
      merged.revision = Math.max(clientRev, diskRev) + 1;
      merged._mergedFromConflict = false;
    }
    merged.savedAt = Date.now();

    atomicWriteJson(WORKSPACE_PATH(), merged);
    return {
      ok: true,
      revision: merged.revision,
      mergedFromConflict: !!merged._mergedFromConflict,
      savedAt: merged.savedAt
    };
  } catch (err) {
    console.error('Erreur sauvegarde workspace:', err);
    return { ok: false, reason: err.message };
  }
});

ipcMain.handle('workspace:load', () => {
  return readWorkspaceSafe();
});

// ---------- NOUVEAU : modèles de dessin nommés (templates) ----------
// Fichier séparé de workspace.json : un modèle survit au "Restaurer par défaut" et n'est pas
// lié à un fichier CSV précis. Écriture atomique comme pour workspace.json (même raison :
// éviter un templates.json corrompu si l'app est tuée en plein write).
function readTemplatesSafe() {
  try {
    const data = JSON.parse(fs.readFileSync(TEMPLATES_PATH(), 'utf-8'));
    return (data && typeof data === 'object') ? data : {};
  } catch {
    return {};
  }
}

ipcMain.handle('templates:get', () => {
  return readTemplatesSafe();
});

ipcMain.handle('templates:save', (event, templatesObj) => {
  try {
    if (!templatesObj || typeof templatesObj !== 'object') return { ok: false, reason: 'invalid' };
    atomicWriteJson(TEMPLATES_PATH(), templatesObj);
    return { ok: true };
  } catch (err) {
    console.error('Erreur sauvegarde modèles de dessin:', err);
    return { ok: false, reason: err.message };
  }
});

// ---------- NOUVEAU : styles de dessin nommés, par type (drawing-styles.json) ----------
function readDrawingStylesSafe() {
  try {
    const data = JSON.parse(fs.readFileSync(DRAWING_STYLES_PATH(), 'utf-8'));
    return (data && typeof data === 'object') ? data : {};
  } catch {
    return {};
  }
}

ipcMain.handle('drawingStyles:get', () => {
  return readDrawingStylesSafe();
});

ipcMain.handle('drawingStyles:save', (event, stylesObj) => {
  try {
    if (!stylesObj || typeof stylesObj !== 'object') return { ok: false, reason: 'invalid' };
    atomicWriteJson(DRAWING_STYLES_PATH(), stylesObj);
    return { ok: true };
  } catch (err) {
    console.error('Erreur sauvegarde styles de dessin:', err);
    return { ok: false, reason: err.message };
  }
});

ipcMain.handle('workspace:reset', () => {
  try {
    if (fs.existsSync(WORKSPACE_PATH())) fs.unlinkSync(WORKSPACE_PATH());
    // Nettoie d'éventuels .tmp orphelins
    const dir = path.dirname(WORKSPACE_PATH());
    try {
      for (const f of fs.readdirSync(dir)) {
        if (f.startsWith('.workspace.json.') && f.endsWith('.tmp')) {
          try { fs.unlinkSync(path.join(dir, f)); } catch {}
        }
      }
    } catch {}
    return true;
  } catch (err) {
    console.error('Erreur reset workspace:', err);
    return false;
  }
});

if (gotSingleInstanceLock) {
  app.whenReady().then(() => {
    installContentSecurityPolicy();
    buildMenu();
    mainWindow = createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  // Filet de sécurité : loggue plutôt que de laisser le process principal crasher en silence.
  process.on('uncaughtException', (err) => {
    console.error('❌ Exception non interceptée dans le process principal :', err);
  });
}