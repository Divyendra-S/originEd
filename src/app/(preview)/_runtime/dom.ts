/**
 * Everything the Inspector does to the preview's DOM (§11), separated from the
 * postMessage wiring so it can be tested against a document instead of a browser.
 *
 * One rule runs through all of it: state is expressed as ATTRIBUTES on the
 * elements themselves, and CSS draws the consequences. No `getBoundingClientRect`
 * here, no overlay layer, no coordinate math — which is why outlines and markers
 * stay glued to what they annotate through scrolling, resizing, a viewport switch
 * and the hero's canvas animation. (The marquee is the one exception, and it
 * lives in `marquee.ts` where the geometry is injected and testable.)
 *
 * Every function takes an explicit `Document`. That is what makes this file
 * testable, and it costs nothing at the call site.
 */

import type { PinPayload } from "@/lib/types";
import { CHROME, resolveRef } from "./target";

export type Pin = PinPayload;

const SLUG = "data-section-slug";
const PIN_FOR = "data-oe-pin-for";
const NOTES = "data-oe-notes";
const TARGET = "data-oe-target";
const RAIL = "oe-pin-rail";

/**
 * Matched by walking the boundaries rather than by building an attribute
 * selector. A slug comes from `manifest.ts`, which the agent writes, so
 * interpolating it into a selector is a quoting bug waiting to happen — and
 * `CSS.escape`, the usual answer, is a browser global this file would then need.
 */
export function boundaryFor(doc: Document, slug: string): HTMLElement | null {
  const all = Array.from(doc.querySelectorAll<HTMLElement>(`[${SLUG}]`));
  return all.find((el) => el.dataset.sectionSlug === slug) ?? null;
}

export function boundaryFrom(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  return target.closest<HTMLElement>(`[${SLUG}]`);
}

/** The key of the pin marker a click landed on, or null if it missed one. */
export function pinKeyFrom(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  return target.closest<HTMLElement>(`[${PIN_FOR}]`)?.getAttribute(PIN_FOR) ?? null;
}

/** True for anything belonging to the tool rather than to the page. */
export function isChromeTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(`[${CHROME}]`) !== null;
}

export function clearAttr(doc: Document, attr: string): void {
  doc.querySelectorAll(`[${attr}]`).forEach((el) => el.removeAttribute(attr));
}

/** Exactly one element carries the attribute at a time — hence clear-then-set. */
function setSolely(doc: Document, attr: string, el: Element | null): void {
  clearAttr(doc, attr);
  el?.setAttribute(attr, "");
}

/** The section under the cursor. Drawn as a faint tint, not an outline. */
export function setHover(doc: Document, el: Element | null): void {
  setSolely(doc, "data-oe-hover", el);
}

/** The ELEMENT under the cursor — what a click would actually pin. */
export function setHoverTarget(doc: Document, el: Element | null): void {
  setSolely(doc, "data-oe-hover-el", el);
}

export function setSelection(doc: Document, slug: string | null): void {
  setSolely(doc, "data-oe-selected", slug ? boundaryFor(doc, slug) : null);
}

/**
 * The pin marker: a small pill in the section's rail.
 *
 * Built with DOM calls rather than rendered by React because it has to live
 * INSIDE a subtree React owns — the workspace's — and the workspace is the part
 * the agent rewrites. A marker the agent could delete by editing a section file
 * is not a marker.
 *
 * Markers cannot be attached to the elements they name: `<input>` and `<img>`
 * are void and take no children, and a `<button>` inside a `<button>` is invalid
 * HTML. So they collect in one rail at the top of the section, and the ELEMENT
 * carries the outline instead — outlines are free and correct anywhere.
 */
function createMarker(doc: Document, key: string): HTMLElement {
  const marker = doc.createElement("button");
  marker.type = "button";
  marker.className = "oe-pin";
  marker.setAttribute(PIN_FOR, key);

  const dot = doc.createElement("span");
  dot.className = "oe-pin-dot";

  const text = doc.createElement("span");
  text.className = "oe-pin-text";

  const count = doc.createElement("span");
  count.className = "oe-pin-count";

  marker.append(dot, text, count);
  return marker;
}

/**
 * The section's marker rail. One foreign direct child, always last, always
 * carrying `data-oe-chrome` — which is what keeps every `ElementRef` path in the
 * section stable when a second pin lands there. See `target.ts`.
 */
function railIn(doc: Document, boundary: HTMLElement): HTMLElement {
  let rail = boundary.querySelector<HTMLElement>(`:scope > .${RAIL}`);
  if (!rail) {
    rail = doc.createElement("div");
    rail.className = RAIL;
    rail.setAttribute(CHROME, "");
    boundary.appendChild(rail);
  } else if (rail !== boundary.lastElementChild) {
    boundary.appendChild(rail); // a hot reload can leave it mid-list
  }
  return rail;
}

/**
 * Make the page match `pins`. Idempotent: an existing marker is updated in place
 * rather than replaced, so re-running mid-CSS-transition doesn't restart it and
 * the DOM churn stays proportional to what changed.
 *
 * Returns the keys whose element could not be found. A pin whose whole SECTION
 * is gone is not in that list — the studio reconciles those away on `ready`, and
 * reporting both through one channel would conflate "the agent deleted the
 * section" with "the agent rewrote the paragraph you pinned".
 */
