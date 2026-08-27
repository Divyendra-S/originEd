"use client";

/**
 * §12 level 3. The whole diff-viewer is this file, because the server already
 * did the patch math — Layer 1 just colours lines. No diff library in the
 * bundle.
 */
import { useJobDiff } from "@/hooks/useJobDiff";
import type { DiffHunk, FileDiff } from "@/lib/types";

/**
 * A whole-file create is one hunk of ~600 lines. Nobody reads that in a 33%-wide
 * column, and rendering it costs a visible frame — so it is cut off and said so.
 */
const MAX_LINES = 400;

function lineClass(line: string): string {
  if (line.startsWith("+")) return "bg-oe-add-bg text-oe-add-text";
  if (line.startsWith("-")) return "bg-oe-del-bg text-oe-del-text";
  if (line.startsWith("\\")) return "text-oe-faint italic";
  return "text-oe-muted";
}

function Hunk({ hunk, budget }: { hunk: DiffHunk; budget: number }) {
  const lines = hunk.lines.slice(0, budget);

  return (
    <>
      <div className="bg-oe-bg/60 px-2.5 py-1 font-mono text-ui-2xs text-oe-faint">
        @@ −{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
      </div>
      {lines.map((line, i) => (
        <div key={i} className={`px-2.5 font-mono text-ui-xs leading-[1.55] ${lineClass(line)}`}>
          {/* A blank context line still needs to occupy a row. */}
          {line === "" ? " " : line}
        </div>
      ))}
    </>
  );
}

/**
 * Spends MAX_LINES across the hunks in order, so the cut lands at the bottom of
 * what you are reading rather than trimming every hunk a little. A plain
 * function, not a running counter in the JSX — the React compiler is right that
 * reassigning through a render callback is a bug waiting to happen.
 */
function allot(hunks: readonly DiffHunk[]): { hunk: DiffHunk; budget: number }[] {
  const out: { hunk: DiffHunk; budget: number }[] = [];
  let remaining = MAX_LINES;
  for (const hunk of hunks) {
    if (remaining <= 0) break;
    out.push({ hunk, budget: remaining });
    remaining -= hunk.lines.length;
  }
  return out;
}

function FileBlock({ file }: { file: FileDiff }) {
  const total = file.hunks.reduce((n, h) => n + h.lines.length, 0);

  return (
    <div className="overflow-hidden rounded-control border border-oe-border bg-oe-bg/40">
      <div className="flex items-center gap-2 border-b border-oe-border px-2.5 py-1.5">
        <span className="min-w-0 flex-1 truncate font-mono text-ui-2xs text-oe-muted">
          {file.path}
        </span>
        {file.added > 0 && <span className="shrink-0 text-ui-2xs text-oe-ok">+{file.added}</span>}
        {file.removed > 0 && <span className="shrink-0 text-ui-2xs text-oe-bad">−{file.removed}</span>}
      </div>

      <div className="oe-scroll overflow-x-auto py-1">
        {allot(file.hunks).map(({ hunk, budget }, i) => (
          <Hunk key={i} hunk={hunk} budget={budget} />
        ))}
      </div>

      {total > MAX_LINES && (
        <div className="border-t border-oe-border px-2.5 py-1.5 text-ui-2xs text-oe-faint">
          {total - MAX_LINES} more lines not shown
        </div>
      )}
    </div>
  );
}

export function DiffView({ jobId }: { jobId: string }) {
  const { data, isPending, error } = useJobDiff(jobId, true);

  if (isPending) {
    return <p className="px-0.5 py-1 text-ui-xs text-oe-faint">Loading diff…</p>;
  }

  if (error) {
    return (
      <p className="px-0.5 py-1 text-ui-xs text-oe-bad">
        Could not load the diff — {(error as Error).message}
      </p>
    );
  }

  if (data.files.length === 0) {
    return (
      <p className="px-0.5 py-1 text-ui-xs text-oe-faint">
        No net change — the file ended up exactly as it started.
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      {data.files.map((file) => (
        <FileBlock key={file.path} file={file} />
      ))}
    </div>
  );
}
