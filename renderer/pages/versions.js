// ═══════════════════════════════════════════════════════════════════════════════
// Control — Versions Page
// ═══════════════════════════════════════════════════════════════════════════════

let versionsList = [];
let versionsLoading = false;
let installedVersions = [];

function renderVersions() {
  const page = document.getElementById('page-versions');
  page.innerHTML = '';

  const refreshBtn = ui.btn('Проверить', { variant: 'p', icon: 'refresh', onclick: loadVersions });
  page.appendChild(ui.pageHeader('Версии Zapret', 'Управление версиями: установка, обновление и откат', [refreshBtn]));

  // Current version section — shows two cards: Control + Flowseal
  const curSec = ui.section('Текущая версия');
  const curCard = document.createElement('div'); curCard.className = 'card'; curCard.id = 'cur-ver';
  curCard.innerHTML = '<div class="card-b"><div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;"><div class="skeleton" style="height:100px;"></div><div class="skeleton" style="height:100px;"></div></div></div>';
  curSec.appendChild(curCard);
  page.appendChild(curSec);

  // Loading skeleton for versions list
  const histSec = ui.section('Доступные версии');
  const listWrap = document.createElement('div'); listWrap.id = 'ver-list';
  const skeleton = document.createElement('div'); skeleton.style.cssText = 'background:var(--card);border:1px solid var(--border);border-radius:var(--r);overflow:hidden;';
  skeleton.innerHTML = Array(3).fill('').map(() =>
    '<div style="padding:16px 20px;border-bottom:1px solid var(--border);display:flex;gap:12px;align-items:center;">' +
      '<div class="skeleton" style="width:100px;height:22px;"></div>' +
      '<div class="skeleton" style="width:120px;height:16px;"></div>' +
      '<div class="skeleton" style="width:80px;height:32px;margin-left:auto;"></div>' +
    '</div>'
  ).join('');
  listWrap.appendChild(skeleton);
  histSec.appendChild(listWrap);
  page.appendChild(histSec);

  loadVersions();
}

async function loadVersions() {
  if (versionsLoading) return;
  versionsLoading = true;
  const btn = document.querySelector('#page-versions .btn-p');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="ti ti-refresh loading"></i> Проверка...'; }

  try {
    const [current, versions, flowseal] = await Promise.all([
      window.api.updater.getCurrent(),
      window.api.updater.getVersions(),
      window.api.flowseal.getVersion(),
    ]);
    versionsList = versions;
    installedVersions = current?.installedVersions || [];
    renderCurrentVersion(current, flowseal, installedVersions);
    renderVersionsList(versions, installedVersions, current?.activeFolder);
  } catch (e) {
    ui.toast('Ошибка загрузки списка версий', 'err');
    document.getElementById('ver-list').innerHTML =
      '<div class="empty"><i class="ti ti-cloud-off"></i><p>Ошибка загрузки</p><span>Проверьте подключение к интернету или GitHub</span></div>';
  }

  versionsLoading = false;
  if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ti ti-refresh"></i> Проверить'; }
}

function renderCurrentVersion(current, flowseal, installed) {
  const el = document.getElementById('cur-ver');
  if (!el) return;
  el.innerHTML = '';

  const appVer = current?.version || '1.0.1';
  const fsVer = flowseal?.version || '0.0.0';
  const fsInstalled = flowseal?.installed;
  const activeFolder = current?.activeFolder || '';

  const body = document.createElement('div'); body.className = 'card-b';

  // Two-column layout: Control | Flowseal
  const grid = document.createElement('div');
  grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:16px;';

  // App version (Control)
  const appBlock = document.createElement('div');
  appBlock.style.cssText = 'padding:16px;background:var(--surface);border-radius:var(--r);border:1px solid var(--border);';
  appBlock.innerHTML = `
    <div style="font-size:13px;color:var(--text-tertiary);margin-bottom:4px;">Control (приложение)</div>
    <div style="font-size:24px;font-weight:700;">${appVer}</div>
    <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;">
      <span class="badge badge-accent">GUI</span>
    </div>`;
  grid.appendChild(appBlock);

  // Flowseal version (winws.exe) — активная выбранная версия
  const activeVer = (installed || []).find(v => v.isActive);
  const activePath = activeVer?.path || '';

  const fsBlock = document.createElement('div');
  fsBlock.style.cssText = 'padding:16px;background:var(--surface);border-radius:var(--r);border:1px solid var(--border);';
  fsBlock.innerHTML = `
    <div style="font-size:13px;color:var(--text-tertiary);margin-bottom:4px;">
      Flowseal <span style="color:var(--text-tertiary);font-weight:400;">${activeFolder ? '(' + activeFolder + ')' : ''}</span>
    </div>
    <div style="font-size:24px;font-weight:700;">${fsVer}</div>
    <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;">
      ${fsInstalled ? '<span class="badge badge-accent">Установлен</span>' : '<span class="badge badge-red">Не найден</span>'}
    </div>`;
  grid.appendChild(fsBlock);

  body.appendChild(grid);
  el.appendChild(body);
}

