import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cn } from "cn";
import { Icon, type IconName } from "@/shared/ui/Icon";

export interface PaletteItem {
  id: string;
  group: string;
  label: string;
  hint: string;
  icon: IconName;
  keywords?: string[];
  run: () => void;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/ё/g, "е");
}

function fuzzy(text: string, needle: string): boolean {
  let position = 0;
  for (const char of needle) {
    position = text.indexOf(char, position);
    if (position === -1) return false;
    position += 1;
  }
  return true;
}

function score(item: PaletteItem, tokens: string[]): number {
  if (tokens.length === 0) return 1;
  const label = normalize(item.label);
  const hint = normalize(item.hint);
  const keywords = (item.keywords ?? []).map(normalize);
  let total = 0;
  for (const token of tokens) {
    if (label === token) total += 120;
    else if (label.startsWith(token)) total += 90;
    else if (label.includes(token)) total += 70;
    else if (keywords.some((keyword) => keyword.startsWith(token))) total += 55;
    else if (token.length >= 4 && keywords.some((keyword) => keyword.includes(token))) total += 45;
    else if (hint.includes(token)) total += 25;
    else if (token.length >= 3 && fuzzy(label, token)) total += 15;
    else return 0;
  }
  return total;
}

function highlightRanges(text: string, tokens: string[]): [number, number][] {
  const lower = normalize(text);
  const ranges: [number, number][] = [];
  for (const token of tokens) {
    let from = 0;
    while (from < lower.length) {
      const start = lower.indexOf(token, from);
      if (start === -1) break;
      ranges.push([start, start + token.length]);
      from = start + token.length;
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([...range]);
  }
  return merged;
}

function Highlight({ text, tokens }: { text: string; tokens: string[] }) {
  const ranges = useMemo(() => highlightRanges(text, tokens), [text, tokens]);
  if (ranges.length === 0) return <>{text}</>;
  const parts: ReactNode[] = [];
  let cursor = 0;
  ranges.forEach(([start, end], index) => {
    if (start > cursor) parts.push(text.slice(cursor, start));
    parts.push(
      <mark key={index} className="rounded-[3px] bg-[var(--accent)] px-0.5 text-[var(--accent-foreground)]">
        {text.slice(start, end)}
      </mark>,
    );
    cursor = end;
  });
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
}

export function CommandPalette({
  open,
  onOpenChange,
  items,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: PaletteItem[];
}) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const tokens = useMemo(
    () =>
      normalize(query)
        .split(/\s+/)
        .filter((token) => token.length > 0),
    [query],
  );

  const filtered = useMemo(() => {
    const scored = items
      .map((item, order) => ({ item, order, score: score(item, tokens) }))
      .filter((entry) => entry.score > 0);

    if (tokens.length === 0) return scored.map((entry) => entry.item);

    const groups = new Map<string, { best: number; entries: typeof scored }>();
    for (const entry of scored) {
      const group = groups.get(entry.item.group);
      if (group) {
        group.entries.push(entry);
        group.best = Math.max(group.best, entry.score);
      } else {
        groups.set(entry.item.group, { best: entry.score, entries: [entry] });
      }
    }

    return [...groups.values()]
      .sort((a, b) => b.best - a.best)
      .flatMap((group) =>
        group.entries
          .sort((a, b) => b.score - a.score || a.order - b.order)
          .map((entry) => entry.item),
      );
  }, [items, tokens]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setIndex(0);
    const timer = window.setTimeout(() => inputRef.current?.focus(), 20);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    setIndex(0);
  }, [query]);

  useEffect(() => {
    setIndex((value) =>
      filtered.length === 0 ? 0 : Math.min(value, filtered.length - 1),
    );
  }, [filtered.length]);

  useEffect(() => {
    if (!open) return;
    const active = listRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    active?.scrollIntoView({ block: "nearest" });
  }, [index, open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onOpenChange(false);
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setIndex((value) => (filtered.length === 0 ? 0 : (value + 1) % filtered.length));
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setIndex((value) =>
          filtered.length === 0 ? 0 : (value - 1 + filtered.length) % filtered.length,
        );
      }
      if (event.key === "Enter") {
        const target = filtered[index];
        if (target) {
          event.preventDefault();
          target.run();
          onOpenChange(false);
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, filtered, index, onOpenChange]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center px-6 pt-[12vh]">
      <button
        type="button"
        aria-label="Закрыть поиск"
        onClick={() => onOpenChange(false)}
        className="absolute inset-0 cursor-default bg-black/30 dark:bg-black/55"
      />

      <div
        role="dialog"
        aria-label="Поиск по приложению"
        className="relative w-full max-w-[560px] overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--popover)]"
      >
        <div className="flex items-center gap-2.5 px-3.5 py-3">
          <Icon
            name="rounded-magnifer-bold"
            size={15}
            className="shrink-0 text-[color:var(--accent-foreground)]"
          />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Разделы, настройки, действия…"
            className="h-5 w-full min-w-0 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
            aria-label="Поиск по приложению"
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                inputRef.current?.focus();
              }}
              aria-label="Очистить поиск"
              className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
            >
              <Icon name="close-circle-bold" size={13} />
            </button>
          )}
          <kbd className="shrink-0 rounded border border-[var(--border)] px-1.5 py-0.5 text-[11px] text-muted-foreground">
            Esc
          </kbd>
        </div>

        <div className="h-px bg-[var(--border)]" />

        <div ref={listRef} className="max-h-[360px] overflow-y-auto p-1.5" role="listbox">
          {filtered.length === 0 && (
            <div className="px-3 py-9 text-center">
              <p className="text-[13px] font-medium text-foreground">Ничего не найдено</p>
              <p className="text-caption mt-1 text-muted-foreground">
                Попробуйте «защита», «профиль», «тема» или «автозапуск».
              </p>
            </div>
          )}

          {filtered.map((item, itemIndex) => {
            const active = itemIndex === index;
            const previous = filtered[itemIndex - 1];
            const showGroup = !previous || previous.group !== item.group;
            return (
              <div key={item.id}>
                {showGroup && (
                  <p className="px-2.5 pb-1.5 pt-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                    {item.group}
                  </p>
                )}
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  data-active={active ? "true" : undefined}
                  data-sound="off"
                  onPointerEnter={() => setIndex(itemIndex)}
                  onClick={() => {
                    item.run();
                    onOpenChange(false);
                  }}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-[7px] px-2.5 py-2 text-left transition-colors",
                    active ? "bg-[var(--fill)]" : "hover:bg-[var(--fill)]",
                  )}
                >
                  <span
                    className={cn(
                      "grid size-7 shrink-0 place-items-center rounded-[6px] border transition-colors",
                      active
                        ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-foreground)]"
                        : "border-[var(--surface-stroke)] bg-[var(--surface-muted)] text-muted-foreground",
                    )}
                  >
                    <Icon name={item.icon} size={14} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">
                      <Highlight text={item.label} tokens={tokens} />
                    </span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {item.hint}
                    </span>
                  </span>
                  {active && (
                    <Icon
                      name="arrow-left-down-bold"
                      size={12}
                      className="shrink-0 text-[color:var(--accent-foreground)]"
                    />
                  )}
                </button>
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-[var(--border)] px-3 py-2 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <kbd className="grid h-4 min-w-4 place-items-center rounded-[4px] border border-[var(--border)] px-1 leading-none">
              ↑
            </kbd>
            <kbd className="grid h-4 min-w-4 place-items-center rounded-[4px] border border-[var(--border)] px-1 leading-none">
              ↓
            </kbd>
            <span className="ml-0.5">навигация</span>
          </span>
          <span className="flex items-center gap-1.5">
            <kbd className="grid h-4 min-w-4 place-items-center rounded-[4px] border border-[var(--border)] px-1 leading-none">
              ↵
            </kbd>
            <span className="ml-0.5">выполнить</span>
          </span>
        </div>
      </div>
    </div>
  );
}
