"use client";

/**
 * §12 level 2, and deliberately boring: how many files, which SECTIONS (not
 * paths), and two buttons. The preview is the primary output — this is the
 * receipt, and it should not compete with it.
 */
import { useEffect, useState } from "react";
import { FileDiff } from "lucide-react";
import { useRestoreJob } from "@/hooks/useJobDiff";
import type { JobChanges } from "@/lib/types";
import { DiffView } from "./DiffView";

/** Restore overwrites real files and there is no redo, so it asks once. */
const CONFIRM_MS = 4000;

function summarize(changes: JobChanges): string {
  const names = changes.files.map((f) => f.label ?? f.path.split("/").pop() ?? f.path);
  const count = `${changes.files.length} file${changes.files.length === 1 ? "" : "s"} changed`;
  return names.length > 0 ? `${count} · ${names.join(", ")}` : count;
}

export function ChangeCard({ changes }: { changes: JobChanges }) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const restore = useRestoreJob();

  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => setConfirming(false), CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [confirming]);

  if (changes.files.length === 0) return null;

  const onRestore = () => {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    restore.mutate(changes.jobId);
  };

  return (
    <div className="space-y-2 rounded-card border border-oe-border bg-oe-raised p-2.5">
      <div className="flex items-center gap-2">
        <FileDiff
          aria-hidden
          strokeWidth={1.6}
          className={`size-3.5 shrink-0 ${changes.reverted ? "text-oe-faint" : "text-oe-accent"}`}
        />

        <span
          className={`min-w-0 flex-1 truncate text-ui-xs ${
            changes.reverted ? "text-oe-faint line-through" : "text-oe-text"
          }`}
        >
          {summarize(changes)}
        </span>

        {changes.reverted ? (
          <span className="oe-label shrink-0 rounded-chip bg-oe-bg px-1.5 py-1 text-oe-faint">
            Restored
          </span>
        ) : (
          <button
            type="button"
            onClick={onRestore}
            disabled={restore.isPending}
            className={`shrink-0 rounded-chip px-2 py-1 text-ui-xs font-medium transition-colors disabled:opacity-50 ${
              confirming
                ? "bg-oe-bad/15 text-oe-bad hover:bg-oe-bad/25"
                : "text-oe-muted hover:bg-oe-bg hover:text-oe-text"
            }`}
          >
            {restore.isPending ? "Restoring…" : confirming ? "Confirm" : "Restore"}
          </button>
        )}

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="shrink-0 rounded-chip px-2 py-1 text-ui-xs font-medium text-oe-muted transition-colors hover:bg-oe-bg hover:text-oe-text"
        >
          {open ? "Hide" : "Review"}
        </button>
      </div>

      {restore.isError && (
        <p className="text-ui-xs leading-relaxed text-oe-bad">
          {(restore.error as Error).message}
        </p>
      )}

      {open && <DiffView jobId={changes.jobId} />}
    </div>
  );
}
