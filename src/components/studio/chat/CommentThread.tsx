"use client";

/**
 * The notes on one pinned section (§11).
 *
 * It lives in the composer rather than as a popover on the page. The page-side
 * alternative is what a visual editor usually does, and it was rejected for one
 * concrete reason: a note being typed is STATE, and the preview's foreign DOM
 * lives inside a tree that React re-renders on every hot reload — which is
 * exactly when the agent lands an edit. Losing a half-written note to the
 * change it was describing is a worse bug than the one the popover would fix.
 * The spatial half survives anyway: the count rides to the page as a badge on
 * the section's own pin marker.
 */
import { useEffect, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import type { Comment, SectionInfo } from "@/lib/types";

const MAX_BODY = 500;

export function CommentThread({
  section,
  comments,
  onAdd,
  onResolve,
  onClose,
  busy,
}: {
  section: SectionInfo;
  /** Open notes on this section, oldest first. */
  comments: Comment[];
  onAdd: (body: string) => void;
  onResolve: (id: string) => void;
  onClose: () => void;
  busy?: boolean;
}) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  // The panel only opens because the user asked for it, so the caret belongs
  // here. Re-runs on slug so switching sections moves it rather than stranding
  // it on the section you just left.
  useEffect(() => {
    ref.current?.focus();
  }, [section.slug]);

  function submit() {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    onAdd(trimmed);
    setText("");
  }

  return (
    <div className="mb-2 rounded-chip border border-oe-border bg-oe-bg p-2">
      <div className="mb-1.5 flex items-center gap-1.5 px-0.5">
        <span className="oe-label truncate text-oe-faint">Notes on {section.label}</span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={onClose}
          aria-label="Close notes"
          className="rounded p-0.5 text-oe-faint transition-colors hover:bg-oe-border-strong hover:text-oe-text"
        >
          <X className="size-2.5" strokeWidth={2} />
        </button>
      </div>

      {comments.length > 0 && (
        <ul className="mb-1.5 space-y-1">
          {comments.map((comment) => (
            <li
              key={comment.id}
              className="group flex items-start gap-1.5 rounded-control bg-oe-raised px-2 py-1.5"
            >
              <span className="mt-1 size-1.5 shrink-0 rounded-full bg-oe-accent" aria-hidden />
              <span className="min-w-0 flex-1 text-ui-sm leading-relaxed break-words text-oe-text">
                {comment.body}
              </span>
              <button
                type="button"
                onClick={() => onResolve(comment.id)}
                aria-label="Resolve this note"
                title="Resolve"
                className="mt-0.5 rounded p-0.5 text-oe-faint opacity-0 transition-all group-hover:opacity-100 hover:bg-oe-border-strong hover:text-oe-ok focus:opacity-100"
              >
                <Check className="size-3" strokeWidth={2} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <textarea
        ref={ref}
        rows={1}
        value={text}
        maxLength={MAX_BODY}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
          // Esc closes the panel, not the whole Select mode — the preview's
          // Esc handler is on `window` and this stops it getting there.
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
          }
        }}
        placeholder={comments.length > 0 ? "Add another note…" : `What's wrong with ${section.label}?`}
        className="w-full resize-none rounded-control bg-oe-raised px-2 py-1.5 text-ui-sm leading-relaxed text-oe-text placeholder:text-oe-faint focus:outline-none focus:ring-1 focus:ring-oe-accent/40"
      />

      <p className="px-0.5 pt-1 text-ui-2xs text-oe-faint">
        Notes ride along with your next message and close when it lands.
      </p>
    </div>
  );
}
