// ═══════════════════════════════════════════════════════════════════════════════
// Zapret GUI — Application Shell
// ═══════════════════════════════════════════════════════════════════════════════

// ── Shared UI Components ─────────────────────────────────────────────────────

const ui = {};

ui.btn = (label, opts = {}) => {
  const b = document.createElement('button');
  const v = opts.variant || 's';
  b.className = `btn btn-${v}${opts.sm ? ' btn-sm' : ''}${opts.iconOnly ? ' btn-icon' : ''}`;
  if (opts.className) b.classList.add(...opts.className.split(' '));
  if (opts.id) b.id = opts.id;
  if (opts.disabled) b.disabled = true;
  if (opts.title) b.title = opts.title;
  if (opts.onclick) b.addEventListener('click', opts.onclick);
  if (opts.icon) { const i = document.createElement('i'); i.className = `ti ti-${opts.icon}`; b.appendChild(i); }
  if (label && !opts.iconOnly) b.appendChild(document.createTextNode(label));
  return b;
};

ui.switch = (checked, onChange) => {
  const l = document.createElement('label'); l.className = 'switch';
  const i = document.createElement('input'); i.type = 'checkbox';
  i.checked = !!checked;
  i.addEventListener('change', () => onChange?.(i.checked));
  const s = document.createElement('span'); s.className = 'switch-slider';
  l.append(i, s); return l;
};

ui.select = (items, value, onChange) => {
  const s = document.createElement('select');
  items.forEach(item => {
    const o = document.createElement('option');
    o.value = item.value; o.textContent = item.label || item.value;
    if (item.value === value) o.selected = true;
    s.appendChild(o);
  });
  if (onChange) s.addEventListener('change', () => onChange(s.value));
  return s;
};

ui.card = (title, content) => {
  const c = document.createElement('div'); c.className = 'card';
  if (title) {
    const h = document.createElement('div'); h.className = 'card-h';
    const t = document.createElement('div'); t.className = 'card-t'; t.textContent = title;
    h.appendChild(t); c.appendChild(h);
  }
  if (content) {
    const b = document.createElement('div'); b.className = 'card-b';
    if (typeof content === 'string') b.innerHTML = content;
    else b.appendChild(content);
    c.appendChild(b);
  }
  return c;
};

ui.stat = (icon, value, label, color = 'neutral') => {
  const s = document.createElement('div'); s.className = 'stat';
  s.innerHTML = `<div class="stat-i ${color}"><i class="ti ti-${icon}"></i></div>
    <div class="stat-v">${value}</div>
    <div class="stat-l">${label}</div>`;
  return s;
};

ui.banner = (state, title, desc, actions) => {
  const b = document.createElement('div'); b.className = `banner ${state}`;
  const ico = { on: 'circle-check', off: 'player-stop', err: 'alert-triangle' };
  b.innerHTML = `<div class="banner-icon"><i class="ti ti-${ico[state] || 'info-circle'}"></i></div>
    <div class="banner-body"><h3>${title}</h3><p>${desc}</p></div>`;
  if (actions) { const a = document.createElement('div'); a.className = 'banner-actions';
    actions.forEach(btn => a.appendChild(btn)); b.appendChild(a); }
  return b;
};

ui.formRow = (label, desc, control, opts = {}) => {
  const r = document.createElement('div'); r.className = 'form-row';
  if (opts.id) r.id = opts.id;
  const body = document.createElement('div'); body.className = 'form-row-body';
  const l = document.createElement('div'); l.className = 'form-row-lbl'; l.textContent = label;
  if (opts.tooltip) l.setAttribute('data-tooltip', opts.tooltip);
  body.appendChild(l);
  if (desc) { const d = document.createElement('div'); d.className = 'form-row-desc'; d.textContent = desc; body.appendChild(d); }
  r.appendChild(body);
  const ctl = document.createElement('div'); ctl.className = 'form-row-ctl'; ctl.appendChild(control);
  r.appendChild(ctl);
  return r;
};

ui.badge = (text, color = 'gray') => { const b = document.createElement('span'); b.className = `badge badge-${color}`; b.textContent = text; return b; };

ui.pageHeader = (title, desc, actions) => {
  const h = document.createElement('div'); h.className = 'pg-header';
  const b = document.createElement('div'); b.className = 'pg-header-body';
  b.innerHTML = `<h1>${title}</h1>${desc ? `<p>${desc}</p>` : ''}`; h.appendChild(b);
  if (actions?.length) { const a = document.createElement('div'); a.className = 'pg-header-actions';
    actions.forEach(btn => a.appendChild(btn)); h.appendChild(a); }
  return h;
};

