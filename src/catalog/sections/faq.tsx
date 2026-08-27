// Section: __LABEL__.

const QUESTIONS = [
  {
    q: "How does the preview stay in sync?",
    a: "Every edit writes the real source file, and the dev server hot-reloads the frame within a second. Nothing is simulated.",
  },
  {
    q: "Can I undo a change?",
    a: "Yes. Every write is recorded before and after, so any turn can be reviewed as a diff or replayed backwards.",
  },
  {
    q: "Do I need to know how to code?",
    a: "No. Point at a section, say what you want in plain sentences, and read the diff if you are curious.",
  },
  {
    q: "What happens to my page if something breaks?",
    a: "The workspace is type-checked before a turn ends, and a broken preview is reported with a one-click way to hand the error back.",
  },
] as const;

export default function __NAME__() {
  return (
    <section className="w-full bg-[#050304] px-6 py-20 text-white ipad:px-12 desktop-sm:py-28">
      <div className="mx-auto max-w-3xl">
        <p className="text-sm font-medium tracking-[0.18em] text-white/40 uppercase">FAQ</p>
        <h2 className="mt-3 text-3xl leading-tight font-semibold tracking-tight ipad:text-4xl">
          Questions people ask.
        </h2>

        <div className="mt-10 divide-y divide-white/10 border-y border-white/10">
          {QUESTIONS.map((item) => (
            <details key={item.q} className="group py-5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-6 text-base font-medium marker:content-none">
                {item.q}
                <svg
                  viewBox="0 0 16 16"
                  aria-hidden
                  className="size-4 shrink-0 text-white/40 transition-transform group-open:rotate-45"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                >
                  <path d="M8 3.5v9M3.5 8h9" strokeLinecap="round" />
                </svg>
              </summary>
              <p className="mt-3 max-w-2xl text-sm leading-relaxed text-white/55">{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
