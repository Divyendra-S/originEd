"use client";

/**
 * The studio half of the postMessage protocol (§11).
 *
 * Owns: the iframe ref, the Browse/Select mode, what's hovered/selected, the
 * section list the preview reported, and the compile/error status shown in the
 * strip under the frame.
 *
 * Not a TanStack Query concern — this is a push channel and live UI state (§13).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  PickGesture,
  PickedTarget,
  PinPayload,
  PreviewMode,
  PreviewToStudio,
  SectionInfo,
  StudioToPreview,
} from "@/lib/types";

export interface PreviewStatus {
  compiledMs: number | null;
  buildError: {
    message: string;
    stack?: string;
    /**
     * Who noticed. `probe` errors are cleared by a later successful probe;
     * errors the frame reported are not, because a page that server-renders
     * fine can still be throwing on the client.
     */
    from: "preview" | "probe";
  } | null;
}

export type PickHandler = (
  targets: PickedTarget[],
  note: string | null,
  gesture: PickGesture,
) => void;

export interface PreviewBridge {
  frameRef: React.RefObject<HTMLIFrameElement | null>;
  ready: boolean;
  mode: PreviewMode;
  setMode: (mode: PreviewMode) => void;
  sections: SectionInfo[];
  hovered: string | null;
  /** What a click would pin right now — the element label, not the section's. */
  hoveredLabel: string | null;
  selected: string | null;
  setSelected: (slug: string | null) => void;
  status: PreviewStatus;
  /** Dismiss a build error the user has read (§12). */
  clearBuildError: () => void;
  /** Ask the preview whether it still renders at all (§12). */
  probe: () => void;
  /** Pulse a section green after an edit lands. */
  flash: (slug: string) => void;
  reload: () => void;
  /**
   * Fires when the user picks something in Select mode — one click, or one
   * drag. `note` is what they typed into the popup: `null` when there was no
   * popup at all, so "pinned in passing" and "pinned and said nothing" stay
   * distinguishable. `gesture` says which of the two it was, because a drag
   * that encloses one element must not be mistaken for a click and unpin it.
   */
  onPick: (handler: PickHandler) => void;
  /** Draw markers and outlines on the page for these pins (§11). */
  setPins: (pins: PinPayload[]) => void;
  /** Fires when the user clicks a pin marker inside the preview. */
  onPinClick: (handler: (key: string) => void) => void;
  /** Fires when the preview can no longer find a pinned element (§11). */
  onUnresolved: (handler: (keys: string[]) => void) => void;
}

