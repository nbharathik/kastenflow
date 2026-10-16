// The papers a comparison can include, each ticked or not, with the highlights
// of its PDF to choose from: what is ticked goes into the page as evidence.

import { Disclosure } from "../../../ui/Disclosure";
import { shorten } from "../../references/labels";
import type { ComparePaper } from "./papers";

interface Props {
  papers: readonly ComparePaper[];
  picked: ReadonlySet<string>;
  onPick(id: string): void;
  /** Highlights the person has left out. */
  off: ReadonlySet<string>;
  onToggleHighlight(id: string): void;
}

export function PaperList({ papers, picked, onPick, off, onToggleHighlight }: Props) {
  if (papers.length === 0) {
    return <p className="text-13 text-muted">There are no references or PDFs yet. Add a paper, or import a PDF, then compare them here.</p>;
  }
  return (
    <ul aria-label="Papers" className="max-h-72 space-y-1 overflow-y-auto rounded border border-line p-2">
      {papers.map((paper) => {
        const on = picked.has(paper.id);
        const chosen = paper.highlights.filter((h) => !off.has(h.id)).length;
        return (
          <li key={paper.id}>
            <label className="flex items-start gap-2 text-13">
              <input type="checkbox" className="mt-1" checked={on} onChange={() => onPick(paper.id)} />
              <span className="min-w-0 flex-1">
                <span className="font-medium">{paper.label}</span>
                {paper.title !== paper.label && <span className="text-muted">: {paper.title}</span>}
                <span className="block text-12 text-muted">
                  {paper.key ? `[@${paper.key}]` : "No reference"} · {paper.source ? `${paper.highlights.length} ${paper.highlights.length === 1 ? "highlight" : "highlights"}` : "No PDF"}
                </span>
              </span>
            </label>
            {on && paper.highlights.length > 0 && (
              <div className="ml-6">
                <Disclosure title={`Evidence: ${chosen} of ${paper.highlights.length} highlights`}>
                  <ul className="space-y-1">
                    {paper.highlights.map((h) => (
                      <li key={h.id}>
                        <label className="flex items-start gap-2 text-12">
                          <input type="checkbox" className="mt-0.5" checked={!off.has(h.id)} onChange={() => onToggleHighlight(h.id)} aria-label={`Use the highlight on page ${h.page}: ${shorten(h.text, 60)}`} />
                          <span>
                            <span className="text-muted">p. {h.page}</span> {shorten(h.text.replace(/\s+/g, " "), 110)}
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </Disclosure>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
