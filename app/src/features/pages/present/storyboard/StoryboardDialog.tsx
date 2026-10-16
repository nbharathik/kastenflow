import { builtInThemes, loadSlides } from "@kasten-slides/wasm";
import { useEffect, useMemo, useState } from "react";

import { Button } from "../../../../ui/Button";
import { Modal } from "../../../../ui/Modal";
import { MINE, slideShapes } from "../../../slides/TemplateGallery";
import { useDecks } from "../../../slides/store";
import { titleOf } from "../../../workspace/names";
import { useWorkspace } from "../../../workspace/store";
import { projects } from "../../../workspace/tree";
import { type Generated, deckName, generateDeck } from "./generate";
import { type Row, edit, entriesOf, evidenceToText, leaveOut, merge, move, nameOf, rowsOf, split, tally } from "./model";
import { RowEditor } from "./RowEditor";
import { type StoryboardRequest, useStoryboard } from "./state";

const SELECT = "h-9 rounded-lg border border-line bg-canvas px-2 text-13 text-ink outline-none focus:border-accent/60";

/** What to tell about a deck that was made, when there is something to tell. */
function Report({ made, leftOut, onOpen }: { made: Generated; leftOut: string[]; onOpen(): void }) {
  return (
    <section aria-label="What was made" className="mt-3 flex flex-col gap-2">
      <p className="text-13">
        Made the deck with {made.slides === 1 ? "1 slide" : `${made.slides} slides`}, after its title slide.
      </p>
      {made.omitted.length > 0 && (
        <ul aria-label="Left out or not kept in step" className="flex flex-col gap-1 rounded-lg border border-line p-2 text-13">
          {made.omitted.map((item, i) => (
            <li key={`${item.entry}-${item.what}-${i}`}>{item.reason}</li>
          ))}
        </ul>
      )}
      {leftOut.length > 0 && <p className="text-13 text-muted">Left out in the storyboard: {leftOut.join(", ")}.</p>}
      <div className="flex justify-end">
        <Button tone="primary" onClick={onOpen}>
          Open the deck
        </Button>
      </div>
    </section>
  );
}

/**
 * The slides a page would make, before any exists: each is a row with its title, its point, its evidence and its notes, which can be
 * reordered, merged, split, left out and rewritten. Choosing a template and a shape and pressing Make the deck builds it in one go.
 */
