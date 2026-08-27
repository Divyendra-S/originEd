"use client";

/**
 * The pinned set — the state behind the headline feature (§11).
 *
 * A pin is a `PickedTarget`: a whole section, or one element inside one. They
 * share a key space, and that is the whole trick — `refKey` of a whole-section
 * ref is the bare slug, so `comments.section_slug`, `labelForSlug`, `flash` and
 * every row already in Postgres go on meaning exactly what they meant before.
 *
 * Split out of StudioShell because the interesting parts are decisions, not
 * storage: clicking a pinned thing UNPINS it, a section the agent deleted must
 * stop being pinned, and an element the agent rewrote out of existence must
 * degrade to its section rather than vanish. Those are pure functions below,
 * tested without a browser in the same style as `jobStreamReducer` (§13).
 */
import { useCallback, useState } from "react";
import type { ElementRef, PickedTarget, PinPayload, SectionInfo } from "@/lib/types";

export type Pinned = PickedTarget;

/** True for a pin on the whole section rather than on something inside it. */
export function isWholeSection(pin: Pinned): boolean {
  return pin.ref.path.length === 0;
}

/** What the chip and the marker say: "Hero", or "Hero › Get started". */
export function pinLabel(pin: Pinned): string {
  return isWholeSection(pin) ? pin.sectionLabel : pin.ref.label;
}

/** The whole-section ref for a pin's section, built without touching the DOM. */
function toSectionRef(pin: Pinned): ElementRef {
  return {
    sectionSlug: pin.sectionSlug,
    path: [],
    tag: "",
    text: "",
    attrs: {},
    nth: 0,
    trail: "",
    label: pin.sectionLabel,
  };
}

/**
 * Click-to-pin is a TOGGLE. Clicking an already-pinned thing removing it is the
 * only reading that isn't a dead click — the alternative is a second click that
 * silently does nothing, which reads as the tool being broken.
 */
export function togglePin(current: readonly Pinned[], target: Pinned): Pinned[] {
  return current.some((p) => p.key === target.key)
    ? current.filter((p) => p.key !== target.key)
    : [...current, target];
}

export function removePin(current: readonly Pinned[], key: string): Pinned[] {
  return current.filter((p) => p.key !== key);
}

/**
 * Drop pins for sections that no longer exist.
 *
 * The agent can delete a section from `manifest.ts` mid-conversation. Without
 * this the chip stays in the composer and `section.service.snapshot` silently
 * drops it on send — the user pins something and gets an answer about nothing.
 * `known` empty means the preview hasn't reported yet, not that the page is
 * empty, so it is never a reason to unpin.
 */
export function reconcilePins(
  current: readonly Pinned[],
  known: readonly SectionInfo[],
): Pinned[] {
  if (known.length === 0) return current as Pinned[];
  const live = new Set(known.map((s) => s.slug));
  const kept = current.filter((p) => live.has(p.sectionSlug));
  return kept.length === current.length ? (current as Pinned[]) : kept;
}

/**
 * An element that no longer exists becomes a pin on its section.
 *
 * Downgrade, never drop. `snapshot()` sends the whole file either way, so this
 * loses only the "which element" sentence — while dropping would silently
 * delete context the user still believes is attached. The chip visibly changes
 * from `Get started` to `Hero`, which is honest feedback rather than silence.
 *
 * Returns the SAME array when nothing changed. That is load-bearing: the
 * preview reports unresolvable keys, the studio answers with `set_pins`, and a
 * new array every time would be an infinite ping-pong between the two windows.
 */
export function downgradePins(current: readonly Pinned[], keys: readonly string[]): Pinned[] {
  const lost = new Set(keys);
  if (!current.some((p) => lost.has(p.key) && !isWholeSection(p))) return current as Pinned[];

  const out: Pinned[] = [];
  const seen = new Set<string>();
  for (const pin of current) {
    const next =
      lost.has(pin.key) && !isWholeSection(pin)
        ? { ...pin, key: pin.sectionSlug, ref: toSectionRef(pin) }
        : pin;
    // The section may already be pinned, or two lost elements may collapse onto
    // the same one. Either way the set holds one entry per key.
    if (seen.has(next.key)) continue;
    seen.add(next.key);
    out.push(next);
  }
  return out;
}

/**
 * Keep only these pins.
 *
 * What `send` uses: the turn retires the pins it consumed, except the ones still
 * carrying open notes, which have not been answered yet (§11).
 */
export function keepPins(current: readonly Pinned[], keys: readonly string[]): Pinned[] {
  const keep = new Set(keys);
  const kept = current.filter((p) => keep.has(p.key));
  return kept.length === current.length ? (current as Pinned[]) : kept;
}

/**
 * Pin these without unpinning anything.
 *
 * Not `togglePin` in a loop: this is used to bring back sections that already
 * carry open notes, and a toggle would unpin the ones the user had pinned by
 * hand. Same-array-when-nothing-changed, like `reconcilePins`.
 */
export function addPins(current: readonly Pinned[], targets: readonly Pinned[]): Pinned[] {
  const have = new Set(current.map((p) => p.key));
  const missing: Pinned[] = [];
  for (const target of targets) {
    // `have` grows as we go, so a drag that selects the same thing twice — two
    // overlapping candidates resolving to one element — adds it once.
    if (have.has(target.key)) continue;
    have.add(target.key);
    missing.push(target);
  }
  return missing.length === 0 ? (current as Pinned[]) : [...current, ...missing];
}

/**
 * The `set_pins` payload (§11). `count` is the open-note count, and it is what
 * the marker's badge renders — a badge of 0 renders nothing, so an uncommented
 * pin still shows as a plain pill.
 */
export function toPinPayload(
  current: readonly Pinned[],
  counts?: ReadonlyMap<string, number>,
): PinPayload[] {
  return current.map((p) => ({
    key: p.key,
    ref: p.ref,
    count: counts?.get(p.key) ?? 0,
    sectionLabel: p.sectionLabel,
  }));
}

export interface Pins {
  pinned: Pinned[];
  toggle: (target: Pinned) => void;
  /** Pin several at once — one drag can select up to eight things. */
  pick: (targets: readonly Pinned[]) => void;
  remove: (key: string) => void;
  add: (targets: readonly Pinned[]) => void;
  keep: (keys: readonly string[]) => void;
  reconcile: (known: readonly SectionInfo[]) => void;
  downgrade: (keys: readonly string[]) => void;
}

export function usePins(): Pins {
  const [pinned, setPinned] = useState<Pinned[]>([]);

  return {
    pinned,
    toggle: useCallback((target: Pinned) => setPinned((c) => togglePin(c, target)), []),
    // A drag ADDS rather than toggles. Toggling would make a second drag over
    // an overlapping region silently unpin half of what it just selected.
    pick: useCallback((targets: readonly Pinned[]) => setPinned((c) => addPins(c, targets)), []),
    remove: useCallback((key: string) => setPinned((c) => removePin(c, key)), []),
    add: useCallback((targets: readonly Pinned[]) => setPinned((c) => addPins(c, targets)), []),
    keep: useCallback((keys: readonly string[]) => setPinned((c) => keepPins(c, keys)), []),
    reconcile: useCallback(
      (known: readonly SectionInfo[]) => setPinned((c) => reconcilePins(c, known)),
      [],
    ),
    downgrade: useCallback(
      (keys: readonly string[]) => setPinned((c) => downgradePins(c, keys)),
      [],
    ),
  };
}
