import { errorText } from "@/shared/error";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  api,
  type InstalledVersion,
  type Profile,
  type ProtectionSnapshot,
  type StrategyInfo,
  type TgwsStatus,
} from "@/shared/api";
import { useDesign, type ThemeMode } from "@/shared/theme";
import type { PaletteItem } from "@/components/fx/command-palette";
import type { IconName } from "@/shared/ui/Icon";

export interface PaletteTab {
  id: string;
  label: string;
  hint: string;
  icon: IconName;
}

interface PaletteData {
  strategies: StrategyInfo[];
  profiles: Profile[];
  versions: InstalledVersion[];
  tgws: TgwsStatus | null;
  snapshot: ProtectionSnapshot | null;
  autostart: boolean | null;
}

const EMPTY: PaletteData = {
  strategies: [],
  profiles: [],
  versions: [],
  tgws: null,
  snapshot: null,
  autostart: null,
};

const TAB_KEYWORDS: Record<string, string[]> = {
  protection: ["защита", "winws", "zapret", "обход", "dpi", "старт", "стоп", "стратегия"],
  profiles: ["профили", "сборка", "настройки", "пресет"],
  filters: ["фильтры", "список", "fake", "ipset", "игра", "discord"],
  tgproxy: ["telegram", "телеграм", "mtproto", "прокси", "tg"],
  versions: ["версии", "zapret", "сборка", "обновление", "release"],
  backup: ["бэкап", "резервная", "копия", "экспорт", "импорт"],
  diagnostics: ["диагностика", "проверка", "система", "отчёт"],
  settings: ["настройки", "автозапуск", "трей", "тема", "приложение"],
};

const THEME_LABEL: Record<ThemeMode, string> = {
  light: "светлая",
  dark: "тёмная",
  system: "как в системе",
};

function task(loading: string, run: () => Promise<unknown>, success: string): void {
  const id = toast.loading(loading);
  run()
    .then(() => toast.success(success, { id }))
    .catch((error) =>
      toast.error("Не удалось выполнить действие", { id, description: errorText(error) }),
    );
}

