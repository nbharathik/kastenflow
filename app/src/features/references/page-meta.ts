// A paper from the tags of a web page the person already has open: Google
// Scholar's `citation_*`, Dublin Core, PRISM, Open Graph and JSON-LD. The page
// is hostile by default, so whatever it says is data: markup and control
// characters come out, sizes are capped, a DOI must look like one, an address
// must be a web address, and nothing is looked up anywhere.

import { blankDraft, type PaperDraft } from "./draft";
import { findIdentifiers } from "./identifiers";
import { lastFirst } from "./plain-citation";

export interface PageMeta {
  /** The address the app saw the tab at, never the one the page reports. */
  url: string;
  title: string;
  /** Name (lower case) and content of each `<meta>` tag. */
  tags: [string, string][];
  /** The text of each `application/ld+json` script. */
  ld: string[];
}

const MOST_TAGS = 400;
const MOST_LD = 10;
const LD_SIZE = 100_000;
const MOST_AUTHORS = 100;

/** What the page-side reader answered: `{ meta: [[name, content]...], ld: [text...] }`. Anything else reads as nothing. */
export function readPageMeta(payload: string, url: string, title: string): PageMeta {
  const out: PageMeta = { url, title, tags: [], ld: [] };
  let data: unknown;
  try {
    data = JSON.parse(payload);
  } catch {
    return out;
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) return out;
  const { meta, ld } = data as { meta?: unknown; ld?: unknown };
  if (Array.isArray(meta)) {
    for (const pair of meta) {
      if (out.tags.length >= MOST_TAGS) break;
      if (Array.isArray(pair) && typeof pair[0] === "string" && typeof pair[1] === "string" && pair[0].trim() !== "") out.tags.push([pair[0].trim().toLowerCase().slice(0, 100), pair[1].slice(0, 6000)]);
    }
  }
  if (Array.isArray(ld)) for (const text of ld) if (typeof text === "string" && out.ld.length < MOST_LD) out.ld.push(text.slice(0, LD_SIZE));
  return out;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Text a page gave, as plain words: no markup, entities read, one line, no control characters, at most `max` long. */
function clean(raw: unknown, max = 1000): string {
  if (typeof raw !== "string") return "";
  return (
    raw
      .replace(/<\/(?:p|div|li|h[1-6]|tr)>|<br\s*\/?>/gi, " ")
      .replace(/<[^>]*>/g, "")
      .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, name: string) => {
        if (name[0] === "#") {
          const code = name[1]?.toLowerCase() === "x" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
          return Number.isFinite(code) && code > 31 && code < 0x110000 ? String.fromCodePoint(code) : " ";
        }
        return ENTITIES[name.toLowerCase()] ?? whole;
      })
      .replace(/\s+/g, " ")
      // eslint-disable-next-line no-control-regex -- control characters are never part of a title
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .trim()
      .slice(0, max)
  );
}

