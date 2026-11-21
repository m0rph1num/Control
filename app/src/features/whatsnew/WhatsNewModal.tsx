import { Dialog as DialogPrimitive } from "radix-ui";
import { Button } from "@/components/ui/button";
import { CloseGlyph } from "@/shared/ui/CloseGlyph";
import { Icon, type IconName } from "@/shared/ui/Icon";

interface Highlight {
  icon: IconName;
  title: string;
  text: string;
}

interface Change {
  lead: string;
  text: string;
}

interface Group {
  title: string;
  icon: IconName;
  tone: "accent" | "success";
  items: Change[];
}

const VERSION = "2.0.1";
const RELEASED = "21 ноября 2026";

const HIGHLIGHTS: Highlight[] = [
  {
    icon: "shield-check-bold",
    title: "Запуск исправлен",
    text: "Control больше не закрывается после экрана загрузки.",
  },
  {
    icon: "bolt-circle-bold",
    title: "Всё на месте",
    text: "Подбор стратегии, автопрофиль и обновление из приложения работают как прежде.",
  },
  {
    icon: "refresh-bold",
    title: "Данные сохранены",
    text: "Настройки, профили и версии Zapret при обновлении не затрагиваются.",
  },
];

const GROUPS: Group[] = [
  {
    title: "Исправлено",
    icon: "check-circle-bold",
    tone: "success",
    items: [
      {
        lead: "Запуск установленной версии.",
        text: "Приложение больше не завершается сразу после экрана загрузки.",
      },
      {
        lead: "Установка обновлений.",
        text: "Установщик запрашивает права администратора и не закрывается молча.",
      },
    ],
  },
  {
    title: "Улучшено",
    icon: "refresh-bold",
    tone: "accent",
    items: [
      {
        lead: "Стабильность.",
        text: "Длинные проверки при старте больше не влияют на работу окна.",
      },
      {
        lead: "Сборка.",
        text: "Проверки проекта проходят на чистом клоне, без ручной подготовки файлов.",
      },
    ],
  },
];

export function WhatsNewModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[70] bg-black/35 duration-200 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-[80] flex max-h-[calc(100vh-4rem)] w-[calc(100%-2rem)] max-w-[700px] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[14px] border border-[var(--surface-stroke)] bg-[var(--surface)] outline-none duration-200 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-[0.985] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.985]">
          <div className="release-head relative shrink-0 border-b border-[var(--separator)] px-8 pb-6 pt-7">
            <div className="release-in flex items-center gap-2.5">
              <span className="inline-flex items-center gap-1.5 rounded-[6px] bg-[var(--accent)] px-2.5 py-1 text-[11px] font-semibold text-[var(--accent-foreground)]">
                <span className="size-1.5 rounded-full bg-[var(--ring)]" />
                Версия {VERSION}
              </span>
              <span className="text-[11px] text-muted-foreground">{RELEASED}</span>
            </div>

            <DialogPrimitive.Title
              className="release-in mt-4 text-[26px] font-semibold leading-[1.12] tracking-[-0.03em]"
              style={{ animationDelay: "30ms" }}
            >
              Control 2.0
            </DialogPrimitive.Title>
            <DialogPrimitive.Description
              className="release-in mt-2.5 max-w-[60ch] text-[13px] leading-[1.55] text-muted-foreground"
              style={{ animationDelay: "60ms" }}
            >
              Программа стала быстрее откликаться, понятнее показывает состояние защиты и теперь
              работает в светлой теме. Ниже — что изменилось в работе.
            </DialogPrimitive.Description>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-8 py-6">
            <div className="grid gap-2.5 sm:grid-cols-3">
              {HIGHLIGHTS.map((item, i) => (
                <div
                  key={item.title}
                  className="release-in flex flex-col gap-2 rounded-[11px] border border-[var(--separator)] bg-[var(--surface-muted)] p-4"
                  style={{ animationDelay: `${90 + i * 35}ms` }}
                >
                  <span className="grid size-10 place-items-center rounded-[9px] bg-[var(--fill)] text-foreground">
                    <Icon name={item.icon} size={18} />
                  </span>
                  <p className="mt-1 text-[13px] font-medium leading-[1.35]">{item.title}</p>
                  <p className="text-[12px] leading-[1.5] text-muted-foreground">{item.text}</p>
                </div>
              ))}
            </div>

            <div className="mt-7 grid gap-x-8 gap-y-6 sm:grid-cols-2">
              {GROUPS.map((group, gi) => (
                <section
                  key={group.title}
                  className={group.title === "Новое" ? "sm:col-span-2" : undefined}
                >
                  <div
                    className="release-in flex items-center gap-2.5"
                    style={{ animationDelay: `${210 + gi * 40}ms` }}
                  >
                    <span
                      className={
                        group.tone === "success"
                          ? "grid size-6 place-items-center rounded-[7px] bg-[color-mix(in_srgb,var(--success)_12%,transparent)] text-[var(--success)]"
                          : "grid size-6 place-items-center rounded-[7px] bg-[var(--accent)] text-[var(--accent-foreground)]"
                      }
                    >
                      <Icon name={group.icon} size={14} />
                    </span>
                    <h3 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                      {group.title}
                    </h3>
                  </div>

                  <ul className="mt-3 flex flex-col gap-2.5 pl-0.5">
                    {group.items.map((item, ii) => (
                      <li
                        key={item.lead}
                        className="release-in flex gap-3 text-[13px] leading-[1.55]"
                        style={{ animationDelay: `${235 + gi * 40 + ii * 25}ms` }}
                      >
                        <span className="mt-[9px] size-1 shrink-0 rounded-full bg-[var(--border)]" />
                        <span className="text-muted-foreground">
                          <span className="font-medium text-foreground">{item.lead}</span> {item.text}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </div>

          <div className="flex shrink-0 items-center justify-between gap-4 border-t border-[var(--separator)] bg-[var(--surface-muted)] px-8 py-4">
            <span className="text-[11px] text-muted-foreground">
              Сделано <span className="font-medium text-foreground">Monolith Studios</span>
            </span>
            <Button onClick={() => onOpenChange(false)}>Понятно</Button>
          </div>

          <DialogPrimitive.Close
            className="absolute right-4 top-4 grid size-8 place-items-center rounded-[7px] text-muted-foreground transition-colors hover:bg-[var(--fill)] hover:text-foreground"
            aria-label="Закрыть"
          >
            <CloseGlyph size={16} />
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
