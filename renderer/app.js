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

// Copy button for message boxes (.msg) — used by warn/info notices
ui.msgCopy = (el) => {
  const btn = el?.querySelector?.('.msg-copy');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const text = el.querySelector('span')?.textContent || el.textContent || '';
    navigator.clipboard.writeText(text).then(() => {
      btn.innerHTML = '<i class="ti ti-check"></i>';
      setTimeout(() => { btn.innerHTML = '<i class="ti ti-copy"></i>'; }, 1500);
    }).catch(() => { /* clipboard unavailable */ });
  });
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

// ── First Launch Setup Wizard (redesigned, multi-step) ───────────────────────
//
// Steps:
//   1. Добро пожаловать + проверки окружения (админ / WinDivert / интернет)
//   2. Расположение Zapret (выбор папки, авто-поиск существующей установки)
//   3. Параметры запуска (поведение при закрытии)
//   4. Итоговая сводка
//   5. Готово

const SETUP_STEPS = [
  { icon: 'shield-lock', title: 'Проверка системы' },
  { icon: 'folder', title: 'Расположение Zapret' },
  { icon: 'adjustments-horizontal', title: 'Параметры запуска' },
  { icon: 'list-check', title: 'Сводка' },
];

async function checkFirstLaunch() {
  try {
    const status = await window.api.control.getSetupStatus();
    if (status.done) return;
    await showSetupWizard();
  } catch (_) { /* ignore */ }
}

