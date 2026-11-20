import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Slot } from "radix-ui"

const buttonVariants = cva(
  "group/button pressable inline-flex shrink-0 items-center justify-center rounded-[8px] border border-transparent bg-clip-padding text-[12px] font-medium whitespace-nowrap outline-none select-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ring)] disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/88",
        outline:
          "border-[var(--border)] bg-[var(--card)] text-foreground hover:bg-[var(--fill)]",
        secondary:
          "bg-[var(--fill)] text-foreground hover:bg-[var(--fill-strong)]",
        ghost:
          "text-muted-foreground hover:bg-[var(--fill)] hover:text-foreground",
        destructive:
          "border-destructive/25 bg-destructive/8 text-destructive hover:bg-destructive/12",
        link: "text-[color:var(--accent-foreground)] underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 gap-2 px-3.5 text-[13px]",
        xs: "h-7 gap-1.5 rounded-[6px] px-2.5 text-[11px] [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 rounded-[7px] px-3 text-[12px] [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-10 gap-2 px-5 text-[13px]",
        icon: "size-9 rounded-[8px]",
        "icon-xs": "size-8 rounded-[7px] [&_svg:not([class*='size-'])]:size-3.5",
        "icon-sm": "size-8 rounded-[7px]",
        "icon-lg": "size-10 rounded-[9px]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
