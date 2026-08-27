"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import type { ToolCallView } from "@/hooks/useJobStream";
import type { AttachedSection, JobChanges, MessageRole } from "@/lib/types";
import { MessageBubble } from "./MessageBubble";

/**
 * What a past turn remembers about a pin. `comments` is optional because the
 * optimistic bubble is built before the server has snapshotted anything — the
 * persisted row that replaces it carries them.
 */
export type TurnAttachment = Pick<AttachedSection, "sectionSlug" | "label" | "file"> &
  Partial<Pick<AttachedSection, "comments" | "targets">>;

export interface TranscriptTurn {
  id: string;
  role: MessageRole;
  text: string;
  attachments?: TurnAttachment[];
  tools?: ToolCallView[];
  changes?: JobChanges;
  pending?: boolean;
  error?: string | null;
}

/**
 * Typographic, not an icon tile. An empty chat is the first thing anyone sees,
 * and a gradient badge over two lines of grey is what every generated dashboard
 * opens with. What the user needs here is the one sentence that explains the
 * gesture they would never guess.
 */
function EmptyState() {
  return (
    <div className="flex flex-1 flex-col justify-end gap-6 px-4 pb-6">
      <div className="space-y-3">
        <p className="oe-label text-oe-faint">Start</p>
        <p className="max-w-[22rem] text-[15px] leading-[1.6] text-oe-text">
          Describe a change to the page — or{" "}
          <span className="text-oe-accent">drag a box</span> over any part of the preview to
          pin it, and say what should happen to it.
        </p>
      </div>

      <ul className="space-y-1 border-t border-oe-border pt-3 font-mono text-ui-2xs text-oe-faint">
        <li className="flex gap-2">
          <span className="w-14 shrink-0 text-oe-muted">click</span>pin one element
        </li>
        <li className="flex gap-2">
          <span className="w-14 shrink-0 text-oe-muted">drag</span>pin a region, then comment
        </li>
        <li className="flex gap-2">
          <span className="w-14 shrink-0 text-oe-muted">S / B</span>select and browse modes
        </li>
      </ul>
    </div>
  );
}

export function Transcript({ turns }: { turns: TranscriptTurn[] }) {
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  // Only follow the stream if the user hasn't scrolled up to read something.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onScroll = () => {
      stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // Layout effect, not effect: tokens land many times a second and a post-paint
  // scroll shows a frame of the wrong position each time.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  });

  if (turns.length === 0) return <EmptyState />;

  return (
    <div ref={scroller} className="oe-scroll flex-1 space-y-5 overflow-y-auto px-3 py-4">
      {turns.map((turn) => (
        <MessageBubble
          key={turn.id}
          role={turn.role}
          text={turn.text}
          attachments={turn.attachments}
          tools={turn.tools}
          changes={turn.changes}
          pending={turn.pending}
          error={turn.error}
        />
      ))}
    </div>
  );
}
