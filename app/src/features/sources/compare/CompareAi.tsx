// Asking AI for a first draft of a comparison, in the open. Nothing is sent
// until the passages are shown as they will go; the answer comes back with
// its quotations told from its own words and its citation keys checked; and
// what it writes is a draft for a person to check against the papers, never
// the finished comparison.

import { useMemo, useState } from "react";

import { Button } from "../../../ui/Button";
import { openProviders } from "../../chat/actions";
import { modelFor } from "../../chat/prefs";
import { excerptsFor } from "../../chat/pdf-excerpts";
import { useChat } from "../../chat/store";
import type { Chip } from "../../chat/thread";
import type { Excerpt } from "../../chat/types";
import { useAnswer } from "../../pages/editor/ai/useAnswer";
import { pdfChip } from "../reader/ai-context";
import { AnswerView } from "./AnswerView";
import { checkAnswer, instructionFor, MOST_CHARS, pagesFor, selectionOf, type Passage } from "./ai-compare";
import type { ComparePaper } from "./papers";

interface Props {
  /** The papers ticked. */
  papers: readonly ComparePaper[];
  /** Highlights left out. */
  off: ReadonlySet<string>;
  columns: readonly string[];
  /** Every key in the bibliography. */
  keys: ReadonlySet<string>;
  /** Reads the pages the chips name (the PDF reader's job); tests give another. */
  readExcerpts?: (chips: readonly Chip[]) => Promise<Excerpt[]>;
  /** The draft to put in the page, or null for none. */
  onDraft(text: string | null): void;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** The passages for `papers`: the pages of their PDFs that hold the chosen evidence, else the abstract their reference holds. */
async function passagesFor(papers: readonly ComparePaper[], off: ReadonlySet<string>, read: (chips: readonly Chip[]) => Promise<Excerpt[]>): Promise<Passage[]> {
  const chosen = new Set(papers.flatMap((p) => p.highlights.filter((h) => !off.has(h.id)).map((h) => h.id)));
  const withPdf = papers.filter((p) => p.source);
  const chips = withPdf.map((p) => pdfChip(p.source!, p.title, pagesFor(p, chosen)));
  const excerpts = chips.length > 0 ? await read(chips) : [];
  const out: Passage[] = [];
  for (const paper of papers) {
    const mine = excerpts.filter((e) => e.source === paper.source && e.text.trim() !== "");
    for (const e of mine) out.push({ paper, page: e.page, text: e.text, from: "pdf" });
    if (mine.length === 0 && paper.abstract) out.push({ paper, page: null, text: paper.abstract, from: "abstract" });
  }
  return out;
}

export function CompareAi({ papers, off, columns, keys, readExcerpts = excerptsFor, onDraft }: Props) {
  const providers = useChat((s) => s.providers);
  const [passages, setPassages] = useState<Passage[] | null>(null);
  const [skipped, setSkipped] = useState<ReadonlySet<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [sentText, setSentText] = useState("");
  const [sentKeys, setSentKeys] = useState<ReadonlySet<string>>(new Set());
  const answer = useAnswer("asking");
  const pick = modelFor({ provider: null, model: null }, providers);

  const sending = useMemo(() => (passages ?? []).filter((_, i) => !skipped.has(i)), [passages, skipped]);
  const selection = selectionOf(sending);
  const lines = useMemo(() => checkAnswer(answer.text, sentText, keys, sentKeys), [answer.text, sentText, keys, sentKeys]);
  const problems = lines.filter((l) => l.problems.length > 0).length;

  const show = async () => {
    setLoading(true);
    setProblem(null);
    setSkipped(new Set());
    onDraft(null);
    try {
      if (useChat.getState().providers === null) await useChat.getState().loadProviders();
      const found = await passagesFor(papers, off, readExcerpts);
      setPassages(found);
      if (found.length === 0) setProblem("There are no pages to send: the papers have no PDF and no abstract. Import the PDFs, or add abstracts to the references.");
    } catch (err) {
      setProblem(`The pages could not be read: ${message(err)}`);
    } finally {
      setLoading(false);
    }
  };

  const ask = async () => {
    const model = modelFor({ provider: null, model: null }, useChat.getState().providers);
    if (!model) return answer.setPhase("setup");
    setSentText(selection);
    setSentKeys(new Set(sending.flatMap((p) => (p.paper.key ? [p.paper.key] : []))));
    onDraft(null);
    const sentPapers = [...new Map(sending.map((p) => [p.paper.id, p.paper])).values()];
    await answer.start((id, onText) =>
      useChat.getState().ensure().write({ id, provider: model.provider, model: model.model, action: "ask", instruction: instructionFor(sentPapers, columns), title: "Comparison", selection, before: "", after: "" }, onText),
    );
  };

  return (
    <section aria-label="Draft with AI" className="flex flex-col gap-3 rounded border border-line p-3">
      <p className="text-12 text-muted">AI can misread a paper. It only writes a draft: check that the cited passage supports each claim before you rely on it.</p>
      {passages === null ? (
        <div>
          <Button size="sm" disabled={loading || papers.length === 0} onClick={() => void show()}>
            {loading ? "Reading the pages…" : "Show what would be sent"}
          </Button>
          <p className="mt-1 text-12 text-muted">Nothing is sent until you have seen the pages and chosen to ask.</p>
        </div>
      ) : (
        <>
          <ul aria-label="Passages that would be sent" className="max-h-52 space-y-1 overflow-y-auto">
            {passages.map((p, i) => (
              <li key={i}>
                <label className="flex items-center gap-2 text-12">
                  <input
                    type="checkbox"
                    checked={!skipped.has(i)}
                    onChange={() =>
                      setSkipped((was) => {
                        const next = new Set(was);
                        if (!next.delete(i)) next.add(i);
                        return next;
                      })
                    }
                  />
                  <span className="font-medium">{p.paper.label}</span>
                  <span className="text-muted">{p.from === "abstract" ? "abstract" : `page ${p.page}`}</span>
                </label>
                <details className="ml-6">
                  <summary className="cursor-pointer text-12 text-muted">Show the text ({p.text.length} characters)</summary>
                  <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-well p-2 text-12">{p.text}</pre>
                </details>
              </li>
            ))}
          </ul>
          <p className="text-12 text-muted" role="status">
            {sending.length} of {passages.length} passages, {Math.min(selection.length, MOST_CHARS)} of {MOST_CHARS} characters
            {selection.length >= MOST_CHARS ? ": the rest is cut" : ""}.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {answer.phase === "writing" ? (
              <Button size="sm" icon="stop" onClick={answer.stop}>
                Stop
              </Button>
            ) : (
              <Button size="sm" tone="primary" icon="sparkle" disabled={sending.length === 0} onClick={() => void ask()}>
                {answer.text ? "Ask again" : "Ask AI for a draft"}
              </Button>
            )}
            {pick && <span className="text-12 text-muted">{pick.provider} · {pick.model}</span>}
          </div>
        </>
      )}
      {answer.phase === "setup" && (
        <div className="flex items-center gap-2">
          <span className="text-13 text-muted">Add an AI provider in Settings to use this.</span>
          <Button size="sm" onClick={() => openProviders()}>
            Set up AI
          </Button>
        </div>
      )}
      {problem && (
        <p role="alert" className="text-13 text-danger">
          {problem}
        </p>
      )}
      {answer.error && (
        <p role="alert" className="text-13 text-danger">
          {answer.error}
        </p>
      )}
      {answer.text && (
        <>
          <AnswerView lines={lines} />
          {answer.phase === "done" && (
            <>
              <p className="text-12 text-muted" role="status">
                {problems === 0 ? "Every quotation was found in the passages and every key is one of the papers sent. That does not make the claims right: read the sources." : `${problems} ${problems === 1 ? "line has" : "lines have"} something to check, marked above.`}
              </p>
              <div className="flex gap-2">
                <Button size="sm" tone="primary" onClick={() => onDraft(answer.text)}>
                  Put the draft under the table
                </Button>
                <Button size="sm" onClick={() => onDraft(null)}>
                  Leave it out
                </Button>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
