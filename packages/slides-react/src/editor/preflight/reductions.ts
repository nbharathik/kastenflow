// What each format cannot keep as it is. The list is read from the deck: only what the deck has is listed, with how many and on which slides,
// so a person knows before they leave what the file will say instead.

import type { Deck, Element } from "@kasten-slides/wasm";

import { pagesOf } from "./scan.ts";
import type { PreflightFormat, Reduction } from "./types.ts";

/** Every element of a slide, groups' children too. */
function each(list: readonly Element[], visit: (element: Element) => void): void {
  for (const element of list) {
    visit(element);
    if (element.type === "group") each(element.children, visit);
  }
}

interface Facts {
  steps: Map<string, number>;
  morphs: string[];
  embeds: string[];
  videos: string[];
  maths: string[];
  timers: string[];
  codeWalks: string[];
  nonText: Map<string, number>;
  pageLinks: string[];
}

function factsOf(deck: Deck): Facts {
  const facts: Facts = { steps: new Map(), morphs: [], embeds: [], videos: [], maths: [], timers: [], codeWalks: [], nonText: new Map(), pageLinks: [] };
  const deckMorph = deck.present.transition?.kind === "morph";
  for (const slide of deck.slides) {
    if ((slide.steps ?? 0) > 0) facts.steps.set(slide.id, slide.steps ?? 0);
    const kind = slide.transition?.kind;
    if (kind === "morph" || (kind === undefined && deckMorph)) facts.morphs.push(slide.id);
    let nonText = 0;
    const hit = (list: string[]): void => void (list.includes(slide.id) || list.push(slide.id));
    each(slide.elements, (element) => {
      if (element.type === "embed") hit(facts.embeds);
      else if (element.type === "video") hit(facts.videos);
      else if (element.type === "math") hit(facts.maths);
      else if (element.type === "timer") hit(facts.timers);
      else if (element.type === "code" && (element.focus?.length ?? 0) > 0) hit(facts.codeWalks);
      if (element.type !== "text" && element.type !== "group") nonText += 1;
    });
    if (nonText > 0) facts.nonText.set(slide.id, nonText);
  }
  for (const use of pagesOf(deck)) if (use.how === "link" && use.slide !== null && !facts.pageLinks.includes(use.slide)) facts.pageLinks.push(use.slide);
  return facts;
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
const STEPPED = "Slides with steps";

function reduction(id: string, what: string, becomes: string, slides: readonly string[], count = slides.length): Reduction | null {
  return count > 0 ? { id, what, becomes, count, slides: [...slides] } : null;
}

/** What `format` makes of the deck that is not what the deck is. Nothing is listed that the deck does not have. */
export function reductionsFor(deck: Deck, format: PreflightFormat): Reduction[] {
  const facts = factsOf(deck);
  const stepped = [...facts.steps.keys()];
  const extra = [...facts.steps.values()].reduce((sum, steps) => sum + steps, 0);
  const found: (Reduction | null)[] = [];
  switch (format) {
    case "pptx":
      found.push(
        reduction("steps", STEPPED, `a slide for every state: ${plural(extra, "slide", "slides")} more in the file, titled “(2/5)”`, stepped),
        reduction("morph", "Morph transitions", "a fade or a cut: PowerPoint cannot pair the shapes the way KastenFlow does", facts.morphs),
        reduction("embeds", "Embedded web pages", "their poster, or a dashed panel with the address", facts.embeds),
        reduction("videos", "Videos", "their poster, or a dark panel with a play button", facts.videos),
        reduction("math", "Formulas", "pictures: the LaTeX is kept as the picture's description", facts.maths),
        reduction("page-links", "Links to pages of your notes", "left out: PowerPoint cannot open them", facts.pageLinks),
        reduction("timers", "Timers", "the time they start at, as words", facts.timers),
      );
      break;
    case "pdf":
    case "png":
      found.push(
        reduction("steps", STEPPED, format === "pdf" ? "one page as it ends, or a page for every step, as you choose when printing" : "an image of the slide as it ends", stepped),
        reduction("embeds", "Embedded web pages", "their poster, or a dashed panel with the address", facts.embeds),
        reduction("videos", "Videos", "their poster, or a dark panel with a play button", facts.videos),
        reduction("timers", "Timers", "the time they start at", facts.timers),
        reduction("transitions", "Morph transitions", "nothing: a still has no transition", facts.morphs),
      );
      break;
    case "markdown":
      found.push(
        reduction("non-text", "Pictures, shapes, tables and diagrams", "left out: only the words and the speaker notes are written", [...facts.nonText.keys()], [...facts.nonText.values()].reduce((sum, n) => sum + n, 0)),
        reduction("steps", STEPPED, "one outline entry: the steps are not written", stepped),
      );
      break;
    case "html":
      found.push(
        reduction("embeds", "Embedded web pages", "live when there is a network, else their poster", facts.embeds),
        reduction("videos", "Videos", "played from the file, else their poster", facts.videos),
        reduction("page-links", "Links to pages of your notes", "words that link nowhere: the page is not in the file", facts.pageLinks),
      );
      break;
    case "present":
      found.push(reduction("embeds", "Embedded web pages", "shown live: they need a network and a page that allows being shown in a frame", facts.embeds));
      break;
  }
  return found.filter((item): item is Reduction => item !== null);
}
