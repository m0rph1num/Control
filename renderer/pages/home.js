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

let _bannerState = null;     // last rendered (running|external) key — re-render dedup
let _bannerRunning = null;   // previous running value, for the launch animation

function updateHomeStatus(opts) {
  const page = document.getElementById('page-home');
  if (!page) return;
  const bannerWrap = page.querySelector('.home-banner');
  if (!bannerWrap) return;

  const st = typeof window.homeState !== 'undefined' ? window.homeState : { running: false, external: false };
  const running = st.running;
  const external = st.external || false;

  // Dedup: only re-render when running/external actually changed. This avoids
  // jitter from status callbacks that fire while nothing meaningfully changed.
  const bannerKey = running + '|' + external;
  if (!(opts && opts.force) && _bannerState === bannerKey) {
    const statsWrap = page.querySelector('.home-stats');
    if (statsWrap) renderStats(statsWrap);
    return;
  }
  const prevRunning = _bannerRunning;
  _bannerState = bannerKey;
  _bannerRunning = running;

  // External = a third-party winws.exe running from a folder Control does not
  // manage. Our own zapret — including one auto-started via the zapret service —
  // is not external, so it reads as simply active.
  if (running && external) {
    title = 'Zapret работает (внешний)';
    desc = 'Обнаружен запущенный вне Control процесс winws.exe из другой папки. Для управления остановите его вручную или через терминал.';
  } else if (running) {
    title = 'Защита активна';
    desc = 'Обход DPI-блокировок работает. winws запущен (Control либо службы автозапуска).';
  } else {
    title = 'Защита остановлена';
    desc = 'Обход DPI-блокировок неактивен. Запустите Zapret для начала работы.';
  }

  const actions = running && !external
    ? [ui.btn('Остановить', { variant: 'd', icon: 'player-stop', onclick: stopZapret })]
    : running
      ? [] // external process — Control can't manage it
      : [ui.btn('Запустить', { variant: 'p', icon: 'player-play', onclick: startZapret })];

  const apply = () => {
    bannerWrap.innerHTML = '';
    const nb = buildBanner(running, title, desc, actions);
    // Animate only the launch (off→on) transition. The off banner renders
    // statically so it stays visible on stop instead of fading away.
    if (prevRunning !== null && prevRunning !== running && running) {
      nb.classList.add('banner-go-on');
    }
    bannerWrap.appendChild(nb);
  };

  // Animate idle→active / active→idle transitions for polish.
  if (opts && opts.instant || prevRunning === null) {
    apply();
  } else {
    const old = bannerWrap.querySelector('.banner');
    if (old) {
      old.classList.add('banner-exit');
      setTimeout(apply, 220);
    } else {
      apply();
    }
  }

  const statsWrap = page.querySelector('.home-stats');
  if (statsWrap) renderStats(statsWrap);
}

/** Build the premium status banner DOM. */
function buildBanner(running, title, desc, actions) {
  const b = document.createElement('div');
  b.className = 'banner' + (running ? ' banner-on' : ' banner-off');

  const hero = document.createElement('div');
  hero.className = 'banner-hero';
  hero.innerHTML = `<i class="ti ${running ? 'ti-shield-check' : 'ti-shield'}"></i>`;
  b.appendChild(hero);

  const body = document.createElement('div');
  body.className = 'banner-body';
  const h3 = document.createElement('div'); h3.className = 'banner-title'; h3.textContent = title;
  const p = document.createElement('div'); p.className = 'banner-desc'; p.textContent = desc;
  body.appendChild(h3); body.appendChild(p);
  b.appendChild(body);

  if (actions && actions.length) {
    const a = document.createElement('div');
    a.className = 'banner-actions';
    actions.forEach(btn => a.appendChild(btn));
    b.appendChild(a);
  }

  return b;
}

/** Disable the banner buttons and show a spinner on the given one. */
function _setBannerPending(pendingBtn) {
  const banner = document.querySelector('.home-banner');
  if (!banner) return;
  const btns = banner.querySelectorAll('.banner-actions .btn');
  btns.forEach(b => { b.disabled = true; b.classList.add('loading'); });
  if (pendingBtn) pendingBtn.innerHTML = '<span class="spin" style="width:18px;height:18px;border-width:2px;"></span>';
}

// In-flight guard: prevents a second click from firing while an operation runs
// (was the root of "tripping" / double-stop).
let _bannerBusy = false;

async function startZapret() {
  if (_bannerBusy) return;
  _bannerBusy = true;
  try {
    const playBtn = document.querySelector('.home-banner .btn-p');
    _setBannerPending(playBtn);
    const r = await window.api.flowseal.start();
    if (!r.ok) ui.toast('Ошибка: ' + r.error, 'err');
  } catch (e) {
    ui.toast('Ошибка запуска: ' + e.message, 'err');
  } finally {
    _bannerBusy = false;
  }
}

async function stopZapret() {
  if (_bannerBusy) return;
  _bannerBusy = true;
  try {
    const stopBtn = document.querySelector('.home-banner .btn-d');
    _setBannerPending(stopBtn);
    await window.api.flowseal.stop();
  } catch (e) {
    ui.toast('Ошибка остановки: ' + e.message, 'err');
  } finally {
    _bannerBusy = false;
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

  // Sync render. `force` bypasses the state-dedup guard: since renderHome just
  // wiped `.home-banner` from the DOM, we must always repopulate it here, even if
  // the running state did not change since the last visit.
  updateHomeStatus({ force: true });

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
