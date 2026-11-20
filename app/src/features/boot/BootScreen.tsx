import { cn } from "cn";
import type { BootPhase } from "./useBoot";

export function BootScreen({
  phase,
  progress,
  label,
}: {
  phase: BootPhase;
  progress: number;
  label: string;
}) {
  return (
    <div
      className={cn(
        "absolute inset-0 z-[60] overflow-hidden bg-[var(--background)]",
        phase === "leaving" ? "boot-leave" : "boot-enter",
      )}
    >
      <div className="boot-field" aria-hidden>
        <span className="boot-haze" />
        <span className="boot-grid" />
      </div>

      <div className="relative grid h-full place-items-center">
        <div className="boot-stack">
          <div className="boot-scene" aria-hidden>
            <span className="boot-floor" />
            <span className="boot-orbit boot-orbit-1">
              <i />
            </span>
            <span className="boot-orbit boot-orbit-2">
              <i />
            </span>

            <div className="boot-monolith">
              <span className="boot-monolith-face">
                <span className="boot-monolith-sheen" />
                <span className="boot-monolith-seam" />
              </span>
              <span className="boot-monolith-edge" />
              <span className="boot-monolith-reflection" />
            </div>

            <span className="boot-orbit boot-orbit-3">
              <i />
            </span>
          </div>

          <p className="boot-wordmark boot-copy">Control</p>
          <p className="boot-studio boot-copy">Monolith Studios</p>

          <div className="boot-progress">
            <span
              className="boot-progress-fill"
              style={{ width: `${Math.max(6, progress)}%` }}
            >
              <i className="boot-progress-glint" />
            </span>
          </div>
          <p key={label} className="boot-label">
            {label}
          </p>
        </div>
      </div>
    </div>
  );
}
