// Section: features.
//
// Hand-written, deliberately plain, and deliberately SECOND. Click-to-select is
// the product's headline feature (§11) and a page with one section cannot
// demonstrate it — every click has the same answer. This is also the shape the
// agent is asked to copy when it adds a section in Phase 8: a default export, a
// manifest entry, a registry entry, nothing else.
//
// No "use client", no motion, no canvas: the hero already proves the hard case.

const ITEMS = [
  {
    title: "Point at it",
    body: "Switch the preview to Select and click any section. Its source is pinned to your next message, byte for byte.",
  },
  {
    title: "Say what you want",
    body: "Plain sentences. The agent reads the files it needs, makes the edit, and the preview hot-reloads under you.",
  },
  {
    title: "Keep what works",
    body: "Every write is recorded before and after, so any turn can be reviewed as a diff — or undone.",
  },
] as const;

export default function Features() {
  return (
    <section className="w-full bg-[#050304] px-6 py-20 text-white ipad:px-12 desktop-sm:py-28">
      <div className="mx-auto max-w-5xl">
        <p className="text-sm font-medium tracking-[0.18em] text-white/40 uppercase">
          How it works
        </p>
        <h2 className="mt-3 max-w-xl text-3xl leading-tight font-semibold tracking-tight ipad:text-4xl">
          Point at the page.
        </h2>

        <div className="mt-12 grid gap-px overflow-hidden rounded-2xl bg-white/10 ipad:grid-cols-2">
          {ITEMS.map((item, index) => (
            <div key={item.title} className="bg-[#0a0709] p-7">
              <span className="text-xs font-medium text-[#00A3FF]">
                {String(index + 1).padStart(2, "0")}
              </span>
              <h3 className="mt-3 text-base font-medium">{item.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-white/55">{item.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
