// Delivered by Originkit · stack: nextjs · styling: tailwind
"use client";

import type { MouseEvent, ReactNode } from "react";

function asset(file: string) {
  return `/originkit/hero-08/${file}`;
}

type CtaVariant = "primary" | "secondary" | "nav";

/**
 * The three calls to action are all navigational, so they are anchors rather
 * than the repo's `Button` — but they carry the same interaction/a11y stack the
 * house Button contract defines, minus the parts that only apply to a `<button>`.
 *
 * `min-h-11` is the one addition to Figma's box: the tallest CTA here is 16px
 * type on 16px padding = 51px, so the floor never actually fires on desktop or
 * tablet. On the phone the buttons drop to 14px padding (47px) and it still
 * clears, which is why no breakpoint has to opt out of it.
 */
/**
 * Deliberately carries no `display`. The nav variant is desktop-only, and an
 * unprefixed `inline-flex` here would sit in the same cascade slot as the
 * `hidden` that switches it off — class order in the attribute does not break
 * that tie, CSS source order does, and `inline-flex` wins it. Each variant
 * declares its own display instead, so no element ever holds two.
 */
const BASE_CLASS =
  "relative min-h-11 cursor-pointer touch-manipulation items-center justify-center gap-[10px] whitespace-nowrap text-[16px] leading-[normal] text-white no-underline transition-[opacity,transform,background-color] duration-200 ease-out [-webkit-tap-highlight-color:transparent] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white active:scale-[0.97] motion-reduce:active:scale-100 [@media(hover:hover)_and_(pointer:fine)]:hover:opacity-90";

const VARIANT_CLASS: Record<CtaVariant, string> = {
  /** Figma 384:2415 — the one saturated surface in the section. */
  primary: "inline-flex bg-[#f76121] px-[24px] py-[14px] ipad:py-[16px]",
  secondary:
    "inline-flex border border-white/10 bg-[#272727] px-[24px] py-[14px] ipad:py-[16px] [@media(hover:hover)_and_(pointer:fine)]:hover:bg-[#323232]",
  /** The nav CTA is the same fill on a tighter box, and only the desktop nav has it. */
  nav: "hidden bg-[#f76121] px-[20px] py-[12px] desktop-sm:inline-flex",
};

const blockNav = (event: MouseEvent) => {
  event.preventDefault();
};

type CtaLinkProps = {
  href?: string;
  variant?: CtaVariant;
  className?: string;
  children: ReactNode;
};

export const CtaLink = ({
  href = "#",
  variant = "primary",
  className = "",
  children,
}: CtaLinkProps) => (
  <a
    href={href}
    onClick={blockNav}
    className={`${BASE_CLASS} ${VARIANT_CLASS[variant]} ${className}`}
  >
    {children}
  </a>
);

/** Figma pairs both filled CTAs with the same 20px glyph. */
export const ArrowIcon = () => (
  <img
    src={asset("arrow.svg")}
    alt=""
    aria-hidden
    className="size-[20px] shrink-0"
  />
);
