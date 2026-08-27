"use client";

/**
 * The right pane: its own bar, then the live page on a dark canvas.
 *
 * Same app, same origin, different root layout (§10). Same-origin is what makes
 * the postMessage bridge and click interception possible at all; the iframe is
 * what keeps the workspace's CSS out of the editor chrome.
 *
 * The card is inset rather than edge-to-edge so the viewport switcher has
 * somewhere to go — a 390px frame welded to the pane edge reads as a broken
 * layout, whereas a 390px card centred on a canvas reads as a phone.
 */
import type { RefObject } from "react";
import { RotateCw } from "lucide-react";
import type { PreviewMode } from "@/lib/types";
import type { PreviewStatus } from "@/hooks/usePreviewBridge";
import { PreviewToolbar } from "./PreviewToolbar";
import { viewportById, type ViewportId } from "./viewport";

export function PreviewCanvas({
  frameRef,
  mode,
  onModeChange,
  viewport,
  onViewportChange,
  status,
  ready,
  onReload,
  pinCount,
  pinSummary,
}: {
  frameRef: RefObject<HTMLIFrameElement | null>;
  mode: PreviewMode;
  onModeChange: (mode: PreviewMode) => void;
  viewport: ViewportId;
  onViewportChange: (viewport: ViewportId) => void;
  status: PreviewStatus;
  ready: boolean;
  onReload: () => void;
  pinCount: number;
  pinSummary: string;
}) {
  const width = viewportById(viewport).width;
  const error = status.buildError;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col bg-oe-canvas">
      <PreviewToolbar
        mode={mode}
        onModeChange={onModeChange}
        viewport={viewport}
        onViewportChange={onViewportChange}
        pinCount={pinCount}
        pinSummary={pinSummary}
      />

      <div className="flex min-h-0 flex-1 items-stretch justify-center p-4">
        <div
          className="relative flex min-h-0 w-full flex-col overflow-hidden rounded-card bg-white ring-1 ring-oe-border-strong transition-[max-width] duration-300 ease-out"
          style={width ? { maxWidth: width } : undefined}
        >
          <iframe
            ref={frameRef}
            src="/preview"
            title="Preview"
            className="size-full border-0"
            // Same-origin by design — sandboxing it would break the bridge.
          />

          {/* Select mode: the studio takes the clicks, the page doesn't. The
              outlines and the marquee are drawn by the Inspector INSIDE the
              frame; this is only the affordance that the mode is armed. */}
          {mode === "select" && (
            <div className="pointer-events-none absolute inset-0 rounded-card ring-1 ring-inset ring-oe-accent/40" />
          )}

          {!ready && !error && (
            <div className="absolute inset-0 flex items-center justify-center bg-oe-canvas font-mono text-ui-2xs text-oe-faint">
              connecting to preview…
            </div>
          )}

          {/* Next's dev error overlay renders INSIDE the iframe, so without
              surfacing build errors out here a broken edit just looks like a
              frozen preview — the most confusing failure mode in a tool like
              this. It covers the card because a half-rendered page under a red
              banner invites the user to trust what they can still see. */}
          {error && (
            <div className="oe-rise absolute inset-0 flex flex-col gap-3 overflow-auto bg-oe-bad-canvas p-6">
              <div className="flex items-center gap-2">
                <span className="size-1.5 shrink-0 rounded-full bg-oe-bad" aria-hidden />
                <span className="oe-label text-oe-bad">Build error</span>
                <button
                  type="button"
                  onClick={onReload}
                  className="ml-auto flex items-center gap-1.5 rounded-chip border border-oe-bad-border px-2 py-1 text-ui-xs text-oe-del-text transition-colors hover:bg-oe-bad-bg"
                >
                  <RotateCw className="size-3" strokeWidth={1.75} />
                  Reload
                </button>
              </div>
              <pre className="whitespace-pre-wrap font-mono text-ui-sm leading-relaxed text-oe-del-text">
                {error.message}
              </pre>
              <p className="text-ui-sm text-oe-muted">
                Describe the fix in the chat — the agent can read the file and repair it.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
