import { errorText } from "@/shared/error";
import { useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { api, isDemo } from "@/shared/api";
import { Page, PageHeader } from "@/shared/ui/screen";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Icon, type IconName } from "@/shared/ui/Icon";

const INCLUDED: { icon: IconName; label: string }[] = [
  { icon: "settings-minimalistic-bold", label: "Настройки Control" },
  { icon: "database-bold", label: "Конфиг Flowseal" },
  { icon: "document-text-bold", label: "Списки фильтров" },
];

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

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function clock(): string {
  return new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

export function BackupScreen() {
  const [importPath, setImportPath] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportedAt, setExportedAt] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const fileName = `control-backup-${new Date().toISOString().slice(0, 10)}.json`;
  const valid = importPath.trim().toLowerCase().endsWith(".json");

  const exportBackup = async () => {
    setExporting(true);
    const t = toast.loading("Собираю резервную копию…");
    try {
      const bundle = await api.backupBuild();
      if (isDemo()) {
        downloadText(fileName, JSON.stringify(bundle, null, 2));
      } else {
        const path = await save({
          defaultPath: fileName,
          filters: [{ name: "Резервная копия Control", extensions: ["json"] }],
        });
        if (!path) {
          toast.dismiss(t);
          return;
        }
        await api.backupExportFile(path, bundle);
      }
      setExportedAt(clock());
      toast.success("Резервная копия сохранена", { id: t });
    } catch (e) {
      toast.error("Не удалось создать копию", { id: t, description: errorText(e) });
    } finally {
      setExporting(false);
    }
  };

  const importBackup = async () => {
    const path = importPath.trim();
    const t = toast.loading("Восстанавливаю данные…", {
      description: "Текущее состояние уходит в .backup",
    });
    try {
      await api.backupImportFile(path);
      toast.success("Восстановлено", { id: t });
    } catch (e) {
      toast.error("Не удалось восстановить", { id: t, description: errorText(e) });
    }
  };

  const pickFile = async () => {
    if (isDemo()) {
      setImportPath("C:\\Users\\Demo\\Downloads\\control-backup.json");
      return;
    }
    const selected = await open({
      filters: [{ name: "Резервная копия Control", extensions: ["json"] }],
      multiple: false,
      directory: false,
    });
    if (typeof selected === "string") setImportPath(selected);
  };

  return (
    <Page>
      <PageHeader
        title="Бэкап"
        subtitle="Снимок настроек в одном JSON-файле — перед переустановкой Windows или переездом на другой компьютер."
      />

      <div className="grid items-stretch gap-4 lg:grid-cols-2">
        <section className="material flex h-full flex-col gap-5 rounded-[12px] p-5">
          <div className="flex items-start gap-3.5">
            <span className="grid size-9 shrink-0 place-items-center rounded-[9px] bg-[var(--accent)] text-[var(--accent-foreground)]">
              <Icon name="download-minimalistic-bold" size={17} />
            </span>
            <div className="min-w-0">
              <h2 className="text-[14px] font-semibold">Создать копию</h2>
              <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                Соберёт текущие настройки в один файл, который можно хранить рядом с установщиком.
              </p>
            </div>
          </div>

          <ul className="divide-y divide-[var(--separator)] rounded-[10px] border border-[var(--surface-stroke)] bg-[var(--surface-muted)] px-3.5">
            {INCLUDED.map((item) => (
              <li key={item.label} className="flex items-center gap-2.5 py-2.5 text-[12px]">
                <Icon
                  name={item.icon}
                  size={13}
                  className="shrink-0 text-[color:var(--accent-foreground)]"
                />
                <span className="min-w-0 flex-1 truncate text-foreground">{item.label}</span>
                <Icon name="check-bold" size={11} className="shrink-0 text-success" />
              </li>
            ))}
          </ul>

          <p className="text-[11.5px] leading-relaxed text-muted-foreground">
            Один файл — удобно держать рядом с установщиком или отправить в поддержку.
          </p>

          <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-[var(--separator)] pt-4">
            <Button onClick={() => void exportBackup()} disabled={exporting} className="gap-1.5">
              {exporting ? (
                <span className="size-3.5 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />
              ) : (
                <Icon name="download-minimalistic-bold" size={14} />
              )}
              {exporting ? "Сохранение…" : "Сохранить копию"}
            </Button>
            <span className="min-w-0 truncate font-mono text-[10.5px] text-muted-foreground">
              {exportedAt ? `сохранено в ${exportedAt}` : fileName}
            </span>
          </div>
        </section>

        <section className="material flex h-full flex-col gap-5 rounded-[12px] p-5">
          <div className="flex items-start gap-3.5">
            <span className="grid size-9 shrink-0 place-items-center rounded-[9px] bg-[var(--fill)] text-muted-foreground">
              <Icon name="upload-minimalistic-bold" size={17} />
            </span>
            <div className="min-w-0">
              <h2 className="text-[14px] font-semibold">Восстановить из копии</h2>
              <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                Заменит текущие настройки данными из файла. Перед заменой Control сохранит
                предыдущее состояние рядом, как .backup.
              </p>
            </div>
          </div>

          {importPath ? (
            <div className="enter-rise flex items-center gap-3 rounded-[10px] border border-[var(--surface-stroke)] bg-[var(--surface-muted)] px-3.5 py-3">
              <span className="grid size-8 shrink-0 place-items-center rounded-[7px] bg-[var(--fill)] text-muted-foreground">
                <Icon name="document-text-bold" size={15} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] font-medium">{baseName(importPath)}</p>
                <p className="mt-0.5 truncate font-mono text-[10.5px] text-muted-foreground">
                  {importPath}
                </p>
              </div>
              <Button variant="ghost" size="xs" onClick={() => void pickFile()}>
                Заменить
              </Button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => void pickFile()}
              className="flex w-full flex-col items-center gap-1.5 rounded-[10px] border border-dashed border-[var(--surface-stroke)] px-4 py-6 text-center transition-colors hover:border-[var(--ring)]/40 hover:bg-[var(--fill)]"
            >
              <Icon name="folder-open-bold" size={18} className="text-muted-foreground" />
              <span className="text-[12px] font-medium">Выберите JSON-файл</span>
              <span className="font-mono text-[10.5px] text-muted-foreground">
                control-backup-2026-11-21.json
              </span>
            </button>
          )}

          <p className="text-[11.5px] leading-relaxed text-muted-foreground">
            Восстановление меняет только настройки и списки. Профили, версии Zapret и логи
            остаются как есть.
          </p>

          <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-[var(--separator)] pt-4">
            <Button
              disabled={!valid}
              className="gap-1.5"
              onClick={() => {
                if (!valid) {
                  toast.warning("Нужен .json-файл");
                  return;
                }
                setConfirmOpen(true);
              }}
            >
              <Icon name="check-circle-bold" size={14} />
              Восстановить
            </Button>
            <span className="text-[11px] text-muted-foreground">
              {valid ? "Проверим формат перед заменой" : "Сначала выберите файл копии"}
            </span>
          </div>
        </section>
      </div>

      <p className="text-[11.5px] leading-relaxed text-muted-foreground">
        Копия не заменяет профили: переносите их вместе с папкой Control, если переезжаете на
        другой компьютер.
      </p>

      <Modal
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        size="sm"
        title="Восстановить из копии?"
        description="Настройки и списки будут заменены данными из файла. Текущее состояние сохранится в .backup."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
              Отмена
            </Button>
            <Button
              onClick={() => {
                setConfirmOpen(false);
                void importBackup();
              }}
            >
              Восстановить
            </Button>
          </>
        }
      />
    </Page>
  );
}
