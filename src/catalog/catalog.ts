/**
 * The section catalog (§7, Phase 8).
 *
 * PURE DATA, like `workspace/manifest.ts` and for the same reason: the tool
 * declarations and the tests read it, and neither should pull a React component
 * graph in to find out that a template called "pricing" exists.
 *
 * The templates themselves live next door in `sections/*.tsx` as REAL component
 * files, not strings. That is the whole trick: they are inside the project's
 * tsconfig, so `tsc --noEmit` proves every template compiles before it can be
 * copied into anyone's page, and Tailwind's source detection scans them, so the
 * classes a template needs are already in the preview stylesheet the moment it
 * lands. A template kept as a string literal would have neither property.
 *
 * Two tokens are substituted on the way in — `__NAME__` (the component name) and
 * `__LABEL__`. Both are chosen to be valid where they appear, so the template
 * file still parses and type-checks as it sits.
 */
export interface Template {
  /** What the model passes to add_section. */
  id: string;
  /** Shown in the tool result. */
  name: string;
  /** Prompt surface: the model picks a template by reading this. */
  description: string;
  /** Extra words to match against a request. Not searched by us — read by the model. */
  tags: readonly string[];
  /** Path relative to the catalog root. */
  file: string;
}

export const templates = [
  {
    id: "blank",
    name: "Blank",
    description:
      "An empty section with a heading and one paragraph, in the page's existing style. Use this when nothing else fits and you intend to write the content yourself.",
    tags: ["empty", "starter", "custom"],
    file: "sections/blank.tsx",
  },
  {
    id: "pricing",
    name: "Pricing",
    description:
      "Three plan cards side by side with the middle one highlighted, each with a price, a short blurb, a checklist of features and a button.",
    tags: ["pricing", "plans", "tiers", "subscription", "cost"],
    file: "sections/pricing.tsx",
  },
  {
    id: "faq",
    name: "FAQ",
    description:
      "Four expandable question-and-answer rows using native <details>, so it needs no client JavaScript.",
    tags: ["faq", "questions", "answers", "accordion", "support"],
    file: "sections/faq.tsx",
  },
  {
    id: "cta",
    name: "Call to action",
    description:
      "A centred card with a headline, a line of copy, two buttons and a reassurance line. Usually the last thing before the footer.",
    tags: ["cta", "signup", "conversion", "banner", "get started"],
    file: "sections/cta.tsx",
  },
  {
    id: "footer",
    name: "Footer",
    description:
      "A brand blurb next to three columns of links, with a copyright line underneath.",
    tags: ["footer", "links", "navigation", "legal", "copyright"],
    file: "sections/footer.tsx",
  },
] as const satisfies readonly Template[];

export type TemplateId = (typeof templates)[number]["id"];

/** The one used when add_section is called without a template. */
export const DEFAULT_TEMPLATE: TemplateId = "blank";

export function findTemplate(id: string): Template | null {
  return templates.find((t) => t.id === id) ?? null;
}
