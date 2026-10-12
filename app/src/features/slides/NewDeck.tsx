import { DeckEngine, loadSlides } from "@kasten-slides/wasm";
import { useEffect, useState } from "react";

import { useWorkspace } from "../workspace/store";
import { projects } from "../workspace/tree";
import { ImportButton } from "./ImportButton";
import { useDecks } from "./store";
import { MINE, TemplateGallery, slideShapes } from "./TemplateGallery";
import { deckFromTemplate } from "./templates";

/** Title, project, template and shape for a new deck; it opens once made. */
export function NewDeck() {
  const notes = useWorkspace((s) => s.notes);
  const [title, setTitle] = useState("");
  const [project, setProject] = useState(() => useDecks.getState().draftProject ?? "");
  const [template, setTemplate] = useState("Light");
  const [shape, setShape] = useState("16:9");
  const [examples, setExamples] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const close = () => useDecks.setState({ creating: false, draftProject: null });
  const shapes = slideShapes();
  const size = shapes.find((s) => s.name === shape) ?? shapes[0]!;
  // A template of the person's own has a shape of its own, which is the deck's: the shapes on offer are for the built-in ones.
  const own = template.startsWith(MINE);
  useEffect(() => void useDecks.getState().load(), []);

  const create = async () => {
    const client = useWorkspace.getState().client;
    const name = title.trim();
    if (!client || !name || busy) return;
    setBusy(true);
    try {
      await loadSlides();
      let text: string;
      if (own) {
        text = await deckFromTemplate(client, template.slice(MINE.length), name, examples);
      } else {
        const engine = DeckEngine.create(name, template, undefined, { size: { w: size.w, h: size.h }, examples });
        text = engine.save();
        engine.dispose();
      }
      const path = await client.createDeck(name, project || null, text);
      await useDecks.getState().load();
      close();
      useWorkspace.getState().openPath(path);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      aria-label="New deck"
      onSubmit={(e) => {
        e.preventDefault();
        void create();
      }}
      className="mt-6 flex flex-col gap-4 rounded-xl border border-line bg-canvas p-4 shadow-card"
    >
      <div className="flex flex-wrap items-center gap-2">
        <input
          autoFocus
          aria-label="Title"
          placeholder="Name it, e.g. Quarterly review"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && close()}
          className="h-9 min-w-[200px] flex-1 rounded-lg border border-line bg-canvas px-3 text-14 outline-none focus:border-accent/60 focus:ring-[3px] focus:ring-accent/15"
        />
        <select aria-label="Project" value={project} onChange={(e) => setProject(e.target.value)} className="h-9 rounded-lg border border-line bg-canvas px-2 text-13 outline-none focus:border-accent/60">
          <option value="">No project</option>
          {projects(notes).map((p) => (
            <option key={p.path} value={p.project ?? ""}>
              {p.title}
            </option>
          ))}
        </select>
      </div>

      <section aria-label="Template" className="flex flex-col gap-2">
        <h2 className="text-12 font-medium text-muted">Template</h2>
        <TemplateGallery value={template} onPick={setTemplate} size={size} />
      </section>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        {own ? (
          <p className="text-13 text-muted">The slides take the shape of the template.</p>
        ) : (
          <div role="radiogroup" aria-label="Slide shape" className="flex items-center gap-1">
            <span className="mr-1 text-12 font-medium text-muted">Shape</span>
            {shapes.map((choice) => (
              <button
                key={choice.name}
                type="button"
                role="radio"
                aria-checked={choice.name === shape}
                onClick={() => setShape(choice.name)}
                className={`h-8 rounded-lg border px-2.5 text-13 outline-none transition focus-visible:ring-2 focus-visible:ring-accent/60 ${choice.name === shape ? "border-accent bg-accent/10 text-ink" : "border-line text-muted hover:bg-hover hover:text-ink"}`}
              >
                {choice.name}
              </button>
            ))}
          </div>
        )}
        <label className="flex items-center gap-2 text-13">
          <input type="checkbox" checked={examples} onChange={(e) => setExamples(e.target.checked)} className="size-4 accent-[var(--color-accent)]" />
          Include example slides
        </label>
        <span className="flex-1" />
        <ImportButton project={project || null} title={title} onFailed={setError} className="h-9 rounded-lg border border-line bg-canvas px-3 text-13 text-ink transition hover:bg-hover disabled:opacity-50">
          Import PowerPoint…
        </ImportButton>
        <button type="button" onClick={close} className="h-9 rounded-lg px-3 text-13 text-muted hover:bg-hover hover:text-ink">
          Cancel
        </button>
        <button type="submit" disabled={!title.trim() || busy} className="h-9 rounded-lg bg-accent px-4 text-13 font-medium text-on-accent shadow-card transition hover:brightness-110 disabled:opacity-50">
          Create
        </button>
      </div>
      {error && (
        <p role="alert" className="w-full text-13 text-danger">
          {error}
        </p>
      )}
    </form>
  );
}
