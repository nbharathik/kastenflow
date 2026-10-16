// A diagram a commit changed, in the history: what changed to what in words
// (shapes before and after, added, removed, renamed, moved), not lines of XML.
// The file's own text stays one button away.

import { useMemo, useState } from "react";

import { diagramChange, diagramChangeWords } from "../diagrams/change";
import { noteDiff } from "./change-words";
import { DiffStats, DiffView } from "./DiffView";

const QUIET = "rounded px-1.5 py-0.5 text-12 text-muted transition-colors hover:bg-hover hover:text-ink";

export function DiagramChange({ path, before, after }: { path: string; before: string | null; after: string | null }) {
  const [text, setText] = useState(false);
  const sentences = useMemo(() => diagramChangeWords(diagramChange(before, after)), [before, after]);
  const { lines } = useMemo(() => (text ? noteDiff(path, before, after) : { lines: [] }), [text, path, before, after]);
  return (
    <div>
      <ul aria-label="What changed in the diagram" className="space-y-0.5 px-3 py-2 text-13">
        {sentences.map((sentence) => (
          <li key={sentence}>{sentence}</li>
        ))}
      </ul>
      <div className="flex items-center gap-2 px-3 pb-2">
        <button type="button" className={QUIET} aria-expanded={text} onClick={() => setText(!text)}>
          {text ? "Hide the file's text" : "Show the file's text"}
        </button>
        {text && <DiffStats lines={lines} />}
      </div>
      {text && (
        <div className="max-h-80 overflow-auto border-t border-line">
          <DiffView lines={lines} mode="unified" context={2} limit={200} label={`Changes to ${path}`} />
        </div>
      )}
    </div>
  );
}

/** A diagram's picture in a commit: drawn again, to match its diagram or on its own. */
export function PictureChange({ withSource }: { withSource: boolean }) {
  return <p className="px-3 py-2 text-13 text-muted">{withSource ? "The picture was drawn again to match." : "The picture of the diagram was drawn again. The diagram itself is as it was."}</p>;
}
