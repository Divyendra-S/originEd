"use client";

/**
 * The preview half of the postMessage bridge (§11).
 *
 * Two gestures, and the difference between them is the whole feature:
 *
 *   click — pin the smallest meaningful thing under the cursor, immediately.
 *   drag  — rubber-band a region, pin everything it encloses, and open an input
 *           right there so the note and the target are written in one motion.
 *
 * Deliberately OUTSIDE src/workspace/: this is the lens the user watches the
 * page through, and the agent must not be able to edit it.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { ElementRef, PickedTarget, PreviewMode, PreviewToStudio, StudioToPreview } from "@/lib/types";
import { sections } from "@/workspace/manifest";
import {
  boundaryFrom,
  clearAttr,
  flashSection,
  isChromeTarget,
  pinKeyFrom,
  pinsStale,
  setHover,
  setHoverTarget,
  setSelection,
  syncPins,
  type Pin,
} from "./dom";
import { DRAG_MIN, MAX_TARGETS, boxCentre, boxFrom, coverage, pickInBox, type Box } from "./marquee";
import { meaningfulFrom, refFor, refKey, sectionRef, selectableIn } from "./target";

const STUDIO_ORIGIN = typeof window === "undefined" ? "" : window.location.origin;

/** A section this much inside the box was clearly the thing being enclosed. */
const WHOLE_SECTION = 0.85;

function post(message: PreviewToStudio) {
  if (window.parent === window) return; // opened directly, not embedded
  window.parent.postMessage(message, STUDIO_ORIGIN);
}

const rectOf = (el: Element): Box => el.getBoundingClientRect();

function overlaps(a: Box, b: Box): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function picked(boundary: HTMLElement, ref: ElementRef): PickedTarget {
  const slug = boundary.dataset.sectionSlug ?? "";
  return {
    key: refKey(ref),
    ref,
    sectionSlug: slug,
    sectionLabel: boundary.dataset.sectionLabel ?? slug,
    file: boundary.dataset.sectionFile ?? "",
  };
}

/**
 * What a dragged box selected.
 *
 * A box that swallows a whole section pins the SECTION rather than listing its
 * parts — the user drew a rectangle around the hero, and answering with "your
 * heading, your paragraph and your form" would be a worse description of the
 * same gesture. Below that it is `pickInBox`, per section, in reading order.
 */
function targetsInBox(doc: Document, box: Box): PickedTarget[] {
  const out: PickedTarget[] = [];

  for (const boundary of Array.from(doc.querySelectorAll<HTMLElement>("[data-section-slug]"))) {
    const rect = rectOf(boundary);
    if (!overlaps(rect, box)) continue;
    if (coverage(rect, box) >= WHOLE_SECTION) {
      out.push(picked(boundary, sectionRef(boundary)));
      continue;
    }
    for (const el of pickInBox(selectableIn(boundary), box, rectOf)) {
      out.push(picked(boundary, refFor(boundary, el)));
    }
  }

  // A small box drawn inside one paragraph encloses nothing. Falling through to
  // "nothing selected" would be the tool shrugging at a deliberate gesture, so
  // take whatever is under the middle of it instead.
  if (out.length === 0) {
    const { x, y } = boxCentre(box);
    const hit = doc.elementFromPoint(x, y);
    const boundary = boundaryFrom(hit);
    if (boundary && hit) out.push(picked(boundary, refFor(boundary, meaningfulFrom(boundary, hit))));
  }

  return out.slice(0, MAX_TARGETS);
}

interface Popup {
  box: Box;
  targets: PickedTarget[];
}

