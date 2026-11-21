export function pluralWord(count: number, forms: [string, string, string]): string {
  const tens = count % 100;
  const units = count % 10;
  if (tens >= 11 && tens <= 14) return forms[2];
  if (units === 1) return forms[0];
  if (units >= 2 && units <= 4) return forms[1];
  return forms[2];
}

export function plural(count: number, forms: [string, string, string]): string {
  return `${count} ${pluralWord(count, forms)}`;
}
