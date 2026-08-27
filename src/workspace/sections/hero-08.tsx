"use client";

// Section: hero-08 — Originkit hero-08 / section-hero (Procura AI word globe).
// This file IS the section. The agent edits it directly; Turbopack HMR repaints
// the preview iframe. Sub-components live in ../components/originkit/ui/hero-08/.
//
// Wired to `section-hero`, not to the registry's own `hero-08` entry point: that
// one renders `procura-hero`, whose `.h08-*` stylesheet was never published, so
// it comes up completely unstyled. `hero-08.css` here matches THIS tree — the
// `.ok-h08-person` rules it carries are `globe-panel`'s. (The CLI warned about
// the same thing on install: "a published component looks malformed".)

import "@/workspace/components/originkit/hero-08.css";
import { CanvasWash, PageGlow, PageGrain, PatternField } from "@/workspace/components/originkit/ui/hero-08/backdrop";
import { CornerMark } from "@/workspace/components/originkit/ui/hero-08/corner-mark";
import { EdgeRail } from "@/workspace/components/originkit/ui/hero-08/edge-rail";
import { GlobePanel } from "@/workspace/components/originkit/ui/hero-08/globe-panel";
import { HeroCopy } from "@/workspace/components/originkit/ui/hero-08/hero-copy";
import { Navbar } from "@/workspace/components/originkit/ui/hero-08/navbar";
import { TrustedBand } from "@/workspace/components/originkit/ui/hero-08/trusted-band";

/**
 * Figma frames:
 * - Mobile  384:2560 — 402 x 874   (65 nav + 809 body, 16px rails, 370 canvas)
 * - Tablet  384:3232 — 744 x 1133  (65 nav + 1068 body, 48px rails, 648 canvas)
 * - Desktop 384:2415 — 1280 x 832  (76 nav + 756 body, 120px rails, 1040 canvas)
 *
 * A procurement hero built as a drafting sheet: a hatched margin down each side,
 * a canvas between them carrying an arc field, the headline, a rotating word
 * globe, and a trusted-by band, with crosshairs on every panel join.
 *
 * Every frame is `rail + canvas + rail`, and the two numbers add up exactly at
 * all three widths. That is the whole layout, so it is written as the whole
 * layout — three flex items, no absolute positioning at this level. The rails
 * are the frame edge in this design, so capping the section instead would
 * strand them mid-screen with bare page outside.
 *
 * Above the desktop frame the *canvas* takes the surplus, not the rails. The
 * absurd `grow-[999]` is the point: flex hands the canvas effectively all the
 * free width until `max-w` clamps it at 1920, freezes it there, and only then
 * redistributes what is left to the two rails. So the rails hold Figma's 120px
 * until 2160 and the drawing fills the screen, rather than the composition
 * sitting in a 1040 column with 440px of hatch either side of it at 1920.
 * Past 2160 the rails widen again, which is the intended ceiling.
 *
 * The nav row is the one thing outside this box that has to move with the cap:
 * it is measured to sit 80px outside the canvas on each side, so its own cap is
 * this one plus 160. See `navbar.tsx`.
 *
 * Everything inside the canvas is therefore measured from a canvas edge, never
 * from 1040 (see `trusted-band.tsx` for the one place that is load-bearing).
 *
 * The one division of the canvas is Figma's 540/500 — copy against globe panel —
 * and it is carried as a share, not as the 500. Left as a constant it made the
 * gap between the CTAs and the panel the only thing that grew: 213px at the
 * frame, 858 at a 1600 canvas. `globe-panel.tsx` holds the share and
 * `trusted-band.tsx` repeats it, because the panel's left border and the band's
 * seam are one line.
 *
 * Below the 402 frame the split runs the other way. Flex shrink is left on the
 * canvas so it gives ground before the rails collapse, which is why the phone's
 * globe box and paragraph measure are carried as percentages of the canvas —
 * they are the only two things wide enough for the difference to show. The
 * tablet and desktop canvases never leave 648 and 1040 inside their breakpoint
 * ranges, so everything there stays in Figma's pixels.
 *
 * Height. The section is a floor, not a height, at all three frames: `min-h-dvh`
 * under Figma's own number, so the rails and the lit ground reach the bottom of
 * any window rather than stopping mid-screen and leaving the page's `#181818`
 * showing under the section's `#080808`.
 *
 * The ceiling is on the *canvas*, not the section, and that split is the point.
 * The composition stops growing at a 1040 window — 964 of canvas under the 76px
 * nav — because past that it gains nothing: the globe is fixed at 400 and the
 * copy is fixed by its type, so a taller composition is only air between them.
 * But the rails are the frame edge in this design and have to run the full
 * height, and they do, because they are siblings of the canvas in a row that is
 * still `flex-1`. Only the drawing caps; the sheet it is drawn on does not.
 *
 * The surplus is distributed by flex, not by offsets. The canvas is a column of
 * one growing row and one band, with Figma's 100px under the band carried as
 * `pb` on the canvas itself; the row takes `flex-1` and everything inside it
 * centres. At the 832 frame that resolves to Figma's numbers exactly — 756
 * canvas less 100 less the band's 82 is the 574 row — and above it the row is
 * the only thing that grows.
 *
 * It has to be flex rather than the offsets it replaced, because this is one
 * drawing and not three blocks: the globe panel's top edge is the nav's bottom
 * rule, its bottom edge is the band's top rule, and its left border runs on down
 * as the divider between the two strips. Held at fixed y offsets those rules
 * came apart as soon as the section grew past 832 — the panel border ran on past
 * a band still pinned at 574. In flow they cannot.
 *
 * Paint order is Figma's: grain and page glow over the whole section, the arc
 * field and canvas wash under the canvas, content above both, nav above all.
 * `isolate` keeps the grain's `screen` blend from reaching past the section.
 */
export const SectionHero = () => (
  <main className="relative isolate flex h-[874px] min-h-dvh w-full flex-col overflow-hidden bg-[#080808] font-helvetica text-white ipad:h-[1133px] desktop-sm:h-[832px]">
    <PageGlow />
    <PageGrain />

    <Navbar />

    <div className="relative z-10 flex w-full flex-1">
      <EdgeRail side="left" />

      <div className="relative flex w-[370px] min-w-0 flex-col ipad:w-[648px] desktop-sm:w-[1040px] desktop-sm:max-h-[964px] desktop-sm:max-w-[1920px] desktop-sm:grow-[999] desktop-sm:pb-[100px]">
        {/*
          Figma anchors this one to the frame's top-left canvas corner and only
          draws it on the desktop. Hung off the canvas rather than off the frame
          it stays on that corner once the rails start growing.
        */}
        <CornerMark className="top-0 left-0 z-[3] hidden -translate-x-1/2 -translate-y-1/2 desktop-sm:block" />

        <CanvasWash />
        <PatternField />

        {/*
          The copy and the globe are one band. Below the desktop they stack, and
          Figma pins both against the canvas rather than letting them flow — the
          318px / 419px between them is measured, not the sum of two auto
          heights — so the band takes the canvas height and its two children are
          absolute. At `desktop-sm:` they sit side by side in Figma's 574px row
          and the copy returns to flow.
        */}
        <div className="relative z-[1] h-[809px] ipad:h-[1068px] desktop-sm:flex desktop-sm:h-auto desktop-sm:flex-1 desktop-sm:items-center">
          <HeroCopy />
          <GlobePanel />
        </div>

        <TrustedBand />
      </div>

      <EdgeRail side="right" />
    </div>
  </main>
);

export default SectionHero;
