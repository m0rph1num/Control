// ═══════════════════════════════════════════════════════════════════════════════
// Control — Main Process (Flowseal Zapret)
// ═══════════════════════════════════════════════════════════════════════════════

const { app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu, nativeImage, Notification, protocol } = require('electron');
const path = require('path');
const fs = require('fs');
const { execSync, execFileSync, spawn } = require('child_process');
const https = require('https');
const { URL } = require('url');
const crypto = require('crypto');

let mainWindow;
let tray = null;
let isQuitting = false;

// ── Single instance lock ────────────────────────────────────────────────────────
// Prevent multiple Control instances from fighting over winws.exe / settings.

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  // Another instance already holds the lock. The first instance receives
  // 'second-instance' and focuses its window. This instance must exit right
  // away — app.quit() alone isn't enough because the module keeps evaluating
  // and whenReady would still fire, briefly flashing a second window.
  process.exit(0);
}
app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

// ── Admin check helper ──────────────────────────────────────────────────────────

function isAdmin() {
  try {
    execSync('net session 2>nul', { timeout: 1000 });
    return true;
  } catch {
    return false;
  }
}

// ── App Icon (from assets) ──────────────────────────────────────────────────

const ASSETS_DIR = path.join(app.isPackaged ? process.resourcesPath : __dirname, 'assets');
const APP_ICON_PATH = path.join(ASSETS_DIR, 'app-icon.png');

// ── Custom protocol for renderer assets (dev & prod) ───────────────────────────

protocol.registerSchemesAsPrivileged([
  { scheme: 'app-asset', privileges: { standard: true, secure: true, bypassCSP: false, stream: true } },
]);

function getAppIcon() {
  try {
    if (fs.existsSync(APP_ICON_PATH)) {
      return nativeImage.createFromPath(APP_ICON_PATH);
    }
  } catch (_) { /* fallback */ }
  // Fallback: empty 1×1 image so Electron doesn't break
  return nativeImage.createEmpty();
}

// ── Tray Icon ──────────────────────────────────────────────────────────────────

function createTrayIcon() {
  try {
    if (fs.existsSync(APP_ICON_PATH)) {
      const img = nativeImage.createFromPath(APP_ICON_PATH);
      return img.resize({ width: 32, height: 32, quality: 'good' });
    }
  } catch (_) { /* fallback */ }
  return nativeImage.createEmpty();
}

function createTray() {
  if (tray) return;
  tray = new Tray(createTrayIcon());
  tray.setToolTip('Control — Zapret GUI');
  tray.on('click', () => {
    if (mainWindow?.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow?.show();
      mainWindow?.focus();
    }
  });
  updateTrayMenu();
}