export function Inspector() {
  const [marquee, setMarquee] = useState<Box | null>(null);
  const [popup, setPopup] = useState<Popup | null>(null);
  const [note, setNote] = useState("");

  const modeRef = useRef<PreviewMode>("browse");
  const pinsRef = useRef<Pin[]>([]);
  const unresolvedRef = useRef<string[]>([]);
  const dragRef = useRef<{ x: number; y: number; live: boolean } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const closePopup = useCallback(() => {
    setPopup(null);
    setNote("");
  }, []);

  const commit = useCallback(
    (targets: PickedTarget[], text: string | null) => {
      if (targets.length > 0) post({ source: "preview", type: "pick", targets, note: text });
      closePopup();
    },
    [closePopup],
  );

  useEffect(() => {
    const doc = document;

    post({
      source: "preview",
      type: "ready",
      sections: sections.map(({ slug, label, file }) => ({ slug, label, file })),
    });

    // How long this document took to become live. Honest about what it measures:
    // a fast refresh does not remount the layout, so an edit that hot-reloads
    // cleanly posts nothing — which is correct, because nothing reloaded.
    post({ source: "preview", type: "compiled", ms: Math.round(performance.now()) });

    /** Re-sync, and tell the studio about pins whose element has gone. */
    function applyPins() {
      const unresolved = syncPins(doc, pinsRef.current);
      // Only when the LIST changes. The studio answers `pin_unresolved` by
      // downgrading the pin and pushing `set_pins` back, which lands here again —
      // an unguarded post is an infinite ping-pong between the two windows.
      if (unresolved.join("|") !== unresolvedRef.current.join("|")) {
        unresolvedRef.current = unresolved;
        if (unresolved.length > 0) post({ source: "preview", type: "pin_unresolved", keys: unresolved });
      }
    }

    // Hot reload repaints the section React-side and can reconcile the markers
    // and outlines away with it. Re-attach on the next frame, guarded so the
    // observer doesn't fire on syncPins' own writes forever.
    let scheduled = false;
    const observer = new MutationObserver(() => {
      if (scheduled || pinsRef.current.length === 0) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        if (pinsStale(doc, pinsRef.current, unresolvedRef.current)) applyPins();
      });
    });
    observer.observe(doc.body, { childList: true, subtree: true, attributes: false });

    // ── inbound: studio → preview ──────────────────────────────────────────
    function onMessage(event: MessageEvent) {
      if (event.origin !== STUDIO_ORIGIN) return;
      const msg = event.data as StudioToPreview;
      if (!msg || msg.source !== "studio") return;

      switch (msg.type) {
        case "set_mode":
          modeRef.current = msg.mode;
          doc.body.dataset.oeMode = msg.mode;
          if (msg.mode === "browse") {
            clearAttr(doc, "data-oe-hover");
            clearAttr(doc, "data-oe-hover-el");
            clearAttr(doc, "data-oe-selected");
            dragRef.current = null;
            setMarquee(null);
            closePopup();
          }
          break;
        case "set_selection":
          setSelection(doc, msg.sectionSlug);
          break;
        case "set_pins":
          pinsRef.current = msg.pins;
          applyPins();
          break;
        case "flash":
          flashSection(doc, msg.sectionSlug);
          break;
      }
    }

    // ── outbound: preview → studio ─────────────────────────────────────────
    // Capture phase throughout, so we win before the hero's own nav links and
    // email form ever see the event.

    function hoverAt(target: EventTarget | null) {
      const boundary = boundaryFrom(target);
      setHover(doc, boundary);
      const el = boundary && target instanceof Element ? meaningfulFrom(boundary, target) : null;
      setHoverTarget(doc, el === boundary ? null : el);
      post({
        source: "preview",
        type: "hover",
        sectionSlug: boundary?.dataset.sectionSlug ?? null,
        label: el && el !== boundary ? refFor(boundary!, el).label : null,
      });
    }

    function onPointerOver(e: PointerEvent) {
      if (modeRef.current !== "select" || dragRef.current?.live) return;
      if (isChromeTarget(e.target)) return;
      hoverAt(e.target);
    }

    function onPointerDown(e: PointerEvent) {
      if (modeRef.current !== "select" || e.button !== 0) return;
      if (isChromeTarget(e.target)) return; // the marker and the popup are ours
      e.preventDefault();
      closePopup();
      dragRef.current = { x: e.clientX, y: e.clientY, live: false };
      // Captured on the root: a drag that ends with the pointer outside the
      // iframe — over the chat, or off the window — otherwise never delivers
      // `pointerup` here, and the marquee sticks to the page until the next click.
      doc.documentElement.setPointerCapture?.(e.pointerId);
    }

    function onPointerMove(e: PointerEvent) {
      const start = dragRef.current;
      if (!start) return;
      const box = boxFrom(start.x, start.y, e.clientX, e.clientY);
      // A click carries a pixel or two of hand tremor. Only past DRAG_MIN does
      // the gesture become a marquee — before that it is still a click, and
      // showing a 3px rubber band would just look like a rendering glitch.
      if (!start.live && Math.max(box.right - box.left, box.bottom - box.top) < DRAG_MIN) return;
      start.live = true;
      clearAttr(doc, "data-oe-hover-el");
      setMarquee(box);
    }

    function onPointerUp(e: PointerEvent) {
      const start = dragRef.current;
      dragRef.current = null;
      doc.documentElement.releasePointerCapture?.(e.pointerId);
      if (!start) return;
      setMarquee(null);

      if (!start.live) {
        // A plain click: pin what is under the cursor and get out of the way.
        // No popup — the fast path has to stay one gesture, or pinning three
        // things in a row becomes three dialogs.
        //
        // Hit-tested rather than read off `e.target`, because pointer capture
        // has retargeted the event to the root element by now.
        const hit = doc.elementFromPoint(e.clientX, e.clientY);
        const boundary = boundaryFrom(hit);
        if (!boundary || !hit) return;
        const el = meaningfulFrom(boundary, hit);
        commit([picked(boundary, el === boundary ? sectionRef(boundary) : refFor(boundary, el))], null);
        return;
      }

      const box = boxFrom(start.x, start.y, e.clientX, e.clientY);
      const targets = targetsInBox(doc, box);
      if (targets.length === 0) return;
      setNote("");
      setPopup({ box, targets });
    }

    function onClick(e: MouseEvent) {
      // Pins are live in BOTH modes — the pin belongs to the page, so you must
      // be able to drop it without first arming a tool. Handled here rather than
      // with a listener on the marker so it cannot lose the race against this
      // capture-phase handler and toggle twice.
      const key = pinKeyFrom(e.target);
      if (key) {
        e.preventDefault();
        e.stopPropagation();
        post({ source: "preview", type: "pin_click", key });
        return;
      }
      if (modeRef.current !== "select" || isChromeTarget(e.target)) return;
      // Swallowed, not acted on: `pointerup` already did the work. This only
      // stops the page's own links and submit buttons from firing underneath.
      e.preventDefault();
      e.stopPropagation();
    }

    // Everything the error boundary cannot see: a throw from an event handler,
    // an effect, a timer, or a rejected promise. None of those unmount the tree,
    // so without this the page keeps rendering while quietly not working.
    function onError(e: ErrorEvent) {
      // A failed <img> also fires "error" here with no message, and a
      // cross-origin script gives the opaque "Script error." — neither is
      // something to put in the chat and ask the agent to fix.
      if (!e.message || e.message === "Script error.") return;
      post({ source: "preview", type: "build_error", message: e.message, stack: e.error?.stack });
    }

    function onRejection(e: PromiseRejectionEvent) {
      const reason: unknown = e.reason;
      post({
        source: "preview",
        type: "build_error",
        message: reason instanceof Error ? reason.message : String(reason),
        stack: reason instanceof Error ? reason.stack : undefined,
      });
    }

    window.addEventListener("message", onMessage);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    doc.addEventListener("pointerover", onPointerOver, true);
    doc.addEventListener("pointerdown", onPointerDown, true);
    doc.addEventListener("pointermove", onPointerMove, true);
    doc.addEventListener("pointerup", onPointerUp, true);
    doc.addEventListener("click", onClick, true);

    return () => {
      observer.disconnect();
      window.removeEventListener("message", onMessage);
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
      doc.removeEventListener("pointerover", onPointerOver, true);
      doc.removeEventListener("pointerdown", onPointerDown, true);
      doc.removeEventListener("pointermove", onPointerMove, true);
      doc.removeEventListener("pointerup", onPointerUp, true);
      doc.removeEventListener("click", onClick, true);
    };
  }, [closePopup, commit]);

  // The input is the point of the popup, so it takes focus the instant it opens.
  useEffect(() => {
    if (popup) inputRef.current?.focus();
  }, [popup]);

  const summary = popup
    ? popup.targets.length === 1
      ? popup.targets[0].ref.label
      : `${popup.targets.length} elements`
    : "";

  return (
    <>
      <AnimatePresence>
        {marquee && (
          <motion.div
            key="marquee"
            className="oe-marquee"
            data-oe-chrome=""
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.08 }}
            style={{
              left: marquee.left,
              top: marquee.top,
              width: marquee.right - marquee.left,
              height: marquee.bottom - marquee.top,
            }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {popup && (
          <motion.div
            key="popup"
            className="oe-popup"
            data-oe-chrome=""
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 520, damping: 34, mass: 0.6 }}
            style={{
              left: Math.max(12, Math.min(popup.box.left, window.innerWidth - 340)),
              top: Math.min(popup.box.bottom + 10, window.innerHeight - 92),
            }}
          >
            <div className="oe-popup-head">
              <span className="oe-popup-dot" aria-hidden />
              <span className="oe-popup-what">{summary}</span>
              <span className="oe-popup-where">{popup.targets[0].sectionLabel}</span>
            </div>

            <input
              ref={inputRef}
              className="oe-popup-input"
              placeholder="What should change here?"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") commit(popup.targets, note.trim());
                if (e.key === "Escape") closePopup();
              }}
            />

            <div className="oe-popup-foot">
              <kbd className="oe-kbd">↵</kbd>
              <span>add to chat</span>
              <kbd className="oe-kbd">esc</kbd>
              <span>cancel</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
