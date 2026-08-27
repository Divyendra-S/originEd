/**
 * The jail is the one place where a bug is a remote-code-execution bug, so it
 * gets tested against the three escapes that actually happen: `..` traversal,
 * absolute paths, and symlinks. ARCHITECTURE.md §7.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  MAX_BYTES,
  WORKSPACE_ROOT,
  WorkspaceError,
  deleteFile,
  exists,
  listFiles,
  readFile,
  readFileIfExists,
  resolveInWorkspace,
  toWorkspaceRelative,
  writeFile,
} from "./workspace.fs";

// Dot-prefixed so listFiles() ignores it and it never shows up in the preview.
const SANDBOX = ".jailtest";
const rel = (p: string) => `${SANDBOX}/${p}`;

beforeAll(async () => {
  await fs.mkdir(path.join(WORKSPACE_ROOT, SANDBOX), { recursive: true });
});

afterAll(async () => {
  await fs.rm(path.join(WORKSPACE_ROOT, SANDBOX), { recursive: true, force: true });
});

describe("gate 1 — containment", () => {
  it("resolves ordinary relative paths inside the root", () => {
    expect(resolveInWorkspace("sections/hero.tsx")).toBe(
      path.join(WORKSPACE_ROOT, "sections/hero.tsx"),
    );
  });

  it.each([
    "../secrets.ts",
    "../../package.json",
    "sections/../../../etc/passwd",
    "./../../.env.local",
    "a/b/c/../../../../outside.ts",
  ])("rejects traversal: %s", (p) => {
    expect(() => resolveInWorkspace(p)).toThrow(WorkspaceError);
  });

  it.each(["/etc/passwd", "/Users/x/.ssh/id_rsa", "/"])("rejects absolute path: %s", (p) => {
    expect(() => resolveInWorkspace(p)).toThrow(/escapes the workspace/);
  });

  it("rejects a sibling directory that merely shares the prefix", () => {
    // src/workspace-evil/ must not pass a naive startsWith(ROOT) check.
    expect(() => resolveInWorkspace("../workspace-evil/x.ts")).toThrow(WorkspaceError);
  });

  it("rejects empty paths and null bytes", () => {
    expect(() => resolveInWorkspace("")).toThrow(WorkspaceError);
    expect(() => resolveInWorkspace("hero\0.tsx")).toThrow(/null byte/);
  });

  it("normalises redundant separators without escaping", () => {
    expect(resolveInWorkspace("sections//./hero.tsx")).toBe(
      path.join(WORKSPACE_ROOT, "sections/hero.tsx"),
    );
  });

  it("round-trips through toWorkspaceRelative with posix separators", () => {
    expect(toWorkspaceRelative(resolveInWorkspace("sections/hero.tsx"))).toBe(
      "sections/hero.tsx",
    );
  });
});

describe("gate 2 — symlinks", () => {
  it("rejects a file that IS a symlink", async () => {
    const link = path.join(WORKSPACE_ROOT, SANDBOX, "link.ts");
    await fs.symlink("/etc/hosts", link).catch(() => {});
    await expect(readFile(rel("link.ts"))).rejects.toThrow(/symlink/);
    await fs.rm(link, { force: true });
  });

  it("rejects a path whose PARENT DIRECTORY is a symlink", async () => {
    // The string resolves cleanly under ROOT; only lstat on the component catches it.
    const dirLink = path.join(WORKSPACE_ROOT, SANDBOX, "escape");
    await fs.symlink("/etc", dirLink).catch(() => {});
    await expect(readFile(rel("escape/hosts.ts"))).rejects.toThrow(/symlink/);
    await expect(writeFile(rel("escape/pwned.ts"), "x")).rejects.toThrow(/symlink/);
    await fs.rm(dirLink, { force: true });
  });
});

describe("gate 3 — extension allowlist", () => {
  it.each([".env", "run.sh", "bin/exe", "notes.txt", "config.yaml"])(
    "rejects %s",
    async (p) => {
      await expect(writeFile(rel(p), "x")).rejects.toThrow(/not writable/);
    },
  );

  it.each(["a.tsx", "a.ts", "a.css", "a.json", "a.md"])("allows %s", async (p) => {
    await expect(writeFile(rel(p), "ok")).resolves.toBeUndefined();
  });
});

describe("gate 4 — size cap", () => {
  it("rejects content over the cap", async () => {
    await expect(writeFile(rel("big.ts"), "x".repeat(MAX_BYTES + 1))).rejects.toThrow(
      /over the .* byte cap/,
    );
  });

  it("accepts content at the cap", async () => {
    await expect(writeFile(rel("edge.ts"), "x".repeat(MAX_BYTES))).resolves.toBeUndefined();
  });
});

describe("operations", () => {
  it("round-trips a write and a read", async () => {
    await writeFile(rel("round.tsx"), "export const a = 1;\n");
    expect(await readFile(rel("round.tsx"))).toBe("export const a = 1;\n");
    expect(await exists(rel("round.tsx"))).toBe(true);
  });

  it("creates intermediate directories on write", async () => {
    await writeFile(rel("deep/nested/x.ts"), "1");
    expect(await readFile(rel("deep/nested/x.ts"))).toBe("1");
  });

  it("readFileIfExists returns null instead of throwing on a missing file", async () => {
    expect(await readFileIfExists(rel("nope.tsx"))).toBeNull();
  });

  it("deletes", async () => {
    await writeFile(rel("gone.ts"), "1");
    await deleteFile(rel("gone.ts"));
    expect(await exists(rel("gone.ts"))).toBe(false);
  });

  it("listFiles skips dot-directories, so the sandbox is invisible", async () => {
    const entries = await listFiles(".");
    expect(entries.some((e) => e.path.startsWith(SANDBOX))).toBe(false);
  });
});