// The wizard itself — separated from the auto-check so it can be re-opened for
// testing. From the DevTools console:  showSetupWizard()
async function showSetupWizard() {
  try {
    const overlay = document.getElementById('modal-overlay');
    const modal = document.getElementById('modal');
    overlay.classList.remove('hidden');

    modal.innerHTML = '';
    modal.setAttribute('data-noclose', 'true');
    modal.setAttribute('data-setup', '');

    const b = document.createElement('div'); b.className = 'modal-b setup-body';

    // App logo (same image as the About page) — loaded via preload so it works in dev & prod
    const iconDataUrl = window.api.getAssetDataUrl?.('app-icon.png') || '';

    // Wizard state
    const state = {
      step: 0,
      checks: null,
      controlDir: '',
      existingPath: null,
      minimizeToTray: true,
      notifications: true,
      restoreState: true,
    };

    // ── Helpers ─────────────────────────────────────────────────────────────
    function setBody(html) {
      b.innerHTML = html;
      requestAnimationFrame(() => b.classList.add('setup-visible'));
    }

    function renderHeader() {
      const dots = SETUP_STEPS.map((s, i) => `
        <div class="setup-step${i === state.step ? ' active' : ''}${i < state.step ? ' done' : ''}" data-setup-step="${i}">
          <div class="setup-step-dot"><i class="ti ti-${s.icon}"></i></div>
          <span class="setup-step-label">${s.title}</span>
        </div>`).join('');
      return `<div class="setup-progress">${dots}</div>`;
    }

    function renderFooter(back, next, nextDisabled) {
      const backBtn = back
        ? `<button class="btn btn-g setup-back" id="setup-back-btn"><i class="ti ti-arrow-left"></i> Назад</button>`
        : '';
      const nextBtn = next
        ? `<button class="btn btn-p setup-go" id="setup-next-btn" ${nextDisabled ? 'disabled' : ''}>${next} <i class="ti ti-arrow-right"></i></button>`
        : '';
      return `<div class="setup-footer">${backBtn}${nextBtn}</div>`;
    }

    // ── Step 0: Welcome + environment checks ────────────────────────────────
    async function stepChecks() {
      setBody(`
        <div class="setup-hero">
          <div class="setup-logo">
            <div class="setup-logo-inner">
              <img src="${iconDataUrl || 'app-asset://app-icon.png'}" alt="Control" class="setup-logo-img"
                   onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
              <i class="ti ti-shield-lock" style="display:none"></i>
            </div>
          </div>
          <h1 class="setup-title">Добро пожаловать в <span class="setup-title-accent">Control</span></h1>
          <p class="setup-desc">Графическая оболочка для управления Zapret — обхода DPI-блокировок.<br>Сейчас мы проверим готовность системы и настроим Control.</p>
        </div>
        <div id="setup-checks"></div>
        ${renderFooter(false, 'Далее', true)}
      `);

      const checksEl = b.querySelector('#setup-checks');
      checksEl.innerHTML = '<div style="display:flex;align-items:center;gap:10px;padding:12px 16px;color:var(--text-tertiary);"><div class="spin" style="width:16px;height:16px;border-width:2px;"></div> Проверка системы...</div>';

      const checks = await window.api.setup.runChecks();
      state.checks = checks;

      const defDir = await window.api.setup.defaultDir();
      state.controlDir = defDir || '';

      const items = [
        { ok: checks.admin, icon: 'shield', title: 'Права администратора',
          desc: checks.admin ? 'Контроль запущен от имени администратора — WinDivert сможет работать.' : 'Запустите Control от имени администратора (ПКМ → «Запуск от имени администратора»). Без этого WinDivert и winws.exe не будут работать.' },
        { ok: checks.winDivert, icon: 'plug', title: 'Драйвер WinDivert',
          desc: checks.winDivert ? 'Драйвер установлен.' : 'WinDivert ещё не установлен — он появится вместе с версией Zapret, или его можно установить во вкладке «Диагностика».' },
        { ok: checks.internet, icon: 'world', title: 'Подключение к интернету',
          desc: checks.internet ? 'Интернет работает.' : 'Интернет не обнаружен. Для скачивания версий Zapret и обновлений нужно соединение.' },
        { ok: checks.dns, icon: 'zoom-question', title: 'DNS',
          desc: checks.dns ? 'DNS-запросы выполняются.' : 'Проблемы с DNS — сайты могут открываться медленно или не открываться.' },
        { ok: !checks.existing.running, icon: 'ban', title: 'Конфликты процессов',
          desc: checks.existing.running ? 'Запущен посторонний экземпляр winws.exe. Остановите его (taskkill /IM winws.exe /F) или Control сделает это при старте.' : 'Посторонних процессов Zapret не найдено.' },
      ];

      checksEl.innerHTML = '';
      items.forEach((it, i) => {
        const el = document.createElement('div');
        el.className = 'setup-check';
        el.style.animation = `pgIn 250ms ease ${i * 90}ms both`;
        el.innerHTML = `
          <div class="setup-check-ico ${it.ok ? 'ok' : 'warn'}">
            <i class="ti ti-${it.ok ? 'circle-check' : 'alert-triangle'}"></i>
          </div>
          <div class="setup-check-body">
            <div class="setup-check-title">${it.title}</div>
            <div class="setup-check-desc">${it.desc}</div>
          </div>`;
        checksEl.appendChild(el);
      });

      const nextBtn = b.querySelector('#setup-next-btn');
      nextBtn.disabled = false;
      nextBtn.addEventListener('click', () => { state.step = 1; stepLocation(); });
    }

    // ── Step 1: Location ────────────────────────────────────────────────────
    async function stepLocation() {
      const existing = state.checks?.existing?.installPath;
      const warn = existing
        ? `<div class="setup-warn" style="margin-bottom:16px;">
             <i class="ti ti-folder-check"></i>
             <div><strong>Найден установленный Zapret</strong>
             <p class="setup-warn-path">${existing}</p>
             <p>Control может использовать свою отдельную папку или указать эту — версии всё равно скачиваются в папку Control.</p></div>
           </div>`
        : '';
      setBody(`
        <div class="setup-hero setup-hero-sm">
          <h1 class="setup-title">Расположение Zapret</h1>
          <p class="setup-desc">Выберите папку, в которой Control будет хранить установленные версии Zapret.</p>
        </div>
        ${warn}
        <div class="setup-folder">
          <div class="setup-folder-label"><i class="ti ti-folder"></i><span>Папка для хранения версий</span></div>
          <div class="setup-folder-row">
            <div class="setup-folder-path" id="setup-path-display">
              <span class="setup-path-placeholder">Папка не выбрана</span>
            </div>
            <button class="setup-folder-btn" id="setup-browse-btn" title="Выбрать папку"><i class="ti ti-folder-open"></i></button>
          </div>
          <div class="setup-hint">Рекомендуется выбрать папку на диске с достаточным свободным местом</div>
        </div>
        ${renderFooter(true, 'Далее', true)}
      `);

      const display = b.querySelector('#setup-path-display');
      const setPath = (p) => {
        state.controlDir = p;
        display.innerHTML = `<span class="setup-path-value">${p}</span>`;
        display.classList.add('has-value');
        b.querySelector('#setup-next-btn').disabled = false;
      };

      if (state.controlDir) setPath(state.controlDir);

      b.querySelector('#setup-browse-btn').addEventListener('click', async () => {
        const dir = await window.api.selectFolder();
        if (dir) setPath(dir);
      });

      b.querySelector('#setup-back-btn').addEventListener('click', () => { state.step = 0; stepChecks(); });
      b.querySelector('#setup-next-btn').addEventListener('click', () => { state.step = 2; stepOptions(); });
    }

    // ── Step 2: Launch options ──────────────────────────────────────────────
    function stepOptions() {
      setBody(`
        <div class="setup-hero setup-hero-sm">
          <h1 class="setup-title">Параметры запуска</h1>
          <p class="setup-desc">Выберите, как Control должен вести себя при запуске и закрытии Windows.</p>
        </div>
        <div class="setup-opts">
          <label class="setup-opt">
            <div class="setup-opt-body">
              <div class="setup-opt-title">Восстанавливать защиту после перезагрузки</div>
              <div class="setup-opt-desc">Если Zapret работал в момент завершения Control, он включится автоматически после перезагрузки.</div>
            </div>
            <input type="checkbox" id="opt-restore" ${state.restoreState ? 'checked' : ''}>
          </label>
          <label class="setup-opt">
            <div class="setup-opt-body">
              <div class="setup-opt-title">Сворачивать в трей при закрытии</div>
              <div class="setup-opt-desc">Кнопка «закрыть» прячет Control в системный трей вместо выхода. Клик по иконке трея — показать/скрыть.</div>
            </div>
            <input type="checkbox" id="opt-tray" ${state.minimizeToTray ? 'checked' : ''}>
          </label>
          <label class="setup-opt">
            <div class="setup-opt-body">
              <div class="setup-opt-title">Системные уведомления</div>
              <div class="setup-opt-desc">Показывать уведомления Windows о запуске, остановке и ошибках Zapret.</div>
            </div>
            <input type="checkbox" id="opt-notify" ${state.notifications ? 'checked' : ''}>
          </label>
        </div>
        ${renderFooter(true, 'Далее', false)}
      `);

      const read = () => {
        state.restoreState = b.querySelector('#opt-restore').checked;
        state.minimizeToTray = b.querySelector('#opt-tray').checked;
        state.notifications = b.querySelector('#opt-notify').checked;
      };
      b.querySelectorAll('input[type=checkbox]').forEach(c => c.addEventListener('change', read));

      b.querySelector('#setup-back-btn').addEventListener('click', () => { state.step = 1; stepLocation(); });
      b.querySelector('#setup-next-btn').addEventListener('click', () => { read(); state.step = 3; stepSummary(); });
    }

    // ── Step 3: Summary ─────────────────────────────────────────────────────
    function stepSummary() {
      const chk = state.checks || {};
      const rows = [
        { icon: 'folder', label: 'Папка версий', value: state.controlDir || '—' },
        { icon: 'shield', label: 'Права администратора', value: chk.admin ? 'Есть' : 'Нет — запустите от админа', ok: chk.admin },
        { icon: 'plug', label: 'WinDivert', value: chk.winDivert ? 'Установлен' : 'Будет установлен вместе с Zapret' },
        { icon: 'world', label: 'Интернет', value: chk.internet ? 'Работает' : 'Не обнаружен' },
        { icon: 'history', label: 'Восстановление защиты', value: state.restoreState ? 'Включено' : 'Выключено' },
        { icon: 'bell', label: 'Уведомления', value: state.notifications ? 'Включены' : 'Выключены' },
      ];
      const rowsHtml = rows.map((r, i) => `
        <div class="setup-sum-row" style="animation:pgIn 200ms ease ${i * 50}ms both;">
          <i class="ti ti-${r.icon}"></i>
          <span class="setup-sum-label">${r.label}</span>
          <span class="setup-sum-value">${r.value}</span>
        </div>`).join('');

      setBody(`
        <div class="setup-hero setup-hero-sm">
          <h1 class="setup-title">Готово к работе</h1>
          <p class="setup-desc">Проверьте итоговые настройки. После нажатия «Завершить» можно скачивать версии Zapret.</p>
        </div>
        <div class="setup-summary">${rowsHtml}</div>
        ${renderFooter(true, 'Завершить', false)}
      `);

      b.querySelector('#setup-back-btn').addEventListener('click', () => { state.step = 2; stepOptions(); });
      b.querySelector('#setup-next-btn').addEventListener('click', finishWizard);
    }

    // ── Finish: persist + success screen ────────────────────────────────────
    async function finishWizard() {
      const btn = b.querySelector('#setup-next-btn');
      btn.disabled = true;
      btn.innerHTML = '<span class="spin" style="width:18px;height:18px;border-width:2px;border-top-color:#111;"></span><span>Сохранение...</span>';

      const r = await window.api.setup.apply({
        controlDir: state.controlDir,
        minimizeToTray: state.minimizeToTray,
        notifications: state.notifications,
        restoreState: state.restoreState,
      });

      if (!r.ok) {
        btn.disabled = false;
        btn.innerHTML = 'Завершить <i class="ti ti-arrow-right"></i>';
        ui.toast('Ошибка: ' + (r.error || 'неизвестная'), 'err');
        return;
      }

      b.classList.add('setup-success');
      setBody(`
        <div class="setup-hero">
          <div class="setup-logo setup-logo-done">
            <div class="setup-logo-inner">
              <img src="${iconDataUrl || 'app-asset://app-icon.png'}" alt="Control" class="setup-logo-img"
                   onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
              <i class="ti ti-shield-lock" style="display:none"></i>
            </div>
          </div>
          <h1 class="setup-title" style="color:var(--accent);">Всё готово!</h1>
          <p class="setup-desc">Настройка завершена. Дальше мы проведём вас по шагам — чтобы Zapret заработал, осталось совсем немного.</p>
        </div>
        <div class="setup-footer" style="border:none;padding-top:8px;">
          <button class="btn btn-p setup-go" id="setup-dismiss-btn"><span>Начать</span><i class="ti ti-arrow-right"></i></button>
        </div>
      `);
      b.querySelector('#setup-dismiss-btn').addEventListener('click', () => {
        modal.removeAttribute('data-noclose');
        ui.hideModal();
        ui.toast('Настройка Control завершена', 'success');
        // Give the modal close animation a moment, then guide the user step by step
        setTimeout(startGuidedTour, 450);
      });
    }

    // ── Start ──
    b.classList.add('setup-visible');
    modal.appendChild(b);
    requestAnimationFrame(() => overlay.classList.add('visible'));
    await stepChecks();

  } catch (_) { /* ignore */ }
}

