"use client";

// Section: hero — originally Originkit hero-16 / section-22.
// This file IS the section. The agent edits it directly; Turbopack HMR repaints
// the preview iframe. Sub-components live in ../components/originkit/ui/hero-16/.

import "@/workspace/components/originkit/hero-16.css";
import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import InteractiveHeroCanvas from "@/workspace/components/originkit/ui/hero-16/wave-arcs";
import RollingLetters from "@/workspace/components/originkit/ui/hero-16/rolling-text";
import Sparkles from "@/workspace/components/originkit/ui/hero-16/startdust";
import { useWaveArcsConfig } from "@/workspace/components/originkit/ui/hero-16/use-wave-arcs-config";

/** Public asset under /sections/hero-16/assets */
function asset(file: string) {
  return `/originkit/hero-16/${file}`;
}

const NAV_LINKS = [
  { href: "#home", label: "Home" },
  { href: "#service", label: "Service" },
  { href: "#product", label: "Product" },
  { href: "#about", label: "About Us" },
] as const;

const STAR_DUST_HEIGHT = 120;

const EASE_OUT = [0.215, 0.61, 0.355, 1] as const;

type RevealPhase = "bg" | "nav" | "headline" | "content";

const fadeUpVariants = {
  hidden: { opacity: 0, y: 16 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.35, ease: EASE_OUT },
  },
};

