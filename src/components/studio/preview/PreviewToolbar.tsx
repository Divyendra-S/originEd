"use client";

/**
 * The preview's own bar: modes on the left, what is pinned in the middle,
 * viewport on the right.
 *
 * It used to float over the bottom of the canvas as a rounded pill. That is the
 * house style of every AI-generated builder, and it has a concrete cost as well
 * as a stylistic one: it sat on top of the page's own footer, so the bottom
 * ~64px of the thing being edited were permanently behind a control bar. A bar
 * docked above the frame acts on the page from outside it and covers nothing.
 *
 * There is deliberately no Comment mode: a note is written where the selection
 * is made — in the popup the drag opens — or in the composer (§11).
 */
import { MousePointer2, Smartphone, SquareDashed, Tablet, Monitor } from "lucide-react";
import type { PreviewMode } from "@/lib/types";
import { VIEWPORTS, type ViewportId } from "./viewport";

const TOOLS: { mode: PreviewMode; label: string; hint: string; key: string; icon: typeof Monitor }[] = [
  {
    mode: "browse",
    label: "Browse",
    hint: "Interact with the page normally",
    key: "B",
    icon: MousePointer2,
  },
  {
    mode: "select",
    label: "Select",
    hint: "Click an element, or drag a box over a region",
    key: "S",
    icon: SquareDashed,
  },
];

const VIEWPORT_ICONS: Record<ViewportId, typeof Monitor> = {
  desktop: Monitor,
  tablet: Tablet,
  mobile: Smartphone,
};

export function PreviewToolbar({
  mode,
  onModeChange,
  viewport,
  onViewportChange,
  pinCount,
  pinSummary,
}: {
  mode: PreviewMode;
  onModeChange: (mode: PreviewMode) => void;
  viewport: ViewportId;
  onViewportChange: (viewport: ViewportId) => void;
  pinCount: number;
  pinSummary: string;
}) {
  return (
    <div className="flex h-10 shrink-0 items-center gap-3 border-b border-oe-border px-3">
      <div className="flex items-center gap-0.5">
        {TOOLS.map((tool) => {
          const active = mode === tool.mode;
          const Icon = tool.icon;
          return (
            <button
              key={tool.mode}
              type="button"
              title={`${tool.hint} (${tool.key})`}
              aria-pressed={active}
              onClick={() => onModeChange(tool.mode)}
              className={`flex items-center gap-1.5 rounded-chip px-2 py-1 text-ui-xs transition-colors ${
                active
                  ? "bg-oe-accent-bg text-oe-accent-soft"
                  : "text-oe-faint hover:bg-oe-border hover:text-oe-muted"
              }`}
            >
              <Icon className="size-3.5" strokeWidth={1.75} />
              {tool.label}
            </button>
          );
        })}
      </div>

      {/* What the next message is carrying, from the page's side of the app.
          The composer says the same thing; this is the half you can read while
          your eyes are on the page rather than on the chat. */}
      <span className="min-w-0 flex-1 truncate font-mono text-ui-2xs text-oe-faint" title={pinSummary}>
        {pinCount > 0 ? `${pinCount} pinned — ${pinSummary}` : ""}
      </span>

      <div className="flex items-center gap-0.5">
        {VIEWPORTS.map((v) => {
          const active = viewport === v.id;
          const Icon = VIEWPORT_ICONS[v.id];
          return (
            <button
              key={v.id}
              type="button"
              title={v.label + (v.width ? ` · ${v.width}px` : "")}
              aria-pressed={active}
              onClick={() => onViewportChange(v.id)}
              className={`rounded-chip p-1.5 transition-colors ${
                active
                  ? "bg-oe-border-strong text-oe-text"
                  : "text-oe-faint hover:bg-oe-border hover:text-oe-muted"
              }`}
            >
              <Icon className="size-3.5" strokeWidth={1.75} />
              <span className="sr-only">{v.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
