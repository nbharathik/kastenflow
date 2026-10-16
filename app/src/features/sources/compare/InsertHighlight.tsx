// "Insert in page" for a highlight, in its popover: the quotation goes into the
// page open beside the PDF (the one in front when several are open), with its
// source, page, citation and a link back to this highlight. With no page open,
// a page for notes on the paper is made beside the PDF.

import "./compare.css";

import { useState } from "react";

import type { Highlight } from "../../../lib/vault/source-types";
import type { NoteMeta } from "../../../lib/vault/types";
import { addQuotation, openPages, paperOf, quoteInNewPage } from "./insert-highlight";

interface Props {
  source: string;
  highlight: Highlight;
  /** Called once the quotation is in a page. */
  onDone(): void;
}

export function InsertHighlight({ source, highlight, onDone }: Props) {
  const [choices, setChoices] = useState<NoteMeta[] | null>(null);
  const [busy, setBusy] = useState(false);

  const put = async (path: string | null) => {
    setBusy(true);
    try {
      const paper = await paperOf(source);
      const done = path ? await addQuotation(path, paper, highlight) : await quoteInNewPage(paper, highlight);
      if (done) onDone();
    } finally {
      setBusy(false);
    }
  };

  const start = () => {
    const pages = openPages();
    if (pages.length > 1) setChoices(pages);
    else void put(pages[0]?.path ?? null);
  };

  return (
    <>
      <button type="button" disabled={busy} title="Put this passage in the page beside the PDF, with its source, page, citation and a link back" onClick={start}>
        Insert in page
      </button>
      {choices && (
        <div role="group" aria-label="Insert in which page?" className="kasten-hl-pages">
          {choices.map((page) => (
            <button key={page.path} type="button" disabled={busy} onClick={() => void put(page.path)}>
              {page.title}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
