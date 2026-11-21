import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  onAdvisorStep,
  type AdvisorReport,
} from "@/shared/api";
import { errorText } from "@/shared/error";

export type AdvisorPhase = "idle" | "scanning" | "ready" | "error";
export type AdvisorStepState = "idle" | "running" | "ok";

export interface AdvisorScan {
  phase: AdvisorPhase;
  report: AdvisorReport | null;
  steps: Record<string, AdvisorStepState>;
  error: string | null;
  scan: () => Promise<void>;
}

export function useAdvisorScan(options: { loadSaved?: boolean } = {}): AdvisorScan {
  const loadSaved = options.loadSaved ?? true;
  const [phase, setPhase] = useState<AdvisorPhase>("idle");
  const [report, setReport] = useState<AdvisorReport | null>(null);
  const [steps, setSteps] = useState<Record<string, AdvisorStepState>>({});
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  const scanning = useRef(false);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    if (!loadSaved) return;
    void api
      .advisorSaved()
      .then((saved) => {
        if (!alive.current || !saved) return;
        setReport(saved);
        setPhase((current) => (current === "idle" ? "ready" : current));
      })
      .catch(() => undefined);
  }, [loadSaved]);

  const scan = useCallback(async () => {
    if (scanning.current) return;
    scanning.current = true;
    setPhase("scanning");
    setSteps({});
    setError(null);
    let unlisten: (() => void) | undefined;
    try {
      unlisten = await onAdvisorStep((step) => {
        setSteps((current) => ({
          ...current,
          [step.id]: step.status === "ok" ? "ok" : "running",
        }));
      });
      const result = await api.advisorScan();
      if (!alive.current) return;
      setReport(result);
      setPhase("ready");
    } catch (e) {
      if (!alive.current) return;
      setError(errorText(e));
      setPhase("error");
    } finally {
      unlisten?.();
      scanning.current = false;
    }
  }, []);

  return { phase, report, steps, error, scan };
}
