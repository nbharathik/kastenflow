import "./diagrams.css";

import { useEffect, useMemo, useState } from "react";

import { Button } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import { Modal } from "../../ui/Modal";
import { projectTitle } from "../boards/store";
import { useWorkspace } from "../workspace/store";
import { DiagramImage } from "./DiagramImage";
import { useDiagramEditor } from "./editor";
import { useDiagramHost } from "./host-store";
import { diagramChanged, useDiagrams } from "./store";

/** The words a person typed, narrowing the list by title. */
const matches = (title: string, words: string) => !words || title.toLowerCase().includes(words);

/** Choosing a diagram for a slide (or any host that wants a picture of one): the diagrams with their pictures, a search, and a way to make a new one. */
export function DiagramPicker() {
  const list = useDiagrams((s) => s.list);
  const loaded = useDiagrams((s) => s.loaded);
  const notes = useWorkspace((s) => s.notes);
  const installed = useDiagramEditor((s) => s.info?.installed ?? false);
  const [query, setQuery] = useState("");
  const [making, setMaking] = useState(false);
  const words = query.trim().toLowerCase();
  const shown = useMemo(() => list.filter((d) => matches(d.title, words)), [list, words]);

  useEffect(() => {
    void useDiagrams.getState().load();
    if (!useDiagramEditor.getState().info) void useDiagramEditor.getState().refresh();
  }, []);

  // A picture that is missing or out of date is drawn again while the list is open, so choosing it is quick.
  useEffect(() => {
    if (!installed) return;
    for (const d of list) if (d.preview !== "fresh" && !d.problem) useDiagramHost.getState().redraw(d.path);
  }, [list, installed]);

  const answer = (picked: { path: string; created: boolean } | null) => useDiagramHost.getState().answerPick(picked);

  const make = async () => {
    const client = useWorkspace.getState().client;
    if (!client || making) return;
    setMaking(true);
    try {
      const path = await client.createDiagram(query.trim() || "Untitled diagram", null);
      diagramChanged(path);
      answer({ path, created: true });
    } catch (err) {
      useWorkspace.getState().toast(err instanceof Error ? err.message : String(err));
      setMaking(false);
    }
  };

  return (
    <Modal label="Choose a diagram" onClose={() => answer(null)} className="w-[min(560px,94vw)] p-5">
      <h2 className="text-16 font-semibold">Choose a diagram</h2>
      <label className="mt-3 flex h-9 items-center gap-2 rounded-lg border border-line bg-canvas px-2.5 text-muted focus-within:border-accent/60">
        <Icon name="search" />
        <input autoFocus type="search" aria-label="Find a diagram" placeholder="Find a diagram" value={query} onChange={(e) => setQuery(e.target.value)} className="min-w-0 flex-1 bg-transparent text-13 text-ink outline-none" />
      </label>
      <ul aria-label="Diagrams" className="mt-3 flex max-h-[min(360px,50vh)] flex-col gap-1 overflow-auto">
        {shown.map((d) => (
          <li key={d.path}>
            <button type="button" aria-label={`Use ${d.title}`} disabled={Boolean(d.problem)} onClick={() => answer({ path: d.path, created: false })} className="flex w-full items-center gap-3 rounded-lg p-1.5 text-left hover:bg-hover focus-visible:bg-hover disabled:opacity-50">
              <span className="kasten-diagram-thumb w-20 shrink-0 border border-line">
                <DiagramImage path={d.path} alt="" fallback={<Icon name="diagram" className="size-5 text-muted" />} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-14 font-medium">{d.title}</span>
                <span className={`block truncate text-12 ${d.problem ? "text-danger" : "text-muted"}`}>{d.problem ? "Cannot be read" : d.project ? projectTitle(notes, d.project) : "Library"}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {loaded && list.length === 0 && <p className="mt-3 text-13 text-muted">No diagrams yet.</p>}
      {list.length > 0 && shown.length === 0 && <p className="mt-3 text-13 text-muted">No diagram matches.</p>}
      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="min-w-0 text-12 text-muted">{installed ? "A new diagram opens in the editor first." : "The editor is not installed: a new diagram stays empty until it is."}</p>
        <div className="flex shrink-0 gap-2">
          <Button onClick={() => answer(null)}>Cancel</Button>
          <Button icon="plus" tone="primary" disabled={making} onClick={() => void make()}>
            {words ? `New diagram “${query.trim()}”` : "New diagram"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
