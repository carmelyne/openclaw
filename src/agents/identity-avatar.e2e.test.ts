import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import { resolveAgentAvatar } from "./identity-avatar.js";

async function writeFile(filePath: string, contents = "avatar") {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, contents, "utf-8");
}

describe("resolveAgentAvatar", () => {
  it("resolves local avatar from config when inside workspace", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-avatar-"));
    const workspace = path.join(root, "work");
    const avatarPath = path.join(workspace, "avatars", "main.png");
    await writeFile(avatarPath);

    const cfg: OpenClawConfig = {
      agents: {
        list: [
          {
            id: "main",
            workspace,
            identity: { avatar: "avatars/main.png" },
          },
        ],
      },
    };

    const workspaceReal = await fs.realpath(workspace);
    const resolved = resolveAgentAvatar(cfg, "main");
    expect(resolved.kind).toBe("local");
    if (resolved.kind === "local") {
      const resolvedReal = await fs.realpath(resolved.filePath);
      expect(path.relative(workspaceReal, resolvedReal)).toBe(path.join("avatars", "main.png"));
    }
  });

  it("rejects avatars outside the workspace", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-avatar-"));
    const workspace = path.join(root, "work");
    await fs.mkdir(workspace, { recursive: true });
    const outsidePath = path.join(root, "outside.png");
    await writeFile(outsidePath);

    const cfg: OpenClawConfig = {
      agents: {
        list: [
          {
            id: "main",
            workspace,
            identity: { avatar: outsidePath },
          },
        ],
      },
    };

    const resolved = resolveAgentAvatar(cfg, "main");
    expect(resolved.kind).toBe("none");
    if (resolved.kind === "none") {
      expect(resolved.reason).toBe("outside_workspace");
    }
  });

  it("falls back to IDENTITY.md when config has no avatar", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-avatar-"));
    const workspace = path.join(root, "work");
    const avatarPath = path.join(workspace, "avatars", "fallback.png");
    await writeFile(avatarPath);
    await fs.mkdir(workspace, { recursive: true });
    await fs.writeFile(
      path.join(workspace, "IDENTITY.md"),
      "- Avatar: avatars/fallback.png\n",
      "utf-8",
    );

    const cfg: OpenClawConfig = {
      agents: {
        list: [{ id: "main", workspace }],
      },
    };

    const workspaceReal = await fs.realpath(workspace);
    const resolved = resolveAgentAvatar(cfg, "main");
    expect(resolved.kind).toBe("local");
    if (resolved.kind === "local") {
      const resolvedReal = await fs.realpath(resolved.filePath);
      expect(path.relative(workspaceReal, resolvedReal)).toBe(path.join("avatars", "fallback.png"));
    }
  });

  it("accepts remote and data avatars", () => {
    const cfg: OpenClawConfig = {
      agents: {
        list: [
          { id: "main", identity: { avatar: "https://example.com/avatar.png" } },
          { id: "data", identity: { avatar: "data:image/png;base64,aaaa" } },
        ],
      },
    };

    const remote = resolveAgentAvatar(cfg, "main");
    expect(remote.kind).toBe("remote");

    const data = resolveAgentAvatar(cfg, "data");
    expect(data.kind).toBe("data");
  });

  it("rotates local avatars when a directory is configured", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-avatar-"));
    const workspace = path.join(root, "work");
    await writeFile(path.join(workspace, "avatars", "01.png"));
    await writeFile(path.join(workspace, "avatars", "02.png"));
    await writeFile(path.join(workspace, "avatars", "03.png"));

    const cfg: OpenClawConfig = {
      agents: {
        list: [{ id: "main", workspace, identity: { avatar: "avatars" } }],
      },
    };

    const firstMeta = resolveAgentAvatar(cfg, "main", { advance: true });
    expect(firstMeta.kind).toBe("local");
    if (firstMeta.kind === "local") {
      expect(path.basename(firstMeta.filePath)).toBe("01.png");
    }

    const firstFetch = resolveAgentAvatar(cfg, "main", { advance: false });
    expect(firstFetch.kind).toBe("local");
    if (firstFetch.kind === "local") {
      expect(path.basename(firstFetch.filePath)).toBe("01.png");
    }

    const secondMeta = resolveAgentAvatar(cfg, "main", { advance: true });
    expect(secondMeta.kind).toBe("local");
    if (secondMeta.kind === "local") {
      expect(path.basename(secondMeta.filePath)).toBe("02.png");
    }

    const secondFetch = resolveAgentAvatar(cfg, "main", { advance: false });
    expect(secondFetch.kind).toBe("local");
    if (secondFetch.kind === "local") {
      expect(path.basename(secondFetch.filePath)).toBe("02.png");
    }
  });
});
