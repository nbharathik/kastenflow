import { LayoutThumb } from "@kasten-slides/react";
import { DeckEngine, builtInLayouts, builtInThemes, loadSlides, pageSizes } from "@kasten-slides/wasm";
import type { Deck } from "@kasten-slides/wasm";
import { memo, useEffect, useMemo, useState } from "react";

import { fileUrl } from "../../lib/vault/file-url";
import type { DeckInfo } from "../../lib/vault/types";
import { useWorkspace } from "../workspace/store";
import { DeckThumb } from "./DeckThumb";
import { useDecks } from "./store";
import { duplicateTemplate, readTemplate, renameTemplate } from "./templates";

/** What the sample decks are called on their title slide: the card says what a title looks like in the template. */
const SAMPLE_TITLE = "Your title";

/** The `value` of a template of the person's own is this and its path. */
export const MINE = "mine:";

/** The shapes of slide the New deck form offers, as the engine names them, with how each is said to a person. */
export interface Shape {
  name: string;
  w: number;
  h: number;
}

/** The page sizes by name: 16:9, 16:10, 4:3 and 1:1. */
export function slideShapes(): Shape[] {
  try {
    return pageSizes();
  } catch {
    return [
      { name: "16:9", w: 960, h: 540 },
      { name: "16:10", w: 960, h: 600 },
      { name: "4:3", w: 960, h: 720 },
      { name: "1:1", w: 720, h: 720 },
    ];
  }
}

/** The built-in templates drawn small: each as the deck it would make at this size, with its example slides. */
export function useTemplates(size: { w: number; h: number }): { names: string[]; decks: ReadonlyMap<string, Deck> } {
  const [state, setState] = useState<{ names: string[]; decks: ReadonlyMap<string, Deck> }>({ names: ["Light", "Dark", "Serif", "Lecture"], decks: new Map() });
  useEffect(() => {
    let live = true;
    void loadSlides().then(() => {
      if (!live) return;
      const names = builtInThemes();
      const decks = new Map<string, Deck>();
      for (const name of names) {
        try {
          const engine = DeckEngine.create(SAMPLE_TITLE, name, 1, { size, examples: true });
          decks.set(name, engine.deck);
          engine.dispose();
        } catch {
          // A template that cannot be drawn is still offered by its name.
        }
      }
      setState({ names, decks });
    });
    return () => {
      live = false;
    };
  }, [size.w, size.h]);
  return state;
}

const CARD = "rounded-xl border bg-canvas p-2 text-left shadow-card outline-none transition ease-standard hover:border-line-hover focus-visible:ring-2 focus-visible:ring-accent/60 motion-reduce:transition-none";

/**
 * The built-in templates to start a deck from, as cards with live thumbnails: the title slide large and two example slides beside
 * it, drawn by the same renderer as the editor, at the shape of slide chosen. One is picked at a time.
 */
const BuiltInTemplates = memo(function BuiltInTemplates({ value, onPick, size }: { value: string; onPick(name: string): void; size: { w: number; h: number } }) {
  const { names, decks } = useTemplates(size);
  const shown = useMemo(() => names.map((name) => ({ name, deck: decks.get(name) ?? null })), [names, decks]);
  return (
    <div role="radiogroup" aria-label="Template" className="grid w-full grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-3">
      {shown.map(({ name, deck }) => {
        const on = name === value;
        return (
          <button key={name} type="button" role="radio" aria-checked={on} aria-label={`${name} template`} onClick={() => onPick(name)} className={`${CARD} ${on ? "border-accent ring-2 ring-accent/30" : "border-line"}`}>
            <div className="grid grid-cols-[3fr_2fr] items-start gap-1.5 rounded-md bg-panel/70 p-1.5">
              <div className="overflow-hidden rounded border border-line shadow-card">
                <DeckThumb deck={deck} frame="deck" />
              </div>
              <div className="grid gap-1.5">
                <div className="overflow-hidden rounded border border-line">
                  <DeckThumb deck={deck} index={2} frame="deck" />
                </div>
                <div className="overflow-hidden rounded border border-line">
                  <DeckThumb deck={deck} index={3} frame="deck" />
                </div>
              </div>
            </div>
            <div className="truncate px-1 pb-0.5 pt-2 text-13 font-medium">{name}</div>
          </button>
        );
      })}
    </div>
  );
});

/** A template of the person's own, read to draw it: the deck its file is, or null while it is read (or when it cannot be). */
function useTemplateDeck(info: DeckInfo): Deck | null {
  const client = useWorkspace((s) => s.client);
  const [deck, setDeck] = useState<Deck | null>(null);
  useEffect(() => {
    let live = true;
    if (!client || info.problem) return;
    void readTemplate(client, info.path).then(
      (file) => live && setDeck(file.deck),
      () => live && setDeck(null),
    );
    return () => {
      live = false;
    };
  }, [client, info.path, info.modified, info.problem]);
  return deck;
}

const imageUrl = (path: string) => fileUrl(path) ?? undefined;

const ACTION = "rounded-md px-1.5 py-0.5 text-12 text-muted outline-none transition hover:bg-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/60 motion-reduce:transition-none";

