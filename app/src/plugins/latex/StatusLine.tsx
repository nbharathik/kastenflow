// The line under the editor: which engine builds this document, how the
// last build went (with a moving bar while one runs long, such as the first
// build that downloads TeX packages), and whether the text is saved.

import { errorCount, statusText } from "./build-state";
import type { Snapshot } from "./session";

const ENGINES: Record<string, string> = { tectonic: "Tectonic", "latexmk-pdf": "pdfLaTeX", "latexmk-xe": "XeLaTeX", "latexmk-lua": "LuaLaTeX" };

/** What to say about saving: nothing to fear, or what is wrong. */
export function saveText(snap: Pick<Snapshot, "dirty" | "saveProblem" | "conflict">): { text: string; bad: boolean } {
  if (snap.conflict) return { text: "Not saved: the file changed elsewhere", bad: true };
  if (snap.saveProblem) return { text: "Not saved", bad: true };
  return { text: snap.dirty.length > 0 ? "Saving…" : "Saved", bad: false };
}

export function StatusLine({ snap }: { snap: Snapshot }) {
  const { build } = snap;
  const working = snap.requesting || build.phase === "queued" || build.phase === "running";
  const text = snap.requesting && build.phase !== "running" ? "Building…" : statusText(build);
  const saving = saveText(snap);
  const errors = errorCount(build);
  return (
    <div className="latex-statusline" role="status" aria-live="polite">
      <span>{ENGINES[snap.doc.engine] ?? snap.doc.engine}</span>
      <span className={!working && errors > 0 ? "is-error" : undefined}>{text}</span>
      {working && (
        <span className="latex-progress" role="progressbar" aria-label={build.note ?? "Building"}>
          <span />
        </span>
      )}
      <span className="latex-spacer" />
      <span className={saving.bad ? "is-error" : undefined}>{saving.text}</span>
    </div>
  );
}