// Expose the wizard globally for manual testing from the DevTools console:
window.showSetupWizard = showSetupWizard;

// ── Guided Tour ────────────────────────────────────────────────────────────────
// First-run walkthrough: darkens everything except the current step's target and
// shows a tooltip next to it, walking the user through the whole setup.

const GT_STEPS = [
  {
    page: 'settings',
    icon: 'shield',
    title: 'Выбор стратегии',
    text: 'Нажмите на карточку с подходящей стратегией. Не знаете какую выбрать? Начните с <strong>Default</strong>.',
    target: () => document.querySelector('.strategy-list') || document.querySelector('.set-body'),
    side: 'bottom',
  },
  {
    page: 'settings',
    icon: 'filter',
    title: 'Фильтры',
    text: 'Тонкая настройка обхода для отдельных приложений. Можно оставить как есть.',
    target: () => document.querySelector('.set-nav-item[data-id="filters"]'),
    side: 'right',
  },
  {
    page: 'settings',
    icon: 'power',
    title: 'Автозапуск',
    text: 'Включите переключатель — Zapret будет запускаться вместе с Windows.',
    target: () => document.querySelector('.set-nav-item[data-id="autostart"]'),
    side: 'right',
  },
  {
    page: 'versions',
    icon: 'cloud-download',
    title: 'Установка версии',
    text: 'Нажмите «Скачать» у свежей версии. Без неё обход работать не будет.',
    target: () => document.querySelector('#ver-list'),
    side: 'bottom',
  },
  {
    page: 'home',
    icon: 'player-play',
    title: 'Запуск защиты',
    text: 'Нажмите «Запустить», чтобы включить обход DPI-блокировок.',
    target: () => document.querySelector('.home-banner .btn-p') || document.querySelector('.home-banner'),
    side: 'bottom',
  },
  {
    page: 'home',
    icon: 'circle-check',
    title: 'Готово!',
    text: 'Control настроен. Если что-то пойдёт не так — загляните в «Диагностику».',
    side: null,
  },
];

