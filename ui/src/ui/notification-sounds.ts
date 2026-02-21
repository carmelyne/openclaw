type SoundKind = "start" | "end";

type SoundConfig = {
  key: string;
  fallbackPaths: string[];
  volume: number;
};

const SOUND_CONFIG: Record<SoundKind, SoundConfig> = {
  start: {
    key: "openclaw.sound.startUrl",
    fallbackPaths: [
      "/workspace/audio/start.wav",
      "/workspace/audio/start.mp3",
      "/workspace/audio/notify-start.wav",
      "/workspace/audio/notify-start.mp3",
      "/workspace/notify-start.wav",
      "/workspace/notify-start.mp3",
      "/audio/start.wav",
      "/audio/start.mp3",
    ],
    volume: 0.55,
  },
  end: {
    key: "openclaw.sound.endUrl",
    fallbackPaths: [
      "/workspace/audio/end.wav",
      "/workspace/audio/end.mp3",
      "/workspace/audio/notify-end.wav",
      "/workspace/audio/notify-end.mp3",
      "/workspace/notify-end.wav",
      "/workspace/notify-end.mp3",
      "/audio/end.wav",
      "/audio/end.mp3",
    ],
    volume: 0.55,
  },
};

type SoundState = {
  audio: HTMLAudioElement;
  candidates: string[];
  index: number;
};

const audioCache = new Map<SoundKind, SoundState>();
const warnedMissing = new Set<SoundKind>();

function normalizeBasePath(basePath: string): string {
  if (!basePath) {
    return "";
  }
  let base = basePath.trim();
  if (!base.startsWith("/")) {
    base = `/${base}`;
  }
  if (base === "/") {
    return "";
  }
  if (base.endsWith("/")) {
    base = base.slice(0, -1);
  }
  return base;
}

function resolveControlUiBasePath(): string {
  try {
    const raw = (
      window as unknown as {
        __OPENCLAW_CONTROL_UI_BASE_PATH__?: string;
      }
    ).__OPENCLAW_CONTROL_UI_BASE_PATH__;
    return normalizeBasePath(typeof raw === "string" ? raw : "");
  } catch {
    return "";
  }
}

function withBasePath(pathname: string): string {
  if (!pathname.startsWith("/")) {
    return pathname;
  }
  const basePath = resolveControlUiBasePath();
  if (!basePath || pathname.startsWith(`${basePath}/`) || pathname === basePath) {
    return pathname;
  }
  return `${basePath}${pathname}`;
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

export function resolveSoundCandidates(kind: SoundKind): string[] {
  const candidates: string[] = [];
  try {
    const custom = window.localStorage.getItem(SOUND_CONFIG[kind].key)?.trim();
    if (custom) {
      candidates.push(custom);
    }
  } catch {
    // localStorage may be unavailable in strict browser contexts.
  }
  for (const path of SOUND_CONFIG[kind].fallbackPaths) {
    const resolvedPath = withBasePath(path);
    if (!resolvedPath || candidates.includes(resolvedPath)) {
      continue;
    }
    candidates.push(resolvedPath);
  }
  return candidates;
}

function getSoundState(kind: SoundKind): SoundState {
  const candidates = resolveSoundCandidates(kind);
  const existing = audioCache.get(kind);
  if (existing && arraysEqual(existing.candidates, candidates)) {
    return existing;
  }
  const audio = existing?.audio ?? new Audio(candidates[0] ?? "");
  audio.preload = "auto";
  audio.volume = SOUND_CONFIG[kind].volume;
  const next: SoundState = {
    audio,
    candidates,
    index: 0,
  };
  if (candidates[0]) {
    next.audio.src = candidates[0];
  }
  audioCache.set(kind, next);
  return next;
}

function tryFallback(state: SoundState): boolean {
  if (state.index + 1 >= state.candidates.length) {
    return false;
  }
  state.index += 1;
  state.audio.src = state.candidates[state.index] ?? state.audio.src;
  return true;
}

export async function playNotificationSound(kind: SoundKind): Promise<void> {
  const state = getSoundState(kind);
  if (state.candidates.length === 0) {
    return;
  }
  // Always restart from the highest-priority candidate.
  state.index = 0;
  state.audio.src = state.candidates[0] ?? state.audio.src;
  try {
    state.audio.currentTime = 0;
    await state.audio.play();
    return;
  } catch {
    while (tryFallback(state)) {
      try {
        state.audio.currentTime = 0;
        await state.audio.play();
        return;
      } catch {
        // Keep behavior silent after fallback failure.
      }
    }
    if (!warnedMissing.has(kind)) {
      warnedMissing.add(kind);
      console.warn(
        `[chat-sound] ${kind} sound unavailable. Set localStorage key "${SOUND_CONFIG[kind].key}" to a valid URL.`,
      );
    }
  }
}

export function isChatWindowFocused(): boolean {
  if (typeof document === "undefined") {
    return true;
  }
  const isVisible = document.visibilityState === "visible";
  const hasFocus = typeof document.hasFocus === "function" ? document.hasFocus() : true;
  return isVisible && hasFocus;
}