function openVersionFolder(folder) {
  const installed = installedVersions.find(v => v.folder === folder);
  if (installed && installed.path) {
    window.api.openFolder(installed.path);
  }
}

function renderVersionsList(versions, installed, activeFolder) {
  const el = document.getElementById('ver-list');
  if (!el) return;
  el.innerHTML = '';

  if (!versions || !versions.length) {
    el.innerHTML = '<div class="empty"><i class="ti ti-cloud-off"></i><p>Нет доступных версий</p><span>Проверьте подключение к интернету</span></div>';
    return;
  }

  // Determine which versions are already installed
  const installedFolders = (installed || []).map(v => v.folder.replace(/^v/i, ''));

  const list = document.createElement('div'); list.className = 'vlist';
  versions.forEach((v, i) => {
    const isInstalled = installedFolders.includes(v.version);
    const isActive = activeFolder && v.version === activeFolder.replace(/^v/i, '');
    const item = document.createElement('div'); item.className = `vitem${isActive ? ' current' : ''}`;
    item.style.animationDelay = `${i * 50}ms`;

    // Version + meta block
    const info = document.createElement('div'); info.className = 'vinfo';

    const verEl = document.createElement('div'); verEl.className = 'vver';
    verEl.textContent = v.version;
    info.appendChild(verEl);

    const meta = document.createElement('div'); meta.className = 'vmeta';
    const badge = ui.badge(v.type === 'dev' ? 'DEV' : 'STABLE', v.type === 'dev' ? 'orange' : 'accent');
    meta.appendChild(badge);
    const d = document.createElement('span'); d.textContent = v.date; meta.appendChild(d);
    if (v.assetSize) {
      const sizeLabel = v.assetSize > 1048576
        ? (v.assetSize / 1048576).toFixed(1) + ' MB'
        : (v.assetSize / 1024).toFixed(0) + ' KB';
      meta.appendChild(document.createTextNode(' · '));
      const sizeSpan = document.createElement('span'); sizeSpan.style.cssText = 'color:var(--text-tertiary);font-size:13px;';
      sizeSpan.textContent = sizeLabel;
      meta.appendChild(sizeSpan);
    }
    info.appendChild(meta);

    item.appendChild(info);

    // Actions
    const act = document.createElement('div'); act.className = 'vact';
    if (isActive) {
      act.appendChild(ui.badge('Активна', 'accent'));
      act.appendChild(ui.btn('', { variant: 'g', sm: true, iconOnly: true, icon: 'folder-open', title: 'Открыть папку', onclick: () => openVersionFolder('v' + v.version) }));
      act.appendChild(ui.btn('', { variant: 'd', sm: true, iconOnly: true, icon: 'trash', title: 'Удалить версию', onclick: () => deleteVersion('v' + v.version) }));
    } else if (isInstalled) {
      // Installed but not active — offer activate + open + delete
      act.appendChild(ui.btn('Активировать', { variant: 's', sm: true, icon: 'check', onclick: () => switchVersion('v' + v.version) }));
      act.appendChild(ui.btn('', { variant: 'g', sm: true, iconOnly: true, icon: 'folder-open', title: 'Открыть папку', onclick: () => openVersionFolder('v' + v.version) }));
      act.appendChild(ui.btn('', { variant: 'd', sm: true, iconOnly: true, icon: 'trash', title: 'Удалить версию', onclick: () => deleteVersion('v' + v.version) }));
    } else if (v.assetUrl) {
      act.appendChild(ui.btn('Скачать', { variant: 's', sm: true, icon: 'download', onclick: () => downloadVersion(v.version) }));
    } else {
      act.appendChild(ui.badge('Нет файла', 'gray'));
    }
    item.appendChild(act);

    list.appendChild(item);
  });
  el.appendChild(list);
}

