const OUTER =
  "M114 44H128C151 44 152 79 171 85C190 91 212 91 212 114V128C212 151 177 152 171 171C165 190 165 212 142 212H128C105 212 104 177 85 171C66 165 44 165 44 142V128C44 105 79 104 85 85C91 66 91 44 114 44Z";

const CORE = "M128 102L102 128L128 154L154 128Z";

export const MARK_OUTLINE = OUTER;
export const MARK_SOLID = `${OUTER}${CORE}`;

export function BrandMark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg
      viewBox="0 0 256 256"
      className={className}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
    >
      {title ? <title>{title}</title> : null}
      <path d={MARK_SOLID} fill="currentColor" fillRule="evenodd" />
    </svg>
  );
}
