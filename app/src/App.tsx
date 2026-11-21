import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
  Component,
  type ComponentType,
  type ReactNode,
} from "react";
import { cn } from "cn";
import { Toaster } from "@/components/ui/sonner";
import { isDemo } from "@/shared/api";
import { Icon, type IconName } from "@/shared/ui/Icon";
import { DesignProvider } from "@/shared/theme";
import { ThemeMenu } from "@/components/fx/theme-menu";
import { CommandPalette } from "@/components/fx/command-palette";
import { usePaletteItems } from "@/shared/palette";
import { ScrollArea } from "@/components/fx/scroll-area";
import { ProtectionScreen } from "@/features/protection/ProtectionScreen";
import { Titlebar } from "@/components/layout/Titlebar";
import { UpdateBanner } from "@/components/layout/UpdateBanner";
import { BootScreen } from "@/features/boot/BootScreen";
import { useBoot } from "@/features/boot/useBoot";
import { WhatsNewModal } from "@/features/whatsnew/WhatsNewModal";

const ProfilesScreen = lazy(() => import("@/features/profiles/ProfilesScreen").then((m) => ({ default: m.ProfilesScreen })));
const FiltersScreen = lazy(() => import("@/features/filters/FiltersScreen").then((m) => ({ default: m.FiltersScreen })));
const TgProxyScreen = lazy(() => import("@/features/tgproxy/TgProxyScreen").then((m) => ({ default: m.TgProxyScreen })));
const VersionsScreen = lazy(() => import("@/features/versions/VersionsScreen").then((m) => ({ default: m.VersionsScreen })));
const BackupScreen = lazy(() => import("@/features/backup/BackupScreen").then((m) => ({ default: m.BackupScreen })));
const DiagnosticsScreen = lazy(() => import("@/features/diagnostics/DiagnosticsScreen").then((m) => ({ default: m.DiagnosticsScreen })));
const SettingsScreen = lazy(() => import("@/features/settings/SettingsScreen").then((m) => ({ default: m.SettingsScreen })));
const SetupScreen = lazy(() => import("@/features/setup/SetupScreen").then((m) => ({ default: m.SetupScreen })));

type Tab =
  | "protection"
  | "profiles"
  | "filters"
  | "tgproxy"
  | "versions"
  | "backup"
  | "diagnostics"
  | "settings";

interface TabMeta {
  id: Tab;
  label: string;
  hint: string;
  icon: IconName;
}

const NAV_GROUPS: { title: string; tabs: TabMeta[] }[] = [
  {
    title: "Управление",
    tabs: [
      { id: "protection", label: "Защита", hint: "Состояние и запуск", icon: "shield-check-bold" },
      { id: "profiles", label: "Профили", hint: "Свои сборки настроек", icon: "database-bold" },
      { id: "filters", label: "Фильтры", hint: "Списки и fakes", icon: "filter-bold" },
      { id: "tgproxy", label: "TG Proxy", hint: "Telegram без Zapret", icon: "cpu-bolt-bold" },
    ],
  },
  {
    title: "Система",
    tabs: [
      { id: "versions", label: "Версии", hint: "Сборки Zapret", icon: "box-minimalistic-bold" },
      { id: "backup", label: "Бэкап", hint: "Экспорт и восстановление", icon: "archive-bold" },
      { id: "diagnostics", label: "Диагностика", hint: "Живые проверки системы", icon: "pulse-bold" },
      { id: "settings", label: "Настройки", hint: "Автозапуск и приложение", icon: "settings-minimalistic-bold" },
    ],
  },
];

const ALL_TABS = NAV_GROUPS.flatMap((group) => group.tabs);
const VIEWS: Record<Tab, ComponentType> = {
  protection: ProtectionScreen,
  profiles: ProfilesScreen,
  filters: FiltersScreen,
  tgproxy: TgProxyScreen,
  versions: VersionsScreen,
  backup: BackupScreen,
  diagnostics: DiagnosticsScreen,
  settings: SettingsScreen,
};

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem("control.sidebar") === "collapsed";
  } catch {
    return false;
  }
}

function TabFallback() {
  return (
    <div className="flex flex-col gap-3">
      <div className="h-5 w-40 rounded bg-[var(--fill)]" />
      <div className="h-36 rounded-[10px] border border-[var(--surface-stroke)]" />
      <div className="h-44 rounded-[10px] border border-[var(--surface-stroke)]" />
    </div>
  );
}

export default function App() {
  return (
    <DesignProvider>
      <ControlApp />
    </DesignProvider>
  );
}

