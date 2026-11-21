import { errorText } from "@/shared/error";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import {
  api,
  isDemo,
  type FakesInfo,
  type GameFilterMode,
  type IpsetMode,
  type Profile,
  type StrategyInfo,
  type UserList,
} from "@/shared/api";
import {
  EmptyState,
  FieldLabel,
  Page,
  PageHeader,
  SectionCard,
  Segmented,
} from "@/shared/ui/screen";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { copyText } from "@/shared/clipboard";
import { plural } from "@/shared/plural";
import { Modal } from "@/components/ui/modal";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Icon } from "@/shared/ui/Icon";
import { cn } from "cn";
import { AutoProfile } from "@/features/profiles/AutoProfile";

const GAME_OPTIONS: { value: GameFilterMode; label: string }[] = [
  { value: "disabled", label: "Выключен" },
  { value: "all", label: "TCP+UDP" },
  { value: "tcp", label: "TCP" },
  { value: "udp", label: "UDP" },
];

const IPSET_OPTIONS: { value: IpsetMode; label: string }[] = [
  { value: "loaded", label: "Реальный список" },
  { value: "any", label: "Без фильтра" },
  { value: "none", label: "Строгий запрет" },
];

const GAME_LABEL: Record<GameFilterMode, string> = {
  disabled: "выключен",
  all: "TCP+UDP",
  tcp: "TCP",
  udp: "UDP",
};

const IPSET_LABEL: Record<IpsetMode, string> = {
  loaded: "по списку",
  any: "без фильтра",
  none: "строгий запрет",
};

const NONE = "__none__";

function formatDate(iso: string): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function countLines(text: string): number {
  return text.split(/\r?\n/).filter((line) => line.trim().length > 0).length;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  return `${Math.max(1, Math.round(bytes / 1024))} КБ`;
}

function profileFileName(name: string): string {
  const base = name
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 48);
  return `${base || "control-profile"}.json`;
}

