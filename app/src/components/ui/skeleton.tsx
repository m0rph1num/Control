import { cn } from "cn"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("rounded-[6px] bg-[var(--fill)]", className)}
      {...props}
    />
  )
}

export { Skeleton }