ui.section = (title) => {
  const s = document.createElement('div'); s.className = 'section';
  const h = document.createElement('div'); h.className = 'section-h';
  const t = document.createElement('div'); t.className = 'section-t'; t.textContent = title;
  h.appendChild(t); s.appendChild(h); return s;
};

ui.logViewer = (lines) => {
  const v = document.createElement('div'); v.className = 'log';
  (lines || ['[system] ready']).forEach(l => {
    const d = document.createElement('div'); d.className = 'log-line'; d.textContent = l;
    v.appendChild(d);
  });
  return v;
};

ui.modal = (title, body, opts = {}) => {
  const overlay = document.getElementById('modal-overlay');
  const modal = document.getElementById('modal'); overlay.classList.remove('hidden');
  const h = document.createElement('div'); h.className = 'modal-h';
  const t = document.createElement('div'); t.className = 'modal-t'; t.textContent = title;
  h.appendChild(t);
  const closeBtn = ui.btn('', { icon: 'x', iconOnly: true, variant: 'g', onclick: ui.hideModal });
  h.appendChild(closeBtn);
  const b = document.createElement('div'); b.className = 'modal-b';
  if (typeof body === 'string') b.innerHTML = body; else b.appendChild(body);
  modal.innerHTML = ''; modal.removeAttribute('data-noclose');
  modal.appendChild(h); modal.appendChild(b);
  if (opts.footer) { const f = document.createElement('div'); f.className = 'modal-f';
    opts.footer.forEach(btn => f.appendChild(btn)); modal.appendChild(f); }
  requestAnimationFrame(() => overlay.classList.add('visible'));
};

ui.hideModal = () => {
  const overlay = document.getElementById('modal-overlay');
  const modal = document.getElementById('modal');
  if (modal.getAttribute('data-noclose')) return;
  overlay.classList.remove('visible');
  // Wait for fade transition, then hide completely
  if (window._hideModalTimer) clearTimeout(window._hideModalTimer);
  window._hideModalTimer = setTimeout(() => {
    overlay.classList.add('hidden');
    window._hideModalTimer = null;
  }, 200);
};

ui.toast = (message, type = 'info') => {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const t = document.createElement('div'); t.className = 'toast';
  const icons = { info: 'info-circle', success: 'circle-check', err: 'alert-triangle', warn: 'alert-triangle' };
  t.innerHTML = `<i class="ti ti-${icons[type] || 'info-circle'}"></i><span>${message}</span>`;
  if (type === 'err') {
    const copyBtn = document.createElement('button');
    copyBtn.className = 'toast-copy';
    copyBtn.innerHTML = '<i class="ti ti-copy"></i>';
    copyBtn.title = 'Копировать';
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(message);
      copyBtn.innerHTML = '<i class="ti ti-check"></i>';
      setTimeout(() => { copyBtn.innerHTML = '<i class="ti ti-copy"></i>'; }, 1500);
    });
    t.appendChild(copyBtn);
  }
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  const dismissMs = type === 'err' ? 10000 : 3000;
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 200); }, dismissMs);
};

ui.input = (type, value, onChange, opts = {}) => {
  const i = document.createElement('input'); i.type = type;
  i.value = value ?? ''; if (opts.min !== undefined) i.min = opts.min;
  if (opts.max !== undefined) i.max = opts.max;
  if (opts.placeholder) i.placeholder = opts.placeholder;
  i.addEventListener('input', () => onChange(i.value));
  i.addEventListener('change', () => onChange(i.value));
  return i;
};

ui.pathInput = (value, onBrowse, onUpdate) => {
  const d = document.createElement('div'); d.className = 'input-wrap';
  const i = document.createElement('input'); i.type = 'text'; i.value = value || '';
  i.placeholder = 'Не указан'; i.readOnly = true;
  if (value) i.style.cssText += 'color:var(--text);';
  d.appendChild(i);

  // Update helper
  const updateValue = (newVal) => {
    i.value = newVal || '';
    i.style.cssText = i.style.cssText.replace(/color:[^;]+;/, '');
    if (newVal) i.style.cssText += 'color:var(--text);border-color:var(--accent);';
    else i.style.cssText += 'border-color:var(--border);';
  };

  d.appendChild(ui.btn('Обзор', { icon: 'folder', variant: 's', sm: true, onclick: async () => {
    const p = await onBrowse();
    if (p) {
      updateValue(p);
      onUpdate?.(p);
    }
  } }));

  return d;
};

