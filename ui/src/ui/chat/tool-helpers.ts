/**
 * Helper functions for tool card rendering.
 */

import { PREVIEW_MAX_CHARS, PREVIEW_MAX_LINES } from "./constants.ts";

const MEMORY_SEARCH_TOOL_NAMES = new Set(["memory_search", "memory search"]);
const MEMORY_SEARCH_PREVIEW_RESULTS = 4;
const MEMORY_SEARCH_SNIPPET_MAX = 220;

type MemorySearchResult = {
  citation?: string;
  path?: string;
  startLine?: number;
  endLine?: number;
  score?: number;
  snippet?: string;
};

/**
 * Format tool output content for display in the sidebar.
 * Detects JSON and wraps it in a code block with formatting.
 */
export function formatToolOutputForSidebar(text: string, toolName?: string): string {
  const memoryCompact = tryCompactMemorySearchJson(text, toolName);
  if (memoryCompact) {
    return memoryCompact;
  }
  const trimmed = text.trim();
  // Try to detect and format JSON
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      return "```json\n" + JSON.stringify(parsed, null, 2) + "\n```";
    } catch {
      // Not valid JSON, return as-is
    }
  }
  return text;
}

/**
 * Format text for inline tool previews in chat cards.
 * For memory_search JSON payloads, return a compact human-readable summary.
 */
export function formatToolOutputForPreview(text: string, toolName?: string): string {
  return tryCompactMemorySearchJson(text, toolName) ?? text;
}

/**
 * Get a truncated preview of tool output text.
 * Truncates to first N lines or first N characters, whichever is shorter.
 */
export function getTruncatedPreview(text: string): string {
  const allLines = text.split("\n");
  const lines = allLines.slice(0, PREVIEW_MAX_LINES);
  const preview = lines.join("\n");
  if (preview.length > PREVIEW_MAX_CHARS) {
    return preview.slice(0, PREVIEW_MAX_CHARS) + "…";
  }
  return lines.length < allLines.length ? preview + "…" : preview;
}

function tryCompactMemorySearchJson(text: string, toolName?: string): string | null {
  const normalizedTool = String(toolName ?? "")
    .trim()
    .toLowerCase();
  if (!MEMORY_SEARCH_TOOL_NAMES.has(normalizedTool)) {
    return null;
  }
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed) as {
      results?: MemorySearchResult[];
      provider?: string;
      model?: string;
      disabled?: boolean;
      error?: string;
    };
    if (!parsed || !Array.isArray(parsed.results)) {
      return null;
    }
    if (parsed.disabled) {
      const err =
        typeof parsed.error === "string" && parsed.error.trim() ? parsed.error.trim() : "disabled";
      return `Memory search unavailable: ${err}`;
    }
    return formatMemoryResultsSummary(parsed.results, parsed.provider, parsed.model);
  } catch {
    return null;
  }
}

function formatMemoryResultsSummary(
  results: MemorySearchResult[],
  provider?: string,
  model?: string,
): string {
  const lines: string[] = [];
  const providerLabel = provider ?? "unknown";
  const modelLabel = model ?? "unknown";
  lines.push(`Memory hits: ${results.length} · provider: ${providerLabel} · model: ${modelLabel}`);
  if (results.length === 0) {
    lines.push("No matches found.");
    return lines.join("\n");
  }
  lines.push("Use memory_get(path, from?, lines?) for exact lines.");
  const visible = results.slice(0, MEMORY_SEARCH_PREVIEW_RESULTS);
  if (results.length > visible.length) {
    lines.push(`Showing top ${visible.length} of ${results.length} results.`);
  }
  for (const [index, entry] of visible.entries()) {
    const citation = resolveCitation(entry);
    const score = Number.isFinite(entry.score) ? Number(entry.score).toFixed(3) : "n/a";
    lines.push(`${index + 1}. ${citation} · score ${score}`);
    const snippet = compactSnippet(entry.snippet ?? "", MEMORY_SEARCH_SNIPPET_MAX);
    if (snippet) {
      lines.push(`   ${snippet}`);
    }
  }
  return lines.join("\n");
}

function resolveCitation(entry: MemorySearchResult): string {
  if (typeof entry.citation === "string" && entry.citation.trim()) {
    return entry.citation.trim();
  }
  const path =
    typeof entry.path === "string" && entry.path.trim() ? entry.path.trim() : "memory/unknown.md";
  const start = Number.isFinite(entry.startLine) ? Number(entry.startLine) : 1;
  const end = Number.isFinite(entry.endLine) ? Number(entry.endLine) : start;
  return start === end ? `${path}#L${start}` : `${path}#L${start}-L${end}`;
}

function compactSnippet(raw: string, maxChars: number): string {
  const withoutSource = raw.replace(/\n+\s*Source:\s+[^\n]+$/i, "").trim();
  const normalized = withoutSource.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}
