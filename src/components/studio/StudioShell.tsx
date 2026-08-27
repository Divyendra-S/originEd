"use client";

/**
 * The split (§10): chat on the left, the live page on the right, one route.
 *
 * The proportions are the product's argument, and they are roughly 20/80. The
 * page under edit IS the work; the conversation is the instrument you hold while
 * doing it. A chat column at a third of the screen makes the tool look like a
 * chatbot that happens to render a preview, which is backwards. The divider is
 * draggable because "roughly" is a judgement the user is better placed to make.
 *
 * This is also where the §13 seam lives. The transcript is a TanStack Query
 * snapshot. The in-flight job is a reducer fed by SSE. They meet in exactly one
 * place — `onDone` invalidates the chat, the persisted model turn arrives, and
 * the live bubble stops being rendered.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useChat, useSendMessage } from "@/hooks/useChat";
import {
  COMMENTS_KEY,
  countBySection,
  targetsWithNotes,
  useAddComment,
  useComments,
  useResolveComment,
} from "@/hooks/useComments";
import { useCancelJob, useJobStream } from "@/hooks/useJobStream";
import { usePreviewBridge } from "@/hooks/usePreviewBridge";
import {
  addPins as mergePins,
  isWholeSection,
  pinLabel,
  toPinPayload,
  usePins,
  type Pinned,
} from "@/hooks/usePins";
import type { Attachment, Comment, JobChanges, PreviewMode } from "@/lib/types";
import { labelForSlug, pageForSection, pages } from "@/workspace/manifest";
import { BuildErrorCard } from "./chat/BuildErrorCard";
import { Composer, type ComposerNotes } from "./chat/Composer";
import { toolLabel } from "./chat/ToolCard";
import { Transcript, type TranscriptTurn, type TurnAttachment } from "./chat/Transcript";
import { PageSwitcher } from "./preview/PageSwitcher";
import { PreviewCanvas } from "./preview/PreviewCanvas";
import { StatusPill } from "./preview/StatusPill";
import type { ViewportId } from "./preview/viewport";

/** The optimistic user turn, held until the persisted row with `serverId` lands. */
interface PendingUser {
  text: string;
  attachments: TurnAttachment[];
  serverId: string | null;
}

const SPLIT_MIN = 18;
const SPLIT_MAX = 44;
const SPLIT_DEFAULT = 22;

/**
 * The wire form of a pin. A whole section is a bare slug and always has been —
 * which is what keeps every stored row, every route test and the server's
 * existing schema valid without a migration.
 */
function toWire(pin: Pinned): Attachment {
  if (isWholeSection(pin)) return pin.sectionSlug;
  const { sectionSlug, path, tag, text, label, trail, nth } = pin.ref;
  return { sectionSlug, path, tag, text, label, trail, nth };
}

/**
 * The optimistic bubble's attachments, bucketed the way the server buckets them:
 * one entry per SECTION, carrying the elements pinned inside it. Two different
 * groupings between the optimistic turn and the persisted one would make the
 * chips visibly rearrange the instant the row lands.
 */
function groupForBubble(pins: readonly Pinned[], notesFor: (slug: string) => Comment[]): TurnAttachment[] {
  const bySection = new Map<string, TurnAttachment>();
  for (const pin of pins) {
    let entry = bySection.get(pin.sectionSlug);
    if (!entry) {
      entry = {
        sectionSlug: pin.sectionSlug,
        label: pin.sectionLabel,
        file: pin.file,
        comments: notesFor(pin.sectionSlug).map((c) => ({
          id: c.id,
          body: c.body,
          status: c.status,
        })),
        targets: [],
      };
      bySection.set(pin.sectionSlug, entry);
    }
    if (!isWholeSection(pin)) entry.targets!.push(pin.ref);
  }
  return [...bySection.values()];
}

/**
 * Seconds since this mounted, and it is mounted only while a turn is in flight.
 *
 * Not decoration, and a component rather than a flag for a reason: most of a
 * turn is one silent gap — the model composing its next step over a large
 * context, with no tool call and no token to show for it. Measured on a
 * one-line edit: the file landed in the preview at 3s and the job ran for
 * another 53, 44 of them with nothing on screen changing at all. A spinner over
 * that is indistinguishable from a hang; a clock is not. Mounting it with the
 * turn is what makes it start at zero without an effect resetting anything.
 */
