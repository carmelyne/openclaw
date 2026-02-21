import { afterEach, describe, expect, it } from "vitest";
import { resolveSoundCandidates } from "./notification-sounds.ts";

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe("notification sound candidates", () => {
  it("includes workspace audio and legacy notify fallback paths", () => {
    const start = resolveSoundCandidates("start");
    const end = resolveSoundCandidates("end");
    expect(start).toContain("/workspace/audio/start.wav");
    expect(start).toContain("/workspace/audio/start.mp3");
    expect(start).toContain("/workspace/notify-start.mp3");
    expect(end).toContain("/workspace/audio/end.wav");
    expect(end).toContain("/workspace/audio/end.mp3");
    expect(end).toContain("/workspace/notify-end.mp3");
  });

  it("prefers custom localStorage URL first", () => {
    (globalThis as { window?: unknown }).window = {
      localStorage: {
        getItem: (key: string) =>
          key === "openclaw.sound.startUrl" ? "https://example.com/custom-start.mp3" : null,
      },
    };
    const start = resolveSoundCandidates("start");
    expect(start[0]).toBe("https://example.com/custom-start.mp3");
  });

  it("prefixes fallback paths with control UI basePath", () => {
    (globalThis as { window?: unknown }).window = {
      __OPENCLAW_CONTROL_UI_BASE_PATH__: "/ui",
      localStorage: {
        getItem: () => null,
      },
    };
    const start = resolveSoundCandidates("start");
    expect(start[0]).toBe("/ui/workspace/audio/start.wav");
    expect(start).toContain("/ui/workspace/notify-start.mp3");
  });
});
