export type SoundKind =
  | "tap"
  | "toggle"
  | "open"
  | "close"
  | "success"
  | "warning"
  | "error"
  | "launch"
  | "proxy"
  | "stop";

const STORAGE_KEY = "control.sounds";
const SOURCES: Record<SoundKind, string> = {
  tap: "/sounds/tap.ogg",
  toggle: "/sounds/toggle.ogg",
  open: "/sounds/open.ogg",
  close: "/sounds/close.ogg",
  success: "/sounds/success.ogg",
  warning: "/sounds/warning.ogg",
  error: "/sounds/error.ogg",
  launch: "/sounds/launch.ogg",
  proxy: "/sounds/proxy.ogg",
  stop: "/sounds/stop.ogg",
};

const MIN_GAP: Record<SoundKind, number> = {
  tap: 45,
  toggle: 90,
  open: 120,
  close: 120,
  success: 200,
  warning: 200,
  error: 200,
  launch: 300,
  proxy: 300,
  stop: 200,
};

let context: AudioContext | null = null;
let master: GainNode | null = null;
let enabled: boolean | null = null;
const buffers = new Map<SoundKind, AudioBuffer>();
const pending = new Map<SoundKind, Promise<AudioBuffer | null>>();
const lastPlayed = new Map<SoundKind, number>();

function readEnabled(): boolean {
  if (enabled !== null) return enabled;
  try {
    enabled = window.localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    enabled = true;
  }
  return enabled;
}

export function soundsEnabled(): boolean {
  return readEnabled();
}

export function setSoundsEnabled(value: boolean): void {
  enabled = value;
  try {
    window.localStorage.setItem(STORAGE_KEY, value ? "on" : "off");
  } catch {
    return;
  }
}

function audio(): AudioContext | null {
  if (!readEnabled()) return null;
  try {
    if (!context) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      context = new Ctor();
      master = context.createGain();
      master.gain.value = 0.85;
      master.connect(context.destination);
    }
    if (context.state === "suspended") void context.resume();
    return context;
  } catch {
    return null;
  }
}

function load(kind: SoundKind): Promise<AudioBuffer | null> {
  const cached = buffers.get(kind);
  if (cached) return Promise.resolve(cached);
  const inflight = pending.get(kind);
  if (inflight) return inflight;

  const ctx = audio();
  if (!ctx) return Promise.resolve(null);

  const job = fetch(SOURCES[kind])
    .then((response) => {
      if (!response.ok) throw new Error("sound fetch failed");
      return response.arrayBuffer();
    })
    .then((data) => ctx.decodeAudioData(data))
    .then((buffer) => {
      buffers.set(kind, buffer);
      return buffer;
    })
    .catch(() => null)
    .finally(() => {
      pending.delete(kind);
    });

  pending.set(kind, job);
  return job;
}

export function warmUpSound(): void {
  const ctx = audio();
  if (!ctx) return;
  for (const kind of Object.keys(SOURCES) as SoundKind[]) void load(kind);
}

export function playSound(kind: SoundKind): void {
  if (!readEnabled()) return;
  const now = performance.now();
  if (now - (lastPlayed.get(kind) ?? 0) < MIN_GAP[kind]) return;
  lastPlayed.set(kind, now);

  const ctx = audio();
  if (!ctx || !master) return;

  const cached = buffers.get(kind);
  if (cached) {
    const source = ctx.createBufferSource();
    source.buffer = cached;
    source.connect(master);
    source.start();
    return;
  }

  void load(kind).then((buffer) => {
    if (!buffer || !context || !master) return;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(master);
    source.start();
  });
}