function ControlApp() {
  const [tab, setTab] = useState<Tab>("protection");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [whatsNewOpen, setWhatsNewOpen] = useState(false);
  const boot = useBoot();

  const previewSetup = useMemo(() => {
    if (!isDemo()) return false;
    try {
      return new URLSearchParams(window.location.search).has("setup");
    } catch {
      return false;
    }
  }, []);

  const showSetup = previewSetup || boot.setupNeeded === true;
  const View = VIEWS[tab];
  const demo = isDemo();
  const revealed = boot.phase !== "booting";

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((value) => !value);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem("control.sidebar", collapsed ? "collapsed" : "expanded");
    } catch {
      return;
    }
  }, [collapsed]);

  const selectTab = useCallback((id: string) => {
    setTab(id as Tab);
  }, []);

  const paletteItems = usePaletteItems({ open: paletteOpen, go: selectTab, tabs: ALL_TABS });

  return (
    <div className="app-backdrop flex h-screen flex-col overflow-hidden text-foreground">
      <Titlebar
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed((value) => !value)}
        section={showSetup ? "Настройка" : (ALL_TABS.find((item) => item.id === tab)?.label ?? "Control")}
      />

      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <div
          className={cn(
            "flex min-h-0 flex-1 transition-opacity duration-300 ease-out",
            !revealed && "opacity-0",
          )}
        >
        <aside
          aria-label="Разделы"
          className="flex shrink-0 flex-col border-r border-[var(--sidebar-border)] bg-[var(--sidebar)] transition-[width] duration-150 ease-out"
          style={{ width: collapsed ? 64 : 240 }}
        >
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className={cn(
              "mx-2.5 mt-2.5 flex h-9 items-center gap-2 rounded-[7px] border border-[var(--surface-stroke)] bg-[var(--card)] px-2.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground",
              collapsed && "mx-2 justify-center px-0",
            )}
            title="Поиск по разделам"
          >
            <Icon name="rounded-magnifer-bold" size={14} />
            {!collapsed && (
              <>
                <span>Поиск</span>
                <kbd className="ml-auto rounded border border-[var(--border)] px-1 py-0.5 text-[11px] leading-none">
                  Ctrl K
                </kbd>
              </>
            )}
          </button>
  
          <nav className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-2.5 py-3.5 no-scrollbar">
            {NAV_GROUPS.map((group) => (
              <div key={group.title} className="flex flex-col gap-0.5">
                {!collapsed && (
                  <p className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                    {group.title}
                  </p>
                )}
                {collapsed && <div className="mx-auto mb-1 h-px w-4 bg-[var(--sidebar-border)]" />}
                {group.tabs.map((item) => {
                  const active = item.id === tab;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setTab(item.id)}
                      aria-current={active ? "page" : undefined}
                      title={collapsed ? item.label : undefined}
                      className={cn(
                        "flex h-9 items-center gap-2.5 rounded-[6px] px-2.5 text-[13px] transition-colors",
                        collapsed && "justify-center px-0",
                        active
                          ? "bg-[var(--fill-strong)] font-medium text-[var(--sidebar-accent-foreground)]"
                          : "text-[var(--sidebar-foreground)] hover:bg-[var(--sidebar-accent)] hover:text-[var(--sidebar-accent-foreground)]",
                      )}
                    >
                      <Icon name={item.icon} size={16} />
                      {!collapsed && <span className="truncate">{item.label}</span>}
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>
  
          <UpdateBanner collapsed={collapsed} />

          <div
            className={cn(
              "flex items-center gap-2 border-t border-[var(--sidebar-border)] px-3.5 py-3.5",
              collapsed && "justify-center px-0",
            )}
          >
            <ThemeMenu />
            {!collapsed && (
              <>
                {demo && (
                  <span className="rounded-[4px] bg-[var(--fill)] px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                    Демо
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setWhatsNewOpen(true)}
                  className="ml-auto rounded-[6px] px-2 py-1 text-[11.5px] text-muted-foreground transition-colors hover:bg-[var(--sidebar-accent)] hover:text-foreground"
                  title="Что нового в Control 2.0.0"
                >
                  2.0.0
                </button>
              </>
            )}
          </div>
        </aside>
  
        <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
          <ScrollArea contentClassName="px-8 py-7 xl:px-10 xl:py-8">
            <div className="mx-auto w-full max-w-[1080px]">
              <Suspense fallback={<TabFallback />}>
                <TabErrorBoundary>
                  <View />
                </TabErrorBoundary>
              </Suspense>
              {showSetup && (
                <Suspense fallback={null}>
                  <SetupScreen onDone={() => window.location.reload()} />
                </Suspense>
              )}
            </div>
          </ScrollArea>
        </main>
        </div>

        {boot.phase !== "ready" && !boot.minimized && (
          <BootScreen phase={boot.phase} progress={boot.progress} label={boot.label} />
        )}
      </div>

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        items={paletteItems}
      />

      <WhatsNewModal open={whatsNewOpen} onOpenChange={setWhatsNewOpen} />

      <Toaster position="bottom-right" />
    </div>
  );
}

export class TabErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="text-caption rounded-[8px] border border-destructive/30 bg-destructive/5 p-4 text-destructive">
          Ошибка раздела: {String(this.state.error.message ?? this.state.error)}
        </div>
      );
    }
    return this.props.children;
  }
}
