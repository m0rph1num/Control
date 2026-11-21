import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { demoApi, demoListen, isDemoRuntime } from "./demo";

export type ProtectionState =
  | "unknown"
  | "stopped"
  | "starting"
  | "active"
  | "stopping"
  | "external_instance"
  | "error";

export interface ProtectionSnapshot {
  state: ProtectionState;
  pid?: number;
  detail: string;
  revision: number;
}

export type OperationStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export interface OperationSnapshot {
  id: string;
  kind: string;
  status: OperationStatus;
  message: string;
  revision: number;
  progress?: { current?: number; total?: number; message?: string };
  error?: { code: string; userMessage: string; details?: unknown };
  cancelable: boolean;
}

export interface ServiceStatus {
  installed: boolean;
  running: boolean;
}

export interface StrategyInfo {
  value: string;
  filename: string;
  label: string;
  path: string;

  kind: string;
}

export interface AppInfo {
  name: string;
  version: string;
}

export interface StartupFlags {
  minimized: boolean;
}

export const isDemo = isDemoRuntime;
export const api = isDemoRuntime()
  ? demoApi
  : {
  getAppInfo: () => invoke<AppInfo>("app_info"),
  startupFlags: () => invoke<StartupFlags>("startup_flags"),
  protectionStatus: () => invoke<ProtectionSnapshot>("protection_status"),
  protectionSnapshot: () => invoke<ProtectionSnapshot>("protection_snapshot"),
  protectionStart: (strategyValue: string) =>
    invoke<string>("protection_start", { strategyValue }),

  protectionApply: (strategyValue: string) =>
    invoke<boolean>("protection_apply", { strategyValue }),
  protectionStop: () => invoke<string>("protection_stop"),
  operationsList: () => invoke<OperationSnapshot[]>("operations_list"),
  operationsCancel: (operationId: string) =>
    invoke<boolean>("operations_cancel", { operationId }),
  serviceStatus: () => invoke<ServiceStatus>("service_status"),
  windivertStatus: () => invoke<ServiceStatus>("windivert_status"),
  strategiesList: () => invoke<StrategyInfo[]>("strategies_list"),
  settingsGet: () => invoke<Record<string, unknown>>("settings_get"),
  settingsSet: (value: Record<string, unknown>) =>
    invoke<void>("settings_set", { value }),

  settingsUpdate: (options: Record<string, unknown>) =>
    invoke<void>("settings_update", { options }),
  flowsealConfigGet: () => invoke<Record<string, unknown>>("flowseal_config_get"),
  flowsealConfigSet: (value: Record<string, unknown>) =>
    invoke<void>("flowseal_config_set", { value }),

  listsGet: () => invoke<UserList[]>("lists_get"),
  listsWrite: (key: string, content: string) =>
    invoke<void>("lists_write", { key, content }),
  gameFilterGet: () => invoke<"disabled" | "all" | "tcp" | "udp">("game_filter_get"),
  gameFilterSet: (mode: "disabled" | "all" | "tcp" | "udp") =>
    invoke<void>("game_filter_set", { mode }),
  ipsetFilterGet: () => invoke<"loaded" | "any" | "none">("ipset_filter_get"),
  ipsetFilterSet: (mode: "loaded" | "any" | "none") =>
    invoke<void>("ipset_filter_set", { mode }),
  fakesGet: () => invoke<FakesInfo>("fakes_get"),
  fakesSet: (fakeType: "discord" | "game", fakeName: string) =>
    invoke<void>("fakes_set", { fakeType, fakeName }),

  backupBuild: () => invoke<Record<string, unknown>>("backup_build"),
  backupExportFile: (path: string, bundle: Record<string, unknown>) =>
    invoke<void>("backup_export_file", { path, bundle }),
  backupImportFile: (path: string) => invoke<void>("backup_import_file", { path }),

  versionsList: () => invoke<InstalledVersion[]>("versions_list"),
  versionsAvailable: () => invoke<ReleaseInfo[]>("versions_available"),
  versionsDownload: (version: string, assetUrl: string, assetName: string) =>
    invoke<{ operationId: string; archivePath: string }>("versions_download", { version, assetUrl, assetName }),
  versionsInstall: (version: string, tempArchive: string) =>
    invoke<InstalledVersion>("versions_install", { version, tempArchive }),
  versionsDelete: (folder: string) => invoke<void>("versions_delete", { folder }),

  versionsSelect: (folder: string) => invoke<boolean>("versions_select", { folder }),
  versionsOpenFolder: (folder: string) => invoke<void>("versions_open_folder", { folder }),

  serviceInstallPlan: () => invoke<ElevationPlan>("service_install_plan"),
  serviceInstall: () => invoke<{ installed: boolean; running: boolean }>("service_install"),
  serviceRemove: () => invoke<{ installed: boolean; running: boolean }>("service_remove"),

  setupRunChecks: () => invoke<EnvironmentChecks>("setup_run_checks"),
  setupDefaultDir: () => invoke<string>("setup_default_dir"),
  setupApply: (options: Record<string, unknown>) =>
    invoke<void>("setup_apply", { options }),
  controlSelectVersion: (versionFolder: string) =>
    invoke<void>("control_select_version", { versionFolder }),

  presetsList: () => invoke<PresetInfo[]>("presets_list"),
  presetSave: (name: string, content: string) =>
    invoke<void>("preset_save", { name, content }),
  presetDelete: (name: string) => invoke<void>("preset_delete", { name }),

  profilesList: () => invoke<Profile[]>("profiles_list"),
  profileSave: (profile: Profile) => invoke<Profile>("profile_save", { profile }),
  profileDelete: (id: string) => invoke<void>("profile_delete", { id }),
  profileApply: (id: string) => invoke<AppliedProfile>("profile_apply", { id }),
  profileExportText: (id: string) => invoke<string>("profile_export_text", { id }),
  profileExportFile: (path: string, id: string) => invoke<void>("profile_export_file", { path, id }),
  profileImportText: (text: string) => invoke<Profile>("profile_import_text", { text }),
  profilesOpenFolder: () => invoke<void>("profiles_open_folder"),

  diagnosticsRun: () => invoke<DiagnosticsReport>("diagnostics_run"),

  tgwsStatus: () => invoke<TgwsStatus>("tgws_status"),
  tgwsInstall: () => invoke<TgwsInstallResult>("tgws_install"),
  tgwsStart: () => invoke<TgwsStatus>("tgws_start"),
  tgwsStop: () => invoke<TgwsStatus>("tgws_stop"),
  tgwsUninstall: () => invoke<TgwsStatus>("tgws_uninstall"),
  tgwsSetPort: (port: number) => invoke<TgwsStatus>("tgws_set_port", { port }),
  tgwsOpenTelegram: () => invoke<void>("tgws_open_telegram"),
  tgwsLogs: (lines?: number) => invoke<string[]>("tgws_logs", { lines }),

  autostartGet: () => invoke<boolean>("autostart_get"),
  autostartInfo: () => invoke<AutostartInfo>("autostart_info"),
  autostartSet: (enabled: boolean) => invoke<boolean>("autostart_set", { enabled }),

  advisorScan: () => invoke<AdvisorReport>("advisor_scan"),
  advisorSaved: () => invoke<AdvisorReport | null>("advisor_saved"),
  advisorApply: (strategyValue: string) =>
    invoke<AdvisorApplyResult>("advisor_apply", { strategyValue }),

  updateCheck: () => invoke<UpdateInfo>("update_check"),
  updateDownload: (version: string, assetUrl: string) =>
    invoke<string>("update_download", { version, assetUrl }),
  updateInstall: (installerPath: string) => invoke<void>("update_install", { installerPath }),
};