const Hero = () => {
  const [email, setEmail] = useState("");
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const { lineWidth, lineCount } = useWaveArcsConfig();
  const prefersReducedMotion = useReducedMotion();

  const [phase, setPhase] = useState<RevealPhase>("bg");

  useEffect(() => {
    if (prefersReducedMotion) setPhase("content");
  }, [prefersReducedMotion]);

  const showNav = prefersReducedMotion || phase !== "bg";
  const showHeadline =
    prefersReducedMotion || phase === "headline" || phase === "content";
  const showContent = prefersReducedMotion || phase === "content";

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setEmail("");
  };

  const handleToggleMenu = () => {
    setIsMenuOpen((prev) => !prev);
  };

  const handleCloseMenu = () => {
    setIsMenuOpen(false);
  };

  const handleBgComplete = () => {
    setPhase((current) => (current === "bg" ? "nav" : current));
  };

  const handleNavComplete = () => {
    setPhase((current) => (current === "nav" ? "headline" : current));
  };

  const handleHeadlineComplete = () => {
    setPhase((current) => (current === "headline" ? "content" : current));
  };

  return (
    <section
      aria-label="Stay ahead of the bezier curve"
      className="relative isolate flex min-h-svh w-full flex-col justify-between overflow-hidden bg-[#0c0a09] text-white select-none"
    >
      {/* 1. Background — fades in first */}
      <motion.div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-0"
        initial={prefersReducedMotion ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.45, ease: EASE_OUT }}
        onAnimationComplete={handleBgComplete}
      >
        <div className="absolute inset-0 -translate-y-[8%] ipad:-translate-y-[0%]">
          <InteractiveHeroCanvas
            backgroundColor="#0a0a0a"
            lineColor="#02b7f6"
            lineWidth={lineWidth}
            lineCount={lineCount}
            speed={6}
            glow={10}
            interactive={true}
          />
        </div>

        <div className="absolute top-1/2 left-1/2 h-125 w-225 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#00A3FF]/15 blur-[120px]" />
        <div className="absolute bottom-0 left-1/2 size-206.25 -translate-x-1/2 translate-y-1/2 rounded-full bg-cyan-700 blur-[267px]" />
      </motion.div>

      {/* Circle overlay — above interaction bg, below UI */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-10 desktop-sm:translate-x-0 translate-x-[-5%] flex items-center justify-center translate-y-[50%]"
      >
        {/* Mobile */}
        <div className="relative size-[1778.65px] opacity-30 ipad:hidden">
          <div className="size-[1778.65px] relative opacity-30">
            <div className="size-[1313.27px] left-[232.69px] top-[232.69px] absolute opacity-10 rounded-full border-1 border-white" />
            <div className="size-[1778.65px] left-0 top-0 absolute opacity-20 rounded-full border-1 border-white" />
            <div className="size-[1017.71px] left-[380.46px] top-[380.47px] absolute opacity-20 rounded-full border-1 border-white/50" />
            <div className="size-[719.37px] left-[529.64px] top-[529.64px] absolute opacity-0 rounded-full border-1 border-white" />
            <div className="size-7 left-[353px] top-[480.13px] absolute rounded-full border-1 border-slate-600" />
            <div className="size-3 left-[361.37px] top-[488.50px] absolute bg-slate-800 rounded-full border-1 border-slate-600" />
            <div className="size-7 left-[1272.42px] top-[351.88px] absolute rounded-full border-1 border-slate-600" />
            <div className="size-3 left-[1280.77px] top-[360.23px] absolute bg-slate-800 rounded-full border-1 border-slate-600" />
          </div>
        </div>

        {/* iPad */}
        <div className="relative hidden size-[2305.73px] opacity-30 ipad:block desktop-sm:hidden">
          <div className="size-[2305.73px] relative opacity-30">
            <div className="size-[1702.44px] left-[301.64px] top-[301.64px] absolute opacity-10 rounded-full border-[1.47px] border-white" />
            <div className="size-[2305.73px] left-0 top-0 absolute opacity-20 rounded-full border-[1.47px] border-white/50" />
            <div className="size-[1319.30px] left-[493.22px] top-[493.22px] absolute opacity-20 rounded-full border-[1.47px] border-white/50" />
            <div className="size-[932.55px] left-[686.59px] top-[686.59px] absolute opacity-0 rounded-full border-[1.47px] border-white" />
            <div className="size-9 left-[457.62px] top-[622.42px] absolute rounded-full border-[1.47px] border-slate-600" />
            <div className="size-3.5 left-[468.46px] top-[633.26px] absolute bg-slate-800 rounded-full border-[1.47px] border-slate-600" />
            <div className="size-9 left-[1649.47px] top-[456.14px] absolute rounded-full border-[1.47px] border-slate-600/50" />
            <div className="size-3.5 left-[1660.31px] top-[466.98px] absolute bg-slate-800 rounded-full border-[1.47px] border-slate-600" />
          </div>
        </div>

        {/* Desktop */}
        <div className="relative hidden size-[1567px]  opacity-30 desktop-sm:block">
          <div className="size-[1157px] left-[205px] top-[205px] absolute opacity-10 rounded-full border border-white/50" />
          <div className="size-[1567px] left-0 top-0 absolute opacity-20 rounded-full border border-white/45" />
          <div className="size-[896.61px] left-[335.20px] top-[335.20px] absolute opacity-20 rounded-full border border-white/70 border-dashed" />
          <div className="size-[633.77px] left-[466.62px] top-[466.62px] absolute opacity-0 rounded-full border border-white/50 " />
          <div className="size-6 left-[311px] top-[423px] absolute rounded-full border opacity-20" />
          <div className="size-2.5 left-[318.37px] top-[430.37px] absolute bg-red-500 rounded-full opacity-10 " />
          <div className="size-6 left-[1121px] top-[310px] absolute rounded-full border opacity-20 " />
          <div className="size-2.5 left-[1128.37px]  top-[317.37px] absolute bg-[#19333C]/70 rounded-full opacity-10" />
        </div>
      </div>

      {/* 2. Navbar — slides in from top after background */}
      <motion.header
        className="relative z-20 mx-auto flex w-dvw px-6  items-center justify-between py-6 desktop-sm:px-12 ultrawide:max-w-360"
        initial={prefersReducedMotion ? false : { y: "-120%", opacity: 0 }}
        animate={showNav ? { y: 0, opacity: 1 } : { y: "-120%", opacity: 0 }}
        transition={{ duration: 0.4, ease: EASE_OUT }}
        onAnimationComplete={() => {
          if (showNav) handleNavComplete();
        }}
      >
        <a
          href="#home"
          aria-label="Visionary home"
          className="flex min-h-11 items-center gap-2 touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white [-webkit-tap-highlight-color:transparent] cursor-pointer"
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 22 22"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="text-white"
            aria-hidden="true"
          >
            <path
              d="M11 0L13.5 8.5L22 11L13.5 13.5L11 22L8.5 13.5L0 11L8.5 8.5L11 0Z"
              fill="currentColor"
            />
          </svg>
          <span className="font-sans text-xl font-semibold tracking-[-0.4px]">
            Visionary
          </span>
        </a>

        <nav
          aria-label="Main Navigation"
          className="hidden items-center rounded-xl border border-white/10 bg-white/[0.03] p-1 shadow-lg backdrop-blur-md desktop-sm:flex ml-20"
        >
          {NAV_LINKS.map((link, index) => (
            <a
              key={link.href}
              href={link.href}
              className={
                index === 0
                  ? "rounded-lg bg-white/15 px-4 py-2 font-tight text-xs font-normal text-white transition-colors duration-200 ease [@media(hover:hover)_and_(pointer:fine)]:hover:bg-white/20 cursor-pointer"
                  : "px-4 py-2 text-xs font-normal text-white/80 transition-colors duration-200 ease [@media(hover:hover)_and_(pointer:fine)]:hover:text-white cursor-pointer"
              }
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="hidden items-center gap-3 desktop-sm:flex">
          <a
            href="#sign-in"
            className="rounded-full border border-[#2f2f2f] bg-white/[0.02] px-5 py-2.5 text-sm font-normal text-white transition-colors duration-200 ease [@media(hover:hover)_and_(pointer:fine)]:hover:border-white/30 [@media(hover:hover)_and_(pointer:fine)]:hover:bg-white/10 cursor-pointer"
          >
            Sign in
          </a>
          <a
            href="#join"
            className="rounded-full bg-white px-5 py-2.5 text-sm font-medium text-[#121212] transition-transform duration-200 ease [@media(hover:hover)_and_(pointer:fine)]:hover:scale-105 cursor-pointer"
          >
            Join Now
          </a>
        </div>

        <button
          type="button"
          aria-label={isMenuOpen ? "Close menu" : "Open menu"}
          aria-expanded={isMenuOpen}
          aria-controls="mobile-nav"
          onClick={handleToggleMenu}
          className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center touch-manipulation transition-opacity duration-200 ease focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white [-webkit-tap-highlight-color:transparent] desktop-sm:hidden [@media(hover:hover)_and_(pointer:fine)]:hover:opacity-80 cursor-pointer"
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
            className="size-6 text-white"
          >
            {isMenuOpen ? (
              <path
                d="M6 6L18 18M18 6L6 18"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
              />
            ) : (
              <path
                d="M4 7H20M4 12H20M4 17H20"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
              />
            )}
          </svg>
        </button>
      </motion.header>

      {/* Mobile menu panel */}
      <div
        id="mobile-nav"
        className={`absolute inset-x-0 top-[90px] z-30 px-6 ipad:hidden ${isMenuOpen ? "block" : "hidden"}`}
      >
        <nav
          aria-label="Mobile Navigation"
          className="flex flex-col gap-1 rounded-2xl border border-white/10 bg-[#0a0809]/95 p-3 shadow-2xl backdrop-blur-md"
        >
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={handleCloseMenu}
              className="min-h-11 rounded-xl px-4 py-3 text-sm font-normal text-white/80 transition-colors duration-200 ease touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white [-webkit-tap-highlight-color:transparent] [@media(hover:hover)_and_(pointer:fine)]:hover:bg-white/10 [@media(hover:hover)_and_(pointer:fine)]:hover:text-white"
            >
              {link.label}
            </a>
          ))}
          <div className="mt-2 flex flex-col gap-2 border-t border-white/10 pt-3">
            <a
              href="#sign-in"
              onClick={handleCloseMenu}
              className="flex min-h-11 w-full items-center justify-center rounded-full border border-[#2f2f2f] bg-white/[0.02] px-5 py-2.5 text-sm font-normal text-white transition-colors duration-200 ease touch-manipulation cursor-pointer"
            >
              Sign in
            </a>
            <a
              href="#join"
              onClick={handleCloseMenu}
              className="flex min-h-11 w-full items-center justify-center rounded-full bg-white px-5 py-2.5 text-sm font-medium text-[#121212] transition-opacity duration-200 ease touch-manipulation cursor-pointer"
            >
              Join Now
            </a>
          </div>
        </nav>
      </div>

      {/* Main Hero Content */}
      <main className="relative z-20 mx-auto flex w-full max-w-[340px] max-h-[600px] flex-1 flex-col items-center justify-between py-12 pt-[62px] text-center ipad:max-h-[623px] ipad:max-w-[512px] desktop-sm:max-h-[650px]">
        {/* 3. Headline — rolling text after navbar */}
        <RollingLetters
          tag="h1"
          className="w-full text-center font-instrument-serif text-[40px] leading-[1.1] tracking-[-0.5px] ipad:text-[52px] desktop-sm:text-[56px] desktop-sm:leading-[60px]"
          color="#ffffff"
          startFrom="bottom"
          staggerFrom="center"
          animate={showHeadline}
          onAnimationComplete={handleHeadlineComplete}
          font={{
            fontWeight: 400,
            textAlign: "center",
          }}
          transition={{
            duration: 0.45,
            delay: 0,
            ease: EASE_OUT,
            staggerChildren: 0.028,
          }}
          segments={[
            { text: "Stay ahead of the\n" },
            { text: "(bezier)", className: "italic" },
            { text: " curve" },
          ]}
        />

        {/* 4. Description + social + form — stagger after headline */}
        <motion.div
          className="mt-8 flex w-full flex-col items-center gap-6"
          initial="hidden"
          animate={showContent ? "show" : "hidden"}
          variants={{
            hidden: {},
            show: {
              transition: {
                staggerChildren: 0.12,
                delayChildren: 0.04,
              },
            },
          }}
        >
          <motion.p
            variants={fadeUpVariants}
            className="w-full font-tight text-[16px] leading-relaxed text-white/80 ipad:text-lg ipad:text-[18px]"
          >
            Get inspired, learn what’s new in design, and{" "}
            <br className="hidden ipad:block" />
            connect with pros - all delivered in weekly mail.
          </motion.p>

          <motion.div
            variants={fadeUpVariants}
            className="flex w-full max-w-full items-center justify-center gap-3"
          >
            <div className="grid shrink-0 grid-cols-1 grid-rows-1 place-items-start leading-none">
              <div className="col-start-1 row-start-1 h-[26px] w-[26px] overflow-hidden rounded-[4px] shadow-md">
                <img
                  src={asset("avatar-1.png")}
                  alt="Member 1"
                  className="size-full object-cover"
                />
              </div>
              <div className="col-start-1 row-start-1 ml-[11px] mt-[1px] rotate-[8.44deg] translate-y-[4%]">
                <div className="h-[26px] w-[26px] overflow-hidden rounded-[4px] shadow-md">
                  <img
                    src={asset("avatar-2.png")}
                    alt="Member 2"
                    className="size-full object-cover"
                  />
                </div>
              </div>
              <div className="col-start-1 row-start-1 ml-[29.5px] rotate-[1.22deg]">
                <div className="h-[26px] w-[26px] overflow-hidden rounded-[4px] shadow-md">
                  <img
                    src={asset("avatar-3.png")}
                    alt="Member 3"
                    className="size-full object-cover"
                  />
                </div>
              </div>
            </div>
            <span className="min-w-0 text-left font-helvetica-neue text-[16px] font-normal tracking-[-0.5px] text-white/60 ipad:text-[18px]">
              Join 100k design professionals
            </span>
          </motion.div>

          <div className="relative mt-2 w-full">
            {/* Particle dust — same width as form, behind it */}
            <motion.div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 top-1/2 translate-y-[-100%] z-0 w-full overflow-hidden"
              style={{ height: STAR_DUST_HEIGHT }}
              initial={prefersReducedMotion ? false : { opacity: 0 }}
              animate={showContent ? { opacity: 1 } : { opacity: 0 }}
              transition={{ duration: 0.5, ease: EASE_OUT, delay: 0.15 }}
            >
              <Sparkles
                angle={0}
                background="rgba(0,0,0,0)"
                particleColor="#FFFFFF"
                particleDensity={1}
                minSize={0.5}
                maxSize={0.8}
                speed={6}
                particleSpeed={2}
                movement={4}
              />
            </motion.div>

            <motion.form
              variants={fadeUpVariants}
              onSubmit={handleSubmit}
              className="form-glow-border relative z-10 w-full rounded-full bg-white/10 shadow-2xl backdrop-blur-md"
              style={{
                borderRadius: "100px",
              }}
            >
              <div className="flex min-w-0 items-center justify-between rounded-full bg-[#101113] py-[6px] pr-2 pl-4 shadow-inner">
                <input
                  type="email"
                  placeholder="Enter your email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="min-w-0 w-full bg-transparent font-sans text-sm text-white placeholder:text-white/50 focus:outline-none ipad:text-base"
                  required
                />
                <button
                  type="submit"
                  className="shrink-0 rounded-full border border-[#2f2f2f] bg-white/[0.02] px-4 py-2.5 text-sm text-white transition-colors duration-200 ease hover:border-white/40 hover:bg-white/10 cursor-pointer"
                >
                  Sign in
                </button>
              </div>
            </motion.form>
          </div>
        </motion.div>
      </main>

      <footer className="relative z-10 py-4" />
    </section>
  );
};

export default Hero;
