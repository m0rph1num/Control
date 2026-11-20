import * as React from "react"
import { cn } from "cn"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "flex h-9 w-full min-w-0 rounded-[8px] border border-[var(--input)] bg-[var(--card)] px-3 py-1 text-[13px] outline-none transition-[border-color,box-shadow] file:inline-flex file:h-5 file:border-0 file:bg-transparent file:text-[12px] file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-[var(--ring)] focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-[var(--ring)]/25 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive",
        className,
      )}
      {...props}
    />
  )
}

export { Input }
