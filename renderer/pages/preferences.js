// ═══════════════════════════════════════════════════════════════════════════════
// Control — Preferences Page
// ═══════════════════════════════════════════════════════════════════════════════

let appPrefs = {};

async function renderPreferences() {
  const page = document.getElementById('page-preferences');
  page.innerHTML = '';
  page.appendChild(ui.pageHeader('Параметры приложения', 'Настройки поведения и путей Control'));

  if (typeof ZAPRET_PARAMS === 'undefined') {
    const m = document.createElement('div'); m.className = 'msg msg-warn';
    m.innerHTML = '<i class="ti ti-alert-triangle"></i><span>Настройки не загружены. Перезапустите приложение.</span><button class="msg-copy" title="Копировать"><i class="ti ti-copy"></i></button>';
    addMsgCopy(m);
    page.appendChild(m);
    return;
  }

  try { appPrefs = await window.api.getSettings(); }
  catch { appPrefs = {}; }

  // ── Section: General ─────────────────────────────────────────────────────
  const sec1 = buildSection('Основные', 'Запуск и поведение программы', [
    { icon: 'rocket', label: 'Автозапуск с Windows',
      desc: 'Автоматический запуск Control при входе в систему (реестр HKCU\\Run).',
      ctl: ui.prefSwitch(appPrefs.autoStart, v => { appPrefs.autoStart = v; savePrefs(true); }) },
    { icon: 'minimize', label: 'Запускать свёрнутым',
      desc: 'При автозагрузке запускаться сразу в трей, без показа окна.',
      ctl: ui.prefSwitch(appPrefs.startMinimized, v => { appPrefs.startMinimized = v; savePrefs(true); }) },
    { icon: 'arrow-bar-to-down', label: 'Сворачивать в трей',
      desc: 'При закрытии окна сворачивать в системный трей. Клик по иконке трея — показать/скрыть.',
      ctl: ui.prefSwitch(appPrefs.minimizeToTray !== false, v => { appPrefs.minimizeToTray = v; savePrefs(true); }) },
    { icon: 'bell', label: 'Системные уведомления',
      desc: 'Показывать уведомления Windows о запуске, остановке и ошибках Zapret.',
      ctl: ui.prefSwitch(appPrefs.notifications !== false, v => { appPrefs.notifications = v; savePrefs(true); }) },
  ]);
  page.appendChild(sec1);

  // ── Section: Directories ─────────────────────────────────────────────────
  const dirRows = [];

  dirRows.push({
    icon: 'folder', label: 'Папка с версиями',
    desc: 'Директория, в которой хранятся установленные версии Zapret.',
    ctl: ui.prefPathInput(appPrefs.controlDir || '', async () => {
      const p = await window.api.selectFolder?.();
      return p;
    }, (p) => {
      appPrefs.controlDir = p;
      savePrefs(true);
    }),
  });

  // Active version row — custom badge + link
  const activeCtl = document.createElement('div');
  activeCtl.className = 'pref-ctl';
  const activeInner = document.createElement('div');
  activeInner.className = 'pref-version-group';
  activeInner.innerHTML = `
    <span class="badge ${appPrefs.selectedVersion ? 'badge-accent' : 'badge-gray'}">${appPrefs.selectedVersion || 'Не выбрана'}</span>
    <a class="pref-link" data-page="versions">
      <i class="ti ti-external-link"></i>
      <span>Управление</span>
    </a>`;
  activeInner.querySelector('[data-page]').addEventListener('click', (e) => {
    e.preventDefault();
    navigate('versions');
  });
  activeCtl.appendChild(activeInner);

  dirRows.push({
    icon: 'box', label: 'Активная версия',
    desc: 'Выберите версию на вкладке «Версии». Активная версия используется для запуска.',
    ctl: activeCtl,
  });

  const sec2 = buildSection('Директории', 'Пути к установленным версиям Zapret', dirRows);
  page.appendChild(sec2);

  // ── Advanced (collapsible) ────────────────────────────────────────────────
  const advWrap = document.createElement('div');
  advWrap.className = 'pref-adv';
  advWrap.innerHTML = `
    <button class="pref-adv-toggle">
      <i class="ti ti-chevron-right pref-adv-chevron"></i>
      <span>Ручная установка</span>
      <span class="pref-adv-sub">укажите путь вручную</span>
    </button>
    <div class="pref-adv-body">
      <div class="pref-adv-inner"></div>
    </div>`;

  const advBody = advWrap.querySelector('.pref-adv-inner');
  const advRow = buildRows([{
    icon: 'folder-search', label: 'Путь к Flowseal (вручную)',
    desc: 'Корневая папка ручной установки Zapret (содержит bin/winws.exe). Заменяет выбор версии из списка.',
    ctl: ui.prefPathInput(appPrefs.flowsealPath || '', async () => {
      const p = await window.api.selectFolder?.();
      return p;
    }, (p) => {
      appPrefs.flowsealPath = p;
      savePrefs(true);
    }),
  }]);
  advBody.appendChild(advRow);

  let advOpen = false;
  const toggleBtn = advWrap.querySelector('.pref-adv-toggle');
  const chevron = advWrap.querySelector('.pref-adv-chevron');
  const collapseBody = advWrap.querySelector('.pref-adv-body');

  toggleBtn.addEventListener('click', () => {
    advOpen = !advOpen;
    chevron.style.transform = advOpen ? 'rotate(90deg)' : '';
    collapseBody.classList.toggle('open', advOpen);
  });

  page.appendChild(advWrap);
}

