import { type ChangeEvent, type FormEvent, type JSX, useCallback, useEffect, useRef, useState } from "react";

import type { DeckEntry, FolderApi, FolderInfo } from "./api.ts";
import { importDeck } from "./import-deck.ts";
import { go, linkTo } from "./route.ts";
import "./home.css";

const when = (millis: number): string => (millis > 0 ? new Date(millis).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "");

/** The decks in the folder, with a way to make one and to move one to the trash. */
export function Home({ api, info }: { api: FolderApi; info: FolderInfo }): JSX.Element {
  const [decks, setDecks] = useState<DeckEntry[] | null>(null);
  const [title, setTitle] = useState("");
  const [theme, setTheme] = useState(info.themes[0] ?? "Light");
  const [problem, setProblem] = useState<string | null>(null);

  const refresh = useCallback(() => {
    api
      .decks()
      .then(setDecks)
      .catch((e: unknown) => setProblem(e instanceof Error ? e.message : String(e)));
  }, [api]);

  useEffect(() => {
    refresh();
    return api.events((event) => event.kind === "deck" && refresh());
  }, [api, refresh]);

  const create = (event: FormEvent) => {
    event.preventDefault();
    api
      .create(title, theme)
      .then((deck) => go(deck.path))
      .catch((e: unknown) => setProblem(e instanceof Error ? e.message : String(e)));
  };

  const chooser = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const bringIn = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || importing) return;
    setImporting(true);
    importDeck(api, file, theme)
      .then((made) => go(made.deck.path))
      .catch((e: unknown) => setProblem(e instanceof Error ? e.message : String(e)))
      .finally(() => setImporting(false));
  };

  const trash = (deck: DeckEntry) => {
    api
      .trash(deck.path)
      .then(refresh)
      .catch((e: unknown) => setProblem(e instanceof Error ? e.message : String(e)));
  };

  return (
    <main className="home">
      <header>
        <h1>KastenFlow Slides</h1>
        <p>
          The decks in <strong>{info.name}</strong>
        </p>
      </header>
      <form className="home-new" onSubmit={create}>
        <input aria-label="Title of the new deck" placeholder="Title of a new deck" value={title} onChange={(e) => setTitle(e.target.value)} />
        <select aria-label="Theme" value={theme} onChange={(e) => setTheme(e.target.value)}>
          {info.themes.map((name) => (
            <option key={name}>{name}</option>
          ))}
        </select>
        <button type="submit">New deck</button>
        <button type="button" disabled={importing} onClick={() => chooser.current?.click()}>
          {importing ? "Importing…" : "Import PowerPoint…"}
        </button>
        <input ref={chooser} type="file" accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation" aria-label="PowerPoint file" hidden onChange={bringIn} />
      </form>
      {problem ? (
        <p className="home-problem" role="alert">
          {problem}
        </p>
      ) : null}
      {decks === null ? <p className="home-empty">Loading…</p> : null}
      {decks?.length === 0 ? <p className="home-empty">There are no decks in this folder yet. Make one above.</p> : null}
      <ul className="home-decks">
        {decks?.map((deck) => (
          <li key={deck.path}>
            {deck.problem ? (
              <span className="home-broken" title={deck.problem}>
                {deck.title} <em>cannot be opened: {deck.problem}</em>
              </span>
            ) : (
              <a href={linkTo(deck.path)}>
                <strong>{deck.title}</strong>
                <span>
                  {deck.slides} {deck.slides === 1 ? "slide" : "slides"} · {when(deck.modified)}
                </span>
              </a>
            )}
            <button type="button" onClick={() => trash(deck)} title="Moves the file to .trash/ in the folder">
              Trash
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}
