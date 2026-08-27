"use client";

/**
 * The "is it actually working" signal, in the top bar (§10).
 *
 * A compile time is not interesting information, so it is rendered quietly. A
 * build error IS interesting, so it changes colour and stops being a pill.
 */
import { RotateCw } from "lucide-react";
import type { PreviewStatus } from "@/hooks/usePreviewBridge";

export function StatusPill({
  status,
  ready,
  onReload,
}: {
  status: PreviewStatus;
  ready: boolean;
  onReload: () => void;
}) {
  const error = status.buildError;
  const tone = error ? "bg-oe-bad" : ready ? "bg-oe-ok" : "bg-oe-warn";

  return (
    <div className="flex items-center gap-2">
      <span
        className={`flex items-center gap-1.5 font-mono text-ui-2xs transition-colors ${
          error ? "text-oe-bad" : "text-oe-faint"
        }`}
      >
        <span aria-hidden className={`size-1.5 rounded-[1px] ${tone}`} />
        {error
          ? "Build error"
          : ready
            ? status.compiledMs !== null
              ? `${status.compiledMs}ms`
              : "Live"
            : "Connecting"}
      </span>

      <button
        type="button"
        onClick={onReload}
        title="Reload the preview"
        aria-label="Reload the preview"
        className="rounded-chip p-1 text-oe-faint transition-colors hover:bg-oe-border hover:text-oe-text"
      >
        <RotateCw className="size-3.5" strokeWidth={1.75} />
      </button>
    </div>
  );
}
