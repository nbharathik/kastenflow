// The footer words and the date at the bottom of a slide. The deck holds one set that every slide
// shows; a slide may hold its own, which wins. This works the same rules out as `footer_elements`
// in slides-core, which the PowerPoint export uses; the slide number is the theme's own and is not
// handled here.

import type { Deck, Element, HeaderFooter, Slide } from "@kasten-slides/wasm";

/** The layout whose slides count as the title slide for "hide on the title slide". */
export const TITLE_LAYOUT = "title";
export const DEFAULT_DATE_FORMAT = "d MMMM yyyy";
export const FOOTER_ID = "footer-text";
export const DATE_ID = "footer-date";

/** The formats the Header & footer dialog offers, with what each looks like. */
export const DATE_FORMATS: readonly string[] = ["d MMMM yyyy", "MMMM d, yyyy", "EEEE, d MMMM yyyy", "dd/MM/yyyy", "MM/dd/yyyy", "yyyy-MM-dd", "MMM d, yyyy", "MMMM yyyy"];

/** What a date looks like in a format: `yyyy`, `yy`, `MMMM`, `MMM`, `MM`, `M`, `dd`, `d`, `EEEE` and `EEE` stand for the parts, the rest is kept. */
export function formatDate(format: string, date: Date, locale?: string): string {
  const name = (options: Intl.DateTimeFormatOptions): string => new Intl.DateTimeFormat(locale, options).format(date);
  const two = (n: number): string => String(n).padStart(2, "0");
  return format.replace(/yyyy|yy|MMMM|MMM|MM|M|dd|d|EEEE|EEE/g, (part) => {
    switch (part) {
      case "yyyy":
        return String(date.getFullYear());
      case "yy":
        return two(date.getFullYear() % 100);
      case "MMMM":
        return name({ month: "long" });
      case "MMM":
        return name({ month: "short" });
      case "MM":
        return two(date.getMonth() + 1);
      case "M":
        return String(date.getMonth() + 1);
      case "dd":
        return two(date.getDate());
      case "d":
        return String(date.getDate());
      case "EEEE":
        return name({ weekday: "long" });
      default:
        return name({ weekday: "short" });
    }
  });
}

/** What a slide shows at its foot: its own footer and date over the deck's; nothing when it hides them or is the title slide of a deck that leaves them off it. */
export function shownFooter(deck: HeaderFooter | null | undefined, slide: HeaderFooter | null | undefined, layout: string): { footer?: string; date?: NonNullable<HeaderFooter["date"]> } {
  if (slide?.hidden) return {};
  const ownFooter = slide?.footer ?? undefined;
  const ownDate = slide?.date ?? undefined;
  const own = ownFooter !== undefined || ownDate !== undefined;
  if (deck?.hideOnTitle && layout === TITLE_LAYOUT && !own) return {};
  const footer = ownFooter ?? deck?.footer ?? undefined;
  const date = ownDate ?? deck?.date ?? undefined;
  return { ...(footer ? { footer } : {}), ...(date ? { date } : {}) };
}

function box(id: string, x: number, y: number, w: number, h: number, align: "left" | "center", t: string): Element {
  return { type: "text", id, x, y, w, h, locked: true, text: { paragraphs: [{ runs: [{ t }], align, style: "caption" }] } } as Element;
}

/** The footer and the date of a slide as text boxes along its bottom edge, the date at the left and the footer in the middle. */
export function footerElements(deck: Deck, slide: Slide, today: Date, locale?: string): Element[] {
  const shown = shownFooter(deck.present.headerFooter, slide.footer, slide.layout);
  const { w, h } = deck.size;
  const [top, height] = [h - h * 0.08, h * 0.05];
  const out: Element[] = [];
  if (shown.date) out.push(box(DATE_ID, w * 0.05, top, w * 0.22, height, "left", shown.date.text ?? formatDate(shown.date.format ?? DEFAULT_DATE_FORMAT, today, locale)));
  if (shown.footer) out.push(box(FOOTER_ID, w * 0.3, top, w * 0.4, height, "center", shown.footer));
  return out;
}
