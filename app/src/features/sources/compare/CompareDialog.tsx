// "Compare papers": tick the papers, choose the evidence, and make an ordinary
// Markdown page of them: a table with a row for each paper and the columns
// question, method, evidence, limitations and relevance to fill in, or an
// outline of the quotations chosen. Both are plain pages, editable by hand,
// and every quotation links back to its highlight. AI help is optional and
// opens in its own section.

import { useEffect, useId, useMemo, useState } from "react";

import { Button } from "../../../ui/Button";
import { Disclosure } from "../../../ui/Disclosure";
import { Modal } from "../../../ui/Modal";
import { useWorkspace } from "../../workspace/store";
import type { CompareRequest } from "./compare-state";
import { CompareAi } from "./CompareAi";
import { comparisonMarkdown, comparisonTitle, DEFAULT_COLUMNS, outlineMarkdown } from "./pages";
import { PaperList } from "./PaperList";
import type { ComparePaper } from "./papers";
import { useComparePapers } from "./use-compare";

const columnsOf = (text: string) => text.split(",").map((c) => c.trim()).filter(Boolean);

/** The page's words: the table, with the AI's draft under it when the person kept one. */
export function pageBody(kind: "comparison" | "outline", papers: readonly ComparePaper[], off: ReadonlySet<string>, columns: readonly string[], withEvidence: boolean, draft: string | null): string {
  const chosen = (p: ComparePaper) => p.highlights.filter((h) => !off.has(h.id));
  if (kind === "outline") return outlineMarkdown(papers.map((paper) => ({ paper, highlights: chosen(paper) })));
  const evidence = new Map(withEvidence ? papers.map((p) => [p, chosen(p)] as const) : []);
  const table = comparisonMarkdown(papers, columns, evidence);
  return draft ? `${table}\n## Draft by AI: check every claim against the source\n\n${draft.trim()}\n` : table;
}

export function CompareDialog({ request, onClose }: { request: CompareRequest; onClose(): void }) {
  const titleId = useId();
  const { papers, keys, error } = useComparePapers();
  const [picked, setPicked] = useState<ReadonlySet<string> | null>(null);
  const [off, setOff] = useState<ReadonlySet<string>>(new Set());
  const [columnText, setColumnText] = useState(DEFAULT_COLUMNS.join(", "));
  const [withEvidence, setWithEvidence] = useState(true);
  const [beside, setBeside] = useState(true);
  const [name, setName] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  // What was asked for is ticked once the papers are known.
  useEffect(() => {
    if (!papers || picked) return;
    const wantedKeys = new Set(request.keys ?? []);
    const wantedSources = new Set(request.sources ?? []);
    setPicked(new Set(papers.filter((p) => (p.key && wantedKeys.has(p.key)) || (p.source && wantedSources.has(p.source))).map((p) => p.id)));
  }, [papers, picked, request]);

  const chosen = useMemo(() => (papers ?? []).filter((p) => picked?.has(p.id)), [papers, picked]);
  const columns = columnsOf(columnText);
  const title = name ?? (chosen.length > 0 ? comparisonTitle(chosen) : "Comparison");

  const make = async (kind: "comparison" | "outline") => {
    const { create, toast, openRight } = useWorkspace.getState();
    if (chosen.length === 0) return;
    setBusy(true);
    setFailed(null);
    try {
      const body = pageBody(kind, chosen, off, columns, withEvidence, draft);
      const made = await create({ kind: "page", title: kind === "outline" ? comparisonTitle(chosen, "Outline") : title, body });
      if (!made) {
        setFailed("The page could not be made.");
        return;
      }
      const first = chosen.find((p) => p.source);
      if (beside && first) openRight({ view: "highlights", path: first.source! });
      toast(`Made “${made.meta.title}”`);
      onClose();
    } catch (err) {
      setFailed(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const toggle = (id: string) =>
    setPicked((was) => {
      const next = new Set(was ?? []);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const toggleHighlight = (id: string) =>
    setOff((was) => {
      const next = new Set(was);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <Modal labelledBy={titleId} onClose={onClose} className="ui-dialog w-[min(100%,720px)]">
      <h2 id={titleId} className="ui-dialog-title">
        Compare papers
      </h2>
      <div className="flex max-h-[68vh] flex-col gap-3 overflow-y-auto pr-1">
        <p className="text-13 text-muted">Tick the papers to put side by side. The page is plain Markdown: you fill in the table yourself, and nothing needs AI.</p>
        {papers === null ? <p className="text-13 text-muted">Reading your references and PDFs…</p> : <PaperList papers={papers} picked={picked ?? new Set()} onPick={toggle} off={off} onToggleHighlight={toggleHighlight} />}
        {error && (
          <p role="alert" className="text-13 text-danger">
            {error}
          </p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <label className="col-span-2 text-12 font-medium">
            Page title
            <input className="ui-field mt-1 font-normal" value={title} onChange={(event) => setName(event.target.value)} />
          </label>
          <label className="col-span-2 text-12 font-medium">
            Columns, separated by commas
            <input className="ui-field mt-1 font-normal" value={columnText} onChange={(event) => setColumnText(event.target.value)} />
          </label>
          <label className="flex items-center gap-2 text-13">
            <input type="checkbox" checked={withEvidence} onChange={(event) => setWithEvidence(event.target.checked)} />
            Start the Evidence column from the highlights chosen
          </label>
          <label className="flex items-center gap-2 text-13">
            <input type="checkbox" checked={beside} onChange={(event) => setBeside(event.target.checked)} />
            Open the first PDF beside the page
          </label>
        </div>
        <Disclosure title="Get a first draft from AI (optional)">
          <CompareAi papers={chosen} off={off} columns={columns} keys={keys} onDraft={setDraft} />
        </Disclosure>
        {draft && <p className="text-12 text-muted">The AI’s draft will go under the table, marked to check.</p>}
      </div>
      {failed && (
        <p role="alert" className="text-13 text-danger">
          {failed}
        </p>
      )}
      <footer className="ui-dialog-foot">
        <Button onClick={onClose}>Cancel</Button>
        <Button disabled={chosen.length === 0 || busy} title="One heading for each paper, with the highlights chosen as quotations" onClick={() => void make("outline")}>
          Create outline
        </Button>
        <Button tone="primary" disabled={chosen.length === 0 || busy} onClick={() => void make("comparison")}>
          {busy ? "Making…" : "Create comparison page"}
        </Button>
      </footer>
    </Modal>
  );
}
