import { type Deck, type Element, type Slide, citationOrder, expandComposite, referencesVersion, subscribeReferences } from "@kasten-slides/wasm";
import { type CSSProperties, type JSX, memo, useMemo, useSyncExternalStore } from "react";

import { colorOf, fontStack, layoutOf } from "../theme/index.ts";
import type { HiddenCell, ImageUrl, RenderCx, SlideMode } from "./context.ts";
import { ElementView } from "./ElementView.tsx";
import { classes } from "./format.ts";
import "../theme/fonts.css";
import "./SlideView.css";

export interface SlideViewProps {
  /** Its theme and its size. */
  deck: Deck;
  slide: Slide;
  /** The slide's place among the slides shown, from 1, and how many there are: what the slide-number field says. */
  number?: number;
  count?: number;
  /** The step to show. Left out, steps are ignored and everything shows as it is styled. */
  step?: number;
  /** `present` when left out. */
  mode?: SlideMode;
  /** Turns an image path stored in the deck into a URL the page can load. Give a function that stays the same between renders, or the images are drawn again each time. */
  imageUrl?: ImageUrl;
  /** The element whose text is not drawn, because an editor draws it over the slide. */
  hideTextOf?: string | null;
  /** The cell of a table whose words an editor draws over the slide: only that cell's are left out. Give an object that stays the same between renders. */
  hideCell?: HiddenCell | null;
  className?: string;
  style?: CSSProperties;
}

/** What the step label says at this step: the deck's wording with `{n}` and `{total}` filled in; nothing on a slide without steps. */
function stepLabelOf(deck: Deck, slide: Slide, step: number | undefined): string | undefined {
  const total = slide.steps ?? 0;
  if (step === undefined || total <= 0) return undefined;
  return deck.present.stepLabel.replaceAll("{n}", String(step)).replaceAll("{total}", String(total));
}

/** The composites that are drawn as the primitives they expand to. A formula is not one of them: KaTeX draws it (see `MathView`). */
const EXPANDED = new Set(["code", "chat", "token-probs", "card-grid", "citation", "step-label", "embed", "video", "chart", "timer", "qr"]);

/** The elements with each composite (code, a chat ...) replaced by the group of the primitives it is drawn with, in groups too. */
function drawn(elements: readonly Element[], slide: Slide, theme: Deck["theme"], order: readonly string[] | undefined): Element[] {
  return elements.map((element) => {
    if (element.type === "group") {
      const children = drawn(element.children, slide, theme, order);
      return children.some((child, i) => child !== element.children[i]) ? { ...element, children } : element;
    }
    if (!EXPANDED.has(element.type)) return element;
    try {
      return expandComposite(theme, slide.layout, element, order) ?? element;
    } catch {
      // A composite with a field missing (an agent's slip, an older file) is drawn as a labelled box; one bad element never blanks the slide.
      return element;
    }
  });
}

const drawnElements = (slide: Slide, theme: Deck["theme"], order: readonly string[] | undefined): Element[] => drawn(slide.elements, slide, theme, order);

/** Whether a citation is among these elements, in groups too. */
const holdsCitation = (elements: readonly Element[]): boolean => elements.some((element) => element.type === "citation" || (element.type === "group" && holdsCitation(element.children)));

/** Whether an element shows the number of its slide. */
const showsSlideNumber = (element: Element): boolean =>
  element.type === "group"
    ? element.children.some(showsSlideNumber)
    : element.type === "text" && element.text.paragraphs.some((paragraph) => paragraph.runs.some((run) => run.field === "slideNumber"));

/**
 * One slide, drawn at 1 unit to 1 CSS pixel in a box of the deck's size. The
 * caller scales the whole thing with a CSS transform. Everything inside is
 * positioned in slide units, and takes its colours and fonts from the deck's
 * theme.
 */
export const SlideView = memo(function SlideView({ deck, slide, number, count, step, mode = "present", imageUrl, hideTextOf = null, hideCell = null, className, style }: SlideViewProps): JSX.Element {
  const { theme, size } = deck;
  const stepLabel = stepLabelOf(deck, slide, step);
  const layout = layoutOf(theme, slide.layout);
  // What is behind the slide: its own background, or else its layout's.
  const background = slide.background ?? layout?.background;
  const paper = colorOf(theme, background?.color ?? "bg1");
  const cx = useMemo<RenderCx>(
    () => ({
      theme,
      layout: slide.layout,
      mode,
      step,
      imageUrl,
      fields: { slideNumber: number, slideCount: count, stepLabel },
      size: { w: size.w, h: size.h },
      paper,
      master: false,
    }),
    [theme, slide.layout, mode, step, imageUrl, number, count, stepLabel, size.w, size.h, paper],
  );
  const masterCx = useMemo<RenderCx>(() => ({ ...cx, master: true }), [cx]);
  // A citation is written from the page's bibliography and numbered as the whole deck numbers its works: it is drawn again when either changes.
  const references = useSyncExternalStore(subscribeReferences, referencesVersion, referencesVersion);
  const order = holdsCitation(slide.elements) ? citationOrder(deck) : undefined;
  const elements = useMemo(() => drawnElements(slide, theme, order), [slide, theme, order, references]);

  const backgroundImage = background?.image ? (imageUrl ? imageUrl(background.image) : background.image) : undefined;
  // The slide number the theme draws is the deck's choice (Slide > Slide numbers), in the editor as much as for the audience.
  const master = layout?.hideMaster ? [] : (theme.master ?? []).filter((element) => deck.present.slideNumbers || !showsSlideNumber(element));
  // What a layout a person made draws behind every slide of it, over the master and under the slide's own elements.
  const decoration = useMemo(() => (layout?.elements ?? []).filter((element) => deck.present.slideNumbers || !showsSlideNumber(element)), [layout, deck.present.slideNumbers]);

  return (
    <div
      className={classes("ks-slide", className)}
      data-mode={mode}
      data-slide={slide.id}
      style={{
        width: size.w,
        height: size.h,
        position: "relative",
        overflow: "hidden",
        background: paper,
        color: colorOf(theme, "text1"),
        fontFamily: fontStack(theme, "body"),
        ...style,
      }}
    >
      {backgroundImage && <img className="ks-bg" src={backgroundImage} alt="" draggable={false} />}
      {master.map((element) => (
        <ElementView key={element.id} element={element} cx={masterCx} hideTextOf={null} />
      ))}
      {decoration.map((element) => (
        <ElementView key={`layout:${element.id}`} element={element} cx={masterCx} hideTextOf={null} />
      ))}
      {elements.map((element) => (
        <ElementView key={element.id} element={element} cx={cx} hideTextOf={hideTextOf} hideCell={hideCell} />
      ))}
    </div>
  );
});
