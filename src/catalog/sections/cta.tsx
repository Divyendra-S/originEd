// Section: __LABEL__.

export default function __NAME__() {
  return (
    <section className="w-full bg-[#050304] px-6 py-20 text-white ipad:px-12 desktop-sm:py-28">
      <div className="mx-auto max-w-5xl">
        <div className="rounded-3xl border border-white/10 bg-[#0a0709] px-7 py-12 text-center ipad:px-16 ipad:py-16">
          <h2 className="mx-auto max-w-2xl text-3xl leading-tight font-semibold tracking-tight ipad:text-4xl">
            Start with the page you already have.
          </h2>
          <p className="mx-auto mt-4 max-w-lg text-sm leading-relaxed text-white/55">
            Point at a section, say what you want, and watch it change. No setup, no export step.
          </p>

          <div className="mt-8 flex flex-col items-center justify-center gap-3 ipad:flex-row">
            <button
              type="button"
              className="w-full rounded-xl bg-[#00A3FF] px-5 py-2.5 text-sm font-medium text-black transition-colors hover:bg-[#33b5ff] ipad:w-auto"
            >
              Get started free
            </button>
            <button
              type="button"
              className="w-full rounded-xl border border-white/15 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:border-white/30 ipad:w-auto"
            >
              Watch the demo
            </button>
          </div>

          <p className="mt-5 text-xs text-white/35">No credit card required.</p>
        </div>
      </div>
    </section>
  );
}
