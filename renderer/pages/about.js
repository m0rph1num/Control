// ═══════════════════════════════════════════════════════════════════════════════
// Control — About Page (Redesigned)
// ═══════════════════════════════════════════════════════════════════════════════

function renderAbout() {
  const page = document.getElementById("page-about");
  page.innerHTML = "";

  // ── Hero ─────────────────────────────────────────────────────────────────────
  const hero = document.createElement("div");
  hero.className = "about-hero";

  for (let i = 0; i < 3; i++) {
    const p = document.createElement("div");
    p.className = "about-particle";
    p.style.cssText = `--i:${i};--x:${20 + i * 30}%;--y:${10 + (i % 2) * 30}%;--d:${3 + i * 2}s;--s:${0.6 + i * 0.2};`;
    p.innerHTML = '<i class="ti ti-shield-lock-filled"></i>';
    hero.appendChild(p);
  }
  const glow = document.createElement("div");
  glow.className = "about-hero-glow";
  hero.appendChild(glow);

  const iconWrap = document.createElement("div");
  iconWrap.className = "about-hero-icon";
  // Load icon via preload — works in dev & prod without any custom protocol
  const iconDataUrl = window.api.getAssetDataUrl?.("app-icon.png");
  iconWrap.innerHTML = `
    <div class="about-hero-icon-inner">
      <img src="${iconDataUrl || "app-asset://app-icon.png"}" alt="Control" class="about-hero-img"
           onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
      <i class="ti ti-shield-lock-filled" style="display:none"></i>
    </div>`;
  hero.appendChild(iconWrap);

  const title = document.createElement("h1");
  title.className = "about-hero-title";
  title.textContent = "Control";
  hero.appendChild(title);

  const subtitle = document.createElement("p");
  subtitle.className = "about-hero-sub";
  subtitle.textContent = "Графическая оболочка для Flowseal Zapret";
  hero.appendChild(subtitle);

  const badgeRow = document.createElement("div");
  badgeRow.className = "about-hero-badges";
  const ver = window.homeState?.appVersion || '1.0.0';
  badgeRow.innerHTML = `
    <span class="about-badge about-badge-accent"><i class="ti ti-code"></i> v${ver}</span>
    <span class="about-badge about-badge-surface"><i class="ti ti-shield"></i> Flowseal</span>
    <span class="about-badge about-badge-surface"><i class="ti ti-window"></i> Windows 10+</span>`;
  hero.appendChild(badgeRow);

  const desc = document.createElement("div");
  desc.className = "about-hero-desc";
  desc.textContent = "Управляйте обходом DPI-блокировок без командной строки. Просто. Быстро. Надёжно.";
  hero.appendChild(desc);
  page.appendChild(hero);

  // ── Project Card (full-width) ───────────────────────────────────────────────
  page.appendChild(aboutProjectCard());

  // ── Developer Card ──────────────────────────────────────────────────────────
  page.appendChild(aboutDevCard("Morphine"));

  // ── Community & Links ────────────────────────────────────────────────────────
  const linksTitle = document.createElement("div");
  linksTitle.className = "about-section-title";
  linksTitle.innerHTML = '<span>Сообщество и ссылки</span><div class="about-section-line"></div>';
  page.appendChild(linksTitle);

  // Discord
  page.appendChild(aboutDiscordCard());

  // Compact link row
  const linksRow = document.createElement("div");
  linksRow.className = "about-links-row";
  linksRow.appendChild(
    aboutCompactCard("brand-github", "GitHub", "Исходный код проекта", () =>
      window.api.openExternal?.("https://github.com/m0rph1num/Control"),
    ),
  );
  linksRow.appendChild(
    aboutCompactCard("git-branch", "Zapret", "Оригинал от bol-van", () =>
      window.api.openExternal?.("https://github.com/bol-van/zapret"),
    ),
  );
  linksRow.appendChild(
    aboutCompactCard("cloud-download", "Flowseal", "Сборка с оптимизациями", () =>
      window.api.openExternal?.("https://github.com/Flowseal/zapret-discord-youtube"),
    ),
  );
  page.appendChild(linksRow);

  // ── Footer ─────────────────────────────────────────────────────────────────
  const footer = document.createElement("div");
  footer.className = "about-footer";
  footer.innerHTML = `
    <div class="about-footer-logo">
      <i class="ti ti-shield-lock-filled"></i>
      <span>Control</span>
    </div>
    <p>Распространяется под лицензией MIT</p>
    <p class="about-footer-copy">Copyright © 2026 Morphine. Все права сохранены за авторами оригинального Zapret.</p>
    <div class="about-footer-divider"></div>
    <p class="about-footer-thanks">
      <i class="ti ti-heart-filled"></i>
      Сделано с заботой о пользователях
    </p>`;
  page.appendChild(footer);

  requestAnimationFrame(() => {
    page.classList.add("about-ready");
  });
}

