import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, type Profile } from "@/shared/api";
import { errorText } from "@/shared/error";
import { Button } from "@/components/ui/button";
import { Icon } from "@/shared/ui/Icon";
import { AdvisorCard } from "@/features/advisor/AdvisorCard";
import { AdvisorFacts } from "@/features/advisor/AdvisorFacts";
import { useAdvisorScan } from "@/features/advisor/useAdvisorScan";

const GAME_LABEL: Record<Profile["gameFilter"], string> = {
  disabled: "без игрового фильтра",
  all: "игры TCP+UDP",
  tcp: "игры TCP",
  udp: "игры UDP",
};

function SpecRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-6 py-2.5">
      <dt className="shrink-0 text-[11.5px] text-muted-foreground">{label}</dt>
      <dd
        className={
          mono
            ? "min-w-0 truncate text-right font-mono text-[11.5px] text-foreground"
            : "min-w-0 truncate text-right text-[12px] font-medium"
        }
      >
        {value}
      </dd>
    </div>
  );
}

export function AutoProfile({
  onSaved,
}: {
  onSaved: (profile: Profile) => void | Promise<void>;
}) {
  const { phase, report, steps, error, scan } = useAdvisorScan();
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);

  useEffect(() => {
    setSavedId(null);
  }, [report?.scannedAt]);

  const save = async () => {
    if (!report) return;
    setSaving(true);
    const t = toast.loading("Создаю профиль…");
    try {
      const saved = await api.profileSave({ ...report.profile, id: "" });
      setSavedId(saved.id);
      toast.success("Профиль создан", { id: t, description: saved.name });
      await onSaved(saved);
    } catch (e) {
      toast.error("Не удалось создать профиль", { id: t, description: errorText(e) });
    } finally {
      setSaving(false);
    }
  };

  const profile = report?.profile ?? null;
  const best = report?.candidates[0] ?? null;

  return (
    <AdvisorCard
      icon="cpu-bolt-bold"
      title="Профиль под ваш компьютер"
      description={
        phase === "scanning"
          ? "Собираем стратегию, фильтр и fake-файлы под ваши приложения."
          : "Соберём стратегию, игровой фильтр и fake-файлы под ваши игры."
      }
      action="Изучить компьютер"
      note="≈ 10 секунд"
      phase={phase}
      steps={steps}
      error={error}
      onScan={() => void scan()}
    >
      {report && profile && (
        <>
          <AdvisorFacts report={report} />

          <div className="overflow-hidden rounded-[12px] border border-[var(--surface-stroke)] bg-[var(--surface-muted)]">
            <div className="px-5 pb-4 pt-5">
              <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground/70">
                Профиль
              </p>
              <p className="mt-1.5 text-[14.5px] font-medium leading-snug">{profile.name}</p>
            </div>
            <dl className="divide-y divide-[var(--separator)] border-t border-[var(--separator)] px-5">
              <SpecRow label="Стратегия" value={best?.label ?? profile.strategy} />
              <SpecRow label="Игровой фильтр" value={GAME_LABEL[profile.gameFilter]} />
              {profile.fakes.discord && (
                <SpecRow label="Fake Discord" value={profile.fakes.discord} mono />
              )}
              {profile.fakes.game && <SpecRow label="Fake для игр" value={profile.fakes.game} mono />}
            </dl>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Button
              size="sm"
              className="gap-1.5"
              disabled={saving || savedId !== null}
              onClick={() => void save()}
            >
              {saving ? (
                <span className="size-3.5 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />
              ) : (
                <Icon name={savedId ? "check-circle-bold" : "add-circle-bold"} size={14} />
              )}
              {savedId ? "Профиль сохранён" : "Сохранить профиль"}
            </Button>
            <span className="text-[11.5px] text-muted-foreground">
              {savedId ? "Появился в списке профилей" : "Отредактируете в любой момент"}
            </span>
          </div>
        </>
      )}
    </AdvisorCard>
  );
}
