"use client";

import { X } from "lucide-react";

/**
 * One pinned thing. On send, the server snapshots its section's file VERBATIM
 * into the job's frozen context (§5) — the chip is the visible half of the
 * headline feature.
 *
 * Deliberately prop-shaped rather than typed to `Pinned`: the composer renders
 * live pins and a past turn renders what was frozen into the message, and those
 * are two different objects that happen to look the same on screen. Passing the
 * four strings it actually draws keeps one component instead of two.
 *
 * `onFocus` makes it a control as well as a label: the chip and the marker in
 * the preview are two views of one thing, so clicking either should take you to
 * the other (§11).
 */
export function ContextChip({
  label,
  kind,
  title,
  noteCount = 0,
  notesOpen,
  onFocus,
  onNotes,
  onRemove,
}: {
  label: string;
  /** An element pin gets a filled mark; a whole section gets a hollow one. */
  kind: "section" | "element";
  title?: string;
  noteCount?: number;
  notesOpen?: boolean;
  onFocus?: () => void;
  onNotes?: () => void;
  onRemove?: () => void;
}) {
  const mark = (
    <span
      aria-hidden
      className={`size-[5px] shrink-0 rounded-[1px] ${
        kind === "element" ? "bg-oe-accent" : "border border-oe-accent"
      }`}
    />
  );

  return (
    <span
      title={title}
      className={`group inline-flex max-w-[15rem] items-center gap-1.5 rounded-chip border py-[3px] pl-2 pr-1.5 text-ui-xs text-oe-text transition-colors ${
        notesOpen ? "border-oe-accent-border bg-oe-accent-bg" : "border-oe-border bg-oe-raised"
      }`}
    >
      {onFocus ? (
        <button
          type="button"
          onClick={onFocus}
          aria-label={`Show ${label} in the preview`}
          className="-my-[3px] -ml-2 flex min-w-0 items-center gap-1.5 py-[3px] pl-2 transition-colors hover:text-oe-accent-soft"
        >
          {mark}
          <span className="truncate">{label}</span>
        </button>
      ) : (
        <>
          {mark}
          <span className="truncate">{label}</span>
        </>
      )}

      {onNotes ? (
        <button
          type="button"
          onClick={onNotes}
          aria-label={`Comments on ${label}`}
          aria-expanded={Boolean(notesOpen)}
          className={`shrink-0 font-mono text-ui-2xs tabular-nums transition-colors ${
            notesOpen || noteCount > 0
              ? "text-oe-accent-soft"
              : "text-oe-faint hover:text-oe-text"
          }`}
        >
          {noteCount > 0 ? `${noteCount}n` : "+"}
        </button>
      ) : (
        noteCount > 0 && (
          <span
            className="shrink-0 font-mono text-ui-2xs tabular-nums text-oe-muted"
            title={`${noteCount} comment${noteCount === 1 ? "" : "s"} sent with this message`}
          >
            {noteCount}n
          </span>
        )
      )}

      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Unpin ${label}`}
          className="-mr-0.5 shrink-0 rounded-[3px] p-0.5 text-oe-faint transition-colors hover:bg-oe-border-strong hover:text-oe-text"
        >
          <X className="size-2.5" strokeWidth={2} />
        </button>
      )}
    </span>
  );
}
