// Section: __LABEL__.

const PLANS = [
  {
    name: "Starter",
    price: "$0",
    cadence: "forever",
    blurb: "For one page and one idea.",
    features: ["1 project", "Live preview", "Community support"],
    featured: false,
  },
  {
    name: "Pro",
    price: "$24",
    cadence: "per month",
    blurb: "For people who ship every week.",
    features: ["Unlimited projects", "Version history", "Custom domains", "Priority support"],
    featured: true,
  },
  {
    name: "Team",
    price: "$79",
    cadence: "per month",
    blurb: "For a small team working on one site.",
    features: ["Everything in Pro", "Five seats", "Shared components", "Audit log"],
    featured: false,
  },
] as const;

export default function __NAME__() {
  return (
    <section className="w-full bg-[#050304] px-6 py-20 text-white ipad:px-12 desktop-sm:py-28">
      <div className="mx-auto max-w-5xl">
        <p className="text-sm font-medium tracking-[0.18em] text-white/40 uppercase">Pricing</p>
        <h2 className="mt-3 max-w-xl text-3xl leading-tight font-semibold tracking-tight ipad:text-4xl">
          Simple pricing that scales with you.
        </h2>

        <div className="mt-12 grid gap-4 ipad:grid-cols-3">
          {PLANS.map((plan) => (
            <div
              key={plan.name}
              className={
                plan.featured
                  ? "relative rounded-2xl border border-[#00A3FF]/40 bg-[#0a0709] p-7"
                  : "relative rounded-2xl border border-white/10 bg-[#0a0709] p-7"
              }
            >
              {plan.featured ? (
                <span className="absolute -top-2.5 left-7 rounded-full bg-[#00A3FF] px-2.5 py-0.5 text-[11px] font-medium text-black">
                  Most popular
                </span>
              ) : null}

              <h3 className="text-base font-medium">{plan.name}</h3>
              <p className="mt-1 text-sm text-white/55">{plan.blurb}</p>

              <p className="mt-6 flex items-baseline gap-1.5">
                <span className="text-4xl font-semibold tracking-tight">{plan.price}</span>
                <span className="text-sm text-white/40">{plan.cadence}</span>
              </p>

              <ul className="mt-6 space-y-2.5">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2 text-sm text-white/70">
                    <svg
                      viewBox="0 0 16 16"
                      aria-hidden
                      className="mt-0.5 size-3.5 shrink-0 text-[#00A3FF]"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                    >
                      <path d="M3.5 8.5l3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    {feature}
                  </li>
                ))}
              </ul>

              <button
                type="button"
                className={
                  plan.featured
                    ? "mt-8 w-full rounded-xl bg-[#00A3FF] px-4 py-2.5 text-sm font-medium text-black transition-colors hover:bg-[#33b5ff]"
                    : "mt-8 w-full rounded-xl border border-white/15 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:border-white/30"
                }
              >
                Get started
              </button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