function updateTrayMenu() {
  if (!tray) return;
  const s = loadAppSettings();
  const isRunning = checkWinwsRunning();
  const menu = Menu.buildFromTemplate([
    {
      label: mainWindow?.isVisible() ? 'Скрыть Control' : 'Показать Control',
      click: () => {
        if (mainWindow?.isVisible()) { mainWindow.hide(); }
        else { mainWindow?.show(); mainWindow?.focus(); }
      },
    },
    { type: 'separator' },
    {
      label: isRunning ? '⏹ Остановить Zapret' : '▶ Запустить Zapret',
      click: async () => {
        if (isRunning) {
          const st = computeFlowsealStatus();
          if (st.ours) {
            try { await stopZapret(); } catch {}
          } else {
            new Notification({ title: 'Control', body: 'Обнаружен внешний winws.exe. Остановите его вручную или через терминал.' }).show();
          }
        } else {
          const result = await startZapret();
          if (!result.ok) {
            new Notification({ title: 'Control', body: 'Ошибка запуска: ' + (result.error || 'неизвестная') }).show();
          }
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Выход',
      click: () => {
        tray?.destroy();
        tray = null;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
}

// Notify from renderer
ipcMain.handle('app:notify', (_, title, body) => {
  try {
    const n = new Notification({
      title,
      body,
      icon: getAppIcon(),
    });
    n.show();
  } catch {}
});

// Force-quit (from tray menu)
ipcMain.on('app:quit', () => {
  tray?.destroy();
  tray = null;
  app.quit();
});

// ── Paths ─────────────────────────────────────────────────────────────────────

function getAppDataPath() {
  const p = path.join(app.getPath('appData'), 'control');
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
  return p;
}

function ensureControlFolder(dir) {
  const baseName = path.basename(dir);
  const controlPath = baseName.toLowerCase() === 'control' ? dir : path.join(dir, 'Control');
  if (!fs.existsSync(controlPath)) {
    try { fs.mkdirSync(controlPath, { recursive: true }); } catch { /* ignore */ }
  }
  return fs.existsSync(controlPath) ? controlPath : '';
}

function getControlDir() {
  const s = loadAppSettings();
  if (s.controlDir) {
    const controlPath = ensureControlFolder(s.controlDir);
    if (controlPath && controlPath !== s.controlDir) {
      s.controlDir = controlPath;
      saveAppSettings(s);
    }
    if (controlPath) return controlPath;
  }
  // Fallback to appData path
  const fallback = path.join(getAppDataPath(), 'zapret-versions');
  if (!fs.existsSync(fallback)) fs.mkdirSync(fallback, { recursive: true });
  return fallback;
}

// ── Window ────────────────────────────────────────────────────────────────────

function createWindow(show = true) {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#0c0c0f',
    icon: getAppIcon(),
    show,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  if (process.argv.includes('--dev')) mainWindow.webContents.openDevTools();

  // Intercept close → minimize to tray instead when setting enabled.
  // Skip the interception during an intentional quit (tray "Выход" / OS shutdown),
  // otherwise app.quit() gets cancelled and the app stays alive without a window.
  mainWindow.on('close', (e) => {
    if (isQuitting) return;
    const s = loadAppSettings();
    if (s.minimizeToTray !== false) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });
}

// ── App Settings ──────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS = {
  minimizeToTray: true,
  notifications: true,
  flowsealPath: '',
  controlDir: '',
  selectedVersion: '',
  selectedStrategy: 'general',
  // ── Extended behaviour (TODO: process / state restore) ──
  restoreState: false,        // restart Zapret on Control launch if it was running before
  keepRunningOnExit: false,   // don't kill our winws.exe when Control exits
  watchdogEnabled: true,      // auto-restart winws.exe if it dies unexpectedly
  lastState: { running: false },
};

function settingsPath() {
  return path.join(getAppDataPath(), 'settings.json');
}

function loadAppSettings() {
  const p = settingsPath();
  if (!fs.existsSync(p)) return { ...DEFAULT_SETTINGS };
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    // Config corrupted — try the .bak snapshot before falling back to defaults
    const bak = p + '.bak';
    if (fs.existsSync(bak)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(bak, 'utf8'));
        return { ...DEFAULT_SETTINGS, ...parsed };
      } catch { /* bak also corrupted */ }
    }
    return { ...DEFAULT_SETTINGS };
  }
}

function saveAppSettings(s) {
  const p = settingsPath();
  try {
    // Keep a snapshot of the previous good config for recovery
    if (fs.existsSync(p)) fs.copyFileSync(p, p + '.bak');
    fs.writeFileSync(p, JSON.stringify(s, null, 2));
  } catch { /* ignore — next save will retry */ }
}

// Control has no "autostart with Windows" feature anymore. Remove any leftover
// HKCU\...\Run entry from older versions so the app can't keep launching at logon.
function removeControlAutoStart() {
  const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
  // execFileSync throws if the value doesn't exist — that's fine, ignore it
  try { execFileSync('reg', ['delete', key, '/v', 'Control', '/f'], { timeout: 3000 }); } catch {}
}

ipcMain.handle('app:getSettings', () => loadAppSettings());
ipcMain.handle('app:setSettings', (_, s) => {
  if (!s || typeof s !== 'object') return { ok: false, error: 'Неверный формат настроек' };
  try {
    // Only persist known keys — ignore anything the renderer shouldn't write
    const sanitized = { ...DEFAULT_SETTINGS };
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      if (key === 'lastState') continue; // lastState is written by the main process
      if (s[key] !== undefined) sanitized[key] = s[key];
    }
    // Merge preserved lastState
    const prev = loadAppSettings();
    sanitized.lastState = prev.lastState;
    saveAppSettings(sanitized);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ── Auto-start Zapret (Windows service) ────────────────────────────────────
// Replaces the old Task-Scheduler + VBS approach with a real Windows service,
// exactly like the original service.bat does:
//   sc create zapret binPath= "\"C:\...\bin\winws.exe\" <final args>" start= auto
// The strategy is read from Control's config (cfg.strategy) — no terminal menu.
// The service runs as LocalSystem, auto-starts at boot, hidden (no windows).

const ZAPRET_SERVICE_NAME = 'zapret'; // matches original service.bat

/** Parse the strategy .bat into full winws arguments (paths already resolved). */
function buildZapretServiceArgs() {
  const dir = findFlowsealDir();
  if (!dir) throw new Error('Версия Zapret не найдена. Установите или активируйте версию во вкладке Версии.');
  const cfg = loadFlowsealConfig();
  const strategies = getStrategies();
  const strategy = strategies.find(s => s.value === cfg.strategy) || strategies[0];
  if (!strategy) throw new Error('Не найдена стратегия для автозапуска.');
  return parseStrategyArgs(strategy, dir);
}

/** Run a .cmd via UAC elevation; resolves true when it exits with code 0. */
function runElevatedCmd(scriptPath) {
  return new Promise((resolve) => {
    try {
      execFileSync(
        'powershell',
        ['-NoProfile', '-Command', `Start-Process -FilePath '${scriptPath.replace(/'/g, "''")}' -Verb RunAs -Wait`],
        { timeout: 120000 }
      );
      resolve(true); // no throw → elevation accepted and script exited 0
    } catch {
      resolve(false);
    }
  });
}

/** Set Control's Zapret auto-start by creating the `zapret` service. */
async function createAutoStartZapretService() {
  const { args, binPath } = buildZapretServiceArgs();
  const dir = path.dirname(path.dirname(binPath)); // <dir>/bin/winws.exe → <dir>
  if (!fs.existsSync(binPath)) throw new Error('winws.exe не найден: ' + binPath);

  // Service ops (sc create/start/delete, net stop) plus the WinDivert kernel
  // driver install need administrator rights. Control is often launched without
  // elevation (e.g. at login without a UAC prompt), so running sc inline fails
  // with "Access denied" (SCM event 7000). Fix: bundle the whole setup into a
  // temp .cmd and launch it via `Start-Process -Verb RunAs -Wait` so it runs
  // elevated regardless of how the current Control instance was started.

  // ── WinDivert kernel driver (mirrors original service.bat) ───────────────
  const binDir = path.join(dir, 'bin');
  const sysFiles = fs.existsSync(binDir) ? fs.readdirSync(binDir).filter(f => /\.sys$/i.test(f)) : [];
  const is64 = process.arch === 'x64' || process.env.PROCESSOR_ARCHITECTURE === 'AMD64';
  const driverFile = sysFiles.find(f =>
    is64 ? /win64|windivert64/i.test(f) : /win32|windivert32/i.test(f)
  ) || sysFiles[0];
  const sysDir = path.join(process.env.SYSTEMROOT || 'C:\\Windows', 'System32', 'drivers');
  const targetSys = path.join(sysDir, 'WinDivert.sys');

  // sc.exe wants the binPath value to embed literal quotes around the exe:
  //   binPath= "\"C:\...\bin\winws.exe\" --wf-tcp ... "
  const binPathArg = '"\\"' + binPath + '\\" ' + args + '"';

  const regKey = 'HKLM\\System\\CurrentControlSet\\Services\\' + ZAPRET_SERVICE_NAME;
  const strategies = getStrategies();
  const cfg = loadFlowsealConfig();
  const strategy = strategies.find(s => s.value === cfg.strategy) || strategies[0];
  if (!strategy) throw new Error('Не найдена стратегия для автозапуска.');

  // Build the elevated script. `net session` guards: fail fast + exit 5 if we
  // are somehow not elevated, so the caller can show a clear message.
  const lines = [
    '@echo off',
    'setlocal',
    'net session >nul 2>&1',
    'if errorlevel 1 ( echo NOTADMIN & exit /b 5 )',
  ];
  if (driverFile) {
    const sourceDriver = path.join(binDir, driverFile);
    lines.push(
      `if not exist "${targetSys}" copy /y "${sourceDriver}" "${targetSys}" >nul`,
      'sc query WinDivert >nul 2>&1 || sc create WinDivert binPath= "' + targetSys + '" type= kernel start= demand',
      'sc start WinDivert >nul 2>&1',
    );
  }
  lines.push(
    'net stop zapret >nul 2>&1',
    'sc delete zapret >nul 2>&1',
    `sc create zapret binPath= ${binPathArg} DisplayName= "zapret" start= auto`,
    'sc description zapret "Zapret DPI bypass software" >nul 2>&1',
    `reg add "${regKey}" /v zapret-discord-youtube /t REG_SZ /d "${strategy.filename}" /f >nul`,
    'sc start zapret',
    'exit /b %errorlevel%',
  );
  const cmdText = lines.join('\r\n');

  const scriptPath = path.join(getAppDataPath(), 'autostart_zapret_service.cmd');
  fs.writeFileSync(scriptPath, cmdText, 'utf8');

  let ok = false;
  try {
    ok = await runElevatedCmd(scriptPath);
  } finally {
    try { fs.unlinkSync(scriptPath); } catch {}
  }
  if (!ok) {
    throw new Error('Не удалось создать службу zapret. Подтвердите запрос UAC или запустите Control от имени администратора.');
  }

  // Verify the service actually came up.
  const st = getZapretServiceStatus();
  if (!st.enabled) throw new Error('Служба zapret не создана.');
  if (!st.running) {
    throw new Error('Служба zapret создана, но не запустилась. Откройте вкладку Диагностика (WinDivert, конфликты).');
  }
  return { ok: true };
}

/** Remove the `zapret` service (uses elevation when needed). */
function removeAutoStartZapretService() {
  try {
    // If Control is elevated, sc delete works inline.
    execFileSync('net', ['stop', ZAPRET_SERVICE_NAME], { timeout: 3000 });
    execFileSync('sc', ['delete', ZAPRET_SERVICE_NAME], { timeout: 3000 });
  } catch {
    try {
      execFileSync(
        'powershell',
        ['-NoProfile', '-Command',
          `Start-Process sc -ArgumentList 'stop,zapret' -Verb RunAs -Wait; ` +
          `Start-Process sc -ArgumentList 'delete,zapret' -Verb RunAs -Wait`],
        { timeout: 20000 }
      );
    } catch { /* ignore */ }
  }
  // Also clean up the legacy route (old scheduler task + VBS/bat helpers).
  cleanLegacyAutostart();
}

function cleanLegacyAutostart() {
  try { execFileSync('schtasks', ['/Delete', '/TN', 'Control-Zapret', '/F'], { timeout: 3000 }); } catch {}
  const appData = getAppDataPath();
  try { fs.unlinkSync(path.join(appData, 'autostart_zapret.vbs')); } catch {}
  try { fs.unlinkSync(path.join(appData, 'autostart_zapret.bat')); } catch {}
}

/** Check whether the `zapret` service is installed and running. */
function getZapretServiceStatus() {
  try {
    const out = execFileSync('sc', ['query', ZAPRET_SERVICE_NAME], { timeout: 3000, encoding: 'utf8' });
    // `sc query` field names are localized (Ru: "Состояние", En: "STATE"), but the
    // status value "RUNNING" is always English whenever the service is running, so
    // match on that instead of the field label.
    const running = /RUNNING/i.test(out);
    return { enabled: true, running };
  } catch {
    return { enabled: false, running: false };
  }
}

// ── Existing Zapret Detection ──────────────────────────────────────────────

ipcMain.handle('control:getSetupStatus', () => {
  const s = loadAppSettings();
  return { done: !!s.controlDir, path: s.controlDir || '' };
});

// ── First-launch wizard: collect all environment checks in one call ─────────

ipcMain.handle('setup:runChecks', () => {
  const out = {
    admin: isAdmin(),
    winDivert: checkWinDivertInstalled(),
    internet: false,
    dns: false,
    existing: { running: false, installPath: null },
    defaultDir: null,
  };

  // Internet (fast HEAD to a reliable host; ping is unreliable on some networks)
  try {
    execSync('ping -n 1 8.8.8.8', { timeout: 2500 });
    out.internet = true;
  } catch { /* offline */ }

  // DNS resolution
  try {
    execSync('nslookup github.com 2>nul', { timeout: 2500 });
    out.dns = true;
  } catch { /* dns issue */ }

  // Existing zapret outside control dir + running processes
  try {
    const s = loadAppSettings();
    const controlDir = s.controlDir || '';
    const commonPaths = [
      'C:\\zapret',
      'C:\\zapret-discord-youtube',
      path.join(process.env.LOCALAPPDATA || '', 'zapret'),
      path.join(process.env.PROGRAMFILES || '', 'zapret'),
    ];
    const existingInstall = commonPaths.find(p =>
      fs.existsSync(p) && fs.existsSync(path.join(p, 'bin', 'winws.exe')) && p !== controlDir
    );
    out.existing = {
      running: checkWinwsRunning(),
      installPath: existingInstall || null,
    };
    // Suggest an existing install dir as default
    out.defaultDir = existingInstall || null;
  } catch { /* ignore */ }

  return out;
});

// Default folder suggestion when nothing is installed yet
ipcMain.handle('setup:defaultDir', () => {
  try {
    const s = loadAppSettings();
    if (s.controlDir) return s.controlDir;
    const docs = path.join(process.env.USERPROFILE || 'C:\\Users', 'Documents');
    const candidates = [
      path.join(docs, 'Control'),
      path.join(process.env.USERPROFILE || 'C:\\Users', 'Control'),
      'C:\\Control',
    ];
    for (const c of candidates) {
      try { fs.mkdirSync(c, { recursive: true }); return c; } catch { /* try next */ }
    }
    return candidates[0];
  } catch {
    return 'C:\\Control';
  }
});

// Apply all wizard choices at once (atomic-ish, best effort per key)
ipcMain.handle('setup:apply', (_, opts) => {
  try {
    const s = loadAppSettings();
    const o = (opts && typeof opts === 'object') ? opts : {};
    if (typeof o.controlDir === 'string' && o.controlDir) {
      const controlDir = ensureControlFolder(o.controlDir) || o.controlDir;
      if (!fs.existsSync(controlDir)) { try { fs.mkdirSync(controlDir, { recursive: true }); } catch {} }
      s.controlDir = controlDir;
    }
    if (typeof o.minimizeToTray === 'boolean') s.minimizeToTray = o.minimizeToTray;
    if (typeof o.notifications === 'boolean') s.notifications = o.notifications;
    if (typeof o.restoreState === 'boolean') s.restoreState = o.restoreState;
    saveAppSettings(s);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ── Ensure user list files exist (strategies reference them, winws crashes if absent) ──

function ensureUserListFiles(dir) {
  if (!dir) return;
  const listsDir = path.join(dir, 'lists');
  if (!fs.existsSync(listsDir)) return;
  LIST_FILES.forEach(lf => {
    const fullPath = path.join(listsDir, lf.file);
    if (!fs.existsSync(fullPath)) {
      try { fs.writeFileSync(fullPath, '', 'utf8'); } catch {}
    }
  });
}

ipcMain.handle('control:selectVersion', (_, versionFolder) => {
  try {
    const s = loadAppSettings();
    s.selectedVersion = versionFolder;
    saveAppSettings(s);
    // Ensure user list files exist so winws doesn't crash on missing --ipset-exclude files
    if (s.controlDir) {
      ensureUserListFiles(path.join(s.controlDir, versionFolder));
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('control:deleteVersion', (_, versionFolder) => {
  try {
    const dir = getControlDir();
    const verPath = path.join(dir, versionFolder);
    if (!fs.existsSync(verPath)) {
      return { ok: false, error: 'Папка версии не найдена' };
    }
    // Remove the folder
    fs.rmSync(verPath, { recursive: true, force: true });
    // If it was the active version, clear selection
    const s = loadAppSettings();
    if (s.selectedVersion === versionFolder) {
      s.selectedVersion = '';
      saveAppSettings(s);
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ── Window IPC ────────────────────────────────────────────────────────────────

ipcMain.on('app:minimize', () => mainWindow?.minimize());
ipcMain.on('app:maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize(); else mainWindow?.maximize();
});
ipcMain.on('app:close', () => mainWindow?.close());
ipcMain.handle('app:version', () => app.getVersion());
ipcMain.handle('app:openExternal', (_, url) => {
  // Security: only allow http(s) links — never execute local files/scripts
  try {
    const u = new URL(String(url || ''));
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    shell.openExternal(u.href);
    return true;
  } catch { return false; }
});
ipcMain.handle('app:openFolder', (_, folderPath) => {
  try {
    if (folderPath && fs.existsSync(folderPath)) {
      shell.openPath(String(folderPath));
      return true;
    }
  } catch { /* ignore */ }
  return false;
});

ipcMain.handle('app:selectFolder', async () => {
  const r = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});

// ═══════════════════════════════════════════════════════════════════════════════
// Flowseal — Discovery & Strategy Management
// ═══════════════════════════════════════════════════════════════════════════════

function findFlowsealDir() {
  const s = loadAppSettings();
  // First check: selected version from Control directory
  if (s.controlDir && s.selectedVersion) {
    const vPath = path.join(s.controlDir, s.selectedVersion);
    if (fs.existsSync(path.join(vPath, 'bin', 'winws.exe'))) return vPath;
  }
  // Second: explicit flowsealPath (manual override)
  if (s.flowsealPath && fs.existsSync(s.flowsealPath)) return s.flowsealPath;
  // Third: scan all version folders in control dir for one with winws.exe
  if (s.controlDir) {
    try {
      const entries = fs.readdirSync(s.controlDir)
        .filter(f => fs.statSync(path.join(s.controlDir, f)).isDirectory())
        .sort().reverse();
      for (const entry of entries) {
        const candidate = path.join(s.controlDir, entry);
        if (fs.existsSync(path.join(candidate, 'bin', 'winws.exe'))) {
          return candidate;
        }
      }
    } catch { /* ignore */ }
  }
  return '';
}

function getStrategies() {
  const dir = findFlowsealDir();
  if (!dir) return [];
  try {
    return fs.readdirSync(dir)
      .filter(f => f.endsWith('.bat') && !f.toLowerCase().startsWith('service'))
      .map(f => {
        const base = f.replace(/\.bat$/i, '');
        // Build a human-readable label
        let label = base.replace(/^general\s*/i, '').replace(/[()]/g, '').trim() || 'Default';
        return { value: base, filename: f, label, path: path.join(dir, f) };
      });
  } catch {
    return [];
  }
}

/** Describe what each strategy does based on its name */
function getStrategyDescription(value) {
  const v = value.toLowerCase();
  if (v.includes('fake') && v.includes('tls') && v.includes('auto')) {
    return 'multidisorder + badseq fooling, автоматическая подмена TLS. Помогает при блокировках по SNI.';
  }
  if (v.includes('simple') && v.includes('fake') && v.includes('alt')) {
    return 'Упрощённая стратегия fake (с badseq fooling). Меньше нагрузки, но может быть менее эффективна.';
  }
  if (v.includes('simple') && v.includes('fake') && v.includes('alt2')) {
    return 'Упрощённая стратегия fake (с ts fooling). Меньше нагрузки, но может быть менее эффективна.';
  }
  if (v.includes('simple') && v.includes('fake')) {
    return 'Упрощённая стратегия fake для всех протоколов. Минимальная нагрузка.';
  }
  if (v.includes('exp')) {
    return 'Экспериментальная стратегия. Может работать там, где остальные не помогают.';
  }
  if (v.includes('fake') && v.includes('tls')) {
    return 'fake + fakedsplit для TCP, подмена TLS. Хороша для обхода DPI на YouTube/Google.';
  }
  if (v.includes('alt')) {
    const num = parseInt(v.replace('alt', '')) || 0;
    if (num <= 3) return 'Вариант multisplit с другими параметрами. Помогает если Default нестабилен.';
    if (num <= 6) return 'Вариант с изменёнными seqovl/split-pos. Альтернатива при проблемах с Default.';
    if (num <= 9) return 'Вариант с другим набором параметров фрагментации.';
    return 'Дополнительный вариант стратегии. Пробуйте если другие не подходят.';
  }
  if (v === 'general' || v === 'default') {
    return 'Основная стратегия: multisplit для TCP + fake для UDP. Рекомендуется для большинства пользователей.';
  }
  return `Стратегия ${value}. Пробуйте если стандартные варианты не работают.`;
}

// ── Flowseal Config ───────────────────────────────────────────────────────────

function getFlowsealConfigPath() {
  return path.join(getAppDataPath(), 'flowseal-config.json');
}

function loadFlowsealConfig() {
  const p = getFlowsealConfigPath();
  if (!fs.existsSync(p)) return getDefaultFlowsealConfig();
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return getDefaultFlowsealConfig(); }
}

function getDefaultFlowsealConfig() {
  return {
    strategy: loadAppSettings().selectedStrategy || 'general',
    gameFilter: 'disabled',  // disabled, all, tcp, udp
    ipsetFilter: 'loaded',   // loaded, none, any
    autoUpdate: false,
  };
}

function saveFlowsealConfig(cfg) {
  fs.writeFileSync(getFlowsealConfigPath(), JSON.stringify(cfg, null, 2));
}

ipcMain.handle('flowseal:getConfig', () => loadFlowsealConfig());
ipcMain.handle('flowseal:setConfig', (_, cfg) => {
  // Validate: only accept known keys from default config
  if (!cfg || typeof cfg !== 'object') return { ok: false, error: 'Неверный формат конфига' };
  const valid = getDefaultFlowsealConfig();
  const sanitized = {};
  for (const key of Object.keys(valid)) {
    sanitized[key] = cfg[key] !== undefined ? cfg[key] : valid[key];
  }
  saveFlowsealConfig(sanitized);
  return { ok: true };
});

// ── Strategy listing ──────────────────────────────────────────────────────────

ipcMain.handle('flowseal:getStrategies', () => {
  return getStrategies().map(s => ({
    ...s,
    desc: getStrategyDescription(s.value),
  }));
});

// ═══════════════════════════════════════════════════════════════════════════════
// Flowseal — Start / Stop (standalone mode)
// ═══════════════════════════════════════════════════════════════════════════════

let currentWinwsProcess = null;
let flowsealRunning = false;
let stoppingManually = false;
let watchdogTimer = null;
let watchdogAttempts = 0;
const WATCHDOG_MAX_ATTEMPTS = 3;

function scheduleWatchdogRestart() {
  const s = loadAppSettings();
  if (s.watchdogEnabled === false) return;
  if (watchdogAttempts >= WATCHDOG_MAX_ATTEMPTS) return;
  watchdogAttempts++;
  if (watchdogTimer) clearTimeout(watchdogTimer);
  watchdogTimer = setTimeout(() => {
    watchdogTimer = null;
    console.log(`[watchdog] Restarting winws.exe (attempt ${watchdogAttempts}/${WATCHDOG_MAX_ATTEMPTS})`);
    startZapret().catch(() => {});
  }, 2000);
}

// ── Split a command-line string into argv array (handles quoted paths) ────────

function parseArgs(str) {
  const args = [];
  let current = '';
  let inQuote = false;
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (c === '"') { inQuote = !inQuote; continue; }
    if (c === ' ' && !inQuote) { if (current) { args.push(current); current = ''; } continue; }
    current += c;
  }
  if (current) args.push(current);
  return args;
}

// ── Shared: extract winws.exe args from a strategy .bat ─────────────────────

function parseStrategyArgs(strategy, dir) {
  const content = fs.readFileSync(strategy.path, 'utf8');
  const argsLines = [];
  let capture = false;

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim().replace(/\r$/, '');
    if (line.includes('winws.exe')) {
      capture = true;
      const idx = line.indexOf('winws.exe') + 10;
      const part = line.substring(idx).trim();
      if (part) argsLines.push(part);
      continue;
    }
    if (capture && line) {
      const clean = line.replace(/[\^]/g, '').trim();
      if (clean) argsLines.push(clean);
    }
  }

  let fullArgs = argsLines.join(' ').replace(/\s+/g, ' ').trim();

  // Resolve %BIN% and %LISTS% paths — handle both quoted and unquoted patterns
  fullArgs = fullArgs
    .replace(/"%BIN%([^"]+)"/g, (_, p) => `"${path.join(dir, 'bin', p)}"`)
    .replace(/"%LISTS%([^"]+)"/g, (_, p) => `"${path.join(dir, 'lists', p)}"`)
    .replace(/%BIN%([^\s&|]+)/g, (_, p) => path.join(dir, 'bin', p))
    .replace(/%LISTS%([^\s&|]+)/g, (_, p) => path.join(dir, 'lists', p))
    // Resolve %GameFilter%/TCP/UDP from the utils/game_filter.enabled flag file
    // (service.bat sets these vars the same way):
    //   disabled → TCP/UDP = 12 (placeholder, no game filtering)
    //   all      → TCP/UDP = 1024-65535
    //   tcp      → TCP = 1024-65535, UDP = 12
    //   udp      → TCP = 12, UDP = 1024-65535
    ;
  const gameMode = getGameFilterFromDir(dir);
  const gfTCP = gameMode === 'all' || gameMode === 'tcp' ? '1024-65535' : '12';
  const gfUDP = gameMode === 'all' || gameMode === 'udp' ? '1024-65535' : '12';
  fullArgs = fullArgs
    .replace(/%GameFilter%/g, gfTCP)
    .replace(/%GameFilterTCP%/g, gfTCP)
    .replace(/%GameFilterUDP%/g, gfUDP);
  // Strip any remaining stray % and ^ from cmd.exe / bat artifacts
  fullArgs = fullArgs.replace(/[\^%]/g, '');

  return { args: fullArgs, binPath: path.join(dir, 'bin', 'winws.exe') };
}

/** Full paths of every running winws.exe process ([] if none or inaccessible). */
function getRunningWinwsPaths() {
  try {
    const out = execFileSync('powershell', [
      '-NoProfile', '-NonInteractive', '-Command',
      '(Get-Process -Name winws -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Path) -join [Environment]::NewLine',
    ], { timeout: 4000, encoding: 'utf8' });
    return out.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Is the running winws.exe "ours"? True when Control spawned it, when the zapret
 * Windows service (Control's own autostart) is up, or when the executable lives
 * in a folder Control manages (the versions folder or a manual flowsealPath).
 *
 * The service check comes first: a service-started winws runs as LocalSystem, so
 * its Path is often unreadable from a non-elevated context — but the running
 * `zapret` service proves it's the autostart instance, not a third-party zapret.
 */
function isOurWinwsRunning() {
  if (currentWinwsProcess && currentWinwsProcess.exitCode === null) return true;
  try {
    const svc = getZapretServiceStatus();
    if (svc.enabled && svc.running) return true;
  } catch { /* fall through to path check */ }
  const s = loadAppSettings();
  const roots = [];
  if (s.controlDir) roots.push(path.resolve(s.controlDir).toLowerCase());
  if (s.flowsealPath) roots.push(path.resolve(s.flowsealPath).toLowerCase());
  if (!roots.length) return false;
  const paths = getRunningWinwsPaths();
  return paths.some(p => {
    const lp = p.toLowerCase();
    return roots.some(r => lp === r || lp.startsWith(r + '\\'));
  });
}

/** Combined status: running + whether an *external* (third-party) winws is up. */
function computeFlowsealStatus() {
  const winwsRunning = checkWinwsRunning();
  const ours = isOurWinwsRunning();
  return {
    running: winwsRunning,
    external: winwsRunning && !ours,
    ours,
    pid: currentWinwsProcess?.pid || null,
  };
}

ipcMain.handle('flowseal:status', () => {
  return computeFlowsealStatus();
});

// ── Status cache: avoid hammering tasklist/SC every few ms ─────────────────────
let _statusCache = { running: null, ts: 0 };
const STATUS_CACHE_TTL = 2000;

function bustStatusCache() { _statusCache = { running: null, ts: 0 }; }

function checkWinwsRunning() {
  const now = Date.now();
  if (_statusCache.running !== null && (now - _statusCache.ts) < STATUS_CACHE_TTL) {
    return _statusCache.running;
  }
  // Use PowerShell instead of tasklist /FI: the /FI filter is mangled by the
  // MSYS/bash layer (becomes "C:/Programs/Git/FI"), which made this always
  // return false on this machine. PowerShell's Get-Process is locale-agnostic
  // and returns a clean exit code.
  let running = false;
  try {
    const out = execFileSync('powershell', [
      '-NoProfile', '-NonInteractive', '-Command',
      `if (Get-Process -Name winws -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }`,
    ], { timeout: 4000, encoding: 'utf8' });
    running = true; // exit 0 = at least one winws process alive
  } catch {
    running = false; // exit 1 = none
  }
  _statusCache = { running, ts: Date.now() };
  return running;
}

function checkWinDivertInstalled() {
  try {
    const out = execSync('sc query WinDivert 2>nul', { timeout: 3000, encoding: 'utf8' });
    return out.includes('RUNNING') || out.includes('STOPPED');
  } catch {
    return false;
  }
}

function getWinDivertPath() {
  return path.join(process.env.SYSTEMROOT || 'C:\\Windows', 'System32', 'drivers', 'WinDivert.sys');
}

// ── WinDivert Install ──────────────────────────────────────────────

function checkWinDivertFiles(dir) {
  const binDir = path.join(dir, 'bin');
  if (!fs.existsSync(binDir)) return { found: false };
  const files = fs.readdirSync(binDir);
  const has64 = files.some(f => f.toLowerCase().includes('windivert') && f.toLowerCase().includes('64'));
  const has32 = files.some(f => f.toLowerCase().includes('windivert') && f.toLowerCase().includes('32'));
  const hasDll = files.some(f => f.toLowerCase() === 'windivert.dll');
  return { found: has64 || has32 || hasDll, has64, has32, hasDll };
}

async function installWinDivert(dir) {
  const binDir = path.join(dir, 'bin');
  if (!fs.existsSync(binDir)) return { ok: false, error: 'Папка bin/ не найдена' };

  // Check if WinDivert is already installed
  if (checkWinDivertInstalled()) {
    return { ok: true, message: 'WinDivert уже установлен' };
  }

  // Method 1: Use sc create to install the driver
  const sysFiles = fs.readdirSync(binDir).filter(f => f.toLowerCase().endsWith('.sys'));
  const is64 = process.arch === 'x64' || process.env.PROCESSOR_ARCHITECTURE === 'AMD64';
  const driverFile = sysFiles.find(f =>
    is64 ? f.toLowerCase().includes('win64') || f.toLowerCase().includes('windivert64') : f.toLowerCase().includes('win32') || f.toLowerCase().includes('windivert32')
  ) || sysFiles[0];

  if (driverFile) {
    try {
      const driverPath = path.join(binDir, driverFile);
      const sysDir = path.join(process.env.SYSTEMROOT || 'C:\\Windows', 'System32', 'drivers');
      const targetPath = path.join(sysDir, 'WinDivert.sys');
      if (!fs.existsSync(sysDir)) fs.mkdirSync(sysDir, { recursive: true });
      fs.copyFileSync(driverPath, targetPath);

      execSync(`sc create WinDivert binPath= "${targetPath}" type= kernel start= demand 2>nul`, { timeout: 3000 });
      execSync(`sc start WinDivert 2>nul`, { timeout: 3000 });

      await sleep(500);
      if (checkWinDivertInstalled()) {
        return { ok: true, message: 'Драйвер WinDivert установлен и запущен' };
      }
    } catch (e) {
      return { ok: false, error: 'Ошибка установки WinDivert: ' + (e.stderr?.toString().trim() || e.message) };
    }
  }

  // Method 2: try winws.exe --install-driver if supported
  try {
    const winwsPath = path.join(binDir, 'winws.exe');
    if (fs.existsSync(winwsPath)) {
      execSync(`"${winwsPath}" --install-driver 2>nul`, { timeout: 10000 });
      await sleep(500);
      if (checkWinDivertInstalled()) {
        return { ok: true, message: 'WinDivert установлен через winws.exe' };
      }
    }
  } catch { /* ignore */ }

  return { ok: false, error: 'Не удалось установить WinDivert автоматически. Скачайте WinDivert вручную: https://reqrypt.org/windivert.html' };
}

ipcMain.handle('diag:checkWinDivert', () => {
  const installed = checkWinDivertInstalled();
  const driverPath = getWinDivertPath();
  const fileExists = fs.existsSync(driverPath);
  const dir = findFlowsealDir();
  const files = dir ? checkWinDivertFiles(dir) : { found: false };
  return { installed, driverExists: fileExists, driverPath, ...files };
});

ipcMain.handle('diag:installWinDivert', async () => {
  const dir = findFlowsealDir();
  if (!dir) return { ok: false, error: 'Версия Flowseal не найдена' };
  return await installWinDivert(dir);
});

async function startZapret() {
  const cfg = loadFlowsealConfig();
  console.log('[startZapret] Starting...');
  const dir = findFlowsealDir();
  if (!dir) { console.log('[startZapret] No flowseal dir found'); return { ok: false, error: 'Версия Zapret не выбрана. Установите или активируйте версию во вкладке Версии.' }; }
  console.log('[startZapret] Dir:', dir);

  // Ensure user list files exist — winws crashes if --ipset-exclude references a missing file
  ensureUserListFiles(dir);

  const strategies = getStrategies();
  const strategy = strategies.find(s => s.value === cfg.strategy) || strategies[0];
  if (!strategy) { console.log('[startZapret] No strategy found'); return { ok: false, error: 'Не найдена стратегия для запуска.' }; }
  console.log('[startZapret] Strategy:', strategy.value);

  // Check for externally running winws.exe (started outside Control / our folders)
  if (computeFlowsealStatus().external) {
    console.log('[startZapret] External winws.exe detected, will replace it');
  }

  console.log('[startZapret] Killing existing winws.exe...');
  stoppingManually = false;
  watchdogAttempts = 0;
  try { execSync('taskkill /IM winws.exe /F /T 2>nul', { timeout: 3000 }); } catch {}
  await sleep(500);

  try {
    applyGameFilterConfig(cfg.gameFilter, dir);
    applyIpsetFilterConfig(cfg.ipsetFilter, dir);

    // Parse strategy args and spawn winws.exe directly (no cmd window)
    const { args, binPath } = parseStrategyArgs(strategy, dir);
    const fullArgsList = parseArgs(args);
    console.log('[startZapret] binPath:', binPath);
    console.log('[startZapret] args:', fullArgsList);

    currentWinwsProcess = spawn(binPath, fullArgsList, {
      cwd: dir, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });

    let startFailed = null;
    let stderrBuf = '';
    currentWinwsProcess.stderr?.on('data', (d) => {
      stderrBuf += d.toString();
    });

    currentWinwsProcess.on('error', (err) => {
      console.log('[startZapret] spawn error:', err.message);
      startFailed = err.message;
      flowsealRunning = false;
      mainWindow?.webContents.send('flowseal:status-changed', { running: false, external: false });
      bustStatusCache(); updateTrayMenu();
    });
    currentWinwsProcess.on('exit', (code) => {
      console.log('[startZapret] winws exited, code:', code);
      const stderr = stderrBuf.trim();
      if (stderr) console.log('[startZapret] winws stderr:', stderr);
      if (code !== null) {
        startFailed = code === 0
          ? 'winws завершился с кодом 0 (успех) — возможно, он требует интерактивного терминала'
          : 'winws завершился с кодом ' + code + (stderr ? '. stderr: ' + stderr : '');
      }
      const wasRunning = flowsealRunning;
      flowsealRunning = false; currentWinwsProcess = null;
      bustStatusCache();
      const st = computeFlowsealStatus();
      mainWindow?.webContents.send('flowseal:status-changed', { running: st.running, external: st.external });
      bustStatusCache(); updateTrayMenu();

      // Watchdog: if the process died unexpectedly (not via stop/restart) and
      // it was supposed to be running, bring it back automatically.
      if (wasRunning && !stoppingManually && code !== 0) {
        scheduleWatchdogRestart();
      } else {
        watchdogAttempts = 0;
      }
    });

    await sleep(1500);

    if (startFailed) {
      console.log('[startZapret] Start failed:', startFailed);
      if (startFailed.includes('ENOENT')) {
        return { ok: false, error: 'winws.exe не найден по указанному пути.' };
      }
      if (startFailed.includes('winws завершился')) {
        const hasWDDll = fs.existsSync(path.join(dir, 'bin', 'WinDivert.dll'));
        const hasWDSys = fs.existsSync(path.join(dir, 'bin', 'WinDivert64.sys'));
        const wdOk = checkWinDivertInstalled();
        let hint = '';
        if (!hasWDDll) hint = 'Отсутствует WinDivert.dll в bin/. ';
        if (!hasWDSys) hint += 'Отсутствует WinDivert64.sys в bin/. ';
        if (!wdOk) hint += 'WinDivert драйвер не установлен. ';
        if (!hint) hint = 'Проверьте совместимость версий WinDivert и winws.exe. ';
        // Truncate stderr noise — just show the key part
        const shortFail = startFailed.length > 120 ? startFailed.substring(0, 120) + '…' : startFailed;
        return { ok: false, error: shortFail + '. ' + hint + 'Откройте Диагностику.' };
      }
      return { ok: false, error: 'Ошибка запуска: ' + startFailed };
    }

    // Double-check process is still alive after sleep
    if (currentWinwsProcess && !currentWinwsProcess.killed && currentWinwsProcess.exitCode === null) {
      flowsealRunning = true;
      stoppingManually = false;
      bustStatusCache(); updateTrayMenu();
      mainWindow?.webContents.send('flowseal:status-changed', { running: true, external: false });
      // Remember state for restore-after-reboot
      try {
        const s = loadAppSettings();
        s.lastState = { running: true };
        saveAppSettings(s);
      } catch { /* ignore */ }
      return { ok: true };
    } else {
      flowsealRunning = false;
      currentWinwsProcess = null;
      // Check if WinDivert driver is the issue
      const hasWinDivert = checkWinDivertInstalled();
      if (!hasWinDivert) {
        return { ok: false, error: 'Драйвер WinDivert не обнаружен. Откройте Диагностику для установки.' };
      }
      return { ok: false, error: 'winws.exe завершился сразу после запуска. Проверьте стратегию и WinDivert в Диагностике.' };
    }
  } catch (e) { console.log('[startZapret] Error:', e.message); return { ok: false, error: e.message }; }
}

async function stopZapret() {
  stoppingManually = true;
  if (watchdogTimer) { clearTimeout(watchdogTimer); watchdogTimer = null; }
  watchdogAttempts = 0;
  if (currentWinwsProcess) {
    try { currentWinwsProcess.kill(); } catch {}
    currentWinwsProcess = null;
  }
  flowsealRunning = false;
  await sleep(300);
  // If winws was started by the zapret service (Control's own autostart) there
  // is no spawned-process handle to kill — stop the service instead. The service
  // stays installed, so autostart at next boot is untouched.
  try {
    const svc = getZapretServiceStatus();
    if (svc.enabled && svc.running) execFileSync('net', ['stop', ZAPRET_SERVICE_NAME], { timeout: 5000 });
  } catch { /* ignore */ }
  bustStatusCache(); updateTrayMenu();
  const st = computeFlowsealStatus();
  mainWindow?.webContents.send('flowseal:status-changed', { running: st.running, external: st.external });
  // Remember state for restore-after-reboot
  try {
    const s = loadAppSettings();
    s.lastState = { running: false };
    saveAppSettings(s);
  } catch { /* ignore */ }
  return { ok: true };
}

ipcMain.handle('flowseal:start', startZapret);
ipcMain.handle('flowseal:stop', stopZapret);

// ── Auto-start Zapret via Task Scheduler ──────────────────────────────────

ipcMain.handle('flowseal:getAutoStart', () => {
  return getZapretServiceStatus();
});

ipcMain.handle('flowseal:setAutoStart', async (_, { enabled }) => {
  if (enabled) {
    try {
      const r = await createAutoStartZapretService();
      return r || { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  } else {
    removeAutoStartZapretService();
    return { ok: true };
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Flowseal — Game Filter
// ═══════════════════════════════════════════════════════════════════════════════

function applyGameFilterConfig(mode, dir) {
  const utilsDir = path.join(dir, 'utils');
  const flagFile = path.join(utilsDir, 'game_filter.enabled');
  if (!fs.existsSync(utilsDir)) return;

  if (mode === 'disabled') {
    if (fs.existsSync(flagFile)) fs.unlinkSync(flagFile);
  } else {
    fs.writeFileSync(flagFile, mode === 'all' ? 'all' : mode === 'tcp' ? 'tcp' : 'udp', 'utf8');
  }
}

/** Read the current game-filter mode straight from the version folder */
function getGameFilterFromDir(dir) {
  try {
    const flagFile = path.join(dir, 'utils', 'game_filter.enabled');
    if (!fs.existsSync(flagFile)) return 'disabled';
    const val = fs.readFileSync(flagFile, 'utf8').trim().toLowerCase();
    return val === 'all' || val === 'tcp' || val === 'udp' ? val : 'disabled';
  } catch { return 'disabled'; }
}

ipcMain.handle('flowseal:getGameFilter', () => {
  const dir = findFlowsealDir();
  if (!dir) return 'disabled';
  const flagFile = path.join(dir, 'utils', 'game_filter.enabled');
  if (!fs.existsSync(flagFile)) return 'disabled';
  try {
    const val = fs.readFileSync(flagFile, 'utf8').trim().toLowerCase();
    if (val === 'all') return 'all';
    if (val === 'tcp') return 'tcp';
    if (val === 'udp') return 'udp';
    return 'disabled';
  } catch { return 'disabled'; }
});

ipcMain.handle('flowseal:setGameFilter', (_, mode) => {
  const dir = findFlowsealDir();
  if (!dir) return { ok: false, error: 'Директория не найдена' };
  applyGameFilterConfig(mode, dir);
  return { ok: true };
});

// ═══════════════════════════════════════════════════════════════════════════════
// Flowseal — IPSet Filter
// ═══════════════════════════════════════════════════════════════════════════════

function applyIpsetFilterConfig(mode, dir) {
  const listFile = path.join(dir, 'lists', 'ipset-all.txt');
  const backupFile = path.join(dir, 'lists', 'ipset-all.txt.backup');
  const listsDir = path.join(dir, 'lists');
  if (!fs.existsSync(listsDir)) return;

  if (mode === 'none') {
    // Create backup only ONCE — never overwrite it
    if (fs.existsSync(listFile) && !fs.existsSync(backupFile)) {
      fs.copyFileSync(listFile, backupFile);
    }
    fs.writeFileSync(listFile, '203.0.113.113/32\n', 'utf8');
  } else if (mode === 'any') {
    // Create backup only ONCE
    if (fs.existsSync(listFile) && !fs.existsSync(backupFile)) {
      fs.copyFileSync(listFile, backupFile);
    }
    fs.writeFileSync(listFile, '', 'utf8');
  } else if (mode === 'loaded') {
    if (fs.existsSync(backupFile)) {
      fs.copyFileSync(backupFile, listFile);
    }
  }
}

ipcMain.handle('flowseal:getIpsetFilter', () => {
  const dir = findFlowsealDir();
  if (!dir) return 'loaded';
  const listFile = path.join(dir, 'lists', 'ipset-all.txt');
  if (!fs.existsSync(listFile)) return 'loaded';
  try {
    const content = fs.readFileSync(listFile, 'utf8').trim();
    if (!content) return 'any';
    if (content.includes('203.0.113.113')) return 'none';
    return 'loaded';
  } catch { return 'loaded'; }
});

ipcMain.handle('flowseal:setIpsetFilter', (_, mode) => {
  const dir = findFlowsealDir();
  if (!dir) return { ok: false, error: 'Директория не найдена' };
  applyIpsetFilterConfig(mode, dir);
  return { ok: true };
});

// ═══════════════════════════════════════════════════════════════════════════════
// Flowseal — Auto-Update Toggle
// ═══════════════════════════════════════════════════════════════════════════════

ipcMain.handle('flowseal:getAutoUpdate', () => {
  const dir = findFlowsealDir();
  if (!dir) return false;
  const flag = path.join(dir, 'utils', 'check_updates.enabled');
  return fs.existsSync(flag);
});

ipcMain.handle('flowseal:setAutoUpdate', (_, enabled) => {
  const dir = findFlowsealDir();
  if (!dir) return { ok: false };
  const flag = path.join(dir, 'utils', 'check_updates.enabled');
  const utilsDir = path.join(dir, 'utils');
  if (!fs.existsSync(utilsDir)) fs.mkdirSync(utilsDir, { recursive: true });
  if (enabled) {
    fs.writeFileSync(flag, 'ENABLED\n', 'utf8');
  } else if (fs.existsSync(flag)) {
    fs.unlinkSync(flag);
  }
  return { ok: true };
});

// ═══════════════════════════════════════════════════════════════════════════════
// Flowseal — User Lists
// ═══════════════════════════════════════════════════════════════════════════════

const LIST_FILES = [
  { key: 'generalUser', file: 'list-general-user.txt', label: 'Пользовательский список хостов' },
  { key: 'excludeUser', file: 'list-exclude-user.txt', label: 'Пользовательский список исключений' },
  { key: 'ipsetExcludeUser', file: 'ipset-exclude-user.txt', label: 'Пользовательский IPSet исключений' },
];

ipcMain.handle('flowseal:getLists', () => {
  const dir = findFlowsealDir();
  if (!dir) return [];
  const listsDir = path.join(dir, 'lists');
  if (!fs.existsSync(listsDir)) return [];
  return LIST_FILES.map(lf => {
    const fullPath = path.join(listsDir, lf.file);
    return {
      key: lf.key,
      file: lf.file,
      label: lf.label,
      content: fs.existsSync(fullPath) ? fs.readFileSync(fullPath, 'utf8') : '',
    };
  });
});

ipcMain.handle('flowseal:writeList', (_, key, content) => {
  const dir = findFlowsealDir();
  if (!dir) return { ok: false, error: 'Директория не найдена' };
  const lf = LIST_FILES.find(x => x.key === key);
  if (!lf) return { ok: false, error: 'Неизвестный файл' };
  const fullPath = path.join(dir, 'lists', lf.file);
  try {
    fs.writeFileSync(fullPath, content || '', 'utf8');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Flowseal — Active Fakes (replace bin payloads)
// ═══════════════════════════════════════════════════════════════════════════════

ipcMain.handle('flowseal:getBins', () => {
  const dir = findFlowsealDir();
  if (!dir) return { fakes: [], currentDiscord: null, currentGame: null };
  const binDir = path.join(dir, 'bin');
  if (!fs.existsSync(binDir)) return { fakes: [], currentDiscord: null, currentGame: null };
  try {
    const files = fs.readdirSync(binDir).filter(f => f.endsWith('.bin') && !f.startsWith('ACTIVE_'));
    const activeDiscord = fs.existsSync(path.join(binDir, 'ACTIVE_DISCORD_UDP.bin'));
    const activeGame = fs.existsSync(path.join(binDir, 'ACTIVE_GAME_UDP.bin'));

    let currentDiscord = null, currentGame = null;
    if (activeDiscord) {
      currentDiscord = resolveActiveFake(binDir, 'ACTIVE_DISCORD_UDP.bin', files);
    }
    if (activeGame) {
      currentGame = resolveActiveFake(binDir, 'ACTIVE_GAME_UDP.bin', files);
    }

    return {
      fakes: files.map(f => ({ name: f.replace(/\.bin$/i, ''), filename: f })),
      currentDiscord,
      currentGame,
    };
  } catch {
    return { fakes: [], currentDiscord: null, currentGame: null };
  }
});

function resolveActiveFake(binDir, activeName, files) {
  try {
    const activePath = path.join(binDir, activeName);
    if (!fs.existsSync(activePath)) return null;
    const activeHash = crypto.createHash('sha256').update(fs.readFileSync(activePath)).digest('hex');
    for (const f of files) {
      const fp = path.join(binDir, f);
      if (!fs.existsSync(fp)) continue;
      const hash = crypto.createHash('sha256').update(fs.readFileSync(fp)).digest('hex');
      if (hash === activeHash) return f.replace(/\.bin$/i, '');
    }
  } catch { /* ignore */ }
  return null;
}

ipcMain.handle('flowseal:setActiveFake', (_, type, fakeName) => {
  const dir = findFlowsealDir();
  if (!dir) return { ok: false, error: 'Директория не найдена' };
  const binDir = path.join(dir, 'bin');
  if (!fs.existsSync(binDir)) return { ok: false, error: 'bin/ не найдена' };

  const target = type === 'discord' ? 'ACTIVE_DISCORD_UDP.bin' : 'ACTIVE_GAME_UDP.bin';
  const source = path.join(binDir, `${fakeName}.bin`);
  if (!fs.existsSync(source)) return { ok: false, error: 'Файл не найден' };

  try {
    fs.copyFileSync(source, path.join(binDir, target));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Flowseal — WinDivert version check
// ═══════════════════════════════════════════════════════════════════════════════

ipcMain.handle('flowseal:getVersion', () => {
  const dir = findFlowsealDir();
  if (!dir) return { installed: false, version: '0.0.0' };
  const winwsPath = path.join(dir, 'bin', 'winws.exe');
  if (!fs.existsSync(winwsPath)) return { installed: false, version: '0.0.0' };

  // Extract version from folder name (e.g. "v1.10.0" → "1.10.0") — fast, no process spawn
  const folderName = path.basename(dir);
  const folderVer = folderName.match(/v?(\d+\.\d+\.\d+)/)?.[1] || null;

  // If folder has version, return immediately — avoids spawning a subprocess
  if (folderVer) return { installed: true, version: folderVer };

  // Fallback only if folder name doesn't contain version info
  try {
    const out = execFileSync(winwsPath, ['--version'], { timeout: 5000, encoding: 'utf8' });
    const m = out.match(/\d+\.\d+\.\d+/);
    if (m) return { installed: true, version: m[0], full: out.trim() };
    return { installed: true, version: '1.0.0', full: out.trim() };
  } catch {
    return { installed: true, version: '1.0.0' };
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Home Page — combined data for stats
// ═══════════════════════════════════════════════════════════════════════════════

ipcMain.handle('home:data', () => {
  const cfg = loadFlowsealConfig();
  const s = loadAppSettings();

  // Active version — if nothing selected, scan installed dirs for any
  let activeVersion = s.selectedVersion;
  if (!activeVersion) {
    try {
      const dir = getControlDir();
      const entries = fs.readdirSync(dir)
        .filter(f => (f.startsWith('v') || f.match(/^v?\d+\.\d+\.\d+/)) && fs.statSync(path.join(dir, f)).isDirectory())
        .sort().reverse();
      if (entries.length > 0) activeVersion = entries[0];
    } catch {}
  }

  return { strategy: cfg.strategy, activeVersion: activeVersion || '' };
});

// ═══════════════════════════════════════════════════════════════════════════════
// Diagnostics
// ═══════════════════════════════════════════════════════════════════════════════

ipcMain.handle('diag:run', async () => {
  const results = [];
  const dir = findFlowsealDir();

  // Auto-fix: ensure user list files exist (winws crashes if --ipset-exclude references a missing file)
  ensureUserListFiles(dir);

  // Admin rights check
  const adminOk = isAdmin();
  results.push({
    test: 'Права администратора',
    status: adminOk ? 'ok' : 'fail',
    detail: adminOk ? 'Приложение запущено от имени администратора' : 'Требуются права администратора для работы WinDivert',
  });

  // WinDivert check
  const windivertInstalled = checkWinDivertInstalled();
  const windivertOk = (() => {
    try {
      const out = execSync('sc query WinDivert 2>nul', { timeout: 3000, encoding: 'utf8' });
      return out.includes('RUNNING');
    } catch { return false; }
  })();
  const winwsRunning = checkWinwsRunning();
  let wdStatus, wdDetail;
  if (windivertOk) {
    wdStatus = 'ok';
    wdDetail = 'Активна';
  } else if (winwsRunning) {
    wdStatus = 'ok';
    wdDetail = 'Загружена (через winws.exe)';
  } else if (windivertInstalled) {
    wdStatus = 'warn';
    wdDetail = 'Установлена, но не запущена (будет запущена при старте zapret)';
  } else {
    wdStatus = 'warn';
    wdDetail = 'Не установлена. winws.exe требует WinDivert для работы.';
  }
  results.push({ test: 'Служба WinDivert', status: wdStatus, detail: wdDetail });

  // WinDivert DLL and file checks
  if (dir) {
    const wdDll = fs.existsSync(path.join(dir, 'bin', 'WinDivert.dll'));
    const wdSys = fs.existsSync(path.join(dir, 'bin', 'WinDivert64.sys'));
    const wdX86 = fs.existsSync(path.join(dir, 'bin', 'WinDivert32.sys'));
    results.push({
      test: 'Файлы WinDivert',
      status: (wdDll && (wdSys || wdX86)) ? 'ok' : 'warn',
      detail: `WinDivert.dll: ${wdDll ? '✓' : '✗'} | WinDivert64.sys: ${wdSys ? '✓' : '✗'} | WinDivert32.sys: ${wdX86 ? '✓' : '✗'}` +
        (!wdDll ? ' — отсутствует WinDivert.dll! winws не сможет загрузить драйвер.' : ''),
    });
  }

  // winws.exe check
  const winwsRunning2 = checkWinwsRunning();
  if (winwsRunning2) {
    results.push({ test: 'winws.exe (обход DPI)', status: 'ok', detail: 'Активен' });
  } else if (windivertOk) {
    // WinDivert активен, но winws не запущен — проверяем детальнее
    const appS = loadAppSettings();
    const possibleIssues = [];
    if (!dir) possibleIssues.push('Не найдена директория Flowseal');
    if (dir) {
      if (!fs.existsSync(path.join(dir, 'bin', 'winws.exe'))) possibleIssues.push('winws.exe отсутствует в bin/');
      if (!fs.existsSync(path.join(dir, 'bin', 'WinDivert.dll'))) possibleIssues.push('WinDivert.dll отсутствует в bin/ (winws не сможет загрузить драйвер)');
      // Quick static check: try --help to see if binary responds
      try {
        execSync(`"${path.join(dir, 'bin', 'winws.exe')}" --help 2>nul`, { timeout: 3000 });
      } catch (helpErr) {
        const st = (helpErr.stderr || '').toString().trim();
        const so = (helpErr.stdout || '').toString().trim();
        if (st.includes('WinDivert.dll')) possibleIssues.push('Ошибка загрузки WinDivert.dll — возможно DLL повреждена или отсутствует');
        else if (!so && !st) possibleIssues.push('winws.exe не отвечает на --help — вероятно повреждён или несовместим с системой');
        else if (st) possibleIssues.push('winws: ' + st.substring(0, 80));
      }
    }
    if (!appS.selectedVersion) possibleIssues.push('Не выбрана версия Zapret');
    const cfg = loadFlowsealConfig();
    if (!cfg.strategy) possibleIssues.push('Не выбрана стратегия');
    results.push({
      test: 'winws.exe (обход DPI)',
      status: possibleIssues.length > 0 ? 'warn' : 'ok',
      detail: possibleIssues.length > 0
        ? 'WinDivert активен, но winws.exe не запущен. Возможные причины: ' + possibleIssues.join('; ')
        : 'Готов к запуску (WinDivert активен, все файлы на месте). Нажмите «Запустить».',
    });
  } else {
    results.push({ test: 'winws.exe (обход DPI)', status: 'stopped', detail: 'Остановлен (WinDivert тоже не активен)' });
  }

  // Flowseal directory
  if (dir) {
    const s = loadAppSettings();
    const selectedVer = s.selectedVersion || 'не выбрана';
    const hasWinws = fs.existsSync(path.join(dir, 'bin', 'winws.exe'));
    results.push({
      test: 'Версия Flowseal',
      status: hasWinws ? 'ok' : 'fail',
      detail: `${path.basename(dir)} | winws.exe: ${hasWinws ? '✓' : '✗'} | Выбрана: ${selectedVer}`,
    });
  } else {
    results.push({
      test: 'Версия Flowseal',
      status: 'fail',
      detail: 'Не найдена. Установите версию во вкладке «Версии».',
    });
  }

  // Strategy files
  if (dir) {
    const strategies = getStrategies();
    const sCfg = loadFlowsealConfig();
    const activeStrategy = strategies.find(st => st.value === sCfg.strategy);
    results.push({
      test: 'Файлы стратегий',
      status: strategies.length > 0 ? 'ok' : 'warn',
      detail: `Найдено ${strategies.length} | Активна: ${activeStrategy ? activeStrategy.label : sCfg.strategy || '—'}`,
    });

    // User list files check (missing files break winws)
    const listsDir = path.join(dir, 'lists');
    const userFiles = [
      { key: 'list-general-user.txt', label: 'Пользовательский список хостов' },
      { key: 'list-exclude-user.txt', label: 'Пользовательский список исключений' },
      { key: 'ipset-exclude-user.txt', label: 'Пользовательский IPSet' },
    ];
    const missing = userFiles.filter(f => !fs.existsSync(path.join(listsDir, f.key)));
    results.push({
      test: 'Пользовательские файлы',
      status: missing.length === 0 ? 'ok' : 'warn',
      detail: missing.length === 0
        ? 'Все 3 файла присутствуют'
        : `Отсутствуют: ${missing.map(m => m.label).join(', ')}`,
    });
  }

  // Internet connectivity
  try {
    execSync('ping -n 1 8.8.8.8', { timeout: 3000 });
    results.push({ test: 'Интернет', status: 'ok', detail: 'Соединение есть' });
  } catch {
    results.push({ test: 'Интернет', status: 'warn', detail: 'Не отвечает (возможно блокировка)' });
  }

  // DNS
  try {
    execSync('nslookup google.com 2>nul', { timeout: 3000 });
    results.push({ test: 'DNS', status: 'ok', detail: 'Работает' });
  } catch {
    results.push({ test: 'DNS', status: 'warn', detail: 'Проблемы с DNS' });
  }

  // GitHub access (release downloads must reach GitHub)
  try {
    const releases = await fetchGitHubReleases();
    if (Array.isArray(releases) && releases.length > 0) {
      results.push({
        test: 'Доступ к GitHub',
        status: 'ok',
        detail: `Список версий получен (последняя: v${releases[0].version})`,
      });
      // Update availability check for installed version
      const s = loadAppSettings();
      const installedVer = s.selectedVersion || (s.controlDir ? path.basename(dir || s.controlDir) : '');
      const latestStable = releases.find(r => r.type === 'stable');
      if (latestStable) {
        const curNorm = String(installedVer).replace(/^v/i, '');
        const latNorm = latestStable.version;
        if (curNorm && curNorm !== '—' && curNorm !== latNorm) {
          results.push({
            test: 'Обновление Flowseal',
            status: 'warn',
            detail: `Доступна новая версия: v${latNorm} (установлена: v${curNorm}). Обновитесь во вкладке «Версии».`,
          });
        } else {
          results.push({
            test: 'Обновление Flowseal',
            status: 'ok',
            detail: `Установлена актуальная версия: v${curNorm || '—'}`,
          });
        }
      }
    } else {
      results.push({ test: 'Доступ к GitHub', status: 'warn', detail: 'API GitHub недоступен или список пуст. Проверьте интернет или пересоздайте соединение.' });
    }
  } catch {
    results.push({ test: 'Доступ к GitHub', status: 'warn', detail: 'Не удалось получить список версий с GitHub.' });
  }

  // File integrity check of the active zapret directory
  if (dir) {
    const binDir = path.join(dir, 'bin');
    const required = ['winws.exe', 'WinDivert.dll'];
    const missingReq = required.filter(f => !fs.existsSync(path.join(binDir, f)));
    // Strategy files live in the version root as .bat (older layouts) or in a
    // `strategies` subfolder (newer layouts). getStrategies() already scans both,
    // so require that we can find at least one strategy file rather than a fixed dir.
    const requiredDirs = ['bin', 'lists'];
    let strategiesOk = false;
    try {
      const dirs = fs.readdirSync(dir, { withFileTypes: true });
      strategiesOk = dirs.some(d => /\.bat$/i.test(d.name) && !/^service/i.test(d.name))
        || fs.existsSync(path.join(dir, 'strategies'));
    } catch { strategiesOk = false; }
    const missingDirs = requiredDirs.filter(d => !fs.existsSync(path.join(dir, d)));
    if (missingReq.length === 0 && missingDirs.length === 0 && strategiesOk) {
      results.push({ test: 'Целостность файлов', status: 'ok', detail: 'Все ключевые файлы и стратегии на месте' });
    } else {
      const miss = [
        ...missingReq,
        ...missingDirs.map(d => 'папка ' + d),
        ...(strategiesOk ? [] : ['стратегии (файлы *.bat)']),
      ];
      results.push({
        test: 'Целостность файлов',
        status: 'fail',
        detail: 'Отсутствуют: ' + miss.join(', ') + '. Переустановите версию во вкладке «Версии».',
      });
    }
  }

  return results;
});

// ═══════════════════════════════════════════════════════════════════════════════
// Updater — GitHub releases fetcher & version manager
// ═══════════════════════════════════════════════════════════════════════════════

function fetchGitHubReleases(repo = 'Flowseal/zapret-discord-youtube') {
  return new Promise((resolve) => {
    const opts = {
      hostname: 'api.github.com',
      path: `/repos/${repo}/releases?per_page=30`,
      method: 'GET',
      headers: { 'User-Agent': 'Control-App/1.0', 'Accept': 'application/vnd.github.v3+json' },
      timeout: 10000,
    };
    const req = https.get(opts, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const releases = JSON.parse(data);
          if (!Array.isArray(releases)) return resolve([]);
          const versions = releases.map(r => {
            // Find the best downloadable asset:
            //  - Flowseal/Zapret repos ship .zip/.tar.gz/.7z source archives
            //  - Control repo ships an NSIS .exe installer
            const assets = r.assets || [];
            const asset = assets.find(a => a.name.endsWith('.zip'))
              || assets.find(a => a.name.endsWith('.tar.gz'))
              || assets.find(a => a.name.endsWith('.7z'))
              || assets.find(a => a.name.toLowerCase().endsWith('.exe') && /(setup|install)/i.test(a.name))
              || null;
            return {
              version: r.tag_name.replace(/^v/i, ''),
              date: r.published_at ? r.published_at.split('T')[0] : '—',
              type: r.prerelease ? 'dev' : 'stable',
              url: r.html_url,
              name: r.name || r.tag_name,
              assetUrl: asset?.browser_download_url || null,
              assetName: asset?.name || null,
              assetSize: asset?.size || 0,
              body: (r.body || '').slice(0, 4000), // changelog text (capped)
            };
          });
          resolve(versions);
        } catch { resolve([]); }
      });
    });
    req.on('error', () => resolve([]));
    req.on('timeout', () => { req.destroy(); resolve([]); });
  });
}

function find7z() {
  const candidates = [
    'C:\\Program Files\\7-Zip\\7z.exe',
    'C:\\Program Files (x86)\\7-Zip\\7z.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Programs', '7-Zip', '7z.exe'),
    path.join(process.env.PROGRAMW6432 || '', '7-Zip', '7z.exe'),
  ];
  // Also check PATH
  try {
    const out = execSync('where 7z.exe 2>nul', { timeout: 2000, encoding: 'utf8' });
    const lines = out.trim().split('\n').filter(Boolean);
    if (lines.length > 0 && fs.existsSync(lines[0].trim())) return lines[0].trim();
  } catch { /* not in PATH */ }
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

let _activeDownloadReq = null;
let _downloadAborted = false;

function downloadFile(url, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    _downloadAborted = false;
    const u = new URL(url);
    let opts = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Control-App/1.0',
        'Accept': 'application/octet-stream, */*',
      },
      timeout: 120000,
    };
    let aborted = false;

    const doRequest = (redirectCount) => {
      if (redirectCount > 10) {
        return reject(new Error('Слишком много редиректов'));
      }

      const file = fs.createWriteStream(destPath);
      const req = https.get(opts, (res) => {
        // Handle cancellation
        if (_downloadAborted) {
          file.close(); try { fs.unlinkSync(destPath); } catch {}
          _activeDownloadReq = null;
          return reject(new Error('cancelled'));
        }
        _activeDownloadReq = req;
        // Handle redirects (3xx)
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          file.close();
          try { fs.unlinkSync(destPath); } catch {}
          const redirectUrl = new URL(res.headers.location, url);
          opts = {
            hostname: redirectUrl.hostname,
            path: redirectUrl.pathname + redirectUrl.search,
            method: 'GET',
            headers: { 'User-Agent': 'Control-App/1.0', 'Accept': 'application/octet-stream, */*' },
            timeout: 120000,
          };
          doRequest(redirectCount + 1);
          return;
        }

        if (res.statusCode !== 200) {
          file.close();
          try { fs.unlinkSync(destPath); } catch {}
          return reject(new Error('HTTP ' + res.statusCode));
        }

        const total = parseInt(res.headers['content-length'] || '0', 10);
        let downloaded = 0;
        res.on('data', (chunk) => {
          if (_downloadAborted) {
            file.close(); try { fs.unlinkSync(destPath); } catch {}
            _activeDownloadReq = null;
            req.destroy();
            return;
          }
          downloaded += chunk.length;
          file.write(chunk);
          if (total > 0) {
            const pct = Math.round((downloaded / total) * 100);
            onProgress?.({ downloaded, total, percent: pct });
          }
        });
        res.on('end', () => {
          file.end();
          _activeDownloadReq = null;
        });
        file.on('finish', () => {
          if (!_downloadAborted) {
            onProgress?.({ downloaded, total, percent: 100 });
            resolve(destPath);
          }
          _activeDownloadReq = null;
        });
        file.on('error', (e) => {
          try { fs.unlinkSync(destPath); } catch {}
          _activeDownloadReq = null;
          reject(e);
        });
        req.on('close', () => {
          _activeDownloadReq = null;
        });
      });
      req.on('error', (e) => { file.close(); try { fs.unlinkSync(destPath); } catch {} _activeDownloadReq = null; reject(e); });
      req.on('timeout', () => { req.destroy(); file.close(); try { fs.unlinkSync(destPath); } catch {} _activeDownloadReq = null; reject(new Error('timeout')); });
    };

    doRequest(0);
  });
}

ipcMain.handle('updater:current', () => {
  const s = loadAppSettings();
  // Show the app version from package.json
  const appVer = app.getVersion() || '1.0.1';
  // Check installed versions in control directory
  const dir = getControlDir();
  let installedVersions = [];
  let activeFolder = null;
  try {
    const entries = fs.readdirSync(dir)
      .filter(f => (f.startsWith('v') || f.match(/^v?\d+\.\d+\.\d+/)) && fs.statSync(path.join(dir, f)).isDirectory())
      .sort();
    installedVersions = entries.map(f => ({
      folder: f,
      version: f.replace(/^v/i, ''),
      path: path.join(dir, f),
      hasWinws: fs.existsSync(path.join(dir, f, 'bin', 'winws.exe')),
      isActive: f === s.selectedVersion,
    }));
    if (s.selectedVersion && entries.includes(s.selectedVersion)) {
      activeFolder = s.selectedVersion;
    } else if (entries.length > 0) {
      activeFolder = entries.reverse()[0]; // latest
    }
  } catch { /* ignore */ }
  return { version: appVer, installedVersions, activeFolder, controlDir: dir };
});

ipcMain.handle('updater:versions', async () => {
  const releases = await fetchGitHubReleases();
  if (releases.length > 0) return releases;
  // Fallback: static list
  return [
    { version: '1.10.0', date: '2026-03-01', type: 'stable', assetUrl: null },
    { version: '1.9.9', date: '2026-01-15', type: 'stable', assetUrl: null },
    { version: '1.9.8', date: '2025-11-20', type: 'stable', assetUrl: null },
  ];
});

ipcMain.handle('updater:cancelDownload', () => {
  _downloadAborted = true;
  if (_activeDownloadReq) {
    _activeDownloadReq.destroy();
    _activeDownloadReq = null;
  }
  return true;
});

ipcMain.handle('updater:download', async (_, version) => {
  try {
    // Fetch releases to find the asset URL
    const releases = await fetchGitHubReleases();
    const release = releases.find(r => r.version === version);
    if (!release || !release.assetUrl) {
      return { ok: false, error: 'Не удалось найти файл для скачивания на GitHub. Возможно, сборка ещё не загружена автором.' };
    }

    // Prepare temp download location
    const tempDir = path.join(getAppDataPath(), 'temp-downloads');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
    // Preserve original extension including .tar.gz — match from last dot for simple extensions, or full .tar.gz
    const ext = release.assetName?.replace(/^.*?(\.tar\.gz|\.\w+)$/, '$1') || '.zip';
    const tempFile = path.join(tempDir, `zapret-${version}${ext}`);

    // Remove old temp file if exists
    if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);

    // Download with progress
    mainWindow?.webContents.send('updater:progress', {
      phase: 'download',
      percent: 0,
      text: `Скачивание ${release.assetName}...`,
    });

    await downloadFile(release.assetUrl, tempFile, (p) => {
      mainWindow?.webContents.send('updater:progress', {
        phase: 'download',
        percent: p.percent,
        downloaded: p.downloaded,
        total: p.total,
        text: `Скачивание... ${p.percent}%`,
      });
    });

    return { ok: true, tempFile, version, assetName: release.assetName };
  } catch (e) {
    return { ok: false, error: e.message || 'Ошибка скачивания' };
  }
});

ipcMain.handle('updater:install', async (_, version, tempFile) => {
  try {
    if (!tempFile || !fs.existsSync(tempFile)) {
      return { ok: false, error: 'Файл не найден. Попробуйте скачать заново.' };
    }

    const dir = getControlDir();
    const verDir = path.join(dir, 'v' + version);

    mainWindow?.webContents.send('updater:progress', {
      phase: 'install',
      percent: 0,
      text: 'Распаковка...',
    });

    // Check if temp file is usable
    const tempSize = fs.statSync(tempFile).size;
    if (tempSize === 0) {
      try { fs.unlinkSync(tempFile); } catch {}
      return { ok: false, error: 'Скачанный файл пуст. Проверьте подключение к интернету.' };
    }

    // Preserve user customizations when updating/reinstalling an existing version
    const savedUserFiles = {};
    const oldListsDir = path.join(verDir, 'lists');
    if (fs.existsSync(oldListsDir)) {
      for (const lf of LIST_FILES) {
        const fp = path.join(oldListsDir, lf.file);
        if (fs.existsSync(fp)) {
          try { savedUserFiles[lf.file] = fs.readFileSync(fp, 'utf8'); } catch {}
        }
      }
    }
    const savedGameFilter = getGameFilterFromDir(verDir);

    // Create version directory (remove existing if any)
    if (fs.existsSync(verDir)) {
      fs.rmSync(verDir, { recursive: true, force: true });
    }
    fs.mkdirSync(verDir, { recursive: true });

    const isTarGz = tempFile.toLowerCase().endsWith('.tar.gz');
    const ext = path.extname(tempFile).toLowerCase();
    let extracted = false;
    let lastExtractError = '';

    // ── Helper: run PowerShell directly (use execFileSync for correct array args) ──
    const runPS = (script) => {
      return execFileSync('powershell', [
        '-NoProfile',
        '-Command',
        script,
      ], { timeout: 120000, windowsHide: true });
    };

    // ── Helper: count files in version dir ──
    const countFiles = () => {
      try { return fs.readdirSync(verDir).length; } catch { return 0; }
    };

    // Strategy 1: PowerShell Expand-Archive (for .zip — works reliably on Windows)
    if (!extracted && ext === '.zip') {
      try {
        const psFile = tempFile.replace(/'/g, "''");
        const psDest = verDir.replace(/'/g, "''");
        runPS(
          `try { Expand-Archive -LiteralPath '${psFile}' -DestinationPath '${psDest}' -Force; write-host 'OK' } catch { write-error $_.Exception.Message; exit 1 }`
        );
        extracted = countFiles() > 0;
        if (!extracted) lastExtractError = 'PowerShell: архив пуст';
      } catch (e) {
        lastExtractError = 'PowerShell: ' + (e.stderr?.toString().trim() || e.message);
      }
    }

    // Strategy 2: Windows tar.exe (for .tar.gz — built-in on Win10 17063+)
    if (!extracted && isTarGz) {
      try {
        // Use array form via execFileSync — avoids cmd.exe, finds tar.exe via PATH
        execFileSync('tar', ['-xzf', tempFile, '-C', verDir], { timeout: 120000, windowsHide: true });
        extracted = countFiles() > 0;
        if (!extracted) lastExtractError = 'tar: архив пуст';
      } catch (e) {
        lastExtractError = 'tar: ' + (e.stderr?.toString().trim() || e.message);
      }
    }

    // Strategy 3: 7-Zip (universal — .7z, .zip, .tar.gz)
    if (!extracted) {
      const sevenZip = find7z();
      if (sevenZip) {
        try {
          execSync(`"${sevenZip}" x "${tempFile}" -o"${verDir}" -y`, { timeout: 120000, windowsHide: true });
          extracted = countFiles() > 0;
          if (!extracted) lastExtractError = '7-Zip: архив пуст';
        } catch (e) {
          lastExtractError = '7-Zip: ' + (e.stderr?.toString().trim() || e.message);
        }
      } else {
        lastExtractError = '7-Zip не найден';
      }
    }

    // Strategy 4: .NET ZipFile (last resort for .zip, via array-form PS)
    if (!extracted && ext === '.zip') {
      try {
        const psFile = tempFile.replace(/'/g, "''");
        const psDest = verDir.replace(/'/g, "''");
        runPS(
          `try { Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory('${psFile}', '${psDest}'); write-host 'OK' } catch { write-error $_.Exception.Message; exit 1 }`
        );
        extracted = countFiles() > 0;
        if (!extracted) lastExtractError = '.NET ZipFile: архив пуст';
      } catch (e) {
        lastExtractError = '.NET ZipFile: ' + (e.stderr?.toString().trim() || e.message);
      }
    }

    if (!extracted) {
      try { fs.rmSync(verDir, { recursive: true, force: true }); } catch {}
      try { fs.unlinkSync(tempFile); } catch {}
      return { ok: false, error: 'Не удалось распаковать архив: ' + lastExtractError };
    }

    // The archive always contains a root folder (e.g. zapret-discord-youtube-1.10.0/)
    // Move everything up one level so that verDir/bin/winws.exe works
    const verItems = fs.readdirSync(verDir);
    const rootDirName = verItems.find(i => fs.statSync(path.join(verDir, i)).isDirectory());
    if (rootDirName && verItems.length === 1) {
      const subDir = path.join(verDir, rootDirName);
      const subItems = fs.readdirSync(subDir);
      subItems.forEach(item => {
        try {
          const src = path.join(subDir, item);
          const dst = path.join(verDir, item);
          if (fs.existsSync(dst)) fs.rmSync(dst, { recursive: true, force: true });
          fs.renameSync(src, dst);
        } catch { /* skip problematic files */ }
      });
      try { fs.rmdirSync(subDir); } catch {}
    }

    // Restore preserved customizations (user lists + game filter) — ensures
    // an update never wipes the user's own config.
    if (Object.keys(savedUserFiles).length > 0) {
      const listsDir = path.join(verDir, 'lists');
      if (!fs.existsSync(listsDir)) { try { fs.mkdirSync(listsDir, { recursive: true }); } catch {} }
      for (const [name, content] of Object.entries(savedUserFiles)) {
        try { fs.writeFileSync(path.join(listsDir, name), content, 'utf8'); } catch {}
      }
    }
    if (savedGameFilter && savedGameFilter !== 'disabled') {
      const utilsDir = path.join(verDir, 'utils');
      if (!fs.existsSync(utilsDir)) { try { fs.mkdirSync(utilsDir, { recursive: true }); } catch {} }
      try { fs.writeFileSync(path.join(utilsDir, 'game_filter.enabled'), savedGameFilter, 'utf8'); } catch {}
    }

    // Verify winws.exe exists
    const hasWinws = fs.existsSync(path.join(verDir, 'bin', 'winws.exe'));

    // Update settings to select this version
    const s = loadAppSettings();
    s.selectedVersion = 'v' + version;
    saveAppSettings(s);

    mainWindow?.webContents.send('updater:progress', {
      phase: 'done',
      percent: 100,
      text: 'Готово!',
    });

    // Clean up temp file
    try { fs.unlinkSync(tempFile); } catch { /* ignore */ }

    return { ok: true, version, path: verDir, hasWinws };
  } catch (e) {
    return { ok: false, error: e.message || 'Ошибка установки' };
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Backup — export / import settings
// ═══════════════════════════════════════════════════════════════════════════════

function buildBackupBundle() {
  const settings = loadAppSettings();
  const flowsealCfg = loadFlowsealConfig();
  const dir = findFlowsealDir();
  const userLists = {};
  if (dir) {
    const listsDir = path.join(dir, 'lists');
    if (fs.existsSync(listsDir)) {
      for (const lf of LIST_FILES) {
        const fp = path.join(listsDir, lf.file);
        if (fs.existsSync(fp)) { try { userLists[lf.file] = fs.readFileSync(fp, 'utf8'); } catch {} }
      }
    }
  }
  return {
    app: 'Control',
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    controlVersion: app.getVersion() || '1.0.1',
    settings,
    flowsealConfig: flowsealCfg,
    userLists,
  };
}

ipcMain.handle('backup:export', async () => {
  try {
    const bundle = buildBackupBundle();
    const r = await dialog.showSaveDialog(mainWindow, {
      title: 'Экспорт настроек Control',
      defaultPath: path.join(app.getPath('documents'), `control-backup-${Date.now()}.json`),
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (r.canceled || !r.filePath) return { ok: false, canceled: true };
    fs.writeFileSync(r.filePath, JSON.stringify(bundle, null, 2), 'utf8');
    return { ok: true, path: r.filePath };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('backup:import', async () => {
  try {
    const r = await dialog.showOpenDialog(mainWindow, {
      title: 'Импорт настроек Control',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };
    const raw = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8'));
    if (!raw || raw.app !== 'Control') return { ok: false, error: 'Это не файл резервной копии Control' };
    const settings = { ...DEFAULT_SETTINGS, ...(raw.settings || {}) };
    // lastState is owned by the main process — never overwrite from a backup
    settings.lastState = loadAppSettings().lastState;
    saveAppSettings(settings);
    if (raw.flowsealConfig) {
      saveFlowsealConfig({ ...getDefaultFlowsealConfig(), ...raw.flowsealConfig });
    }
    const dir = findFlowsealDir();
    if (dir && raw.userLists && typeof raw.userLists === 'object') {
      const listsDir = path.join(dir, 'lists');
      if (!fs.existsSync(listsDir)) { try { fs.mkdirSync(listsDir, { recursive: true }); } catch {} }
      for (const [name, content] of Object.entries(raw.userLists)) {
        try { fs.writeFileSync(path.join(listsDir, name), content, 'utf8'); } catch {}
      }
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════════

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ═══════════════════════════════════════════════════════════════════════════════
// App Lifecycle
// ═══════════════════════════════════════════════════════════════════════════════

app.setAppUserModelId('Control');

// ── Admin elevation check ─────────────────────────────────────────────────────
if (!gotSingleInstanceLock) {
  // Second instance — do nothing, quit already requested above.
} else if (!isAdmin()) {
  console.log('[main] Not running as admin. Application requires administrator privileges.');
  console.log('[main] The app manifest should trigger UAC automatically.');
  // If we reach here without admin despite the manifest, try elevation once
  try {
    const SQ = String.fromCharCode(39);
    const Q = String.fromCharCode(34);
    const appArgs = process.argv.slice(1).filter(a => !a.startsWith('--'));
    let argPart = '';
    if (appArgs.length > 0) {
      const argsStr = appArgs.map(a => SQ + a.replace(/'/g, "''") + SQ).join(', ');
      argPart = ' -ArgumentList ' + argsStr;
    }
    const psCmd = 'powershell -Command ' + Q + 'Start-Process ' + SQ + process.execPath.replace(/'/g, "''") + SQ + argPart + ' -Verb RunAs' + Q;
    console.log('[main] Elevation command:', psCmd);
    execSync(psCmd, { timeout: 8000 });
    console.log('[main] Elevation OK, exiting current process');
  } catch(e) {
    console.log('[main] Elevation failed:', e.message);
  }
  process.exit(0);
}
console.log('[main] Running with admin rights');
app.whenReady().then(() => {
  console.log('[main] App ready - creating window and tray');

  // Register custom protocol for serving assets (Electron 26+, reliable)
  if (typeof protocol.handle === 'function') {
    // Electron 28+ (native MIME support)
    const { net } = require('electron');
    protocol.handle('app-asset', (request) => {
      const url = new URL(request.url);
      const filePath = decodeURIComponent(url.pathname.replace(/^\//, ''));
      const fullPath = path.join(ASSETS_DIR, filePath);
      try {
        return net.fetch(require('url').pathToFileURL(fullPath).href);
      } catch {
        return net.fetch(require('url').pathToFileURL(APP_ICON_PATH).href);
      }
    });
  } else {
    // Electron 26-27 — registerFileProtocol returns a file path, no MIME issues
    protocol.registerFileProtocol('app-asset', (request, callback) => {
      try {
        // With standard:true, URL is properly parsed
        const hostAndPath = request.url.replace(/^app-asset:\/\//, '');
        const fullPath = path.join(ASSETS_DIR, path.basename(hostAndPath));
        callback({ path: fullPath });
      } catch {
        callback({ path: APP_ICON_PATH });
      }
    });
  }

  // Control has no "autostart with Windows" feature anymore. Clear any leftover
  // registry entry from older versions so it can't keep launching at logon.
  try { removeControlAutoStart(); } catch { /* best effort */ }

  // Start hidden is only ever requested via an explicit --minimized flag.
  // Decide BEFORE creating the window so it never flashes on screen.
  const s = loadAppSettings();
  const startHidden = process.argv.includes('--minimized');
  console.log('[main] Start hidden:', startHidden);
  createWindow(!startHidden);
  createTray();

  // Ensure user list files exist (strategies reference them, winws crashes if absent)
  const fsDir = findFlowsealDir();
  if (fsDir) ensureUserListFiles(fsDir);

  // Restore previous state: if Control was closed while Zapret was running and
  // the user enabled restoreState, bring the protection back automatically.
  if (s.restoreState && s.lastState?.running && fsDir) {
    console.log('[main] Restoring previous state — restarting Zapret');
    setTimeout(() => { startZapret().catch(() => {}); }, 1500);
  }

  console.log('[main] App initialized');
});

// ── Clean shutdown ───────────────────────────────────────────────────────────
// Mark intentional quit so the window close handler lets the app exit instead
// of hiding to tray, and kill our own winws.exe child so no orphaned filter
// process is left behind (unless the user asked to keep it running).
app.on('before-quit', () => {
  isQuitting = true;
  try {
    const s = loadAppSettings();
    if (!s.keepRunningOnExit && currentWinwsProcess) {
      try { currentWinwsProcess.kill(); } catch {}
    }
  } catch { /* ignore */ }
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
