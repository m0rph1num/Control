import type {
  AppInfo,
  AppliedProfile,
  DiagnosticCheck,
  DiagnosticsReport,
  EnvironmentChecks,
  ElevationPlan,
  FakesInfo,
  InstalledVersion,
  OperationSnapshot,
  PresetInfo,
  Profile,
  ProtectionSnapshot,
  ReleaseInfo,
  ServiceStatus,
  StartupFlags,
  StrategyInfo,
  TgwsInstallResult,
  TgwsStatus,
  UserList,
} from "./index";

const tauriRuntime = (): unknown =>
  typeof window === "undefined"
    ? undefined
    : (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;

export const isDemoRuntime = (): boolean => tauriRuntime() === undefined;

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
const opId = () => crypto.randomUUID();

type Handler = (payload: unknown) => void;
const listeners = new Map<string, Set<Handler>>();

function emit(event: string, payload: unknown): void {
  listeners.get(event)?.forEach((h) => h(payload));
}

export function demoListen<T>(event: string, handler: (p: T) => void): Promise<() => void> {
  const set = listeners.get(event) ?? new Set<Handler>();
  set.add(handler as Handler);
  listeners.set(event, set);
  return Promise.resolve(() => {
    set.delete(handler as Handler);
  });
}

let revision = 1;
let protection: ProtectionSnapshot = {
  state: "stopped",
  detail: "Защита остановлена (демо)",
  revision,
};

const operations = new Map<string, OperationSnapshot>();

const settings: Record<string, unknown> = {
  controlDir: "C:\\Users\\Demo\\AppData\\Roaming\\control",
  minimizeToTray: true,
  notifications: true,
  restoreState: true,
  selectedVersion: "zapret-discord-youtube-72.1",
};

const flowsealConfig: Record<string, unknown> = {
  strategy: "general (YouTube and Discord).bat",
  discordFilter: "loaded",
  gameFilter: "disabled",
};

const strategies: StrategyInfo[] = [
  { value: "general.bat", filename: "general (YouTube and Discord).bat", label: "general (YouTube and Discord)", path: "C:\\…\\general.bat", kind: "version" },
  { value: "game_filter.bat", filename: "gameFilter (Discord, YouTube, Steam download).bat", label: "gameFilter (Discord, YouTube, Steam download)", path: "C:\\…\\game_filter.bat", kind: "version" },
  { value: "preset:Мой пресет", filename: "Мой пресет.bat", label: "★ Мой пресет", path: "preset:Мой пресет", kind: "preset" },
];

const presets: PresetInfo[] = [
  { name: "Мой пресет", filename: "Мой пресет.bat", content: "--filter-tcp=443 --dpi-desync=splitsplit2\r\n" },
];

const lists: UserList[] = [
  { key: "discord", filename: "ipset-discord.txt", label: "Discord", content: "162.159.128.0/24\r\n", exists: true },
  { key: "youtube", filename: "ipset-youtube.txt", label: "YouTube", content: "74.125.0.0/16\r\n", exists: true },
];

const fakes: FakesInfo = {
  fakes: ["fake tls", "fake http"],
  currentDiscord: "fake tls",
  currentGame: null,
};

const versions: InstalledVersion[] = [
  { folder: "zapret-discord-youtube-72.1", version: "72.1", selected: true, hasWinws: true },
  { folder: "zapret-discord-youtube-71.2", version: "71.2", selected: false, hasWinws: true },
];

const releases: ReleaseInfo[] = [
  { version: "73.0.0", assetName: "zapret-discord-youtube-73.0.0.zip", assetUrl: "https://example/73.0.0.zip", notes: "Демо-релиз" },
  { version: "72.1.0", assetName: "zapret-discord-youtube-72.1.0.zip", assetUrl: "https://example/72.1.0.zip", notes: null },
];

const service: ServiceStatus = { installed: false, running: false };
const windivert: ServiceStatus = { installed: true, running: false };

const nowIso = () => new Date().toISOString();
let profiles: Profile[] = [
  {
    id: "demo-profile-youtube",
    name: "YouTube + Discord",
    description: "Рабочая связка для YouTube и Discord. Проверена на провайдере.",
    strategy: "general.bat",
    gameFilter: "disabled",
    ipset: "loaded",
    fakes: { discord: "fake tls", game: null },
    lists: {},
    createdAt: "2026-10-02T09:12:00.000Z",
    updatedAt: "2026-11-04T18:41:00.000Z",
    source: "local",
  },
  {
    id: "demo-profile-games",
    name: "Игры · Steam",
    description: "Игровой фильтр TCP+UDP для Steam и Discord.",
    strategy: "game_filter.bat",
    gameFilter: "all",
    ipset: "loaded",
    fakes: { discord: "fake tls", game: "fake http" },
    lists: {},
    createdAt: "2026-09-21T12:30:00.000Z",
    updatedAt: "2026-10-27T10:05:00.000Z",
    source: "local",
  },
];

let tgws: TgwsStatus = {
  installed: true,
  running: false,
  host: "127.0.0.1",
  port: 1443,
  secret: "dd0123456789abcdef0123456789abcdef",
  link: "tg://proxy?server=127.0.0.1&port=1443&secret=dd0123456789abcdef0123456789abcdef",
  configExists: true,
  exePath: "C:\\Users\\Demo\\AppData\\Roaming\\control\\tgws\\TgWsProxy_windows.exe",
  autostart: false,
};

const tgwsLog = [
  "2026-11-17 12:01:04 INFO  TgWsProxy 1.11.4 — старт",
  "2026-11-17 12:01:04 INFO  Порт 127.0.0.1:1443, secret загружен из config.json",
  "2026-11-17 12:01:05 INFO  Подключение к DC 2 через Cloudflare WS",
  "2026-11-17 12:01:06 WARN  Таймаут handshake, повтор через 1 с",
  "2026-11-17 12:01:07 INFO  Туннель установлен",
];

let autostartEnabled = false;

const DIAG_DEFS: { id: string; group: string; title: string; hint: string }[] = [
  { id: "admin", group: "Система", title: "Права администратора", hint: "не обязательны для обычного запуска" },
  { id: "data-dir", group: "Система", title: "Папка данных Control", hint: "C:\\Users\\Demo\\AppData\\Roaming\\control" },
  { id: "settings", group: "Система", title: "Файл настроек", hint: "ключей: 5 · версия: zapret-discord-youtube-72.1" },
  { id: "install", group: "Zapret", title: "Установка Zapret найдена", hint: "C:\\…\\zapret-discord-youtube-72.1" },
  { id: "winws", group: "Zapret", title: "Бинарник winws.exe", hint: "22.4 МБ" },
  { id: "strategies", group: "Zapret", title: "Файлы стратегий", hint: "найдено 12" },
  { id: "lists", group: "Zapret", title: "Пользовательские списки", hint: "файлов: 4 из 4" },
  { id: "fakes", group: "Zapret", title: "Fake-файлы", hint: "доступно: 6" },
  { id: "windivert-service", group: "WinDivert", title: "Служба WinDivert", hint: "запущена" },
  { id: "windivert-driver", group: "WinDivert", title: "Драйвер WinDivert", hint: "WinDivert64.sys" },
  { id: "process", group: "Защита", title: "Процесс winws.exe", hint: "PID 4812" },
  { id: "service", group: "Защита", title: "Служба автозапуска zapret", hint: "не установлена (запуск через Control)" },
  { id: "tcp", group: "Сеть", title: "TCP-соединение (1.1.1.1:443)", hint: "соединение установлено" },
  { id: "dns", group: "Сеть", title: "DNS-разрешение", hint: "github.com → 140.82.121.3" },
  { id: "https", group: "Сеть", title: "HTTPS-доступ к GitHub", hint: "HTTP 200" },
  { id: "external", group: "Сеть", title: "Другая установка Zapret", hint: "конфликтов нет" },
  { id: "tgws", group: "TG Proxy", title: "TG WS Proxy", hint: "установлен, не запущен" },
  { id: "tgws-port", group: "TG Proxy", title: "Порт локального прокси", hint: "127.0.0.1:1443 свободен" },
  { id: "disk", group: "Система", title: "Свободное место на диске", hint: "48.2 ГБ" },
];

const WARN_IDS = new Set(["admin", "windivert-service", "external", "tgws"]);

function begin(kind: string, cancelable = true): string {
  const snap: OperationSnapshot = {
    id: opId(),
    kind,
    status: "queued",
    message: "В очереди",
    revision: 0,
    cancelable,
  };
  operations.set(snap.id, snap);
  emit("operation://state", snap);
  return snap.id;
}

function update(id: string, patch: Partial<OperationSnapshot>): void {
  const cur = operations.get(id);
  if (!cur) return;
  const next = { ...cur, ...patch, revision: cur.revision + 1 };
  operations.set(id, next);
  emit("operation://state", next);
}

function finish(
  id: string,
  status: OperationSnapshot["status"],
  message: string,
  progress?: OperationSnapshot["progress"] | undefined,
): void {
  update(id, {
    status,
    message,
    ...(progress === undefined ? {} : { progress }),
  });
  cancellationFlags.delete(id);
  setTimeout(() => operations.delete(id), 2000);
}

const cancellationFlags = new Map<string, () => void>();

async function runOp(
  kind: string,
  work: (ctx: { progress: (cur: number, total: number) => void; cancelled: () => boolean }) => Promise<void>,
  opts: { cancelable?: boolean; steps?: number; stepMs?: number } = {},
): Promise<string> {
  const cancelable = opts.cancelable ?? false;
  const id = begin(kind, cancelable);
  let cancelledFlag = false;
  if (cancelable) cancellationFlags.set(id, () => { cancelledFlag = true; });
  update(id, { status: "running", message: "Выполняется" });
  const steps = opts.steps ?? 0;
  const stepMs = opts.stepMs ?? 150;
  const progress = (cur: number, total: number) =>
    update(id, { progress: { current: cur, total, message: `${cur} из ${total}` } });
  const cancelled = () => cancelledFlag;
  const stepper = (async () => {
    for (let i = 1; i <= steps; i++) {
      await delay(stepMs);
      progress(i, steps);
      if (cancelled()) throw new Error("cancelled");
    }
  })();
  try {
    if (steps > 0) await stepper;
    else await work({ progress, cancelled });
    finish(id, "succeeded", "Готово");
    return id;
  } catch {
    finish(id, cancelled() ? "cancelled" : "failed", cancelled() ? "Отменено" : "Ошибка (демо)");
    throw new Error(cancelled() ? "Операция отменена" : "Ошибка операции (демо)");
  }
}

function setProtection(state: ProtectionSnapshot["state"], detail: string): void {
  revision += 1;
  protection = { state, detail, revision };
  emit("protection://state", protection);
}

export const demoApi = {
  getAppInfo: async (): Promise<AppInfo> => ({ name: "Control", version: "2.0.0 (демо)" }),
  startupFlags: async (): Promise<StartupFlags> => ({ minimized: false }),
  protectionStatus: async (): Promise<ProtectionSnapshot> => protection,
  protectionSnapshot: async (): Promise<ProtectionSnapshot> => protection,
  protectionStart: async (strategyValue: string): Promise<string> => {
    setProtection("starting", `Запуск: ${strategyValue} (демо)`);
    const id = await runOp(
      "protection_start",
      async () => undefined,
      { cancelable: true, steps: 10, stepMs: 250 },
    );
    setProtection("active", "winws.exe работает (демо)");
    return id;
  },
  protectionStop: async (): Promise<string> => {
    setProtection("stopping", "Остановка (демо)");
    const id = await runOp("protection_stop", async () => undefined, { steps: 8, stepMs: 150 });
    setProtection("stopped", "Защита остановлена (демо)");
    return id;
  },
  protectionApply: async (strategyValue: string): Promise<boolean> => {
    if (protection.state !== "active") return false;
    setProtection("starting", `Применяю ${strategyValue} (демо)`);
    await runOp("protection_reconfigure", async () => undefined, { steps: 6, stepMs: 90 });
    setProtection("active", "Настройки применены · winws перезапущен (демо)");
    return true;
  },
  operationsList: async (): Promise<OperationSnapshot[]> => [...operations.values()],
  operationsCancel: async (operationId: string): Promise<boolean> => {
    const cur = operations.get(operationId);
    if (!cur || ["succeeded", "failed", "cancelled"].includes(cur.status)) return false;
    cancellationFlags.get(operationId)?.();
    update(operationId, { status: "cancelled", message: "Отменено" });
    cancellationFlags.delete(operationId);
    setTimeout(() => operations.delete(operationId), 2000);
    return true;
  },
  serviceStatus: async (): Promise<ServiceStatus> => service,
  windivertStatus: async (): Promise<ServiceStatus> => windivert,
  strategiesList: async (): Promise<StrategyInfo[]> => strategies,
  settingsGet: async (): Promise<Record<string, unknown>> => ({ ...settings }),
  settingsSet: async (value: Record<string, unknown>) => {
    Object.assign(settings, value);
  },
  settingsUpdate: async (options: Record<string, unknown>) => {
    Object.assign(settings, options);
  },
  flowsealConfigGet: async (): Promise<Record<string, unknown>> => ({ ...flowsealConfig }),
  flowsealConfigSet: async (value: Record<string, unknown>) => {
    Object.assign(flowsealConfig, value);
  },
  listsGet: async (): Promise<UserList[]> => lists.map((l) => ({ ...l })),
  listsWrite: async (key: string, content: string) => {
    const l = lists.find((x) => x.key === key);
    if (l) l.content = content;
  },
  gameFilterGet: async () => flowsealConfig.gameFilter as "disabled" | "all" | "tcp" | "udp",
  gameFilterSet: async (mode: "disabled" | "all" | "tcp" | "udp") => {
    flowsealConfig.gameFilter = mode;
  },
  ipsetFilterGet: async () => flowsealConfig.discordFilter as "loaded" | "any" | "none",
  ipsetFilterSet: async (mode: "loaded" | "any" | "none") => {
    flowsealConfig.discordFilter = mode;
  },
  fakesGet: async (): Promise<FakesInfo> => ({ ...fakes }),
  fakesSet: async (fakeType: "discord" | "game", fakeName: string) => {
    if (fakeType === "discord") fakes.currentDiscord = fakeName;
    else fakes.currentGame = fakeName;
  },
  backupBuild: async (): Promise<Record<string, unknown>> => ({
    format: "control-backup-1",
    demo: true,
    settings,
    flowsealConfig,
  }),
  backupExportFile: async () => undefined,
  backupImportFile: async (path: string) => {
    await runOp("backup_import", async () => undefined, { steps: 5, stepMs: 160 });
    void path;
  },
  versionsList: async (): Promise<InstalledVersion[]> => versions.map((v) => ({ ...v })),
  versionsAvailable: async (): Promise<ReleaseInfo[]> => releases.map((r) => ({ ...r })),
  versionsDownload: async (
    version: string,
    _assetUrl: string,
    _assetName: string,
  ): Promise<{ operationId: string; archivePath: string }> => {

    const archivePath = "C:\\Users\\Demo\\AppData\\Local\\Temp\\zapret-demo.zip";
    const id = begin("download", true);
    let cancelledFlag = false;
    cancellationFlags.set(id, () => {
      cancelledFlag = true;
    });
    update(id, { status: "running", message: "Выполняется" });
    void (async () => {

      const total = 25_165_824;
      for (let i = 1_048_576; i <= total; i += 1_048_576) {
        await delay(320);
        if (cancelledFlag) {
          finish(id, "cancelled", "Отменено");
          return;
        }
        update(id, { progress: { current: i, total, message: `${Math.round(i / 1_048_576)} из ${Math.round(total / 1_048_576)} МБ` } });
      }
      finish(id, "succeeded", `Скачан zapret ${version} (демо): ${archivePath}`);
    })();
    return { operationId: id, archivePath };
  },
  versionsInstall: async (version: string, _tempArchive: string): Promise<InstalledVersion> => {
    await runOp("versions_install", async () => undefined, { steps: 12, stepMs: 150 });
    versions.forEach((v) => (v.selected = false));
    const item: InstalledVersion = {
      folder: `zapret-discord-youtube-${version}`,
      version,
      selected: true,
      hasWinws: true,
    };
    versions.unshift(item);
    settings.selectedVersion = item.folder;
    return { ...item };
  },
  versionsDelete: async (folder: string) => {
    const idx = versions.findIndex((v) => v.folder === folder);
    if (idx >= 0) versions.splice(idx, 1);
  },
  versionsSelect: async (folder: string): Promise<boolean> => {
    const target = versions.find((v) => v.folder === folder);
    if (!target) throw new Error("Версия не найдена (демо)");
    versions.forEach((v) => (v.selected = v.folder === folder));
    settings.selectedVersion = folder;
    const live = protection.state === "active";
    if (live) {
      setProtection("starting", `Переключаюсь на ${folder} (демо)`);
      await delay(700);
      setProtection("active", `winws перезапущен на ${folder} (демо)`);
    }
    return live;
  },
  versionsOpenFolder: async (folder: string) => {
    void folder;
  },
  serviceInstallPlan: async (): Promise<ElevationPlan> => ({
    planVersion: 1,
    description: "Установка службы автозапуска zapret (демо)",
    steps: [
      { action: "create_service", name: "zapret", binPath: "C:\\…\\service.cmd" },
      { action: "start_service", name: "zapret" },
    ],
  }),
  serviceInstall: async (): Promise<ServiceStatus> => {
    await runOp("service_install", async () => undefined, { steps: 10, stepMs: 150 });
    service.installed = true;
    service.running = true;
    return { ...service };
  },
  serviceRemove: async (): Promise<ServiceStatus> => {
    await runOp("service_remove", async () => undefined, { steps: 7, stepMs: 150 });
    service.installed = false;
    service.running = false;
    return { ...service };
  },
  setupRunChecks: async (): Promise<EnvironmentChecks> => ({
    admin: true,
    winDivertInstalled: true,
    internet: true,
    dns: true,
    existingRunning: false,
    existingInstallPath: "C:\\Users\\Demo\\AppData\\Roaming\\control",
    defaultDir: "C:\\Users\\Demo\\AppData\\Roaming\\control",
  }),
  setupDefaultDir: async (): Promise<string> => "C:\\Users\\Demo\\AppData\\Roaming\\control",
  setupApply: async (options: Record<string, unknown>) => {
    Object.assign(settings, options);
  },
  controlSelectVersion: async (versionFolder: string) => {
    versions.forEach((v) => (v.selected = v.folder === versionFolder));
    settings.selectedVersion = versionFolder;
  },
  presetsList: async (): Promise<PresetInfo[]> => presets.map((p) => ({ ...p })),
  presetSave: async (name: string, content: string) => {
    const p = presets.find((x) => x.name === name);
    if (p) p.content = content;
    else presets.push({ name, filename: `${name}.bat`, content });
    if (!strategies.some((s) => s.kind === "preset" && s.value === `preset:${name}`)) {
      strategies.push({
        value: `preset:${name}`,
        filename: `${name}.bat`,
        label: `★ ${name}`,
        path: `preset:${name}`,
        kind: "preset",
      });
    }
  },
  presetDelete: async (name: string) => {
    const idx = presets.findIndex((p) => p.name === name);
    if (idx >= 0) presets.splice(idx, 1);
    const sIdx = strategies.findIndex((s) => s.value === `preset:${name}`);
    if (sIdx >= 0) strategies.splice(sIdx, 1);
  },
  profilesList: async (): Promise<Profile[]> =>
    [...profiles]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((p) => ({ ...p, fakes: { ...p.fakes }, lists: { ...p.lists } })),
  profileSave: async (profile: Profile): Promise<Profile> => {
    const now = nowIso();
    const next: Profile = {
      ...profile,
      id: profile.id || crypto.randomUUID(),
      createdAt: profile.createdAt || now,
      updatedAt: now,
      source: profile.source || "local",
    };
    const idx = profiles.findIndex((p) => p.id === next.id);
    if (idx >= 0) profiles[idx] = next;
    else profiles.push(next);
    return { ...next };
  },
  profileDelete: async (id: string) => {
    profiles = profiles.filter((p) => p.id !== id);
  },
  profileApply: async (id: string): Promise<AppliedProfile> => {
    const profile = profiles.find((p) => p.id === id);
    if (!profile) throw new Error("Профиль не найден (демо)");
    const live = protection.state === "active";
    if (live) {
      setProtection("starting", `Применяю профиль «${profile.name}» (демо)`);
      await delay(800);
      setProtection("active", `Профиль «${profile.name}» применён (демо)`);
    }
    flowsealConfig.gameFilter = profile.gameFilter;
    flowsealConfig.discordFilter = profile.ipset;
    settings.lastStrategy = profile.strategy;
    return { strategy: profile.strategy, liveApplied: live };
  },
  profileExportText: async (id: string): Promise<string> => {
    const profile = profiles.find((p) => p.id === id);
    if (!profile) throw new Error("Профиль не найден (демо)");
    return JSON.stringify({ format: "control-profile-1", ...profile }, null, 2);
  },
  profileExportFile: async (_path: string, _id: string) => undefined,
  profileImportText: async (text: string): Promise<Profile> => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error("Это не похоже на профиль Control (демо)");
    }
    const raw = (parsed as { profile?: Partial<Profile> }).profile ?? (parsed as Partial<Profile>);
    if (!raw || typeof raw.name !== "string" || typeof raw.strategy !== "string") {
      throw new Error("Профиль имеет неверный формат (демо)");
    }
    const now = nowIso();
    const imported: Profile = {
      id: crypto.randomUUID(),
      name: raw.name,
      description: raw.description ?? "",
      strategy: raw.strategy,
      gameFilter: raw.gameFilter ?? "disabled",
      ipset: raw.ipset ?? "loaded",
      fakes: raw.fakes ?? { discord: null, game: null },
      lists: raw.lists ?? {},
      createdAt: now,
      updatedAt: now,
      source: "imported",
    };
    profiles.push(imported);
    return { ...imported };
  },
  profilesOpenFolder: async () => undefined,
  diagnosticsRun: async (): Promise<DiagnosticsReport> => {
    const checks: DiagnosticCheck[] = DIAG_DEFS.map((d) => ({
      id: d.id,
      group: d.group,
      title: d.title,
      status: "pending",
      detail: "Ожидает запуска",
      durationMs: 0,
    }));
    checks.forEach((c) => emit("diagnostics://check", { ...c }));
    for (let i = 0; i < checks.length; i++) {
      const check = checks[i];
      const def = DIAG_DEFS[i];
      if (!check || !def) continue;
      check.status = "running";
      check.detail = "Выполняется…";
      emit("diagnostics://check", { ...check });
      await delay(90 + (i % 4) * 45);
      const warning = WARN_IDS.has(check.id);
      check.status = warning ? "warning" : "ok";
      check.detail = def.hint;
      if (warning) check.hint = "Демонстрационное замечание — в реальном режиме проверка выполняется на этом компьютере.";
      check.durationMs = 20 + ((i * 37) % 240);
      emit("diagnostics://check", { ...check });
      await delay(25);
    }
    const ok = checks.filter((c) => c.status === "ok").length;
    const warnings = checks.filter((c) => c.status === "warning").length;
    const errors = checks.filter((c) => c.status === "error").length;
    const generatedAt = nowIso();
    const durationMs = 3400;
    const markdown = [
      "# Control · отчёт диагностики (демо)",
      "",
      `- Сформирован: ${generatedAt}`,
      "- Версия Control: 2.0.0",
      "- ОС: Windows (демо-режим)",
      `- Итог: ${ok} OK · ${warnings} замечаний · ${errors} ошибок · 3.4 с`,
      "",
      "## Все проверки",
      "",
      ...checks.map(
        (c) =>
          `- ${c.status === "ok" ? "✅" : c.status === "warning" ? "⚠️" : "❌"} **${c.title}** (\`${c.id}\`, ${c.durationMs} мс)\n  - Детали: ${c.detail}`,
      ),
    ].join("\n");
    return {
      checks,
      ok,
      warnings,
      errors,
      generatedAt,
      durationMs,
      markdown,
      context: {
        appVersion: "2.0.0",
        os: "Microsoft Windows (демо)",
        arch: "AMD64",
        admin: false,
        dataDir: "C:\\Users\\Demo\\AppData\\Roaming\\control",
        settingsFile: "C:\\Users\\Demo\\AppData\\Roaming\\control\\settings.json",
        controlDir: "C:\\Users\\Demo\\AppData\\Roaming\\control",
        installDir: "C:\\Users\\Demo\\AppData\\Roaming\\control\\zapret",
        strategies: 12,
        serviceInstalled: false,
        serviceRunning: false,
        windivertInstalled: true,
        windivertRunning: true,
        tgwsInstalled: true,
        tgwsRunning: true,
        tgwsPort: 1443,
        autostartControl: autostartEnabled,
        autostartZapret: false,
        logPath: "C:\\Users\\Demo\\AppData\\Roaming\\control\\logs\\control.log",
        logTail: [],
      },
    };
  },
  tgwsStatus: async (): Promise<TgwsStatus> => ({ ...tgws }),
  tgwsInstall: async (): Promise<TgwsInstallResult> => {
    await runOp("tgws_install", async () => undefined, { steps: 10, stepMs: 120 });
    tgws.installed = true;
    tgws.configExists = true;
    return {
      version: "v1.11.4",
      path: tgws.exePath ?? "C:\\…\\TgWsProxy_windows.exe",
      size: 12_582_912,
    };
  },
  tgwsStart: async (): Promise<TgwsStatus> => {
    await delay(900);
    tgws.running = true;
    tgws.pid = 7412;
    return { ...tgws };
  },
  tgwsStop: async (): Promise<TgwsStatus> => {
    await delay(400);
    tgws.running = false;
    delete tgws.pid;
    return { ...tgws };
  },
  tgwsUninstall: async (): Promise<TgwsStatus> => {
    await delay(300);
    tgws = {
      installed: false,
      running: false,
      host: "127.0.0.1",
      port: 1443,
      configExists: false,
      autostart: false,
    };
    return { ...tgws };
  },
  tgwsSetPort: async (port: number): Promise<TgwsStatus> => {
    tgws.port = port;
    tgws.link = `tg://proxy?server=${tgws.host}&port=${port}&secret=${tgws.secret ?? ""}`;
    if (tgws.running) {
      tgws.running = false;
      await delay(600);
      tgws.running = true;
    }
    return { ...tgws };
  },
  tgwsOpenTelegram: async () => undefined,
  tgwsLogs: async (lines?: number): Promise<string[]> =>
    tgwsLog.slice(-(lines ?? 120)),
  autostartGet: async (): Promise<boolean> => autostartEnabled,
  autostartInfo: async () => ({
    enabled: autostartEnabled,
    current: autostartEnabled,
    command: autostartEnabled ? '"C:\\Program Files\\Control\\Control.exe" --minimized' : null,
  }),
  autostartSet: async (enabled: boolean): Promise<boolean> => {
    autostartEnabled = enabled;
    return autostartEnabled;
  },
};
