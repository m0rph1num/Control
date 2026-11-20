import * as React from "react"
import { cn } from "cn"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-24 w-full rounded-[8px] border border-[var(--input)] bg-[var(--card)] px-2.5 py-2 text-[13px] leading-relaxed outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground focus-visible:border-[var(--ring)] focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-[var(--ring)]/25 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive",
        className,
      )}
      {...props}
    />
  )
}

export { Textarea }
