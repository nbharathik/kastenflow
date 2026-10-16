// A citation written out as people write it (APA, IEEE, Chicago, Harvard, or a
// short "Smith 2020. Title. Journal 12(3): 4-5.") read into BibTeX fields by
// rules alone. It is a guess, and says so: only a year in brackets and a title
// in quotes are taken as sure, every other field it finds is marked to be
// checked, and a part the text does not show is left out, not made up.

import { blankDraft, type PaperDraft } from "./draft";
import { findIdentifiers, type Identifiers } from "./identifiers";

const PARTICLES = new Set(["van", "von", "der", "den", "de", "del", "della", "di", "da", "dos", "du", "la", "le", "ten", "ter", "bin", "ibn", "al", "el"]);
const SUFFIXES = new Set(["jr", "jr.", "sr", "sr.", "ii", "iii", "iv"]);
const INITIALS = /^(?:\p{Lu}\.?[\s-]*)+$/u;
const CAPITALISED = /^\p{Lu}[\p{L}'’-]*$/u;
const YEAR = String.raw`(?:1[5-9]|20)\d{2}`;
const CONFERENCE = /\b(?:proc(?:eedings|\.)?|conference|workshop|symposium|congress|meeting)\b/i;
const JOURNAL = /\b(?:journal|review|transactions|letters|annals|bulletin|magazine|nature|science)\b/i;
const PUBLISHER = /\b(?:press|publishers?|springer|elsevier|wiley|verlag|university|addison|pearson|oxford|cambridge|mcgraw|routledge|penguin|academic|o'reilly)\b/i;

const single = (token: string) => !/\s/.test(token);

/** "Ada Lovelace" as "Lovelace, Ada"; a particle stays with the last name ("van Beethoven, Ludwig"). */
export function lastFirst(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length < 2) return name.trim();
  let last = words.length - 1;
  // "Martin Luther King Jr." keeps the suffix with the family name.
  if (last > 1 && SUFFIXES.has(words[last]!.toLowerCase())) last -= 1;
  let from = last;
  while (from > 1 && PARTICLES.has(words[from - 1]!.toLowerCase())) from -= 1;
  const family = words.slice(from, last + 1).concat(words.slice(last + 1)).join(" ");
  return `${family}, ${words.slice(0, from).join(" ")}`;
}

/** The people of an author list, as BibTeX writes them: "Last, First and Last, First". `et al.` becomes "and others". */
export function formatAuthors(raw: string): string {
  let text = raw.replace(/\s+/g, " ").trim();
  const others = /(?:,\s*)?\bet al\b\.?/i.test(text);
  text = text.replace(/(?:,\s*)?\bet al\b\.?/gi, " ").replace(/[\s,;]+$/, "");
  text = text.replace(/,?\s*(?:&|\band\b)\s+/gi, ";");
  const people: string[] = [];
  for (const group of text.split(";")) {
    const tokens = group
      .split(/,\s*/)
      .map((t) => t.trim())
      .filter(Boolean);
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]!;
      const next = tokens[i + 1];
      // "Last, F." everywhere, and "Last, First" for the first person of a Chicago list.
      if (next !== undefined && single(token) && (INITIALS.test(next) || (i === 0 && people.length === 0 && single(next) && CAPITALISED.test(next)))) {
        people.push(`${token}, ${next}`);
        i += 1;
      } else people.push(single(token) ? token : lastFirst(token));
    }
  }
  if (others) people.push("others");
  return people.join(" and ");
}

/** The last words of a name list lose the full stop that ended the sentence, not an initial's. */
function trimAuthors(part: string): string {
  let text = part.trim().replace(/[\s,;:]+$/, "");
  const last = /(\S+)\.$/.exec(text)?.[1];
  if (last && last.replace(/[^\p{L}]/gu, "").length >= 2 && !INITIALS.test(last)) text = text.slice(0, -1);
  return text.trim();
}

