import { useEffect, useState } from "react";
import { api, onEvent, type OperationSnapshot } from "@/shared/api";

export function useOperations() {
  const [operations, setOperations] = useState<OperationSnapshot[]>([]);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const list = await api.operationsList();
        if (alive) setOperations(list);
      } catch {
        return;
      }
    };
    void tick();

    const timer = setInterval(tick, 10_000);
    const unsub = onEvent<OperationSnapshot>("operation://state", (snap) => {
      if (!alive) return;
      setOperations((cur) => {
        const idx = cur.findIndex((o) => o.id === snap.id);
        if (idx === -1) return [...cur, snap];
        const next = [...cur];
        next[idx] = snap;
        return next;
      });
    });
    return () => {
      alive = false;
      clearInterval(timer);
      unsub.then((fn) => fn());
    };
  }, []);
  return operations;
}