async function switchVersion(folder) {
  const r = await window.api.control.selectVersion(folder);
  if (r.ok) {
    ui.toast(`Версия ${folder} активирована. Данные обновятся при перезапуске Zapret.`, 'success');
    loadVersions();
  } else {
    ui.toast('Ошибка: ' + r.error, 'err');
  }
}

async function deleteVersion(folder) {
  const confirm = await new Promise(resolve => {
    const okBtn = ui.btn('Удалить', { variant: 'd', icon: 'trash', onclick: () => { ui.hideModal(); resolve(true); } });
    const cancelBtn = ui.btn('Отмена', { variant: 's', onclick: () => { ui.hideModal(); resolve(false); } });
    ui.modal('Удаление версии', `
      <div style="text-align:center;padding:16px 0;">
        <i class="ti ti-alert-triangle" style="font-size:40px;color:var(--orange);margin-bottom:12px;display:block;"></i>
        <p style="font-size:15px;color:var(--text);margin-bottom:4px;">Вы уверены, что хотите удалить версию <strong>${folder}</strong>?</p>
        <p style="font-size:13px;color:var(--text-tertiary);">Папка версии будет удалена с диска без возможности восстановления.</p>
      </div>`,
      { footer: [cancelBtn, okBtn] }
    );
  });
  if (!confirm) return;

  const r = await window.api.control.deleteVersion(folder);
  if (r.ok) {
    ui.toast(`Версия ${folder} удалена`, 'success');
    loadVersions();
  } else {
    ui.toast('Ошибка: ' + r.error, 'err');
  }
}

// ── Download Modal (redesigned) ────────────────────────────────────────────────

const DL_R = 62;
const DL_CIRCUMFERENCE = 2 * Math.PI * DL_R; // ≈ 389.56

function dlFormatSize(bytes) {
  if (!bytes && bytes !== 0) return '';
  if (bytes > 1048576) return (bytes / 1048576).toFixed(1) + ' MB';
  if (bytes > 1024) return (bytes / 1024).toFixed(0) + ' KB';
  return bytes + ' B';
}

function dlBuildModal(version) {
  const wrap = document.createElement('div');
  wrap.className = 'dl-body';
  wrap.innerHTML = `
    <div class="dl-ring-wrap" id="dl-ring-wrap">
      <svg class="dl-ring" width="140" height="140" viewBox="0 0 140 140">
        <circle class="dl-ring-bg" cx="70" cy="70" r="${DL_R}"/>
        <circle class="dl-ring-fill" id="dl-ring-fill" cx="70" cy="70" r="${DL_R}"
          stroke-dasharray="${DL_CIRCUMFERENCE}" stroke-dashoffset="${DL_CIRCUMFERENCE}"
          transform="rotate(-90, 70, 70)"/>
      </svg>
      <div class="dl-ring-text" id="dl-ring-text">0%</div>
    </div>
    <div class="dl-status" id="dl-status">Подготовка к скачиванию...</div>
    <div class="dl-steps">
      <div class="dl-step active" data-dl-step="0">
        <div class="dl-step-dot"><i class="ti ti-download"></i></div>
        <span>Скачивание</span>
      </div>
      <div class="dl-step-line" data-dl-line="0"></div>
      <div class="dl-step" data-dl-step="1">
        <div class="dl-step-dot"><i class="ti ti-package"></i></div>
        <span>Установка</span>
      </div>
      <div class="dl-step-line" data-dl-line="1"></div>
      <div class="dl-step" data-dl-step="2">
        <div class="dl-step-dot"><i class="ti ti-check"></i></div>
        <span>Готово</span>
      </div>
    </div>
    <div class="dl-meta" id="dl-meta"></div>
    <div class="dl-cancel" id="dl-cancel" style="margin-top:16px;display:none;">
      <button class="btn btn-g btn-sm" id="dl-cancel-btn">
        <i class="ti ti-x"></i> Отменить
      </button>
    </div>
  `;
  return wrap;
}

