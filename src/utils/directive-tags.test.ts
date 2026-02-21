import { describe, expect, it } from "vitest";
import { parseInlineDirectives } from "./directive-tags.js";

describe("parseInlineDirectives", () => {
  it("preserves original whitespace when no directives are present", () => {
    const source = "  line one\n\nline   two  ";
    const result = parseInlineDirectives(source);
    expect(result.text).toBe(source);
    expect(result.hasAudioTag).toBe(false);
    expect(result.hasReplyTag).toBe(false);
  });

  it("normalizes whitespace only when stripping directive tags", () => {
    const result = parseInlineDirectives("hello [[reply_to_current]]  \n   world", {
      currentMessageId: "m-1",
    });
    expect(result.text).toBe("hello\nworld");
    expect(result.replyToId).toBe("m-1");
    expect(result.replyToCurrent).toBe(true);
    expect(result.hasReplyTag).toBe(true);
  });
});
