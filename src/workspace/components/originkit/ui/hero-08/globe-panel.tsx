// Delivered by Originkit · stack: nextjs · styling: tailwind
"use client";

import TextSphere from "@/workspace/components/originkit/ui/hero-08/text-sphere";
import { CornerMark } from "@/workspace/components/originkit/ui/hero-08/corner-mark";

function asset(file: string) {
  return `/originkit/hero-08/${file}`;
}

const TESTIMONIALS = [
  {
    name: "Emily Carter",
    role: "Design Manager",
    avatar: asset("avatar-emily.png"),
    /** Figma: phone 236/24 of 370 · tablet 294/83 · desktop 322/31 of 574x500. */
    position:
      "top-[236px] left-[6.4865%] ipad:top-[294px] ipad:left-[83px] desktop-sm:top-[calc(50%+52px)] desktop-sm:left-[calc(50%-315px)]",
  },
  {
    name: "David Kim",
    role: "NovaTech",
    avatar: asset("avatar-david.png"),
    /** Figma: phone 47/202 of 370 · tablet 70/385 · desktop 89/285 of 574x500. */
    position:
      "top-[47px] left-[54.5946%] ipad:top-[70px] ipad:left-[385px] desktop-sm:top-[calc(50%-294px)] desktop-sm:left-[calc(50%+52px)]",
  },
] as const;

/**
 * The word-globe panel — Figma nodes 384:2560 (phone), 384:3232 (tablet),
 * 384:2415 (desktop).
 *
 * Figma frames this panel with a hairline on the sides that face the rest of the
 * layout, and only those: top and bottom on the phone where it is a full-width
 * band cut into the column, bottom only on the tablet where it closes the frame,
 * and the left edge on the desktop where it divides the globe from the copy. All
 * three are the same rule seen from a different side, so the borders switch per
 * breakpoint rather than the panel gaining a wrapper.
 *
 * The crosshairs follow that: the tablet drops the top pair because the panel's
 * top edge is not drawn there, so a mark on it would float on nothing.
 *
 * The desktop panel is a *share* of the canvas — Figma's 500 of 1040, 48.0769%
 * — not the 500 itself. The canvas grows to 1920 above the frame (see
 * `section-hero.tsx`) and a constant 500 spent every one of those pixels on
 * the gap between the copy and the globe: Figma holds 213px between the CTAs and
 * this panel's border, a fixed panel opens 858 at a 1600 canvas. Nothing else in
 * the row can take that width — the type is Figma's and the cards are
 * intrinsically sized — so the panel is what has to keep its proportion.
 *
 * Vertically the panel is a stretched flex item rather than Figma's 574: the row
 * grows with the window up to the 1040 cap, and this border is what continues
 * down into the trusted band's seam, so it has to reach it.
 *
 * The globe box is 416x400 on the tablet and 700x680 on the desktop, centred on
 * both axes. Figma draws 416 inside its 500 panel, which reads as a small sphere
 * adrift once the canvas opens up — the panel is a share and runs to 923 at a
 * 1920 canvas while the sphere sat at 400. The sphere is `min(width, height)`, so
 * 680 is what shows, with the box's 20px of horizontal slack keeping the glyphs
 * off the divider.
 *
 * That size is drawn for the open canvas, not for Figma's 1280 frame: the box
 * needs a panel at least 700 wide, which is a canvas of about 1456, and a row at
 * least 680 tall, which is a window of about 940. Under either the sphere paints
 * past the panel, since the box clips the canvas but the panel does not clip the
 * box.
 *
 * The testimonial cards are measured from the panel's axes rather than from its
 * edges, because they belong to the globe and not to the border. Figma's 31/322
 * and 285/89 inside a 500x574 panel are 219 left and 35 below centre, and 35
 * right and 198 above it: the card's outer edge a hair beyond the silhouette,
 * its inner edge well over it, and the cross-axis offset 0.175 of the radius.
 *
 * Those are ratios of the *silhouette*, and the silhouette is not the box. The
 * component leaves a margin for the glyphs it throws widest, so the cloud runs
 * about 0.87 of `min(width, height)` — 296 of the 340 the 700x680 box implies,
 * measured off the render. Taken from 340 the cards clear the arc by 30px, and
 * David is the one it shows on: his box hangs upward from its top edge, so
 * nothing carries him back over the cloud the way Emily's 140px of width carries
 * her. So the offsets are spent from 296: 315 and 52 for Emily, 294 and 52 for
 * David, which puts about 120px of each card over the glyphs.
 *
 * Below the 402 frame the canvas is the one thing that goes fluid, and the globe
 * is the one thing wide enough to notice, so 17/370 and 336/370 are carried as
 * percentages of the panel.
 */
export const GlobePanel = () => (
  <div className="absolute top-[363px] right-0 left-0 h-[323px] border-x-0 border-y border-white/10 ipad:top-[464px] ipad:h-[448px] ipad:border-t-0 desktop-sm:relative desktop-sm:top-auto desktop-sm:right-auto desktop-sm:left-auto desktop-sm:h-auto desktop-sm:w-[48.0769%] desktop-sm:flex-none desktop-sm:self-stretch desktop-sm:border-y-0 desktop-sm:border-l">
    <CornerMark className="top-[-7.5px] left-[-7.5px] ipad:hidden desktop-sm:block" />
    <CornerMark className="top-[-7.5px] right-[-7.5px] ipad:hidden desktop-sm:block" />
    <CornerMark className="bottom-[-7px] left-[-7px]" />
    <CornerMark className="right-[-7px] bottom-[-7px]" />

    <div className="absolute top-[-1px] left-[4.5946%] z-0 h-[323px] w-[90.8108%] overflow-hidden ipad:top-[24px] ipad:left-[116px] ipad:h-[400px] ipad:w-[416px] desktop-sm:top-1/2 desktop-sm:left-1/2 desktop-sm:h-[680px] desktop-sm:w-[700px] desktop-sm:-translate-x-1/2 desktop-sm:-translate-y-1/2">
      <TextSphere
        word="procura"
        speed={6}
        twist={50}
        letterSpacing={800}
        rotationSide="clockwise"
      />
    </div>

    {TESTIMONIALS.map((person) => (
      <div
        key={person.name}
        className={`ok-h08-person absolute z-20 ${person.position}`}
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          padding: 12,
          background: "#222",
          border: "1px solid rgba(255, 255, 255, 0.1)",
          width: "max-content",
          boxSizing: "border-box",
          zIndex: 20,
        }}
      >
        <img
          src={person.avatar}
          alt=""
          width={32}
          height={32}
          aria-hidden
          style={{
            width: 32,
            height: 32,
            maxWidth: "none",
            borderRadius: 9999,
            objectFit: "cover",
            flex: "0 0 32px",
            display: "block",
          }}
        />
        <div
          className="ok-h08-person-copy"
          style={{
            display: "flex",
            flexDirection: "column",
            flex: "0 0 auto",
            minWidth: "max-content",
          }}
        >
          <p
            className="ok-h08-person-name"
            style={{
              margin: 0,
              color: "#fff",
              fontSize: 14,
              lineHeight: "normal",
              whiteSpace: "nowrap",
            }}
          >
            {person.name}
          </p>
          <p
            className="ok-h08-person-role"
            style={{
              margin: 0,
              color: "#fff",
              fontSize: 12,
              lineHeight: "normal",
              opacity: 0.7,
              whiteSpace: "nowrap",
            }}
          >
            {person.role}
          </p>
        </div>
      </div>
    ))}
  </div>
);
