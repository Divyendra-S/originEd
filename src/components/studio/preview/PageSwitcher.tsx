"use client";

/**
 * Which page the preview is showing. Top right, next to the status pill, because
 * it is true of the project rather than of the page — the same argument that
 * keeps Browse/Select and the viewport switcher down on the preview's own bar
 * (§10).
 *
 * Every option renders something: there is no "all pages" entry, because
 * stacking two unrelated designs in one scroll is what the switcher exists to
 * stop.
 *
 * A native `<select>`, deliberately. A hand-rolled popover would be forty lines
 * of focus trapping and arrow keys to arrive back at what the platform already
 * does, and the menu is the one piece of chrome here that nobody looks at while
 * it is closed.
 */
import { ChevronDown, Layers } from "lucide-react";

export interface PageOption {
  slug: string;
  label: string;
}

export function PageSwitcher({
  pages,
  value,
  onChange,
}: {
  pages: readonly PageOption[];
  value: string;
  onChange: (slug: string) => void;
}) {
  const label = pages.find((p) => p.slug === value)?.label ?? value;

  return (
    <div className="relative flex items-center">
      <Layers
        className="pointer-events-none absolute left-2 size-3.5 text-oe-faint"
        strokeWidth={1.75}
        aria-hidden
      />

      {/* The visible face. The <select> sits transparent on top of it, so the
          control is the platform's while the type is ours — sizing it off the
          real label is what keeps the box from jumping between page names. */}
      <span className="pointer-events-none flex h-7 items-center rounded-chip border border-oe-border pr-6 pl-7 text-ui-xs text-oe-muted">
        {label}
      </span>
      <ChevronDown
        className="pointer-events-none absolute right-2 size-3 text-oe-faint"
        strokeWidth={1.75}
        aria-hidden
      />

      <select
        aria-label="Page shown in the preview"
        title="Switch which page you are editing"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 cursor-pointer appearance-none bg-transparent text-transparent opacity-0"
      >
        {pages.map((page) => (
          <option key={page.slug} value={page.slug}>
            {page.label}
          </option>
        ))}
      </select>
    </div>
  );
}
