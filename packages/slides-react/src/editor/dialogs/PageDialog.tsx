import { type JSX, useEffect, useId, useRef, useState } from "react";

import { type PageMode, type SectionChoice, insertPage, sectionsOf } from "../../pages/insert.ts";
import type { HostPage } from "../host.ts";
import { TextButton } from "../ui/Button.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import { Segmented, Toggle } from "../ui/Fields.tsx";
import type { DialogProps } from "./types.ts";
import "./dialogs.css";
import "./insert.css";
import "./page-insert.css";

type Way = "embed" | "contents" | "section" | "link";

const WAYS: { way: Way; label: string; says: string }[] = [
  { way: "embed", label: "Embed the page", says: "A live view of the page, read-only. It keeps up with the page, and shows its words when exported." },
  { way: "contents", label: "Insert its contents", says: "The words, lists, pictures and tables of the page, as text on the slide (or on slides of their own)." },
  { way: "section", label: "Insert a section", says: "One heading of the page and what is under it, which can be made again from the page later." },
  { way: "link", label: "Link to the page", says: "Words or a card that open the page, at the side while you edit and while you present." },
];

/**
 * Insert → Page…: the host lets the person choose a page, then the four ways it can go on the slide: embedded (live, read-only),
 * its contents as slide text or as slides, one section of it, or a link to it.
 */
export function PageDialog({ session, onClose }: DialogProps): JSX.Element | null {
  const { host } = session;
  const [page, setPage] = useState<HostPage | null>(null);
  const [way, setWay] = useState<Way>("embed");
  const [sections, setSections] = useState<SectionChoice[]>([]);
  const [section, setSection] = useState("");
  const [sync, setSync] = useState(true);
  const [asSlides, setAsSlides] = useState(false);
  const [card, setCard] = useState<"words" | "card">("words");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const uid = useId();
  const closing = useRef(onClose);
  closing.current = onClose;

  // The host asks the person which page; closing its picker closes this too. An answer that comes after this has been
  // closed or opened again (the first of two asks, as a development build makes) is not heard.
  const chosen = useRef(false);
  chosen.current = page !== null;
  const choose = async (live: () => boolean = () => true): Promise<void> => {
    try {
      const picked = await host.pickPage?.();
      if (!live()) return;
      if (picked) setPage(picked);
      else if (!chosen.current) closing.current();
    } catch (error) {
      if (!live()) return;
      host.notify?.(error instanceof Error ? error.message : String(error));
      if (!chosen.current) closing.current();
    }
  };
  useEffect(() => {
    let live = true;
    void choose(() => live);
    return () => {
      live = false;
    };
    // Once, when the dialog opens.
  }, []);

  // The headings of the page chosen, for a section.
  useEffect(() => {
    if (!page) return;
    let current = true;
    setSection("");
    void sectionsOf(host, page.path).then(
      (found) => current && (setSections(found), setSection(found[0]?.heading ?? "")),
      () => current && setSections([]),
    );
    return () => {
      current = false;
    };
  }, [host, page]);

  if (!page) return null;
  const needsSection = way === "section";
  const impossible = needsSection && section === "";

  const insert = async (): Promise<void> => {
    if (busy || impossible) return;
    setBusy(true);
    setProblem(null);
    try {
      const mode: PageMode = way === "contents" && asSlides ? "slides" : way;
      await insertPage(session, {
        mode,
        page,
        ...(way === "section" || (way === "link" && section !== "") ? { section } : {}),
        ...(way === "section" || way === "contents" ? { sync } : {}),
        ...(way === "link" ? { card: card === "card" } : {}),
      });
      onClose();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
      setBusy(false);
    }
  };

  return (
    <Dialog
      title="Insert a page"
      width={520}
      onClose={onClose}
      footer={
        <>
          <TextButton className="ks-dg-left" onClick={() => void choose()}>
            Choose another page…
          </TextButton>
          <TextButton onClick={onClose}>Cancel</TextButton>
          <TextButton primary disabled={busy || impossible} onClick={() => void insert()}>
            Insert
          </TextButton>
        </>
      }
    >
      <div className="ks-dg-form">
        <p className="ks-pg-page">
          <span className="ks-pg-icon" aria-hidden="true">
            {page.icon ?? "\u{1F4C4}"}
          </span>
          <span className="ks-pg-title">{page.title}</span>
          {page.project ? <span className="ks-pg-project">{page.project}</span> : null}
        </p>
        <div role="radiogroup" aria-label="How the page goes on the slide" className="ks-pg-ways">
          {WAYS.map((entry) => (
            <label key={entry.way} className={`ks-pg-way${way === entry.way ? " is-on" : ""}`}>
              <input type="radio" name={`${uid}-way`} value={entry.way} checked={way === entry.way} onChange={() => setWay(entry.way)} data-autofocus={entry.way === "embed" ? "" : undefined} />
              <span className="ks-pg-way-text">
                <span className="ks-pg-way-name">{entry.label}</span>
                <span className="ks-pg-way-says">{entry.says}</span>
              </span>
            </label>
          ))}
        </div>

        {way === "contents" ? <Toggle label="One slide for each heading" on={asSlides} onChange={setAsSlides} /> : null}
        {way === "section" || way === "link" ? (
          <div className="ks-dg-field">
            <label className="ks-dg-label" htmlFor={`${uid}-section`}>
              {way === "link" ? "Go to a heading (optional)" : "Section"}
            </label>
            <select id={`${uid}-section`} className="ks-input" value={section} onChange={(event) => setSection(event.target.value)}>
              {way === "link" ? <option value="">The whole page</option> : null}
              {sections.map((entry) => (
                <option key={`${entry.level}-${entry.heading}`} value={entry.heading}>
                  {`${"  ".repeat(Math.max(entry.level - 1, 0))}${entry.title}`}
                </option>
              ))}
            </select>
            {way === "section" && sections.length === 0 ? <p className="ks-dg-note">This page has no headings to take a section from.</p> : null}
          </div>
        ) : null}
        {way === "section" || way === "contents" ? <Toggle label="Flag it when the page changes, so it can be updated" on={sync} onChange={setSync} /> : null}
        {way === "link" ? (
          <div className="ks-dg-field">
            <span className="ks-dg-label">Look</span>
            <Segmented<"words" | "card">
              label="Look of the link"
              value={card}
              options={[
                { value: "words", label: "Words", title: "The page's name as a link in a text box" },
                { value: "card", label: "Card", title: "The page's name on a card that opens it" },
              ]}
              onPick={setCard}
            />
          </div>
        ) : null}
        {problem ? (
          <p className="ks-dg-note is-error" role="alert">
            {problem}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
