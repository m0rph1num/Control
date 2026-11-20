import { errorText } from "@/shared/error";
import { useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { api, isDemo } from "@/shared/api";
import { FieldLabel, Page, PageHeader, SectionCard } from "@/shared/ui/screen";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Icon } from "@/shared/ui/Icon";

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

export function BackupScreen() {
  const [importPath, setImportPath] = useState("");
  const [exporting, setExporting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const fileName = `control-backup-${new Date().toISOString().slice(0, 10)}.json`;

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

  const valid = importPath.trim().toLowerCase().endsWith(".json");

  return (
    <Page>
      <PageHeader title="Бэкап" subtitle="Настройки и списки в одном JSON-файле." />

      <SectionCard title="Экспорт">
        <div className="flex items-center justify-between gap-3 rounded-[7px] bg-[var(--fill)] px-3 py-2.5">
          <span className="min-w-0 truncate font-mono text-[12px]">{fileName}</span>
          <span className="shrink-0 text-[11px] text-muted-foreground">JSON</span>
        </div>

        <Button onClick={() => void exportBackup()} disabled={exporting} className="gap-1.5">
          <Icon name="download-minimalistic-bold" size={14} />
          {exporting ? "Сохранение…" : "Экспортировать"}
        </Button>
      </SectionCard>

      <SectionCard title="Восстановление">
        <div className="flex flex-col gap-1.5">
          <FieldLabel>Файл копии</FieldLabel>
          <Input
            value={importPath}
            onChange={(e) => setImportPath(e.target.value)}
            placeholder="C:\\Users\\…\\control-backup.json"
            className="font-mono text-[12px]"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => void pickFile()}>
            Выбрать файл…
          </Button>
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
        </div>
      </SectionCard>

      <Modal
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        size="sm"
        title="Восстановить из копии?"
        description="Настройки и списки будут перезаписаны. Текущее состояние сохранится в .backup."
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
