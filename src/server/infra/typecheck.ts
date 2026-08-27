/**
 * `tsc --noEmit` over the jail (§7) — the gate that stops the agent leaving the
 * page in a state that does not compile.
 *
 * Scoped to `src/workspace/**` by `tsconfig.workspace.json` for two reasons. It
 * runs in ~0.55s instead of the whole project's ~2.8s, which is the difference
 * between a gate that runs on every job and one that gets switched off; and it
 * reports only errors the agent can actually act on. An error in a file it
 * cannot edit is noise it will try to fix anyway.
 *
 * That 0.55s is the tail of the job the user actually waits through — the edits
 * have already streamed by the time it starts — so the config is tuned for it
 * rather than left at defaults. What buys what is written down there.
 *
 * Paths come back JAIL-RELATIVE — `sections/hero.tsx`, not
 * `src/workspace/sections/hero.tsx` — because that is the vocabulary every
 * other tool speaks. Handing the model a path it cannot pass to `read_file` is
 * an invitation to guess.
 */
import { execFile } from "node:child_process";
import path from "node:path";

export interface Diagnostic {
  /** Relative to the workspace root, like every tool argument. */
  path: string;
  line: number;
  column: number;
  code: string;
  message: string;
}

export interface TypecheckResult {
  /**
   * Null means the CHECKER could not run — a missing binary, a timeout, an
   * abort. That is not the same as "no errors", and the caller must not treat
   * it as a pass.
   */
  diagnostics: Diagnostic[] | null;
  /** Present only alongside a null result. */
  error?: string;
}

const PROJECT_ROOT = path.resolve(process.cwd());
const TSC = path.join(PROJECT_ROOT, "node_modules", "typescript", "bin", "tsc");
const CONFIG = "tsconfig.workspace.json";
const PREFIX = `src${path.sep}workspace${path.sep}`;

/** Long enough for a cold run on a slow machine, short enough to not hang a job. */
const TIMEOUT_MS = 90_000;

/** More than this and the model is being handed a wall, not a fix list. */
export const MAX_REPORTED = 25;

const DIAGNOSTIC = /^(.+?)\((\d+),(\d+)\):\s*error\s+(TS\d+):\s*(.*)$/;

/**
 * Parse `tsc --pretty false` output.
 *
 * Continuation lines are the reason this is not a one-line `split().map()`:
 * TypeScript's better messages ("Type 'X' is not assignable to type 'Y'.")
 * carry indented follow-up lines that explain WHY, and dropping them leaves the
 * model with the least useful half of the diagnostic.
 */
export function parse(raw: string): Diagnostic[] {
  const out: Diagnostic[] = [];

  for (const line of raw.split("\n")) {
    const match = DIAGNOSTIC.exec(line);
    if (match) {
      const [, file, row, column, code, message] = match;
      out.push({
        path: toJailRelative(file),
        line: Number(row),
        column: Number(column),
        code,
        message: message.trim(),
      });
      continue;
    }
    // An indented line belongs to the diagnostic above it.
    const previous = out.at(-1);
    if (previous && /^\s+\S/.test(line)) previous.message += ` ${line.trim()}`;
  }

  return out;
}

function toJailRelative(file: string): string {
  const normalised = file.trim().replace(/\\/g, "/");
  const prefix = PREFIX.replace(/\\/g, "/");
  return normalised.startsWith(prefix) ? normalised.slice(prefix.length) : normalised;
}

/** What the model is shown. One line per error, capped. */
export function format(diagnostics: readonly Diagnostic[]): string {
  const shown = diagnostics.slice(0, MAX_REPORTED);
  const lines = shown.map((d) => `${d.path}(${d.line},${d.column}): ${d.code}: ${d.message}`);
  if (diagnostics.length > shown.length) {
    lines.push(`…and ${diagnostics.length - shown.length} more.`);
  }
  return lines.join("\n");
}

/**
 * Run the checker. Never throws for a FAILING typecheck — that is the normal
 * case and the whole point. It resolves with a null `diagnostics` only when the
 * checker itself did not run.
 */
export function run(signal?: AbortSignal): Promise<TypecheckResult> {
  return new Promise((resolve) => {
    // No shell, and no argument comes from the model — the config path is a
    // constant. `process.execPath` rather than a PATH lookup for the same
    // reason: nothing here should depend on the environment it inherited.
    execFile(
      process.execPath,
      [TSC, "-p", CONFIG, "--pretty", "false"],
      { cwd: PROJECT_ROOT, timeout: TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024, signal },
      (err, stdout, stderr) => {
        const output = `${stdout}${stderr}`;
        const diagnostics = parse(output);

        // tsc exits non-zero WHEN IT FINDS ERRORS, so a non-zero exit with
        // parseable output is a successful run reporting a broken workspace.
        if (diagnostics.length > 0) return resolve({ diagnostics });
        if (!err) return resolve({ diagnostics: [] });

        resolve({
          diagnostics: null,
          error: output.trim() || err.message || "typecheck could not run",
        });
      },
    );
  });
}
