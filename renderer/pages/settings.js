// ═══════════════════════════════════════════════════════════════════════════════
// Control — Settings Page (Flowseal)
// ═══════════════════════════════════════════════════════════════════════════════

let flowsealCfg = {};

function renderSettings() {
  const page = document.getElementById('page-settings');
  page.innerHTML = '';
  page.appendChild(ui.pageHeader('Настройки Zapret', 'Управление стратегиями, фильтрами и списками Flowseal'));

  if (typeof ZAPRET_PARAMS === 'undefined') {
    const m = document.createElement('div'); m.className = 'msg msg-warn';
    m.innerHTML = '<i class="ti ti-alert-triangle"></i><span>Параметры не загружены</span><button class="msg-copy" title="Копировать"><i class="ti ti-copy"></i></button>';
    addMsgCopy(m);
    page.appendChild(m);
    return;
  }

  loadConfig().then(() => {
    // Tabs
    const layout = document.createElement('div'); layout.className = 'set-layout';
    const nav = document.createElement('div'); nav.className = 'set-nav';
    const body = document.createElement('div'); body.className = 'set-body';

    const tabs = [
      { id: 'strategy', label: 'Стратегия', icon: 'shield', render: renderStrategy },
      { id: 'filters', label: 'Фильтры', icon: 'filter', render: renderFilters },
      { id: 'lists', label: 'Списки', icon: 'list', render: renderLists },
      { id: 'autostart', label: 'Автозапуск', icon: 'power', render: renderAutostart },
    ];

    let activeTab = 'strategy';

    function switchTab(id) {
      activeTab = id;
      nav.querySelectorAll('.set-nav-item').forEach(el => el.classList.toggle('active', el.dataset.id === id));
      body.innerHTML = '';
      const tab = tabs.find(t => t.id === id);
      if (tab) tab.render();
    }

    tabs.forEach(t => {
      const item = document.createElement('div'); item.className = 'set-nav-item';
      if (t.id === activeTab) item.classList.add('active');
      item.dataset.id = t.id;
      item.innerHTML = `<i class="ti ti-${t.icon}"></i><span>${t.label}</span>`;
      item.addEventListener('click', () => switchTab(t.id));
      nav.appendChild(item);
    });

    layout.append(nav, body);
    page.appendChild(layout);

    // Load first tab
    renderStrategy();
  });
}

async function loadConfig() {
  try {
    flowsealCfg = await window.api.flowseal.getConfig();
  } catch { flowsealCfg = defaultConfig(); }
}

async function saveConfig() {
  try {
    await window.api.flowseal.setConfig(flowsealCfg);
  } catch { /* ignore */ }
}

// ── Tab: Strategy ─────────────────────────────────────────────────────────────