const yearOf = (text: string): string | undefined => /\b(1[5-9]\d{2}|20\d{2})\b/.exec(text)?.[1];
const webAddress = (url: string): string | undefined => (/^https?:\/\/[^\s/@]+(?:[/?#]|$)/i.test(url) && !/\s/.test(url) ? url : undefined);

/** A person's name as BibTeX writes it. */
const person = (name: string): string => {
  const text = clean(name, 200);
  return text.includes(",") ? text : lastFirst(text);
};

/** The scholarly article (or book, report...) a JSON-LD text describes, if it describes one. */
function ldItem(texts: readonly string[]): Record<string, unknown> | null {
  const items: Record<string, unknown>[] = [];
  const visit = (value: unknown, depth: number) => {
    if (depth > 4 || items.length > 50) return;
    if (Array.isArray(value)) value.forEach((v) => visit(v, depth + 1));
    else if (typeof value === "object" && value !== null) {
      const map = value as Record<string, unknown>;
      items.push(map);
      if (map["@graph"]) visit(map["@graph"], depth + 1);
    }
  };
  for (const text of texts) {
    try {
      visit(JSON.parse(text), 0);
    } catch {
      // A script that is not JSON says nothing.
    }
  }
  const types = (item: Record<string, unknown>) => [item["@type"]].flat().filter((t): t is string => typeof t === "string");
  const order = ["ScholarlyArticle", "TechArticle", "Thesis", "Report", "Book", "Chapter", "Article", "NewsArticle", "BlogPosting", "CreativeWork"];
  for (const wanted of order) {
    const found = items.find((item) => types(item).includes(wanted));
    if (found) return found;
  }
  return null;
}

/** A JSON-LD value as the names it gives: a string, an object with a name, or a list of them. */
function names(value: unknown): string[] {
  return [value].flat().flatMap((v) => {
    if (typeof v === "string") return [v];
    if (typeof v === "object" && v !== null) {
      const map = v as Record<string, unknown>;
      if (typeof map.name === "string") return [map.name];
      if (typeof map.familyName === "string") return [`${typeof map.givenName === "string" ? map.givenName : ""} ${map.familyName}`.trim()];
    }
    return [];
  });
}

function ldDoi(value: unknown): string | undefined {
  for (const v of [value].flat()) {
    const text = typeof v === "string" ? v : typeof v === "object" && v !== null && typeof (v as { value?: unknown }).value === "string" ? (v as { value: string }).value : "";
    const doi = findIdentifiers(text).doi;
    if (doi) return doi;
  }
  return undefined;
}

export function draftFromPage(meta: PageMeta): PaperDraft {
  const values = new Map<string, string[]>();
  for (const [name, content] of meta.tags) values.set(name.toLowerCase(), [...(values.get(name.toLowerCase()) ?? []), content]);
  const first = (...names_: string[]): string => {
    for (const name of names_) for (const v of values.get(name) ?? []) if (clean(v, 4000) !== "") return clean(v, 4000);
    return "";
  };
  const every = (...names_: string[]): string[] => names_.flatMap((name) => values.get(name) ?? []);
  const item = ldItem(meta.ld);
  const scholarly = meta.tags.some(([name]) => /^(?:citation_|dc\.|dcterms\.|prism\.)/i.test(name)) || (item !== null && [item["@type"]].flat().some((t) => typeof t === "string" && /^(?:ScholarlyArticle|TechArticle|Thesis|Report|Book|Chapter)$/.test(t)));

  const fields: Record<string, string> = {};
  const guessed = new Set<string>();
  /** Keeps a value that has words in it, cut to a size that fits the field. */
  const set = (name: string, value: string | undefined, guess = false) => {
    if (!value) return;
    fields[name] = value.slice(0, name === "abstract" || name === "author" ? 4000 : 500);
    if (guess) guessed.add(name);
  };

  const scholarlyTitle = first("citation_title", "dc.title", "dcterms.title") || clean(item?.headline ?? item?.name, 500);
  const title = scholarlyTitle || first("og:title", "twitter:title") || clean(meta.title, 500);
  set("title", title, !scholarlyTitle);

  const peopleRaw = every("citation_author", "dc.creator", "dcterms.creator").flatMap((v) => v.split(";"));
  const people = (peopleRaw.length > 0 ? peopleRaw : item ? names(item.author) : []).map(person).filter(Boolean);
  const fallbackPeople = people.length === 0 ? every("author", "article:author", "twitter:creator").filter((v) => !/^https?:\/\//i.test(v)).map(person).filter(Boolean) : [];
  const chosen = people.length > 0 ? people : fallbackPeople;
  if (chosen.length > 0) {
    const shown = chosen.slice(0, MOST_AUTHORS);
    set("author", (chosen.length > MOST_AUTHORS ? [...shown, "others"] : shown).join(" and "), people.length === 0);
  }

  const dated = first("citation_publication_date", "citation_date", "citation_online_date", "citation_year", "dc.date", "dcterms.issued", "dcterms.date", "prism.publicationdate") || clean(item?.datePublished, 40);
  const year = yearOf(dated) ?? yearOf(first("article:published_time", "og:published_time"));
  set("year", year, !dated);

  const conference = first("citation_conference_title", "citation_conference");
  const journal = first("citation_journal_title", "prism.publicationname") || (item ? clean(names(item.isPartOf)[0], 300) : "");
  const dissertation = first("citation_dissertation_institution");
  const report = first("citation_technical_report_institution");
  const book = Boolean(first("citation_isbn", "books:isbn")) || first("og:type") === "book" || [item?.["@type"]].flat().includes("Book");
  let type = "misc";
  if (dissertation) {
    type = "phdthesis";
    set("school", dissertation);
  } else if (report) {
    type = "techreport";
    set("institution", report);
  } else if (conference) {
    type = "inproceedings";
    set("booktitle", conference);
  } else if (journal) {
    type = "article";
    set("journal", journal);
  } else if (book) type = "book";

  set("volume", first("citation_volume", "prism.volume").slice(0, 30));
  set("number", first("citation_issue", "prism.number").slice(0, 30));
  const [firstPage, lastPage] = [first("citation_firstpage", "prism.startingpage"), first("citation_lastpage", "prism.endingpage")];
  if (firstPage) set("pages", (lastPage ? `${firstPage}--${lastPage}` : firstPage).slice(0, 30));
  set("publisher", first("citation_publisher", "dc.publisher", "dcterms.publisher") || (item ? clean(names(item.publisher)[0], 300) : ""));
  set("isbn", first("citation_isbn", "books:isbn").slice(0, 30));

  const doi = [first("citation_doi", "prism.doi"), first("dc.identifier", "dcterms.identifier"), ldDoi(item?.identifier) ?? "", ...every("dc.identifier")]
    .map((text) => findIdentifiers(text).doi)
    .find(Boolean);
  set("doi", doi);

  const tagged = first("citation_arxiv_id");
  const arxiv = (tagged ? findIdentifiers(tagged).arxiv : undefined) ?? findIdentifiers(meta.url).arxiv;
  if (arxiv) {
    set("eprint", arxiv);
    set("archiveprefix", "arXiv");
  }
  set("abstract", first("citation_abstract", "dc.description", "dcterms.abstract") || clean(item?.abstract, 4000));
  set("url", webAddress(meta.url));

  const draft: PaperDraft = { ...blankDraft(), type, fields, guessed: [...guessed], origin: "page" };
  if (!scholarly) draft.note = "This page has no scholarly tags (citation_title, DC.title and the like), so only its title, address and what it says about an author or date were read: check them.";
  return draft;
}
