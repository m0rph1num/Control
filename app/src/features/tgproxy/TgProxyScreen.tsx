import { errorText } from "@/shared/error";
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { toast } from "sonner";
import { api, type TgwsStatus } from "@/shared/api";
import { useOperations } from "@/shared/operations";
import { Page, PageHeader, SectionCard, FieldLabel } from "@/shared/ui/screen";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Icon } from "@/shared/ui/Icon";
import { copyText } from "@/shared/clipboard";
import { cn } from "cn";

export function TgProxyScreen() {
  const [status, setStatus] = useState<TgwsStatus | null>(null);
  const [logs, setLogs] = useState<string[] | null>(null);
  const [logsOpen, setLogsOpen] = useState(false);
  const [port, setPort] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmUninstall, setConfirmUninstall] = useState(false);
  const operations = useOperations();
  const installOp = operations.find(
    (op) => op.kind === "tgws_install" && (op.status === "running" || op.status === "queued"),
  );
  const installPct =
    installOp?.progress?.total != null && installOp.progress.current != null
      ? Math.min(100, (installOp.progress.current * 100) / installOp.progress.total)
      : undefined;

  const refresh = useCallback(async () => {
    try {
      const next = await api.tgwsStatus();
      setStatus(next);
      setPort(String(next.port));
    } catch (e) {
      toast.error("Не удалось получить состояние TG Proxy", { description: errorText(e) });
    }
  }, []);

  const refreshLogs = useCallback(async () => {
    try {
      setLogs(await api.tgwsLogs(120));
    } catch {
      setLogs([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
    void refreshLogs();
  }, [refresh, refreshLogs]);

  useEffect(() => {
    if (!status?.running) return;
    const timer = window.setInterval(() => {
      void refresh();
      void refreshLogs();
    }, 4000);
    return () => window.clearInterval(timer);
  }, [status?.running, refresh, refreshLogs]);

  const run = async (key: string, work: () => Promise<TgwsStatus>, done: string) => {
    setBusy(key);
    const t = toast.loading("Выполняется…");
    try {
      const next = await work();
      setStatus(next);
      setPort(String(next.port));
      toast.success(done, { id: t });
      await refreshLogs();
    } catch (e) {
      toast.error("Действие не выполнено", { id: t, description: errorText(e) });
    } finally {
      setBusy(null);
    }
  };

  const install = async () => {
    setBusy("install");
    const t = toast.loading("Скачиваю TG WS Proxy…", { description: "Официальный релиз с GitHub" });
    try {
      const result = await api.tgwsInstall();
      toast.success(`TG WS Proxy ${result.version} установлен`, { id: t });
      await refresh();
    } catch (e) {
      toast.error("Загрузка не удалась", { id: t, description: errorText(e) });
    } finally {
      setBusy(null);
    }
  };

  const savePort = async () => {
    const value = Number.parseInt(port, 10);
    if (!Number.isFinite(value) || value < 1024 || value > 65535) {
      toast.warning("Порт должен быть числом от 1024 до 65535");
      return;
    }
    if (status && value === status.port) {
      toast.info("Порт уже такой");
      return;
    }
    setBusy("port");
    const t = toast.loading("Меняю порт…", { description: "Запущенный прокси будет перезапущен" });
    try {
      const next = await api.tgwsSetPort(value);
      setStatus(next);
      setPort(String(next.port));
      toast.success("Порт сохранён", {
        id: t,
        description: next.running ? "Прокси перезапущен" : "Применится при следующем запуске",
      });
    } catch (e) {
      toast.error("Не удалось изменить порт", { id: t, description: errorText(e) });
    } finally {
      setBusy(null);
    }
  };

  const openTelegram = async () => {
    try {
      await api.tgwsOpenTelegram();
      toast.success("Открываю Telegram", { description: "Подтвердите добавление прокси" });
    } catch (e) {
      toast.error("Не удалось открыть Telegram", { description: errorText(e) });
    }
  };

  const link = useMemo(
    () =>
      status?.link ??
      (status?.secret
        ? `tg://proxy?server=${status.host}&port=${status.port}&secret=${status.secret}`
        : null),
    [status],
  );

  const copyLink = async () => {
    if (!link) return;
    if (await copyText(link)) {
      toast.success("Ссылка скопирована");
    } else {
      toast.error("Не удалось скопировать ссылку");
    }
  };

  const state = !status
    ? { label: "Проверяю…", tone: "idle", title: "Прокси для Telegram" }
    : status.running
      ? { label: "Работает", tone: "success", title: "Telegram идёт через локальный прокси" }
      : status.installed
        ? { label: "Остановлен", tone: "warning", title: "Прокси готов к запуску" }
        : { label: "Не установлен", tone: "idle", title: "Прокси для Telegram" };

  const errorCount = logs?.filter((line) => line.includes("ERROR")).length ?? 0;
  const tone =
    state.tone === "success"
      ? "var(--success)"
      : state.tone === "warning"
        ? "var(--warning)"
        : "var(--muted-foreground)";

  return (
    <Page>
      <PageHeader
        title="TG Proxy"
        subtitle="Локальный MTProto-прокси. Не зависит от Zapret."
        action={
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            disabled={busy !== null}
            onClick={() => {
              void refresh();
              void refreshLogs();
            }}
          >
            <Icon name="refresh-bold" size={13} />
            Обновить
          </Button>
        }
      />

      <section
        className="state-hero material relative overflow-hidden rounded-[10px]"
        data-tone={state.tone}
        style={{ "--state-tone": tone } as CSSProperties}
      >
        <div className="state-hero-glow" aria-hidden />
        <div className="state-hero-noise" aria-hidden />

        <div className="relative z-10 p-6">
          <div className="flex items-center gap-2 text-caption text-muted-foreground">
            <span className="relative flex size-2">
              {status?.running && <span className="status-ring text-success" aria-hidden />}
              <span
                className={cn(
                  "size-2 rounded-full",
                  status?.running
                    ? "bg-success"
                    : status?.installed
                      ? "bg-warning"
                      : "bg-muted-foreground/45",
                )}
              />
            </span>
            <span key={state.label} className="enter-soft">
              {state.label}
            </span>
            {status?.installed && (
              <>
                <span>·</span>
                <span className="numeric font-mono">
                  {status.host}:{status.port}
                </span>
                {status.running && status.pid && (
                  <>
                    <span>·</span>
                    <span className="numeric font-mono">PID {status.pid}</span>
                  </>
                )}
              </>
            )}
          </div>

          <h2
            key={state.title}
            className="text-display enter-soft mt-4"
          >
            {state.title}
          </h2>
          <p className="text-lede mt-2 max-w-[34rem] text-muted-foreground">
            {state.tone === "success"
              ? "Telegram подключается к локальному порту на этом компьютере."
              : state.tone === "warning"
                ? "Прокси установлен, но сейчас не запущен."
                : "Скачайте сборку, чтобы подключать Telegram без Zapret."}
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-2">
            {!status?.installed && (
              <Button size="lg" className="gap-2" disabled={busy !== null} onClick={() => void install()}>
                {busy === "install" ? (
                  <span className="size-3.5 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />
                ) : (
                  <Icon name="download-minimalistic-bold" size={15} />
                )}
                {busy === "install" ? "Скачиваю…" : "Скачать и установить"}
              </Button>
            )}

            {status?.installed && !status.running && (
              <Button
                size="lg"
                className="gap-2"
                disabled={busy !== null}
                onClick={() => void run("start", api.tgwsStart, "Прокси запущен")}
              >
                {busy === "start" ? (
                  <span className="size-3.5 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />
                ) : (
                  <Icon name="play-circle-bold" size={15} />
                )}
                {busy === "start" ? "Запускаю…" : "Запустить"}
              </Button>
            )}

            {status?.running && (
              <Button
                variant="destructive"
                size="lg"
                className="gap-2"
                disabled={busy !== null}
                onClick={() => void run("stop", api.tgwsStop, "Прокси остановлен")}
              >
                <Icon name="stop-circle-bold" size={15} />
                Остановить
              </Button>
            )}

            {status?.installed && (
              <Button
                variant="outline"
                size="lg"
                className="gap-2"
                disabled={busy !== null || !status.secret}
                onClick={() => void openTelegram()}
              >
                <Icon name="widget-4-bold" size={14} />
                Открыть в Telegram
              </Button>
            )}

            {status?.installed && (
              <Button
                variant="ghost"
                size="lg"
                className="ml-auto gap-2 text-muted-foreground hover:text-destructive"
                disabled={busy !== null}
                onClick={() => setConfirmUninstall(true)}
              >
                <Icon name="trash-bin-trash-bold" size={14} />
                Удалить
              </Button>
            )}
          </div>

          {busy === "install" && (
            <div className="mt-5 max-w-[34rem] rounded-[9px] border border-[var(--surface-stroke)] bg-[var(--surface-muted)] p-3">
              <div className="flex items-center justify-between gap-3">
                <span className="flex min-w-0 items-center gap-2 text-[12.5px]">
                  <span className="size-3.5 shrink-0 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />
                  <span className="min-w-0 truncate">
                    {installOp?.progress?.message ?? "Готовлю загрузку…"}
                  </span>
                </span>
                <Button
                  variant="ghost"
                  size="xs"
                  className="shrink-0 text-destructive"
                  disabled={!installOp}
                  onClick={() => installOp && void api.operationsCancel(installOp.id)}
                >
                  Отменить
                </Button>
              </div>
              <Progress value={installPct ?? 0} className="mt-2.5" />
              {installOp?.progress?.current != null && (
                <p className="mt-1.5 font-mono text-[11px] text-muted-foreground">
                  {Math.round(installOp.progress.current / 1_048_576)}
                  {installOp.progress.total != null
                    ? ` / ${Math.round(installOp.progress.total / 1_048_576)} МБ`
                    : " МБ"}
                </p>
              )}
            </div>
          )}
        </div>
      </section>

      {status?.installed ? (
        <SectionCard title="Подключение">
          <div className="flex flex-col gap-1.5">
            <FieldLabel hint="tg://">Ссылка для Telegram</FieldLabel>
            <div className="flex items-center gap-2 rounded-[8px] border border-[var(--surface-stroke)] bg-[var(--surface-muted)] px-3 py-2">
              <Icon name="widget-4-bold" size={14} className="shrink-0 text-muted-foreground" />
              <code className="min-w-0 flex-1 truncate font-mono text-[12px] text-muted-foreground">
                {link ?? "Секрет создастся при первом запуске"}
              </code>
              <Button
                variant="ghost"
                size="icon-xs"
                className="shrink-0"
                disabled={!link}
                aria-label="Скопировать ссылку"
                title="Скопировать ссылку"
                onClick={() => void copyLink()}
              >
                <Icon name="document-text-bold" size={14} />
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <FieldLabel hint="1024–65535">Порт</FieldLabel>
            <div className="flex items-center gap-2">
              <Input
                value={port}
                onChange={(e) => setPort(e.target.value.replace(/[^0-9]/g, ""))}
                inputMode="numeric"
                className="numeric h-8 max-w-[110px] font-mono text-[13px]"
                aria-label="Порт TG WS Proxy"
              />
              <Button
                size="sm"
                className="gap-1.5"
                disabled={busy !== null || !status || port === String(status.port)}
                onClick={() => void savePort()}
              >
                {busy === "port" ? (
                  <span className="size-3.5 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />
                ) : (
                  <Icon name="check-circle-bold" size={13} />
                )}
                {busy === "port" ? "Применяю…" : "Применить"}
              </Button>
            </div>
          </div>
        </SectionCard>
      ) : (
        <SectionCard title="Как это работает">
          <p className="text-caption text-muted-foreground">
            Control скачивает официальный TgWsProxy, запускает его отдельным процессом и открывает
            Telegram по готовой ссылке.
          </p>
        </SectionCard>
      )}

      <SectionCard
        title="Журнал"
        action={
          <div className="flex items-center gap-2">
            {errorCount > 0 && (
              <span className="text-[11px] font-medium text-destructive">ошибок: {errorCount}</span>
            )}
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Обновить журнал"
              title="Обновить журнал"
              onClick={() => void refreshLogs()}
            >
              <Icon name="refresh-bold" size={12} />
            </Button>
            <Button
              variant="ghost"
              size="xs"
              className="gap-1.5"
              onClick={() => setLogsOpen((value) => !value)}
            >
              <Icon name={logsOpen ? "alt-arrow-up-bold" : "alt-arrow-down-bold"} size={12} />
              {logsOpen ? "Свернуть" : "Показать"}
            </Button>
          </div>
        }
      >
        {!logsOpen ? (
          <p className="text-caption text-muted-foreground">
            {logs === null
              ? "Читаю журнал…"
              : logs.length === 0
                ? "Журнал пуст. Он появится после первого запуска прокси."
                : `${logs.length} строк в журнале`}
          </p>
        ) : logs === null ? (
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-4/5" />
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
              <span className="truncate font-mono">%APPDATA%\TgWsProxy\proxy.log</span>
              <span className="numeric shrink-0">{logs.length} строк</span>
            </div>
            <div className="max-h-[280px] overflow-y-auto rounded-[8px] border border-[var(--surface-stroke)] bg-[var(--surface-muted)] p-3">
              {logs.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">
                  Записей нет. Запустите прокси — журнал появится автоматически.
                </p>
              ) : (
                <div className="flex flex-col font-mono text-[12px] leading-relaxed">
                  {logs.map((line, index) => (
                    <span
                      key={index}
                      className={cn(
                        "whitespace-pre-wrap break-words",
                        line.includes("ERROR")
                          ? "text-destructive"
                          : line.includes("WARN")
                            ? "text-warning"
                            : "text-muted-foreground",
                      )}
                    >
                      {line}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </SectionCard>

      <Modal
        open={confirmUninstall}
        onOpenChange={setConfirmUninstall}
        size="sm"
        title="Удалить TG WS Proxy?"
        description="Процесс остановится, исполняемый файл удалится. Конфигурация в %APPDATA%\TgWsProxy останется."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmUninstall(false)}>
              Отмена
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirmUninstall(false);
                void run("uninstall", api.tgwsUninstall, "TG WS Proxy удалён");
              }}
            >
              Удалить
            </Button>
          </>
        }
      />
    </Page>
  );
}
