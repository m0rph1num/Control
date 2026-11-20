import { ICONS } from "./icons";

export type IconName = keyof typeof ICONS | (string & {});

export function Icon({
  name,
  size = 20,
  className,
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  const body = ICONS[name as string];
  if (!body) return null;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      aria-hidden

      dangerouslySetInnerHTML={{ __html: body }}
    />
  );
}