export interface UserList {
  key: string;
  filename: string;
  label: string;
  content: string;
  exists: boolean;
}

export interface FakesInfo {
  fakes: string[];
  currentDiscord: string | null;
  currentGame: string | null;
}

export interface InstalledVersion {
  folder: string;
  version: string;
  selected: boolean;
  hasWinws: boolean;
}

export interface ReleaseInfo {
  version: string;
  assetName: string | null;
  assetUrl: string | null;
  notes: string | null;
}

export interface ElevationStepInfo {
  action: string;
  [key: string]: unknown;
}

export interface ElevationPlan {
  planVersion: number;
  description: string;
  steps: ElevationStepInfo[];
}

export interface EnvironmentChecks {
  admin: boolean;
  winDivertInstalled: boolean;
  internet: boolean;
  dns: boolean;
  existingRunning: boolean;
  existingInstallPath: string | null;
  defaultDir: string | null;
}

export interface PresetInfo {
  name: string;
  filename: string;
  content: string;
}

export type GameFilterMode = "disabled" | "all" | "tcp" | "udp";
export type IpsetMode = "loaded" | "any" | "none";

export interface ProfileFakes {
  discord: string | null;
  game: string | null;
}

export interface Profile {
  id: string;
  name: string;
  description: string;

  strategy: string;
  gameFilter: GameFilterMode;
  ipset: IpsetMode;
  fakes: ProfileFakes;

  lists: Record<string, string>;
  createdAt: string;
  updatedAt: string;

  source: string;
}

export interface AppliedProfile {
  strategy: string;
  liveApplied: boolean;
}

