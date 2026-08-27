/**
 * What the model is told, and what it is shown.
 *
 * The attachment rendering here is the load-bearing half of the headline feature
 * (§11): a pinned section reaches the model as the EXACT bytes the user was
 * looking at when they hit send, frozen into `jobs.context` at that moment (§5).
 * Not a summary, not a re-read — the file, verbatim.
 */
import type { AttachedSection, ElementRef, Job, Message } from "@/lib/types";
import * as messageRepo from "@/server/repositories/message.repo";
import { sections } from "@/workspace/manifest";
import type { Content } from "./gemini.client";

export function systemPrompt(): string {
  const inventory = sections.map((s) => `  - ${s.slug} ("${s.label}") → ${s.file}`).join("\n");

  return `You are the editing agent inside originEd Studio, a visual website builder.

The user is looking at a live preview of their page while they talk to you. You edit
the page's real source files; Turbopack hot-reloads the preview within a second of
each write, so your edits are visible to them immediately.

# The workspace

Every path you use is relative to the workspace root. You cannot read or write
anything outside it, and you do not need to.

  page.tsx              renders the sections in order
  manifest.ts           THE source of truth: which sections exist, and in what order
  sections/*.tsx        one file per section — this is where almost every edit belongs
  components/originkit/ shared sub-components the sections import

page.tsx imports SectionBoundary from outside the workspace. That import is not
yours to change: it carries the attributes the user clicks sections with.

Sections currently on the page:
${inventory}

# How to work

- Read a file before you edit it. edit_file matches on exact text, so you need the
  real bytes, including indentation.
- Prefer edit_file over write_file. Small diffs are reviewable; full rewrites are not.
- Change only what was asked. Do not reformat, re-order imports, "clean up" nearby
  code, or restyle things the user did not mention.
- A pinned section may arrive with notes the user left on it. Each note is about
  that section specifically. Treat them as part of the request and address every
  one of them; where a note and the message disagree, the message wins.
- A pinned section may also name specific ELEMENTS the user pointed at, listed
  after the source. Those are the subject of the request: change them and leave
  the rest of the file alone. An element is described by what it renders, not by
  a line number, because the element the user pointed at may come from a .map()
  or a shared component — so find it by its text. When it does come from a loop,
  a STYLING change almost certainly applies to every item; a TEXT change almost
  certainly applies to just that one entry in the array.
- Keep the "use client" directive, existing imports, and animation wiring intact
  unless the request is specifically about them.
- Styling is Tailwind v4 with some plain CSS in components/originkit/*.css.
  Animation is motion/react. Use what the file already uses.
- To ADD a section, call add_section. It creates the file from a template and
  wires it into manifest.ts and page.tsx in one step, so the page always
  compiles. Call list_templates first and pick the closest match, then read the
  new file and edit it so the content says what the user asked for. Do not write
  those three files by hand. To REMOVE one, call remove_section.
- The workspace is type-checked automatically before your turn ends. If it fails
  you are handed the errors and asked to fix them, so an edit that does not
  compile costs a round trip — read before you edit, and leave imports and types
  alone unless the change is about them.

# Replying

When you are done, write one to three plain sentences telling the user what you
changed. No code blocks, no bullet lists, no file paths — they can see the diff.
Make the change rather than asking which change to make; if the request is truly
ambiguous, pick the most likely reading, do it, and say which reading you took.`;
}

/**
 * Render one pinned section for the model. Tag-delimited rather than fenced: the
 * payload is TSX that may itself contain backticks, and a fence would end early.
 *
 * Notes go AFTER the source and name their section explicitly. When two sections
 * are pinned and only one carries notes, "notes on this section" is ambiguous
 * from inside a flat block of text — the label is what disambiguates it.
 */
function renderAttachment(a: AttachedSection): string {
  const notes =
    a.comments.length > 0
      ? `\nNotes the user left on ${a.label}:\n${a.comments.map((c) => `  - ${c.body}`).join("\n")}\n`
      : "";

  // AFTER the closing tag, never inside it. The content of <attached-section> is
  // a verbatim-bytes promise with a byte-for-byte test behind it (§5), and a
  // section with no targets renders exactly as it did before element selection
  // existed — which is what keeps every stored row and every fixture valid.
  return `<attached-section slug="${a.sectionSlug}" label="${a.label}" file="${a.file}">
${a.source}
</attached-section>${renderTargets(a)}${notes}`;
}