async function renderStrategy() {
  const body = document.querySelector('.set-body');
  if (!body) return;

  const sec = secEl('Стратегия обхода', 'Выберите стратегию DPI-обхода. Каждая стратегия — это готовый набор параметров для winws.exe.');

  // Strategy list
  const listWrap = document.createElement('div'); listWrap.className = 'strategy-list';

  let strategies = [];
  try {
    strategies = await window.api.flowseal.getStrategies();
  } catch { /* ignore */ }

  if (!strategies.length) {
    listWrap.innerHTML = '<div class="empty"><i class="ti ti-cloud-off"></i><p>Стратегии не найдены</p><span>Перейдите на вкладку <strong>Версии</strong> и установите или активируйте версию Zapret</span></div>';
    sec.appendChild(listWrap);
    body.appendChild(sec);

    const infoCard = ui.card('О стратегиях', `
      <p><strong>Default</strong> — основная стратегия. Multisplit для TCP, fake для UDP. Рекомендуется.</p>
      <p style="margin-top:8px;"><strong>ALT</strong> — альтернативы Default с другими параметрами фрагментации.</p>
      <p style="margin-top:8px;"><strong>FAKE TLS AUTO</strong> — автоматическая подмена TLS (multidisorder).</p>
      <p style="margin-top:8px;"><strong>SIMPLE FAKE</strong> — упрощённая стратегия, минимальная нагрузка.</p>`);
    body.appendChild(infoCard);
    return;
  }

  // Search/filter input
  const filterWrap = document.createElement('div');
  filterWrap.style.cssText = 'margin:8px 0 4px;position:relative;';
  const filterInput = document.createElement('input');
  filterInput.type = 'text';
  filterInput.placeholder = 'Поиск стратегии...';
  filterInput.style.cssText = 'padding-left:36px;height:40px;';
  const filterIcon = document.createElement('i');
  filterIcon.className = 'ti ti-search';
  filterIcon.style.cssText = 'position:absolute;left:12px;top:50%;transform:translateY(-50%);font-size:18px;color:var(--text-tertiary);pointer-events:none;';
  filterWrap.append(filterIcon, filterInput);
  sec.appendChild(filterWrap);

  function renderFilteredStrategies(query) {
    listWrap.innerHTML = '';
    const q = query.toLowerCase().trim();
    let hasVisible = false;

    strategies.forEach((s, i) => {
      const match = !q || s.label.toLowerCase().includes(q) || s.value.toLowerCase().includes(q) ||
        (s.desc || '').toLowerCase().includes(q);
      if (!match && q) return;
      hasVisible = true;

      const card = document.createElement('div'); card.className = 'strategy-card';
      card.style.setProperty('--i', i);
      const selected = flowsealCfg.strategy === s.value;
      if (selected) card.classList.add('selected');

      const header = document.createElement('div'); header.className = 'strategy-card-h';

      const radio = document.createElement('input'); radio.type = 'radio';
      radio.name = 'strategy'; radio.value = s.value; radio.checked = selected;
      radio.addEventListener('change', () => {
        flowsealCfg.strategy = s.value;
        saveConfig();
        body.querySelectorAll('.strategy-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
      });

      const label = document.createElement('div'); label.className = 'strategy-card-label';
      label.textContent = s.label;

      const tag = document.createElement('span');
      const tagColor = s.value.includes('ALT') ? 'orange' :
        s.value.includes('FAKE') && s.value.includes('TLS') ? 'accent' :
        s.value.includes('FAKE') ? 'accent' :
        s.value.includes('SIMPLE') ? 'gray' :
        s.value === 'general' ? 'accent' : 'orange';
      const tagText = s.value.includes('EXP') ? 'EXP' :
        s.value.includes('FAKE') && s.value.includes('TLS') ? 'TLS AUTO' :
        s.value.includes('FAKE') ? 'FAKE' :
        s.value.includes('SIMPLE') ? 'SIMPLE' :
        s.value === 'general' ? 'STABLE' : 'ALT';
      tag.className = `badge badge-${tagColor}`;
      tag.textContent = tagText;
      label.appendChild(tag);

      header.append(radio, label);
      card.appendChild(header);

      const desc = document.createElement('div'); desc.className = 'strategy-card-desc';
      desc.textContent = s.desc || getStrategyFallbackDesc(s.value);
      card.appendChild(desc);

      listWrap.appendChild(card);
    });

    if (!hasVisible) {
      listWrap.innerHTML = '<div class="empty" style="padding:24px;"><i class="ti ti-search-off"></i><p>Ничего не найдено</p><span>Попробуйте изменить запрос</span></div>';
    }
  }

  filterInput.addEventListener('input', () => renderFilteredStrategies(filterInput.value));
  renderFilteredStrategies('');

  sec.appendChild(listWrap);
  body.appendChild(sec);

  const infoCard = ui.card('Как выбрать стратегию?', `
    <p>Начните с <strong>Default</strong>. Если YouTube или Discord работают нестабильно, пробуйте <strong>ALT</strong>, затем <strong>FAKE TLS AUTO</strong>.</p>
    <p style="margin-top:8px;"><strong>SIMPLE FAKE</strong> — для слабых устройств или когда другие дают ошибки.</p>
    <p style="margin-top:8px;"><strong>EXP</strong> — экспериментальная, только если ничего не помогло.</p>`);
  body.appendChild(infoCard);
}

async function renderFilters() {
  const body = document.querySelector('.set-body');
  if (!body) return;

  // Game Filter
  const sec1 = secEl('Игровой фильтр', 'Фильтрация трафика игр. Включает порты 1024-65535 для игрового трафика через IPSet.');

  let currentGame = flowsealCfg.gameFilter || 'disabled';
  try { currentGame = await window.api.flowseal.getGameFilter(); } catch { /* ignore */ }

  sec1.appendChild(ui.formRow('Режим фильтрации игр',
    'Тип игрового трафика для фильтрации. Потребуется перезапуск.',
    ui.select(ZAPRET_PARAMS.gameFilterModes, currentGame, async v => {
      flowsealCfg.gameFilter = v;
      await window.api.flowseal.setGameFilter(v);
      saveConfig();
      ui.toast('Игровой фильтр изменён. Перезапустите zapret.', 'info');
    })));

  body.appendChild(sec1);

  // IPSet Filter
  const sec2 = secEl('IPSet фильтр', 'Фильтрация по IP-адресам из списка ipset-all.txt.');

  let currentIpset = flowsealCfg.ipsetFilter || 'loaded';
  try { currentIpset = await window.api.flowseal.getIpsetFilter(); } catch { /* ignore */ }

  sec2.appendChild(ui.formRow('Режим IPSet',
    'Управление фильтрацией по IP-адресам.',
    ui.select(ZAPRET_PARAMS.ipsetFilterModes, currentIpset, async v => {
      flowsealCfg.ipsetFilter = v;
      await window.api.flowseal.setIpsetFilter(v);
      saveConfig();
      ui.toast('IPSet фильтр изменён. Перезапустите zapret.', 'info');
    })));

  body.appendChild(sec2);

  // Auto-Update
  const sec3 = secEl('Обновления', 'Автоматическая проверка обновлений Flowseal.');

  let autoUpdate = flowsealCfg.autoUpdate;
  try { autoUpdate = await window.api.flowseal.getAutoUpdate(); } catch { /* ignore */ }

  sec3.appendChild(ui.formRow('Проверка обновлений',
    'Автоматически проверять новые версии Flowseal при запуске.',
    ui.switch(autoUpdate, async v => {
      flowsealCfg.autoUpdate = v;
      await window.api.flowseal.setAutoUpdate(v);
      saveConfig();
    })));

  body.appendChild(sec3);
}

// ── Tab: Lists ────────────────────────────────────────────────────────────────

async function renderLists() {
  const body = document.querySelector('.set-body');
  if (!body) return;

  const sec = secEl('Пользовательские списки', 'Управление списками хостов для фильтрации и исключений.');

  let lists = [];
  try { lists = await window.api.flowseal.getLists(); } catch { /* ignore */ }

  if (!lists.length) {
    const m = document.createElement('div'); m.className = 'msg msg-warn';
    m.innerHTML = '<i class="ti ti-alert-triangle"></i><span>Версия Zapret не выбрана. Перейдите на вкладку Версии и установите или активируйте версию.</span><button class="msg-copy" title="Копировать"><i class="ti ti-copy"></i></button>';
      addMsgCopy(m);
    sec.appendChild(m);
  } else {
    lists.forEach(lf => {
      const row = document.createElement('div'); row.className = 'form-row';
      const rbody = document.createElement('div'); rbody.className = 'form-row-body';
      const lbl = document.createElement('div'); lbl.className = 'form-row-lbl';
      lbl.textContent = lf.label;
      rbody.appendChild(lbl);
      const fdesc = document.createElement('div'); fdesc.className = 'form-row-desc';
      fdesc.textContent = lf.file;
      rbody.appendChild(fdesc);
      row.appendChild(rbody);

      const ctl = document.createElement('div'); ctl.className = 'form-row-ctl';
      ctl.style.cssText = 'flex-direction:column;align-items:stretch;gap:8px;';
      const textarea = document.createElement('textarea'); textarea.className = 'form-textarea';
      textarea.style.minHeight = '80px';
      textarea.value = lf.content || '';
      textarea.placeholder = 'Одна запись на строку. Пример:\ndomain.example.abc\n203.0.113.113/32';
      const saveBtn = ui.btn('Сохранить', { variant: 's', sm: true, icon: 'device-floppy', onclick: async () => {
        const r = await window.api.flowseal.writeList(lf.key, textarea.value);
        if (r.ok) { saveBtn.disabled = true; ui.toast('Список сохранён', 'success'); setTimeout(() => saveBtn.disabled = false, 1500); }
        else ui.toast('Ошибка: ' + (r.error || 'неизвестная'), 'err');
      } });
      const btnRow = document.createElement('div');
      btnRow.style.cssText = 'display:flex;justify-content:flex-end;';
      btnRow.appendChild(saveBtn);
      textarea.addEventListener('change', async () => {
        const r = await window.api.flowseal.writeList(lf.key, textarea.value);
        if (r.ok) ui.toast('Список сохранён', 'success');
        else ui.toast('Ошибка: ' + (r.error || 'неизвестная'), 'err');
      });
      ctl.appendChild(textarea);
      ctl.appendChild(btnRow);
      row.appendChild(ctl);
      sec.appendChild(row);
    });
  }

  body.appendChild(sec);

  const infoCard = ui.card('Формат списков', `
    <p><strong>list-general-user.txt</strong> — домены для фильтрации (один на строку).</p>
    <p style="margin-top:8px;"><strong>list-exclude-user.txt</strong> — домены для исключения из фильтрации.</p>
    <p style="margin-top:8px;"><strong>ipset-exclude-user.txt</strong> — IP-адреса/диапазоны для исключения (CIDR).</p>`);
  body.appendChild(infoCard);
}

// ── Tab: Autostart ────────────────────────────────────────────────────────────

async function renderAutostart() {
  const body = document.querySelector('.set-body');
  if (!body) return;

  // ── Section 1: Автозапуск (Task Scheduler) ────────────────────────────────
  const sec1 = secEl('Автозапуск Zapret', 'Zapret будет запускаться автоматически при входе в систему и работать в фоне — без окон и консолей.');

  let autoStartStatus = { enabled: false };
  try { autoStartStatus = await window.api.flowseal.getAutoStart(); } catch { /* ignore */ }

  const statusDesc = document.createTextNode(
    autoStartStatus.enabled
      ? 'Zapret будет запускаться при каждом входе в Windows'
      : 'Автозапуск не настроен'
  );
  const statusBadge = ui.badge(autoStartStatus.enabled ? 'Включён' : 'Отключён', autoStartStatus.enabled ? 'accent' : 'gray');

  sec1.appendChild(ui.formRow('Статус', statusDesc, statusBadge));

  const autoSwitch = ui.switch(autoStartStatus.enabled, async v => {
    const r = await window.api.flowseal.setAutoStart(v);
    if (r.ok) {
      ui.toast(v ? 'Автозапуск zapret включён' : 'Автозапуск zapret отключён', 'success');
      // Update status in-place without full re-render
      statusBadge.textContent = v ? 'Включён' : 'Отключён';
      statusBadge.className = `badge badge-${v ? 'accent' : 'gray'}`;
      statusDesc.textContent = v ? 'Zapret будет запускаться при каждом входе в Windows' : 'Автозапуск не настроен';
    } else {
      ui.toast('Ошибка: ' + r.error, 'err');
      // Revert switch visually
      const cb = autoSwitch.querySelector('input');
      if (cb) cb.checked = !v;
    }
  });

  sec1.appendChild(ui.formRow('Автозапуск',
    'При включении создаётся задача в планировщике Windows. Zapret стартует при входе в систему.',
    autoSwitch));

  // Info note inside the section
  const infoNote = document.createElement('div');
  infoNote.className = 'form-row';
  infoNote.style.cssText = 'border-bottom:none;padding-top:4px;';
  infoNote.innerHTML = `
    <div style="display:flex;gap:12px;align-items:flex-start;width:100%;color:var(--text-tertiary);font-size:var(--fs-sm);line-height:1.5;padding:8px 0;">
      <i class="ti ti-info-circle" style="font-size:16px;margin-top:2px;flex-shrink:0;"></i>
      <span>Создаётся задача <strong>Control-Zapret</strong> в планировщике Windows. При смене стратегии выключите и включите автозапуск заново.</span>
    </div>`;
  sec1.appendChild(infoNote);

  body.appendChild(sec1);

  // ── Section 2: Active Fakes (Payloads) ─────────────────────────────────────
  const sec2 = secEl('Активные подмены (Payloads)', 'Управление .bin файлами для подмены пакетов Discord и игр.');

  let binsData = { fakes: [], currentDiscord: null, currentGame: null };
  try { binsData = await window.api.flowseal.getBins(); } catch { /* ignore */ }

  if (binsData.fakes.length > 0) {
    sec2.appendChild(ui.formRow('Discord UDP',
      'Текущий: ' + (binsData.currentDiscord || 'не выбран'),
      ui.select(
        binsData.fakes.map(f => ({ value: f.name, label: f.name })),
        binsData.currentDiscord || '',
        async v => {
          const r = await window.api.flowseal.setActiveFake('discord', v);
          if (r.ok) ui.toast('Discord UDP payload заменён. Перезапустите zapret.', 'success');
          else ui.toast('Ошибка: ' + r.error, 'err');
        }
      )));

    sec2.appendChild(ui.formRow('Game UDP',
      'Текущий: ' + (binsData.currentGame || 'не выбран'),
      ui.select(
        binsData.fakes.map(f => ({ value: f.name, label: f.name })),
        binsData.currentGame || '',
        async v => {
          const r = await window.api.flowseal.setActiveFake('game', v);
          if (r.ok) ui.toast('Game UDP payload заменён. Перезапустите zapret.', 'success');
          else ui.toast('Ошибка: ' + r.error, 'err');
        }
      )));
  } else {
    const m = document.createElement('div'); m.className = 'msg msg-info';
    m.innerHTML = '<i class="ti ti-info-circle"></i><span>.bin файлы не найдены в папке bin/</span><button class="msg-copy" title="Копировать"><i class="ti ti-copy"></i></button>';
    addMsgCopy(m);
    sec2.appendChild(m);
  }

  body.appendChild(sec2);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function secEl(title, desc) {
  const s = document.createElement('div'); s.className = 'form-sec';
  s.innerHTML = `<div class="form-sec-h"><h3>${title}</h3><p>${desc}</p></div>`;
  return s;
}

function getStrategyFallbackDesc(value) {
  const map = {
    'general': 'Основная стратегия: multisplit для TCP + fake для UDP.',
    'general (ALT)': 'fake+fakedsplit для TCP, ts fooling для TLS подмены.',
    'general (FAKE TLS AUTO)': 'multidisorder + badseq, автоматическая подмена TLS.',
    'general (SIMPLE FAKE)': 'Упрощённая стратегия: fake для всех протоколов.',
  };
  return map[value] || `Стратегия ${value}. Пробуйте если стандартные не подходят.`;
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
