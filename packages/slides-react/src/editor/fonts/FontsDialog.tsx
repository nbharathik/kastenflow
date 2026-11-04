import type { DeckFont } from "@kasten-slides/wasm";
import { type JSX, useEffect, useId, useMemo, useState } from "react";

import { setFont } from "../commands/format.ts";
import type { DialogProps } from "../dialogs/types.ts";
import { TextButton } from "../ui/Button.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import { BUNDLED_FAMILIES, familiesOf } from "./font-css.ts";
import { setDeckFonts } from "./deck-ops.ts";
import { importFontFile } from "./fonts-file.ts";
import "../dialogs/dialogs.css";
import "./fonts.css";

/** Words to see a font in: all the letters of a short line and some figures. */
export const PREVIEW = "Aa Bb Cc 0123 The quick brown fox";

interface Row {
  family: string;
  where: "deck" | "bundled" | "system";
}

/** The rows the browser lists, those matching `query` only: the deck's fonts first, then the bundled ones, then the computer's. */
export function rowsOf(deck: readonly DeckFont[], system: readonly string[], query: string): Row[] {
  const seen = new Set<string>();
  const rows: Row[] = [];
  const add = (family: string, where: Row["where"]) => {
    if (seen.has(family.toLowerCase())) return;
    seen.add(family.toLowerCase());
    rows.push({ family, where });
  };
  for (const family of familiesOf(deck)) add(family, "deck");
  for (const family of BUNDLED_FAMILIES) add(family, "bundled");
  for (const family of system) add(family, "system");
  const wanted = query.trim().toLowerCase();
  return wanted === "" ? rows : rows.filter((row) => row.family.toLowerCase().includes(wanted));
}

const WHERE: Record<Row["where"], string> = { deck: "In this deck", bundled: "Comes with KastenFlow", system: "On this computer" };

/** The fonts there are, each shown in itself; add a font file to the deck, allow it in exports, or use a font for the words selected. */
export function FontsDialog({ session, ui, onClose }: DialogProps): JSX.Element {
  const uid = useId();
  const [query, setQuery] = useState("");
  const [system, setSystem] = useState<string[] | null>(null);
  const [fonts, setFonts] = useState<readonly DeckFont[]>(session.deck.present.fonts ?? []);
  useEffect(() => session.subscribe(() => setFonts(session.deck.present.fonts ?? [])), [session]);
  useEffect(() => {
    let live = true;
    const ask = session.host.systemFonts;
    if (!ask) {
      setSystem([]);
      return;
    }
    ask.call(session.host).then(
      (list) => live && setSystem([...list].sort((a, b) => a.localeCompare(b))),
      () => live && setSystem([]),
    );
    return () => {
      live = false;
    };
  }, [session]);

  const rows = useMemo(() => rowsOf(fonts, system ?? [], query), [fonts, system, query]);
  const add = async () => {
    const entry = await importFontFile(session);
    if (entry) setDeckFonts(session, [...fonts, entry]);
  };
  const change = (index: number, patch: Partial<DeckFont>) => setDeckFonts(session, fonts.map((font, i) => (i === index ? { ...font, ...patch } : font)));

  return (
    <Dialog
      title="Fonts"
      width={560}
      onClose={onClose}
      footer={
        <>
          <TextButton onClick={() => void add()}>Add a font file…</TextButton>
          <TextButton primary onClick={onClose}>
            Done
          </TextButton>
        </>
      }
    >
      <div className="ks-dg-form">
        <div className="ks-dg-field">
          <label className="ks-dg-label" htmlFor={`${uid}-q`}>
            Find a font
          </label>
          <input id={`${uid}-q`} className="ks-input" autoComplete="off" spellCheck={false} data-autofocus="" value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
        <ul className="ks-fonts-list" aria-label="Fonts">
          {rows.map((row) => (
            <li key={`${row.where}:${row.family}`} className="ks-fonts-row">
              <span className="ks-fonts-name">
                {row.family}
                <span className="ks-fonts-where">{WHERE[row.where]}</span>
              </span>
              <span className="ks-fonts-preview" style={{ fontFamily: `"${row.family.replace(/["\\]/g, "")}", sans-serif` }} aria-hidden="true">
                {PREVIEW}
              </span>
              <TextButton onClick={() => setFont({ session, ui }, row.family)}>Use</TextButton>
            </li>
          ))}
          {rows.length === 0 ? <li className="ks-dg-note">{system === null ? "Looking for the fonts on this computer…" : "No font has that name."}</li> : null}
        </ul>
        {fonts.length > 0 ? (
          <div className="ks-dg-field">
            <span className="ks-dg-label">Files this deck carries</span>
            <ul className="ks-fonts-files">
              {fonts.map((font, index) => (
                <li key={font.src} className="ks-fonts-file">
                  <span className="ks-fonts-name">
                    {font.family}
                    <span className="ks-fonts-where">
                      {font.bold ? "Bold" : "Regular"}
                      {font.italic ? ", italic" : ""}
                    </span>
                  </span>
                  <label className="ks-fonts-allow">
                    <input type="checkbox" checked={font.embeddable === true} onChange={(event) => change(index, { embeddable: event.target.checked })} /> Allow in exported files
                  </label>
                  <TextButton onClick={() => setDeckFonts(session, fonts.filter((_, i) => i !== index))}>Remove</TextButton>
                </li>
              ))}
            </ul>
            <p className="ks-dg-note">A font goes into an exported page only when its licence allows it and you have ticked the box. Removing a font takes it out of the deck, not off your computer.</p>
          </div>
        ) : (
          <p className="ks-dg-note">A font file you add is kept with the deck, so it looks the same on a computer that does not have the font.</p>
        )}
      </div>
    </Dialog>
  );
}