// ── Preferences-specific UI ──────────────────────────────────────────────────

ui.prefSwitch = (checked, onChange) => {
  const wrap = document.createElement('div');
  wrap.className = 'pref-switch';
  const s = ui.switch(checked, onChange);
  wrap.appendChild(s);
  return wrap;
};

ui.prefPathInput = (value, onBrowse, onUpdate) => {
  const d = document.createElement('div'); d.className = 'pref-path';
  const i = document.createElement('input'); i.type = 'text';
  i.value = value || ''; i.placeholder = 'Не указан'; i.readOnly = true;
  if (value) i.classList.add('has-value');
  const browseBtn = document.createElement('button');
  browseBtn.className = 'btn btn-s';
  browseBtn.innerHTML = '<i class="ti ti-folder"></i><span>Обзор</span>';
  browseBtn.addEventListener('click', async () => {
    const p = await onBrowse();
    if (p) {
      i.value = p;
      i.classList.add('has-value');
      onUpdate?.(p);
    }
  });
  d.append(i, browseBtn);
  return d;
};

let zapretRunning = false;
const homeState = { running: false, version: '0.0.0', status: 'off', uptime: 0 };
window.homeState = homeState; // cross-file safety

// ── Router ───────────────────────────────────────────────────────────────────

let currentPage = 'home';

function navigate(pageId) {
  if (pageId === currentPage) return;
  const currentEl = document.getElementById('page-' + currentPage);
  const target = document.getElementById('page-' + pageId);
  if (!target) return;

  // Exit animation for current page
  if (currentEl) {
    currentEl.classList.remove('active');
    currentEl.classList.add('leaving');
    setTimeout(() => currentEl.classList.remove('leaving'), 150);
  }

  // Small delay before showing new page for smoother crossfade feel
  setTimeout(() => {
    if (target) target.classList.add('active');
    const renders = {
      home: renderHome, settings: renderSettings, versions: renderVersions,
      diagnostics: renderDiagnostics, preferences: renderPreferences, about: renderAbout
    };
    renders[pageId]?.();
    currentPage = pageId;
    document.querySelectorAll('.nav').forEach(el => el.classList.toggle('active', el.dataset.page === pageId));
  }, 50);
}

// ── Sidebar ──────────────────────────────────────────────────────────────────

const NAV_MAIN = [
  { id: 'home', icon: 'home', label: 'Главная' },
  { id: 'settings', icon: 'settings', label: 'Настройки Zapret' },
  { id: 'versions', icon: 'cloud-download', label: 'Версии' },
  { id: 'diagnostics', icon: 'heartbeat', label: 'Диагностика' },
];
const NAV_BOTTOM = [
  { id: 'preferences', icon: 'adjustments-horizontal', label: 'Параметры' },
  { id: 'about', icon: 'info-circle', label: 'О программе' },
];

function renderSidebar() {
  const sb = document.getElementById('sidebar'); sb.innerHTML = '';
  const g1 = document.createElement('div'); g1.className = 'sidebar-group';
  NAV_MAIN.forEach(item => g1.appendChild(navItem(item)));
  sb.appendChild(g1);
  const g2 = document.createElement('div'); g2.className = 'sidebar-group';
  NAV_BOTTOM.forEach(item => g2.appendChild(navItem(item)));
  sb.appendChild(g2);
}

function navItem(item) {
  const el = document.createElement('div'); el.className = 'nav'; el.dataset.page = item.id;
  el.innerHTML = `<i class="ti ti-${item.icon}"></i><span>${item.label}</span>`;
  el.addEventListener('click', () => navigate(item.id));
  return el;
}

// ── Status Bar ───────────────────────────────────────────────────────────────

function updateStatusBar(status) {
  const sb = document.getElementById('statusbar');
  if (!sb) return;
  const d = status.running ? 'on' : 'off';
  const label = status.running
    ? (status.external ? 'Внешний' : 'Работает')
    : 'Остановлен';
  sb.innerHTML = `
    <div class="sb-left">
      <span class="sb-item"><span class="sb-dot ${d}"></span>Zapret: ${label}</span>
      <span class="sb-item"><i class="ti ti-shield" style="font-size:16px;"></i>Flowseal</span>
    </div>
    <div class="sb-right">
    </div>`;
}

