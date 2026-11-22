import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  api,
  onDiagnosticsCheck,
  type CheckStatus,
  type DiagnosticCheck,
  type DiagnosticsReport,
  type ServiceStatus,
} from "@/shared/api";
import { Page, PageHeader, SectionCard } from "@/shared/ui/screen";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Skeleton } from "@/components/ui/skeleton";
import { Icon, type IconName } from "@/shared/ui/Icon";
import { copyText } from "@/shared/clipboard";
import { errorText } from "@/shared/error";
import { plural } from "@/shared/plural";
import { cn } from "cn";

const STATUS_META: Record<
  CheckStatus,
  { label: string; tone: "idle" | "success" | "warning" | "danger" | "running" }
> = {
  pending: { label: "Ожидает", tone: "idle" },
  running: { label: "Выполняется", tone: "running" },
  ok: { label: "Ок", tone: "success" },
  warning: { label: "Замечание", tone: "warning" },
  error: { label: "Ошибка", tone: "danger" },
};

const PREVIEW_GROUPS: { name: string; icon: IconName; hint: string }[] = [
  { name: "Система", icon: "settings-minimalistic-bold", hint: "Права, папки, настройки, диск" },
  { name: "Zapret", icon: "shield-check-bold", hint: "Установка, winws.exe, стратегии, списки" },
  { name: "WinDivert", icon: "cpu-bolt-bold", hint: "Служба и драйвер перехвата" },
  { name: "Защита", icon: "play-circle-bold", hint: "Процесс winws и служба автозапуска" },
  { name: "Сеть", icon: "monitor-bold", hint: "TCP, DNS, HTTPS и сторонние установки" },
  { name: "TG Proxy", icon: "widget-4-bold", hint: "Прокси и локальный порт" },
];

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} мс`;
  return `${(ms / 1000).toFixed(1)} с`;
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

export function DiagnosticsScreen() {
  const [checks, setChecks] = useState<DiagnosticCheck[]>([]);
  const [report, setReport] = useState<DiagnosticsReport | null>(null);
  const [running, setRunning] = useState(false);
  const [service, setService] = useState<ServiceStatus | null>(null);
  const [serviceBusy, setServiceBusy] = useState<"install" | "remove" | null>(null);
  const [confirmInstall, setConfirmInstall] = useState(false);

  useEffect(() => {
    let alive = true;
    const unsubscribe = onDiagnosticsCheck((check) => {
      if (!alive) return;
      setChecks((prev) => {
        const index = prev.findIndex((c) => c.id === check.id);
        if (index === -1) return [...prev, check];
        const next = prev.slice();
        next[index] = check;
        return next;
      });
    });
    void api.serviceStatus().then(setService).catch(() => setService(null));
    return () => {
      alive = false;
      void unsubscribe.then((fn) => fn());
    };
  }, []);

  const run = useCallback(async () => {
    setRunning(true);
    setChecks((prev) =>
      prev.map(({ hint: _hint, ...rest }) => ({
        ...rest,
        status: "pending" as CheckStatus,
        detail: "Ожидает запуска",
        durationMs: 0,
      })),
    );
    try {
      const result = await api.diagnosticsRun();
      setReport(result);
      setChecks(result.checks);
      void api.serviceStatus().then(setService).catch(() => undefined);
    } catch (e) {
      toast.error("Диагностика не удалась", { description: errorText(e) });
    } finally {
      setRunning(false);
    }
  }, []);

  const done = checks.filter((c) => c.status !== "pending" && c.status !== "running").length;
  const errors = checks.filter((c) => c.status === "error").length;
  const warnings = checks.filter((c) => c.status === "warning").length;
  const ok = checks.filter((c) => c.status === "ok").length;
  const total = checks.length;
  const current = checks.find((c) => c.status === "running");
  const idle = report === null && !running && total === 0;

  const groups = useMemo(() => {
    const order: string[] = [];
    const map = new Map<string, DiagnosticCheck[]>();
    for (const check of checks) {
      if (!map.has(check.group)) {
        map.set(check.group, []);
        order.push(check.group);
      }
      map.get(check.group)?.push(check);
    }
    return order.map((name) => ({ name, items: map.get(name) ?? [] }));
  }, [checks]);

  const copyReport = async () => {
    if (!report) return;
    const copied = await copyText(report.markdown);
    if (copied) {
      toast.success("Отчёт для поддержки скопирован", {
        description: "В нём есть окружение, проверки, коды и журнал Control",
      });
    } else {
      toast.error("Не удалось скопировать отчёт");
    }
  };

  const installService = async () => {
    setServiceBusy("install");
    const t = toast.loading("Устанавливаю службу…", {
      description: "Создаю и запускаю системную службу",
    });
    try {
      const res = await api.serviceInstall();
      setService(await api.serviceStatus());
      toast.success(
        res.running ? "Служба установлена и запущена" : "Служба создана, но не запущена",
        { id: t },
      );
    } catch (e) {
      toast.error("Не удалось установить службу", { id: t, description: errorText(e) });
    } finally {
      setServiceBusy(null);
    }
  };

  const removeService = async () => {
    setServiceBusy("remove");
    const t = toast.loading("Удаляю службу…", {
      description: "Останавливаю и удаляю системную службу",
    });
    try {
      await api.serviceRemove();
      setService(await api.serviceStatus());
      toast.success("Служба zapret удалена", { id: t });
    } catch (e) {
      toast.error("Не удалось удалить службу", { id: t, description: errorText(e) });
    } finally {
      setServiceBusy(null);
    }
  };

  const summary = running
    ? {
        label: "Проверка идёт",
        title: "Проверяю систему…",
        tone: "text-foreground",
        dot: "bg-[color:var(--ring)]",
        caption: current
          ? `${current.group} · ${current.title}`
          : "Проверки выполняются последовательно — статусы появляются по мере готовности.",
      }
    : idle
      ? {
          label: "Не запускалась",
          title: "Проверка не запускалась",
          tone: "text-foreground",
          dot: "bg-muted-foreground/45",
          caption:
            "Диагностика ничего не делает автоматически. Запустите её кнопкой — проверки займут несколько секунд.",
        }
      : errors > 0
        ? {
            label: "Есть ошибки",
            title: "Нужно внимание",
            tone: "text-destructive",
            dot: "bg-destructive",
            caption: `Ошибок: ${errors}. Скопируйте отчёт и приложите его к обращению — там есть всё для разбора.`,
          }
        : warnings > 0
          ? {
              label: "С замечаниями",
              title: "Работает с замечаниями",
              tone: "text-warning",
              dot: "bg-warning",
              caption: `Замечаний: ${warnings}. Критичных ошибок нет — проверьте рекомендации ниже.`,
            }
          : {
              label: "Готово",
              title: "Всё в порядке",
              tone: "text-success",
              dot: "bg-success",
              caption: "Zapret, служба, WinDivert и сеть отвечают как ожидается.",
            };

  return (
    <Page>
      <PageHeader
        title="Диагностика"
        subtitle="Проверки Zapret, службы автозапуска, WinDivert и сети. Запуск — только вручную."
        action={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={!report}
              onClick={() => void copyReport()}
            >
              <Icon name="document-text-bold" size={13} />
              Копировать отчёт
            </Button>
            <Button size="sm" className="gap-1.5" disabled={running} onClick={() => void run()}>
              <Icon name="refresh-bold" size={13} className={running ? "animate-spin-slow" : ""} />
              {running ? "Проверяю…" : report ? "Повторить" : "Проверить"}
            </Button>
          </div>
        }
      />

      <section className="material rounded-[12px]">
        <div className="flex flex-col gap-6 p-6 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
              <span className="inline-flex items-center gap-2 rounded-full bg-[var(--fill)] px-2.5 py-1">
                <span className="relative flex size-1.5">
                  {running && <span className="status-ring text-[color:var(--ring)]" aria-hidden />}
                  <span className={cn("size-1.5 rounded-full", summary.dot)} />
                </span>
                <span
                  key={summary.label}
                  className="enter-soft text-[11px] font-medium text-muted-foreground"
                >
                  {summary.label}
                </span>
              </span>
              {report && !running && (
                <span className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <span className="numeric">{formatTime(report.generatedAt)}</span>
                  <span className="text-muted-foreground/40">·</span>
                  <span className="numeric">{formatDuration(report.durationMs)}</span>
                </span>
              )}
            </div>

            <p
              key={summary.title}
              className={cn(
                "enter-soft mt-3.5 text-[22px] font-semibold leading-[1.2] tracking-[-0.02em]",
                summary.tone,
              )}
            >
              {summary.title}
            </p>
            <p className="mt-2 max-w-[44rem] text-[13px] leading-[1.55] text-muted-foreground">
              {summary.caption}
            </p>

            {running && (
              <div className="mt-4 flex max-w-[280px] flex-col gap-1.5">
                <span className="block h-1 overflow-hidden rounded-full bg-[var(--fill)]">
                  <span
                    className="block h-full rounded-full bg-[color:var(--ring)] transition-[width] duration-200"
                    style={{ width: `${total ? Math.round((done / total) * 100) : 4}%` }}
                  />
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {done} из {total || "…"} проверок
                </span>
              </div>
            )}

            {idle && (
              <Button size="sm" className="mt-5 gap-1.5 self-start" onClick={() => void run()}>
                <Icon name="play-circle-bold" size={13} />
                Запустить проверку
              </Button>
            )}
          </div>

          <div className="flex shrink-0 items-stretch gap-2.5">
            <SummaryCount
              label="Ок"
              value={total > 0 ? ok : null}
              tone="text-success"
              icon="check-circle-bold"
            />
            <SummaryCount
              label="Замечания"
              value={total > 0 ? warnings : null}
              tone="text-warning"
              icon="danger-triangle-bold"
            />
            <SummaryCount
              label="Ошибки"
              value={total > 0 ? errors : null}
              tone="text-destructive"
              icon="close-circle-bold"
            />
          </div>
        </div>
      </section>

      {idle && (
        <SectionCard title="Что проверяется">
          <div className="grid gap-x-10 gap-y-5 py-1 sm:grid-cols-2">
            {PREVIEW_GROUPS.map((group) => (
              <div key={group.name} className="flex items-start gap-3.5">
                <span className="grid size-9 shrink-0 place-items-center rounded-[9px] bg-[var(--fill)] text-muted-foreground">
                  <Icon name={group.icon} size={16} />
                </span>
                <div className="min-w-0 pt-0.5">
                  <p className="text-[13px] font-medium leading-[1.4]">{group.name}</p>
                  <p className="text-caption mt-1 leading-relaxed text-muted-foreground">
                    {group.hint}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {running && total === 0 && (
        <SectionCard title="Проверки">
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-full" />
          </div>
        </SectionCard>
      )}

      {groups.map((group) => {
        const groupErrors = group.items.filter((c) => c.status === "error").length;
        const groupWarnings = group.items.filter((c) => c.status === "warning").length;
        return (
          <SectionCard
            key={group.name}
            title={group.name}
            action={
              <span
                className={cn(
                  "text-[11px] font-medium",
                  groupErrors > 0
                    ? "text-destructive"
                    : groupWarnings > 0
                      ? "text-warning"
                      : "text-muted-foreground",
                )}
              >
                {groupErrors > 0
                  ? plural(groupErrors, ["ошибка", "ошибки", "ошибок"])
                  : groupWarnings > 0
                    ? plural(groupWarnings, ["замечание", "замечания", "замечаний"])
                    : plural(group.items.length, ["проверка", "проверки", "проверок"])}
              </span>
            }
          >
            <div className="flex flex-col">
              {group.items.map((check) => (
                <CheckRow key={check.id} check={check} />
              ))}
            </div>
          </SectionCard>
        );
      })}

      <SectionCard
        title="Служба и автозапуск zapret"
        action={
          service === null ? (
            <Skeleton className="h-4 w-20" />
          ) : (
            <span
              key={service.running ? "running" : service.installed ? "stopped" : "absent"}
              className="enter-soft flex items-center gap-1.5 text-[11px] font-medium"
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
              {service.running ? "запущена" : service.installed ? "остановлена" : "не установлена"}
            </span>
          )
        }
      >
        <div className="flex flex-col gap-4">
          <div
            key={service ? `${service.installed}-${service.running}` : "unknown"}
            className="enter-soft flex items-start gap-3.5"
          >
            <span
              className={cn(
                "grid size-10 shrink-0 place-items-center rounded-[10px] transition-colors",
                service?.running
                  ? "bg-success/10 text-success"
                  : service?.installed
                    ? "bg-warning/10 text-warning"
                    : "bg-[var(--fill)] text-muted-foreground",
              )}
            >
              <Icon name="shield-check-bold" size={18} />
            </span>
            <div className="min-w-0 pt-0.5">
              <p className="text-[13px] font-medium leading-[1.4]">zapret как служба Windows</p>
              <p className="text-caption mt-1.5 leading-relaxed text-muted-foreground">
                Отдельный автозапуск zapret: работает без окна Control и стартует вместе с Windows.
                Установка и удаление выполняются с правами администратора.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              className="gap-1.5"
              disabled={serviceBusy !== null || service?.running === true}
              onClick={() => setConfirmInstall(true)}
            >
              {serviceBusy === "install" ? (
                <span className="size-3.5 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />
              ) : (
                <Icon name="shield-check-bold" size={14} />
              )}
              {serviceBusy === "install" ? "Устанавливаю…" : "Включить автозапуск"}
            </Button>

            {service?.installed && (
              <Button
                variant="outline"
                className="gap-1.5"
                disabled={serviceBusy !== null}
                onClick={() => void removeService()}
              >
                {serviceBusy === "remove" ? (
                  <span className="size-3.5 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />
                ) : (
                  <Icon name="trash-bin-trash-bold" size={14} />
                )}
                {serviceBusy === "remove" ? "Удаляю…" : "Выключить автозапуск"}
              </Button>
            )}
          </div>
        </div>
      </SectionCard>

      <Modal
        open={confirmInstall}
        onOpenChange={setConfirmInstall}
        size="sm"
        title="Включить автозапуск zapret"
        description="Действие выполнится с правами администратора: будет создана и запущена системная служба zapret. Она будет стартовать вместе с Windows независимо от Control."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmInstall(false)}>
              Отмена
            </Button>
            <Button
              onClick={() => {
                setConfirmInstall(false);
                void installService();
              }}
            >
              Продолжить
            </Button>
          </>
        }
      />
    </Page>
  );
}

function SummaryCount({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: number | null;
  tone: string;
  icon: IconName;
}) {
  return (
    <div className="flex min-w-[6.5rem] flex-col gap-2.5 rounded-[10px] border border-[var(--separator)] bg-[var(--card)] px-4 py-3">
      <span className="flex items-center gap-1.5 text-[11px] leading-none text-muted-foreground">
        <Icon name={icon} size={12} className={value === null ? "text-muted-foreground/45" : tone} />
        {label}
      </span>
      {value === null ? (
        <span className="text-[24px] font-semibold leading-none tracking-[-0.02em] text-muted-foreground/35">
          —
        </span>
      ) : (
        <span
          key={value}
          className={cn(
            "numeric enter-soft text-[24px] font-semibold leading-none tracking-[-0.02em]",
            tone,
          )}
        >
          {value}
        </span>
      )}
    </div>
  );
}

function CheckRow({ check }: { check: DiagnosticCheck }) {
  const meta = STATUS_META[check.status];
  const showHint = (check.status === "warning" || check.status === "error") && check.hint;

  return (
    <div
      data-status={check.status}
      className="diag-row flex items-start gap-3 border-b border-[var(--separator)] py-2.5 last:border-b-0"
    >
      <span className="mt-0.5 grid size-5 shrink-0 place-items-center">
        <StatusGlyph status={check.status} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <span className="min-w-0 text-[13px] font-medium leading-snug">{check.title}</span>
          <span
            className={cn(
              "numeric shrink-0 text-[11px]",
              check.status === "error"
                ? "text-destructive"
                : check.status === "warning"
                  ? "text-warning"
                  : "text-muted-foreground",
            )}
          >
            {check.status === "running"
              ? "…"
              : check.status === "pending"
                ? "ожидает"
                : `${check.durationMs} мс`}
          </span>
        </div>
        <p key={check.detail} className="text-caption enter-soft mt-1 break-words text-muted-foreground">
          {check.detail}
        </p>
        {showHint && (
          <p
            className={cn(
              "enter-soft mt-1 flex items-start gap-1.5 text-[11px] leading-relaxed",
              check.status === "error" ? "text-destructive/90" : "text-warning",
            )}
          >
            <Icon name="bolt-circle-bold" size={12} className="mt-0.5 shrink-0" />
            <span>{check.hint}</span>
          </p>
        )}
        <span className="sr-only">{meta.label}</span>
      </div>
    </div>
  );
}

function StatusGlyph({ status }: { status: CheckStatus }) {
  return (
    <span key={status} className="diag-glyph" data-status={status} aria-hidden>
      {status === "pending" ? (
        <span className="size-3.5 rounded-full border border-muted-foreground/35" />
      ) : status === "running" ? (
        <span className="size-3.5 animate-spin rounded-full border-[1.5px] border-[color:var(--ring)] border-t-transparent" />
      ) : status === "ok" ? (
        <Icon name="check-circle-bold" size={16} className="text-success" />
      ) : status === "warning" ? (
        <Icon name="shield-warning-bold" size={16} className="text-warning" />
      ) : (
        <Icon name="close-circle-bold" size={16} className="text-destructive" />
      )}
    </span>
  );
}
