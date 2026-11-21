import { cn } from "cn";
import { Icon } from "@/shared/ui/Icon";
import type { AdvisorStepState } from "@/features/advisor/useAdvisorScan";

const STEP_META: { id: string; label: string }[] = [
  { id: "network", label: "Сеть и задержки" },
  { id: "apps", label: "Приложения и игры" },
  { id: "strategies", label: "Стратегии Zapret" },
  { id: "profile", label: "Профиль настроек" },
];

export function AdvisorSteps({
  steps,
  className,
}: {
  steps: Record<string, AdvisorStepState>;
  className?: string;
}) {
  return (
    <ol className={cn("grid grid-cols-2 gap-x-5 gap-y-3 sm:grid-cols-4", className)}>
      {STEP_META.map((step, index) => {
        const state = steps[step.id] ?? "idle";
        return (
          <li key={step.id} data-state={state} className="flex min-w-0 items-center gap-2.5">
            <span
              className={cn(
                "numeric grid size-[18px] shrink-0 place-items-center rounded-full border text-[9.5px] font-medium transition-colors duration-200",
                state === "ok" && "border-transparent bg-success/12 text-success",
                state === "running" && "border-ring/40 text-ring",
                state === "idle" && "border-[var(--surface-stroke)] text-muted-foreground/60",
              )}
            >
              {state === "ok" ? (
                <Icon name="check-bold" size={10} />
              ) : state === "running" ? (
                <span className="size-2.5 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />
              ) : (
                index + 1
              )}
            </span>
            <span
              className={cn(
                "truncate text-[11.5px] transition-colors duration-200",
                state === "idle" ? "text-muted-foreground/70" : "text-foreground",
              )}
            >
              {step.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
