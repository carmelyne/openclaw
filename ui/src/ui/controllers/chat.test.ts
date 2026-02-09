import { describe, expect, it, vi } from "vitest";
import {
  handleChatEvent,
  loadChatHistory,
  loadChatUsageSummary,
  type ChatEventPayload,
  type ChatState,
} from "./chat.ts";

function createState(overrides: Partial<ChatState> = {}): ChatState {
  return {
    chatAttachments: [],
    chatLoading: false,
    chatUsageLoading: false,
    chatMessage: "",
    chatMessages: [],
    chatUsageLastTurnTokens: null,
    chatUsageLastTurnCost: null,
    chatUsageCumulativeTokens: null,
    chatUsageCumulativeCost: null,
    chatRunId: null,
    chatSending: false,
    chatStream: null,
    chatStreamStartedAt: null,
    chatThinkingLevel: null,
    client: null,
    connected: true,
    lastError: null,
    sessionKey: "main",
    ...overrides,
  };
}

describe("handleChatEvent", () => {
  it("returns null when payload is missing", () => {
    const state = createState();
    expect(handleChatEvent(state, undefined)).toBe(null);
  });

  it("returns null when sessionKey does not match", () => {
    const state = createState({ sessionKey: "main" });
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "other",
      state: "final",
    };
    expect(handleChatEvent(state, payload)).toBe(null);
  });

  it("returns null for delta from another run", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-user",
      chatStream: "Hello",
    });
    const payload: ChatEventPayload = {
      runId: "run-announce",
      sessionKey: "main",
      state: "delta",
      message: { role: "assistant", content: [{ type: "text", text: "Done" }] },
    };
    expect(handleChatEvent(state, payload)).toBe(null);
    expect(state.chatRunId).toBe("run-user");
    expect(state.chatStream).toBe("Hello");
  });

  it("returns 'final' for final from another run (e.g. sub-agent announce) without clearing state", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-user",
      chatStream: "Working...",
      chatStreamStartedAt: 123,
    });
    const payload: ChatEventPayload = {
      runId: "run-announce",
      sessionKey: "main",
      state: "final",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Sub-agent findings" }],
      },
    };
    expect(handleChatEvent(state, payload)).toBe("final");
    expect(state.chatRunId).toBe("run-user");
    expect(state.chatStream).toBe("Working...");
    expect(state.chatStreamStartedAt).toBe(123);
  });

  it("processes final from own run and clears state", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
      chatStream: "Reply",
      chatStreamStartedAt: 100,
    });
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "final",
    };
    expect(handleChatEvent(state, payload)).toBe("final");
    expect(state.chatRunId).toBe(null);
    expect(state.chatStream).toBe(null);
    expect(state.chatStreamStartedAt).toBe(null);
  });

  it("processes aborted from own run and keeps partial assistant message", () => {
    const existingMessage = {
      role: "user",
      content: [{ type: "text", text: "Hi" }],
      timestamp: 1,
    };
    const partialMessage = {
      role: "assistant",
      content: [{ type: "text", text: "Partial reply" }],
      timestamp: 2,
    };
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
      chatStream: "Partial reply",
      chatStreamStartedAt: 100,
      chatMessages: [existingMessage],
    });
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "aborted",
      message: partialMessage,
    };

    expect(handleChatEvent(state, payload)).toBe("aborted");
    expect(state.chatRunId).toBe(null);
    expect(state.chatStream).toBe(null);
    expect(state.chatStreamStartedAt).toBe(null);
    expect(state.chatMessages).toEqual([existingMessage, partialMessage]);
  });

  it("falls back to streamed partial when aborted payload message is invalid", () => {
    const existingMessage = {
      role: "user",
      content: [{ type: "text", text: "Hi" }],
      timestamp: 1,
    };
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
      chatStream: "Partial reply",
      chatStreamStartedAt: 100,
      chatMessages: [existingMessage],
    });
    const payload = {
      runId: "run-1",
      sessionKey: "main",
      state: "aborted",
      message: "not-an-assistant-message",
    } as unknown as ChatEventPayload;

    expect(handleChatEvent(state, payload)).toBe("aborted");
    expect(state.chatRunId).toBe(null);
    expect(state.chatStream).toBe(null);
    expect(state.chatStreamStartedAt).toBe(null);
    expect(state.chatMessages).toHaveLength(2);
    expect(state.chatMessages[0]).toEqual(existingMessage);
    expect(state.chatMessages[1]).toMatchObject({
      role: "assistant",
      content: [{ type: "text", text: "Partial reply" }],
    });
  });

  it("falls back to streamed partial when aborted payload has non-assistant role", () => {
    const existingMessage = {
      role: "user",
      content: [{ type: "text", text: "Hi" }],
      timestamp: 1,
    };
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
      chatStream: "Partial reply",
      chatStreamStartedAt: 100,
      chatMessages: [existingMessage],
    });
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "aborted",
      message: {
        role: "user",
        content: [{ type: "text", text: "unexpected" }],
      },
    };

    expect(handleChatEvent(state, payload)).toBe("aborted");
    expect(state.chatMessages).toHaveLength(2);
    expect(state.chatMessages[1]).toMatchObject({
      role: "assistant",
      content: [{ type: "text", text: "Partial reply" }],
    });
  });

  it("processes aborted from own run without message and empty stream", () => {
    const existingMessage = {
      role: "user",
      content: [{ type: "text", text: "Hi" }],
      timestamp: 1,
    };
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
      chatStream: "",
      chatStreamStartedAt: 100,
      chatMessages: [existingMessage],
    });
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "aborted",
    };

    expect(handleChatEvent(state, payload)).toBe("aborted");
    expect(state.chatRunId).toBe(null);
    expect(state.chatStream).toBe(null);
    expect(state.chatStreamStartedAt).toBe(null);
    expect(state.chatMessages).toEqual([existingMessage]);
  });
});