const gt = {
  active: false,
  index: 0,
  raf: 0,
  root: null,
  scrimPath: null,
  hole: null,
  tip: null,
  target: null,
  _tipShown: false,
};

function startGuidedTour() {
  if (gt.active) return;
  gt.active = true;
  gt.index = 0;
  gt._tipShown = false;

  // Container — fixed over everything, non-interactive by default.
  // The scrim and tooltip re-enable pointer events on themselves.
  const root = document.createElement('div');
  root.className = 'gt-root';
  root.innerHTML = `
    <svg class="gt-scrim" width="100%" height="100%"><path fill="rgba(8,10,16,0.62)" fill-rule="evenodd"></path></svg>
    <div class="gt-hole"></div>
    <div class="gt-tip" data-side="bottom"></div>`;
  document.body.appendChild(root);
  gt.root = root;
  gt.scrimPath = root.querySelector('.gt-scrim path');
  gt.hole = root.querySelector('.gt-hole');
  gt.tip = root.querySelector('.gt-tip');

  requestAnimationFrame(() => root.classList.add('gt-on'));
  gtEnterStep(0);
}

function gtStop() {
  if (!gt.active) return;
  gt.active = false;
  cancelAnimationFrame(gt.raf);
  if (gt.root) {
    const root = gt.root;
    root.classList.remove('gt-on');
    root.addEventListener('transitionend', function te() {
      root.removeEventListener('transitionend', te);
      root.remove();
    });
    // Fallback removal in case transitionend never fires
    setTimeout(() => root.remove(), 400);
  }
  gt.root = null;
  gt.tip = null;
}

