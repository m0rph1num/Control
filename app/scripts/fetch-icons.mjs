import { writeFileSync } from "node:fs";

const SOURCE = "https://cdn.jsdelivr.net/npm/@iconify-json/solar@1/icons.json";

const names = [
  "shield-check", "shield-warning", "play-circle", "stop-circle",
  "settings-minimalistic", "widget-4", "filter", "box-minimalistic",
  "database", "pulse", "add-circle", "trash-bin-trash",
  "download-minimalistic", "refresh", "check-circle", "close-circle",
  "bolt-circle", "cpu-bolt", "moon-stars", "archive",
  "alt-arrow-down", "alt-arrow-up", "alt-arrow-left", "alt-arrow-right",
  "rounded-magnifer", "check", "sun", "monitor", "info-circle", "danger-triangle",
  "folder-open", "document-text", "upload-minimalistic", "arrow-left-down",
  "close-square",
];

const variants = ["bold", "bold-duotone"];

const response = await fetch(SOURCE);
if (!response.ok) {
  throw new Error(`cannot load the Solar icon set: HTTP ${response.status}`);
}

const { icons } = await response.json();
const entries = [];

for (const name of names) {
  for (const variant of variants) {
    const key = `${name}-${variant}`;
    const icon = icons[key];
    if (icon) entries.push([key, icon.body]);
    else console.error(`NOT FOUND: solar/${key}`);
  }
}

let out = `export const ICONS: Record<string, string> = {\n`;
for (const [name, body] of entries) {
  out += `  "${name}": ${JSON.stringify(body)},\n`;
}
out += `};\n`;

writeFileSync(new URL("../src/shared/ui/icons.tsx", import.meta.url), out);
console.log(`wrote ${entries.length} icons`);