// ── Config helper (Flowseal) ─────────────────────────────────────────────────

const ZAPRET_PARAMS = {
  gameFilterModes: [
    { value: 'disabled', label: 'Выключен', desc: 'Игровой фильтр не используется' },
    { value: 'all', label: 'TCP и UDP', desc: 'Фильтр на все порты 1024-65535 для TCP и UDP' },
    { value: 'tcp', label: 'Только TCP', desc: 'Фильтр только на TCP порты игр' },
    { value: 'udp', label: 'Только UDP', desc: 'Фильтр только на UDP порты игр' },
  ],
  ipsetFilterModes: [
    { value: 'loaded', label: 'Загружен', desc: 'Фильтр IPSet активен (список загружен)' },
    { value: 'none', label: 'Отключён', desc: 'IPSet фильтр отключён' },
    { value: 'any', label: 'Все IP', desc: 'Фильтр на все IP-адреса (без списка)' },
  ],
};

function defaultConfig() {
  return {
    enabled: false,
    strategy: 'general',
    gameFilter: 'disabled',
    ipsetFilter: 'loaded',
    autoUpdate: false,
  };
}

// ── First Launch Setup Modal (redesigned) ────────────────────────────────────

async function checkFirstLaunch() {
  try {
    const status = await window.api.control.getSetupStatus();
    if (status.done) return;

    const overlay = document.getElementById('modal-overlay');
    const modal = document.getElementById('modal');
    overlay.classList.remove('hidden');

    // ── Build modal without header — immersive layout ──
    modal.innerHTML = '';
    modal.setAttribute('data-noclose', 'true');
    modal.setAttribute('data-setup', '');

    const b = document.createElement('div'); b.className = 'modal-b setup-body';

    b.innerHTML = `
      <div class="setup-hero">
        <div class="setup-logo">
          <div class="setup-logo-ring"></div>
          <div class="setup-logo-inner">
            <i class="ti ti-shield-lock-filled"></i>
          </div>
        </div>
        <h1 class="setup-title">Добро пожаловать в <span class="setup-title-accent">Control</span></h1>
        <p class="setup-desc">Графическая оболочка для управления Zapret.<br>Выберите папку, где будут храниться все версии.</p>
      </div>

      <div id="setup-existing-warn" style="display:none;"></div>

      <div class="setup-folder">
        <div class="setup-folder-label">
          <i class="ti ti-folder"></i>
          <span>Папка для хранения версий</span>
        </div>
        <div class="setup-folder-row">
          <div class="setup-folder-path" id="setup-path-display">
            <span class="setup-path-placeholder">Папка не выбрана</span>
          </div>
          <button class="setup-folder-btn" id="setup-browse-btn" title="Выбрать папку">
            <i class="ti ti-folder-open"></i>
          </button>
        </div>
        <div class="setup-hint" id="setup-hint">Рекомендуется выбрать папку на диске с достаточным свободным местом</div>
      </div>

      <div class="setup-footer">
        <button class="btn btn-p setup-go" id="setup-confirm-btn" disabled>
          <span>Начать работу</span>
          <i class="ti ti-arrow-right"></i>
        </button>
      </div>`;

    modal.appendChild(b);
    requestAnimationFrame(() => {
      overlay.classList.add('visible');
      // Trigger stagger animations
      b.classList.add('setup-visible');
    });

    // Check for existing zapret installation
    try {
      const existing = await window.api.control.checkExistingZapret();
      if (existing.running || existing.installPath) {
        const warnEl = b.querySelector('#setup-existing-warn');
        warnEl.style.display = 'block';
        let warnHtml = '<div class="setup-warn">';
        warnHtml += '<i class="ti ti-alert-triangle"></i>';
        warnHtml += '<div>';
        if (existing.running) {
          warnHtml += '<strong>Обнаружен запущенный Zapret</strong><p>Если он запущен не через Control, остановите его вручную или через терминал (taskkill /IM winws.exe /F).</p>';
        }
        if (existing.installPath) {
          warnHtml += '<strong>Найден установленный Zapret</strong>';
          warnHtml += `<p class="setup-warn-path">${existing.installPath}</p>`;
          warnHtml += '<p>Control будет использовать свою папку. Установка не будет затронута.</p>';
        }
        warnHtml += '</div></div>';
        warnEl.innerHTML = warnHtml;
      }
    } catch { /* ignore */ }

    let chosenDir = '';
    const display = b.querySelector('#setup-path-display');
    const confirmBtn = b.querySelector('#setup-confirm-btn');

    b.querySelector('#setup-browse-btn').addEventListener('click', async () => {
      const dir = await window.api.selectFolder();
      if (dir) {
        chosenDir = dir;
        display.innerHTML = `<span class="setup-path-value">${dir}</span>`;
        display.classList.add('has-value');
        confirmBtn.disabled = false;
        // Haptic-like pulse on confirm button
        confirmBtn.style.transform = 'scale(1.03)';
        setTimeout(() => confirmBtn.style.transform = '', 200);
      }
    });

    confirmBtn.addEventListener('click', async () => {
      if (!chosenDir) return;
      confirmBtn.disabled = true;
      confirmBtn.innerHTML = '<span class="spin" style="width:18px;height:18px;border-width:2px;border-top-color:#111;"></span><span>Сохранение...</span>';
      const r = await window.api.control.setDirectory(chosenDir);
      if (r.ok) {
        // Success animation
        b.classList.add('setup-success');
        b.innerHTML = `
          <div class="setup-hero">
            <div class="setup-logo setup-logo-done">
              <div class="setup-logo-inner" style="background:var(--accent);color:#111;">
                <i class="ti ti-check"></i>
              </div>
            </div>
            <h1 class="setup-title" style="color:var(--accent);">Всё готово!</h1>
            <p class="setup-desc">Папка сохранена. Можно приступать к работе с Control.</p>
          </div>
          <div class="setup-footer" style="border:none;padding-top:8px;">
            <button class="btn btn-p setup-go" id="setup-dismiss-btn">
              <span>Начать</span>
              <i class="ti ti-arrow-right"></i>
            </button>
          </div>`;
        b.querySelector('#setup-dismiss-btn').addEventListener('click', () => {
          modal.removeAttribute('data-noclose');
          ui.hideModal();
          ui.toast('Директория Control сохранена', 'success');
        });
      } else {
        confirmBtn.disabled = false;
        confirmBtn.innerHTML = '<span>Начать работу</span><i class="ti ti-arrow-right"></i>';
        ui.toast('Ошибка: ' + r.error, 'err');
      }
    });

  } catch (_) { /* ignore */ }
}

// ── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  // Force-reset modal overlay to clean state (fixes stuck overlay after dev reloads)
  const overlay = document.getElementById('modal-overlay');
  overlay.classList.remove('visible');
  overlay.classList.add('hidden');
  const modal = document.getElementById('modal');
  modal.removeAttribute('data-noclose');
  if (window._hideModalTimer) clearTimeout(window._hideModalTimer);

  // Window controls
  document.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const a = btn.dataset.action;
      if (a === 'minimize') window.api.minimize();
      else if (a === 'maximize') window.api.maximize();
      else if (a === 'close') window.api.close();
    });
  });

  renderSidebar();
  updateStatusBar({ running: false });
  renderHome();
  document.querySelector('.nav[data-page="home"]')?.classList.add('active');

  // First launch check — show setup wizard before loading data
  await checkFirstLaunch();

  // Load data
  try {
    const [status, ver, appVer] = await Promise.all([
      window.api.flowseal.getStatus(),
      window.api.flowseal.getVersion(),
      window.api.getAppVersion?.(),
    ]);
    zapretRunning = status.running;
    updateStatusBar(status);
    homeState.running = status.running;
    homeState.external = status.external || false;
    homeState.appVersion = appVer || '1.0.0';
    homeState.flowsealVersion = ver.version || '0.0.0';
    // Banner-only update — stats load async via loadHomeStats() from renderHome()
    updateHomeStatus({ instant: true });
    window.api.flowseal.onStatusChange(async s => {
      const prev = zapretRunning;
      zapretRunning = s.running;
      updateStatusBar(s);
      homeState.running = s.running;
      homeState.external = s.external || false;
      homeState.status = s.running ? 'on' : 'off';
      updateHomeStatus();
      if (prev !== s.running) {
        try {
          const prefs = await window.api.getSettings();
          if (prefs.notifications !== false) {
            window.api.notify(
              'Control — Zapret',
              s.running ? 'Обход DPI-блокировок запущен' : 'Обход DPI-блокировок остановлен'
            );
          }
        } catch {}
      }
    });
  } catch (_) {}
}

document.addEventListener('DOMContentLoaded', init);