export interface LatencyProbe {
  id: string;
  label: string;
  host: string;
  ok: boolean;
  ms: number | null;
  avgMs: number | null;
  jitterMs: number | null;
  lossPercent: number;
  method: string;
  tlsOk: boolean;
  tlsMs: number | null;
}

export interface NetworkProfile {
  dnsOk: boolean;
  dnsMs: number | null;
  mtu: number | null;
  dnsServers: string[];
  gateway: string | null;
  localIp: string | null;
  provider: string | null;
  asn: string | null;
  city: string | null;
  country: string | null;
  publicIp: string | null;
  downloadMbps: number | null;
  latency: LatencyProbe[];
  avgLatencyMs: number | null;
  jitterMs: number | null;
  lossPercent: number | null;
  reachable: number;
  tlsReachable: number;
  total: number;
}

export interface DetectedApp {
  id: string;
  name: string;
  kind: string;
  source: string;
  running: boolean;
}

export interface AdvisorCandidate {
  value: string;
  label: string;
  kind: string;
  score: number;
  reasons: string[];
  tags: string[];
}

export interface AdvisorReport {
  scannedAt: string;
  durationMs: number;
  network: NetworkProfile;
  apps: DetectedApp[];
  candidates: AdvisorCandidate[];
  recommended: string | null;
  summary: string;
  profile: Profile;
}

export interface AdvisorStep {
  id: string;
  status: "running" | "ok";
}

export interface AdvisorApplyResult {
  strategy: string;
  started: boolean;
  liveApplied: boolean;
}

export interface UpdateInfo {
  available: boolean;
  currentVersion: string;
  version: string;
  notes: string | null;
  publishedAt: string | null;
  assetName: string | null;
  assetUrl: string | null;
  size: number | null;
  pageUrl: string;
}

export interface UpdateProgress {
  downloaded: number;
  total: number;
}

export type CheckStatus = "pending" | "running" | "ok" | "warning" | "error";

export interface DiagnosticCheck {
  id: string;
  group: string;
  title: string;
  status: CheckStatus;
  detail: string;
  hint?: string;
  durationMs: number;
}

export interface DiagnosticsReport {
  checks: DiagnosticCheck[];
  ok: number;
  warnings: number;
  errors: number;
  generatedAt: string;
  durationMs: number;
  context: DiagnosticsContext;
  markdown: string;
}

export interface DiagnosticsContext {
  appVersion: string;
  os: string;
  arch: string;
  admin: boolean;
  dataDir: string | null;
  settingsFile: string | null;
  controlDir: string | null;
  installDir: string | null;
  strategies: number;
  serviceInstalled: boolean;
  serviceRunning: boolean;
  windivertInstalled: boolean;
  windivertRunning: boolean;
  tgwsInstalled: boolean;
  tgwsRunning: boolean;
  tgwsPort: number;
  autostartControl: boolean;
  autostartZapret: boolean;
  logPath: string | null;
  logTail: string[];
}

export interface AutostartInfo {
  enabled: boolean;
  current: boolean;
  command: string | null;
}

export interface TgwsStatus {
  installed: boolean;
  running: boolean;
  pid?: number;
  host: string;
  port: number;
  secret?: string;
  link?: string;
  configExists: boolean;
  exePath?: string;
  autostart: boolean;
}

export interface TgwsInstallResult {
  version: string;
  path: string;
  size: number;
}

export async function onProtectionState(
  handler: (snapshot: ProtectionSnapshot) => void,
): Promise<() => void> {
  if (isDemoRuntime()) {
    return demoListen<ProtectionSnapshot>("protection://state", handler);
  }
  const unlisten = await listen<ProtectionSnapshot>("protection://state", (e) =>
    handler(e.payload),
  );
  return unlisten;
}

export function onDiagnosticsCheck(
  handler: (check: DiagnosticCheck) => void,
): Promise<() => void> {
  if (isDemoRuntime()) {
    return demoListen<DiagnosticCheck>("diagnostics://check", handler);
  }
  return listen<DiagnosticCheck>("diagnostics://check", (e) => handler(e.payload));
}

export function onEvent<T>(
  event: string,
  handler: (payload: T) => void,
): Promise<() => void> {
  if (isDemoRuntime()) {
    return demoListen<T>(event, handler);
  }
  return listen<T>(event, (e) => handler(e.payload));
}

export function onAdvisorStep(handler: (step: AdvisorStep) => void): Promise<() => void> {
  return onEvent<AdvisorStep>("advisor://step", handler);
}

export function onUpdateProgress(handler: (progress: UpdateProgress) => void): Promise<() => void> {
  return onEvent<UpdateProgress>("update://progress", handler);
}
