import { copyFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..", "..");
const src = path.join(root, "src-tauri", "target", "release", "control-elevate.exe");

if (!existsSync(src)) {
  console.error("control-elevate.exe not found — run `cargo build --release --bins` first");
  process.exit(1);
}

const version = execSync("rustc -vV", { encoding: "utf8" });
const triple = /host:\s*(\S+)/.exec(version)?.[1];

if (!triple) {
  console.error("cannot resolve the rustc target triple");
  process.exit(1);
}

const dest = path.join(root, "src-tauri", `control-elevate-${triple}.exe`);
copyFileSync(src, dest);
console.log(`copied ${path.relative(root, dest)}`);
