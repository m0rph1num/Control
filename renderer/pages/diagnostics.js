// ═══════════════════════════════════════════════════════════════════════════════
// Control — Diagnostics Page
// ═══════════════════════════════════════════════════════════════════════════════

function renderDiagnostics() {
  const page = document.getElementById('page-diagnostics');
  page.innerHTML = '';
  const runBtn = ui.btn('Запустить диагностику', { variant: 'p', icon: 'heartbeat', onclick: runDiagnostics });
  const clearBtn = ui.btn('Очистить лог', { variant: 'g', icon: 'trash', onclick: clearLogs });
  page.appendChild(ui.pageHeader('Диагностика', 'Проверка работоспособности Flowseal и WinDivert', [runBtn, clearBtn]));

  // Results section
  const secEl = ui.section('Результаты проверки');
  const res = document.createElement('div'); res.id = 'diag-res';
  res.className = 'diag';
  res.innerHTML = '<div class="empty"><i class="ti ti-heartbeat" style="font-size:32px;"></i><p>Диагностика ещё не запускалась</p><span>Нажмите «Запустить диагностику» для проверки</span></div>';
  secEl.appendChild(res);
  page.appendChild(secEl);

  // Log
  const logSec = ui.section('Лог диагностики');
  const logActions = document.createElement('div');
  logActions.style.cssText = 'display:flex;gap:6px;';
  logActions.appendChild(ui.btn('', { variant: 'g', sm: true, iconOnly: true, icon: 'copy', title: 'Копировать всё', onclick: copyDiagnosticsLog }));
  logSec.querySelector('.section-h')?.appendChild(logActions);
  const log = ui.logViewer(['[system] Запустите диагностику для проверки...']);
  log.id = 'diag-log';
  logSec.appendChild(log);
  page.appendChild(logSec);
}

