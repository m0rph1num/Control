import { errorText } from "@/shared/error";
import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { api, type EnvironmentChecks, type InstalledVersion } from "@/shared/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Skeleton } from "@/components/ui/skeleton";
import { Icon } from "@/shared/ui/Icon";
import { FieldLabel } from "@/shared/ui/screen";

type Step = "dir" | "version";

export function SetupScreen({ onDone }: { onDone: () => void }) {
  const [checks, setChecks] = useState<EnvironmentChecks | null>(null);
  const [controlDir, setControlDir] = useState("");
  const [existing, setExisting] = useState<InstalledVersion[]>([]);
  const [step, setStep] = useState<Step>("dir");
  const [installing, setInstalling] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .setupRunChecks()
      .then((c) => {
        setChecks(c);
        if (c.defaultDir) setControlDir(c.defaultDir);
      })
      .catch((e) => toast.error("Проверка окружения не удалась", { description: errorText(e) }));
  }, []);

  const browse = async () => {
    try {
      const selected = await open({ directory: true, multiple: false, title: "Папка для Control" });
      if (typeof selected === "string") setControlDir(selected);
    } catch (e) {
      toast.error("Не удалось открыть проводник", { description: errorText(e) });
    }
  };

  const applyDir = async () => {
    setBusy(true);
    try {
      await api.setupApply({
        controlDir: controlDir.trim(),
        minimizeToTray: true,
        notifications: true,
        restoreState: true,
      });
      setExisting(await api.versionsList());
      setStep("version");
    } catch (e) {
      toast.error("Не удалось сохранить папку", { description: errorText(e) });
    } finally {
      setBusy(false);
    }
  };

  const downloadFlow = async () => {
    setInstalling(true);
    const t = toast.loading("Скачиваю Zapret…");
    try {
      const releases = await api.versionsAvailable();
      const latest = releases.find((r) => r.assetUrl);
      if (!latest || !latest.assetUrl || !latest.assetName) {
        toast.warning("GitHub не вернул доступных сборок", {
          id: t,
          description: "Установите Zapret вручную",
        });
        return;
      }
      const res = await api.versionsDownload(latest.version, latest.assetUrl, latest.assetName);
      toast.loading("Устанавливаю…", { id: t, description: `zapret ${latest.version}` });
      await api.versionsInstall(latest.version, res.archivePath);
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

  return (
    <Modal
      open
      onOpenChange={() => {}}
      size="md"
      title={step === "dir" ? "Где хранить Control?" : "Установите Zapret"}
      description={
        step === "dir"
          ? "В этой папке будут версии Zapret, профили, пресеты и резервные копии."
          : "Control скачает и установит последнюю сборку Zapret (Flowseal)."
      }
      footer={
        step === "dir" ? (
          <>
            <Button variant="ghost" onClick={() => void browse()} disabled={busy}>
              Обзор
            </Button>
            <Button onClick={() => void applyDir()} disabled={!controlDir.trim() || busy}>
              {busy ? "Сохраняю…" : "Продолжить"}
            </Button>
          </>
        ) : undefined
      }
    >
      {step === "dir" ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <FieldLabel>Папка данных</FieldLabel>
            <Input
              value={controlDir}
              onChange={(e) => setControlDir(e.target.value)}
              className="font-mono text-[12px]"
              aria-label="Папка Control"
              spellCheck={false}
            />
            <p className="text-[11.5px] leading-relaxed text-muted-foreground">
              Например, <span className="font-mono">C:\Control</span>. Все подпапки создаются
              автоматически.
            </p>
          </div>

          <div className="flex flex-col">
            {checks === null ? (
              <>
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </>
            ) : (
              <>
                <EnvRow label="Права администратора" ok={checks.admin} />
                <EnvRow label="Интернет" ok={checks.internet} />
                <EnvRow label="DNS" ok={checks.dns} />
                <EnvRow label="WinDivert" ok={checks.winDivertInstalled} />
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => void downloadFlow()} disabled={installing} className="gap-1.5">
              <Icon name="download-minimalistic-bold" size={14} />
              {installing ? "Установка…" : "Скачать и установить"}
            </Button>
            <Button variant="ghost" onClick={() => setStep("dir")} disabled={installing}>
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
            Позже — установлю вручную
          </button>
        </div>
      )}
    </Modal>
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
