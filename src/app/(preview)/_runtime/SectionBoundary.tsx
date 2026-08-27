import type { ReactNode } from "react";

/**
 * Every section is wrapped in one of these. The `data-section-*` attributes are
 * the entire contract with the Inspector (§11): it resolves a click with
 * `event.target.closest("[data-section-slug]")` and highlights by toggling a
 * class on this element — no coordinate math, so the outline stays correct
 * through scroll, resize, and the hero's canvas animation.
 *
 * OUTSIDE THE JAIL, like `Inspector.tsx` and for the same reason (§14 risk 11).
 * It used to live at `workspace/_runtime/SectionBoundary.tsx`, where the agent
 * could edit it — and a dropped attribute here does not break a section, it
 * breaks selection, pins and notes for the whole page, with no type error and
 * nothing on screen to say why. `workspace/page.tsx` imports it by alias, which
 * is the one import the workspace makes out of its own tree.
 *
 * Not a client component: it renders a div and nothing else.
 */
export function SectionBoundary({
  slug,
  label,
  file,
  children,
}: {
  slug: string;
  label: string;
  file: string;
  children: ReactNode;
}) {
  return (
    <div
      data-section-slug={slug}
      data-section-label={label}
      data-section-file={file}
      className="oe-section relative"
    >
      {children}
    </div>
  );
}
