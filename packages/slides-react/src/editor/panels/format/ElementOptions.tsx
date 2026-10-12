import type { Element } from "@kasten-slides/wasm";

import { AccessSection } from "./AccessSection.tsx";
import { ArrowsSection } from "./ArrowsSection.tsx";
import { BorderSection } from "./BorderSection.tsx";
import { CompositeSections } from "./composites/CompositeSections.tsx";
import { PageSourceSection } from "./composites/PageSourceSection.tsx";
import { FillSection } from "./FillSection.tsx";
import { ImageSection } from "./ImageSection.tsx";
import { PositionSection } from "./PositionSection.tsx";
import { RadiusSection } from "./RadiusSection.tsx";
import { ShadowSection } from "./ShadowSection.tsx";
import { SizeSection } from "./SizeSection.tsx";
import { TableSection } from "./TableSection.tsx";
import { TextSection } from "./TextSection.tsx";
import type { SectionProps } from "./types.ts";
import { describe, textOf } from "./values.ts";

const isLine = (e: Element) => e.type === "line" || e.type === "connector";

/** Which elements each section is for. A section shows when any of the selection is one of them, and changes only those. */
const APPLIES = {
  fill: (e: Element) => e.type === "shape" || e.type === "text" || e.type === "table",
  border: (e: Element) => e.type === "shape" || e.type === "text" || e.type === "image" || isLine(e),
  radius: (e: Element) => e.type === "shape" && e.shape === "roundRect",
  shadow: (e: Element) => e.type === "shape" || e.type === "text" || e.type === "image" || isLine(e),
  arrows: isLine,
  text: (e: Element) => textOf(e) !== null,
  image: (e: Element) => e.type === "image",
  table: (e: Element) => e.type === "table",
} as const;

/** The format options for the selected elements: a section for each kind of thing they have. */
export function ElementOptions({ session, ui, elements, theme }: SectionProps) {
  const section = (test: (e: Element) => boolean): SectionProps | null => {
    const list = elements.filter(test);
    return list.length > 0 ? { session, ui, theme, elements: list } : null;
  };
  const all: SectionProps = { session, ui, theme, elements };
  const fill = section(APPLIES.fill);
  const border = section(APPLIES.border);
  const radius = section(APPLIES.radius);
  const shadow = section(APPLIES.shadow);
  const arrows = section(APPLIES.arrows);
  const text = section(APPLIES.text);
  const image = section(APPLIES.image);
  const table = section(APPLIES.table);
  // What came from a page and is not an embedded page (which has its own section): the contents of a page, a section, a link.
  const fromPage = section((e) => e.type !== "embed" && e.source != null);
  return (
    <>
      <p className="ks-sp-summary">{describe(elements)}</p>
      <CompositeSections {...all} />
      {fromPage ? <PageSourceSection {...fromPage} /> : null}
      <SizeSection {...all} />
      <PositionSection {...all} />
      {fill ? <FillSection {...fill} /> : null}
      {border ? <BorderSection {...border} /> : null}
      {radius ? <RadiusSection {...radius} /> : null}
      {shadow ? <ShadowSection {...shadow} /> : null}
      {arrows ? <ArrowsSection {...arrows} /> : null}
      {text ? <TextSection {...text} /> : null}
      {image ? <ImageSection {...image} /> : null}
      {table ? <TableSection {...table} /> : null}
      <AccessSection {...all} />
    </>
  );
}