export function syncPins(doc: Document, pins: readonly Pin[]): string[] {
  clearAttr(doc, "data-oe-pinned");
  clearAttr(doc, TARGET);

  const bySection = new Map<string, Pin[]>();
  for (const pin of pins) {
    const group = bySection.get(pin.ref.sectionSlug);
    if (group) group.push(pin);
    else bySection.set(pin.ref.sectionSlug, [pin]);
  }

  const unresolved: string[] = [];
  const live = new Set<string>();

  for (const [slug, group] of bySection) {
    const boundary = boundaryFor(doc, slug);
    if (!boundary) continue;
    const rail = railIn(doc, boundary);

    for (const pin of group) {
      live.add(pin.key);
      const whole = pin.ref.path.length === 0;
      let lost = false;

      if (whole) {
        boundary.setAttribute("data-oe-pinned", "");
      } else {
        const found = resolveRef(boundary, pin.ref);
        if (found) found.el.setAttribute(TARGET, "");
        else {
          lost = true;
          unresolved.push(pin.key);
        }
      }

      let marker = doc.querySelector<HTMLElement>(`[${PIN_FOR}="${cssQuote(pin.key)}"]`);
      if (!marker) {
        marker = createMarker(doc, pin.key);
        rail.appendChild(marker);
      } else if (marker.parentElement !== rail) {
        rail.appendChild(marker);
      }

      const label = whole ? pin.sectionLabel : `${pin.sectionLabel} › ${pin.ref.label}`;
      const text = marker.querySelector<HTMLElement>(".oe-pin-text");
      if (text) text.textContent = label;
      const badge = marker.querySelector<HTMLElement>(".oe-pin-count");
      if (badge) badge.textContent = pin.count > 0 ? String(pin.count) : "";

      marker.toggleAttribute("data-oe-lost", lost);

      // What the marker DOES depends on the count — a pin with notes opens them,
      // a bare one unpins (§11) — so the tooltip and the hover colour have to say
      // which. The studio makes the same call when `pin_click` arrives.
      if (pin.count > 0) {
        marker.setAttribute(NOTES, "");
        marker.title = `${pin.count} note${pin.count === 1 ? "" : "s"} on ${label}`;
      } else {
        marker.removeAttribute(NOTES);
        marker.title = lost ? `${label} — no longer on the page` : `Unpin ${label}`;
      }
    }
  }

  doc.querySelectorAll<HTMLElement>(`[${PIN_FOR}]`).forEach((el) => {
    if (!live.has(el.getAttribute(PIN_FOR) ?? "")) el.remove();
  });
  doc.querySelectorAll<HTMLElement>(`.${RAIL}`).forEach((rail) => {
    if (!rail.firstElementChild) rail.remove();
  });

  return unresolved;
}

/**
 * A pin key is `slug` or `slug#1-2-0` — our own alphabet plus whatever the agent
 * put in a slug. Quoted rather than escaped because `CSS.escape` is a browser
 * global this file deliberately does without.
 */
function cssQuote(value: string): string {
  return value.replace(/["\\]/g, "\\$&");
}

/**
 * True when the page has drifted from `pins` and needs a resync.
 *
 * A marker is a foreign child inside a tree React re-renders on every hot
 * reload — which is exactly when it matters, because an edit landing is the
 * moment the section repaints. This is the cheap guard that lets a
 * MutationObserver re-run `syncPins` without watching its own writes forever.
 *
 * It must NEVER call `resolveRef`. The observer wakes on every mutation and
 * `motion/react` mutates the hero throughout its entrance animation; a
 * full-subtree signature scan per frame is the one performance cliff in this
 * design. `unresolved` is passed back in from the last sync so a pin that is
 * genuinely gone does not read as "missing" forever and resync on every frame.
 */
export function pinsStale(
  doc: Document,
  pins: readonly Pin[],
  unresolved: readonly string[] = [],
): boolean {
  const lost = new Set(unresolved);
  const markers = new Set(
    Array.from(doc.querySelectorAll(`[${PIN_FOR}]`)).map((el) => el.getAttribute(PIN_FOR) ?? ""),
  );

  let wantOutlines = 0;
  for (const pin of pins) {
    if (boundaryFor(doc, pin.ref.sectionSlug) === null) continue;
    if (!markers.has(pin.key)) return true;
    if (pin.ref.path.length > 0 && !lost.has(pin.key)) wantOutlines += 1;
  }

  return doc.querySelectorAll(`[${TARGET}]`).length < wantOutlines;
}

/** Pulse a section and bring it into view. False if it isn't on the page. */
export function flashSection(doc: Document, slug: string): boolean {
  const el = boundaryFor(doc, slug);
  if (!el) return false;
  el.removeAttribute("data-oe-flash");
  void el.offsetWidth; // restart the animation
  el.setAttribute("data-oe-flash", "");
  el.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
  return true;
}
