import { cn } from "cn";
import { Icon, type IconName } from "@/shared/ui/Icon";

export function Page({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("flex flex-col gap-7", className)}>{children}</div>;
}

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string | undefined;
  action?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
      <div className="min-w-[14rem] flex-1">
        <h1 className="text-title">{title}</h1>
        {subtitle && (
          <p className="text-lede mt-2 max-w-[46rem] text-muted-foreground">{subtitle}</p>
        )}
      </div>
      {action && <div className="shrink-0 pt-0.5">{action}</div>}
    </header>
  );
}

export function SectionCard({
  title,
  action,
  className,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("flex flex-col gap-2.5", className)}>
      <div className="flex min-h-5 items-center justify-between gap-3">
        <h2 className="text-section">{title}</h2>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      <div className="material flex flex-col gap-1.5 rounded-[10px] px-[18px] py-4">{children}</div>
    </section>
  );
}

export function ListRow({
  title,
  subtitle,
  trailing,
  onClick,
  selected,
  className,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  trailing?: React.ReactNode;
  onClick?: () => void;
  selected?: boolean;
  className?: string;
}) {
  const body = (
    <>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium leading-[1.4]">{title}</span>
        {subtitle && (
          <span className="text-caption mt-1 block truncate text-muted-foreground">
            {subtitle}
          </span>
        )}
      </span>
      {trailing && <span className="flex shrink-0 items-center gap-2">{trailing}</span>}
    </>
  );

  const classes = cn("row w-full text-left", onClick && "cursor-pointer", className);

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        data-selected={selected ? "true" : undefined}
        className={classes}
      >
        {body}
      </button>
    );
  }

  return (
    <div data-selected={selected ? "true" : undefined} className={classes}>
      {body}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon: IconName;
  title: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2.5 rounded-[8px] border border-dashed border-[var(--surface-stroke)] px-5 py-8 text-center">
      <Icon name={icon} size={18} className="text-muted-foreground" />
      <p className="text-[13px] font-medium">{title}</p>
      {hint && <p className="text-caption max-w-[26rem] text-muted-foreground">{hint}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className,
}: {
  value: T | null;
  options: { value: T; label: string; icon?: React.ReactNode }[];
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div className={cn("segmented", className)} role="radiogroup">
      {options.map((option) => {
        const active = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            data-active={active}
            className="segmented-item relative flex-1"
          >
            {active && <span className="segmented-thumb" />}
            <span className="relative z-10 flex min-w-0 items-center gap-1.5">
              {option.icon}
              <span className="truncate">{option.label}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function FieldLabel({
  children,
  hint,
}: {
  children: React.ReactNode;
  hint?: string | undefined;
}) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-3">
      <span className="min-w-0 truncate text-[13px] font-medium text-foreground">{children}</span>
      {hint && (
        <span className="shrink-0 whitespace-nowrap text-[11px] text-muted-foreground">{hint}</span>
      )}
    </div>
  );
}