export function usePreviewBridge(): PreviewBridge {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const pickHandler = useRef<PickHandler | null>(null);
  const pinClickHandler = useRef<((key: string) => void) | null>(null);
  const unresolvedHandler = useRef<((keys: string[]) => void) | null>(null);
  // The preview is stateless across reloads; the studio holds the truth and
  // replays it on `ready`. Kept in a ref, not state, so re-pinning does not
  // re-subscribe the message listener.
  const pinsRef = useRef<PinPayload[]>([]);

  const [ready, setReady] = useState(false);
  // Select, not Browse. Pointing at the page is what the tool is FOR, and a
  // mode you have to arm before the headline feature works is a mode most
  // people never find. Esc (and B) still get you out to plain browsing.
  const [mode, setModeState] = useState<PreviewMode>("select");
  const [sections, setSections] = useState<SectionInfo[]>([]);
  const [hovered, setHovered] = useState<string | null>(null);
  const [hoveredLabel, setHoveredLabel] = useState<string | null>(null);
  const [selected, setSelectedState] = useState<string | null>(null);
  const [status, setStatus] = useState<PreviewStatus>({ compiledMs: null, buildError: null });

  const send = useCallback((message: StudioToPreview) => {
    frameRef.current?.contentWindow?.postMessage(message, window.location.origin);
  }, []);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      const msg = event.data as PreviewToStudio;
      if (!msg || msg.source !== "preview") return;

      switch (msg.type) {
        case "ready":
          setSections(msg.sections);
          setReady(true);
          // A reload resets the iframe. Everything the studio told it is gone,
          // so re-assert all of it — an edit that reloads the frame must not
          // silently drop the pins the user is composing against.
          send({ source: "studio", type: "set_mode", mode });
          send({ source: "studio", type: "set_pins", pins: pinsRef.current });
          setStatus((s) => ({ ...s, buildError: null }));
          break;
        case "hover":
          setHovered(msg.sectionSlug);
          setHoveredLabel(msg.label);
          break;
        case "pick": {
          // Echo the section back: the Inspector draws the hover outline but not
          // the selected one, so without this the tint vanishes the moment the
          // pointer leaves the section the user just picked in.
          const slug = msg.targets[0]?.sectionSlug ?? null;
          setSelectedState(slug);
          send({ source: "studio", type: "set_selection", sectionSlug: slug });
          pickHandler.current?.(msg.targets, msg.note, msg.gesture);
          break;
        }
        case "pin_click":
          pinClickHandler.current?.(msg.key);
          break;
        case "pin_unresolved":
          unresolvedHandler.current?.(msg.keys);
          break;
        case "compiled":
          setStatus({ compiledMs: msg.ms, buildError: null });
          break;
        case "build_error":
          setStatus((s) => ({
            ...s,
            buildError: { message: msg.message, stack: msg.stack, from: "preview" },
          }));
          break;
      }
    }

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [mode, send]);

  const setMode = useCallback(
    (next: PreviewMode) => {
      setModeState(next);
      send({ source: "studio", type: "set_mode", mode: next });
      if (next === "browse") {
        setHovered(null);
        setHoveredLabel(null);
        setSelectedState(null);
      }
    },
    [send],
  );

  const setSelected = useCallback(
    (slug: string | null) => {
      setSelectedState(slug);
      send({ source: "studio", type: "set_selection", sectionSlug: slug });
    },
    [send],
  );

  const flash = useCallback(
    (slug: string) => send({ source: "studio", type: "flash", sectionSlug: slug }),
    [send],
  );

  // Dismissing is the user's judgement, not ours. The preview clears the error
  // by itself when it recovers — it posts `compiled` on the way back up.
  const clearBuildError = useCallback(
    () => setStatus((s) => ({ ...s, buildError: null })),
    [],
  );

  /**
   * The failure the bridge cannot report on its own.
   *
   * A section that throws while SERVER-rendering never gets far enough to mount
   * the Inspector, so there is nothing alive inside the frame to post
   * `build_error` from — the user gets a white rectangle and no explanation,
   * which §12 calls the most confusing failure mode in a tool like this. Being
   * same-origin means the studio can simply ask for the document and read the
   * status code.
   *
   * Two attempts, because Turbopack may still be recompiling the instant a job
   * finishes and a false "your page is broken" is worse than a slow true one.
   */
  const probe = useCallback(() => {
    void (async () => {
      for (const wait of [400, 900]) {
        await new Promise((resolve) => setTimeout(resolve, wait));
        try {
          const res = await fetch("/preview", { cache: "no-store" });
          if (res.ok) {
            // Clear only what the probe itself set. A page that renders can
            // still be throwing after hydration, and that error is not ours.
            setStatus((s) => (s.buildError?.from === "probe" ? { ...s, buildError: null } : s));
            return;
          }
          if (wait === 900) {
            setStatus((s) => ({
              ...s,
              buildError: {
                message: `The page failed to render (HTTP ${res.status}). The error is shown inside the preview frame.`,
                from: "probe",
              },
            }));
          }
        } catch {
          // The dev server is restarting, not a broken edit. Say nothing.
          return;
        }
      }
    })();
  }, []);

  const setPins = useCallback(
    (pins: PinPayload[]) => {
      pinsRef.current = pins;
      send({ source: "studio", type: "set_pins", pins });
    },
    [send],
  );

  const reload = useCallback(() => {
    setReady(false);
    if (frameRef.current) frameRef.current.src = frameRef.current.src;
  }, []);

  const onPick = useCallback((handler: PickHandler) => {
    pickHandler.current = handler;
  }, []);

  const onPinClick = useCallback((handler: (key: string) => void) => {
    pinClickHandler.current = handler;
  }, []);

  const onUnresolved = useCallback((handler: (keys: string[]) => void) => {
    unresolvedHandler.current = handler;
  }, []);

  // Esc always leaves Select mode.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && mode === "select") setMode("browse");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, setMode]);

  return {
    frameRef,
    ready,
    mode,
    setMode,
    sections,
    hovered,
    hoveredLabel,
    selected,
    setSelected,
    status,
    clearBuildError,
    probe,
    flash,
    reload,
    onPick,
    setPins,
    onPinClick,
    onUnresolved,
  };
}
