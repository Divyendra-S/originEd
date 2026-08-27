/**
 * Identifying ONE NODE inside a section, and finding it again later (§11).
 *
 * Split from `dom.ts` on purpose. `dom.ts` answers "make the document match this
 * state"; this file answers "which node is that". They fail in different ways and
 * deserve separate suites — and the dependency runs one way only: `dom.ts`
 * imports from here, never the reverse.
 *
 * Nothing here touches a browser global. No `getComputedStyle` (Tailwind means
 * jsdom knows nothing about how anything actually renders), no `CSS.escape`, no
 * layout. Every decision is made from tag names, attributes and text, which is
 * exactly the set of things that survives being tested against a fake document.
 */

import type { ElementRef } from "@/lib/types";

/**
 * Marks the inspector's own DOM — the pin rail and everything in it.
 *
 * This attribute is why paths are stable. A marker is an element child of the
 * boundary, so the moment one appears it shifts every child index after it. If
 * `refFor` counted it and `resolveRef` didn't (or the other way round), every ref
 * in that section would silently drift by one the first time a second pin landed
 * there. Both sides skip it, and `contentText` skips it too so a marker's own
 * label never leaks into a signature.
 */
export const CHROME = "data-oe-chrome";

/**
 * The bar for the blind sweep, where there is no positional evidence at all.
 *
 * Tag (4) plus position (1) must NOT be enough, or every heading in a section
 * matches every other heading. It takes text or an identifying attribute to
 * reach 6 — the difference between "found it" and "found something shaped
 * vaguely like it". The path branch does not use a score at all; see
 * `resolveRef`.
 */
export const SCAN_MIN = 6;

/** [smallest, meaningful ancestor, section] — see `chainFor`. */
export const MAX_DEPTH = 3;

const TEXT_CAP = 80;
const LABEL_CAP = 24;
const TRAIL_CAP = 8;

const ATTR_KEYS = ["id", "href", "src", "alt", "name", "type", "aria-label", "data-testid"];

/**
 * Elements that are a thing in themselves rather than a container. They count as
 * substantial even with no text, because "an image" is a perfectly good answer to
 * "what did you click".
 */
const SELF_CONTAINED = new Set(["img", "svg", "video", "canvas", "iframe", "input", "hr", "br", "picture", "source"]);

/**
 * The semantic atoms a click snaps to. `span` is deliberately absent: a `<span>`
 * that exists only to colour one word inside an `<h2>` is never what the user
 * meant, and letting it win would make selection feel arbitrary. A `<span>` that
 * genuinely stands alone still gets selected — `hasSubstance` lets it through.
 */
const ATOM =
  "h1,h2,h3,h4,h5,h6,p,a,button,img,input,textarea,select,label,li," +
  "blockquote,code,pre,figcaption,summary,video,picture,td,th";

function isChrome(el: Element): boolean {
  return el.hasAttribute(CHROME);
}

function tagOf(el: Element): string {
  return el.tagName.toLowerCase();
}

/** Element children with tool chrome removed — the index space every path uses. */
function contentChildren(el: Element): Element[] {
  return Array.from(el.children).filter((c) => !isChrome(c));
}

/**
 * Text-level tags that wrap part of a word rather than a thing of their own.
 *
 * This list is the difference between a headline and a ransom note. The hero's
 * `RollingLetters` renders ONE `<span>` PER CHARACTER so it can stagger them in,
 * and a separator at every element boundary turned that `<h1>` into
 * `"S t a y  a h e a d  o f  t h e"` — which went onto the chip, into the note's
 * `target_label`, and into the prompt under "find this text in the source", where
 * it matches nothing. Anything animated per letter or per word does this.
 *
 * Narrow on purpose. `<a>` and `<button>` are inline too, but two adjacent links
 * are two things, so they keep their boundary; these tags are always part of the
 * run of text around them.
 */