function Elapsed() {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const startedAt = Date.now();
    const id = setInterval(() => setSeconds(Math.round((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  return seconds > 0 ? <> {seconds}s</> : null;
}

export function StudioShell() {
  const preview = usePreviewBridge();
  const queryClient = useQueryClient();

  const pins = usePins();

  const [chatId, setChatId] = useState<string | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  /** The section whose notes are expanded in the composer, if any (§11). */
  const [openNotes, setOpenNotes] = useState<string | null>(null);
  const [pendingUser, setPendingUser] = useState<PendingUser | null>(null);
  const [viewport, setViewport] = useState<ViewportId>("desktop");
  const [split, setSplit] = useState(SPLIT_DEFAULT);
  /**
   * The composer's text lives here, not in the composer, because a note typed
   * into the popup inside the preview has to be able to land in it.
   */
  const [draft, setDraft] = useState("");
  /** Bumped when the preview's popup hands a note over, to move the caret here. */
  const [draftFocus, setDraftFocus] = useState(0);

  const splitRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const transcript = useChat(chatId);
  const sendMessage = useSendMessage();
  const cancelJob = useCancelJob();

  const comments = useComments();
  const addComment = useAddComment();
  const resolveComment = useResolveComment();

  const openComments = useMemo(() => comments.data ?? [], [comments.data]);
  // Keyed by section slug — which IS the pin key for a whole-section pin. Notes
  // are anchored to sections, so an element pin's badge is legitimately empty.
  const noteCounts = useMemo(() => countBySection(openComments), [openComments]);

  const { flash, probe, setPage } = preview;
  const stream = useJobStream(activeJobId, {
    // The write already happened server-side; HMR is repainting the iframe. The
    // pulse is what tells the user WHICH section moved.
    //
    // First, follow the edit to the page that shows it. Only one page is on
    // screen now (§10), and a section the current one does not render would
    // change with nothing to see — `add_section` in particular always lands on
    // the home page, whichever page you were looking at when you asked for it.
    // Switching remounts the frame, so the pulse is lost in that case; the newly
    // rendered section is the louder signal anyway.
    onFileChanged: (event) => {
      if (!event.sectionSlug) return;
      setPage(pageForSection(event.sectionSlug));
      flash(event.sectionSlug);
    },
    onDone: (event) => {
      void queryClient.invalidateQueries({ queryKey: ["chat", chatId] });
      // A succeeded job closes the notes it carried, server-side (§11). Refetch
      // rather than guess: a failed one closes nothing, and the badges have to
      // tell those two apart.
      void queryClient.invalidateQueries({ queryKey: COMMENTS_KEY });
      // The typecheck gate (§7) catches what does not compile. This catches what
      // compiles and then throws — ask the preview whether it still renders.
      if (event.filesChanged > 0) probe();
    },
  });

  const messages = useMemo(() => transcript.data?.messages ?? [], [transcript.data]);

  /**
   * The model's answer for this job is in Postgres — which also means the job
   * is over, whatever the stream did or did not deliver.
   */
  const modelTurnPersisted = useMemo(
    () => messages.some((m) => m.role === "model" && m.jobId === activeJobId),
    [messages, activeJobId],
  );

  /**
   * Is a turn still in flight?
   *
   * `stream.done` is the fast answer; `modelTurnPersisted` is the durable one.
   * Both, because a `done` frame that never arrives — the connection died at the
   * wrong moment, the machine slept through it — would otherwise leave the
   * composer disabled and the header saying "Working…" over a job that finished
   * minutes ago, with nothing but a reload to get out of it.
   */
  const busy = sendMessage.isPending || Boolean(activeJobId && !stream.done && !modelTurnPersisted);

  const onDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    const rect = splitRef.current?.getBoundingClientRect();
    if (!rect) return;
    const percent = ((event.clientX - rect.left) / rect.width) * 100;
    setSplit(Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, percent)));
  }, []);

  const endDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }, []);

  // Not persisted to localStorage on purpose. The width is server-rendered, so
  // restoring a stored value means either a hydration mismatch or setState in an
  // effect — and double-click-to-reset covers the case persistence was for.

  // ── §11: the page and the composer are two views of one pin set ──────────
  const { onPick, onPinClick, onUnresolved, setPins, setMode } = preview;
  const { pinned, toggle, pick, remove, add: addPins, keep: keepPins, reconcile, downgrade } = pins;

  const notesFor = useCallback(
    (slug: string) => openComments.filter((c) => c.sectionSlug === slug),
    [openComments],
  );

  /**
   * Post a turn.
   *
   * `override` is what the preview's popup sends with. The targets it just
   * picked are not in `pinned` yet — React has not re-rendered — and waiting a
   * tick to read them back out of state would be a race for nothing. Its
   * presence also means the text did not come from the composer, which is why
   * a half-written draft down there survives a send from up here.
   *
   * Declared above the effects that call it: the `onPick` dependency array is
   * evaluated during render, so a `send` defined further down would be in the
   * temporal dead zone and throw before the page ever paints.
   */
  const send = useCallback(
    (text: string, override?: readonly Pinned[]) => {
      const sending = override ? [...override] : pinned;
      setPendingUser({ text, attachments: groupForBubble(sending, notesFor), serverId: null });
      if (!override) setDraft("");
      // The turn retires the pins it consumed — except the ones carrying notes,
      // which stay until the job that answers them says so. A failed run would
      // otherwise strand the notes: still open in Postgres, attached to nothing.
      keepPins(sending.filter((p) => (noteCounts.get(p.key) ?? 0) > 0).map((p) => p.key));

      sendMessage.mutate(
        { chatId, text, attachments: sending.map(toWire) },
        {
          onSuccess: (data) => {
            setChatId(data.chatId);
            setActiveJobId(data.jobId);
            // Identity, not text-matching: two identical prompts must not
            // cancel each other out of the transcript.
            setPendingUser((current) => (current ? { ...current, serverId: data.messageId } : current));
          },
          onError: () => setPendingUser(null),
        },
      );
    },
    [pinned, keepPins, noteCounts, notesFor, chatId, sendMessage],
  );

  /**
   * One pick from the preview. Three shapes, and the gesture is what separates
   * them — never the number of targets, which a one-element drag makes a liar of.
   *
   *   click        TOGGLE. Clicking a pinned heading again has to unpin it, or
   *                the second click is dead.
   *   drag         ADD. A drag overlapping what you pinned a moment ago must not
   *                silently take half of it away.
   *   drag + note  SEND, now. The popup's input is not a feeder for the
   *                composer: pressing Enter twice, in two different boxes, for
   *                one thought is exactly the hop this removes.
   *
   * Re-registered whenever the set changes: the handler lives in a ref inside
   * the bridge, so a stale closure here would read yesterday's pins.
   */
  useEffect(() => {
    onPick((targets, note, gesture) => {
      if (note) {
        // A turn is already running and the queue is one deep (§2.3). Park the
        // note in the composer rather than dropping it — the targets are pinned
        // either way, so it costs one more Enter once this turn lands.
        if (busy) {
          setDraft((current) => (current.trim() ? `${current.trim()}\n${note}` : note));
          setDraftFocus((n) => n + 1);
          return;
        }
        // `mergePins`, not `pinned`: the drag pinned these a moment ago and the
        // re-render carrying them may not have happened yet. De-duping by key
        // makes doing it twice free.
        send(note, mergePins(pinned, targets));
        return;
      }

      if (gesture === "click" && targets.length === 1) {
        toggle(targets[0]);
        return;
      }

      pick(targets);
    });
  }, [onPick, pinned, toggle, pick, send, busy]);

  // Clicking the pin marker ON the page. A marker carrying notes opens them —
  // the badge is the only place they are visible from the preview, so making it
  // a delete button would be a trap. A bare marker still drops the pin.
  useEffect(() => {
    onPinClick((key) => {
      if ((noteCounts.get(key) ?? 0) > 0) {
        setOpenNotes(key);
        return;
      }
      remove(key);
    });
  }, [onPinClick, noteCounts, remove]);

  // The agent rewrote a section and the pinned element inside it is gone. The
  // preview is the only side with a DOM, so it reports; the studio downgrades
  // the pin to its section rather than dropping it (§11).
  useEffect(() => {
    onUnresolved(downgrade);
  }, [onUnresolved, downgrade]);

  // Push the set into the preview so the markers follow it. The bridge replays
  // the last payload on `ready`, which is what survives a hot reload.
  useEffect(() => {
    setPins(toPinPayload(pinned, noteCounts));
  }, [setPins, pinned, noteCounts]);

  // Notes outlive the session; pins do not. Sections carrying notes from a
  // previous visit are pinned once, on the first load that has both the notes
  // and the section list — a note that isn't attached to the message can't
  // reach the model, so leaving it unpinned would make it decorative.
  const hydratedNotes = useRef(false);
  useEffect(() => {
    if (hydratedNotes.current || !comments.data || preview.sections.length === 0) return;
    hydratedNotes.current = true;
    addPins(targetsWithNotes(comments.data, preview.sections));
  }, [comments.data, preview.sections, addPins]);

  // The agent can delete a pinned section out from under the composer. Without
  // this the chip stays and contributes nothing on send.
  useEffect(() => {
    reconcile(preview.sections);
  }, [reconcile, preview.sections]);

  // B / S switch modes — but not while the user is writing the letter "s".
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (target?.closest("input, textarea, [contenteditable]")) return;
      const next: PreviewMode | null =
        event.key === "b" ? "browse" : event.key === "s" ? "select" : null;
      if (next) setMode(next);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setMode]);

  const removeAttachment = useCallback(
    (key: string) => {
      remove(key);
      // The thread is anchored to the chip; unpinning leaves it nothing to sit on.
      setOpenNotes((current) => (current === key ? null : current));
    },
    [remove],
  );

  const changesByJob = useMemo(
    () => new Map((transcript.data?.changes ?? []).map((c) => [c.jobId, c])),
    [transcript.data],
  );

  /**
   * The running job has no transcript row yet, so its ChangeCard is built from
   * the `file_changed` events the reducer already collected — no extra fetch.
   * Only once `done` lands: a receipt for work still in progress is a
   * contradiction, and the ToolCards are the live surface until then.
   */
  const liveChanges = useMemo<JobChanges | undefined>(() => {
    if (!activeJobId || !stream.done || stream.files.length === 0) return undefined;
    return {
      jobId: activeJobId,
      reverted: false,
      files: stream.files.map((f) => ({
        path: f.path,
        op: f.op,
        sectionSlug: f.sectionSlug,
        label: f.sectionSlug ? labelForSlug(f.sectionSlug) : null,
      })),
    };
  }, [activeJobId, stream.done, stream.files]);

  const turns = useMemo<TranscriptTurn[]>(() => {
    const out: TranscriptTurn[] = messages.map((message) => ({
      id: message.id,
      role: message.role,
      text: message.content.text,
      attachments: message.content.attachments,
      tools: message.role === "model" && message.jobId ? stream.history[message.jobId] : undefined,
      changes:
        message.role === "model" && message.jobId ? changesByJob.get(message.jobId) : undefined,
    }));

    const landed = pendingUser?.serverId && messages.some((m) => m.id === pendingUser.serverId);
    if (pendingUser && !landed) {
      out.push({
        id: "pending-user",
        role: "user",
        text: pendingUser.text,
        attachments: pendingUser.attachments,
      });
    }

    if (activeJobId && !modelTurnPersisted) {
      out.push({
        id: `job-${activeJobId}`,
        role: "model",
        text: stream.text,
        tools: stream.tools,
        changes: liveChanges,
        pending: !stream.done,
        error: stream.error ?? (stream.status === "cancelled" ? "Stopped." : null),
      });
    }

    return out;
  }, [messages, pendingUser, activeJobId, modelTurnPersisted, stream, changesByJob, liveChanges]);

  const hoveredSection = useMemo(
    () => preview.sections.find((s) => s.slug === preview.hovered)?.label ?? null,
    [preview.sections, preview.hovered],
  );

  // §12: a broken preview reaches the chat, with one click to hand it back to
  // the agent. Quoting the message verbatim — the model needs the error, not a
  // paraphrase of it, and the user should not have to retype a stack trace.
  const { clearBuildError, reload } = preview;
  const buildError = preview.status.buildError;
  const fixBuildError = useCallback(() => {
    if (!buildError) return;
    const touched = [...new Set(stream.files.map((f) => f.path))];
    // Naming the files the last turn wrote is what makes a probe error
    // actionable: the studio knows what changed, and the model would otherwise
    // have to search for it.
    const where = touched.length > 0 ? `\n\nThe last change touched: ${touched.join(", ")}.` : "";
    send(
      `The preview is failing to render with this error:\n\n${buildError.message}${where}\n\nFind what is causing it and fix it.`,
    );
    clearBuildError();
  }, [buildError, send, clearBuildError, stream.files]);

  const notes = useMemo<ComposerNotes>(
    () => ({
      counts: noteCounts,
      openSlug: openNotes,
      setOpenSlug: setOpenNotes,
      forSection: notesFor,
      add: (sectionSlug, body) => addComment.mutate({ sectionSlug, body }),
      resolve: (id) => resolveComment.mutate(id),
      busy: addComment.isPending,
    }),
    [noteCounts, openNotes, notesFor, addComment, resolveComment],
  );

  /** The tool the agent is inside right now. Everything else is model time. */
  const runningTool = useMemo(
    () => stream.tools.find((t) => t.status === "running"),
    [stream.tools],
  );

  const phase = sendMessage.isPending
    ? "Sending"
    : !stream.connected
      ? "Reconnecting"
      : runningTool
        ? toolLabel(runningTool.name)
        : "Working";

  const what = preview.hoveredLabel ?? hoveredSection;
  const hint =
    preview.mode === "select"
      ? what
        ? `Click ${what} to pin it and say what should change · click again to remove`
        : "Click anything to pin it and say what should change"
      : null;

  return (
    <div className="flex h-full flex-col bg-oe-bg text-oe-text">
      {/*
        The one bar in the app. Everything that acts on the PAGE lives on the
        preview's own bar, next to the page; this holds only what is true of the
        project as a whole. That separation is why there is no longer a floating
        pill hovering over the bottom of the canvas covering the page's footer.
      */}
      <header className="flex h-11 shrink-0 items-center gap-3 border-b border-oe-border px-3">
        <span className="text-ui-md font-medium tracking-[-0.02em]">originEd</span>

        <span
          className={`min-w-0 flex-1 truncate text-ui-xs transition-colors ${
            busy ? "text-oe-accent-soft" : "text-oe-faint"
          }`}
        >
          {busy ? (
            <>
              {phase}…
              <Elapsed />
            </>
          ) : (
            hint
          )}
        </span>

        {/* Which page you are looking at, and therefore what a click in the
            preview can pin. Right-hand side because it belongs to the project,
            not to the page (§10). Read straight off the manifest rather than off
            the bridge: the switcher must be usable before the frame has ever
            reported in. */}
        <PageSwitcher pages={pages} value={preview.page} onChange={preview.setPage} />

        <StatusPill status={preview.status} ready={preview.ready} onReload={preview.reload} />
      </header>

      <div ref={splitRef} className="flex min-h-0 flex-1">
        <aside
          className="flex min-w-0 flex-col border-r border-oe-border"
          style={{ width: `${split}%` }}
        >
          <Transcript turns={turns} />
          {buildError && (
            <BuildErrorCard
              error={buildError}
              onFix={fixBuildError}
              onReload={reload}
              onDismiss={clearBuildError}
              busy={busy}
            />
          )}
          {sendMessage.isError && (
            <div className="mx-3 mb-2 border-l-2 border-oe-bad py-1 pl-3 text-ui-xs text-oe-bad">
              {(sendMessage.error as Error).message}
            </div>
          )}
          <Composer
            attachments={pinned}
            notes={notes}
            value={draft}
            onChange={setDraft}
            focusToken={draftFocus}
            onRemoveAttachment={removeAttachment}
            onFocusAttachment={flash}
            onSend={send}
            onCancel={activeJobId ? () => void cancelJob(activeJobId) : undefined}
            busy={busy}
          />
        </aside>

        {/* 1px of visible divider, 9px of grab target — a hairline you can
            actually hit. */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize panels"
          onPointerDown={(e) => {
            dragging.current = true;
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={onDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onDoubleClick={() => setSplit(SPLIT_DEFAULT)}
          className="group relative z-10 -mx-1 w-2 shrink-0 cursor-col-resize"
        >
          <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover:bg-oe-accent/60" />
        </div>

        <main className="flex min-w-0 flex-1 flex-col">
          <PreviewCanvas
            frameRef={preview.frameRef}
            mode={preview.mode}
            onModeChange={preview.setMode}
            viewport={viewport}
            onViewportChange={setViewport}
            status={preview.status}
            ready={preview.ready}
            onReload={preview.reload}
            pinCount={pinned.length}
            pinSummary={pinned.map(pinLabel).join(" · ")}
            page={preview.page}
          />
        </main>
      </div>
    </div>
  );
}
