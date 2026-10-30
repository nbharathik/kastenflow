// The LaTeX home: the documents in the vault, and the button that starts one.
// With none, one plain sentence and the same button.

import { useEffect, useState } from "react";

import { useWorkspace } from "../../features/workspace/store";
import { Button } from "../../ui/Button";
import { newDocument } from "./actions";
import { type LatexBackend, sentence } from "./backend";
import { rememberDocs } from "./docs-cache";
import { LATEX_VIEW } from "./manifest";
import type { LatexDoc } from "./types";
import "./doc-list.css";

export function DocList({ backend }: { backend: LatexBackend }) {
  const [docs, setDocs] = useState<LatexDoc[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [again, setAgain] = useState(0);

  useEffect(() => {
    let stale = false;
    setProblem(null);
    backend
      .docs()
      .then((list) => {
        if (stale) return;
        rememberDocs(list.map((d) => d.folder));
        setDocs(list);
      })
      .catch((err: unknown) => {
        if (!stale) setProblem(sentence(err));
      });
    return () => {
      stale = true;
    };
  }, [backend, again]);

  return (
    <div className="latex-list">
      <h2>LaTeX documents</h2>
      {problem ? (
        <>
          <p role="alert" className="m-0 text-13 text-muted">
            {problem}
          </p>
          <Button onClick={() => setAgain((n) => n + 1)}>Try again</Button>
        </>
      ) : docs === null ? (
        <p className="m-0 text-13 text-muted" aria-busy="true">
          Looking for documents…
        </p>
      ) : docs.length === 0 ? (
        <p className="m-0 text-13 text-muted">No LaTeX documents yet. Start one and it will show up here.</p>
      ) : (
        docs.map((doc) => (
          <button key={doc.folder} type="button" className="latex-doc-row" onClick={() => useWorkspace.getState().go({ view: LATEX_VIEW, path: doc.mainPath })}>
            <span className="text-14 font-medium">{doc.title}</span>
            <span className="text-12 text-faint">{doc.folder}</span>
          </button>
        ))
      )}
      <div>
        <Button tone="primary" icon="plus" onClick={() => void newDocument()}>
          New document
        </Button>
      </div>
    </div>
  );
}