const INLINE = new Set([
  "span", "b", "i", "em", "strong", "u", "s", "small", "sub", "sup", "mark",
  "code", "var", "samp", "kbd", "abbr", "cite", "dfn", "q", "time", "data",
  "bdi", "bdo", "ruby", "rt", "rp", "wbr", "del", "ins", "svg", "font",
]);

/**
 * The element's own text, with the inspector's chrome left out.
 *
 * Named for what it actually does. It is not "visible" text — nothing here knows
 * about CSS — it is text that belongs to the page rather than to the tool.
 */
export function contentText(el: Element): string {
  let out = "";
  const walk = (node: Node): void => {
    if (node.nodeType === 3) {
      out += node.nodeValue ?? "";
      return;
    }
    if (node.nodeType !== 1) return;
    const child = node as Element;
    if (isChrome(child)) return;
    const tag = tagOf(child);
    // A line break is a word boundary wherever it appears, and `RollingLetters`
    // emits one for every `\n` in the copy.
    if (tag === "br") {
      out += " ";
      return;
    }
    // A space at every BLOCK boundary, then collapse. Without it a card reads as
    // "01Point at itSwitch the preview" — a string that matches nothing in the
    // source and tells the model nothing. Inline wrappers get no separator, for
    // the mirror-image reason: see INLINE.
    const separate = !INLINE.has(tag);
    if (separate) out += " ";
    child.childNodes.forEach(walk);
    if (separate) out += " ";
  };
  walk(el);
  return out.replace(/\s+/g, " ").trim();
}

function clip(text: string, cap: number): string {
  return text.length > cap ? `${text.slice(0, cap - 1)}…` : text;
}

/** Index among siblings sharing this tag. What tells three identical cards apart. */
function nthOf(el: Element): number {
  const parent = el.parentElement;
  if (!parent) return 0;
  return contentChildren(parent)
    .filter((c) => c.tagName === el.tagName)
    .indexOf(el);
}

function pickAttrs(el: Element): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of ATTR_KEYS) {
    const value = el.getAttribute(key);
    if (value !== null && value !== "") out[key] = clip(value, 300);
  }
  return out;
}

/**
 * What the chip says. Tag-driven and deterministic, so it can be asserted in a
 * test rather than eyeballed.
 */
export function labelFor(el: Element): string {
  const tag = tagOf(el);
  const text = contentText(el);
  const aria = el.getAttribute("aria-label")?.trim();

  if (tag === "img" || tag === "picture") {
    const alt = el.getAttribute("alt")?.trim();
    return alt ? `Image “${clip(alt, LABEL_CAP)}”` : "Image";
  }
  if (tag === "video" || tag === "canvas") return tag === "video" ? "Video" : "Canvas";
  if (tag === "input" || tag === "textarea" || tag === "select") {
    const hint =
      el.getAttribute("placeholder")?.trim() || aria || el.getAttribute("name")?.trim();
    return hint ? clip(hint, LABEL_CAP) : "Field";
  }
  if (text) return clip(text, LABEL_CAP);
  if (aria) return clip(aria, LABEL_CAP);
  if (tag === "a") return "Link";
  if (tag === "button") return "Button";
  if (contentChildren(el).length > 1) return "Card";
  return "Block";
}

function trailFor(boundary: HTMLElement, el: Element): string {
  const parts: string[] = [];
  let node: Element | null = el;
  while (node && node !== boundary.parentElement) {
    const nth = nthOf(node);
    parts.unshift(nth > 0 ? `${tagOf(node)}[${nth}]` : tagOf(node));
    if (node === boundary) break;
    node = node.parentElement;
  }
  // The boundary is a bare wrapper div; naming it adds nothing.
  if (parts.length > 1) parts.shift();
  return parts.slice(-TRAIL_CAP).join(" > ");
}

/** The whole-section ref. `refKey` of this is the bare slug — see `refKey`. */
export function sectionRef(boundary: HTMLElement): ElementRef {
  const slug = boundary.dataset.sectionSlug ?? "";
  return {
    sectionSlug: slug,
    path: [],
    tag: "",
    text: "",
    attrs: {},
    nth: 0,
    trail: "",
    label: boundary.dataset.sectionLabel ?? slug,
  };
}

