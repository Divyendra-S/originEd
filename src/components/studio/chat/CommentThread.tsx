"use client";

/**
 * The comments on one pinned thing — a section, or one element inside it (§11).
 *
 * It lives in the composer rather than as a popover on the page. The page-side
 * alternative is what a visual editor usually does, and it was rejected for one
 * concrete reason: a comment being typed is STATE, and the preview's foreign DOM
 * lives inside a tree that React re-renders on every hot reload — which is
 * exactly when the agent lands an edit. Losing a half-written comment to the
 * change it was describing is a worse bug than the one the popover would fix.
 * The spatial half survives anyway: the count rides to the page as a badge on
 * the pin's own marker, and the popup in the preview writes one in a keystroke.
 *
 * A SECTION's thread shows the comments left on elements inside it too, each
 * labelled with the element it is on — because a comment must not be orphaned by
 * which of the two the user happened to pin. Anchored to the element's own chip
 * it needs no label; here it does.
 */
import { useEffect, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import type { Comment } from "@/lib/types";

const MAX_BODY = 500;

export function CommentThread({
  anchorKey,
  title,
  where,
  comments,
  onAdd,
  onResolve,
  onClose,
  busy,
}: {
  /** The pin this panel is anchored to. Moves the caret when it changes. */
  anchorKey: string;
  /** What the comments are on: "Hero", or "Get started". */
  title: string;
  /** Which section, for an element. Omitted for a section — it is already said. */
  where?: string;
  /** Open comments shown here, oldest first. */
  comments: Comment[];
  onAdd: (body: string) => void;
  onResolve: (id: string) => void;
  onClose: () => void;
  busy?: boolean;
}) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  // The panel only opens because the user asked for it, so the caret belongs
  // here. Re-runs on the anchor so switching chips moves it rather than
  // stranding it on the one you just left.
  useEffect(() => {
    ref.current?.focus();
  }, [anchorKey]);

  function submit() {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    onAdd(trimmed);
    setText("");
  }

  return (
    <div className="mb-2 rounded-chip border border-oe-border bg-oe-bg p-2">
      <div className="mb-1.5 flex items-center gap-1.5 px-0.5">
        <span className="oe-label truncate text-oe-faint">Comments on {title}</span>
        {where && <span className="shrink-0 text-ui-2xs text-oe-faint/70">in {where}</span>}
        <span className="flex-1" />
        <button
          type="button"
          onClick={onClose}
          aria-label="Close comments"
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
                {/* Only when it is not obvious. On the element's own chip every
                    comment is about that element, and prefixing all of them
                    with its name would be noise on every line. */}
                {comment.targetLabel && comment.targetKey !== anchorKey && (
                  <span className="mr-1 text-oe-accent-soft">{comment.targetLabel}:</span>
                )}
                {comment.body}
              </span>
              <button
                type="button"
                onClick={() => onResolve(comment.id)}
                aria-label="Resolve this comment"
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
        placeholder={comments.length > 0 ? "Add another comment…" : `What should change about ${title}?`}
        className="w-full resize-none rounded-control bg-oe-raised px-2 py-1.5 text-ui-sm leading-relaxed text-oe-text placeholder:text-oe-faint focus:outline-none focus:ring-1 focus:ring-oe-accent/40"
      />

      <p className="px-0.5 pt-1 text-ui-2xs text-oe-faint">
        Comments ride along with your next message and close when it lands.
      </p>
    </div>
  );
}
