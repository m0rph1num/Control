import { errorText } from "@/shared/error";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, type AppInfo, type AutostartInfo, type ServiceStatus } from "@/shared/api";
import { FieldLabel, Page, PageHeader, SectionCard, Segmented } from "@/shared/ui/screen";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Icon } from "@/shared/ui/Icon";
import { playSound, setSoundsEnabled, soundsEnabled } from "@/shared/sound";
import { useDesign, type ThemeMode } from "@/shared/theme";
import { WhatsNewModal } from "@/features/whatsnew/WhatsNewModal";
import { cn } from "cn";

const LICENSES: { name: string; version: string; author: string; license: string }[] = [
  { name: "Zapret", version: "DPI-обход", author: "bol-van · сборка Flowseal", license: "GPL-3.0" },
  { name: "WinDivert", version: "перехват трафика", author: "basil00", license: "LGPL-3.0" },
  { name: "TG WS Proxy", version: "MTProto-прокси", author: "Flowseal", license: "MIT" },
  { name: "Tauri", version: "оболочка приложения", author: "Tauri Contributors", license: "MIT / Apache-2.0" },
  { name: "React", version: "интерфейс", author: "Meta Platforms", license: "MIT" },
  { name: "Tailwind CSS", version: "стили", author: "Tailwind Labs", license: "MIT" },
  { name: "Geist", version: "шрифт", author: "Vercel", license: "SIL OFL 1.1" },
  { name: "Solar Icons", version: "иконки", author: "480 Design", license: "MIT" },
  { name: "Control Sounds", version: "звуки интерфейса", author: "Control", license: "как у проекта" },
];

const THEME_OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: "light", label: "Светлая" },
  { value: "dark", label: "Тёмная" },
  { value: "system", label: "Системная" },
];

