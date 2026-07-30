// ═══════════════════════════════════════════════════════════════════════════════
// Zapret GUI — Home Page
// ═══════════════════════════════════════════════════════════════════════════════

let homeRefreshTimer = null;
let _homeStatsData = null;

function strategyLabel(raw) {
  if (!raw || raw === 'general') return 'Default';
  return raw.replace(/^general\s*/, '')
    .replace(/[()]/g, '').trim() || 'Default';
}

function renderStats(statsWrap) {
  if (!statsWrap) return;
  statsWrap.innerHTML = '';
  const grid = document.createElement('div'); grid.className = 'stats';

  const st = typeof window.homeState !== 'undefined' ? window.homeState : { running: false };
  const running = st.running;
  const d = _homeStatsData || {};

  grid.appendChild(ui.stat('shield-check', running ? 'Защищено' : 'Не защищено', 'Статус', running ? 'accent' : 'neutral'));
  grid.appendChild(ui.stat('git-branch', strategyLabel(d.strategy), 'Стратегия', 'neutral'));
  grid.appendChild(ui.stat('package', d.activeVersion || '—', 'Активная версия', 'neutral'));
  statsWrap.appendChild(grid);
}

async function loadHomeStats() {
  let hd;
  try {
    hd = await window.api.home.getData();
  } catch {
    hd = { strategy: null, activeVersion: null };
  }
  _homeStatsData = hd;

  const statsWrap = document.querySelector('.home-stats');
  if (statsWrap) renderStats(statsWrap);
}

function updateHomeStatus(opts) {
  const page = document.getElementById('page-home');
  if (!page) return;
  const banner = page.querySelector('.home-banner');
  if (!banner) return;

  const st = typeof window.homeState !== 'undefined' ? window.homeState : { running: false, external: false };
  const running = st.running;
  const external = st.external || false;
  const state = running ? 'on' : 'off';
  let title, desc;
  if (running && external) {
    title = 'Zapret работает (внешний)';
    desc = 'Обнаружен запущенный вне Control процесс winws.exe. Для управления через Control остановите внешний процесс и запустите через приложение.';
  } else if (running) {
    title = 'Zapret работает';
    desc = 'Обход DPI-блокировок активен. Защита работает в фоновом режиме.';
  } else {
    title = 'Zapret остановлен';
    desc = 'Обход DPI-блокировок неактивен. Запустите Zapret для начала работы.';
  }

  const actions = [];
  if (running) {
    if (!external) {
      actions.push(ui.btn('Остановить', { variant: 'd', icon: 'player-stop', onclick: stopZapret }));
      actions.push(ui.btn('Перезапустить', { variant: 's', icon: 'refresh', onclick: restartZapret }));
    }
  } else {
    actions.push(ui.btn('Запустить', { variant: 'p', icon: 'player-play', onclick: startZapret }));
  }

  // Smooth transition: fade out → swap → fade in
  const animateIn = () => {
    banner.innerHTML = '';
    const nb = ui.banner(state, title, desc, actions);
    nb.classList.add('banner-entry');
    banner.appendChild(nb);
  };

  const existing = banner.querySelector('.banner');
  if (opts && opts.instant) {
    animateIn();
  } else if (existing) {
    existing.style.transition = 'opacity 150ms ease, transform 150ms ease';
    existing.style.opacity = '0';
    existing.style.transform = 'translateY(-4px) scale(0.97)';
    setTimeout(animateIn, 160);
  } else {
    animateIn();
  }

  // Re-render stats with current data
  const statsWrap = page.querySelector('.home-stats');
  if (statsWrap) renderStats(statsWrap);
}

async function startZapret() {
  try {
    const banner = document.querySelector('.home-banner');
    const btns = banner ? banner.querySelectorAll('.btn') : [];
    btns.forEach(b => { b.disabled = true; b.classList.add('loading'); });
    // Replace icon with spinner on the primary button
    const playBtn = banner?.querySelector('.btn-p');
    if (playBtn) { playBtn.innerHTML = '<span class="spin" style="width:18px;height:18px;border-width:2px;"></span>'; }

    const r = await window.api.flowseal.start();
    if (!r.ok) ui.toast('Ошибка: ' + r.error, 'err');
  } catch (e) {
    ui.toast('Ошибка запуска: ' + e.message, 'err');
  }
}

