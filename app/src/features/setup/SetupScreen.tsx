import { errorText } from "@/shared/error";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, type EnvironmentChecks, type InstalledVersion } from "@/shared/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Icon } from "@/shared/ui/Icon";
import { FieldLabel } from "@/shared/ui/screen";

type Step = "env" | "dir" | "version";

const STEPS: { id: Step; label: string }[] = [
  { id: "env", label: "Окружение" },
  { id: "dir", label: "Папка" },
  { id: "version", label: "Zapret" },
];

export function SetupScreen({ onDone }: { onDone: () => void }) {
  const [checks, setChecks] = useState<EnvironmentChecks | null>(null);
  const [controlDir, setControlDir] = useState("");
  const [existing, setExisting] = useState<InstalledVersion[]>([]);
  const [step, setStep] = useState<Step>("env");
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    api
      .setupRunChecks()
      .then((c) => {
        setChecks(c);
        if (c.defaultDir) setControlDir(c.defaultDir);
      })
      .catch((e) => toast.error("Проверка окружения не удалась", { description: errorText(e) }));
  }, []);

  const applyDir = async () => {
    try {
      await api.setupApply({ controlDir, minimizeToTray: true, notifications: true, restoreState: true });
      setStep("version");
    } catch (e) {
      toast.error("Не удалось сохранить папку", { description: errorText(e) });
    }
  };

  const downloadFlow = async () => {
    setInstalling(true);
    const t = toast.loading("Скачиваю Zapret…");
    try {
      const releases = await api.versionsAvailable();
      const latest = releases.find((r) => r.assetUrl);
      if (!latest || !latest.assetUrl || !latest.assetName) {
        toast.warning("GitHub не вернул доступных сборок", { id: t, description: "Установите Zapret вручную" });
        return;
      }
      const res = await api.versionsDownload(latest.version, latest.assetUrl, latest.assetName);
      toast.loading("Устанавливаю…", { id: t, description: `zapret ${latest.version}` });
      await api.versionsInstall(latest.version, res.archivePath);
      setExisting(await api.versionsList());
      toast.success(`Zapret ${latest.version} установлен`, { id: t });
      onDone();
    } catch (e) {
      toast.error("Установка не удалась", { id: t, description: errorText(e) });
    } finally {
      setInstalling(false);
    }
  };

  const useExistingVersion = async (folder: string) => {
    try {
      await api.controlSelectVersion(folder);
      onDone();
    } catch (e) {
      toast.error("Не удалось выбрать версию", { description: errorText(e) });
    }
  };

  const stepIndex = STEPS.findIndex((s) => s.id === step);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-title">Настройка Control</h1>
        <p className="text-lede mt-2 text-muted-foreground">
          Проверка окружения, папка данных и установка Zapret.
        </p>
      </header>

      <div className="flex items-center gap-2 text-[13px]">
        {STEPS.map((item, index) => {
          const active = item.id === step;
          const done = index < stepIndex;
          return (
            <div key={item.id} className="flex items-center gap-2">
              {index > 0 && <span className="text-muted-foreground/40">/</span>}
              <span
                className={
                  active
                    ? "font-medium text-foreground"
                    : done
                      ? "text-muted-foreground"
                      : "text-muted-foreground/60"
                }
              >
                <span className="numeric mr-1.5 text-[11px]">{index + 1}</span>
                {item.label}
              </span>
            </div>
          );
        })}
      </div>

      <section className="material rounded-[10px] p-4">
        {step === "env" && (
          <div className="flex flex-col gap-4">
            <h2 className="text-section">Проверка окружения</h2>

            {checks === null ? (
              <div className="flex flex-col gap-1.5">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : (
              <div className="flex flex-col">
                <EnvRow label="Права администратора" ok={checks.admin} />
                <EnvRow label="Интернет" ok={checks.internet} />
                <EnvRow label="DNS" ok={checks.dns} />
                <EnvRow label="WinDivert" ok={checks.winDivertInstalled} />
              </div>
            )}

            <Button className="self-start" onClick={() => setStep("dir")} disabled={checks === null}>
              Продолжить
            </Button>
          </div>
        )}

        {step === "dir" && (
          <div className="flex flex-col gap-4">
            <h2 className="text-section">Папка Control</h2>

            <div className="flex flex-col gap-1.5">
              <FieldLabel>Путь к данным</FieldLabel>
              <Input
                value={controlDir}
                onChange={(e) => setControlDir(e.target.value)}
                className="font-mono text-[12px]"
                aria-label="Папка Control"
              />
            </div>

            <div className="flex items-center gap-2">
              <Button onClick={() => void applyDir()} disabled={!controlDir.trim()}>
                Сохранить и продолжить
              </Button>
              <Button variant="ghost" onClick={() => setStep("env")}>
                Назад
              </Button>
            </div>
          </div>
        )}

        {step === "version" && (
          <div className="flex flex-col gap-4">
            <h2 className="text-section">Установить Zapret (Flowseal)</h2>

            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => void downloadFlow()} disabled={installing} className="gap-1.5">
                <Icon name="download-minimalistic-bold" size={14} />
                {installing ? "Установка…" : "Скачать и установить"}
              </Button>
              <Button variant="ghost" onClick={() => setStep("dir")}>
                Назад
              </Button>
            </div>

            {existing.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <p className="text-caption text-muted-foreground">Или используйте найденную версию</p>
                {existing.map((version) => (
                  <button
                    key={version.folder}
                    type="button"
                    onClick={() => void useExistingVersion(version.folder)}
                    className="row w-full cursor-pointer justify-between text-left"
                  >
                    <span className="font-mono text-[13px]">v{version.version}</span>
                    <Icon name="play-circle-bold" size={14} className="text-muted-foreground" />
                  </button>
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={onDone}
              className="text-caption cursor-pointer self-start text-muted-foreground transition-colors hover:text-foreground"
            >
              Пропустить
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

function EnvRow({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex h-9 items-center justify-between border-b border-[var(--separator)] text-[13px] last:border-b-0">
      <span>{label}</span>
      <span className={ok ? "text-success" : "text-destructive"}>
        <Icon name={ok ? "check-circle-bold" : "close-circle-bold"} size={14} />
      </span>
    </div>
  );
}
