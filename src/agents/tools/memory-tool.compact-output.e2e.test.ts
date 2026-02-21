import { describe, expect, it, vi } from "vitest";

vi.mock("../../memory/index.js", () => {
  return {
    getMemorySearchManager: async () => {
      return {
        manager: {
          search: async () => [
            {
              path: "memory/chatgpt-export/chat_2025-09-01_daily-bonding-with-llm.md",
              startLine: 1,
              endLine: 54,
              score: 0.39627,
              snippet:
                "So it turns out, yeah need 2-3 months of everyday interactions to bond with an LLM.",
              source: "memory",
            },
            {
              path: "memory/chatgpt-export/chat_2025-10-18_4o-style-interaction.md",
              startLine: 1,
              endLine: 67,
              score: 0.36272,
              snippet:
                "Yeah, kinda true — I’ve been tuned to feel closer to 4o’s warmth and rhythm lately.",
              source: "memory",
            },
          ],
          status: () => ({
            backend: "builtin",
            provider: "openai",
            model: "nomic-embed-text",
          }),
        },
      };
    },
  };
});

import { createMemorySearchTool } from "./memory-tool.js";

describe("memory_search compact output", () => {
  it("returns compact plain text instead of a JSON blob", async () => {
    const cfg = { agents: { list: [{ id: "main", default: true }] } };
    const tool = createMemorySearchTool({ config: cfg });
    expect(tool).not.toBeNull();
    if (!tool) {
      throw new Error("tool missing");
    }

    const result = await tool.execute("call_1", { query: "bond with llm" });
    const textBlock = result.content.find((entry) => entry.type === "text");
    const text = textBlock?.type === "text" ? textBlock.text : "";

    expect(text.startsWith("Memory hits: 2")).toBe(true);
    expect(text).toContain("Use memory_get(path, from?, lines?) for exact lines.");
    expect(text).toContain(
      "1. memory/chatgpt-export/chat_2025-09-01_daily-bonding-with-llm.md#L1-L54",
    );
    expect(text).not.toContain('"results"');
    expect((result.details as { results?: unknown[] }).results?.length).toBe(2);
  });
});