/** The text without the identifiers it carried, which have fields of their own. */
function withoutIdentifiers(text: string, ids: Identifiers): string {
  let out = text;
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (ids.doi) out = out.replace(new RegExp(String.raw`(?:https?:\/\/(?:dx\.)?doi\.org\/|\bdoi:\s*)?${escape(ids.doi)}\S*`, "i"), " ");
  if (ids.arxiv) out = out.replace(/(?:https?:\/\/)?(?:export\.)?arxiv\.org\/(?:abs|pdf)\/\S+/i, " ").replace(/\barxiv:\s*\S+(?:\s*\[[^\]]*\])?/i, " ");
  if (ids.url) out = out.replace(/\b(?:available at|retrieved from|url)?:?\s*https?:\/\/\S+/i, " ");
  return out
    .replace(/\b(?:available at|retrieved from|accessed)\b[:\s]*$/i, " ")
    .replace(/\s+/g, " ")
    .trim();
}

interface Quoted {
  title: string;
  index: number;
  length: number;
}

function quotedTitle(text: string): Quoted | null {
  const patterns = [/“([^”]{4,}?)”/u, /"([^"]{4,}?)"/u, /‘([^’]{4,}?)’/u, /(?<![\p{L}\p{N}])'([^']{4,}?)'(?![\p{L}\p{N}])/u];
  for (const pattern of patterns) {
    const found = pattern.exec(text);
    if (found) return { title: found[1]!.replace(/[\s,.]+$/, "").trim(), index: found.index, length: found[0].length };
  }
  return null;
}

/** A year, "(2017)" or "(2017a)", in brackets: the one a year is sure from. */
const YEAR_IN_BRACKETS = new RegExp(String.raw`\((?:[^()]*?\b)?(${YEAR})[a-z]?\)`);

/** Page numbers as BibTeX writes a range, with an end shortened by the style ("4171–86") put in full. */
function pageRange(from: string, to: string): string {
  const end = to.length < from.length ? from.slice(0, from.length - to.length) + to : to;
  return `${from}--${end}`;
}

interface Venue {
  name: string;
  volume?: string;
  number?: string;
  pages?: string;
  year?: string;
  conference: boolean;
}

/** The venue and its numbers out of what follows the title. `wantYear` takes a stand-alone year too. */
function readVenue(after: string, wantYear: boolean): Venue {
  let rest = after;
  const out: Venue = { name: "", conference: /^[\s,.:;]*in\b/i.test(after) };
  const take = (pattern: RegExp, use: (m: RegExpExecArray) => void) => {
    const found = pattern.exec(rest);
    if (!found) return;
    use(found);
    rest = `${rest.slice(0, found.index)} , ${rest.slice(found.index + found[0].length)}`;
  };
  take(/\bpp?\.\s*(\d+)(?:\s*[-–—]+\s*(\d+))?/i, (m) => (out.pages = m[2] ? pageRange(m[1]!, m[2]) : m[1]!));
  if (!out.pages) take(/(?<![\d(])(\d{1,6})\s*[-–—]+\s*(\d{1,6})(?!\d)/, (m) => (out.pages = pageRange(m[1]!, m[2]!)));
  take(/\b(\d+)\s*\(\s*(\d+)\s*\)/, (m) => {
    out.volume = m[1]!;
    out.number = m[2]!;
  });
  take(/\bvol(?:ume)?\.?\s*(\d+)/i, (m) => (out.volume ??= m[1]!));
  take(/\b(?:no|issue|number)\.?\s*(\d+)/i, (m) => (out.number ??= m[1]!));
  if (wantYear) take(new RegExp(String.raw`(?<![\d–-])\b(${YEAR})[a-z]?\b(?![\d–-])`), (m) => (out.year = m[1]!));
  rest = rest.replace(/^[\s,.:;]*(?:in|In)\b[\s:]*/, "");
  const segments = rest
    .split(/[,;:]/)
    .map((s) => s.trim())
    .filter((s) => /[\p{L}\p{N}]/u.test(s));
  for (const segment of segments) {
    if (/^\d+$/.test(segment)) {
      if (!out.volume) out.volume = segment;
      else if (!out.number) out.number = segment;
    } else if (!out.name) out.name = segment;
  }
  // The full stop that ends the sentence goes; one inside an abbreviation ("Syst.,") stays.
  if (out.name && after.trimEnd().endsWith(`${out.name}`) && /\p{L}{3,}\.$/u.test(out.name)) out.name = out.name.slice(0, -1);
  return out;
}

/** The title and the rest, from text that begins with the title (no quotes to show where it ends). */
function splitTitle(rest: string): { title: string; after: string } {
  const text = rest.replace(/^[\s.,:;]+/, "");
  const stop = /([\p{Ll}\p{N})\]])\.\s+(?=\p{Lu})|([?!])\s+(?=\p{Lu})/u.exec(text);
  if (!stop) return { title: text.replace(/[\s.]+$/, "").trim(), after: "" };
  // The title keeps the one character before the stop (a letter, or its ? or !).
  return { title: text.slice(0, stop.index + 1).trim(), after: text.slice(stop.index + stop[0].length) };
}