export function refFor(boundary: HTMLElement, el: Element): ElementRef {
  if (el === boundary) return sectionRef(boundary);

  const path: number[] = [];
  let node: Element = el;
  while (node !== boundary) {
    const parent: Element | null = node.parentElement;
    if (!parent) return sectionRef(boundary); // detached mid-flight
    const index = contentChildren(parent).indexOf(node);
    if (index < 0) return sectionRef(boundary); // the node IS chrome
    path.unshift(index);
    node = parent;
  }

  return {
    sectionSlug: boundary.dataset.sectionSlug ?? "",
    path,
    tag: tagOf(el),
    text: clip(contentText(el), TEXT_CAP),
    attrs: pickAttrs(el),
    nth: nthOf(el),
    trail: trailFor(boundary, el),
    label: labelFor(el),
  };
}

/**
 * The pin-set key and the comment anchor.
 *
 * A whole-section ref keys to its bare slug, which is the hinge the whole design
 * turns on: `pin_click`, `comments.section_slug`, `labelForSlug` and every row
 * already in Postgres go on meaning exactly what they meant before.
 */
export function refKey(ref: ElementRef): string {
  return ref.path.length > 0 ? `${ref.sectionSlug}#${ref.path.join("-")}` : ref.sectionSlug;
}

/**
 * How much this element looks like the one that was pinned.
 *
 * Deliberately dumb arithmetic rather than anything clever, because when a pin
 * lands on the wrong node the only useful debugging question is "which points
 * did it get", and that has to be answerable by reading eight lines.
 */
export function signatureScore(ref: ElementRef, el: Element): number {
  if (tagOf(el) !== ref.tag) return 0; // an <h1> is never a <button>

  let score = 4;
  for (const [key, value] of Object.entries(ref.attrs)) {
    if (el.getAttribute(key) === value) score += key === "id" ? 4 : 2;
  }

  const text = contentText(el);
  if (ref.text && text) {
    if (text === ref.text) score += 4;
    else if (text.startsWith(ref.text) || text.includes(ref.text) || ref.text.includes(text)) score += 2;
  }

  if (nthOf(el) === ref.nth) score += 1;
  return score;
}

/**
 * Find the node again. Path first, signature as the rescue.
 *
 * The path is exact while nothing has moved, and it is the cheap answer — but it
 * is only trusted when the trail agrees, because an index that has drifted lands
 * on a plausible-looking neighbour rather than on nothing. The signature is what
 * survives the agent re-ordering siblings or rewriting every className, which is
 * why `class` is not part of a signature.
 *
 * Note the asymmetry: the path branch ignores text entirely. Rewriting the words
 * in a pinned headline is the single most ordinary request this tool receives,
 * and a pin that dissolves at the moment its request succeeds would be worse
 * than no pin.
 *
 * Takes the boundary rather than the document so this file never needs to know
 * how a slug maps to an element; that lives in `dom.ts`, and keeping it there is
 * what stops the two files importing each other.
 */
