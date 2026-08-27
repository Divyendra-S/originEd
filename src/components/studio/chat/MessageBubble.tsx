"use client";

/**
 * One turn. The user gets a bubble, the agent does not.
 *
 * That asymmetry is deliberate: the user's messages are short and benefit from
 * being visually contained, while the agent's output is the content of the pane
 * and reads better as prose on the page than as a wall of nested boxes.
 *
 * The agent's turn carries no avatar and no nameplate. There are exactly two
 * speakers, one of them is aligned right in a box, and labelling the other one
 * on every single message is the visual equivalent of saying "originEd:" out
 * loud before each sentence.
 */
import type { ToolCallView } from "@/hooks/useJobStream";
import type { JobChanges, MessageRole } from "@/lib/types";
import { ChangeCard } from "./ChangeCard";
import { ContextChip } from "./ContextChip";
import { ToolCard } from "./ToolCard";
import type { TurnAttachment } from "./Transcript";

interface Chip {
  key: string;
  label: string;
  kind: "section" | "element";
  title: string;
  noteCount: number;
}

/** The chips a past turn shows: one per pinned element, or one for the section. */
function chipsFor(attachments: TurnAttachment[]): Chip[] {
  return attachments.flatMap<Chip>((a) =>
    (a.targets ?? []).length > 0
      ? a.targets!.map((t, i) => ({
          key: `${a.sectionSlug}#${t.path.join("-")}-${i}`,
          label: t.label,
          kind: "element" as const,
          title: `${a.label} · ${t.trail}`,
          noteCount: 0,
        }))
      : [
          {
            key: a.sectionSlug,
            label: a.label,
            kind: "section" as const,
            title: a.file,
            noteCount: a.comments?.length ?? 0,
          },
        ],
  );
}

export function MessageBubble({
  role,
  text,
  attachments,
  tools,
  changes,
  pending,
  error,
}: {
  role: MessageRole;
  text: string;
  attachments?: TurnAttachment[];
  tools?: ToolCallView[];
  /** §12 level 2. Absent while the job is still running — the ToolCards are the
   *  live surface, and a receipt for work in progress is a contradiction. */
  changes?: JobChanges;
  /** The model is still typing — show a caret so an empty bubble reads as alive. */
  pending?: boolean;
  error?: string | null;
}) {
  if (role === "user") {
    // The notes that rode along. Worth repeating here rather than only counting:
    // a note is closed by the job that answers it, so after this turn the chip's
    // badge is the only place it ever existed.
    const notes = (attachments ?? []).flatMap((a) =>
      (a.comments ?? []).map((c) => ({ id: c.id, label: a.label, body: c.body })),
    );

    return (
      <div className="oe-rise flex flex-col items-end gap-1.5">
        {attachments && attachments.length > 0 && (
          <div className="flex flex-wrap justify-end gap-1">
            {chipsFor(attachments).map((chip) => (
              <ContextChip
                key={chip.key}
                label={chip.label}
                kind={chip.kind}
                title={chip.title}
                noteCount={chip.noteCount}
              />
            ))}
          </div>
        )}

        {notes.length > 0 && (
          <ul className="max-w-[92%] space-y-0.5 text-right text-ui-xs leading-relaxed text-oe-muted">
            {notes.map((note) => (
              <li key={note.id}>
                <span className="text-oe-faint">{note.label}</span> &ldquo;{note.body}&rdquo;
              </li>
            ))}
          </ul>
        )}

        <div className="max-w-[92%] rounded-card border border-oe-border bg-oe-raised px-3 py-2 text-ui-md leading-relaxed whitespace-pre-wrap text-oe-text">
          {text}
        </div>
      </div>
    );
  }

  return (
    <div className="oe-rise space-y-2.5">
      {tools && tools.length > 0 && (
        <div className="border-l border-oe-border pl-3">
          {tools.map((tool) => (
            <ToolCard key={tool.id} tool={tool} />
          ))}
        </div>
      )}

      {(text.length > 0 || pending) && (
        <div className="text-ui-md leading-[1.7] whitespace-pre-wrap text-oe-text">
          {text}
          {pending && (
            <span className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[0.15em] animate-pulse bg-oe-accent align-middle" />
          )}
        </div>
      )}

      {changes && <ChangeCard changes={changes} />}

      {error && (
        <div className="border-l-2 border-oe-bad py-0.5 pl-3 text-ui-sm text-oe-bad">{error}</div>
      )}
    </div>
  );
}
