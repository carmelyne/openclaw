type SoundKind = "start" | "end";

type SoundConfig = {
  key: string;
  fallbackPaths: string[];
  volume: number;
};

const SOUND_CONFIG: Record<SoundKind, SoundConfig> = {
  start: {
    key: "openclaw.sound.startUrl",
    fallbackPaths: ["/workspace/audio/start.wav", "/audio/start.wav"],
    volume: 0.55,
  },
  end: {
    key: "openclaw.sound.endUrl",
    fallbackPaths: ["/workspace/audio/end.wav", "/audio/end.wav"],
    volume: 0.55,
  },
};

const audioCache = new Map<SoundKind, HTMLAudioElement>();
const warnedMissing = new Set<SoundKind>();

function resolveSoundUrl(kind: SoundKind): string {
  try {
    const custom = window.localStorage.getItem(SOUND_CONFIG[kind].key)?.trim();
    if (custom) {
      return custom;
    }
  } catch {
    // localStorage may be unavailable in strict browser contexts.
  }
  return SOUND_CONFIG[kind].fallbackPaths[0];
}

function buildAudio(kind: SoundKind): HTMLAudioElement {
  const audio = new Audio(resolveSoundUrl(kind));
  audio.preload = "auto";
  audio.volume = SOUND_CONFIG[kind].volume;
  return audio;
}

function getAudio(kind: SoundKind): HTMLAudioElement {
  const existing = audioCache.get(kind);
  if (existing) {
    return existing;
  }
  const created = buildAudio(kind);
  audioCache.set(kind, created);
  return created;
}

function tryFallback(kind: SoundKind, audio: HTMLAudioElement): boolean {
  const fallbacks = SOUND_CONFIG[kind].fallbackPaths;
  if (fallbacks.length < 2) {
    return false;
  }
  if (audio.src.endsWith(fallbacks[1])) {
    return false;
  }
  audio.src = fallbacks[1];
  return true;
}

export async function playNotificationSound(kind: SoundKind): Promise<void> {
  const audio = getAudio(kind);
  try {
    audio.currentTime = 0;
    await audio.play();
  } catch {
    if (tryFallback(kind, audio)) {
      try {
        audio.currentTime = 0;
        await audio.play();
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
