import * as React from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { cn } from "cn";
import { CloseGlyph } from "@/shared/ui/CloseGlyph";

type ModalSize = "sm" | "md" | "lg";

const WIDTH: Record<ModalSize, string> = {
  sm: "sm:max-w-[400px]",
  md: "sm:max-w-[520px]",
  lg: "sm:max-w-[660px]",
};

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  footer,
  size = "md",
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  footer?: React.ReactNode;
  size?: ModalSize;
  children?: React.ReactNode;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[70] bg-black/35 duration-150 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className={cn(
            "material fixed left-1/2 top-1/2 z-[80] grid w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 overflow-hidden rounded-[10px] p-5 outline-none",
            "max-h-[calc(100vh-4rem)] duration-150 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
            WIDTH[size],
          )}
        >
          <div className="flex items-start gap-3 pr-8">
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="text-heading">
                {title}
              </DialogPrimitive.Title>
              {description && (
                <DialogPrimitive.Description className="text-lede mt-1.5 text-muted-foreground">
                  {description}
                </DialogPrimitive.Description>
              )}
            </div>
          </div>

          <DialogPrimitive.Close
            className="absolute right-3.5 top-3.5 grid size-7 place-items-center rounded-[6px] text-muted-foreground transition-colors hover:bg-[var(--fill)] hover:text-foreground"
            aria-label="Закрыть"
          >
            <CloseGlyph size={14} />
          </DialogPrimitive.Close>

          {children && (
            <div className="min-h-0 overflow-y-auto overscroll-contain">{children}</div>
          )}

          {footer && <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">{footer}</div>}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