function downloadText(name: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function emptyProfile(strategy: string): Profile {
  return {
    id: "",
    name: "",
    description: "",
    strategy,
    gameFilter: "disabled",
    ipset: "loaded",
    fakes: { discord: null, game: null },
    lists: {},
    createdAt: "",
    updatedAt: "",
    source: "local",
  };
}

export function ProfilesScreen() {
  const [profiles, setProfiles] = useState<Profile[] | null>(null);
  const [strategies, setStrategies] = useState<StrategyInfo[]>([]);
  const [fakes, setFakes] = useState<FakesInfo | null>(null);
  const [listDefs, setListDefs] = useState<UserList[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Profile | null>(null);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState<string | null>(null);
  const [share, setShare] = useState<{ id: string; name: string; text: string } | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importMode, setImportMode] = useState<"file" | "text">("file");
  const [importText, setImportText] = useState("");
  const [importFileName, setImportFileName] = useState("");
  const [importing, setImporting] = useState(false);
  const [toDelete, setToDelete] = useState<Profile | null>(null);
  const [snapshotting, setSnapshotting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async (focus?: string) => {
    try {
      const list = await api.profilesList();
      setProfiles(list);
      setSelectedId((current) => {
        const wanted = focus ?? current;
        if (wanted && list.some((item) => item.id === wanted)) return wanted;
        return list[0]?.id ?? null;
      });
    } catch (e) {
      setProfiles([]);
      toast.error("Не удалось загрузить профили", { description: errorText(e) });
    }
  }, []);

  useEffect(() => {
    void load();
    void api
      .strategiesList()
      .then(setStrategies)
      .catch(() => setStrategies([]));
    void api
      .fakesGet()
      .then(setFakes)
      .catch(() => setFakes(null));
    void api
      .listsGet()
      .then(setListDefs)
      .catch(() => setListDefs([]));
  }, [load]);

  const selected = useMemo(
    () => profiles?.find((item) => item.id === selectedId) ?? null,
    [profiles, selectedId],
  );

  const startFromCurrent = async () => {
    setSnapshotting(true);
    try {
      const [game, ipset, fakesInfo, lists] = await Promise.all([
        api.gameFilterGet(),
        api.ipsetFilterGet(),
        api.fakesGet(),
        api.listsGet(),
      ]);
      setFakes(fakesInfo);
      setListDefs(lists);
      const listsMap: Record<string, string> = {};
      for (const list of lists) {
        if (list.content.trim()) listsMap[list.key] = list.content;
      }
      const draft = emptyProfile(strategies[0]?.value ?? "");
      setEditing({
        ...draft,
        gameFilter: game,
        ipset,
        fakes: { discord: fakesInfo.currentDiscord, game: fakesInfo.currentGame },
        lists: listsMap,
      });
    } catch (e) {
      toast.error("Не удалось прочитать текущие настройки", { description: errorText(e) });
    } finally {
      setSnapshotting(false);
    }
  };

  const startBlank = () => {
    setEditing(emptyProfile(strategies[0]?.value ?? ""));
  };

  const saveProfile = async (profile: Profile) => {
    if (!profile.name.trim()) {
      toast.warning("Укажите название профиля");
      return;
    }
    try {
      const saved = await api.profileSave(profile);
      setEditing(null);
      setJustSaved(saved.id);
      await load(saved.id);
      toast.success(profile.id ? "Профиль обновлён" : "Профиль создан", {
        description: saved.name,
      });
    } catch (e) {
      toast.error("Не удалось сохранить профиль", { description: errorText(e) });
    }
  };

  const acceptGenerated = async (profile: Profile) => {
    setJustSaved(profile.id);
    await load(profile.id);
  };

  const apply = async (profile: Profile) => {
    setApplyingId(profile.id);
    const t = toast.loading(`Применяю «${profile.name}»…`);
    try {
      const result = await api.profileApply(profile.id);
      let description = "Настройки сохранены. Запустите защиту, когда будете готовы";
      if (result.liveApplied) {
        description = "winws перезапущен — защита уже работает с новыми настройками";
      } else {
        const snapshot = await api.protectionSnapshot().catch(() => null);
        if (snapshot?.state === "active") {
          description = "Настройки сохранены. Перезапустите защиту, чтобы применить их";
        }
      }
      toast.success("Профиль применён", { id: t, description });
    } catch (e) {
      toast.error("Не удалось применить профиль", { id: t, description: errorText(e) });
    } finally {
      setApplyingId(null);
    }
  };

  const shareProfile = async (profile: Profile) => {
    try {
      const text = await api.profileExportText(profile.id);
      setShare({ id: profile.id, name: profile.name, text });
    } catch (e) {
      toast.error("Не удалось подготовить профиль", { description: errorText(e) });
    }
  };

  const copyShare = async () => {
    if (!share) return;
    if (await copyText(share.text)) {
      toast.success("Текст профиля скопирован", {
        description: "Друг вставит его в «Импорт» → «Текст»",
      });
      setShare(null);
    } else {
      toast.error("Не удалось скопировать", { description: "Выделите текст и нажмите Ctrl+C" });
    }
  };

  const exportFile = async (profile: Pick<Profile, "id" | "name">) => {
    const t = toast.loading("Сохраняю файл профиля…");
    try {
      const text = await api.profileExportText(profile.id);
      if (isDemo()) {
        downloadText(profileFileName(profile.name), text);
      } else {
        const path = await save({
          defaultPath: profileFileName(profile.name),
          filters: [{ name: "Профиль Control", extensions: ["json"] }],
        });
        if (!path) {
          toast.dismiss(t);
          return;
        }
        await api.profileExportFile(path, profile.id);
      }
      toast.success("Файл профиля сохранён", { id: t, description: profile.name });
    } catch (e) {
      toast.error("Не удалось сохранить файл", { id: t, description: errorText(e) });
    }
  };

  const pickImportFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) {
      toast.error("Файл слишком велик", { description: "Профиль должен быть меньше 25 МБ" });
      return;
    }
    try {
      setImportText(await file.text());
      setImportFileName(file.name);
    } catch (e) {
      toast.error("Не удалось прочитать файл", { description: errorText(e) });
    }
  };

  const doImport = async () => {
    if (!importText.trim()) {
      toast.warning(importMode === "file" ? "Выберите файл профиля" : "Вставьте текст профиля");
      return;
    }
    setImporting(true);
    try {
      const imported = await api.profileImportText(importText.trim());
      setImportOpen(false);
      setImportText("");
      setImportFileName("");
      setJustSaved(imported.id);
      await load(imported.id);
      toast.success("Профиль импортирован", { description: imported.name });
    } catch (e) {
      toast.error("Импорт не удался", { description: errorText(e) });
    } finally {
      setImporting(false);
    }
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    const target = toDelete;
    setToDelete(null);
    try {
      await api.profileDelete(target.id);
      await load();
      toast.success("Профиль удалён", { description: target.name });
    } catch (e) {
      toast.error("Не удалось удалить профиль", { description: errorText(e) });
    }
  };

  const openImport = () => {
    setImportMode("file");
    setImportText("");
    setImportFileName("");
    setImportOpen(true);
  };

  return (
    <Page>
      <PageHeader
        title="Профили"
        subtitle="Снимок стратегии, фильтров и списков."
        action={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="gap-1.5" onClick={openImport}>
              <Icon name="upload-minimalistic-bold" size={14} />
              Импорт
            </Button>
            <Button
              size="sm"
              className="gap-1.5"
              onClick={() => void startFromCurrent()}
              disabled={snapshotting}
            >
              {snapshotting ? (
                <span className="size-3.5 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />
              ) : (
                <Icon name="add-circle-bold" size={14} />
              )}
              {snapshotting ? "Снимаю…" : "Из текущих настроек"}
            </Button>
          </div>
        }
      />

      <AutoProfile onSaved={acceptGenerated} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-2.5">
          <div className="flex items-center justify-between px-0.5">
            <h2 className="text-section flex items-center gap-2">
              Мои профили
              {profiles && (
                <span className="numeric text-[11px] font-normal text-muted-foreground">
                  {profiles.length}
                </span>
              )}
            </h2>
            <button
              type="button"
              onClick={() => void api.profilesOpenFolder().catch(() => undefined)}
              className="flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
            >
              <Icon name="folder-open-bold" size={12} />
              Папка
            </button>
          </div>

          <div className="material flex flex-col gap-0.5 rounded-[10px] p-1.5">
            {profiles === null && (
              <div className="flex flex-col gap-1.5 p-1.5">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            )}

            {profiles?.length === 0 && (
              <EmptyState
                icon="database-bold"
                title="Профилей пока нет"
                hint="Начните с «Из текущих настроек» — получится рабочая копия."
              />
            )}

            {profiles?.map((profile) => {
              const active = profile.id === selectedId && !editing;
              return (
                <button
                  key={profile.id}
                  type="button"
                  onClick={() => {
                    setEditing(null);
                    setSelectedId(profile.id);
                  }}
                  data-selected={active ? "true" : undefined}
                  className={cn(
                    "flex flex-col gap-1 rounded-[6px] px-2.5 py-2 text-left transition-colors",
                    active ? "bg-[var(--accent)]" : "hover:bg-[var(--fill)]",
                    justSaved === profile.id && "enter-rise",
                  )}
                >
                  <span className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                      {profile.name}
                    </span>
                    {profile.source === "imported" && (
                      <span className="rounded-[4px] bg-[var(--fill-strong)] px-1.5 py-0.5 text-[11px] uppercase tracking-[0.04em] text-muted-foreground">
                        импорт
                      </span>
                    )}
                  </span>
                  <span className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                    <span className="truncate font-mono">{profile.strategy}</span>
                    <span>·</span>
                    <span>игры: {GAME_LABEL[profile.gameFilter]}</span>
                    {Object.keys(profile.lists).length > 0 && (
                      <>
                        <span>·</span>
                        <span>{plural(Object.keys(profile.lists).length, ["список", "списка", "списков"])}</span>
                      </>
                    )}
                    {applyingId === profile.id && (
                      <>
                        <span>·</span>
                        <span className="text-[color:var(--accent-foreground)]">применяется…</span>
                      </>
                    )}
                  </span>
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={startBlank}
            className="flex h-9 items-center justify-center gap-1.5 rounded-[7px] border border-dashed border-[var(--surface-stroke)] text-[13px] text-muted-foreground transition-colors hover:border-[var(--ring)]/40 hover:text-foreground"
          >
            <Icon name="add-circle-bold" size={14} />
            Пустой профиль
          </button>
        </div>

        <div className="min-w-0">
          {editing ? (
            <ProfileEditor
              key={editing.id || "new"}
              profile={editing}
              strategies={strategies}
              fakes={fakes}
              listDefs={listDefs}
              onListDefs={setListDefs}
              onCancel={() => setEditing(null)}
              onSave={saveProfile}
            />
          ) : selected ? (
            <div key={selected.id} className="enter-soft flex flex-col gap-7">
              <section className="material rounded-[12px]">
                <div className="flex flex-col gap-5 p-6">
                  <div className="flex items-start gap-3.5">
                    <span className="grid size-11 shrink-0 place-items-center rounded-[10px] bg-[var(--accent)] text-[var(--accent-foreground)]">
                      <Icon name="database-bold" size={19} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-muted-foreground">
                        {selected.source === "imported" ? "Импортирован" : "Локальный профиль"}
                        <span aria-hidden>·</span>
                        <span className="numeric">{formatDate(selected.updatedAt)}</span>
                      </div>
                      <h2 className="text-heading mt-1.5 truncate">{selected.name}</h2>
                      <p className="text-lede mt-2 max-w-[46rem] text-muted-foreground">
                        {selected.description || "Без описания"}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 border-t border-[var(--separator)] pt-5">
                    <Button
                      className="gap-1.5"
                      disabled={applyingId !== null}
                      onClick={() => void apply(selected)}
                    >
                      {applyingId === selected.id ? (
                        <span className="size-3.5 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />
                      ) : (
                        <Icon name="play-circle-bold" size={15} />
                      )}
                      {applyingId === selected.id ? "Применяю…" : "Применить"}
                    </Button>
                    <Button
                      variant="outline"
                      className="gap-1.5"
                      onClick={() => setEditing(selected)}
                    >
                      <Icon name="settings-minimalistic-bold" size={14} />
                      Изменить
                    </Button>
                    <Button
                      variant="outline"
                      className="gap-1.5"
                      onClick={() => void shareProfile(selected)}
                    >
                      <Icon name="widget-4-bold" size={14} />
                      Поделиться
                    </Button>
                    <Button
                      variant="ghost"
                      className="ml-auto gap-1.5 text-destructive hover:text-destructive"
                      onClick={() => setToDelete(selected)}
                    >
                      <Icon name="trash-bin-trash-bold" size={14} />
                      Удалить
                    </Button>
                  </div>
                </div>
              </section>

              <SectionCard title="Состав" className="@container">
                <div className="grid gap-x-8 gap-y-4 @md:grid-cols-2">
                  <ProfileFact
                    icon="document-text-bold"
                    label="Стратегия"
                    value={selected.strategy || "—"}
                    mono
                  />
                  <ProfileFact
                    icon="pulse-bold"
                    label="Игровой фильтр"
                    value={GAME_LABEL[selected.gameFilter]}
                  />
                  <ProfileFact
                    icon="filter-bold"
                    label="IPSet"
                    value={IPSET_LABEL[selected.ipset]}
                  />
                  <ProfileFact
                    icon="database-bold"
                    label="Списки"
                    value={plural(Object.keys(selected.lists).length, ["список", "списка", "списков"])}
                  />
                  <ProfileFact
                    icon="cpu-bolt-bold"
                    label="Fake для Discord"
                    value={selected.fakes.discord ?? "не выбран"}
                  />
                  <ProfileFact
                    icon="cpu-bolt-bold"
                    label="Fake для игр"
                    value={selected.fakes.game ?? "не выбран"}
                  />
                  <ProfileFact
                    icon="archive-bold"
                    label="Создан"
                    value={formatDate(selected.createdAt)}
                  />
                </div>
              </SectionCard>

              <SectionCard
                title="Пользовательские списки"
                action={
                  <span className="numeric text-[11px] text-muted-foreground">
                    {Object.keys(selected.lists).length}
                  </span>
                }
              >
                {Object.keys(selected.lists).length === 0 ? (
                  <p className="text-caption text-muted-foreground">
                    Профиль не меняет списки активной версии.
                  </p>
                ) : (
                  Object.entries(selected.lists).map(([key, text]) => {
                    const def = listDefs.find((item) => item.key === key);
                    return (
                      <div
                        key={key}
                        className="flex items-center justify-between gap-3 border-b border-[var(--separator)] py-2 text-[13px] last:border-b-0"
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <Icon name="document-text-bold" size={13} className="shrink-0 text-muted-foreground" />
                          <span className="truncate font-medium">{def?.label ?? key}</span>
                          <span className="shrink-0 font-mono text-[12px] text-muted-foreground">
                            {def?.filename ?? `${key}.txt`}
                          </span>
                        </span>
                        <span className="numeric shrink-0 text-[11px] text-muted-foreground">
                          {plural(countLines(text), ["строка", "строки", "строк"])} · {formatSize(text.length)}
                        </span>
                      </div>
                    );
                  })
                )}
              </SectionCard>
            </div>
          ) : (
            <section className="material grid min-h-[280px] place-items-center rounded-[10px] p-6">
              <div className="flex flex-col items-center gap-2 text-center">
                <Icon name="database-bold" size={20} className="text-muted-foreground" />
                <p className="text-[13px] font-medium">Выберите профиль</p>
                <p className="text-caption max-w-[26rem] text-muted-foreground">
                  Или создайте новый из текущих настроек — стратегия, фильтры, fake и списки
                  сохранятся в один переносимый снимок.
                </p>
                <Button size="sm" className="mt-1 gap-1.5" onClick={() => void startFromCurrent()}>
                  <Icon name="add-circle-bold" size={14} />
                  Создать профиль
                </Button>
              </div>
            </section>
          )}
        </div>
      </div>

      <Modal
        open={share !== null}
        onOpenChange={(open) => !open && setShare(null)}
        size="lg"
        title="Поделиться профилем"
        description="Отправьте файл или текст. Внутри только настройки и списки — без паролей."
        footer={
          <>
            <Button variant="ghost" onClick={() => setShare(null)}>
              Закрыть
            </Button>
            <Button
              variant="outline"
              className="gap-1.5"
              onClick={() => {
                if (share) void exportFile(share);
              }}
            >
              <Icon name="download-minimalistic-bold" size={14} />
              Сохранить файл
            </Button>
            <Button onClick={() => void copyShare()}>Скопировать текст</Button>
          </>
        }
      >
        <Textarea
          readOnly
          value={share?.text ?? ""}
          rows={12}
          className="font-mono text-[12px]"
          aria-label="Текст профиля"
        />
      </Modal>

      <Modal
        open={importOpen}
        onOpenChange={setImportOpen}
        size="lg"
        title="Импорт профиля"
        description="Импорт всегда создаёт новый профиль и не перезаписывает ваши."
        footer={
          <>
            <Button variant="ghost" onClick={() => setImportOpen(false)}>
              Отмена
            </Button>
            <Button
              disabled={importing || !importText.trim()}
              className="gap-1.5"
              onClick={() => void doImport()}
            >
              {importing ? (
                <span className="size-3.5 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />
              ) : (
                <Icon name="check-circle-bold" size={14} />
              )}
              {importing ? "Импортирую…" : "Импортировать"}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Segmented
            value={importMode}
            options={[
              { value: "file", label: "Файл" },
              { value: "text", label: "Текст" },
            ]}
            onChange={setImportMode}
          />

          {importMode === "file" ? (
            <div className="flex flex-col gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                className="sr-only"
                onChange={(e) => void pickImportFile(e.target.files?.[0])}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex flex-col items-center gap-2 rounded-[8px] border border-dashed border-[var(--surface-stroke)] px-4 py-8 transition-colors hover:border-[var(--ring)]/45 hover:bg-[var(--fill)]"
              >
                <Icon name="upload-minimalistic-bold" size={22} className="text-muted-foreground" />
                <span className="text-[13px] font-medium">
                  {importFileName || "Выберите файл профиля"}
                </span>
                <span className="text-[11px] text-muted-foreground">JSON-файл, до 25 МБ</span>
              </button>
              {importText && (
                <p className="flex items-center gap-1.5 text-[11px] text-success">
                  <Icon name="check-circle-bold" size={12} />
                  Файл прочитан — можно импортировать
                </p>
              )}
            </div>
          ) : (
            <Textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              rows={12}
              placeholder='{ "format": "control-profile-1", … }'
              className="font-mono text-[12px]"
              aria-label="Вставьте текст профиля"
            />
          )}
        </div>
      </Modal>

      <Modal
        open={toDelete !== null}
        onOpenChange={(open) => !open && setToDelete(null)}
        size="sm"
        title={`Удалить профиль «${toDelete?.name ?? ""}»?`}
        description="Файл профиля будет удалён. Текущие настройки Zapret останутся как есть."
        footer={
          <>
            <Button variant="ghost" onClick={() => setToDelete(null)}>
              Отмена
            </Button>
            <Button variant="destructive" onClick={() => void confirmDelete()}>
              Удалить
            </Button>
          </>
        }
      />
    </Page>
  );
}

function ProfileFact({
  icon,
  label,
  value,
  mono,
}: {
  icon: string;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="text-caption flex min-w-0 items-center justify-between gap-3">
      <span className="flex shrink-0 items-center gap-2 text-muted-foreground">
        <Icon name={icon} size={13} />
        {label}
      </span>
      <span
        className={cn("min-w-0 truncate font-medium text-foreground", mono && "font-mono")}
        title={value}
      >
        {value}
      </span>
    </div>
  );
}

function EditorSection({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="@container flex flex-col gap-3 border-t border-[var(--separator)] pt-4 first:border-t-0 first:pt-0">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[13px] font-semibold tracking-[-0.008em]">{title}</h3>
        {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function ProfileEditor({
  profile,
  strategies,
  fakes,
  listDefs,
  onListDefs,
  onCancel,
  onSave,
}: {
  profile: Profile;
  strategies: StrategyInfo[];
  fakes: FakesInfo | null;
  listDefs: UserList[];
  onListDefs: (lists: UserList[]) => void;
  onCancel: () => void;
  onSave: (profile: Profile) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Profile>(profile);
  const [saving, setSaving] = useState(false);
  const [activeKey, setActiveKey] = useState<string | null>(listDefs[0]?.key ?? null);
  const [filling, setFilling] = useState(false);
  const fakeOptions = fakes?.fakes ?? [];
  const listCount = Object.keys(draft.lists).length;
  const listBytes = Object.values(draft.lists).reduce((sum, text) => sum + text.length, 0);

  useEffect(() => {
    if (!activeKey && listDefs[0]) setActiveKey(listDefs[0].key);
  }, [activeKey, listDefs]);

  const patch = (changes: Partial<Profile>) => setDraft((cur) => ({ ...cur, ...changes }));

  const setListContent = (key: string, value: string) => {
    setDraft((cur) => {
      const lists = { ...cur.lists };
      if (value.trim() === "") delete lists[key];
      else lists[key] = value;
      return { ...cur, lists };
    });
  };

  const fillFromVersion = async () => {
    setFilling(true);
    try {
      const lists = await api.listsGet();
      onListDefs(lists);
      const map: Record<string, string> = {};
      for (const list of lists) {
        if (list.content.trim()) map[list.key] = list.content;
      }
      patch({ lists: map });
      toast.success("Списки взяты из активной версии");
    } catch (e) {
      toast.error("Не удалось прочитать списки", { description: errorText(e) });
    } finally {
      setFilling(false);
    }
  };

  const clearLists = () => {
    patch({ lists: {} });
    toast.info("Списки убраны из профиля");
  };

  const submit = async () => {
    setSaving(true);
    try {
      await onSave(draft);
    } finally {
      setSaving(false);
    }
  };

  const activeList = listDefs.find((item) => item.key === activeKey) ?? null;
  const activeValue = activeKey ? draft.lists[activeKey] ?? "" : "";

  return (
    <section className="material enter-soft flex flex-col gap-4 rounded-[10px] p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-heading">{profile.id ? "Изменить профиль" : "Новый профиль"}</h2>
          <p className="text-caption mt-1 text-muted-foreground">
            Настройки применятся только по кнопке «Применить».
          </p>
        </div>
        <span className="grid size-8 place-items-center rounded-[7px] bg-[var(--fill)] text-muted-foreground">
          <Icon name="database-bold" size={16} />
        </span>
      </div>

      <EditorSection title="Основное">
        <div className="grid gap-3 @md:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <FieldLabel hint="1–64 символа">Название</FieldLabel>
            <Input
              value={draft.name}
              onChange={(e) => patch({ name: e.target.value })}
              placeholder="Например: YouTube + Discord"
              aria-label="Название профиля"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <FieldLabel hint=".bat или пресет">Стратегия</FieldLabel>
            {strategies.length === 0 ? (
              <p className="text-caption rounded-[7px] border border-warning/30 px-3 py-2 text-warning">
                Установите версию Zapret на вкладке «Версии».
              </p>
            ) : (
              <Select
                value={draft.strategy || undefined}
                onValueChange={(value) => patch({ strategy: value })}
              >
                <SelectTrigger className="h-8 w-full">
                  <SelectValue placeholder="Выберите стратегию" />
                </SelectTrigger>
                <SelectContent>
                  {strategies.map((strategy) => (
                    <SelectItem key={strategy.value} value={strategy.value}>
                      {strategy.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <FieldLabel hint="до 500 символов">Описание</FieldLabel>
          <Textarea
            value={draft.description}
            onChange={(e) => patch({ description: e.target.value })}
            rows={2}
            placeholder="Для каких сайтов и провайдера подходит профиль"
            aria-label="Описание профиля"
          />
        </div>
      </EditorSection>

      <EditorSection title="Фильтры и fake" hint="применяются вместе с профилем">
        <div className="grid gap-3 @md:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <FieldLabel>Игровой фильтр</FieldLabel>
            <Segmented
              value={draft.gameFilter}
              options={GAME_OPTIONS}
              onChange={(value) => patch({ gameFilter: value })}
              className="w-full"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <FieldLabel>IPSet</FieldLabel>
            <Segmented
              value={draft.ipset}
              options={IPSET_OPTIONS}
              onChange={(value) => patch({ ipset: value })}
              className="w-full"
            />
          </div>
        </div>

        <div className="grid gap-3 @md:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <FieldLabel>Fake для Discord</FieldLabel>
            <Select
              value={draft.fakes.discord ?? NONE}
              onValueChange={(value) =>
                patch({ fakes: { ...draft.fakes, discord: value === NONE ? null : value } })
              }
            >
              <SelectTrigger className="h-8 w-full">
                <SelectValue placeholder="Не выбран" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Не выбран</SelectItem>
                {fakeOptions.map((fake) => (
                  <SelectItem key={fake} value={fake}>
                    {fake}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <FieldLabel>Fake для игр</FieldLabel>
            <Select
              value={draft.fakes.game ?? NONE}
              onValueChange={(value) =>
                patch({ fakes: { ...draft.fakes, game: value === NONE ? null : value } })
              }
            >
              <SelectTrigger className="h-8 w-full">
                <SelectValue placeholder="Не выбран" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Не выбран</SelectItem>
                {fakeOptions.map((fake) => (
                  <SelectItem key={fake} value={fake}>
                    {fake}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </EditorSection>

      <EditorSection
        title="Пользовательские списки"
        hint={listCount > 0 ? `${listCount} · ${formatSize(listBytes)}` : "не включены"}
      >
        {listDefs.length === 0 ? (
          <p className="text-caption text-muted-foreground">
            Списки появятся после установки версии Zapret.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5">
              {listDefs.map((list) => {
                const included = Boolean(draft.lists[list.key]?.trim());
                return (
                  <button
                    key={list.key}
                    type="button"
                    onClick={() => setActiveKey(list.key)}
                    data-active={activeKey === list.key ? "true" : undefined}
                    className="chip"
                  >
                    {included && (
                      <Icon name="check-circle-bold" size={11} className="text-[color:var(--accent-foreground)]" />
                    )}
                    {list.label}
                  </button>
                );
              })}
            </div>

            {activeList && (
              <div className="enter-soft flex flex-col gap-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono text-[12px] text-muted-foreground">
                    {activeList.filename}
                  </span>
                  <span className="numeric text-[11px] text-muted-foreground">
                    {activeValue.trim()
                      ? `${plural(countLines(activeValue), ["строка", "строки", "строк"])} · ${formatSize(activeValue.length)}`
                      : "не входит в профиль"}
                  </span>
                </div>

                <Textarea
                  value={activeValue}
                  onChange={(e) => setListContent(activeList.key, e.target.value)}
                  rows={8}
                  spellCheck={false}
                  placeholder="Начните вводить домены или IP — список включится в профиль"
                  aria-label={activeList.label}
                  className="min-h-[150px] font-mono text-[12px] leading-relaxed"
                />

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    disabled={filling}
                    onClick={() => void fillFromVersion()}
                  >
                    {filling ? (
                      <span className="size-3.5 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />
                    ) : (
                      <Icon name="refresh-bold" size={13} />
                    )}
                    Заполнить из версии
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1.5"
                    disabled={listCount === 0}
                    onClick={clearLists}
                  >
                    <Icon name="trash-bin-trash-bold" size={13} />
                    Очистить профиль
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </EditorSection>

      <div className="flex items-center gap-2 border-t border-[var(--separator)] pt-4">
        <Button className="gap-1.5" disabled={saving} onClick={() => void submit()}>
          {saving ? (
            <span className="size-3.5 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />
          ) : (
            <Icon name="check-circle-bold" size={14} />
          )}
          {profile.id ? "Сохранить" : "Создать профиль"}
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={saving}>
          Отмена
        </Button>
      </div>
    </section>
  );
}
