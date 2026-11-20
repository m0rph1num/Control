export function plural(count: number, forms: [string, string, string]): string {
  const tens = count % 100;
  const units = count % 10;
  if (tens >= 11 && tens <= 14) return `${count} ${forms[2]}`;
  if (units === 1) return `${count} ${forms[0]}`;
  if (units >= 2 && units <= 4) return `${count} ${forms[1]}`;
  return `${count} ${forms[2]}`;
}