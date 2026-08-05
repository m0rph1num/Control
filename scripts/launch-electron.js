// ═══════════════════════════════════════════════════════════════════════════════
// Control — Electron launcher
// ═══════════════════════════════════════════════════════════════════════════════
// Some machines have ELECTRON_RUN_AS_NODE set system-wide (Windows user/system
// environment variables). When that variable is present — even as an empty
// string — the `electron` binary starts as a plain Node process instead of the
// Electron app, so require('electron') returns a file path and `app` is undefined.
//
// cross-env's `VAR=` (empty assignment) can't fix this: Electron only checks for
// the variable's existence. So we explicitly delete it here, then hand off to
// electron/cli.js, which spawns the real Electron binary with process.argv.slice(2).
//
// Usage:  node scripts/launch-electron.js [electron args...] [app args...]

delete process.env.ELECTRON_RUN_AS_NODE;
require('electron/cli.js');
