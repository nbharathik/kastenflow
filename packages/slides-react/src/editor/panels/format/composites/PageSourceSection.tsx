import type { SectionProps } from "../types.ts";
import { CompositeSection } from "./CompositeSection.tsx";
import { PageSourceRows } from "./PageSourceRows.tsx";

/** The page an element (the contents of a page, a section, a link) came from: where it is, whether it changed, and Update from page and Break link. */
export function PageSourceSection({ session, ui, elements }: SectionProps) {
  const [element] = elements;
  if (!element?.source || elements.length !== 1) return null;
  return (
    <CompositeSection id="page-source" title={element.source.kind === "link" ? "Link to a page" : "From a page"} ui={ui} ids={[element.id]}>
      <PageSourceRows session={session} element={element} />
    </CompositeSection>
  );
}