function gtEnterStep(i) {
  gt.index = i;
  gt._scrolled = false;
  gt._tipShown = false;
  const step = GT_STEPS[i];
  if (!step) { gtStop(); return; }

  // Navigate to the required page (renders async — the loop waits for the target)
  if (step.page) navigate(step.page);

  // Build tooltip content
  const total = GT_STEPS.length;
  const dots = GT_STEPS.map((_, d) => `<span class="gt-dot${d === i ? ' on' : ''}"></span>`).join('');
  const back = i > 0 ? `<button class="btn btn-g btn-sm gt-tip-back"><i class="ti ti-arrow-left"></i> Назад</button>` : '';
  const isLast = i === total - 1;

  gt.tip.innerHTML = `
    <button class="gt-tip-x" title="Пропустить тур"><i class="ti ti-x"></i></button>
    <div class="gt-tip-head">
      <div class="gt-tip-ico"><i class="ti ti-${step.icon}"></i></div>
      <div class="gt-tip-titles">
        <div class="gt-tip-step">Шаг ${i + 1} из ${total}</div>
        <div class="gt-tip-title">${step.title}</div>
      </div>
    </div>
    <div class="gt-tip-text">${step.text}</div>
    <div class="gt-tip-dots">${dots}</div>
    <div class="gt-tip-actions">
      ${back}
      <button class="btn btn-p btn-sm gt-tip-next">${isLast ? 'Завершить' : 'Далее'} <i class="ti ti-arrow-right"></i></button>
    </div>`;

  gt.tip.querySelector('.gt-tip-x').addEventListener('click', gtStop);
  const backBtn = gt.tip.querySelector('.gt-tip-back');
  if (backBtn) backBtn.addEventListener('click', () => gtEnterStep(i - 1));
  gt.tip.querySelector('.gt-tip-next').addEventListener('click', () => {
    if (isLast) gtStop();
    else gtEnterStep(i + 1);
  });

  // Start the position loop. The tooltip stays hidden until the target is
  // actually in the viewport, so page transitions read as intentional.
  cancelAnimationFrame(gt.raf);
  gtLoop();
}

