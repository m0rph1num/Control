import { useSyncExternalStore } from "react";
import { toast } from "sonner";
import { api, type ReleaseInfo } from "@/shared/api";
import { errorCode, errorText } from "@/shared/error";
import { currentOperations, refreshOperations } from "@/shared/operations";

export type VersionJobPhase = "downloading" | "installing";

export interface VersionJob {
  version: string;
  phase: VersionJobPhase;
}

export interface VersionJobsState {
  job: VersionJob | null;
  completed: number;
  folder: string | null;
}

let state: VersionJobsState = { job: null, completed: 0, folder: null };
const listeners = new Set<() => void>();

function publish(next: VersionJobsState) {
  state = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return state;
}

export function useVersionJobs() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

function activeDownload() {
  return currentOperations().find(
    (operation) =>
      operation.kind === "download" &&
      (operation.status === "running" || operation.status === "queued"),
  );
}

export async function cancelVersionDownload() {
  await refreshOperations();
  const operation = activeDownload();
  if (!operation) return false;
  return api.operationsCancel(operation.id);
}

export async function installRelease(release: ReleaseInfo) {
  if (!release.assetUrl || !release.assetName) {
    toast.warning("У релиза нет архива .zip или .tar.gz");
    return;
  }
  if (state.job) {
    toast.info("Дождитесь завершения текущей установки");
    return;
  }

  const version = release.version;
  let phase: VersionJobPhase = "downloading";
  publish({ ...state, job: { version, phase } });
  const notice = toast.loading("Скачиваю zapret…", { description: `zapret ${version}` });

  try {
    const download = await api.versionsDownload(
      version,
      release.assetUrl,
      release.assetName,
    );
    phase = "installing";
    publish({ ...state, job: { version, phase } });
    toast.loading("Устанавливаю версию…", { id: notice, description: `zapret ${version}` });
    const installed = await api.versionsInstall(version, download.archivePath);
    publish({ ...state, job: null, completed: state.completed + 1, folder: installed.folder });
    toast.success("Версия установлена", { id: notice, description: `zapret ${version}` });
  } catch (error) {
    publish({ ...state, job: null });
    if (errorCode(error) === "CANCELLED") {
      toast.info("Скачивание отменено", { id: notice });
    } else if (phase === "downloading") {
      toast.error("Скачивание не удалось", { id: notice, description: errorText(error) });
    } else {
      toast.error("Установка не удалась", { id: notice, description: errorText(error) });
    }
  }
}
