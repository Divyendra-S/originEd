/**
 * The page the user is building. Rendered inside the preview iframe.
 *
 * `registry` is typed `Record<SectionSlug, ComponentType>`, so adding an entry to
 * manifest.ts without adding the matching import here is a TYPE ERROR — which the
 * agent's own `typecheck` tool catches inside the same job (§12), instead of the
 * section silently vanishing from the preview.
 *
 * `SectionBoundary` is imported from outside the workspace on purpose (§14 risk
 * 11): it carries the attributes the inspector selects on, so it is not the
 * agent's to edit. Leave that import alone.
 *
 * `page` is the studio's page switcher (§10) — one screen of the site at a time,
 * never all of them stacked. Leave the prop and `sectionsForPage` alone too:
 * dropping them does not break this file — it renders every section, which looks
 * plausible — it breaks the switcher, silently, with nothing on screen to say
 * why. Adding a section needs nothing here beyond the import and the registry
 * entry, which is all `add_section` writes; it lands on the first page until
 * `pages` in manifest.ts says otherwise.
 */
import type { ComponentType } from "react";
import { SectionBoundary } from "@/app/(preview)/_runtime/SectionBoundary";
import { sectionsForPage, type SectionSlug } from "./manifest";
import Features from "./sections/features";
import Hero from "./sections/hero";
import Hero08 from "./sections/hero-08";

const registry: Record<SectionSlug, ComponentType> = {
  hero: Hero,
  features: Features,
  "hero-08": Hero08,
};

export function WorkspacePage({ page }: { page?: string }) {
  return (
    <>
      {sectionsForPage(page).map(({ slug, label, file }) => {
        const Section = registry[slug];
        if (!Section) return null;
        return (
          <SectionBoundary key={slug} slug={slug} label={label} file={file}>
            <Section />
          </SectionBoundary>
        );
      })}
    </>
  );
}

export default WorkspacePage;
