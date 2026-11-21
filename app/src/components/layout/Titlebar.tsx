import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { cn } from "cn";
import { isDemo } from "@/shared/api";
import { BrandMark } from "@/shared/ui/BrandMark";
import { Icon } from "@/shared/ui/Icon";

type ControlKind = "minimize" | "maximize" | "restore" | "close";

function ControlGlyph({ kind }: { kind: ControlKind }) {
  if (kind === "minimize") {
    return (
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
        <path d="M1 5h8" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === "close") {
    return (
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
        <path
          d="M1.2 1.2 8.8 8.8M8.8 1.2 1.2 8.8"
          stroke="currentColor"
          strokeWidth="1.1"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  if (kind === "restore") {
    return (
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
        <rect x="0.9" y="2.9" width="6.2" height="6.2" rx="0.7" stroke="currentColor" strokeWidth="1" />
        <path
          d="M3.2 2.9V1.5c0-.33.27-.6.6-.6h4.3c.33 0 .6.27.6.6v4.3c0 .33-.27.6-.6.6H6.9"
          stroke="currentColor"
          strokeWidth="1"
        />
      </svg>
    );
  }
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
      <rect x="0.9" y="0.9" width="8.2" height="8.2" rx="0.9" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

export function Titlebar({
  collapsed,
  onToggleCollapsed,
  section,
}: {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  section: string;
}) {
  const native = !isDemo();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!native) return;
    const win = getCurrentWindow();
    let disposed = false;
    let unlisten: (() => void) | undefined;

    const sync = () => {
      void win
        .isMaximized()
        .then((value) => {
          if (!disposed) setMaximized(value);
        })
        .catch(() => undefined);
    };

    sync();
    void win
      .onResized(sync)
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [native]);

  const run = (action: (win: ReturnType<typeof getCurrentWindow>) => Promise<unknown>) => {
    if (!native) return;
    void action(getCurrentWindow()).catch(() => undefined);
  };

  return (
    <header
      data-tauri-drag-region="deep"
      className="flex h-11 shrink-0 select-none border-b border-[var(--sidebar-border)] bg-[var(--background)]"
    >
      <div
        className={cn(
          "flex items-center gap-2 border-r border-[var(--sidebar-border)] bg-[var(--sidebar)] transition-[width] duration-150 ease-out",
          collapsed ? "justify-center px-0" : "pl-4 pr-2.5",
        )}
        style={{ width: collapsed ? 64 : 240 }}
      >
        {collapsed ? (
          <button
            type="button"
            onClick={onToggleCollapsed}
            className="grid size-9 place-items-center rounded-[8px] transition-colors hover:bg-[var(--sidebar-accent)]"
            title="Развернуть панель"
            aria-label="Развернуть панель"
          >
            <BrandMark className="size-6 text-[var(--ring)]" />
          </button>
        ) : (
          <>
            <BrandMark className="size-6 shrink-0 text-[var(--ring)]" />
            <span className="truncate text-[13.5px] font-semibold tracking-[-0.012em]">Control</span>
            <button
              type="button"
              onClick={onToggleCollapsed}
              className="ml-auto grid size-7 place-items-center rounded-[6px] text-muted-foreground transition-colors hover:bg-[var(--sidebar-accent)] hover:text-foreground"
              title="Свернуть панель"
              aria-label="Свернуть панель"
            >
              <Icon name="alt-arrow-left-bold" size={14} />
            </button>
          </>
        )}
      </div>

      <div className="flex min-w-0 flex-1 items-center gap-2.5 px-5">
        <span className="truncate text-[11.5px] font-medium text-muted-foreground">{section}</span>
        <span className="hidden h-3 w-px shrink-0 bg-[var(--border)] xl:block" />
        <span className="hidden shrink-0 text-[11px] text-muted-foreground/70 xl:inline">
          Обход DPI для Windows
        </span>
      </div>

      {native && (
        <div className="flex shrink-0 items-stretch">
          <button
            type="button"
            onClick={() => run((win) => win.minimize())}
            className="grid w-12 place-items-center text-muted-foreground transition-colors hover:bg-[var(--fill)] hover:text-foreground"
            title="Свернуть"
            aria-label="Свернуть окно"
          >
            <ControlGlyph kind="minimize" />
          </button>
          <button
            type="button"
            onClick={() => run((win) => win.toggleMaximize())}
            className="grid w-12 place-items-center text-muted-foreground transition-colors hover:bg-[var(--fill)] hover:text-foreground"
            title={maximized ? "Восстановить" : "Развернуть"}
            aria-label={maximized ? "Восстановить окно" : "Развернуть окно"}
          >
            <ControlGlyph kind={maximized ? "restore" : "maximize"} />
          </button>
          <button
            type="button"
            onClick={() => run((win) => win.close())}
            className="grid w-12 place-items-center text-muted-foreground transition-colors hover:bg-[#d92b1f] hover:text-white"
            title="Закрыть"
            aria-label="Закрыть окно"
          >
            <ControlGlyph kind="close" />
          </button>
        </div>
      )}
    </header>
  );
}
