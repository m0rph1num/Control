import { errorText } from "@/shared/error";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { toast } from "sonner";
import { api, onProtectionState, type ProtectionSnapshot, type StrategyInfo } from "@/shared/api";
import { Button } from "@/components/ui/button";
import { Icon } from "@/shared/ui/Icon";
import { ListRow, Page, PageHeader, SectionCard } from "@/shared/ui/screen";
import { StrategyAdvisor } from "@/features/protection/StrategyAdvisor";

const STATE_META: Record<
  string,
  {
    label: string;
    title: string;
    tone: "idle" | "success" | "warning" | "danger";
  }
> = {
  stopped: { label: "Выключена", title: "Защита выключена", tone: "idle" },
  starting: { label: "Запускается", title: "Запуск защиты", tone: "warning" },
  active: { label: "Активна", title: "Защита работает", tone: "success" },
  stopping: { label: "Останавливается", title: "Остановка защиты", tone: "warning" },
  external_instance: { label: "Внешний экземпляр", title: "Найден другой Zapret", tone: "danger" },
  error: { label: "Ошибка", title: "Ошибка защиты", tone: "danger" },
  unknown: { label: "Проверка", title: "Проверяем состояние", tone: "idle" },
};

const TONE_VAR: Record<string, string> = {
  idle: "var(--muted-foreground)",
  success: "var(--success)",
  warning: "var(--warning)",
  danger: "var(--destructive)",
};

