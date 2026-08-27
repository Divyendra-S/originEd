"use client";

/**
 * The input. Pinned targets live INSIDE the box rather than above it, because
 * they are part of the message being composed — the same reason an attachment
 * sits inside a draft email and not next to it.
 *
 * The text is controlled from above. That is not ceremony: a note typed into the
 * popup inside the preview has to land here, and a composer that owns its own
 * draft has no door for it.
 */
import { useEffect, useMemo, useRef } from "react";
import { ArrowUp, Square } from "lucide-react";
import type { Comment } from "@/lib/types";
import { isWholeSection, pinLabel, type Pinned } from "@/hooks/usePins";
import { CommentThread } from "./CommentThread";
import { ContextChip } from "./ContextChip";

/** One object rather than six props — the notes are one feature, not six. */
export interface ComposerNotes {
  /** Open-note count per pin key, for the chip badges. */
  counts: ReadonlyMap<string, number>;
  /** The section whose thread is expanded, if any. */
  openSlug: string | null;
  setOpenSlug: (slug: string | null) => void;
  forSection: (slug: string) => Comment[];
  add: (slug: string, body: string) => void;
  resolve: (id: string) => void;
  busy: boolean;
}

export function Composer({
  attachments,
  notes,
  value,
  onChange,
  focusToken,
  onRemoveAttachment,
  onFocusAttachment,
  onSend,
  onCancel,
  busy,
}: {
  attachments: Pinned[];
  notes: ComposerNotes;
  value: string;
  onChange: (text: string) => void;
  /**
   * Bumped when text arrives from somewhere other than this box — the popup
   * inside the preview. Without it the note lands in a composer the user is not
   * looking at and cannot send without hunting for it with the mouse.
   */
  focusToken: number;
  onRemoveAttachment: (key: string) => void;
  /** Scroll to and pulse this pin's section in the preview. */
  onFocusAttachment: (slug: string) => void;
  onSend: (text: string) => void;
  onCancel?: () => void;
  busy: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // Grow with the content instead of scrolling inside two rows.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [value]);

  useEffect(() => {
    if (focusToken > 0) ref.current?.focus();
  }, [focusToken]);

  function submit() {
    const trimmed = value.trim();
    if (!trimmed || busy) return;
    onSend(trimmed);
    ref.current?.focus();
  }

  const canSend = value.trim().length > 0 && !busy;

  // The thread follows the pin. Unpinning the section whose notes are open
  // leaves nothing to anchor the panel to, so it closes with it.
  const openSection = useMemo(
    () => attachments.find((p) => isWholeSection(p) && p.key === notes.openSlug) ?? null,
    [attachments, notes.openSlug],
  );

  const totalNotes = useMemo(
    () => attachments.reduce((sum, p) => sum + (notes.counts.get(p.key) ?? 0), 0),
    [attachments, notes.counts],
  );

  const summary =
    attachments.length === 0
      ? "Drag over the preview to pin a region"
      : `${attachments.length} pinned${totalNotes > 0 ? ` · ${totalNotes} note${totalNotes === 1 ? "" : "s"}` : ""}`;

  return (
    <div className="shrink-0 px-3 pb-3">
      <div className="rounded-card border border-oe-border bg-oe-raised transition-colors focus-within:border-oe-border-strong">
        {openSection && (
          <div className="p-2 pb-0">
            <CommentThread
              section={{
                slug: openSection.sectionSlug,
                label: openSection.sectionLabel,
                file: openSection.file,
              }}
              comments={notes.forSection(openSection.sectionSlug)}
              onAdd={(body) => notes.add(openSection.sectionSlug, body)}
              onResolve={notes.resolve}
              onClose={() => notes.setOpenSlug(null)}
              busy={notes.busy}
            />
          </div>
        )}

        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-1 p-2 pb-0">
            {attachments.map((pin) => (
              <ContextChip
                key={pin.key}
                label={pinLabel(pin)}
                kind={isWholeSection(pin) ? "section" : "element"}
                title={isWholeSection(pin) ? pin.file : `${pin.sectionLabel} · ${pin.ref.trail}`}
                noteCount={notes.counts.get(pin.key) ?? 0}
                notesOpen={notes.openSlug === pin.key}
                onFocus={() => onFocusAttachment(pin.sectionSlug)}
                // Notes are anchored to a section, so only a section pin offers
                // the control. An element chip that opened its section's thread
                // would claim the note belongs to the element, and it does not.
                onNotes={
                  isWholeSection(pin)
                    ? () => notes.setOpenSlug(notes.openSlug === pin.key ? null : pin.key)
                    : undefined
                }
                onRemove={() => onRemoveAttachment(pin.key)}
              />
            ))}
          </div>
        )}

        <textarea
          ref={ref}
          rows={1}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends; Shift+Enter is a newline.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Describe a change…"
          className="oe-scroll max-h-52 w-full resize-none bg-transparent px-3 pt-3 pb-1 text-ui-md leading-relaxed text-oe-text placeholder:text-oe-faint focus:outline-none"
        />

        <div className="flex items-center justify-between gap-2 px-2 pb-2 pl-3">
          <span className="truncate font-mono text-ui-2xs tracking-tight text-oe-faint">
            {summary}
          </span>

          {busy && onCancel ? (
            <button
              type="button"
              onClick={onCancel}
              aria-label="Stop"
              className="flex size-7 shrink-0 items-center justify-center rounded-chip border border-oe-border-strong text-oe-muted transition-colors hover:border-oe-bad hover:text-oe-bad"
            >
              <Square className="size-2.5 fill-current" strokeWidth={0} />
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={!canSend}
              aria-label="Send"
              className="flex size-7 shrink-0 items-center justify-center rounded-chip bg-oe-accent text-black transition-colors enabled:hover:bg-oe-accent-soft disabled:bg-oe-border-strong disabled:text-oe-faint"
            >
              <ArrowUp className="size-4" strokeWidth={2.2} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