async function runDiagnostics() {
  const resEl = document.getElementById('diag-res');
  const logEl = document.getElementById('diag-log');
  if (!resEl || !logEl) return;

  // Animated progress state
  resEl.innerHTML = `
    <div style="text-align:center;padding:40px 24px;">
      <div class="spin" style="width:36px;height:36px;margin:0 auto 12px;border-width:3px;"></div>
      <div style="font-weight:500;margin-bottom:4px;">Выполнение проверок...</div>
      <div style="font-size:14px;color:var(--text-tertiary);" id="diag-progress-text">Инициализация...</div>
      <div class="progress" style="max-width:320px;margin:16px auto 0;">
        <div class="progress-fill" id="diag-progress-bar" style="width:5%;transition:width 400ms ease;"></div>
      </div>
    </div>`;

  const checks = [
    { label: 'Права администратора', weight: 10 },
    { label: 'Служба WinDivert', weight: 15 },
    { label: 'winws.exe (обход DPI)', weight: 15 },
    { label: 'Версия Flowseal', weight: 15 },
    { label: 'Файлы стратегий', weight: 10 },
    { label: 'Интернет', weight: 20 },
    { label: 'DNS', weight: 15 },
  ];

  let progress = 0;
  const totalWeight = checks.reduce((s, c) => s + c.weight, 0);
  let currentCheck = 0;

  const updateProgress = () => {
    if (currentCheck < checks.length) {
      const check = checks[currentCheck];
      document.getElementById('diag-progress-text').textContent = check.label + '...';
      currentCheck++;
    }
  };

  try {
    const progressInterval = setInterval(() => {
      if (currentCheck < checks.length) {
        progress += checks[currentCheck]?.weight || 0;
        const bar = document.getElementById('diag-progress-bar');
        if (bar) bar.style.width = Math.min(progress, 95) + '%';
        updateProgress();
      }
    }, 400);

    const results = await window.api.diag.run();
    clearInterval(progressInterval);

    const bar = document.getElementById('diag-progress-bar');
    if (bar) { bar.style.width = '100%'; }

    await new Promise(r => setTimeout(r, 300));

    resEl.innerHTML = '';
    if (!results || !results.length) {
      resEl.innerHTML = '<div class="empty"><i class="ti ti-heart-off"></i><p>Нет результатов</p><span>Проверки не дали результатов</span></div>';
      return;
    }

    // ── Render results with staggered animation ──
    const iconMap = { ok: 'circle-check', fail: 'alert-circle', warn: 'alert-triangle', stopped: 'player-stop' };
    const failResults = results.filter(r => r.status === 'fail');
    const warnResults = results.filter(r => r.status === 'warn');
    const stoppedResults = results.filter(r => r.status === 'stopped');

    results.forEach((r, i) => {
      const status = r.status === 'ok' ? 'pass' : r.status === 'warn' ? 'warn' : r.status === 'stopped' ? 'warn' : 'fail';
      const item = document.createElement('div'); item.className = 'diag-item';
      item.style.animation = `pgIn 300ms ease ${i * 80}ms both`;
      item.innerHTML = `
        <div class="diag-ico ${status}"><i class="ti ti-${iconMap[r.status] || 'info-circle'}"></i></div>
        <div class="diag-body">
          <div class="diag-name">${r.test}</div>
          <div class="diag-detail">${r.detail}</div>
        </div>`;
      resEl.appendChild(item);
    });

    // ── Summary badge ──
    if (failResults.length > 0 || warnResults.length > 0 || stoppedResults.length > 0) {
      const summary = document.createElement('div');
      summary.style.cssText = 'margin-top:16px;padding:12px 16px;border-radius:var(--r);background:var(--card);border:1px solid var(--border);display:flex;gap:12px;align-items:center;';
      if (failResults.length > 0) {
        summary.innerHTML = '<i class="ti ti-alert-circle" style="font-size:20px;color:var(--red);flex-shrink:0;"></i><div style="font-size:14px;color:var(--text);">Обнаружены проблемы: <strong>' + failResults.length + ' ошибок</strong>, ' + warnResults.length + ' предупреждений. Скопируйте лог для анализа.</div>';
      } else if (warnResults.length > 0) {
        summary.innerHTML = '<i class="ti ti-alert-triangle" style="font-size:20px;color:var(--orange);flex-shrink:0;"></i><div style="font-size:14px;color:var(--text);">Обнаружены предупреждения: ' + warnResults.length + '. Рекомендуется проверить.</div>';
      }
      resEl.parentElement.appendChild(summary);
    }

    // ── WinDivert card (if needs installation) ──
    const windivertResult = results.find(r => r.test === 'Служба WinDivert');
    if (windivertResult && (windivertResult.status === 'warn' || windivertResult.status === 'fail')) {
      try {
        const wdInfo = await window.api.diag.checkWinDivert();
        const wdCard = document.createElement('div');
        wdCard.className = 'card';
        wdCard.style.marginTop = '16px';
        wdCard.innerHTML = `
          <div class="card-h"><div class="card-t">WinDivert</div></div>
          <div class="card-b">
            <div style="display:flex;flex-direction:column;gap:12px;">
              <div style="display:flex;gap:12px;align-items:flex-start;">
                <i class="ti ti-alert-triangle" style="font-size:24px;color:var(--orange);flex-shrink:0;"></i>
                <div>
                  <div style="font-weight:500;margin-bottom:4px;">Драйвер WinDivert не обнаружен</div>
                  <div style="font-size:13px;color:var(--text-tertiary);line-height:1.5;">
                    WinDivert — драйвер фильтрации пакетов. Без него winws.exe не может работать.
                    ${wdInfo.found
                      ? 'Файлы драйвера найдены в папке Flowseal — можно установить.'
                      : 'Файлы драйвера не найдены в папке Flowseal. Скачайте WinDivert отдельно.'}
                  </div>
                </div>
              </div>
              <div style="display:flex;gap:8px;flex-wrap:wrap;">
                ${wdInfo.found
                  ? `<button class="btn btn-p btn-sm" id="diag-install-wd"><i class="ti ti-tool"></i> Установить WinDivert</button>`
                  : ''}
                <button class="btn btn-g btn-sm" id="diag-download-wd"><i class="ti ti-download"></i> Скачать WinDivert</button>
              </div>
              <div id="diag-wd-status" style="font-size:13px;color:var(--text-tertiary);display:none;"></div>
            </div>
          </div>`;

        resEl.parentElement.appendChild(wdCard);

        wdCard.querySelector('#diag-install-wd')?.addEventListener('click', async () => {
          const btn = wdCard.querySelector('#diag-install-wd');
          if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spin" style="width:14px;height:14px;border-width:2px;"></span> Установка...'; }
          const statusEl = wdCard.querySelector('#diag-wd-status');
          if (statusEl) statusEl.style.display = 'block';
          const r = await window.api.diag.installWinDivert();
          if (statusEl) {
            if (r.ok) {
              statusEl.innerHTML = `<span style="color:var(--accent);">✓ ${r.message}</span>`;
              if (btn) btn.textContent = '✓ Установлен';
            } else {
              statusEl.innerHTML = `<span style="color:var(--red);">✗ ${r.error}</span>`;
              if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ti ti-tool"></i> Установить WinDivert'; }
            }
          }
        });
        wdCard.querySelector('#diag-download-wd')?.addEventListener('click', () => {
          window.api.openExternal?.('https://reqrypt.org/windivert.html');
        });
      } catch { /* ignore */ }
    }

    // ── Detailed LOG ──
    if (logEl) {
      const ts = () => new Date().toLocaleTimeString('ru-RU');
      const logLines = [];
      const now = ts();

      logLines.push('═══════════════════════════════════════════════════');
      logLines.push(' ДИАГНОСТИКА Control');
      logLines.push('═══════════════════════════════════════════════════');
      logLines.push(` Время: ${now}`);
      logLines.push(` Всего проверок: ${results.length}`);
      logLines.push(` Ошибок: ${failResults.length}`);
      logLines.push(` Предупреждений: ${warnResults.length + stoppedResults.length}`);
      logLines.push('───────────────────────────────────────────────────');

      results.forEach(r => {
        const icon = r.status === 'ok' ? '✓' : r.status === 'warn' ? '⚠' : r.status === 'stopped' ? '⏹' : '✗';
        logLines.push('');
        logLines.push(` ${icon} [${r.status.toUpperCase()}] ${r.test}`);
        logLines.push(`    → ${r.detail}`);
      });

      logLines.push('');
      logLines.push('───────────────────────────────────────────────────');

      // Issue analysis
      const issues = [];
      results.forEach(r => {
        if (r.status === 'fail') issues.push(`[КРИТИЧЕСКАЯ] ${r.test}: ${r.detail}`);
        else if (r.status === 'warn') issues.push(`[ПРЕДУПРЕЖДЕНИЕ] ${r.test}: ${r.detail}`);
        else if (r.status === 'stopped') issues.push(`[ОСТАНОВЛЕНО] ${r.test}: ${r.detail}`);
      });

      if (issues.length > 0) {
        logLines.push(' ВЫЯВЛЕННЫЕ ПРОБЛЕМЫ:');
        issues.forEach(iss => logLines.push(`  ${iss}`));
        logLines.push('');
      }

      logLines.push('═══════════════════════════════════════════════════');

      logEl.innerHTML = '';
      logLines.forEach(l => {
        const d = document.createElement('div'); d.className = 'log-line'; d.textContent = l;
        logEl.appendChild(d);
      });
    }
    ui.toast('Диагностика завершена', 'success');
  } catch {
    resEl.innerHTML = '<div class="msg msg-err"><i class="ti ti-alert-circle"></i><span>Ошибка выполнения диагностики</span><button class="msg-copy" title="Копировать"><i class="ti ti-copy"></i></button></div>';
    const errEl = resEl.querySelector('.msg-err');
    errEl?.querySelector('.msg-copy')?.addEventListener('click', () => {
      navigator.clipboard.writeText('Ошибка выполнения диагностики');
    });
  }
}

function clearLogs() {
  const logEl = document.getElementById('diag-log');
  if (logEl) { logEl.innerHTML = '';
    const d = document.createElement('div'); d.className = 'log-line'; d.textContent = '[system] Лог очищен';
    logEl.appendChild(d); }
}

function copyDiagnosticsLog() {
  const logEl = document.getElementById('diag-log');
  if (!logEl) return;
  const lines = Array.from(logEl.querySelectorAll('.log-line')).map(l => l.textContent).join('\n');
  if (!lines) { ui.toast('Лог пуст', 'info'); return; }
  navigator.clipboard.writeText(lines).then(() => {
    ui.toast('Лог скопирован', 'success');
  }).catch(() => {
    ui.toast('Не удалось скопировать', 'err');
  });
}