/** One template of the person's own: drawn with its first slide and the layouts it brings, picked with a click, and kept up with the actions under it. */
function MyTemplate({ info, on, onPick, failed }: { info: DeckInfo; on: boolean; onPick(): void; failed(message: string): void }) {
  const deck = useTemplateDeck(info);
  const client = useWorkspace((s) => s.client);
  const [renaming, setRenaming] = useState<string | null>(null);
  // Beside the title slide: the layouts the person made, then the usual title and body, so a template says what it adds.
  const small = useMemo(() => {
    if (!deck) return [];
    let common: Set<string>;
    try {
      common = new Set(builtInLayouts());
    } catch {
      common = new Set();
    }
    const own = deck.theme.layouts.filter((layout) => !common.has(layout.name));
    const usual = deck.theme.layouts.filter((layout) => layout.name === "title-body");
    return [...own, ...usual].slice(0, 2);
  }, [deck]);

  const run = (job: Promise<unknown>) =>
    void job.then(
      () => useDecks.getState().load(),
      (error: unknown) => failed(error instanceof Error ? error.message : String(error)),
    );
  const rename = () => {
    const title = renaming;
    setRenaming(null);
    if (client && title !== null && title.trim() && title.trim() !== info.title) run(renameTemplate(client, info.path, title));
  };

  return (
    <div className={`${CARD} flex flex-col ${on ? "border-accent ring-2 ring-accent/30" : "border-line"}`} data-template={info.path}>
      <button type="button" role="radio" aria-checked={on} aria-label={`${info.title} template`} onClick={onPick} className="block w-full rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
        <div className="grid grid-cols-[3fr_2fr] items-start gap-1.5 rounded-md bg-panel/70 p-1.5">
          <div className="overflow-hidden rounded border border-line shadow-card">
            <DeckThumb deck={deck} frame="deck" />
          </div>
          <div className="grid gap-1.5">
            {deck
              ? small.map((layout) => (
                  <div key={layout.name} className="overflow-hidden rounded border border-line">
                    <LayoutThumb deck={deck} layout={layout} width={84} imageUrl={imageUrl} />
                  </div>
                ))
              : null}
          </div>
        </div>
        {renaming === null ? <div className="truncate px-1 pb-0.5 pt-2 text-13 font-medium">{info.title}</div> : null}
      </button>
      {renaming !== null ? (
        <input
          autoFocus
          aria-label={`Name of ${info.title}`}
          value={renaming}
          onChange={(event) => setRenaming(event.target.value)}
          onBlur={rename}
          onKeyDown={(event) => {
            if (event.key === "Enter") rename();
            else if (event.key === "Escape") setRenaming(null);
          }}
          className="mx-1 mb-0.5 mt-1.5 h-7 rounded-md border border-line bg-canvas px-2 text-13 outline-none focus:border-accent/60"
        />
      ) : null}
      <div className="mt-auto flex flex-wrap gap-0.5 px-0.5 pt-1" role="group" aria-label={`Actions for ${info.title}`}>
        <button type="button" className={ACTION} onClick={() => useWorkspace.getState().openPath(info.path)} title="Open the template as a deck, to change its slides and layouts">
          Edit
        </button>
        <button type="button" className={ACTION} onClick={() => setRenaming(info.title)}>
          Rename
        </button>
        <button type="button" className={ACTION} onClick={() => client && run(duplicateTemplate(client, info.path, `${info.title} copy`))}>
          Duplicate
        </button>
        <button type="button" className={ACTION} onClick={() => run(useWorkspace.getState().trash(info.path))} title="Move the template to the Trash; it can be put back">
          Trash
        </button>
      </div>
    </div>
  );
}

/**
 * Where a deck starts from: the person's own templates (saved from a deck, plain files in the vault) and the built-in ones, as cards
 * with live thumbnails. One is picked at a time; `value` is a built-in theme's name, or `mine:` and a template's path.
 */
export const TemplateGallery = memo(function TemplateGallery({ value, onPick, size }: { value: string; onPick(value: string): void; size: { w: number; h: number } }) {
  const mine = useDecks((s) => s.templates);
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <div className="flex w-full flex-col gap-4">
      <section aria-label="My templates" className="flex flex-col gap-2">
        <h3 className="text-12 font-medium text-muted">My templates</h3>
        {mine.length === 0 ? (
          <p className="text-13 text-muted">Open a deck and choose File, Save as template to keep its colours, fonts and layouts here, then start new decks from it.</p>
        ) : (
          <div role="radiogroup" aria-label="My templates" className="grid w-full grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-3">
            {mine.map((info) => (
              <MyTemplate key={info.path} info={info} on={value === `${MINE}${info.path}`} onPick={() => onPick(`${MINE}${info.path}`)} failed={setProblem} />
            ))}
          </div>
        )}
        {problem ? (
          <p role="alert" className="text-13 text-danger">
            {problem}
          </p>
        ) : null}
      </section>
      <section aria-label="Built-in templates" className="flex flex-col gap-2">
        <h3 className="text-12 font-medium text-muted">Built-in templates</h3>
        <BuiltInTemplates value={value} onPick={onPick} size={size} />
      </section>
    </div>
  );
});
