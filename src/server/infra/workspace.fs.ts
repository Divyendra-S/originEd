/**
 * Layer 3 · infra — THE JAIL.
 *
 * Every filesystem operation the agent can reach goes through this module, and
 * `src/workspace/` is the only tree it can touch. Four independent gates:
 *
 *   1. path containment  — resolved path must live under ROOT
 *   2. symlink rejection — no component may be a symlink (blocks escape-by-link)
 *   3. extension allowlist
 *   4. size cap
 *
 * ARCHITECTURE.md §7. Unit-tested in workspace.fs.test.ts BEFORE any tool ships.
 */
import { promises as fs } from "node:fs";
import path from "node:path";

export const WORKSPACE_ROOT = path.resolve(process.cwd(), "src/workspace");

/** Files the agent is allowed to create or modify. */
export const ALLOWED_EXTENSIONS = [".tsx", ".ts", ".css", ".json", ".md"] as const;

/** Refuse to read or write anything larger than this. */
export const MAX_BYTES = 256 * 1024;

export class WorkspaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceError";
  }
}

/**
 * Gate 1 — containment. Resolve `rel` against the jail root and prove the result
 * is still inside it.
 *
 * `path.resolve` handles `..`, `.`, duplicate separators and absolute inputs:
 * `resolve(ROOT, "/etc/passwd")` returns "/etc/passwd", which then fails the
 * prefix test. The `ROOT + sep` comparison (rather than a bare `startsWith`)
 * is what stops a sibling directory named `src/workspace-evil` from passing.
 */
export function resolveInWorkspace(rel: string): string {
  if (typeof rel !== "string" || rel.length === 0) {
    throw new WorkspaceError("path must be a non-empty string");
  }
  if (rel.includes("\0")) {
    throw new WorkspaceError("path contains a null byte");
  }

  const resolved = path.resolve(WORKSPACE_ROOT, rel);
  if (resolved !== WORKSPACE_ROOT && !resolved.startsWith(WORKSPACE_ROOT + path.sep)) {
    throw new WorkspaceError(`path escapes the workspace: ${rel}`);
  }
  return resolved;
}

/** Path relative to the jail root, POSIX-style — what we show the model and store in the DB. */
export function toWorkspaceRelative(abs: string): string {
  return path.relative(WORKSPACE_ROOT, abs).split(path.sep).join("/");
}

/**
 * Gate 2 — symlinks. Walk every component from ROOT down to the target and
 * reject any that is a symlink.
 *
 * Checking only the final path is not enough: `sections/link/hero.tsx` where
 * `link -> /etc` resolves cleanly under ROOT as a *string* and would otherwise
 * escape at open() time. A component that does not exist yet is fine — that is
 * just a file we are about to create.
 */
async function assertNoSymlinks(abs: string): Promise<void> {
  const rel = path.relative(WORKSPACE_ROOT, abs);
  if (rel === "") return;

  let current = WORKSPACE_ROOT;
  for (const segment of rel.split(path.sep)) {
    current = path.join(current, segment);
    let stat;
    try {
      stat = await fs.lstat(current);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return; // not created yet
      throw err;
    }
    if (stat.isSymbolicLink()) {
      throw new WorkspaceError(`path traverses a symlink: ${toWorkspaceRelative(current)}`);
    }
  }
}

/** Gate 3 — extension allowlist. */
function assertAllowedExtension(abs: string): void {
  const ext = path.extname(abs).toLowerCase();
  if (!(ALLOWED_EXTENSIONS as readonly string[]).includes(ext)) {
    throw new WorkspaceError(
      `extension "${ext || "(none)"}" is not writable; allowed: ${ALLOWED_EXTENSIONS.join(" ")}`,
    );
  }
}

/** Gate 4 — size cap. */
function assertWithinSizeCap(content: string, rel: string): void {
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes > MAX_BYTES) {
    throw new WorkspaceError(`${rel} is ${bytes} bytes, over the ${MAX_BYTES} byte cap`);
  }
}

/** All four gates. Every public operation below starts here. */
async function gate(rel: string, opts: { checkExtension?: boolean } = {}): Promise<string> {
  const abs = resolveInWorkspace(rel);
  await assertNoSymlinks(abs);
  if (opts.checkExtension !== false) assertAllowedExtension(abs);
  return abs;
}

// ── operations ────────────────────────────────────────────────────────────────

export async function readFile(rel: string): Promise<string> {
  const abs = await gate(rel);
  const stat = await fs.stat(abs);
  if (!stat.isFile()) throw new WorkspaceError(`${rel} is not a file`);
  if (stat.size > MAX_BYTES) {
    throw new WorkspaceError(`${rel} is ${stat.size} bytes, over the ${MAX_BYTES} byte cap`);
  }
  return fs.readFile(abs, "utf8");
}

/** Returns null when the file does not exist — callers distinguish create from update. */
export async function readFileIfExists(rel: string): Promise<string | null> {
  try {
    return await readFile(rel);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export async function writeFile(rel: string, content: string): Promise<void> {
  const abs = await gate(rel);
  assertWithinSizeCap(content, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, "utf8");
}

export async function deleteFile(rel: string): Promise<void> {
  const abs = await gate(rel);
  await fs.unlink(abs);
}

export async function exists(rel: string): Promise<boolean> {
  try {
    await fs.stat(await gate(rel));
    return true;
  } catch {
    return false;
  }
}

export interface WorkspaceEntry {
  path: string;
  type: "file" | "dir";
}

/** Recursive listing, jail-relative, sorted. Skips dotfiles and node_modules. */
export async function listFiles(rel = "."): Promise<WorkspaceEntry[]> {
  const abs = await gate(rel, { checkExtension: false });
  const out: WorkspaceEntry[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const child = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue; // never surface links to the model
      if (entry.isDirectory()) {
        out.push({ path: toWorkspaceRelative(child), type: "dir" });
        await walk(child);
      } else if (entry.isFile()) {
        out.push({ path: toWorkspaceRelative(child), type: "file" });
      }
    }
  }

  await walk(abs);
  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}
