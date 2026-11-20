import { errorText } from "@/shared/error";
import { useEffect, useState, type CSSProperties } from "react";
import { toast } from "sonner";
import { playSound } from "@/shared/sound";
import { api, onProtectionState, type ProtectionSnapshot, type StrategyInfo } from "@/shared/api";
import { Button } from "@/components/ui/button";
import { Icon } from "@/shared/ui/Icon";
import { ListRow, Page, PageHeader, SectionCard } from "@/shared/ui/screen";

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
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void api.protectionSnapshot().then((snapshot) => {
      if (alive) setSnap(snapshot);
    });
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
    const unsubscribe = onProtectionState((snapshot) => {
      if (alive) setSnap(snapshot);
    });
    return () => {
      alive = false;
      void unsubscribe.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    if (!selected && strategies.length > 0) {
      setSelected(strategies[0]?.value ?? "");
    }
  }, [strategies, selected]);

  const meta = STATE_META[snap?.state ?? "unknown"] ?? STATE_META.unknown!;
  const tone = TONE_VAR[meta.tone] ?? TONE_VAR.idle!;
  const active = snap?.state === "active";
  const transitioning = snap?.state === "starting" || snap?.state === "stopping";

  const remember = (value: string) => {
    try {
      window.localStorage.setItem("demo.strategy", value);
    } catch {
      return;
    }
  };

  const start = async () => {
    setBusy(true);
    remember(selected);
    const t = toast.loading("Запускаю защиту…");
    try {
      await api.protectionStart(selected);
      playSound("launch");
      toast.success("Защита запущена", { id: t });
    } catch (e) {
      toast.error("Не удалось запустить", { id: t, description: errorText(e) });
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    setBusy(true);
    const t = toast.loading("Останавливаю…");
    try {
      await api.protectionStop();
      playSound("stop");
      toast.success("Защита остановлена", { id: t });
    } catch (e) {
      toast.error("Не удалось остановить", { id: t, description: errorText(e) });
    } finally {
      setBusy(false);
    }
  };

  const chooseStrategy = async (value: string) => {
    const wasActive = active;
    setSelected(value);
    remember(value);
    if (!wasActive || value === selected) return;
    setApplying(value);
    const t = toast.loading("Применяю стратегию…", {
      description: "winws перезапустится, служба WinDivert останется",
    });
    try {
      await api.protectionApply(value);
      toast.success("Стратегия применена", { id: t });
    } catch (e) {
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
            key={snap?.state ?? "unknown"}
            className="text-display enter-soft mt-4"
          >
            {meta.title}
          </h2>
          <p className="text-lede mt-2 max-w-[34rem] text-muted-foreground">
            {snap?.detail ?? "Получаю состояние…"}
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-2.5">
            {!active && !transitioning && (
              <Button
                onClick={() => void start()}
                disabled={!selected || busy}
                size="lg"
                className="gap-2"
              >
                <Icon name="play-circle-bold" size={16} />
                Запустить
              </Button>
            )}
            {active && (
              <Button
                variant="destructive"
                onClick={() => void stop()}
                disabled={busy}
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
                {snap?.state === "starting" ? "Запускается…" : "Останавливается…"}
              </Button>
            )}
          </div>
        </div>
      </section>

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
