"use client";

/**
 * The preview's last line of defence (§12), and the only one that catches the
 * failure that actually happens: a section that throws while rendering.
 *
 * Without it, an agent edit that breaks a component takes the whole preview
 * document down — React unmounts the tree, the Inspector goes with it, and the
 * studio sees a white rectangle and no message. That is the single most
 * confusing failure mode in a tool like this: the page looks frozen, and
 * nothing anywhere says why.
 *
 * OUTSIDE `src/workspace/` for the same reason as `Inspector.tsx`: it is part
 * of the lens, not part of the page, and the agent must not be able to edit the
 * thing that reports on the agent.
 *
 * A compile error is a different animal — the route never renders, so nothing
 * here runs. That one is caught server-side by the typecheck gate (§7) before
 * the user ever sees it.
 */
import { Component, type ErrorInfo, type ReactNode } from "react";
import type { PreviewToStudio } from "@/lib/types";

const STUDIO_ORIGIN = typeof window === "undefined" ? "" : window.location.origin;

function post(message: PreviewToStudio): void {
  if (typeof window === "undefined" || window.parent === window) return;
  window.parent.postMessage(message, STUDIO_ORIGIN);
}

interface State {
  message: string | null;
  stack?: string;
}

export class PreviewErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { message: null };

  static getDerivedStateFromError(error: unknown): State {
    return { message: error instanceof Error ? error.message : String(error) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    post({
      source: "preview",
      type: "build_error",
      message: error instanceof Error ? error.message : String(error),
      // The component stack names the section; the JS stack names the bundle.
      // The first is what makes the message actionable.
      stack: info.componentStack ?? (error instanceof Error ? error.stack : undefined) ?? undefined,
    });
  }

  componentDidUpdate(_prev: { children: ReactNode }, prevState: State): void {
    // React Refresh resets error boundaries on the next edit after a render
    // error, which is how a fixed page comes back without a reload. Tell the
    // studio, or its error card outlives the error it describes.
    if (prevState.message !== null && this.state.message === null) {
      post({ source: "preview", type: "compiled", ms: Math.round(performance.now()) });
    }
  }

  render(): ReactNode {
    if (this.state.message === null) return this.props.children;

    // Inline styles on purpose. This renders precisely when the page is broken,
    // and it must not depend on a stylesheet that may be part of what broke.
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "32px",
          background: "#0b0b12",
          color: "#e6e6f0",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
        }}
      >
        <div style={{ maxWidth: "40rem" }}>
          <p style={{ margin: 0, fontSize: "12px", letterSpacing: "0.08em", color: "#f87171" }}>
            THIS PAGE FAILED TO RENDER
          </p>
          <p style={{ margin: "10px 0 0", fontSize: "15px", lineHeight: 1.5 }}>
            {this.state.message}
          </p>
          <p style={{ margin: "16px 0 0", fontSize: "13px", lineHeight: 1.6, color: "#9a9ab0" }}>
            The error has been sent to the chat on the left, where you can ask for a fix or
            undo the last change.
          </p>
        </div>
      </div>
    );
  }
}
