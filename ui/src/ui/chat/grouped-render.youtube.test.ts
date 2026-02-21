import { describe, expect, it } from "vitest";
import { extractYoutubeEmbed } from "./grouped-render.ts";

describe("extractYoutubeEmbed", () => {
  it("extracts watch links", () => {
    const found = extractYoutubeEmbed("Try this: https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(found?.id).toBe("dQw4w9WgXcQ");
    expect(found?.embedUrl).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
  });

  it("extracts short links with trailing punctuation", () => {
    const found = extractYoutubeEmbed("Song: https://youtu.be/dQw4w9WgXcQ)");
    expect(found?.id).toBe("dQw4w9WgXcQ");
  });

  it("returns null for non-youtube URLs", () => {
    const found = extractYoutubeEmbed("https://example.com/watch?v=dQw4w9WgXcQ");
    expect(found).toBeNull();
  });
});
