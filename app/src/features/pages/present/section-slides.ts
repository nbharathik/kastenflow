// What a page's sections become as slides: each section a slide titled with
// the section's title; its lists are the slide, its other words the speaker
// notes, and a section with no list gets its first sentence (or, with no words
// at all, a divider slide). Pictures are counted, not carried over. Pure: the
// Markdown of each section goes in, slide texts come out.

import type { SectionText } from "../editor/sections/registry";

export interface SlideText {
  title: string;
  /** The Slides layout to use, or null for the usual title and body. */
  layout: "section" | null;
  /** Markdown for the body: a bulleted list, nested lists indented by two spaces. */
  body: string;
  /** Speaker notes, in Markdown. */
  notes: string;
  /** Pictures the section holds, which a slide made this way leaves out. */
  pictures: number;
}

const HEADING = /^ {0,3}#{1,6}[ \t]+(.*?)[ \t#]*$/;
const LIST_ITEM = /^(\s*)(?:[-*+]|\d{1,9}[.)])[ \t]+(?:\[[ xX]\][ \t]+)?(.*)$/;
const PICTURE = /^\s*!\[[^\]]*\]\([^)]*\)\s*$/;
const EMBED = /^\s*!\[\[[^\]]*\]\]\s*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const COLUMN_MARKER = /^\s*<!--\s*\/?columns?(?:\s+\d+(?:\/\d+)*)?\s*-->\s*$/i;
/** The longest a slide's one line made of prose is, in characters. */
const LINE = 200;
/** How deep a list goes on a slide. */
const DEPTH = 3;

/** `[[Page|words]]` as the words, `[[Page]]` as the page's name: a slide shows what the page reads. */
const plainLinks = (text: string) => text.replace(/\[\[([^\]|]*)(?:\|([^\]]*))?\]\]/g, (_all, target: string, alias?: string) => alias || target);

function firstSentence(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const end = /[.!?](?=\s|$)/.exec(flat);
  const sentence = end ? flat.slice(0, end.index + 1) : flat;
  return sentence.length > LINE ? `${sentence.slice(0, LINE - 1)}…` : sentence;
}

/** The slide a section makes. */
export function slideOf(section: SectionText): SlideText {
  const bullets: string[] = [];
  const prose: string[] = [];
  let paragraph: string[] = [];
  let pictures = 0;
  let fence: string | null = null;
  let code: string[] = [];
  /** The indent of each level of the list being read. */
  const levels: number[] = [];
  // The section's own title is the slide's, so a heading that only says it is not repeated.
  let skipping = true;
  const flush = () => {
    if (paragraph.length > 0) prose.push(paragraph.join(" "));
    paragraph = [];
  };
  for (const line of section.markdown.split(/\r?\n/)) {
    const opening = FENCE.exec(line)?.[1];
    if (fence !== null || opening) {
      // Code stays whole, in the notes.
      flush();
      code.push(line);
      if (opening && (fence === null || (opening[0] === fence[0] && opening.length >= fence.length))) fence = fence === null ? opening : null;
      if (fence === null) {
        prose.push(code.join("\n"));
        code = [];
      }
      skipping = false;
      continue;
    }
    // The comments that make columns are layout, not words; the columns read in order.
    if (line.trim() === "" || COLUMN_MARKER.test(line)) {
      flush();
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      levels.length = 0;
      const words = plainLinks(heading[1]!);
      if (!(skipping && words === section.title)) bullets.push(`- **${words}**`);
      skipping = false;
      continue;
    }
    skipping = false;
    if (EMBED.test(line)) continue;
    if (PICTURE.test(line)) {
      pictures++;
      continue;
    }
    const item = LIST_ITEM.exec(line);
    if (item) {
      flush();
      // However far a list indents its items, a deeper one is a level down.
      const indent = item[1]!.replace(/\t/g, "    ").length;
      while (levels.length > 0 && levels[levels.length - 1]! >= indent) levels.pop();
      bullets.push(`${"  ".repeat(Math.min(levels.length, DEPTH))}- ${plainLinks(item[2]!)}`);
      levels.push(indent);
      continue;
    }
    levels.length = 0;
    paragraph.push(plainLinks(line.replace(/^\s*>\s?/, "").trim()));
  }
  flush();
  // A fence never closed holds the rest of the section.
  if (code.length > 0) prose.push(code.join("\n"));
  const lead = prose.find((text) => text !== "" && !FENCE.test(text));
  const body = bullets.length > 0 ? bullets : lead ? [`- ${firstSentence(lead)}`] : [];
  return {
    title: section.title,
    layout: body.length === 0 ? "section" : null,
    body: body.join("\n"),
    notes: prose.join("\n\n").trim(),
    pictures,
  };
}

/** The slides for every section of a page. */
export const slidesOfSections = (sections: readonly SectionText[]): SlideText[] => sections.map(slideOf);