function dlSetStep(idx, state) {
  const steps = document.querySelectorAll('[data-dl-step]');
  const lines = document.querySelectorAll('[data-dl-line]');
  steps[idx]?.classList.remove('active', 'done');
  if (state === 'active') {
    steps[idx]?.classList.add('active');
  } else if (state === 'done') {
    steps[idx]?.classList.add('done');
    if (lines[idx]) lines[idx].classList.add('done');
  }
}

function dlUpdateUI(state) {
  const { phase, percent, text, downloaded, total } = state;
  const wrap = document.getElementById('dl-ring-wrap');
  const fill = document.getElementById('dl-ring-fill');
  const txt = document.getElementById('dl-ring-text');
  const status = document.getElementById('dl-status');
  const meta = document.getElementById('dl-meta');
  const modalT = document.querySelector('.modal-t');
  if (!wrap || !fill) return;

  // Reset animation classes each call
  wrap.classList.remove('indeterminate', 'dl-done');
  // Reset text size for normal percentage display
  txt.style.fontSize = '';

  if (phase === 'download' && percent !== undefined) {
    const pct = Math.min(percent, 100);
    fill.style.strokeDashoffset = DL_CIRCUMFERENCE * (1 - pct / 100);
    txt.textContent = Math.round(pct) + '%';

    if (text) status.textContent = text;
    // Keep step 0 active if not yet done
    dlSetStep(0, 'active');

    if (downloaded != null && total != null) {
      meta.innerHTML = `<span>${dlFormatSize(downloaded)} / ${dlFormatSize(total)}</span>`;
      meta.classList.add('show');
    } else {
      meta.classList.remove('show');
    }

  } else if (phase === 'install') {
    wrap.classList.add('indeterminate');
    txt.textContent = '...';
    txt.style.fontSize = '32px';
    if (text) status.textContent = text;
    meta.classList.remove('show');

    dlSetStep(0, 'done');
    dlSetStep(1, 'active');

  } else if (phase === 'done') {
    // Snap ring to 100%
    fill.style.strokeDashoffset = 0;
    txt.textContent = '✓';
    txt.style.fontSize = '40px';
    status.textContent = text || 'Готово!';
    meta.classList.remove('show');
    wrap.classList.add('dl-done');

    dlSetStep(0, 'done');
    dlSetStep(1, 'done');
    dlSetStep(2, 'done');

    if (modalT) modalT.textContent = 'Готово';
  }
}

async function downloadVersion(version) {
  const body = dlBuildModal(version);
  ui.modal(`Загрузка ${version}`, body);

  let unsub = null;
  try {
    unsub = window.api.updater.onProgress((p) => dlUpdateUI(p));
  } catch { /* ignore */ }
  const cleanup = () => { if (typeof unsub === 'function') unsub(); };

  let cancelled = false;
  const cancelBtn = document.getElementById('dl-cancel-btn');
  const cancelWrap = document.getElementById('dl-cancel');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', async () => {
      cancelled = true;
      await window.api.updater.cancelDownload();
      cleanup();
      ui.hideModal();
      ui.toast('Скачивание отменено', 'info');
    });
  }

  try {
    // Show cancel button during download phase
    if (cancelWrap) cancelWrap.style.display = '';

    const r = await window.api.updater.download(version);
    if (!r.ok) {
      if (cancelWrap) cancelWrap.style.display = 'none';
      cleanup();
      ui.hideModal();
      ui.toast(r.error || 'Ошибка при скачивании', 'err');
      return;
    }

    // Hide cancel button during install phase
    if (cancelWrap) cancelWrap.style.display = 'none';

    if (cancelled) { cleanup(); return; }

    dlUpdateUI({ phase: 'install', text: 'Распаковка архива...' });

    const ir = await window.api.updater.install(version, r.tempFile);
    if (ir.ok) {
      if (cancelled) { cleanup(); return; }
      dlUpdateUI({ phase: 'done', text: 'Установлено!' });
      // Let the user see the success animation before closing
      await new Promise(r2 => setTimeout(r2, 700));
      cleanup();
      ui.hideModal();
      ui.toast(`Версия ${version} установлена`, 'success');
      loadVersions();
    } else {
      cleanup();
      ui.hideModal();
      ui.toast(ir.error || 'Ошибка установки', 'err');
    }
  } catch (e) {
    cleanup();
    if (e.message === 'cancelled') return; // silent — already handled
    ui.hideModal();
    ui.toast('Ошибка: ' + (e.message || 'неизвестная'), 'err');
  }
}