export function SettingsScreen() {
  const { theme, setTheme } = useDesign();
  const [settings, setSettings] = useState<Record<string, unknown> | null>(null);
  const [controlDir, setControlDir] = useState("");
  const [savingDir, setSavingDir] = useState(false);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [autostart, setAutostart] = useState<AutostartInfo | null>(null);
  const [savingAutostart, setSavingAutostart] = useState(false);
  const [service, setService] = useState<ServiceStatus | null>(null);
  const [serviceBusy, setServiceBusy] = useState<"install" | "remove" | null>(null);
  const [confirmService, setConfirmService] = useState<"install" | "remove" | null>(null);
  const [licensesOpen, setLicensesOpen] = useState(false);
  const [whatsNewOpen, setWhatsNewOpen] = useState(false);
  const [logoOk, setLogoOk] = useState(true);
  const [sounds, setSounds] = useState(soundsEnabled);

  useEffect(() => {
    api
      .settingsGet()
      .then((s) => {
        setSettings(s);
        setControlDir(String(s.controlDir ?? ""));
      })
      .catch((e) => toast.error("Не удалось загрузить настройки", { description: errorText(e) }));
    api
      .getAppInfo()
      .then(setAppInfo)
      .catch(() => setAppInfo(null));
    api
      .autostartInfo()
      .then(setAutostart)
      .catch(() => setAutostart({ enabled: false, current: false, command: null }));
    api
      .serviceStatus()
      .then(setService)
      .catch(() => setService(null));
  }, []);

  const patch = (key: string, value: boolean) => {
    const prev = settings;
    setSettings((cur) => ({ ...(cur ?? {}), [key]: value }));
    api.settingsUpdate({ [key]: value }).catch((e) => {
      setSettings(prev);
      toast.error("Настройка не сохранена", { description: errorText(e) });
    });
  };

  const bool = (key: string) => settings?.[key] !== false;

  const toggleAutostart = async (enabled: boolean) => {
    const prev = autostart;
    setAutostart({ enabled, current: enabled, command: prev?.command ?? null });
    setSavingAutostart(true);
    try {
      await api.autostartSet(enabled);
      const info = await api.autostartInfo();
      setAutostart(info);
      toast.success(enabled ? "Автозапуск Control включён" : "Автозапуск Control выключен", {
        description: enabled ? "При старте Windows окно сразу свернётся в трей" : undefined,
      });
    } catch (e) {
      setAutostart(prev);
      toast.error("Не удалось изменить автозапуск Control", { description: errorText(e) });
    } finally {
      setSavingAutostart(false);
    }
  };

  const applyService = async () => {
    const action = confirmService;
    if (!action) return;
    setConfirmService(null);
    setServiceBusy(action);
    const t = toast.loading(
      action === "install" ? "Включаю автозапуск zapret…" : "Выключаю автозапуск zapret…",
      { description: "Подтвердите запрос UAC" },
    );
    try {
      if (action === "install") {
        await api.serviceInstall();
      } else {
        await api.serviceRemove();
      }
      const next = await api.serviceStatus();
      setService(next);
      toast.success(
        action === "install" ? "Автозапуск zapret включён" : "Автозапуск zapret выключен",
        {
          id: t,
          description:
            action === "install"
              ? "Служба Windows запускает zapret вместе с системой"
              : "Служба zapret удалена — запускайте защиту из Control",
        },
      );
    } catch (e) {
      toast.error(
        action === "install"
          ? "Не удалось включить автозапуск zapret"
          : "Не удалось выключить автозапуск zapret",
        { id: t, description: errorText(e) },
      );
    } finally {
      setServiceBusy(null);
    }
  };

  const saveDir = () => {
    setSavingDir(true);
    api
      .settingsUpdate({ controlDir: controlDir.trim() })
      .then(() => toast.success("Папка сохранена"))
      .catch((e) => toast.error("Не удалось сохранить папку", { description: errorText(e) }))
      .finally(() => setSavingDir(false));
  };

  const dirDirty = settings !== null && controlDir.trim() !== String(settings.controlDir ?? "").trim();

  return (
    <Page>
      <PageHeader title="Настройки" />

      <SectionCard title="Поведение">
        {settings === null ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : (
          <div className="flex flex-col">
            <SettingRow
              label="Сворачивать в трей при закрытии"
              hint="Защита продолжает работать"
              checked={bool("minimizeToTray")}
              onChange={(v) => patch("minimizeToTray", v)}
            />
            <SettingRow
              label="Уведомления"
              hint="Показывать результат операций"
              checked={bool("notifications")}
              onChange={(v) => patch("notifications", v)}
            />
            <SettingRow
              label="Звуки интерфейса"
              hint="Короткие сигналы действий"
              checked={sounds}
              onChange={(value) => {
                if (value) {
                  setSoundsEnabled(true);
                  playSound("toggle");
                } else {
                  playSound("close");
                  setSoundsEnabled(false);
                }
                setSounds(value);
              }}
            />
            <SettingRow
              label="Восстанавливать состояние"
              hint="При следующем запуске Control"
              checked={bool("restoreState")}
              onChange={(v) => patch("restoreState", v)}
            />
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Оформление"
        action={<span className="text-[11px] text-muted-foreground">выбор сохраняется</span>}
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <span className="min-w-0">
            <span className="block text-[13px]">Тема</span>
            <span className="text-caption mt-1 block text-muted-foreground">
              Светлая, тёмная или как в Windows
            </span>
          </span>
          <Segmented
            value={theme}
            options={THEME_OPTIONS}
            onChange={(mode) => setTheme(mode)}
            className="w-[300px] shrink-0"
          />
        </div>
      </SectionCard>

      <SectionCard
        title="Запуск с Windows"
        action={
          <span className="text-[11px] text-muted-foreground">два независимых автозапуска</span>
        }
      >
        <div className="flex flex-col">
          <div className="flex items-start justify-between gap-6 border-b border-[var(--separator)] pb-4 pt-1">
            <div className="flex min-w-0 items-start gap-3.5">
              <span className="grid size-9 shrink-0 place-items-center rounded-[9px] bg-[var(--fill)] text-foreground">
                <Icon name="monitor-bold" size={16} />
              </span>
              <div className="min-w-0">
                <p className="text-[13px] font-medium leading-[1.4]">Control</p>
                <p className="text-caption mt-1 leading-relaxed text-muted-foreground">
                  Окно запускается в трей, защита продолжает работать
                </p>
                {autostart === null ? (
                  <Skeleton className="mt-2.5 h-3.5 w-24" />
                ) : (
                  <span
                    key={autostart.enabled ? (autostart.current ? "on" : "stale") : "off"}
                    className="enter-soft mt-2.5 flex items-center gap-1.5 text-[11px] font-medium"
                  >
                    <span
                      className={cn(
                        "size-1.5 rounded-full",
                        autostart.enabled
                          ? autostart.current
                            ? "bg-success"
                            : "bg-warning"
                          : "bg-muted-foreground/50",
                      )}
                    />
                    {autostart.enabled
                      ? autostart.current
                        ? "включён"
                        : "включён · путь устарел"
                      : "выключен"}
                  </span>
                )}
              </div>
            </div>
            {autostart === null ? (
              <Skeleton className="mt-1 h-5 w-9 shrink-0 rounded-full" />
            ) : (
              <Switch
                checked={autostart.enabled}
                disabled={savingAutostart}
                onCheckedChange={(value) => void toggleAutostart(value)}
                className="mt-1 shrink-0"
                aria-label="Автозапуск Control с Windows"
              />
            )}
          </div>

          <div className="flex items-start justify-between gap-6 py-4">
            <div className="flex min-w-0 items-start gap-3.5">
              <span className="grid size-9 shrink-0 place-items-center rounded-[9px] bg-[var(--fill)] text-foreground">
                <Icon name="shield-check-bold" size={16} />
              </span>
              <div className="min-w-0">
                <p className="text-[13px] font-medium leading-[1.4]">Zapret · служба Windows</p>
                <p className="text-caption mt-1 leading-relaxed text-muted-foreground">
                  Отдельно от Control: служба запускает zapret вместе с системой
                </p>
                {service === null ? (
                  <Skeleton className="mt-2.5 h-3.5 w-24" />
                ) : (
                  <span
                    key={`${service.installed}-${service.running}`}
                    className="enter-soft mt-2.5 flex items-center gap-1.5 text-[11px] font-medium"
                  >
                    <span
                      className={cn(
                        "size-1.5 rounded-full",
                        service.running
                          ? "bg-success"
                          : service.installed
                            ? "bg-warning"
                            : "bg-muted-foreground/50",
                      )}
                    />
                    {service.running
                      ? "служба запущена"
                      : service.installed
                        ? "служба остановлена"
                        : "автозапуск выключен"}
                  </span>
                )}
              </div>
            </div>
            {service === null ? (
              <Skeleton className="mt-1 h-5 w-9 shrink-0 rounded-full" />
            ) : (
              <Switch
                checked={service.installed}
                disabled={serviceBusy !== null}
                onCheckedChange={(value) => setConfirmService(value ? "install" : "remove")}
                className="mt-1 shrink-0"
                aria-label="Автозапуск zapret как службы Windows"
              />
            )}
          </div>

          <p className="text-caption border-t border-[var(--separator)] pt-4 leading-relaxed text-muted-foreground">
            Автозапуски не зависят друг от друга: можно включить только Control, только zapret или
            оба. Служба zapret требует подтверждения UAC.
          </p>
        </div>
      </SectionCard>

      <SectionCard title="Папка Control">
        <div className="flex flex-col gap-1.5">
          <FieldLabel hint="после перезапуска">Путь к данным</FieldLabel>
          <div className="flex gap-2">
            <Input
              value={controlDir}
              onChange={(e) => setControlDir(e.target.value)}
              className="font-mono text-[12px]"
              aria-label="Папка Control"
            />
            <Button onClick={saveDir} disabled={!dirDirty || savingDir} className="shrink-0 gap-1.5">
              <Icon name="check-circle-bold" size={14} />
              Сохранить
            </Button>
          </div>
          <p className="text-caption text-muted-foreground">Версии Zapret, профили и резервные копии.</p>
        </div>
      </SectionCard>

      <SectionCard title="О приложении">
        <div className="flex flex-col gap-5">
          <div className="flex items-start gap-3.5">
            <img
              src="/app-icon.svg"
              alt=""
              className="size-10 shrink-0 rounded-[10px]"
              draggable={false}
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[15px] font-semibold tracking-[-0.015em]">Control</span>
                <button
                  type="button"
                  data-sound="off"
                  onClick={() => {
                    playSound("open");
                    setWhatsNewOpen(true);
                  }}
                  className="group/version inline-flex items-center gap-1 rounded-[5px] bg-[var(--fill)] px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-[var(--fill-strong)] hover:text-foreground"
                  title="Что нового в Control 2.0.0"
                >
                  {appInfo?.version ?? "2.0.0"}
                  <Icon
                    name="alt-arrow-right-bold"
                    size={10}
                    className="opacity-0 transition-opacity group-hover/version:opacity-100"
                  />
                </button>
              </div>
              <p className="text-caption mt-1.5 leading-relaxed text-muted-foreground">
                Обход DPI для Windows. Бесплатно, без рекламы и телеметрии.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3.5 rounded-[10px] border border-[var(--separator)] bg-[var(--surface-muted)] p-3.5">
            <span className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-[9px] border border-[var(--surface-stroke)] bg-[var(--fill)]">
              {logoOk ? (
                <img
                  src="/monolith.gif"
                  alt="Monolith Studios"
                  className="size-full object-cover"
                  onError={() => setLogoOk(false)}
                />
              ) : (
                <span className="text-[15px] font-semibold tracking-[-0.02em] text-muted-foreground">
                  M
                </span>
              )}
            </span>
            <div className="min-w-0">
              <p className="text-[12.5px] font-medium">Monolith Studios</p>
              <p className="text-caption mt-0.5 leading-relaxed text-muted-foreground">
                Независимая студия · некоммерческий проект
              </p>
            </div>
          </div>

          <div className="flex max-w-[74ch] flex-col gap-2.5 text-[11.5px] leading-relaxed text-muted-foreground">
            <p>
              Control — независимая программа для Windows, разработанная Monolith Studios. Она не
              является официальным продуктом Zapret и не связана с авторами Zapret, WinDivert,
              TG WS Proxy или иных сторонних компонентов; их названия и права принадлежат
              соответствующим правообладателям.
            </p>
            <p>
              Сторонние компоненты используются на условиях их лицензий, права на них не изменяются
              и не перераспределяются. Программа распространяется бесплатно, без рекламы и
              телеметрии, и создана как некоммерческий проект: её цель — сделать обход DPI понятным
              и предсказуемым.
            </p>
            <p>
              Программное обеспечение предоставляется «как есть», без явных и подразумеваемых
              гарантий. Пользователь применяет его по своему усмотрению и отвечает за соблюдение
              законодательства своей страны.
            </p>
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-[var(--separator)] pt-3.5">
            <span className="text-[11px] text-muted-foreground">© 2026 Monolith Studios</span>
            <Button
              variant="ghost"
              size="xs"
              className="gap-1.5"
              onClick={() => setLicensesOpen(true)}
            >
              <Icon name="document-text-bold" size={12} />
              Лицензии и компоненты
            </Button>
          </div>
        </div>
      </SectionCard>

      <Modal
        open={licensesOpen}
        onOpenChange={setLicensesOpen}
        size="md"
        title="Лицензии и компоненты"
        description="Сторонние компоненты используются по условиям их лицензий. Права принадлежат их авторам."
        footer={<Button onClick={() => setLicensesOpen(false)}>Понятно</Button>}
      >
        <div className="flex flex-col">
          {LICENSES.map((item) => (
            <div
              key={item.name}
              className="flex items-center justify-between gap-3 border-b border-[var(--separator)] py-2 text-caption last:border-b-0"
            >
              <span className="flex min-w-0 flex-col">
                <span className="font-medium text-foreground">{item.name}</span>
                <span className="truncate text-muted-foreground">
                  {item.author} · {item.version}
                </span>
              </span>
              <span className="shrink-0 rounded-[4px] bg-[var(--fill)] px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                {item.license}
              </span>
            </div>
          ))}
          <p className="text-caption mt-3 leading-relaxed text-muted-foreground">
            Control не изменяет условия лицензий и не перераспределяет права на сторонние
            компоненты.
          </p>
        </div>
      </Modal>

      <WhatsNewModal
        open={whatsNewOpen}
        onOpenChange={(open) => {
          if (!open) playSound("close");
          setWhatsNewOpen(open);
        }}
      />

      <Modal
        open={confirmService !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmService(null);
        }}
        size="sm"
        title={
          confirmService === "install"
            ? "Включить автозапуск zapret"
            : "Выключить автозапуск zapret"
        }
        description={
          confirmService === "install"
            ? "Действие выполнится с правами администратора (запрос UAC): будет создана и запущена системная служба zapret. Она стартует вместе с Windows независимо от Control."
            : "Служба zapret будет остановлена и удалена. Защиту можно будет запускать вручную из Control — автозапуск zapret перестанет работать."
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmService(null)}>
              Отмена
            </Button>
            <Button onClick={() => void applyService()}>
              {confirmService === "install" ? "Включить" : "Выключить"}
            </Button>
          </>
        }
      />
    </Page>
  );
}

function SettingRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center justify-between gap-4 border-b border-[var(--separator)] py-1.5 last:border-b-0">
      <span className="min-w-0">
        <span className="block text-[13px]">{label}</span>
        {hint && <span className="text-caption mt-1 block text-muted-foreground">{hint}</span>}
      </span>
      <Switch checked={checked} onCheckedChange={onChange} className="shrink-0" />
    </label>
  );
}
