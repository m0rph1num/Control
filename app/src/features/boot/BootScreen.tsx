import { cn } from "cn";
import { MARK_OUTLINE, MARK_SOLID } from "@/shared/ui/BrandMark";
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

      <div className="relative grid h-full place-items-center px-6">
        <div className="boot-stack">
          <div className="boot-mark" aria-hidden>
            <span className="boot-mark-glow" />
            <span className="boot-mark-ring" />
            <svg viewBox="0 0 256 256" className="boot-mark-svg">
              <path className="boot-mark-outline" d={MARK_OUTLINE} pathLength={100} />
              <path className="boot-mark-fill" d={MARK_SOLID} fillRule="evenodd" />
            </svg>
          </div>

          <p className="boot-name">Control</p>
          <p className="boot-studio">Monolith Studios</p>

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
