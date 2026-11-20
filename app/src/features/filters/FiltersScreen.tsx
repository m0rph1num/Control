import { errorText } from "@/shared/error";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { api, type FakesInfo, type UserList } from "@/shared/api";
import { Page, PageHeader, SectionCard, Segmented } from "@/shared/ui/screen";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Icon } from "@/shared/ui/Icon";
import { plural } from "@/shared/plural";
import { cn } from "cn";

type GameFilter = "disabled" | "all" | "tcp" | "udp";
type IpsetMode = "loaded" | "any" | "none";

const IPSET_META: { value: IpsetMode; label: string; hint: string }[] = [
  { value: "loaded", label: "Реальный список", hint: "Только адреса из загруженного ipset" },
  { value: "any", label: "Без фильтра IP", hint: "Обрабатывать любые адреса" },
  { value: "none", label: "Строгий запрет", hint: "Пустой список — трафик не проходит" },
];

const GAME_META: { value: GameFilter; label: string }[] = [
  { value: "disabled", label: "Выключен" },
  { value: "all", label: "TCP+UDP" },
  { value: "tcp", label: "TCP" },
  { value: "udp", label: "UDP" },
];

function countLines(text: string): number {
  return text.split(/\r?\n/).filter((line) => line.trim().length > 0).length;
}