async function stopZapret() {
  const confirm = await new Promise(resolve => {
    const okBtn = ui.btn('Остановить', { variant: 'd', icon: 'player-stop', onclick: () => { ui.hideModal(); resolve(true); } });
    const cancelBtn = ui.btn('Отмена', { variant: 's', onclick: () => { ui.hideModal(); resolve(false); } });
    ui.modal('Остановка Zapret', `
      <div style="text-align:center;padding:16px 0;">
        <i class="ti ti-player-stop" style="font-size:40px;color:var(--orange);margin-bottom:12px;display:block;"></i>
        <p style="font-size:15px;color:var(--text);margin-bottom:4px;">Остановить обход DPI-блокировок?</p>
        <p style="font-size:13px;color:var(--text-tertiary);">Защита будет отключена. Вы сможете запустить Zapret снова в любой момент.</p>
      </div>`,
      { footer: [cancelBtn, okBtn] }
    );
  });
  if (!confirm) return;
  try {
    const banner = document.querySelector('.home-banner');
    const btns = banner ? banner.querySelectorAll('.btn') : [];
    btns.forEach(b => { b.disabled = true; b.classList.add('loading'); });
    const stopBtn = banner?.querySelector('.btn-d');
    if (stopBtn) { stopBtn.innerHTML = '<span class="spin" style="width:18px;height:18px;border-width:2px;"></span>'; }

    await window.api.flowseal.stop();
  } catch (e) {
    ui.toast('Ошибка остановки: ' + e.message, 'err');
  }
}

async function restartZapret() {
  try {
    const banner = document.querySelector('.home-banner');
    const btns = banner ? banner.querySelectorAll('.btn') : [];
    btns.forEach(b => { b.disabled = true; b.classList.add('loading'); });
    const restartBtn = banner?.querySelector('.btn-s');
    if (restartBtn) { restartBtn.innerHTML = '<span class="spin" style="width:18px;height:18px;border-width:2px;"></span>'; }

    const r = await window.api.flowseal.stop();
    if (r && r.ok) {
      await new Promise(r => setTimeout(r, 800));
      await window.api.flowseal.start();
    }
  } catch (e) {
    ui.toast('Ошибка перезапуска: ' + e.message, 'err');
  }
}

function renderHome() {
  const page = document.getElementById('page-home');
  page.innerHTML = '';
  const content = document.createElement('div');
  content.className = 'home-content';

  // Status banner
  const bannerArea = document.createElement('div'); bannerArea.className = 'home-banner';
  content.appendChild(bannerArea);

  // Stats grid — rendered with whatever data we have
  const statsArea = document.createElement('div'); statsArea.className = 'home-stats';
  content.appendChild(statsArea);

  // Quick actions card
  const actionsCard = ui.card('Быстрые действия', '<div class="card-actions-placeholder"></div>');
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;gap:12px;flex-wrap:wrap;';
  wrap.appendChild(ui.btn('Настройки', { variant: 's', icon: 'settings', onclick: () => navigate('settings') }));
  wrap.appendChild(ui.btn('Диагностика', { variant: 's', icon: 'heartbeat', onclick: () => navigate('diagnostics') }));
  wrap.appendChild(ui.btn('Версии', { variant: 's', icon: 'cloud-download', onclick: () => navigate('versions') }));
  const cardBody = actionsCard.querySelector('.card-b');
  cardBody.innerHTML = '';
  cardBody.appendChild(wrap);
  content.appendChild(actionsCard);

  page.appendChild(content);

  // Sync render (banner + cached stats)
  updateHomeStatus();

  // Async fetch stats in background — fills data silently
  loadHomeStats();

  // Refresh stats every 30s
  if (homeRefreshTimer) clearInterval(homeRefreshTimer);
  homeRefreshTimer = setInterval(() => {
    if (typeof window.homeState !== 'undefined' && window.homeState.running) {
      loadHomeStats();
    }
  }, 30000);
}
