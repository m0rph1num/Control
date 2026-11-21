import { useEffect, useSyncExternalStore } from "react";
import { api, onEvent, type OperationSnapshot } from "@/shared/api";

const TERMINAL = new Set(["succeeded", "failed", "cancelled"]);
const RETENTION_MS = 20_000;
const POLL_MS = 4_000;

let operations: OperationSnapshot[] = [];
let started: Promise<void> | null = null;
let pollTimer: number | null = null;
const listeners = new Set<() => void>();
const retained = new Map<string, number>();

function publish() {
  for (const listener of listeners) listener();
}

function isTerminal(status: string) {
  return TERMINAL.has(status);
}

function resort(items: OperationSnapshot[]) {
  return items
    .slice()
    .sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""));
}

function upsert(snapshot: OperationSnapshot) {
  const index = operations.findIndex((item) => item.id === snapshot.id);
  if (index === -1) {
    operations = resort([snapshot, ...operations]);
  } else {
    const current = operations[index]!;
    if (snapshot.revision < current.revision) return;
    const next = operations.slice();
    next[index] = snapshot;
    operations = next;
  }
  publish();
  schedulePoll();

  if (!isTerminal(snapshot.status)) {
    const timer = retained.get(snapshot.id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      retained.delete(snapshot.id);
    }
    return;
  }
  if (retained.has(snapshot.id)) return;
  const timer = window.setTimeout(() => {
    retained.delete(snapshot.id);
    operations = operations.filter((item) => item.id !== snapshot.id);
    publish();
  }, RETENTION_MS);
  retained.set(snapshot.id, timer);
}

function merge(list: OperationSnapshot[]) {
  const byId = new Map(operations.map((item) => [item.id, item]));
  for (const snapshot of list) {
    const current = byId.get(snapshot.id);
    if (!current || snapshot.revision >= current.revision) {
      byId.set(snapshot.id, snapshot);
    }
  }
  operations = resort([...byId.values()]);
  publish();
}

async function refresh() {
  try {
    merge(await api.operationsList());
  } catch {
    return;
  }
  schedulePoll();
}

function schedulePoll() {
  const active = operations.some((item) => !isTerminal(item.status));
  if (active && pollTimer === null) {
    pollTimer = window.setInterval(() => {
      if (!operations.some((item) => !isTerminal(item.status))) {
        if (pollTimer !== null) window.clearInterval(pollTimer);
        pollTimer = null;
        return;
      }
      void refresh();
    }, POLL_MS);
  }
  if (!active && pollTimer !== null) {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }
}

function ensureStarted() {
  if (started) return started;
  started = (async () => {
    try {
      await onEvent<OperationSnapshot>("operation://state", upsert);
    } catch {
      started = null;
      return;
    }
    await refresh();
  })();
  return started;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return operations;
}

export function useOperations() {
  const items = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  useEffect(() => {
    void ensureStarted();
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);
  return items;
}

export async function refreshOperations() {
  await ensureStarted();
  await refresh();
}

export function currentOperations() {
  return operations;
}
