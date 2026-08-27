/**
 * Viewport presets for the preview card (§10).
 *
 * These are not decoration. `sections/hero.tsx` is written against `ipad:` and
 * `desktop-sm:` breakpoints, so "make the headline smaller on mobile" is a
 * request the user cannot even verify without being able to narrow the frame.
 */
export type ViewportId = "desktop" | "tablet" | "mobile";

export interface Viewport {
  id: ViewportId;
  label: string;
  /** null = fill the canvas. */
  width: number | null;
}

export const VIEWPORTS: Viewport[] = [
  { id: "desktop", label: "Desktop", width: null },
  { id: "tablet", label: "Tablet", width: 834 },
  { id: "mobile", label: "Mobile", width: 390 },
];

export const viewportById = (id: ViewportId): Viewport =>
  VIEWPORTS.find((v) => v.id === id) ?? VIEWPORTS[0];
