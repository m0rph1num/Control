import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  api,
  isDemo,
  onUpdateProgress,
  type UpdateInfo,
  type UpdateProgress,
} from "@/shared/api";
import { errorText } from "@/shared/error";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Icon } from "@/shared/ui/Icon";
import { CloseGlyph } from "@/shared/ui/CloseGlyph";

type Phase = "idle" | "available" | "downloading" | "ready" | "installing" | "error";

function formatSize(bytes: number | null): string | null {
  if (!bytes || bytes <= 0) return null;
  return `${Math.max(1, Math.round(bytes / 1_048_576))} МБ`;
}

export function UpdateBanner({ collapsed }: { collapsed: boolean }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [progress, setProgress] = useState<UpdateProgress | null>(null);
  const [installer, setInstaller] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    const timer = window.setTimeout(() => {
      void api
        .updateCheck()
        .then((result) => {
          if (!alive || !result.available) return;
          setInfo(result);
          setPhase("available");
        })
        .catch(() => undefined);
    }, 2_500);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (phase !== "downloading") return;
    let alive = true;
    let unlisten: (() => void) | undefined;
    void onUpdateProgress((next) => {
      if (alive) setProgress(next);
    }).then((fn) => {
      if (alive) unlisten = fn;
      else fn();
    });
    return () => {
      alive = false;
      unlisten?.();
    };
  }, [phase]);

  const startDownload = async () => {
    if (!info?.assetUrl) {
      setPhase("error");
      setError("В релизе нет файла установки");
      return;
    }
    setConfirmOpen(false);
    setPhase("downloading");
    setProgress(null);
    setError(null);
    const t = toast.loading("Скачиваю обновление…", { description: `Control ${info.version}` });
    try {
      const path = await api.updateDownload(info.version, info.assetUrl);
      setInstaller(path);
      setPhase("ready");
      toast.success("Обновление готово", { id: t, description: "Можно перезапустить Control" });
    } catch (e) {
      setError(errorText(e));
      setPhase("error");
      toast.error("Не удалось скачать обновление", { id: t, description: errorText(e) });
    }
  };

  const install = async () => {
    if (!installer) return;
    setPhase("installing");
    const t = toast.loading("Устанавливаю обновление…", {
      description: "Control закроется и откроется снова",
    });
    try {
      await api.updateInstall(installer);
      if (isDemo()) {
        toast.success("Обновление установлено (демо)", { id: t });
        setDismissed(true);
        setPhase("idle");
      }
    } catch (e) {
      setError(errorText(e));
      setPhase("error");
      toast.error("Не удалось установить обновление", { id: t, description: errorText(e) });
    }
  };

  const onPrimary = () => {
    if (phase === "available") setConfirmOpen(true);
    else if (phase === "ready") void install();
    else if (phase === "error") void startDownload();
  };

  const percent =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.downloaded / progress.total) * 100))
      : 0;

  const subtitle =
    phase === "available"
      ? "Доступно обновление"
      : phase === "downloading"
        ? `${percent}% · скачивается`
        : phase === "ready"
          ? "Готово к установке"
          : phase === "installing"
            ? "Устанавливаем…"
            : "Не удалось скачать";

  const primaryLabel =
    phase === "available"
      ? "Обновить"
      : phase === "downloading"
        ? "Скачивается…"
        : phase === "ready"
          ? "Перезапустить"
          : phase === "installing"
            ? "Устанавливаем…"
            : "Повторить";

  const visible = phase !== "idle" && !dismissed;

  if (!visible) return null;

  const confirmModal = (
    <Modal
      open={confirmOpen}
      onOpenChange={setConfirmOpen}
      title={info ? `Обновить Control до ${info.version}?` : "Обновить Control?"}
      description="Control закроется, установит обновление и откроется снова. Настройки, профили и списки сохранятся."
      size="sm"
      footer={
        <>
          <Button variant="outline" size="sm" onClick={() => setConfirmOpen(false)}>
            Позже
          </Button>
          <Button size="sm" className="gap-1.5" onClick={() => void startDownload()}>
            <Icon name="download-minimalistic-bold" size={14} />
            Скачать и установить
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2.5">
        <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
          <span className="numeric">v{info?.currentVersion}</span>
          <Icon name="alt-arrow-right-bold" size={12} />
          <span className="numeric font-medium text-foreground">v{info?.version}</span>
          {formatSize(info?.size ?? null) && (
            <>
              <span aria-hidden>·</span>
              <span>{formatSize(info?.size ?? null)}</span>
            </>
          )}
        </div>
        {info?.notes && (
          <div className="max-h-40 overflow-y-auto whitespace-pre-line rounded-[8px] bg-[var(--fill)] px-3 py-2.5 text-[12px] leading-relaxed text-muted-foreground">
            {info.notes}
          </div>
        )}
      </div>
    </Modal>
  );

  if (collapsed) {
    return (
      <>
        <button
          type="button"
          onClick={onPrimary}
          disabled={phase === "downloading" || phase === "installing"}
          title={info ? `Control ${info.version} · ${subtitle}` : "Обновление"}
          aria-label="Обновление Control"
          className="relative mx-auto mb-2 grid size-9 place-items-center rounded-[8px] text-[color:var(--accent-foreground)] transition-colors hover:bg-[var(--sidebar-accent)] disabled:opacity-70"
        >
          {phase === "downloading" || phase === "installing" ? (
            <span className="size-4 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />
          ) : (
            <Icon name="download-minimalistic-bold" size={16} />
          )}
          {phase === "available" && (
            <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-ring" aria-hidden />
          )}
        </button>
        {confirmModal}
      </>
    );
  }

  return (
    <>
      <div className="mx-2.5 mb-2.5 rounded-[9px] border border-[var(--surface-stroke)] bg-[var(--card)] p-3">
        <div className="flex items-start gap-2">
          <span className="grid size-6 shrink-0 place-items-center rounded-[6px] bg-[var(--accent)] text-[var(--accent-foreground)]">
            <Icon name="download-minimalistic-bold" size={13} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12px] font-medium leading-tight">
              {info ? `Control ${info.version}` : "Обновление"}
            </p>
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{subtitle}</p>
          </div>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            aria-label="Скрыть"
            className="grid size-5 shrink-0 place-items-center rounded-[4px] text-muted-foreground transition-colors hover:bg-[var(--fill)] hover:text-foreground"
          >
            <CloseGlyph size={10} />
          </button>
        </div>

        {phase === "downloading" && (
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-[var(--fill)]">
            <span
              className="block h-full rounded-full bg-ring transition-[width] duration-300"
              style={{ width: `${Math.max(4, percent)}%` }}
            />
          </div>
        )}

        <div className="mt-2.5 flex items-center gap-1.5">
          <Button
            size="xs"
            className="flex-1"
            onClick={onPrimary}
            disabled={phase === "downloading" || phase === "installing"}
          >
            {primaryLabel}
          </Button>
          {phase === "error" && (
            <span className="min-w-0 flex-1 truncate text-[10.5px] text-destructive" title={error ?? undefined}>
              {error ?? "Ошибка"}
            </span>
          )}
        </div>
      </div>
      {confirmModal}
    </>
  );
}
