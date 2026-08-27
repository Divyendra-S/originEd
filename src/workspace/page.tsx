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
 */
import type { ComponentType } from "react";
import { SectionBoundary } from "@/app/(preview)/_runtime/SectionBoundary";
import { sections, type SectionSlug } from "./manifest";
import Features from "./sections/features";
import Hero from "./sections/hero";

const registry: Record<SectionSlug, ComponentType> = {
  hero: Hero,
  features: Features,
};

export function WorkspacePage() {
  return (
    <>
      {sections.map(({ slug, label, file }) => {
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