// ── Helper: Project Card (full-width) ──────────────────────────────────────

function aboutProjectCard() {
  const card = document.createElement("div");
  card.className = "about-project-card";

  const inner = document.createElement("div");
  inner.className = "about-project-inner";
  inner.innerHTML = `
    <div class="about-project-icon"><i class="ti ti-sparkles"></i></div>
    <div class="about-project-body">
      <h3>О проекте</h3>
      <p>Control — независимая графическая оболочка для сборки <strong>Flowseal Zapret</strong>. Мы не являемся авторами Zapret и не модифицируем его исходный код.</p>
      <div class="about-project-highlight">Наша цель — сделать обход DPI доступным для обычных пользователей, убрав необходимость работы с командной строкой.</div>
    </div>`;

  card.appendChild(inner);

  // Decorative accent line
  const accent = document.createElement("div");
  accent.className = "about-project-accent";
  card.appendChild(accent);

  return card;
}

// ── Helper: Developer Card ─────────────────────────────────────────────────

function aboutDevCard(name) {
  const card = document.createElement("div");
  card.className = "about-dev-card";

  const avatar = document.createElement("div");
  avatar.className = "about-dev-avatar";
  avatar.innerHTML = '<i class="ti ti-user"></i>';
  card.appendChild(avatar);

  const info = document.createElement("div");
  info.className = "about-dev-info";
  const label = document.createElement("div");
  label.className = "about-dev-label";
  label.textContent = "Разработчик";
  info.appendChild(label);

  const nick = document.createElement("div");
  nick.className = "about-dev-nick";
  nick.textContent = name;
  info.appendChild(nick);
  card.appendChild(info);

  const btns = document.createElement("div");
  btns.className = "about-dev-btns";
  btns.innerHTML = `
    <button class="about-dev-btn" data-tooltip="Discord" style="--btn-c:#5865F2">
      <i class="ti ti-brand-discord"></i>
    </button>
    <button class="about-dev-btn" data-tooltip="GitHub" style="--btn-c:#fff">
      <i class="ti ti-brand-github"></i>
    </button>`;
  btns
    .querySelector('[data-tooltip="Discord"]')
    .addEventListener("click", () => window.api.openExternal?.("https://discord.com/users/879420360347488266"));
  btns
    .querySelector('[data-tooltip="GitHub"]')
    .addEventListener("click", () => window.api.openExternal?.("https://github.com/m0rph1num"));
  card.appendChild(btns);

  return card;
}

// ── Helper: Discord Card ───────────────────────────────────────────────────

function aboutDiscordCard() {
  const card = document.createElement("div");
  card.className = "about-discord-card";

  const avatarWrap = document.createElement("div");
  avatarWrap.className = "about-discord-avatar";
  // Load GIF via preload — works in dev & prod without any custom protocol
  const gifDataUrl = window.api.getAssetDataUrl?.("discord-community.gif");
  avatarWrap.innerHTML = `
    <img src="${gifDataUrl || "app-asset://discord-community.gif"}" alt="Discord"
         onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
    <div class="about-discord-avatar-fallback">
      <i class="ti ti-brand-discord"></i>
    </div>`;
  card.appendChild(avatarWrap);

  const body = document.createElement("div");
  body.className = "about-discord-body";
  body.innerHTML = `
    <h4>Discord-сообщество</h4>
    <p>Monolith — техническое сообщество, обсуждение Zapret и Control.</p>`;
  card.appendChild(body);

  const btn = document.createElement("button");
  btn.className = "about-discord-btn";
  btn.innerHTML = '<span>Присоединиться</span><i class="ti ti-arrow-right"></i>';
  btn.addEventListener("click", () => window.api.openExternal?.("https://discord.gg/monolithium"));
  card.appendChild(btn);

  return card;
}

// ── Helper: Compact Link Card ─────────────────────────────────────────────

function aboutCompactCard(icon, title, subtitle, onClick) {
  const card = document.createElement("div");
  card.className = "about-compact-card";
  card.addEventListener("click", onClick);
  card.innerHTML = `
    <div class="about-compact-icon"><i class="ti ti-${icon}"></i></div>
    <div class="about-compact-title">${title}</div>
    <div class="about-compact-sub">${subtitle}</div>`;
  return card;
}
