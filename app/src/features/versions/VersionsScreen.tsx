import { errorText } from "@/shared/error";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api, type InstalledVersion, type ReleaseInfo } from "@/shared/api";
import { useOperations } from "@/shared/operations";
import { EmptyState, Page, PageHeader, SectionCard } from "@/shared/ui/screen";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Icon } from "@/shared/ui/Icon";
import { cn } from "cn";

function releaseNotes(release: ReleaseInfo): string {
  const raw = release.notes?.trim();
  if (!raw) return "Релиз Flowseal";

  const lines = raw
    .replace(/```[\s\S]*?```/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`>|]/g, "")
    .split("\n")
    .map((line) => line.replace(/^#{1,6}\s*/, "").replace(/^\s*[-+]\s+/, "").trim())
    .filter((line) => line.length > 0 && !/^full changelog$/i.test(line) && !/^what'?s changed$/i.test(line));

  const text = lines.slice(0, 2).join(" · ");
  if (!text) return "Релиз Flowseal";
  return text.length > 120 ? `${text.slice(0, 120).trimEnd()}…` : text;
}

export function VersionsScreen() {
  const [installed, setInstalled] = useState<InstalledVersion[] | null>(null);
  const [available, setAvailable] = useState<ReleaseInfo[] | null>(null);
  const [availableLoading, setAvailableLoading] = useState(false);
  const [pendingOpId, setPendingOpId] = useState<string | null>(null);
  const [pendingVersion, setPendingVersion] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<InstalledVersion | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);
  const [freshFolder, setFreshFolder] = useState<string | null>(null);
  const operations = useOperations();
  const pendingOp = operations.find((op) => op.id === pendingOpId);
  const installQueueRef = useRef<string | null>(null);

  const reload = async (focus?: string) => {
    try {
      const list = await api.versionsList();
      setInstalled(list);
      if (focus) setFreshFolder(focus);
    } catch (e) {
      toast.error("Не удалось получить список версий", { description: errorText(e) });
      setInstalled([]);
    }
  };

  const loadAvailable = async () => {
    setAvailableLoading(true);
    try {
      setAvailable(await api.versionsAvailable());
    } catch (e) {
      setAvailable([]);
      toast.error("GitHub недоступен", { description: errorText(e) });
    } finally {
      setAvailableLoading(false);
    }
  };

  useEffect(() => {
    void reload();
    void loadAvailable();
  }, []);

  useEffect(() => {
    if (!pendingOp) return;
    if (pendingOp.status === "succeeded" && pendingOp.kind === "download" && installQueueRef.current) {
      const archive = installQueueRef.current;
      installQueueRef.current = null;
      setPendingOpId(null);
      void (async () => {
        try {
          const version = pendingOp.message.match(/(\d+\.\d+\.\d+)/)?.[1];
          if (!archive || !version) return;
          const t = toast.loading("Устанавливаю версию…", { description: `zapret ${version}` });
          const result = await api.versionsInstall(version, archive);
          setPendingVersion(null);
          await reload(result.folder);
          toast.success("Версия установлена", { id: t, description: `zapret ${version}` });
        } catch (e) {
          setPendingVersion(null);
          toast.error("Установка не удалась", { description: errorText(e) });
        }
      })();
    }
    if (pendingOp.status === "failed" && pendingOp.kind === "download") {
      installQueueRef.current = null;
      setPendingOpId(null);
      setPendingVersion(null);
      toast.error("Скачивание не удалось", {
        description: pendingOp.error?.userMessage ?? pendingOp.message,
      });
    }
  }, [pendingOp?.status, pendingOp?.id]);

  const switchTo = async (version: InstalledVersion) => {
    if (version.selected || switching !== null) return;
    setSwitching(version.folder);
    const t = toast.loading(`Переключаюсь на zapret ${version.version}…`);
    try {
      const live = await api.versionsSelect(version.folder);
      await reload(version.folder);
      toast.success("Версия переключена", {
        id: t,
        description: live
          ? "winws перезапущен — защита уже работает на этой версии"
          : "Защита выключена. Версия применится при запуске",
      });
    } catch (e) {
      toast.error("Не удалось переключить версию", { id: t, description: errorText(e) });
    } finally {
      setSwitching(null);
    }
  };

  const openFolder = async (version: InstalledVersion) => {
    try {
      await api.versionsOpenFolder(version.folder);
    } catch (e) {
      toast.error("Не удалось открыть папку", { description: errorText(e) });
    }
  };

  const download = async (release: ReleaseInfo) => {
    if (!release.assetUrl || !release.assetName) {
      toast.warning("У релиза нет доступного файла");
      return;
    }
    setPendingVersion(release.version);
    try {
      const res = await api.versionsDownload(release.version, release.assetUrl, release.assetName);
      installQueueRef.current = res.archivePath;
      setPendingOpId(res.operationId);
    } catch (e) {
      setPendingVersion(null);
      toast.error("Скачивание не удалось", { description: errorText(e) });
    }
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    const version = toDelete;
    setToDelete(null);
    setRemoving(version.folder);
    await new Promise((resolve) => window.setTimeout(resolve, 170));
    const t = toast.loading(`Удаляю zapret ${version.version}…`);
    try {
      await api.versionsDelete(version.folder);
      await reload();
      toast.success("Версия удалена", { id: t });
    } catch (e) {
      toast.error("Не удалось удалить", { id: t, description: errorText(e) });
    } finally {
      setRemoving(null);
    }
  };

  const downloading = pendingOp?.kind === "download" && pendingOp.status === "running";
  const pct =
    pendingOp?.progress?.total != null && pendingOp.progress.current != null
      ? Math.min(100, (pendingOp.progress.current * 100) / pendingOp.progress.total)
      : undefined;

  return (
    <Page>
      <PageHeader
        title="Версии"
        subtitle="Нажмите на строку, чтобы переключиться."
      />

      {downloading && pendingOp && (
        <section className="material enter-soft rounded-[10px] px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2">
              <Icon
                name="download-minimalistic-bold"
                size={15}
                className="shrink-0 text-[color:var(--accent-foreground)]"
              />
              <span className="min-w-0 truncate text-[13px] font-medium">
                {pendingOp.progress?.message ?? pendingOp.message}
              </span>
            </span>
            {pendingOp.cancelable && (
              <Button
                variant="ghost"
                size="xs"
                className="shrink-0 text-destructive"
                onClick={() => void api.operationsCancel(pendingOp.id)}
              >
                Отменить
              </Button>
            )}
          </div>
          <Progress value={pct ?? 0} className="mt-2.5" />
          {pendingOp.progress?.total != null && pendingOp.progress.current != null && (
            <p className="mt-1.5 font-mono text-[12px] text-muted-foreground">
              {Math.round(pendingOp.progress.current / 1_048_576)} /{" "}
              {Math.round(pendingOp.progress.total / 1_048_576)} МБ
            </p>
          )}
        </section>
      )}

      <SectionCard
        title="Установленные"
        action={
          installed ? (
            <span className="numeric text-[11px] text-muted-foreground">{installed.length}</span>
          ) : undefined
        }
      >
        {installed === null && (
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-full" />
          </div>
        )}

        {installed?.length === 0 && (
          <EmptyState icon="box-minimalistic-bold" title="Ни одна версия не установлена" />
        )}

        {installed?.map((version) => {
          const isSwitching = switching === version.folder;
          const isRemoving = removing === version.folder;
          const fresh = freshFolder === version.folder;
          return (
            <div
              key={version.folder}
              data-selected={version.selected ? "true" : undefined}
              data-removing={isRemoving ? "true" : undefined}
              className={cn("row group enter-rise items-center gap-2.5", fresh && "row-fresh")}
            >
              <button
                type="button"
                onClick={() => void switchTo(version)}
                disabled={switching !== null || isRemoving}
                aria-label={`Переключиться на zapret ${version.version}`}
                aria-current={version.selected ? "true" : undefined}
                className="flex min-w-0 flex-1 items-center gap-2.5 text-left disabled:cursor-default"
              >
                <span
                  className={cn(
                    "grid size-9 shrink-0 place-items-center rounded-[8px] transition-colors",
                    version.selected
                      ? "bg-[var(--accent)] text-[var(--accent-foreground)]"
                      : "bg-[var(--fill)] text-muted-foreground",
                    isSwitching && "animate-pulse-soft",
                  )}
                >
                  <Icon name="box-minimalistic-bold" size={16} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate font-mono text-[13px] font-medium">
                      v{version.version}
                    </span>
                    {version.selected && (
                      <span key="active" className="enter-soft text-[11px] font-medium uppercase tracking-[0.04em] text-success">
                        активная
                      </span>
                    )}
                    {!version.hasWinws && (
                      <span className="text-[11px] text-warning">нет winws.exe</span>
                    )}
                  </span>
                  <span className="text-caption mt-1 block truncate text-muted-foreground">
                    {isSwitching ? "Переключаюсь…" : version.folder}
                  </span>
                </span>
              </button>

              <span className="flex shrink-0 items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="text-muted-foreground hover:text-foreground"
                  aria-label={`Открыть папку v${version.version}`}
                  title="Открыть папку версии"
                  onClick={() => void openFolder(version)}
                >
                  <Icon name="folder-open-bold" size={16} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="text-muted-foreground hover:text-destructive"
                  aria-label={`Удалить v${version.version}`}
                  onClick={() => setToDelete(version)}
                >
                  <Icon name="trash-bin-trash-bold" size={16} />
                </Button>
              </span>
            </div>
          );
        })}
      </SectionCard>

      <SectionCard
        title="Доступно на GitHub"
        action={
          <Button
            variant="ghost"
            size="xs"
            className="gap-1.5"
            disabled={availableLoading}
            onClick={() => void loadAvailable()}
          >
            <Icon
              name="refresh-bold"
              size={12}
              className={availableLoading ? "animate-spin-slow" : ""}
            />
            {availableLoading ? "Обновляю…" : "Обновить"}
          </Button>
        }
      >
        {(available === null || availableLoading) && (
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-full" />
          </div>
        )}

        {!availableLoading && available?.length === 0 && (
          <EmptyState icon="download-minimalistic-bold" title="Релизов не найдено" />
        )}

        {!availableLoading &&
          available?.map((release) => {
            const isPending = pendingVersion === release.version;
            return (
              <div
                key={release.version}
                className="row enter-rise items-center gap-2.5"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-[8px] bg-[var(--fill)] text-muted-foreground">
                  <Icon name="download-minimalistic-bold" size={16} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-[13px] font-medium">
                    v{release.version}
                  </span>
                  <span className="text-caption mt-1 block truncate text-muted-foreground">
                    {releaseNotes(release)}
                  </span>
                </span>
                <Button
                  size="sm"
                  className="shrink-0 gap-1.5"
                  disabled={isPending || downloading}
                  onClick={() => void download(release)}
                >
                  {isPending ? (
                    <span className="size-3.5 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />
                  ) : (
                    <Icon name="download-minimalistic-bold" size={13} />
                  )}
                  {isPending ? "Скачиваю…" : "Скачать"}
                </Button>
              </div>
            );
          })}
      </SectionCard>

      <Modal
        open={toDelete !== null}
        onOpenChange={(open) => !open && setToDelete(null)}
        size="sm"
        title={`Удалить zapret ${toDelete?.version ?? ""}?`}
        description="Папка версии будет удалена с диска. Это действие нельзя отменить."
        footer={
          <>
            <Button variant="ghost" onClick={() => setToDelete(null)}>
              Отмена
            </Button>
            <Button variant="destructive" onClick={() => void confirmDelete()}>
              Удалить
            </Button>
          </>
        }
      />
    </Page>
  );
}
