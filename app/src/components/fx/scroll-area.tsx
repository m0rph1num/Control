import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "cn";

export function ScrollArea({
  children,
  className,
  contentClassName,
}: {
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ top: false, bottom: false });

  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const measure = () => {
      setEdges({
        top: el.scrollTop > 6,
        bottom: el.scrollTop + el.clientHeight < el.scrollHeight - 12,
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => observer.disconnect();
  }, []);

  return (
    <div className={cn("relative min-h-0 flex-1", className)}>
      <div
        ref={viewport}
        onScroll={(event) => {
          const el = event.currentTarget;
          setEdges({
            top: el.scrollTop > 6,
            bottom: el.scrollTop + el.clientHeight < el.scrollHeight - 12,
          });
        }}
        className={cn("h-full overflow-y-auto overscroll-contain", contentClassName)}
      >
        {children}
      </div>
      <div
        aria-hidden
        className="edge-refraction edge-refraction--top"
        style={{ opacity: edges.top ? 1 : 0, transition: "opacity .28s ease" }}
      />
      <div
        aria-hidden
        className="edge-refraction edge-refraction--bottom"
        style={{ opacity: edges.bottom ? 1 : 0, transition: "opacity .28s ease" }}
      />
    </div>
  );
}
