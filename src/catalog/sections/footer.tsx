// Section: __LABEL__.

const COLUMNS = [
  { title: "Product", links: ["Overview", "Pricing", "Changelog", "Roadmap"] },
  { title: "Company", links: ["About", "Blog", "Careers", "Contact"] },
  { title: "Legal", links: ["Privacy", "Terms", "Security"] },
] as const;

export default function __NAME__() {
  return (
    <footer className="w-full border-t border-white/10 bg-[#050304] px-6 py-14 text-white ipad:px-12">
      <div className="mx-auto max-w-5xl">
        <div className="grid gap-10 ipad:grid-cols-[1.5fr_repeat(3,1fr)]">
          <div>
            <p className="text-base font-medium tracking-tight">originEd</p>
            <p className="mt-2 max-w-xs text-sm leading-relaxed text-white/45">
              A visual editor for the page you already have.
            </p>
          </div>

          {COLUMNS.map((column) => (
            <div key={column.title}>
              <p className="text-xs font-medium tracking-[0.14em] text-white/40 uppercase">
                {column.title}
              </p>
              <ul className="mt-3 space-y-2">
                {column.links.map((link) => (
                  <li key={link}>
                    <a
                      href="#"
                      className="text-sm text-white/60 transition-colors hover:text-white"
                    >
                      {link}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-col gap-3 border-t border-white/10 pt-6 ipad:flex-row ipad:items-center ipad:justify-between">
          <p className="text-xs text-white/35">© 2026 originEd. All rights reserved.</p>
          <p className="text-xs text-white/35">Built in the browser.</p>
        </div>
      </div>
    </footer>
  );
}
