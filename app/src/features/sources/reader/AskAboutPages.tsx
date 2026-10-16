// "Ask AI about these pages…" in the reader's bar: which pages (a number or a
// range, the one in view to begin with) and whether the highlights on them go
// along. It starts a chat in the dock with those pages as its context, so
// what will be sent is the chip, in view before anything is.

import "./ask-pages.css";

import { useMemo, useRef, useState } from "react";

import { useShell } from "../../../lib/store";
import type { Highlight } from "../../../lib/vault/types";
import { Icon } from "../../../ui/Icon";
import { useChat } from "../../chat/store";
import { Popup } from "../../pages/page/Popup";
import { MAX_PAGES, parsePages, pdfChip } from "./ai-context";

interface Props {
  source: string;
  title: string;
  /** The page in view. */
  current: number;
  /** How many pages the PDF has. */
  pages: number;
  highlights: readonly Highlight[];
}

/** The pages `spec` names, or why it names none. */
function check(spec: string, total: number): { pages: number[] } | { error: string } {
  try {
    const pages = parsePages(spec);
    if (pages.length === 0) return { error: "Name a page, or a range such as 3-5" };
    if (pages.length > MAX_PAGES) return { error: `Choose at most ${MAX_PAGES} pages at a time` };
    const past = pages.find((page) => page > total);
    if (past !== undefined) return { error: `This PDF has ${total} ${total === 1 ? "page" : "pages"}` };
    return { pages };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

function Form({ source, title, current, pages: total, highlights, onDone }: Props & { onDone(): void }) {
  const [spec, setSpec] = useState(String(current));
  const [withMarks, setWithMarks] = useState(true);
  const checked = useMemo(() => check(spec, total), [spec, total]);
  const named = "pages" in checked ? checked.pages : [];
  const marked = highlights.filter((h) => named.includes(h.page));
  const ask = () => {
    if (!("pages" in checked)) return;
    const chip = pdfChip(source, title, checked.pages, withMarks ? marked.map((h) => h.id) : []);
    useChat.getState().start({ context: [chip], open: true, follow: false });
    useShell.getState().toggleChat(true);
    onDone();
  };
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        ask();
      }}
    >
      <label>
        Pages
        <input type="text" autoFocus aria-label="Pages" value={spec} inputMode="numeric" onChange={(event) => setSpec(event.target.value)} onFocus={(event) => event.currentTarget.select()} />
      </label>
      {"error" in checked ? (
        <p className="kasten-reader-ask-hint" role="alert">
          {checked.error}
        </p>
      ) : (
        <p className="kasten-reader-ask-hint">
          {named.length} {named.length === 1 ? "page" : "pages"} of {total}; the most is {MAX_PAGES}
        </p>
      )}
      {marked.length > 0 && (
        <label>
          <input type="checkbox" checked={withMarks} onChange={(event) => setWithMarks(event.target.checked)} />
          Include the {marked.length} {marked.length === 1 ? "highlight" : "highlights"} on {named.length === 1 ? "this page" : "these pages"}
        </label>
      )}
      <div className="kasten-reader-ask-actions">
        <button type="button" onClick={onDone}>
          Cancel
        </button>
        <button type="submit" disabled={"error" in checked}>
          Ask in chat
        </button>
      </div>
    </form>
  );
}

export function AskAboutPages(props: Props) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  return (
    <span className="relative">
      <button
        ref={button}
        type="button"
        className="kasten-reader-toggle"
        aria-label="Ask AI about these pages…"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Ask AI about pages of this PDF"
        onClick={() => setOpen((was) => !was)}
      >
        <Icon name="sparkle" className="size-4" />
      </button>
      {open && (
        <Popup label="Ask AI about these pages" anchor={button} onClose={() => setOpen(false)} className="kasten-reader-ask">
          <Form {...props} onDone={() => setOpen(false)} />
        </Popup>
      )}
    </span>
  );
}