/**
 * Element text comes from the rendered page, which the AGENT wrote. It is the
 * one new injection surface element selection opens, so it is stripped rather
 * than escaped: angle brackets and quotes would let a heading close the
 * surrounding tag, and control characters would let it forge a new line of
 * instructions. Low severity — the agent is quoting itself — but free to close.
 */
function quote(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/["<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

/**
 * The trail is OURS — `target.ts` builds it out of tag names and sibling
 * indices — so it keeps its `>` separators, which `quote` would strip. A
 * whitelist rather than a blacklist: anything that is not a tag name, an index
 * or a separator has no business being in it.
 */
function quoteTrail(value: string): string {
  return value.replace(/[^a-zA-Z0-9[\]>\s-]/g, "").replace(/\s+/g, " ").trim().slice(0, 240);
}

const ORDINALS = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th", "10th"];

function describe(target: ElementRef): string {
  const tag = quote(target.tag) || "element";
  const where = target.trail ? ` at ${quoteTrail(target.trail)}` : "";
  // What tells three identical cards apart when the text is identical too.
  const nth =
    target.nth > 0 && ORDINALS[target.nth]
      ? ` (the ${ORDINALS[target.nth]} <${tag}> under its parent)`
      : "";
  const text = target.text ? `, whose text is "${quote(target.text)}"` : "";
  return `<${tag}>${where}${nth}${text}`;
}

/**
 * The elements the user pointed at inside a pinned section (§11).
 *
 * There is no line number here and there cannot be one — see `ElementRef`. What
 * replaces it is the rendered TEXT, which for the common `{ITEMS.map(...)}` case
 * is strictly better than a line number would have been: the line points at
 * `{item.title}`, one node rendered three times, while the text points at the
 * array entry the user actually meant. Text is also what `edit_file` matches on.
 */
function renderTargets(a: AttachedSection): string {
  const targets = a.targets ?? [];
  if (targets.length === 0) return "";
  const list = targets.map((t, i) => `  ${i + 1}. ${describe(t)}`).join("\n");
  return `\nThe user pointed at these elements inside ${a.label}. They are what the request is about — find each one in the source above and change only those:\n${list}\n`;
}

/**
 * History turns carry TEXT ONLY, deliberately.
 *
 * A section snapshot runs ~20KB, and replaying every past attachment verbatim
 * would spend most of the window re-reading files the agent can just read again
 * with a tool. Only the CURRENT turn gets its sources inlined; older turns get a
 * one-line note that something was pinned, which is enough for the model to know
 * what "make it bigger too" refers to.
 */
function historyTurn(message: Message): Content | null {
  const text = message.content.text?.trim() ?? "";
  const pinned = message.content.attachments ?? [];

  if (message.role === "model") {
    return text.length > 0 ? { role: "model", parts: [{ text }] } : null;
  }

  const note =
    pinned.length > 0
      ? `[the user had these sections pinned: ${pinned.map((a) => a.label).join(", ")}]\n`
      : "";
  return text.length > 0 || note.length > 0 ? { role: "user", parts: [{ text: note + text }] } : null;
}

/**
 * The conversation as the model sees it: prior turns, then this turn with its
 * frozen attachments inlined.
 *
 * The current user message is dropped from the history pass and rebuilt here, so
 * its verbatim sources appear exactly once and in the right place — immediately
 * before the instruction they refer to.
 */
export async function buildInitialContents(job: Job): Promise<Content[]> {
  const history = await messageRepo.listByChat(job.chatId);
  const contents: Content[] = [];

  for (const message of history) {
    if (message.jobId === job.id && message.role === "user") continue; // rebuilt below
    const turn = historyTurn(message);
    if (turn) contents.push(turn);
  }

  const attachments = job.context?.attachments ?? [];
  const parts = attachments.map(renderAttachment);
  // Saying this is worth real money. Measured on a one-line edit to a 19KB
  // section, the model read_file'd the very file it had just been handed, which
  // re-sent those bytes on every subsequent turn: 34.3k prompt tokens for one
  // changed number. The attachment is a snapshot taken microseconds before the
  // job started, so "already current" is true, not a convenient fiction.
  parts.push(
    attachments.length > 0
      ? `The ${attachments.length === 1 ? "section" : "sections"} above ${attachments.length === 1 ? "is" : "are"} pinned by the user, shown at ${attachments.length === 1 ? "its" : "their"} exact current contents on disk. You already have the bytes you need to call edit_file — do not call read_file on ${attachments.length === 1 ? "it" : "them"} again.\n\nThe user said:\n\n${job.prompt}`
      : job.prompt,
  );

  contents.push({ role: "user", parts: [{ text: parts.join("\n\n") }] });
  return contents;
}
