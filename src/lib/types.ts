/**
 * Shared DTOs. The one vocabulary Layer 1 (React + routes) and Layer 2/3 both
 * speak. Nothing in here imports from `server/` — it is the boundary, not a
 * member of either side.
 */

// ── domain rows ───────────────────────────────────────────────────────────────

export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";
export type MessageRole = "user" | "model";
export type FileOp = "create" | "update" | "delete";
export type CommentStatus = "open" | "resolved";

/** A section pinned into the composer. The source is snapshotted at send time (§5). */
export interface AttachedSection {
  sectionSlug: string;
  label: string;
  file: string;
  /** Verbatim file bytes as they were when the message was sent. */
  source: string;
  /**
   * Notes that were open on this section at send time (§11). Frozen with the
   * source, and carrying `id` so the job can resolve exactly these on success —
   * not whatever is open by the time it finishes.
   */
  comments: { id: string; body: string; status: CommentStatus }[];
  /**
   * The elements inside this section the user actually pointed at (§11).
   *
   * One `AttachedSection` per section however many elements are pinned inside
   * it — the hero is 19KB and shipping it twice for two pinned buttons is the
   * token waste §14 risk 8 is about. Absent (not `[]`) when the whole section
   * was pinned, which is what keeps an old row rendering byte-identically.
   */
  targets?: ElementRef[];
}

export interface MessageContent {
  text: string;
  attachments?: AttachedSection[];
}

export interface Message {
  id: string;
  chatId: string;
  role: MessageRole;
  content: MessageContent;
  jobId: string | null;
  createdAt: string;
}

export interface Chat {
  id: string;
  title: string | null;
  createdAt: string;
}