export function parseCitation(raw: string): PaperDraft {
  const draft: PaperDraft = { ...blankDraft(), origin: "citation" };
  const ids = findIdentifiers(raw);
  const text = withoutIdentifiers(raw.replace(/\s+/g, " ").trim(), ids);
  const fields: Record<string, string> = {};
  const guessed = new Set<string>();
  let authors = "";
  let title = "";
  let titleSure = false;
  let year: string | undefined;
  let yearSure = false;
  let after = "";

  const bracket = YEAR_IN_BRACKETS.exec(text);
  const quote = quotedTitle(text);
  if (quote) {
    authors = text.slice(0, quote.index);
    after = text.slice(quote.index + quote.length);
    title = quote.title;
    titleSure = true;
    // The year in brackets may stand before the title (Harvard) or after it.
    if (bracket) {
      year = bracket[1];
      yearSure = true;
      authors = authors.replace(bracket[0], " ");
      after = after.replace(bracket[0], " ");
    }
  } else if (bracket) {
    year = bracket[1];
    yearSure = true;
    authors = text.slice(0, bracket.index);
    const split = splitTitle(text.slice(bracket.index + bracket[0].length));
    title = split.title;
    after = split.after;
  } else {
    const loose = new RegExp(String.raw`(?<![\d–-])\b(${YEAR})[a-z]?\b(?![\d–-])`).exec(text);
    if (loose) {
      year = loose[1];
      authors = text.slice(0, loose.index);
      const split = splitTitle(text.slice(loose.index + loose[0].length));
      title = split.title;
      after = split.after;
    }
  }

  if (!title) {
    draft.fields = { title: text.replace(/[\s.]+$/, "") };
    draft.guessed = ["title"];
    draft.note = "Could not tell the parts of this apart, so it is all in the title: move the words to the right fields.";
    addIdentifiers(draft.fields, ids);
    draft.type = "misc";
    return draft;
  }

  const venue = readVenue(after, !year);
  if (!year && venue.year) year = venue.year;
  if (authors.trim()) {
    fields.author = formatAuthors(trimAuthors(authors));
    guessed.add("author");
  }
  fields.title = title;
  if (!titleSure) guessed.add("title");
  if (year) {
    fields.year = year;
    if (!yearSure) guessed.add("year");
  }
  const numbers = venue.volume || venue.number || venue.pages;
  let type = "misc";
  if (venue.name) {
    let field = "howpublished";
    if (venue.conference || CONFERENCE.test(venue.name)) {
      type = "inproceedings";
      field = "booktitle";
    } else if (numbers || JOURNAL.test(venue.name)) {
      type = "article";
      field = "journal";
    } else if (PUBLISHER.test(venue.name)) {
      type = "book";
      field = "publisher";
    }
    fields[field] = venue.name;
    guessed.add(field);
  } else if (numbers) type = "article";
  for (const name of ["volume", "number", "pages"] as const) {
    const value = venue[name];
    if (value) {
      fields[name] = value;
      guessed.add(name);
    }
  }
  addIdentifiers(fields, ids);
  draft.type = type;
  draft.fields = fields;
  draft.guessed = [...guessed];
  return draft;
}

/** The identifiers found, in the fields BibTeX gives them. */
export function addIdentifiers(fields: Record<string, string>, ids: Identifiers): void {
  if (ids.doi) fields.doi = ids.doi;
  if (ids.arxiv) {
    fields.eprint = ids.arxiv;
    fields.archiveprefix = "arXiv";
  }
  if (ids.url) fields.url = ids.url;
}