// ── Section builder ─────────────────────────────────────────────────────────

function buildSection(title, desc, rows) {
  const sec = document.createElement('div');
  sec.className = 'pref-section';

  const header = document.createElement('div');
  header.className = 'pref-section-h';
  header.innerHTML = `<h3>${title}</h3><p>${desc}</p>`;
  sec.appendChild(header);

  const body = document.createElement('div');
  body.className = 'pref-section-b';
  body.appendChild(buildRows(rows));
  sec.appendChild(body);

  return sec;
}

function buildRows(rows) {
  const wrap = document.createElement('div');
  wrap.className = 'pref-rows';

  rows.forEach((r, i) => {
    const row = document.createElement('div');
    row.className = 'pref-row';
    row.style.setProperty('--i', i);

    // Icon
    const iconDiv = document.createElement('div');
    iconDiv.className = 'pref-row-icon';
    iconDiv.innerHTML = `<i class="ti ti-${r.icon}"></i>`;
    row.appendChild(iconDiv);

    // Body
    const body = document.createElement('div');
    body.className = 'pref-row-body';
    const lbl = document.createElement('div');
    lbl.className = 'pref-row-lbl';
    lbl.textContent = r.label;
    body.appendChild(lbl);
    const desc = document.createElement('div');
    desc.className = 'pref-row-desc';
    desc.textContent = r.desc;
    body.appendChild(desc);
    row.appendChild(body);

    // Control
    if (r.ctl) {
      const ctl = document.createElement('div');
      ctl.className = 'pref-ctl';
      ctl.appendChild(r.ctl);
      row.appendChild(ctl);
    }

    wrap.appendChild(row);
  });

  return wrap;
}

async function savePrefs(silent) {
  try {
    await window.api.setSettings(appPrefs);
    if (!silent) ui.toast('Настройки сохранены', 'success');
  } catch { ui.toast('Ошибка сохранения настроек', 'err'); }
}

function addMsgCopy(el) {
  const btn = el.querySelector('.msg-copy');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const text = el.querySelector('span')?.textContent || el.textContent || '';
    navigator.clipboard.writeText(text);
    btn.innerHTML = '<i class="ti ti-check"></i>';
    setTimeout(() => { btn.innerHTML = '<i class="ti ti-copy"></i>'; }, 1500);
  });
}