export function usePaletteItems({
  open,
  go,
  tabs,
}: {
  open: boolean;
  go: (tab: string) => void;
  tabs: PaletteTab[];
}): PaletteItem[] {
  const { theme, setTheme } = useDesign();
  const [data, setData] = useState<PaletteData>(EMPTY);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    void Promise.allSettled([
      api.strategiesList(),
      api.profilesList(),
      api.versionsList(),
      api.tgwsStatus(),
      api.protectionSnapshot(),
      api.autostartGet(),
    ]).then(([strategies, profiles, versions, tgws, snapshot, autostart]) => {
      if (!alive) return;
      setData({
        strategies: strategies.status === "fulfilled" ? strategies.value : [],
        profiles: profiles.status === "fulfilled" ? profiles.value : [],
        versions: versions.status === "fulfilled" ? versions.value : [],
        tgws: tgws.status === "fulfilled" ? tgws.value : null,
        snapshot: snapshot.status === "fulfilled" ? snapshot.value : null,
        autostart: autostart.status === "fulfilled" ? autostart.value : null,
      });
    });
    return () => {
      alive = false;
    };
  }, [open]);

  return useMemo(() => {
    const items: PaletteItem[] = tabs.map((tab) => ({
      id: `tab:${tab.id}`,
      group: "Разделы",
      label: tab.label,
      hint: tab.hint,
      icon: tab.icon,
      keywords: [tab.hint, ...(TAB_KEYWORDS[tab.id] ?? [])],
      run: () => go(tab.id),
    }));

    const active = data.snapshot?.state === "active";

    if (active) {
      items.push({
        id: "protection:stop",
        group: "Защита",
        label: "Остановить защиту",
        hint: "Завершить winws",
        icon: "stop-circle-bold",
        keywords: ["стоп", "выключить", "zapret", "winws"],
        run: () => task("Останавливаю защиту…", api.protectionStop, "Защита остановлена"),
      });
    }

    for (const strategy of data.strategies) {
      items.push(
        active
          ? {
              id: `protection:apply:${strategy.value}`,
              group: "Защита",
              label: `Стратегия · ${strategy.label}`,
              hint: "Применить без остановки службы",
              icon: "bolt-circle-bold",
              keywords: [strategy.filename, "стратегия", "сменить", "применить"],
              run: () =>
                task(
                  `Применяю «${strategy.label}»…`,
                  () => api.protectionApply(strategy.value),
                  "Стратегия применена",
                ),
            }
          : {
              id: `protection:start:${strategy.value}`,
              group: "Защита",
              label: `Запустить защиту · ${strategy.label}`,
              hint: "Запуск winws с этой стратегией",
              icon: "play-circle-bold",
              keywords: [strategy.filename, "запуск", "старт", "включить"],
              run: () =>
                task(
                  `Запускаю «${strategy.label}»…`,
                  () => api.protectionStart(strategy.value),
                  "Защита запущена",
                ),
            },
      );
    }

    for (const profile of data.profiles) {
      items.push({
        id: `profile:apply:${profile.id}`,
        group: "Профили",
        label: `Применить профиль · ${profile.name}`,
        hint: profile.description || "Своя сборка настроек",
        icon: "database-bold",
        keywords: ["профиль", "применить", "настройки", profile.strategy],
        run: () =>
          task(
            `Применяю «${profile.name}»…`,
            () => api.profileApply(profile.id),
            "Профиль применён",
          ),
      });
    }

    for (const version of data.versions) {
      items.push({
        id: `version:select:${version.folder}`,
        group: "Версии",
        label: `Zapret v${version.version}`,
        hint: version.selected ? "Текущая версия" : version.folder,
        icon: "box-minimalistic-bold",
        keywords: ["версия", "zapret", "переключить", version.folder],
        run: () =>
          task(
            `Переключаюсь на v${version.version}…`,
            () => api.versionsSelect(version.folder),
            `Активная версия — v${version.version}`,
          ),
      });
    }

    const tgws = data.tgws;
    if (tgws?.running) {
      items.push({
        id: "tgproxy:stop",
        group: "TG Proxy",
        label: "Остановить TG Proxy",
        hint: "Локальный MTProto-прокси",
        icon: "stop-circle-bold",
        keywords: ["telegram", "прокси", "стоп"],
        run: () => task("Останавливаю прокси…", api.tgwsStop, "TG Proxy остановлен"),
      });
    } else if (tgws?.installed) {
      items.push({
        id: "tgproxy:start",
        group: "TG Proxy",
        label: "Запустить TG Proxy",
        hint: "Локальный MTProto-прокси",
        icon: "play-circle-bold",
        keywords: ["telegram", "прокси", "старт"],
        run: () => task("Запускаю прокси…", api.tgwsStart, "TG Proxy запущен"),
      });
    } else {
      items.push({
        id: "tgproxy:install",
        group: "TG Proxy",
        label: "Скачать и установить TG Proxy",
        hint: "Официальная сборка TgWsProxy",
        icon: "download-minimalistic-bold",
        keywords: ["telegram", "прокси", "установить", "скачать"],
        run: () => task("Скачиваю TG Proxy…", api.tgwsInstall, "TG Proxy установлен"),
      });
    }

    if (tgws?.installed) {
      items.push({
        id: "tgproxy:telegram",
        group: "TG Proxy",
        label: "Открыть Telegram через прокси",
        hint: "Добавить прокси в Telegram",
        icon: "widget-4-bold",
        keywords: ["telegram", "телеграм", "открыть"],
        run: () => task("Открываю Telegram…", api.tgwsOpenTelegram, "Telegram открыт"),
      });
      items.push({
        id: "tgproxy:logs",
        group: "TG Proxy",
        label: "Журнал TG Proxy",
        hint: "Открыть раздел и показать записи",
        icon: "document-text-bold",
        keywords: ["журнал", "лог", "logs", "ошибки"],
        run: () => go("tgproxy"),
      });
    }

    items.push({
      id: "system:diagnostics",
      group: "Система",
      label: "Проверить систему",
      hint: "Живые проверки Zapret и WinDivert",
      icon: "pulse-bold",
      keywords: ["диагностика", "проверка", "отчёт", "система"],
      run: () => go("diagnostics"),
    });
    items.push({
      id: "system:backup",
      group: "Система",
      label: "Резервная копия",
      hint: "Экспорт и восстановление настроек",
      icon: "archive-bold",
      keywords: ["бэкап", "экспорт", "импорт", "копия"],
      run: () => go("backup"),
    });
    items.push({
      id: "system:profiles-folder",
      group: "Система",
      label: "Открыть папку профилей",
      hint: "Проводник Windows",
      icon: "folder-open-bold",
      keywords: ["папка", "проводник", "профили"],
      run: () => task("Открываю папку…", api.profilesOpenFolder, "Папка открыта"),
    });

    if (data.autostart !== null) {
      items.push({
        id: "system:autostart",
        group: "Система",
        label: data.autostart ? "Выключить автозапуск" : "Включить автозапуск",
        hint: "Запуск Control вместе с Windows",
        icon: "monitor-bold",
        keywords: ["автозапуск", "windows", "трей", "старт"],
        run: () => {
          const next = !data.autostart;
          task(
            next ? "Включаю автозапуск…" : "Выключаю автозапуск…",
            () => api.autostartSet(next),
            next ? "Автозапуск включён" : "Автозапуск выключен",
          );
        },
      });
    }

    for (const mode of ["light", "dark", "system"] as ThemeMode[]) {
      if (mode === theme) continue;
      items.push({
        id: `system:theme:${mode}`,
        group: "Система",
        label: `Тема · ${THEME_LABEL[mode]}`,
        hint: "Оформление приложения",
        icon: mode === "light" ? "sun-bold" : mode === "dark" ? "moon-stars-bold" : "monitor-bold",
        keywords: ["тема", "оформление", THEME_LABEL[mode]],
        run: () => {
          setTheme(mode);
        },
      });
    }

    return items;
  }, [tabs, go, data, theme, setTheme]);
}