function gtLoop() {
  if (!gt.active) return;
  const step = GT_STEPS[gt.index];
  if (!step) return;

  const target = step.target ? step.target() : null;
  gt.target = target;

  // Scroll the target into view once, when it first appears
  if (target && !gt._scrolled) {
    gt._scrolled = true;
    try { target.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' }); } catch (_) { /* ignore */ }
  }

  const r = target ? target.getBoundingClientRect() : null;
  const VW = window.innerWidth, VH = window.innerHeight;
  const inView = r && r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < VH && r.right > 0 && r.left < VW;

  // Scrim: darken everything, cut a transparent hole around the target.
  // The hole tracks the element every frame (no CSS transition), so it stays
  // glued to it during scroll and works identically in windowed & fullscreen.
  if (inView) {
    const pad = 6;
    const x = Math.max(0, r.left - pad), y = Math.max(0, r.top - pad);
    const x2 = Math.min(VW, r.right + pad), y2 = Math.min(VH, r.bottom + pad);
    gt.scrimPath.setAttribute('d', `M0,0 H${VW} V${VH} H0 Z M${x},${y} H${x2} V${y2} H${x} Z`);
    gt.hole.style.left = x + 'px';
    gt.hole.style.top = y + 'px';
    gt.hole.style.width = (x2 - x) + 'px';
    gt.hole.style.height = (y2 - y) + 'px';
    gt.hole.classList.add('gt-hole-on');
  } else {
    gt.scrimPath.setAttribute('d', `M0,0 H${VW} V${VH} H0 Z`);
    gt.hole.classList.remove('gt-hole-on');
  }

  // Tooltip visibility: the center (finish) step is always shown, everything
  // else waits until its target is on screen.
  const showTip = !step.target || inView;
  if (showTip) {
    gt.tip.classList.remove('gt-tip-off');
    if (!gt._tipShown) {
      gt._tipShown = true;
      gt.tip.classList.remove('gt-tip-in');
      void gt.tip.offsetWidth;
      gt.tip.classList.add('gt-tip-in');
    }
  } else {
    gt.tip.classList.add('gt-tip-off');
    gt._tipShown = false;
  }

  if (showTip) gtPlaceTip(step, r);

  gt.raf = requestAnimationFrame(gtLoop);
}

function gtPlaceTip(step, r) {
  const tip = gt.tip;
  const tw = tip.offsetWidth, th = tip.offsetHeight;
  const gap = 14, M = 16;
  const VW = window.innerWidth, VH = window.innerHeight;
  const clampV = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));

  let side, left, top;

  if (!r) {
    side = 'center';
    left = (VW - tw) / 2;
    top = (VH - th) / 2;
  } else if (step.side === 'right') {
    // Tabs / small items: place to the right, vertically centered on the item
    side = 'right';
    left = r.right + gap;
    top = r.top + r.height / 2 - th / 2;
    if (left + tw > VW - M) {
      side = 'bottom';
      left = r.left + r.width / 2 - tw / 2;
      top = r.bottom + gap;
      if (top + th > VH - M) { side = 'top'; top = r.top - th - gap; }
    }
  } else {
    // Sections / buttons: place below, horizontally centered on the element
    side = 'bottom';
    left = r.left + r.width / 2 - tw / 2;
    top = r.bottom + gap;
    if (top + th > VH - M) { side = 'top'; top = r.top - th - gap; }
  }

  if (side === 'bottom' || side === 'top') left = clampV(left, M, VW - tw - M);
  top = clampV(top, M, VH - th - M);

  // Arrow points at the element's center
  let ax = 24, ay = 24;
  if (r) {
    if (side === 'bottom' || side === 'top') {
      ax = clampV(r.left + r.width / 2 - left, 22, tw - 22);
    } else if (side === 'right') {
      ay = clampV(r.top + r.height / 2 - top, 22, th - 22);
    }
  }
  tip.style.setProperty('--arrow-x', ax + 'px');
  tip.style.setProperty('--arrow-y', ay + 'px');

  tip.setAttribute('data-side', side);
  tip.style.left = left + 'px';
  tip.style.top = top + 'px';
}

// Expose for manual testing:  startGuidedTour()
window.startGuidedTour = startGuidedTour;

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
    homeState.appVersion = appVer || '1.0.1';
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
