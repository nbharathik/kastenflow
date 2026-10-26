// The LaTeX plugin's view, loaded the first time one is opened: the list of
// documents, or the document the tab names (a file inside a document's folder).
// The editor's code, the PDF library and the styles all come with this chunk.

import { useEffect, useState } from "react";

import { useWorkspace } from "../../features/workspace/store";
import { Button } from "../../ui/Button";
import type { PluginViewProps } from "../types";
import { latexBackend, type LatexBackend, sentence } from "./backend";
import { DocList } from "./DocList";
import { folderOf, rememberDocs } from "./docs-cache";
import { LATEX_VIEW } from "./manifest";
import type { LatexDoc } from "./types";
import { Workspace } from "./Workspace";
import "./latex.css";

export default function LatexView({ place }: PluginViewProps) {
  const backend = latexBackend();
  if (!backend) {
    return (
      <div className="latex-note">
        <p className="m-0">LaTeX documents need the KastenFlow desktop app.</p>
      </div>
    );
  }
  return place.path ? <OpenFile backend={backend} path={place.path} /> : <DocList backend={backend} />;
}

/** Finds the document the file belongs to, then opens it. */
function OpenFile({ backend, path }: { backend: LatexBackend; path: string }) {
  const [docs, setDocs] = useState<LatexDoc[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    let stale = false;
    // The list on screen stays while it is read again, so moving between a document's files keeps the editor.
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
  }, [backend, path]);

  if (problem) {
    return (
      <div className="latex-note" role="alert">
        <p className="m-0">{problem}</p>
      </div>
    );
  }
  if (!docs) {
    return (
      <div className="latex-note" aria-busy="true">
        <p className="m-0">Opening the document…</p>
      </div>
    );
  }
  const folder = folderOf(
    path,
    docs.map((d) => d.folder),
  );
  const doc = docs.find((d) => d.folder === folder);
  if (!doc) {
    return (
      <div className="latex-note">
        <p className="m-0">This file is not part of a LaTeX document. A document is a folder with a main .tex file that starts with \documentclass.</p>
        <Button onClick={() => useWorkspace.getState().go({ view: LATEX_VIEW })}>See the LaTeX documents</Button>
      </div>
    );
  }
  return <Workspace backend={backend} doc={doc} file={path} />;
}
