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
    ui.msgCopy(m);
    page.appendChild(m);
    return;
  }

  try { appPrefs = await window.api.getSettings(); }
  catch { appPrefs = {}; }

  // ── Section: General ─────────────────────────────────────────────────────
  const sec1 = buildSection('Основные', 'Запуск и поведение программы', [
    { icon: 'arrow-bar-to-down', label: 'Сворачивать в трей',
      desc: 'При закрытии окна сворачивать в системный трей. Клик по иконке трея — показать/скрыть.',
      ctl: ui.prefSwitch(appPrefs.minimizeToTray !== false, v => { appPrefs.minimizeToTray = v; savePrefs(true); }) },
    { icon: 'bell', label: 'Системные уведомления',
      desc: 'Показывать уведомления Windows о запуске, остановке и ошибках Zapret.',
      ctl: ui.prefSwitch(appPrefs.notifications !== false, v => { appPrefs.notifications = v; savePrefs(true); }) },
    { icon: 'history', label: 'Восстанавливать защиту после перезагрузки',
      desc: 'Если Zapret работал в момент закрытия Control, при следующем запуске защита включится автоматически.',
      ctl: ui.prefSwitch(appPrefs.restoreState, v => { appPrefs.restoreState = v; savePrefs(true); }) },
    { icon: 'shield-check', label: 'Автоперезапуск winws.exe',
      desc: 'Если процесс обхода неожиданно упадёт, Control перезапустит его сам (до 3 попыток).',
      ctl: ui.prefSwitch(appPrefs.watchdogEnabled !== false, v => { appPrefs.watchdogEnabled = v; savePrefs(true); }) },
    { icon: 'power', label: 'Не останавливать защиту при выходе',
      desc: 'Оставить winws.exe работать после полного выхода из Control (через трей).',
      ctl: ui.prefSwitch(appPrefs.keepRunningOnExit, v => { appPrefs.keepRunningOnExit = v; savePrefs(true); }) },
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

  // ── Section: Backup ──────────────────────────────────────────────────────
  const backupSec = buildSection('Резервное копирование', 'Экспорт и импорт настроек, конфигурации и пользовательских списков', []);
  const backupRow = document.createElement('div');
  backupRow.className = 'pref-row';
  backupRow.style.borderBottom = 'none';
  const backupBody = document.createElement('div');
  backupBody.className = 'pref-row-body';
  backupBody.innerHTML = `
    <div class="pref-row-desc" style="margin-bottom:10px;">
      Резервная копия содержит настройки приложения, выбранную стратегию, фильтры и пользовательские списки.
      Файл можно переносить между компьютерами или восстановить после переустановки.
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;">
      <button class="btn btn-p btn-sm" id="pref-backup-export"><i class="ti ti-download"></i> Экспортировать</button>
      <button class="btn btn-s btn-sm" id="pref-backup-import"><i class="ti ti-upload"></i> Импортировать</button>
    </div>
    <div style="margin-top:10px;font-size:12px;color:var(--text-tertiary);">
      Помимо этого, Control хранит автоматическую копию настроек (settings.json.bak) для восстановления при повреждении конфигурации.
    </div>`;
  backupRow.appendChild(backupBody);
  backupSec.querySelector('.pref-section-b').appendChild(backupRow);
  page.appendChild(backupSec);

  backupSec.querySelector('#pref-backup-export').addEventListener('click', async () => {
    const btn = backupSec.querySelector('#pref-backup-export');
    btn.disabled = true; btn.innerHTML = '<span class="spin" style="width:14px;height:14px;border-width:2px;"></span> Экспорт...';
    const r = await window.api.backup.export();
    btn.disabled = false; btn.innerHTML = '<i class="ti ti-download"></i> Экспортировать';
    if (r.ok) ui.toast('Резервная копия сохранена', 'success');
    else if (!r.canceled) ui.toast('Ошибка экспорта: ' + (r.error || 'неизвестная'), 'err');
  });

  backupSec.querySelector('#pref-backup-import').addEventListener('click', async () => {
    const okBtn = ui.btn('Импортировать', { variant: 'p', onclick: async () => { ui.hideModal(); doImport(); } });
    const cancelBtn = ui.btn('Отмена', { variant: 's', onclick: () => ui.hideModal() });
    ui.modal('Импорт резервной копии', `
      <div style="text-align:center;padding:16px 0;">
        <i class="ti ti-alert-triangle" style="font-size:40px;color:var(--orange);margin-bottom:12px;display:block;"></i>
        <p style="font-size:15px;color:var(--text);margin-bottom:4px;">Импорт заменит текущие настройки Control.</p>
        <p style="font-size:13px;color:var(--text-tertiary);">Текущие настройки и списки будут перезаписаны данными из резервной копии.</p>
      </div>`,
      { footer: [cancelBtn, okBtn] }
    );
    async function doImport() {
      const r = await window.api.backup.import();
      if (r.ok) {
        ui.toast('Настройки импортированы. Перезапустите Control.', 'success');
        setTimeout(() => window.location.reload(), 1200);
      } else if (!r.canceled) {
        ui.toast('Ошибка импорта: ' + (r.error || 'неизвестная'), 'err');
      }
    }
  });

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
