// Delivered by Originkit · stack: nextjs · styling: tailwind
"use client";

import type { MouseEvent } from "react";

import { ArrowIcon, CtaLink } from "@/workspace/components/originkit/ui/hero-08/cta-link";

const NAV_LINKS = [
  { label: "Home", href: "#" },
  { label: "Pricing", href: "#" },
  { label: "About", href: "#" },
  { label: "Tools", href: "#" },
] as const;

const LINK_CLASS =
  "flex min-h-11 items-center text-[16px] leading-[normal] text-white no-underline opacity-85 transition-opacity duration-200 ease-out [-webkit-tap-highlight-color:transparent] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white [@media(hover:hover)_and_(pointer:fine)]:hover:opacity-100";

const blockNav = (event: MouseEvent) => {
  event.preventDefault();
};

/**
 * Figma frames: mobile 384:2560 · tablet 384:3232 · desktop 384:2415.
 *
 * One band, three states of the same row. The phone and tablet show brand +
 * hamburger at 65px tall; the desktop grows to 76px and adds the links and the
 * orange CTA. The links are centred on the *band*, not distributed between the
 * brand and the CTA, so they stay put when either end changes width — that is
 * what Figma's absolute x on that group actually encodes.
 *
 * The inner row is measured to sit 80px outside the canvas on each side, which
 * is what Figma's 1200 row means on the 1280 frame: the brand lands 40px inside
 * the frame edge and the canvas starts 120px in. That gap is the relationship
 * worth keeping, not the 1200.
 *
 * So the row tracks the canvas rather than holding a constant. The canvas grows
 * to 1920 before the rails do (see `section-hero.tsx`), and a fixed 1200 row
 * would have flipped the relationship inside out — at 1920 the brand would sit
 * 376px *inside* a canvas edge it is supposed to sit outside. `100% - 16px`
 * against the band's own 32px padding resolves to exactly 1200 at the 1280
 * frame, and the 2080 cap is the 1920 canvas plus the same 80 either side.
 * The two caps are one number in two places: move the canvas and this follows.
 */
export const Navbar = () => (
  <header className="relative z-30 flex h-[65px] w-full flex-none items-center justify-center border-b border-white/10 px-[16px] py-[20px] desktop-sm:h-[76px] desktop-sm:px-[32px] desktop-sm:py-[16px]">
    <div className="relative flex w-full max-w-none items-center justify-between px-[16px] desktop-sm:w-[calc(100%-16px)] desktop-sm:max-w-[2080px]">
      <a
        href="#"
        aria-label="Procura AI home"
        onClick={blockNav}
        className="text-[22px] leading-[normal] tracking-[-0.66px] whitespace-nowrap text-white no-underline transition-opacity duration-200 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white [@media(hover:hover)_and_(pointer:fine)]:hover:opacity-90"
      >
        Procura AI
      </a>

      <nav
        aria-label="Primary"
        className="absolute left-1/2 hidden -translate-x-1/2 desktop-sm:block"
      >
        <ul className="flex items-center gap-[24px] whitespace-nowrap">
          {NAV_LINKS.map((item) => (
            <li key={item.label}>
              <a href={item.href} onClick={blockNav} className={LINK_CLASS}>
                {item.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <CtaLink href="#" variant="nav">
        <span>Get Started</span>
        <ArrowIcon />
      </CtaLink>

      {/*
        Figma draws the hamburger as a bare 24x24 hit box. The touch floor takes
        it to 44 and the glyph is re-registered with `-mr-[10px]` so its right
        edge lands where the design puts it rather than 10px in; the extra height
        disappears into the band's 20px padding, so nothing moves.
      */}
      <button
        type="button"
        aria-label="Open menu"
        className="-mr-[10px] inline-flex min-h-11 min-w-11 cursor-pointer touch-manipulation items-center justify-center border-none bg-transparent p-0 transition-opacity duration-200 ease-out [-webkit-tap-highlight-color:transparent] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white active:scale-[0.97] motion-reduce:active:scale-100 desktop-sm:hidden [@media(hover:hover)_and_(pointer:fine)]:hover:opacity-90"
      >
        {/*
          The only asset the export pointed at Figma's expiring CDN rather than
          shipping, so the glyph is drawn here: three 2px-spaced rules on the
          24px grid, matching the stroke weight of the hairlines around it.
        */}
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          fill="none"
          className="size-[24px]"
        >
          <path
            d="M3 6h18M3 12h18M3 18h18"
            stroke="white"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  </header>
);
