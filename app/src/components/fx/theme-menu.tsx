import { useEffect, useRef, useState } from "react";
import { cn } from "cn";
import { Icon, type IconName } from "@/shared/ui/Icon";
import { useDesign, type ThemeMode } from "@/shared/theme";

const THEMES: { value: ThemeMode; label: string; icon: IconName }[] = [
  { value: "light", label: "Светлая", icon: "sun-bold" },
  { value: "dark", label: "Тёмная", icon: "moon-stars-bold" },
  { value: "system", label: "Системная", icon: "monitor-bold" },
];

export function ThemeMenu() {
  const { theme, setTheme, resolvedTheme } = useDesign();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onDown = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="grid size-8 place-items-center rounded-[7px] text-muted-foreground transition-colors hover:bg-[var(--sidebar-accent)] hover:text-foreground"
        title="Тема"
      >
        <Icon name={resolvedTheme === "dark" ? "moon-stars-bold" : "sun-bold"} size={15} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute bottom-[calc(100%+6px)] left-0 z-50 w-[168px] rounded-[8px] border border-[var(--border)] bg-[var(--popover)] p-1"
        >
          {THEMES.map((item) => {
            const active = theme === item.value;
            return (
              <button
                key={item.value}
                role="menuitemradio"
                aria-checked={active}
                onClick={() => {
                  setTheme(item.value);
                  setOpen(false);
                }}
                className={cn(
                  "flex h-8 w-full items-center gap-2 rounded-[5px] px-2.5 text-[13px] transition-colors",
                  active
                    ? "text-foreground"
                    : "text-muted-foreground hover:bg-[var(--fill)] hover:text-foreground",
                )}
              >
                <Icon name={item.icon} size={13} />
                {item.label}
                {active && <Icon name="check-bold" size={12} className="ml-auto" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