export function FiltersScreen() {
  const [gameFilter, setGameFilter] = useState<GameFilter | null>(null);
  const [ipset, setIpset] = useState<IpsetMode | null>(null);
  const [lists, setLists] = useState<UserList[] | null>(null);
  const [fakes, setFakes] = useState<FakesInfo | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [gameBusy, setGameBusy] = useState(false);
  const [ipsetBusy, setIpsetBusy] = useState(false);
  const [fakeBusy, setFakeBusy] = useState<"discord" | "game" | null>(null);
  const [savingList, setSavingList] = useState<string | null>(null);

  useEffect(() => {
    api.gameFilterGet().then(setGameFilter).catch(() => setGameFilter("disabled"));
    api.ipsetFilterGet().then(setIpset).catch(() => setIpset("loaded"));
    api
      .listsGet()
      .then((items) => {
        setLists(items);
        setDrafts(Object.fromEntries(items.map((item) => [item.key, item.content])));
        setActiveKey((current) => current ?? items[0]?.key ?? null);
      })
      .catch(() => setLists([]));
    api.fakesGet().then(setFakes).catch(() => undefined);
  }, []);

  const activeList = useMemo(
    () => lists?.find((item) => item.key === activeKey) ?? null,
    [lists, activeKey],
  );

  const dirtyKeys = useMemo(() => {
    if (!lists) return new Set<string>();
    return new Set(
      lists
        .filter((item) => (drafts[item.key] ?? item.content) !== item.content)
        .map((item) => item.key),
    );
  }, [lists, drafts]);

  const setGame = async (mode: GameFilter) => {
    const prev = gameFilter;
    setGameFilter(mode);
    setGameBusy(true);
    try {
      await api.gameFilterSet(mode);
    } catch (e) {
      setGameFilter(prev);
      toast.error("Не удалось применить игровой фильтр", { description: errorText(e) });
    } finally {
      setGameBusy(false);
    }
  };

  const setIpsetMode = async (mode: IpsetMode) => {
    const prev = ipset;
    setIpset(mode);
    setIpsetBusy(true);
    try {
      await api.ipsetFilterSet(mode);
      toast.success("IPSet-фильтр применён");
    } catch (e) {
      setIpset(prev);
      toast.error("Не удалось применить IPSet-фильтр", { description: errorText(e) });
    } finally {
      setIpsetBusy(false);
    }
  };

  const saveList = async () => {
    if (!activeList) return;
    const content = drafts[activeList.key] ?? activeList.content;
    setSavingList(activeList.key);
    const t = toast.loading(`Сохраняю «${activeList.label}»…`);
    try {
      await api.listsWrite(activeList.key, content);
      setLists((current) =>
        current
          ? current.map((item) =>
              item.key === activeList.key ? { ...item, content, exists: true } : item,
            )
          : current,
      );
      toast.success("Список сохранён", { id: t });
    } catch (e) {
      toast.error("Не удалось сохранить список", { id: t, description: errorText(e) });
    } finally {
      setSavingList(null);
    }
  };

  const setFake = async (type: "discord" | "game", fake: string) => {
    setFakeBusy(type);
    try {
      await api.fakesSet(type, fake);
      setFakes(await api.fakesGet());
    } catch (e) {
      toast.error("Не удалось применить fake", { description: errorText(e) });
    } finally {
      setFakeBusy(null);
    }
  };

  const activeDirty = activeList ? dirtyKeys.has(activeList.key) : false;
  const activeDraft = activeList ? drafts[activeList.key] ?? activeList.content : "";

  return (
    <Page>
      <PageHeader
        title="Фильтры"
        subtitle="Игровой фильтр, IPSet, списки и fake."
      />

      <SectionCard
        title="Игровой фильтр"
        action={
          gameBusy ? (
            <span className="size-3.5 animate-spin rounded-full border-[1.5px] border-[color:var(--ring)] border-t-transparent" />
          ) : undefined
        }
      >
        {gameFilter === null ? (
          <div className="flex gap-1">
            <Skeleton className="h-8 flex-1" />
            <Skeleton className="h-8 flex-1" />
            <Skeleton className="h-8 flex-1" />
            <Skeleton className="h-8 flex-1" />
          </div>
        ) : (
          <Segmented
            value={gameFilter}
            onChange={(mode) => void setGame(mode)}
            options={GAME_META}
            className="w-full"
          />
        )}
      </SectionCard>

      <SectionCard
        title="IPSet"
        action={
          ipsetBusy ? (
            <span className="size-3.5 animate-spin rounded-full border-[1.5px] border-[color:var(--ring)] border-t-transparent" />
          ) : undefined
        }
      >
        {ipset === null ? (
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-full" />
          </div>
        ) : (
          <div className="flex flex-col gap-1" role="radiogroup">
            {IPSET_META.map((mode) => {
              const selected = ipset === mode.value;
              return (
                <button
                  key={mode.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  data-selected={selected ? "true" : undefined}
                  onClick={() => void setIpsetMode(mode.value)}
                  className="row items-start gap-2.5 text-left"
                >
                  <span
                    className={cn(
                      "mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border transition-all",
                      selected
                        ? "border-[var(--primary)] bg-[var(--primary)]"
                        : "border-[var(--input)] bg-[var(--control-bg)]",
                    )}
                  >
                    {selected && <span className="size-1.5 rounded-full bg-[var(--primary-foreground)]" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium leading-[1.4]">{mode.label}</span>
                    <span className="text-caption mt-1 block text-muted-foreground">{mode.hint}</span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Списки"
        action={
          lists ? (
            <span className="numeric text-[11px] text-muted-foreground">
              {plural(lists.length, ["список", "списка", "списков"])}
              {dirtyKeys.size > 0 && ` · изменено ${dirtyKeys.size}`}
            </span>
          ) : undefined
        }
      >
        {lists === null ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-7 w-2/3" />
            <Skeleton className="h-[170px] w-full" />
          </div>
        ) : lists.length === 0 ? (
          <p className="text-caption text-muted-foreground">
            Списки появятся после установки версии Zapret.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5">
              {lists.map((item) => {
                const selected = item.key === activeKey;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setActiveKey(item.key)}
                    data-active={selected ? "true" : undefined}
                    className="chip"
                  >
                    {item.label}
                    {dirtyKeys.has(item.key) && (
                      <span className="size-1.5 rounded-full bg-[color:var(--ring)]" />
                    )}
                  </button>
                );
              })}
            </div>

            {activeList && (
              <div className="enter-soft flex flex-col gap-2.5">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono text-[12px] text-muted-foreground">
                    {activeList.filename}
                  </span>
                  <span className="numeric text-[11px] text-muted-foreground">
                    {plural(countLines(activeDraft), ["строка", "строки", "строк"])} ·{" "}
                    {activeDraft.length} символов
                  </span>
                </div>

                <Textarea
                  value={activeDraft}
                  onChange={(e) =>
                    setDrafts((current) => ({ ...current, [activeList.key]: e.target.value }))
                  }
                  rows={12}
                  spellCheck={false}
                  aria-label={activeList.label}
                  className="min-h-[190px] font-mono leading-relaxed"
                />

                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    className="gap-1.5"
                    disabled={!activeDirty || savingList !== null}
                    onClick={() => void saveList()}
                  >
                    {savingList === activeList.key ? (
                      <span className="size-3.5 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />
                    ) : (
                      <Icon name="check-circle-bold" size={14} />
                    )}
                    {savingList === activeList.key ? "Сохраняю…" : "Сохранить"}
                  </Button>
                  <span
                    key={activeDirty ? "dirty" : "clean"}
                    className="enter-soft text-[11px] text-muted-foreground"
                  >
                    {activeDirty ? "Есть несохранённые изменения" : "Сохранено на диск"}
                  </span>
                </div>
              </div>
            )}
          </>
        )}
      </SectionCard>

      {fakes && fakes.fakes.length > 0 && (
        <SectionCard title="Fake">
          <FakeRow
            label="Discord"
            current={fakes.currentDiscord}
            options={fakes.fakes}
            busy={fakeBusy === "discord"}
            onSelect={(fake) => void setFake("discord", fake)}
          />
          <div className="h-px bg-[var(--separator)]" />
          <FakeRow
            label="Игры"
            current={fakes.currentGame}
            options={fakes.fakes}
            busy={fakeBusy === "game"}
            onSelect={(fake) => void setFake("game", fake)}
          />
        </SectionCard>
      )}
    </Page>
  );
}

function FakeRow({
  label,
  current,
  options,
  busy,
  onSelect,
}: {
  label: string;
  current: string | null;
  options: string[];
  busy: boolean;
  onSelect: (fake: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[13px] font-medium">{label}</span>
        {busy ? (
          <span className="size-3.5 animate-spin rounded-full border-[1.5px] border-[color:var(--ring)] border-t-transparent" />
        ) : (
          <span key={current ?? "none"} className="enter-soft text-[11px] text-muted-foreground">
            {current ?? "не выбран"}
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {options.map((fake) => {
          const active = current === fake;
          return (
            <button
              key={fake}
              type="button"
              disabled={busy}
              onClick={() => onSelect(fake)}
              className="chip"
              data-active={active ? "true" : undefined}
            >
              {active && <Icon name="check-circle-bold" size={11} />}
              {fake}
            </button>
          );
        })}
      </div>
    </div>
  );
}
