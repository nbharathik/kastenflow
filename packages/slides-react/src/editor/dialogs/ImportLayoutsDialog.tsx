import type { Deck } from "@kasten-slides/wasm";
import { type JSX, useEffect, useId, useMemo, useState } from "react";

import { useImageUrl } from "../filmstrip/SlideThumb.tsx";
import { LayoutThumb } from "../layouts/LayoutThumb.tsx";
import { stopAt, walkOptions } from "../panels/format/roving.ts";
import { TextButton } from "../ui/Button.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import { useEditor } from "../useEditor.ts";
import type { DeckInfo } from "../decks-host.ts";
import { importLayouts, previewDeck, readDeck } from "./import-layouts.ts";
import type { DialogProps } from "./types.ts";
import "../layouts/layouts.css";

type Source = { id: string; deck: Deck } | { id: string; problem: string };

/**
 * Brings layouts in from another deck of the host's: choose the deck, tick the layouts (drawn the way they will look here, in this deck's
 * colours and fonts), and they are added to this deck's layouts. Their text styles come along when this deck lacks them. Everything is one
 * step of undo; nothing of the other deck is changed.
 */
export function ImportLayoutsDialog({ session, onClose }: DialogProps): JSX.Element {
  const { deck } = useEditor(session);
  const decks = session.host.decks;
  const imageUrl = useImageUrl(session);
  const [list, setList] = useState<{ state: "loading" | "ready" | "none"; items: DeckInfo[] }>({ state: decks ? "loading" : "none", items: [] });
  const [chosen, setChosen] = useState("");
  const [source, setSource] = useState<Source | null>(null);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const selectId = useId();

  // The decks the host keeps, not counting this one.
  useEffect(() => {
    if (!decks) return;
    let live = true;
    decks.list().then(
      (found) => live && setList({ state: "ready", items: found.filter((info) => info.id !== session.host.deckPath) }),
      () => live && setList({ state: "ready", items: [] }),
    );
    return () => {
      live = false;
    };
  }, [decks, session]);

  // The deck chosen, read through the engine.
  useEffect(() => {
    setPicked(new Set());
    if (!decks || chosen === "") return void setSource(null);
    let live = true;
    decks.read(chosen).then(
      (text) => {
        if (!live) return;
        try {
          setSource({ id: chosen, deck: readDeck(text) });
        } catch {
          setSource({ id: chosen, problem: "That deck could not be read." });
        }
      },
      () => live && setSource({ id: chosen, problem: "That deck could not be read." }),
    );
    return () => {
      live = false;
    };
  }, [decks, chosen]);

  const from = source && "deck" in source && source.id === chosen ? source.deck : null;
  const layouts = from?.theme.layouts ?? [];
  const drawn = useMemo(() => (from ? previewDeck(deck, from) : null), [deck, from]);
  const here = new Set(deck.theme.layouts.map((layout) => layout.label.trim().toLowerCase()));
  const count = picked.size;

  const toggle = (name: string) =>
    setPicked((now) => {
      const next = new Set(now);
      if (!next.delete(name)) next.add(name);
      return next;
    });

  const add = () => {
    if (!from || count === 0) return;
    const added = importLayouts(session, from, [...picked]);
    if (!added) return;
    session.host.notify?.(added.length === 1 ? "Added 1 layout to this deck's layouts." : `Added ${added.length} layouts to this deck's layouts.`);
    onClose();
  };

  return (
    <Dialog
      title="Import layouts"
      width={720}
      onClose={onClose}
      footer={
        <>
          <TextButton onClick={onClose}>Cancel</TextButton>
          <TextButton primary disabled={count === 0} onClick={add}>
            {count === 0 ? "Import" : count === 1 ? "Import 1 layout" : `Import ${count} layouts`}
          </TextButton>
        </>
      }
    >
      {list.state === "none" ? <p className="ks-tm-empty">This editor has no other decks to bring layouts from.</p> : null}
      {list.state === "loading" ? <p className="ks-tm-empty">Looking for your decks…</p> : null}
      {list.state === "ready" && list.items.length === 0 ? <p className="ks-tm-empty">You have no other decks to bring layouts from.</p> : null}
      {list.items.length > 0 ? (
        <label className="ks-ls-field" htmlFor={selectId}>
          Bring layouts from
          <select id={selectId} className="ks-select" value={chosen} data-autofocus="" onChange={(event) => setChosen(event.target.value)}>
            <option value="">Choose a deck</option>
            {list.items.map((info) => (
              <option key={info.id} value={info.id}>
                {info.title} ({info.slides === 1 ? "1 slide" : `${info.slides} slides`})
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {chosen !== "" && source === null ? <p className="ks-tm-empty">Reading the deck…</p> : null}
      {source && "problem" in source && source.id === chosen ? (
        <p className="ks-ls-hint" role="alert">
          {source.problem}
        </p>
      ) : null}
      {from && drawn ? (
        <>
          <div className="ks-lm-foot">
            <span className="ks-ls-hint">{layouts.length === 1 ? "This deck has 1 layout." : `This deck has ${layouts.length} layouts.`} Tick the ones to bring in; they take on this deck's colours and fonts.</span>
            <span>
              <TextButton onClick={() => setPicked(new Set(layouts.map((layout) => layout.name)))}>Select all</TextButton>
              <TextButton disabled={count === 0} onClick={() => setPicked(new Set())}>
                Select none
              </TextButton>
            </span>
          </div>
          <div className="ks-tm-grid" role="listbox" aria-label="Layouts to bring in" aria-multiselectable="true" onKeyDown={(event) => walkOptions(event, 4)}>
            {layouts.map((layout, i) => {
              const on = picked.has(layout.name);
              return (
                <button
                  key={layout.name}
                  type="button"
                  role="option"
                  aria-selected={on}
                  tabIndex={stopAt(i, layouts.findIndex((other) => picked.has(other.name)))}
                  className={`ks-btn ks-tm-card${on ? " is-on" : ""}`}
                  data-layout={layout.name}
                  onClick={() => toggle(layout.name)}
                >
                  <LayoutThumb deck={drawn} layout={layout} width={150} imageUrl={imageUrl} />
                  <span className="ks-tm-name">{layout.label}</span>
                  <span className="ks-tm-meta">{here.has(layout.label.trim().toLowerCase()) ? "A layout with this name is here already; this one is added beside it" : layout.placeholders.length === 1 ? "1 slot" : `${layout.placeholders.length} slots`}</span>
                </button>
              );
            })}
          </div>
        </>
      ) : null}
    </Dialog>
  );
}
