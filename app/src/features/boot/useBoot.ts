import { useEffect, useRef, useState } from "react";
import { api } from "@/shared/api";

export type BootPhase = "booting" | "leaving" | "ready";
export type BootStatus = "pending" | "running" | "done" | "error";

export interface BootStep {
  id: string;
  label: string;
  status: BootStatus;
}

const STEPS: { id: string; label: string }[] = [
  { id: "core", label: "Инициализация ядра" },
  { id: "settings", label: "Чтение настроек" },
  { id: "versions", label: "Поиск установок Zapret" },
  { id: "service", label: "Проверка службы и защиты" },
  { id: "autostart", label: "Проверка автозапуска" },
];

const STEP_FLOOR = 130;
const TOTAL_FLOOR = 900;
const LEAVE_MS = 320;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface BootState {
  phase: BootPhase;
  progress: number;
  label: string;
  setupNeeded: boolean | null;
  minimized: boolean;
}

export function useBoot(): BootState {
  const [phase, setPhase] = useState<BootPhase>("booting");
  const [steps, setSteps] = useState<BootStep[]>(
    STEPS.map((step) => ({ ...step, status: "pending" })),
  );
  const [setupNeeded, setSetupNeeded] = useState<boolean | null>(null);
  const [minimized, setMinimized] = useState(false);
  const [index, setIndex] = useState(0);
  const started = useRef(0);

  useEffect(() => {
    let cancelled = false;
    started.current = performance.now();

    const setStatus = (id: string, status: BootStatus) => {
      setSteps((current) =>
        current.map((step) => (step.id === id ? { ...step, status } : step)),
      );
    };

    const run = async () => {
      try {
        const flags = await api.startupFlags();
        if (!cancelled) setMinimized(flags.minimized);
      } catch {
        if (!cancelled) setMinimized(false);
      }

      let needed = true;

      for (let i = 0; i < STEPS.length; i += 1) {
        if (cancelled) return;
        const step = STEPS[i]!;
        setIndex(i);
        setStatus(step.id, "running");
        const stepStart = performance.now();
        let failed = false;

        try {
          if (step.id === "core") {
            await api.getAppInfo();
          } else if (step.id === "settings") {
            await api.settingsGet();
          } else if (step.id === "versions") {
            const list = await api.versionsList();
            needed = list.length === 0;
          } else if (step.id === "service") {
            await Promise.all([api.serviceStatus(), api.protectionSnapshot()]);
          } else if (step.id === "autostart") {
            await api.autostartInfo();
          }
        } catch {
          failed = true;
        }

        const rest = STEP_FLOOR - (performance.now() - stepStart);
        if (rest > 0) await wait(rest);
        if (cancelled) return;
        setStatus(step.id, failed ? "error" : "done");
      }

      const totalRest = TOTAL_FLOOR - (performance.now() - started.current);
      if (totalRest > 0) await wait(totalRest);
      if (cancelled) return;

      setSetupNeeded(needed);
      setPhase("leaving");
      await wait(LEAVE_MS);
      if (cancelled) return;
      setPhase("ready");
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, []);

  const completed = steps.filter((step) => step.status === "done" || step.status === "error").length;
  const progress = phase === "booting" ? (completed / steps.length) * 100 : 100;
  const current = steps[index];
  const label = phase === "ready" ? "Готово" : current?.label ?? "Подготовка";

  return { phase, progress, label, setupNeeded, minimized };
}
