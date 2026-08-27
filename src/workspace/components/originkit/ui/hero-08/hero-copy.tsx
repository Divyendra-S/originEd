// Delivered by Originkit · stack: nextjs · styling: tailwind
"use client";

import { ArrowIcon, CtaLink } from "@/workspace/components/originkit/ui/hero-08/cta-link";

const TITLE = "Every Purchase Starts With a Conversation.";
const DESCRIPTION =
  "Meet Procura AI, the intelligent procurement assistant that captures purchase requests, without losing control.";

/**
 * The headline column. Two things re-pitch across the frames rather than scale:
 * the type steps 35/-1.4 to 48/-1.92 in one move at the tablet, and the whole
 * column swings from centred to left-aligned only at the desktop, where the
 * globe finally sits beside it instead of under it.
 *
 * The phone and tablet pin this block absolutely at y45 inside the canvas
 * because the globe panel below it is pinned too, and the gap between them is a
 * measured 318px / 419px rather than the sum of two auto-heights. From the
 * desktop up the column is a flex item beside the panel and is centred in the
 * row rather than carrying Figma's 140px top margin: the row grows with the
 * window now, and a top margin would have left the copy pinned to the ceiling
 * while the globe — centred in the panel — drifted down away from it. At the 574
 * row Figma's own 140 top against 175 bottom is centred to within 17px, so this
 * reproduces the frame and survives the growth.
 */
export const HeroCopy = () => (
  <div className="absolute top-[45px] left-0 flex w-full flex-col items-center gap-[24px] text-center ipad:left-1/2 ipad:w-[497px] ipad:-translate-x-1/2 ipad:gap-[32px] desktop-sm:relative desktop-sm:top-auto desktop-sm:left-auto desktop-sm:w-auto desktop-sm:flex-1 desktop-sm:translate-x-0 desktop-sm:items-start desktop-sm:pl-[16px] desktop-sm:text-left">
    <div className="flex w-full flex-col items-center gap-[8px] ipad:gap-[16px] desktop-sm:items-start">
      <h1 className="w-full text-[35px] leading-[normal] font-normal tracking-[-1.4px] text-balance text-white ipad:text-[48px] ipad:tracking-[-1.92px] desktop-sm:w-[500px]">
        {TITLE}
      </h1>
      {/*
        Figma holds this paragraph to a narrower measure than the column at every
        frame — 354 inside 370, 453 inside 497 — and only lets it fill on the
        desktop. The phone value is a percentage because the canvas is the one
        box in this section that goes fluid below its frame width.
      */}
      <p className="w-[95.68%] text-[16px] leading-[1.5] font-normal text-pretty text-[#a7a7a7] ipad:w-[453px] desktop-sm:w-[500px]">
        {DESCRIPTION}
      </p>
    </div>

    <div className="flex w-full flex-col items-stretch gap-[8px] ipad:flex-row ipad:flex-wrap ipad:items-center ipad:justify-center ipad:gap-[18px] desktop-sm:w-auto desktop-sm:justify-start">
      <CtaLink href="#" className="w-full ipad:w-auto">
        <span>Get Started</span>
        <ArrowIcon />
      </CtaLink>
      <CtaLink
        href="#"
        variant="secondary"
        className="w-full ipad:w-auto"
      >
        Book a Call
      </CtaLink>
    </div>
  </div>
);
