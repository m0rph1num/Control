import { useState, type CSSProperties } from "react";
import { toast } from "sonner";
import { api, type AdvisorCandidate, type AdvisorReport } from "@/shared/api";
import { errorText } from "@/shared/error";
import { Button } from "@/components/ui/button";
import { Icon } from "@/shared/ui/Icon";
import { AdvisorCard } from "@/features/advisor/AdvisorCard";
import { AdvisorFacts } from "@/features/advisor/AdvisorFacts";
import { useAdvisorScan } from "@/features/advisor/useAdvisorScan";

const RING_RADIUS = 22;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

function ScoreRing({ value }: { value: number }) {
  return (
    <div
      className="relative grid size-[52px] shrink-0 place-items-center"
      role="img"
      aria-label={`Соответствие условиям ${value}%`}
    >
      <svg viewBox="0 0 52 52" className="absolute inset-0 -rotate-90">
        <circle
          cx="26"
          cy="26"
          r={RING_RADIUS}
          fill="none"
          stroke="var(--fill-strong)"
          strokeWidth="2.5"
        />
        <circle
          cx="26"
          cy="26"
          r={RING_RADIUS}
          fill="none"
          stroke="var(--ring)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray={RING_LENGTH}
          strokeDashoffset={RING_LENGTH * (1 - value / 100)}
          className="score-ring-value"
          style={{ "--score-length": RING_LENGTH } as CSSProperties}
        />
      </svg>
      <span className="numeric text-[12.5px] font-semibold text-[color:var(--accent-foreground)]">
        {value}%
      </span>
    </div>
  );
}

function detectedLine(report: AdvisorReport): string | null {
  const games = report.apps.filter((app) => app.kind === "game");
  const source = games.length > 0 ? games : report.apps;
  if (source.length === 0) return null;
  const names = source.slice(0, 2).map((app) => app.name).join(" · ");
  const rest = source.length > 2 ? ` +${source.length - 2}` : "";
  return `${games.length > 0 ? "Игры" : "Приложения"}: ${names}${rest}`;
}

export function StrategyAdvisor({
  active,
  selected,
  onApplied,
}: {
  active: boolean;
  selected: string;
  onApplied: (value: string) => void;
}) {
  const { phase, report, steps, error, scan } = useAdvisorScan();
  const [applying, setApplying] = useState<string | null>(null);
  const [applied, setApplied] = useState<string | null>(null);

  const best = report?.candidates[0] ?? null;
  const alternatives = report?.candidates.slice(1, 3) ?? [];
  const isCurrent = best !== null && (applied === best.value || (active && selected === best.value));
  const line = report ? detectedLine(report) : null;

  const apply = async (candidate: AdvisorCandidate) => {
    setApplying(candidate.value);
    const t = toast.loading("Применяю стратегию…", {
      description: active
        ? "winws перезапустится с новыми правилами"
        : "Защита включится с подобранной стратегией",
    });
    try {
      const result = await api.advisorApply(candidate.value);
      setApplied(result.strategy);
      onApplied(result.strategy);
      toast.success(result.liveApplied ? "Стратегия применена" : "Защита включена", {
        id: t,
        description: candidate.label,
      });
    } catch (e) {
      toast.error("Не удалось применить стратегию", { id: t, description: errorText(e) });
    } finally {
      setApplying(null);
    }
  };

  return (
    <AdvisorCard
      icon="bolt-circle-bold"
      title="Подбор стратегии"
      description={
        phase === "scanning"
          ? "Изучаем сеть, задержки и установленные приложения."
          : "Сверяем стратегии Zapret с реальными замерами: задержки, TLS, игры и приложения."
      }
      action="Подобрать"
      note="≈ 10 секунд"
      phase={phase}
      steps={steps}
      error={error}
      onScan={() => void scan()}
    >
      {report && (
        <>
          <div className="flex flex-col gap-2.5">
            <AdvisorFacts report={report} />
            {line && <p className="text-[11.5px] leading-relaxed text-muted-foreground">{line}</p>}
          </div>

          {best ? (
            <div className="rounded-[12px] border border-[var(--surface-stroke)] bg-[var(--surface-muted)] p-5">
              <div className="flex items-start gap-5">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-[color:var(--accent-foreground)]">
                    <Icon name="check-circle-bold" size={12} />
                    Рекомендуем
                  </p>
                  <p className="mt-2 text-[14.5px] font-medium leading-snug">{best.label}</p>
                  {best.reasons.length > 0 && (
                    <p className="mt-1.5 line-clamp-2 text-[11.5px] leading-relaxed text-muted-foreground">
                      {best.reasons.slice(0, 3).join(" · ")}
                    </p>
                  )}
                </div>
                <ScoreRing value={best.score} />
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[var(--separator)] pt-4">
                {isCurrent ? (
                  <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-success">
                    <Icon name="check-circle-bold" size={14} />
                    Стратегия применена
                  </span>
                ) : (
                  <Button
                    size="sm"
                    className="gap-1.5"
                    disabled={applying !== null}
                    onClick={() => void apply(best)}
                  >
                    {applying === best.value ? (
                      <span className="size-3.5 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />
                    ) : (
                      <Icon name="bolt-circle-bold" size={13} />
                    )}
                    {active ? "Применить" : "Применить и включить"}
                  </Button>
                )}
                <span className="text-[11.5px] text-muted-foreground">
                  {isCurrent
                    ? "это текущая стратегия"
                    : active
                      ? "без остановки защиты"
                      : "защита запустится сразу"}
                </span>
              </div>
            </div>
          ) : (
            <div className="rounded-[10px] border border-dashed border-[var(--surface-stroke)] px-4 py-5 text-[12px] leading-relaxed text-muted-foreground">
              Стратегии не найдены. Установите Zapret в разделе «Версии».
            </div>
          )}

          {alternatives.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <p className="px-2 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground/70">
                Другие варианты
              </p>
              <div className="grid gap-0.5 md:grid-cols-2 md:gap-x-2">
                {alternatives.map((candidate) => (
                  <button
                    key={candidate.value}
                    type="button"
                    disabled={applying !== null}
                    onClick={() => void apply(candidate)}
                    className="group flex items-center gap-3 rounded-[8px] px-2 py-2 text-left transition-colors hover:bg-[var(--fill)] disabled:pointer-events-none disabled:opacity-60"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] text-muted-foreground transition-colors group-hover:text-foreground">
                        {candidate.label}
                      </span>
                      {candidate.reasons[0] && (
                        <span className="mt-0.5 block truncate text-[10.5px] text-muted-foreground/70">
                          {candidate.reasons[0]}
                        </span>
                      )}
                    </span>
                    <span className="score-track w-16 shrink-0">
                      <span className="score-fill" style={{ width: `${candidate.score}%` }} />
                    </span>
                    <span className="numeric w-8 shrink-0 text-right text-[11px] text-muted-foreground">
                      {candidate.score}%
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </AdvisorCard>
  );
}
