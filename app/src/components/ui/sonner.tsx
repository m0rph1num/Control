import { Toaster as Sonner, type ToasterProps } from "sonner";
import { Icon } from "@/shared/ui/Icon";
import { useDesign } from "@/shared/theme";

function glyph(tone: "success" | "info" | "warning" | "error", name: Parameters<typeof Icon>[0]["name"]) {
  return (
    <span className="toast-glyph" data-tone={tone}>
      <Icon name={name} size={15} />
    </span>
  );
}

const Toaster = ({ ...props }: ToasterProps) => {
  const { resolvedTheme } = useDesign();

  return (
    <Sonner
      theme={resolvedTheme}
      className="toaster group"
      closeButton
      gap={10}
      offset={20}
      visibleToasts={4}
      duration={4200}
      icons={{
        success: glyph("success", "check-circle-bold"),
        info: glyph("info", "info-circle-bold"),
        warning: glyph("warning", "danger-triangle-bold"),
        error: glyph("error", "close-circle-bold"),
        loading: (
          <span className="toast-glyph" data-tone="loading">
            <span className="size-3.5 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />
          </span>
        ),
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--separator)",
          "--border-radius": "12px",
          "--width": "372px",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
          title: "cn-toast-title",
          description: "cn-toast-description",
          icon: "cn-toast-icon",
          closeButton: "cn-toast-close",
          actionButton: "cn-toast-action",
          cancelButton: "cn-toast-cancel",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
