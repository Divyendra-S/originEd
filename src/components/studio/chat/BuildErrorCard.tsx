"use client";

/**
 * A broken preview, said out loud (§12).
 *
 * It sits above the composer rather than in the transcript because it is not
 * something anyone said — it is the current state of the page, and it should
 * disappear when that state changes. A row in the transcript would still be
 * there tomorrow claiming the page is broken.
 *
 * The "Fix it" button is the whole point. Without it the user has to read a
 * stack trace, work out which section it came from, and retype it — which is
 * the moment most people give up and reload.
 */
import { AlertCircle, X } from "lucide-react";

export function BuildErrorCard({
  error,
  onFix,
  onReload,
  onDismiss,
  busy,
}: {
  error: { message: string; stack?: string };
  onFix: () => void;
  onReload: () => void;
  onDismiss: () => void;
  busy: boolean;
}) {
  return (
    <div className="mx-3 mb-2 rounded-card border border-oe-bad-border bg-oe-bad-bg p-2.5">
      <div className="flex items-start gap-2">
        <AlertCircle aria-hidden strokeWidth={1.6} className="mt-0.5 size-3.5 shrink-0 text-oe-bad" />

        <div className="min-w-0 flex-1">
          <p className="oe-label text-oe-bad">The preview is broken</p>
          <p className="mt-1 line-clamp-4 text-ui-sm leading-relaxed break-words text-oe-text">
            {error.message}
          </p>
        </div>

        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="rounded p-0.5 text-oe-faint transition-colors hover:bg-oe-border-strong hover:text-oe-text"
        >
          <X className="size-2.5" strokeWidth={2} />
        </button>
      </div>

      <div className="mt-2 flex items-center gap-1.5 pl-[22px]">
        <button
          type="button"
          onClick={onFix}
          disabled={busy}
          className="rounded-chip bg-oe-bad px-2.5 py-1 text-ui-xs font-medium text-black transition-opacity disabled:opacity-50"
        >
          {busy ? "Working…" : "Ask originEd to fix it"}
        </button>
        <button
          type="button"
          onClick={onReload}
          className="rounded-chip border border-oe-border px-2.5 py-1 text-ui-xs text-oe-muted transition-colors hover:border-oe-border-strong hover:text-oe-text"
        >
          Reload preview
        </button>
      </div>
    </div>
  );
}