export function resolveRef(
  boundary: HTMLElement,
  ref: ElementRef,
): { el: HTMLElement; how: "path" | "signature" } | null {
  if (ref.path.length === 0) return { el: boundary, how: "path" };

  let node: Element | null = boundary;
  for (const index of ref.path) {
    node = contentChildren(node).at(index) ?? null;
    if (!node) break;
  }
  // The path counts as having succeeded only if the ancestor chain it walked is
  // still the one it was recorded against. Accepting a tag match alone is what
  // silently moves a pin from the second card to the first: insert one sibling
  // and every index after it lands on a same-tag neighbour that looks perfect.
  // Checking the trail costs nothing and makes "the path worked" mean something.
  if (node && tagOf(node) === ref.tag && trailFor(boundary, node) === ref.trail) {
    return { el: node as HTMLElement, how: "path" };
  }

  let best: Element | null = null;
  let bestScore = 0;
  for (const candidate of Array.from(boundary.querySelectorAll<HTMLElement>("*"))) {
    if (candidate.closest(`[${CHROME}]`)) continue;
    const score = signatureScore(ref, candidate);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best && bestScore >= SCAN_MIN ? { el: best as HTMLElement, how: "signature" } : null;
}

/**
 * Is this worth selecting on its own, or is it scaffolding?
 *
 * A wrapper `<div>` that renders no text of its own is never what someone means
 * to point at. Getting this right also, for free, makes the hero's absolutely
 * positioned gradient overlays unpinnable — they have no text, so a click passes
 * straight through them to the section.
 */
export function hasSubstance(el: Element): boolean {
  if (el.getAttribute("aria-hidden") === "true") return false;
  if (SELF_CONTAINED.has(tagOf(el))) return true;
  return contentText(el).length > 0;
}

/** The smallest thing under the cursor that a person would call a thing. */
export function meaningfulFrom(boundary: HTMLElement, target: Element): HTMLElement {
  if (target === boundary || !boundary.contains(target)) return boundary;

  // An icon is never the answer; the control around it is.
  let start: Element = target;
  const svg = start.closest("svg");
  if (svg && boundary.contains(svg)) {
    start = svg.parentElement && boundary.contains(svg.parentElement) ? svg.parentElement : svg;
  }

  const atom = start.closest(ATOM);
  let el: Element = atom && boundary.contains(atom) ? atom : start;

  while (el !== boundary && !hasSubstance(el)) {
    el = el.parentElement && boundary.contains(el.parentElement) ? el.parentElement : boundary;
  }
  return el as HTMLElement;
}

/**
 * The next rung up, skipping ancestors that add nothing.
 *
 * `<div><div><h1>X</h1></div></div>` is one thing wearing three hats. Without
 * this, "click again to go up" spends two clicks arriving back where it started
 * and the interaction reads as broken.
 */
function nextRung(el: Element, boundary: HTMLElement): HTMLElement | null {
  let child: Element = el;
  let node: Element | null = el.parentElement;
  while (node && node !== boundary) {
    const transparent =
      contentChildren(node).length === 1 && contentText(node) === contentText(child);
    if (!transparent && hasSubstance(node)) return node as HTMLElement;
    child = node;
    node = node.parentElement;
  }
  return null;
}

/**
 * The escalation chain: what successive clicks on the same spot select.
 *
 * Capped at three because the real page is nine levels deep in places, and
 * "click again" that takes nine clicks to reach the section is not an
 * interaction, it is a maze.
 */
export function chainFor(boundary: HTMLElement, target: Element): HTMLElement[] {
  const smallest = meaningfulFrom(boundary, target);
  if (smallest === boundary) return [boundary];

  const chain: HTMLElement[] = [smallest];
  let node: HTMLElement = smallest;
  while (chain.length < MAX_DEPTH - 1) {
    const up = nextRung(node, boundary);
    if (!up) break;
    chain.push(up);
    node = up;
  }
  chain.push(boundary);
  return chain;
}

/**
 * Everything inside a section a drag is allowed to land on, in document order.
 *
 * The exclusion is what matters: nothing BELOW a semantic atom is offered. The
 * `<span>` inside a button and the `<svg>` inside that span are parts of the
 * control, not things in their own right, and a marquee that returned them would
 * hand the agent "the icon in the button" when the user drew a box around the
 * button.
 */
export function selectableIn(boundary: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const el of Array.from(boundary.querySelectorAll<HTMLElement>("*"))) {
    if (el.closest(`[${CHROME}]`)) continue;
    if (!hasSubstance(el)) continue;
    const atom = el.parentElement?.closest(ATOM);
    if (atom && boundary.contains(atom)) continue;
    out.push(el);
  }
  return out;
}