describe("loadChatUsageSummary", () => {
  it("loads latest turn + cumulative usage from timeseries", async () => {
    const request = vi.fn().mockResolvedValue({
      points: [
        {
          totalTokens: 42,
          cost: 0.0008,
          cumulativeTokens: 42,
          cumulativeCost: 0.0008,
        },
        {
          totalTokens: 128,
          cost: 0.0024,
          cumulativeTokens: 170,
          cumulativeCost: 0.0032,
        },
      ],
    });
    const state = createState({
      client: { request } as unknown as ChatState["client"],
      connected: true,
      sessionKey: "main",
    });

    await loadChatUsageSummary(state);

    expect(request).toHaveBeenCalledWith("sessions.usage.timeseries", { key: "main" });
    expect(state.chatUsageLastTurnTokens).toBe(128);
    expect(state.chatUsageLastTurnCost).toBe(0.0024);
    expect(state.chatUsageCumulativeTokens).toBe(170);
    expect(state.chatUsageCumulativeCost).toBe(0.0032);
    expect(state.chatUsageLoading).toBe(false);
  });

  it("clears usage summary when no timeseries points exist", async () => {
    const request = vi.fn().mockResolvedValue({ points: [] });
    const state = createState({
      client: { request } as unknown as ChatState["client"],
      connected: true,
      sessionKey: "main",
      chatUsageLastTurnTokens: 12,
      chatUsageCumulativeTokens: 500,
    });

    await loadChatUsageSummary(state);

    expect(state.chatUsageLastTurnTokens).toBeNull();
    expect(state.chatUsageLastTurnCost).toBeNull();
    expect(state.chatUsageCumulativeTokens).toBeNull();
    expect(state.chatUsageCumulativeCost).toBeNull();
  });
});

describe("loadChatHistory", () => {
  it("loads history and usage summary without surfacing usage errors", async () => {
    const request = vi.fn().mockImplementation(async (method: string) => {
      if (method === "chat.history") {
        return {
          messages: [{ role: "assistant", content: [{ type: "text", text: "hi" }] }],
          thinkingLevel: "medium",
        };
      }
      if (method === "sessions.usage.timeseries") {
        throw new Error("no timeseries");
      }
      return {};
    });
    const state = createState({
      client: { request } as unknown as ChatState["client"],
      connected: true,
      sessionKey: "main",
      lastError: "older error",
    });

    await loadChatHistory(state);

    expect(state.chatLoading).toBe(false);
    expect(state.lastError).toBeNull();
    expect(state.chatThinkingLevel).toBe("medium");
    expect(Array.isArray(state.chatMessages)).toBe(true);
    expect(state.chatUsageCumulativeTokens).toBeNull();
  });
});
