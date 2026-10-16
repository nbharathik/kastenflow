// What a PDF says about itself, for the form that adds it as a paper: the title
// and authors of its information dictionary, and a DOI or arXiv identifier on
// its first page. It is read on this computer with pdf.js and nothing is
// looked up. A title or author that is only what a tool left behind is not
// taken, and a field the PDF does not give is left empty.

import type { PDFDocumentProxy } from "pdfjs-dist";

import { blankDraft, type PaperDraft } from "../references/draft";
import { findIdentifiers } from "../references/identifiers";
import { addIdentifiers, formatAuthors } from "../references/plain-citation";
import { pageText } from "./reader/ai-context";

export interface PdfFacts {
  /** The information dictionary's text entries: Title, Author, Subject... */
  info: Record<string, string>;
  /** The words of the first page. */
  text: string;
}

/** How much of the first page is looked at for an identifier: its head, where a stamp or a byline is. */
const HEAD = 6000;

const JUNK_TITLE = /^(untitled|microsoft word|document\d*$|slide \d)|\.(pdf|docx?|tex|pptx?)$/i;
const JUNK_AUTHOR = /^(admin|administrator|user|owner|author|unknown|microsoft|adobe|www\.)/i;

/** The information dictionary and the first page of an open PDF; what cannot be read is left empty. */
export async function readPdfFacts(doc: PDFDocumentProxy): Promise<PdfFacts> {
  const info: Record<string, string> = {};
  try {
    const meta = await doc.getMetadata();
    for (const [name, value] of Object.entries((meta.info ?? {}) as Record<string, unknown>)) if (typeof value === "string") info[name] = value;
  } catch {
    // A PDF with no readable information still has a first page.
  }
  let text = "";
  try {
    text = await pageText(doc, 1);
  } catch {
    // A PDF whose first page cannot be read still has its information.
  }
  return { info, text };
}

const clean = (text: string | undefined) => (text ?? "").replace(/\s+/g, " ").trim();

/** The draft a PDF's own words make. `sourceTitle` is the name the vault shows it by, the last resort for a title. */
export function draftFromPdf(path: string, sourceTitle: string, facts: PdfFacts): PaperDraft {
  const draft: PaperDraft = { ...blankDraft(), origin: "pdf", type: "misc" };
  const fields: Record<string, string> = {};
  const guessed: string[] = [];

  const title = clean(facts.info.Title);
  const named = title.length >= 3 && !JUNK_TITLE.test(title);
  if (named) fields.title = title;
  else if (sourceTitle.trim()) {
    fields.title = sourceTitle.trim();
    guessed.push("title");
  }

  const author = clean(facts.info.Author);
  if (author && !JUNK_AUTHOR.test(author)) {
    fields.author = formatAuthors(author.replace(/\s*;\s*/g, " and "));
    guessed.push("author");
  }

  const ids = findIdentifiers(facts.text.slice(0, HEAD));
  // The URL on a page is not a reference's address; only the identifiers are taken.
  addIdentifiers(fields, { ...(ids.doi ? { doi: ids.doi } : {}), ...(ids.arxiv ? { arxiv: ids.arxiv } : {}) });
  if (ids.doi) draft.type = "article";
  // A new-style arXiv number begins with the year and month it was posted in.
  const posted = ids.arxiv ? /^(\d{2})\d{2}\./.exec(ids.arxiv)?.[1] : undefined;
  if (posted) {
    fields.year = `20${posted}`;
    guessed.push("year");
  }
  fields.file = path;

  const found = named || fields.author !== undefined || ids.doi !== undefined || ids.arxiv !== undefined;
  draft.fields = fields;
  draft.guessed = guessed;
  draft.note = found ? "Read from the PDF itself: check every field. Details are not fetched." : "Nothing in this PDF names its paper, so only its name is filled in: fill in the rest, or paste BibTeX.";
  return draft;
}
