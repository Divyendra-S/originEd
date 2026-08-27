import type { ReactNode } from "react";
import "./preview.css";
import { Inspector } from "./_runtime/Inspector";
import { PreviewErrorBoundary } from "./_runtime/PreviewErrorBoundary";

/**
 * Root layout #2. The preview group has its OWN <html>/<body> and its OWN
 * stylesheet (§10) — that is the point of the route-group split. The studio's
 * Tailwind build and the workspace's OriginKit theme tokens never meet.
 *
 * Navigating between the two root layouts causes a full page load, which is
 * irrelevant here: the studio never links to /preview, it embeds it in an iframe.
 */
export default function PreviewRootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full">
        {/* The boundary wraps the page but NOT the Inspector: a section that
            throws must not take the bridge down with it, or the studio loses
            the channel it would have heard about the error on. */}
        <PreviewErrorBoundary>{children}</PreviewErrorBoundary>
        <Inspector />
      </body>
    </html>
  );
}