export function StoryboardDialog({ request }: { request: StoryboardRequest }) {
  const { note } = request;
  const notes = useWorkspace((s) => s.notes);
  const [rows, setRows] = useState<Row[]>(() => rowsOf(request.entries));
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [title, setTitle] = useState(() => deckName(titleOf(note)));
  const [project, setProject] = useState(note.project ?? "");
  const [template, setTemplate] = useState("Light");
  const [shape, setShape] = useState("16:9");
  const [themes, setThemes] = useState<string[]>(["Light"]);
  const [own, setOwn] = useState<{ path: string; title: string }[]>([]);
  const [shapes, setShapes] = useState(() => [{ name: "16:9" }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [made, setMade] = useState<Generated | null>(null);
  const close = () => useStoryboard.getState().hide();

  useEffect(() => {
    let live = true;
    void loadSlides().then(() => {
      if (!live) return;
      setThemes(builtInThemes());
      setShapes(slideShapes());
    });
    const client = useWorkspace.getState().client;
    void client?.deckTemplates().then(
      (found) => live && setOwn(found.filter((deck) => !deck.problem).map((deck) => ({ path: deck.path, title: deck.title }))),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, []);

  const { slides, leftOut } = tally(rows);
  const names = useMemo(() => rows.map((row, i) => (row.leftOut ? nameOf(row.entry, i) : null)).filter((name): name is string => name !== null), [rows]);
  const isOwn = template.startsWith(MINE);
  const change = (next: Row[]) => {
    setRows(next);
    setNotice(null);
  };

  const make = async () => {
    const client = useWorkspace.getState().client;
    if (!client || busy || slides === 0) return;
    setBusy(true);
    setError(null);
    try {
      const done = await generateDeck(client, { title, project: project || null, entries: entriesOf(rows), template, shape: isOwn ? "" : shape });
      await useDecks.getState().load();
      if (done.omitted.length === 0 && names.length === 0) {
        open(done);
        useWorkspace.getState().toast(`Made “${deckName(title)}” from ${slides === 1 ? "1 slide" : `${slides} slides`}.`);
      } else {
        setMade(done);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  const open = (done: Generated) => {
    close();
    useWorkspace.getState().openPath(done.path);
  };

  return (
    <Modal label="Make slides from this page" onClose={close} className="flex max-h-[92vh] w-[min(920px,96vw)] flex-col p-5">
      <h2 className="text-16 font-semibold">Make slides from this page</h2>
      <p className="mt-1 text-13 text-muted">
        Each section is a slide, with its point, its evidence and the notes you would say. Change them here first; nothing is made until you press Make the deck, and the page is not changed.
      </p>
      {made ? (
        <Report made={made} leftOut={names} onOpen={() => open(made)} />
      ) : (
        <>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="flex min-w-[200px] flex-1 flex-col gap-1 text-12 text-muted">
              Name of the deck
              <input aria-label="Name of the deck" value={title} onChange={(event) => setTitle(event.target.value)} className="h-9 rounded-lg border border-line bg-canvas px-3 text-14 text-ink outline-none focus:border-accent/60" />
            </label>
            <label className="flex flex-col gap-1 text-12 text-muted">
              Project
              <select aria-label="Project" value={project} onChange={(event) => setProject(event.target.value)} className={SELECT}>
                <option value="">No project</option>
                {projects(notes).map((p) => (
                  <option key={p.path} value={p.project ?? ""}>
                    {p.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-12 text-muted">
              Template
              <select aria-label="Template" value={template} onChange={(event) => setTemplate(event.target.value)} className={SELECT}>
                <optgroup label="Built in">
                  {themes.map((theme) => (
                    <option key={theme} value={theme}>
                      {theme}
                    </option>
                  ))}
                </optgroup>
                {own.length > 0 && (
                  <optgroup label="Yours">
                    {own.map((deck) => (
                      <option key={deck.path} value={`${MINE}${deck.path}`}>
                        {deck.title}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-12 text-muted">
              Shape
              <select aria-label="Slide shape" value={isOwn ? "" : shape} disabled={isOwn} onChange={(event) => setShape(event.target.value)} className={SELECT} title={isOwn ? "A template of your own sets the shape" : undefined}>
                {isOwn && <option value="">The template's</option>}
                {shapes.map((choice) => (
                  <option key={choice.name} value={choice.name}>
                    {choice.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <ul aria-label="Slides" className="mt-3 flex min-h-0 flex-1 flex-col gap-2 overflow-auto pr-1">
            {rows.map((row, i) => (
              <RowEditor
                key={row.key}
                row={row}
                index={i}
                count={rows.length}
                text={drafts[row.key] ?? evidenceToText(row.entry.evidence)}
                onTitle={(value) => change(edit(rows, i, { title: value }))}
                onPoint={(value) => change(edit(rows, i, { point: value }))}
                onNotes={(value) => change(edit(rows, i, { notes: value }))}
                onLayout={(value) => change(edit(rows, i, { layout: value }))}
                onText={(value, blocks) => {
                  setDrafts((now) => ({ ...now, [row.key]: value }));
                  change(edit(rows, i, { evidence: blocks }));
                }}
                onMove={(by) => change(move(rows, i, i + by))}
                onMerge={() => {
                  setDrafts({});
                  change(merge(rows, i));
                }}
                onSplit={(at) => {
                  const next = split(rows, i, at);
                  if (next === rows) return setNotice("Put the cursor between two items of the evidence, then split: the rest becomes a slide of its own.");
                  setDrafts({});
                  change(next);
                }}
                onLeaveOut={(out) => change(leaveOut(rows, i, out))}
              />
            ))}
          </ul>
          {notice && (
            <p role="status" className="mt-2 text-13 text-muted">
              {notice}
            </p>
          )}
          {error && (
            <p role="alert" className="mt-2 text-13 text-danger">
              {error}
            </p>
          )}
          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="text-12 text-muted">
              {slides === 1 ? "1 slide" : `${slides} slides`} after the title slide{leftOut > 0 ? `, ${leftOut} left out` : ""}.
            </p>
            <div className="flex items-center gap-2">
              <Button onClick={close}>Cancel</Button>
              <Button tone="primary" disabled={slides === 0 || busy || !deckName(title)} onClick={() => void make()}>
                {busy ? "Making…" : "Make the deck"}
              </Button>
            </div>
          </div>
        </>
      )}
    </Modal>
  );
}

/** The dialog, when it is asked for. */
export function StoryboardHost() {
  const request = useStoryboard((s) => s.request);
  return request ? <StoryboardDialog request={request} /> : null;
}
