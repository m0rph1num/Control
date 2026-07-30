// ═══════════════════════════════════════════════════════════════════════════════
// Control — Preload (IPC Bridge)
// ═══════════════════════════════════════════════════════════════════════════════

const { contextBridge, ipcRenderer } = require('electron');
const path = require('path');
const fs = require('fs');

// ── Resolve assets directory (works in dev and packaged) ──────────────────────

function getAssetsDir() {
  // In packaged app: resourcesPath points to <app>/resources/ (extraResources lands here)
  // In dev: __dirname is the project root where assets/ lives
  if (process.resourcesPath) {
    const p = path.join(process.resourcesPath, 'assets');
    if (fs.existsSync(p)) return p;
  }
  return path.join(__dirname, 'assets');
}

function getAssetDataUrl(name) {
  try {
    const fullPath = path.join(getAssetsDir(), name);
    if (!fs.existsSync(fullPath)) return null;
    const ext = path.extname(name).toLowerCase();
    const mimeMap = { '.png': 'image/png', '.gif': 'image/gif', '.ico': 'image/x-icon', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };
    const mime = mimeMap[ext] || 'application/octet-stream';
    const data = fs.readFileSync(fullPath).toString('base64');
    return `data:${mime};base64,${data}`;
  } catch { return null; }
}

contextBridge.exposeInMainWorld('api', {
  // ── Window ──
  minimize: () => ipcRenderer.send('app:minimize'),
  maximize: () => ipcRenderer.send('app:maximize'),
  close: () => ipcRenderer.send('app:close'),

  // ── App ──
  getAppVersion: () => ipcRenderer.invoke('app:version'),
  getSettings: () => ipcRenderer.invoke('app:getSettings'),
  setSettings: (s) => ipcRenderer.invoke('app:setSettings', s),
  notify: (title, body) => ipcRenderer.invoke('app:notify', title, body),
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
  openFolder: (folderPath) => ipcRenderer.invoke('app:openFolder', folderPath),
  selectFolder: () => ipcRenderer.invoke('app:selectFolder'),

  // ── Assets (synchronous, returns data: URLs — works without any protocol) ──
  getAssetDataUrl: (name) => getAssetDataUrl(name),

  // ── Flowseal — Discovery & Strategy ──
  flowseal: {
    getStrategies: () => ipcRenderer.invoke('flowseal:getStrategies'),
    getConfig: () => ipcRenderer.invoke('flowseal:getConfig'),
    setConfig: (cfg) => ipcRenderer.invoke('flowseal:setConfig', cfg),
    getVersion: () => ipcRenderer.invoke('flowseal:getVersion'),

    // Start / Stop / Status
    start: () => ipcRenderer.invoke('flowseal:start'),
    stop: () => ipcRenderer.invoke('flowseal:stop'),
    getStatus: () => ipcRenderer.invoke('flowseal:status'),
    onStatusChange: (cb) => ipcRenderer.on('flowseal:status-changed', (_, v) => cb(v)),

    // Auto-start (Task Scheduler)
    getAutoStart: () => ipcRenderer.invoke('flowseal:getAutoStart'),
    setAutoStart: (enabled) => ipcRenderer.invoke('flowseal:setAutoStart', { enabled }),

    // Filters
    getGameFilter: () => ipcRenderer.invoke('flowseal:getGameFilter'),
    setGameFilter: (mode) => ipcRenderer.invoke('flowseal:setGameFilter', mode),
    getIpsetFilter: () => ipcRenderer.invoke('flowseal:getIpsetFilter'),
    setIpsetFilter: (mode) => ipcRenderer.invoke('flowseal:setIpsetFilter', mode),
    getAutoUpdate: () => ipcRenderer.invoke('flowseal:getAutoUpdate'),
    setAutoUpdate: (enabled) => ipcRenderer.invoke('flowseal:setAutoUpdate', enabled),

    // User lists
    getLists: () => ipcRenderer.invoke('flowseal:getLists'),
    writeList: (key, content) => ipcRenderer.invoke('flowseal:writeList', key, content),

    // Active fakes (bin payloads)
    getBins: () => ipcRenderer.invoke('flowseal:getBins'),
    setActiveFake: (type, fakeName) => ipcRenderer.invoke('flowseal:setActiveFake', type, fakeName),
  },

  // ── Diagnostics ──
  diag: {
    run: () => ipcRenderer.invoke('diag:run'),
    checkWinDivert: () => ipcRenderer.invoke('diag:checkWinDivert'),
    installWinDivert: () => ipcRenderer.invoke('diag:installWinDivert'),
  },

  // ── Home Page ──
  home: {
    getData: () => ipcRenderer.invoke('home:data'),
  },

  // ── Control Directory ──
  control: {
    getSetupStatus: () => ipcRenderer.invoke('control:getSetupStatus'),
    setDirectory: (dir) => ipcRenderer.invoke('control:setDirectory', dir),
    checkExistingZapret: () => ipcRenderer.invoke('control:checkExistingZapret'),
    selectVersion: (folder) => ipcRenderer.invoke('control:selectVersion', folder),
    deleteVersion: (folder) => ipcRenderer.invoke('control:deleteVersion', folder),
  },

  // ── Updater ──
  updater: {
    getCurrent: () => ipcRenderer.invoke('updater:current'),
    getVersions: () => ipcRenderer.invoke('updater:versions'),
    download: (v) => ipcRenderer.invoke('updater:download', v),
    install: (v, tempFile) => ipcRenderer.invoke('updater:install', v, tempFile),
    onProgress: (cb) => ipcRenderer.on('updater:progress', (_, v) => cb(v)),
    cancelDownload: () => ipcRenderer.invoke('updater:cancelDownload'),
  },
});