export interface Job {
  id: string;
  chatId: string;
  status: JobStatus;
  prompt: string;
  context: { attachments: AttachedSection[] } | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface FileRevision {
  id: number;
  jobId: string;
  seq: number;
  path: string;
  op: FileOp;
  before: string | null;
  after: string | null;
  revertedAt: string | null;
  createdAt: string;
}

export interface Comment {
  id: string;
  sectionSlug: string;
  body: string;
  status: CommentStatus;
  jobId: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

// ── the SSE event union (§8) ──────────────────────────────────────────────────
// Every variant is persisted to job_events BEFORE it is published to the bus,
// which is what makes reconnect, refresh and multi-tab work.

export type JobEventType =
  | "status"
  | "text_delta"
  | "tool_call"
  | "tool_result"
  | "file_changed"
  | "usage"
  | "error"
  | "done";

export type JobEventData =
  | { type: "status"; status: JobStatus }
  | { type: "text_delta"; text: string }
  | { type: "tool_call"; id: string; name: string; args: unknown }
  | { type: "tool_result"; id: string; name: string; ok: boolean; summary: string }
  | { type: "file_changed"; path: string; op: FileOp; sectionSlug: string | null }
  | { type: "usage"; promptTokenCount: number; candidatesTokenCount: number }
  | { type: "error"; message: string }
  | { type: "done"; status: JobStatus; filesChanged: number };

/** What actually crosses the wire: a `seq` (the SSE `id:`) plus the payload. */
export type JobEvent = { seq: number; jobId: string } & JobEventData;

// ── diff DTOs (§12) ───────────────────────────────────────────────────────────

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

/**
 * Level 2 of §12 — what the ChangeCard needs and nothing more. No file bodies,
 * so this rides along with the transcript without shipping 20KB per edit.
 */
export interface ChangedFile {
  path: string;
  op: FileOp;
  /** "Hero", not "src/workspace/sections/hero.tsx" — the chat shows sections. */
  sectionSlug: string | null;
  label: string | null;
}

export interface JobChanges {
  jobId: string;
  files: ChangedFile[];
  reverted: boolean;
}

/** Level 3 — the same file with the patch math done. Fetched only when asked for. */
export interface FileDiff extends ChangedFile {
  hunks: DiffHunk[];
  added: number;
  removed: number;
}

export interface JobDiff {
  jobId: string;
  files: FileDiff[];
  reverted: boolean;
}

// ── preview bridge (§11) ──────────────────────────────────────────────────────

export type PreviewMode = "browse" | "select";

export interface SectionInfo {
  slug: string;
  label: string;
  file: string;
}

/**
 * What the user pointed at: a section, or one element inside it.
 *
 * There is no source location in here, and that is not a shortcut. Turbopack
 * does emit `{fileName, lineNumber}` as jsxDEV's 5th argument in dev, but React
 * 19's `jsxDEV` takes four parameters and drops it — `_debugSource` no longer
 * exists on elements or fibers. So the element is identified by what it IS at
 * runtime, and the agent gets the whole file plus a description of the target.
 *
 * For the common `{ITEMS.map(...)}` case that is not a consolation prize, it is
 * strictly better: a line number would point at `{item.title}`, one node
 * rendered three times, while the rendered TEXT points at the array entry the
 * user actually meant — and text is what `edit_file` matches on.
 *
 * `path: []` means the whole section, and `refKey` of that is the bare slug.
 * Every "this stays backward compatible" claim in §11 rests on that identity.
 */
export interface ElementRef {
  sectionSlug: string;
  /** Element-child indices from the boundary down. Tool chrome is not counted. */
  path: number[];
  /** Lowercased tag name. "" when `path` is empty. */
  tag: string;
  /** Own text, whitespace-collapsed and capped. */
  text: string;
  /**
   * A fixed allowlist of identifying attributes. `class` is deliberately NOT
   * among them: the agent rewrites Tailwind classes on almost every edit, so
   * keying on class would make every restyle break every pin.
   */
  attrs: Record<string, string>;
  /** Index among same-tag siblings — what tells three identical cards apart. */
  nth: number;
  /** Ancestor tags, for the prompt and the tooltip: `section > div > h3`. */
  trail: string;
  /** What a human reads on the chip: "Headline", "Get started", "Image". */
  label: string;
}

/** One pinned thing, as the preview needs it to draw markers and outlines. */
export interface PinPayload {
  key: string;
  ref: ElementRef;
  /** Open notes on this exact target — the marker's badge. */
  count: number;
  /** The section's own label, for the marker on a whole-section pin. */
  sectionLabel: string;
}

/**
 * A target the user just picked, on its way into the composer.
 *
 * Carries `file` and `sectionLabel` so the studio can build a chip without
 * looking anything up — the preview already knows both from the boundary's data
 * attributes, and re-deriving them studio-side is one more thing to keep in sync.
 */
export interface PickedTarget {
  key: string;
  ref: ElementRef;
  sectionSlug: string;
  sectionLabel: string;
  file: string;
}

/**
 * What the composer puts on the wire: a bare slug for a whole section, or one
 * element inside one. The bare-string arm is what keeps every existing caller,
 * route test and stored row valid — a whole-section pin has always been a slug
 * and still is.
 */
export type Attachment =
  | string
  | Pick<ElementRef, "sectionSlug" | "path" | "tag" | "text" | "label" | "trail" | "nth">;

export type StudioToPreview =
  | { source: "studio"; type: "set_mode"; mode: PreviewMode }
  | { source: "studio"; type: "set_selection"; sectionSlug: string | null }
  | { source: "studio"; type: "set_pins"; pins: PinPayload[] }
  | { source: "studio"; type: "flash"; sectionSlug: string };

export type PreviewToStudio =
  | { source: "preview"; type: "ready"; sections: SectionInfo[] }
  | { source: "preview"; type: "hover"; sectionSlug: string | null; label: string | null }
  /**
   * One drag, or one click, resolved into targets. `note` is what the user typed
   * into the popup — `null` when there was no popup (a plain click), `""` when
   * they opened one and pinned without writing anything. The studio tells those
   * apart: only a non-empty note reaches the composer.
   */
  | { source: "preview"; type: "pick"; targets: PickedTarget[]; note: string | null }
  | { source: "preview"; type: "pin_click"; key: string }
  /** Pins whose element no longer exists — the studio downgrades them (§11). */
  | { source: "preview"; type: "pin_unresolved"; keys: string[] }
  | { source: "preview"; type: "compiled"; ms: number }
  | { source: "preview"; type: "build_error"; message: string; stack?: string };