export function ProtectionScreen() {
  const [snap, setSnap] = useState<ProtectionSnapshot | null>(null);
  const [strategies, setStrategies] = useState<StrategyInfo[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [pending, setPending] = useState<"start" | "stop" | null>(null);
  const [applying, setApplying] = useState<string | null>(null);
  const pendingToast = useRef<string | number | null>(null);

  const applySnapshot = (snapshot: ProtectionSnapshot) => {
    setSnap((current) =>
      current && snapshot.revision < current.revision ? current : snapshot,
    );
  };

  const sync = async () => {
    try {
      applySnapshot(await api.protectionSnapshot());
    } catch {
      return;
    }
  };

  useEffect(() => {
    let alive = true;
    const apply = (snapshot: ProtectionSnapshot) => {
      if (alive) applySnapshot(snapshot);
    };
    const unsubscribe = onProtectionState(apply);
    void api.protectionSnapshot().then(apply).catch(() => undefined);
    void api.strategiesList().then((list) => {
      if (alive) setStrategies(list);
    });
    void api
      .settingsGet()
      .then((settings) => {
        if (!alive) return;
        const saved = String(settings.lastStrategy ?? window.localStorage.getItem("demo.strategy") ?? "");
        setSelected((current) => current || saved);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      void unsubscribe.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    window.addEventListener("focus", sync);
    return () => window.removeEventListener("focus", sync);
  }, []);

  useEffect(() => {
    if (!selected && strategies.length > 0) {
      setSelected(strategies[0]?.value ?? "");
    }
  }, [strategies, selected]);

  useEffect(() => {
    if (!pending || !snap) return;
    const state = snap.state;
    const done = pending === "start" ? state === "active" : state === "stopped";
    const failed = state === "error" || state === "external_instance";
    if (!done && !failed) return;
    const id = pendingToast.current ?? undefined;
    pendingToast.current = null;
    setPending(null);
    if (done) {
      toast.success(pending === "start" ? "Защита запущена" : "Защита остановлена", {
        ...(id === undefined ? {} : { id }),
      });
    } else {
      toast.error(pending === "start" ? "Не удалось запустить" : "Не удалось остановить", {
        ...(id === undefined ? {} : { id }),
        description: snap.detail,
      });
    }
  }, [pending, snap]);

  useEffect(() => {
    if (!pending) return;
    const timer = window.setTimeout(() => {
      if (pendingToast.current === null) return;
      toast.warning("Состояние не подтвердилось", {
        ...(pendingToast.current === null ? {} : { id: pendingToast.current }),
        description: "Откройте журнал и проверьте, не блокирует ли запуск антивирус",
      });
      pendingToast.current = null;
      setPending(null);
    }, 60_000);
    return () => window.clearTimeout(timer);
  }, [pending]);

  const snapState = snap?.state ?? "unknown";
  const uiState =
    pending === "start" && snapState !== "active" && snapState !== "error"
      ? "starting"
      : pending === "stop" && snapState === "active"
        ? "stopping"
        : snapState;
  const meta = STATE_META[uiState] ?? STATE_META.unknown!;
  const tone = TONE_VAR[meta.tone] ?? TONE_VAR.idle!;
  const active = snapState === "active";
  const transitioning = uiState === "starting" || uiState === "stopping";
  const detail =
    pending === "start"
      ? "Запускаю winws.exe и проверяю соединение…"
      : pending === "stop"
        ? "Останавливаю winws.exe…"
        : (snap?.detail ?? "Получаю состояние…");

  const remember = (value: string) => {
    try {
      window.localStorage.setItem("demo.strategy", value);
    } catch {
      return;
    }
  };

  const adoptStrategy = (value: string) => {
    setSelected(value);
    remember(value);
  };

  const start = async () => {
    if (pending !== null) return;
    remember(selected);
    pendingToast.current = toast.loading("Запускаю защиту…");
    setPending("start");
    try {
      await api.protectionStart(selected);
      await sync();
    } catch (e) {
      if (pendingToast.current !== null) {
        toast.error("Не удалось запустить", {
          id: pendingToast.current,
          description: errorText(e),
        });
        pendingToast.current = null;
      }
      setPending(null);
    }
  };

  const stop = async () => {
    if (pending !== null) return;
    pendingToast.current = toast.loading("Останавливаю…");
    setPending("stop");
    try {
      await api.protectionStop();
      await sync();
    } catch (e) {
      if (pendingToast.current !== null) {
        toast.error("Не удалось остановить", {
          id: pendingToast.current,
          description: errorText(e),
        });
        pendingToast.current = null;
      }
      setPending(null);
    }
  };

  const chooseStrategy = async (value: string) => {
    const previous = selected;
    const wasActive = active;
    setSelected(value);
    remember(value);
    if (!wasActive || value === previous) return;
    setApplying(value);
    const t = toast.loading("Применяю стратегию…", {
      description: "winws перезапустится, служба WinDivert останется",
    });
    try {
      await api.protectionApply(value);
      toast.success("Стратегия применена", { id: t });
    } catch (e) {
      setSelected(previous);
      remember(previous);
      toast.error("Не удалось применить стратегию", { id: t, description: errorText(e) });
    } finally {
      setApplying(null);
    }
  };

  return (
    <Page>
      <PageHeader title="Защита" />

      <section
        className="state-hero material relative overflow-hidden rounded-[12px]"
        data-tone={meta.tone}
        style={{ "--state-tone": tone } as CSSProperties}
      >
        <div className="state-hero-glow" aria-hidden />
        <div className="state-hero-noise" aria-hidden />

        <div className="relative z-10 p-6">
          <div className="flex items-center justify-between gap-4">
            <span
              key={meta.label}
              className="enter-soft inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[11px] font-medium"
              style={{
                color: tone,
                borderColor: `color-mix(in srgb, ${tone} 26%, transparent)`,
                background: `color-mix(in srgb, ${tone} 8%, transparent)`,
              }}
            >
              <span className="relative flex size-1.5">
                {(meta.tone === "success" || meta.tone === "warning") && (
                  <span className="status-ring" aria-hidden />
                )}
                <span className="size-1.5 rounded-full" style={{ background: tone }} />
              </span>
              {meta.label}
            </span>

            <span className="numeric font-mono text-[12px] text-muted-foreground">
              {snap?.pid ? `PID ${snap.pid}` : ""}
            </span>
          </div>

          <h2
            key={uiState}
            className="text-display enter-soft mt-4"
          >
            {meta.title}
          </h2>
          <p className="text-lede mt-2 max-w-[34rem] text-muted-foreground">
            {detail}
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-2.5">
            {!active && !transitioning && (
              <Button
                onClick={() => void start()}
                disabled={!selected || pending !== null}
                size="lg"
                className="gap-2"
              >
                <Icon name="play-circle-bold" size={16} />
                Запустить
              </Button>
            )}
            {active && !transitioning && (
              <Button
                variant="destructive"
                onClick={() => void stop()}
                disabled={pending !== null}
                size="lg"
                className="gap-2"
              >
                <Icon name="stop-circle-bold" size={16} />
                Остановить
              </Button>
            )}
            {transitioning && (
              <Button disabled size="lg" className="gap-2">
                <span className="size-3.5 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />
                {uiState === "starting" ? "Запускается…" : "Останавливается…"}
              </Button>
            )}
          </div>
        </div>
      </section>

      <StrategyAdvisor active={active} selected={selected} onApplied={adoptStrategy} />

      <SectionCard
        title="Стратегия"
        action={
          active ? (
            <span className="text-[11px] font-medium text-[color:var(--accent-foreground)]">
              применяется сразу
            </span>
          ) : (
            <span className="text-[11px] text-muted-foreground">применится при запуске</span>
          )
        }
      >
        {strategies.length === 0 && (
          <p className="text-caption px-2 py-4 text-muted-foreground">
            Стратегии не найдены — установите версию Zapret.
          </p>
        )}
        {strategies.map((strategy) => {
          const isSelected = selected === strategy.value;
          const isApplying = applying === strategy.value;
          return (
            <ListRow
              key={strategy.value}
              title={strategy.label}
              subtitle={strategy.kind === "preset" ? "Профиль-пресет" : strategy.filename}
              selected={isSelected}
              onClick={() => void chooseStrategy(strategy.value)}
              trailing={
                isApplying ? (
                  <span className="size-3.5 animate-spin rounded-full border-[1.5px] border-[color:var(--ring)] border-t-transparent" />
                ) : isSelected ? (
                  <Icon
                    name="check-circle-bold"
                    size={15}
                    className="text-[color:var(--accent-foreground)]"
                  />
                ) : undefined
              }
            />
          );
        })}
      </SectionCard>
    </Page>
  );
}
