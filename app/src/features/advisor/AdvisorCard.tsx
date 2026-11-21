import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Icon, type IconName } from "@/shared/ui/Icon";
import { AdvisorSteps } from "@/features/advisor/AdvisorSteps";
import type { AdvisorPhase, AdvisorStepState } from "@/features/advisor/useAdvisorScan";

export function AdvisorCard({
  icon,
  title,
  description,
  action,
  note,
  phase,
  steps,
  error,
  onScan,
  children,
}: {
  icon: IconName;
  title: string;
  description: string;
  action: string;
  note: string;
  phase: AdvisorPhase;
  steps: Record<string, AdvisorStepState>;
  error: string | null;
  onScan: () => void;
  children: ReactNode;
}) {
  return (
    <section className="advisor-hero material relative overflow-hidden rounded-[14px]">
      <div className="advisor-hero-glow" aria-hidden />

      <div className="relative z-10 p-6 sm:p-7">
        <div className="flex items-start gap-4">
          <span className="grid size-9 shrink-0 place-items-center rounded-[9px] bg-[var(--accent)] text-[var(--accent-foreground)]">
            <Icon name={icon} size={18} />
          </span>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <h2 className="text-heading">{title}</h2>
              <span className="text-[9.5px] font-medium uppercase tracking-[0.14em] text-muted-foreground/70">
                авто
              </span>
            </div>
            <p className="mt-1 max-w-[56rem] text-[12.5px] leading-relaxed text-muted-foreground">
              {description}
            </p>
          </div>

          {(phase === "ready" || phase === "error") && (
            <button
              type="button"
              onClick={onScan}
              aria-label="Изучить заново"
              className="grid size-8 shrink-0 place-items-center rounded-[7px] text-muted-foreground transition-colors hover:bg-[var(--fill)] hover:text-foreground"
            >
              <Icon name="refresh-bold" size={14} />
            </button>
          )}
        </div>

        {phase === "idle" && (
          <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2.5">
            <Button size="sm" className="gap-1.5" onClick={onScan}>
              <Icon name="cpu-bolt-bold" size={14} />
              {action}
            </Button>
            <span className="text-[11.5px] text-muted-foreground">{note}</span>
          </div>
        )}

        {phase === "scanning" && (
          <div className="mt-6 flex flex-col gap-4">
            <AdvisorSteps steps={steps} />
            <div className="advisor-progress" aria-hidden>
              <span className="advisor-progress-fill" />
            </div>
          </div>
        )}

        {phase === "error" && (
          <div className="mt-6 flex flex-wrap items-center gap-3 rounded-[10px] border border-destructive/20 bg-destructive/5 px-4 py-3">
            <Icon name="danger-triangle-bold" size={16} className="text-destructive" />
            <p className="min-w-[12rem] flex-1 text-[12px] leading-relaxed text-destructive">
              {error ?? "Не удалось изучить компьютер"}
            </p>
            <Button size="xs" variant="outline" onClick={onScan}>
              Повторить
            </Button>
          </div>
        )}

        {phase === "ready" && (
          <div className="enter-rise mt-6 flex flex-col gap-5">{children}</div>
        )}
      </div>
    </section>
  );
}
