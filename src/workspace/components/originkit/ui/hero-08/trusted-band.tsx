// Delivered by Originkit · stack: nextjs · styling: tailwind
"use client";

import { CornerMark } from "@/workspace/components/originkit/ui/hero-08/corner-mark";

function asset(file: string) {
  return `/originkit/hero-08/${file}`;
}

const LOGOS = [
  {
    src: asset("logo-ipsum.svg"),
    size: "h-[11.5px] w-[49px] ipad:h-[15px] ipad:w-[65px]",
  },
  {
    src: asset("logo-lly.svg"),
    size: "h-[19px] w-[48px] ipad:h-[26px] ipad:w-[64px]",
  },
  {
    src: asset("logo-looo.svg"),
    size: "h-[11.5px] w-[51px] ipad:h-[15px] ipad:w-[67px]",
  },
] as const;

const STATS = [
  { label: "Total value locked", value: "$1.5M" },
  { label: "Intent processed", value: "3.2M" },
  { label: "Connected chains", value: "300" },
] as const;

const CELL_CLASS =
  "flex h-[80px] flex-1 items-center justify-center border-r border-white/10 last:border-r-0";

/**
 * Below the desktop the two strips are pinned inside the band and their `top`
 * is an offset from it — the stats strip's 530 is measured from the band, not
 * from the logo strip above it, so `absolute` is load-bearing rather than a
 * shortcut. At `desktop-sm:` they become the two halves of a flex row and drop
 * back into flow, which is also where the offsets have to be cleared.
 *
 * What never changes is that they stay *positioned*: both carry crosshairs that
 * hang outside their own box, and a breakpoint that let either strip go `static`
 * would re-anchor those marks to the canvas.
 *
 * `display` is left to each strip. The stats strip is cut on the phone, and an
 * unprefixed `flex` here would sit in the same cascade slot as that `hidden`.
 */
const STRIP_CLASS =
  "absolute right-0 left-0 border-y border-white/10 desktop-sm:relative desktop-sm:top-auto desktop-sm:right-auto desktop-sm:left-auto";

/**
 * The trusted-by band — Figma nodes 384:2560 (phone), 384:3232 (tablet),
 * 384:2415 (desktop).
 *
 * One row of four partner marks and one of three figures, re-composed rather
 * than reflowed at each frame: side by side on the desktop (540 + 499 = 1039,
 * the canvas less Figma's 1px), stacked 530px apart on the tablet with the globe
 * panel filling the space between them, and on the phone the figures are cut
 * entirely and only the logos remain.
 *
 * On the desktop the stats strip is the measured half and the logo strip absorbs
 * whatever is left — the reverse of how Figma lists them. The seam between the
 * two is not a seam: it is the globe panel's left border continuing down the
 * page, so the stats strip has to be whatever the panel is, and it is written
 * the same way — Figma's share of the canvas, 48.0769%, rather than the 499 that
 * share happens to equal at 1040. The two numbers are one measurement in two
 * files; move one and the seam leaves the border.
 *
 * Figma calls both strips 80px tall and also gives their cells 80px, which
 * cannot both be true once the two hairlines are counted. The cells are the
 * measurement that matters — they set each logo's optical centre — so the strips
 * are left to size themselves to 82 and everything around them is measured from
 * the cell edge instead.
 *
 * The desktop band is in flow, directly under the copy-and-globe row, because
 * its top edge is shared: Figma's y574 is also the bottom of the globe panel,
 * and the divider between the two strips continues the panel's left border down
 * the page on the same x540. Those are one continuous drawing, not two blocks
 * that happen to be adjacent, so they are laid out as one — the row takes the
 * canvas's spare height and the band rides on its bottom edge.
 *
 * Neither a fixed y574 nor a bottom offset survives that. Pinned to the top the
 * band stayed at 574 while the row grew and the panel border ran on past it;
 * pinned to the bottom it slid the other way and left the rule hanging in
 * mid-air. In flow the two cannot come apart.
 *
 * The 100px Figma leaves under the band is `pb` on the canvas rather than
 * anything here, so the row's `flex-1` resolves to exactly 574 at the frame.
 *
 * The "Trusted by people from" label is the one thing still absolute, and it is
 * measured from the canvas foot for the same reason — 197 is the 100 of padding
 * plus the band's 82 plus Figma's 15px of clearance above the rule.
 */
export const TrustedBand = () => (
  <>
    <p className="absolute z-[1] hidden text-[16px] leading-[normal] whitespace-nowrap text-[#a7a7a7] ipad:top-[348px] ipad:left-1/2 ipad:block ipad:-translate-x-1/2 ipad:text-center desktop-sm:top-auto desktop-sm:bottom-[197px] desktop-sm:left-[17px] desktop-sm:translate-x-0">
      Trusted by people from
    </p>

    <div className="absolute top-[686px] right-0 left-0 z-[1] h-[80px] ipad:top-[382px] ipad:h-[612px] desktop-sm:relative desktop-sm:top-auto desktop-sm:right-auto desktop-sm:left-auto desktop-sm:ml-px desktop-sm:flex desktop-sm:h-auto desktop-sm:flex-nowrap">
      <div className={`${STRIP_CLASS} top-0 flex desktop-sm:flex-1`}>
        <div className={CELL_CLASS}>
          {/* Figma pairs the mark with the wordmark; this is the only cell with two files. */}
          <span className="flex items-center gap-[2px] ipad:gap-[6px]">
            <img
              src={asset("logo-mark.svg")}
              alt=""
              aria-hidden
              className="h-[13.5px] w-[16px] object-contain ipad:h-[18px] ipad:w-[21px]"
            />
            <img
              src={asset("logo-type.svg")}
              alt="Logoipsum"
              className="h-[11px] w-[56px] object-contain ipad:h-[15px] ipad:w-[74px]"
            />
          </span>
        </div>
        {LOGOS.map((logo) => (
          <div className={CELL_CLASS} key={logo.src}>
            <img
              src={logo.src}
              alt="Partner logo"
              className={`object-contain ${logo.size}`}
            />
          </div>
        ))}

        {/* The phone drops the top-left mark — up there the strip's edge is the panel above it. */}
        <CornerMark className="top-[-7px] left-[-8px] hidden ipad:block" />
        <CornerMark className="bottom-[-7px] left-[-8px]" />
        <CornerMark className="right-[-7px] bottom-[-7px]" />
        {/* Only the tablet closes the top-right corner; on the desktop the stats strip does. */}
        <CornerMark className="top-[-8px] right-[-7px] hidden ipad:block desktop-sm:hidden" />
      </div>

      <div
        className={`${STRIP_CLASS} top-[530px] hidden ipad:flex desktop-sm:w-[48.0769%] desktop-sm:flex-none`}
      >
        {STATS.map((stat) => (
          <div className={`${CELL_CLASS} flex-col gap-[6px]`} key={stat.label}>
            <p className="text-[12px] leading-[normal] whitespace-nowrap text-[#a7a7a7]">
              {stat.label}
            </p>
            <p className="text-[18px] leading-[normal] whitespace-nowrap text-white">
              {stat.value}
            </p>
          </div>
        ))}

        <CornerMark className="right-[-7px] bottom-[-7px]" />
        <CornerMark className="bottom-[-7px] left-[-8px] hidden ipad:block desktop-sm:hidden" />
      </div>
    </div>
  </>
);
