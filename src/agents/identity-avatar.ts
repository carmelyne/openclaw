import fs from "node:fs";
import path from "node:path";
import type { OpenClawConfig } from "../config/config.js";
import { resolveUserPath } from "../utils.js";
import { resolveAgentWorkspaceDir } from "./agent-scope.js";
import { loadAgentIdentityFromWorkspace } from "./identity-file.js";
import { resolveAgentIdentity } from "./identity.js";

export type AgentAvatarResolution =
  | { kind: "none"; reason: string }
  | { kind: "local"; filePath: string }
  | { kind: "remote"; url: string }
  | { kind: "data"; url: string };

const ALLOWED_AVATAR_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"]);
const MAX_DIRECTORY_ROTATION_STATES = 256;

type DirectoryRotationState = {
  signature: string;
  selectedPath: string | null;
  nextIndex: number;
};

const directoryRotationStates = new Map<string, DirectoryRotationState>();

export type ResolveAgentAvatarOptions = {
  advance?: boolean;
};

function normalizeAvatarValue(value: string | undefined | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function resolveAvatarSource(cfg: OpenClawConfig, agentId: string): string | null {
  const fromConfig = normalizeAvatarValue(resolveAgentIdentity(cfg, agentId)?.avatar);
  if (fromConfig) {
    return fromConfig;
  }
  const workspace = resolveAgentWorkspaceDir(cfg, agentId);
  const fromIdentity = normalizeAvatarValue(loadAgentIdentityFromWorkspace(workspace)?.avatar);
  return fromIdentity;
}

function isRemoteAvatar(value: string): boolean {
  const lower = value.toLowerCase();
  return lower.startsWith("http://") || lower.startsWith("https://");
}

function isDataAvatar(value: string): boolean {
  return value.toLowerCase().startsWith("data:");
}

function resolveExistingPath(value: string): string {
  try {
    return fs.realpathSync(value);
  } catch {
    return path.resolve(value);
  }
}

function isPathWithin(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  if (!relative) {
    return true;
  }
  return !relative.startsWith("..") && !path.isAbsolute(relative);
}

function resolveLocalAvatarPath(params: {
  raw: string;
  workspaceDir: string;
}):
  | { ok: true; kind: "file"; filePath: string }
  | { ok: true; kind: "directory"; directoryPath: string }
  | { ok: false; reason: string } {
  const workspaceRoot = resolveExistingPath(params.workspaceDir);
  const raw = params.raw;
  const resolved =
    raw.startsWith("~") || path.isAbsolute(raw)
      ? resolveUserPath(raw)
      : path.resolve(workspaceRoot, raw);
  const realPath = resolveExistingPath(resolved);
  if (!isPathWithin(workspaceRoot, realPath)) {
    return { ok: false, reason: "outside_workspace" };
  }
  let stat: fs.Stats;
  try {
    stat = fs.statSync(realPath);
  } catch {
    return { ok: false, reason: "missing" };
  }
  if (stat.isDirectory()) {
    return { ok: true, kind: "directory", directoryPath: realPath };
  }
  if (!stat.isFile()) {
    return { ok: false, reason: "missing" };
  }
  const ext = path.extname(realPath).toLowerCase();
  if (!ALLOWED_AVATAR_EXTS.has(ext)) {
    return { ok: false, reason: "unsupported_extension" };
  }
  return { ok: true, kind: "file", filePath: realPath };
}

function listAvatarFiles(directoryPath: string): string[] {
  const entries = fs.readdirSync(directoryPath, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    const ext = path.extname(entry.name).toLowerCase();
    if (!ALLOWED_AVATAR_EXTS.has(ext)) {
      continue;
    }
    files.push(path.join(directoryPath, entry.name));
  }
  files.sort((a, b) => a.localeCompare(b));
  return files;
}

function rotationStateKey(workspaceDir: string, agentId: string, directoryPath: string): string {
  return `${resolveExistingPath(workspaceDir)}::${agentId}::${directoryPath}`;
}

function setDirectoryRotationState(key: string, state: DirectoryRotationState) {
  if (directoryRotationStates.has(key)) {
    directoryRotationStates.delete(key);
  }
  directoryRotationStates.set(key, state);
  if (directoryRotationStates.size <= MAX_DIRECTORY_ROTATION_STATES) {
    return;
  }
  const oldestKey = directoryRotationStates.keys().next().value;
  if (typeof oldestKey === "string") {
    directoryRotationStates.delete(oldestKey);
  }
}

function resolveAvatarFromDirectory(params: {
  workspaceDir: string;
  agentId: string;
  directoryPath: string;
  advance: boolean;
}): AgentAvatarResolution {
  const files = listAvatarFiles(params.directoryPath);
  if (files.length === 0) {
    return { kind: "none", reason: "missing" };
  }
  const signature = files.join("\n");
  const key = rotationStateKey(params.workspaceDir, params.agentId, params.directoryPath);
  const existing = directoryRotationStates.get(key);
  const fileCount = files.length;

  let selectedPath: string | null = existing?.selectedPath ?? null;
  let nextIndex = existing?.nextIndex ?? 0;
  if (!existing || existing.signature !== signature) {
    const selectedIndex =
      selectedPath && files.includes(selectedPath) ? files.indexOf(selectedPath) : -1;
    selectedPath = selectedIndex >= 0 ? files[selectedIndex] : null;
    nextIndex = selectedIndex >= 0 ? (selectedIndex + 1) % fileCount : 0;
  }

  if (params.advance) {
    const safeIndex = ((nextIndex % fileCount) + fileCount) % fileCount;
    selectedPath = files[safeIndex];
    nextIndex = (safeIndex + 1) % fileCount;
  } else if (!selectedPath) {
    selectedPath = files[0];
    nextIndex = fileCount > 1 ? 1 : 0;
  }

  setDirectoryRotationState(key, {
    signature,
    selectedPath,
    nextIndex,
  });
  return { kind: "local", filePath: selectedPath };
}

export function resolveAgentAvatar(
  cfg: OpenClawConfig,
  agentId: string,
  opts?: ResolveAgentAvatarOptions,
): AgentAvatarResolution {
  const source = resolveAvatarSource(cfg, agentId);
  if (!source) {
    return { kind: "none", reason: "missing" };
  }
  if (isRemoteAvatar(source)) {
    return { kind: "remote", url: source };
  }
  if (isDataAvatar(source)) {
    return { kind: "data", url: source };
  }
  const workspaceDir = resolveAgentWorkspaceDir(cfg, agentId);
  const resolved = resolveLocalAvatarPath({ raw: source, workspaceDir });
  if (!resolved.ok) {
    return { kind: "none", reason: resolved.reason };
  }
  if (resolved.kind === "directory") {
    return resolveAvatarFromDirectory({
      workspaceDir,
      agentId,
      directoryPath: resolved.directoryPath,
      advance: opts?.advance === true,
    });
  }
  return { kind: "local", filePath: resolved.filePath };
}
