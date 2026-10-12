import type { JSX } from "react";
import { useEffect, useId, useState } from "react";

import { isPageLink, makePageLink, parsePageLink } from "../../pages/links.ts";
import { textFormat } from "../commands/index.ts";
import { linkFromInput } from "../../text/links.ts";
import type { HostPage } from "../host.ts";
import { TextButton } from "../ui/Button.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import { useEditor } from "../useEditor.ts";
import { stopAt, walkOptions } from "../panels/format/roving.ts";
import { slideTitle } from "./slide-title.ts";
import type { DialogProps } from "./types.ts";
import "./dialogs.css";

const SLIDE = "slide:";

/**
 * A web address for the words selected in the open text box or, with none
 * open, for all the words of the selected boxes; or a link to one of the
 * deck's slides.
 */
export function LinkDialog({ session, ui, onClose }: DialogProps): JSX.Element {
  const { deck, selection } = useEditor(session);
  const now = textFormat.currentFormat({ session, ui }).link;
  const [address, setAddress] = useState(typeof now === "string" && !now.startsWith(SLIDE) && !isPageLink(now) ? now : "");
  const [slide, setSlide] = useState<string | null>(typeof now === "string" && now.startsWith(SLIDE) ? now.slice(SLIDE.length) : null);
  // A page of the host, where the host has pages: what the words open at the side while editing and while presenting.
  const [page, setPage] = useState<string | null>(typeof now === "string" ? (parsePageLink(now)?.path ?? null) : null);
  const [pages, setPages] = useState<HostPage[] | null>(null);
  const [find, setFind] = useState("");
  const [bad, setBad] = useState(false);
  const hasWords = ui.state.text !== null || selection.length > 0;
  const heading = useId();
  const pagesHeading = useId();
  const { host } = session;

  useEffect(() => {
    let live = true;
    void host.listPages?.().then(
      (found) => live && setPages(found),
      () => live && setPages([]),
    );
    return () => {
      live = false;
    };
  }, [host]);
  const shownPages = (pages ?? []).filter((entry) => entry.title.toLowerCase().includes(find.trim().toLowerCase())).slice(0, 40);

  const set = (href: string | null) => {
    const editor = ui.state.text;
    if (editor) editor.setLink(href);
    else session.text.setRun("link", href);
    onClose();
  };

  const apply = () => {
    const href = page !== null ? makePageLink(page) : slide !== null ? `${SLIDE}${slide}` : linkFromInput(address);
    if (href === null) return setBad(true);
    set(href);
  };

  return (
    <Dialog
      title="Link"
      width={440}
      onClose={onClose}
      footer={
        <>
          <TextButton className="ks-dg-left" disabled={!hasWords || now === null} onClick={() => set(null)}>
            Remove link
          </TextButton>
          <TextButton onClick={onClose}>Cancel</TextButton>
          <TextButton primary disabled={!hasWords || (slide === null && page === null && address.trim() === "")} onClick={apply}>
            Apply
          </TextButton>
        </>
      }
    >
      {/* The words in an open text box stay selected while this is used. */}
      <div className="ks-dg-form" data-ks-keep-focus="">
        <label className="ks-dg-field">
          <span className="ks-dg-label">Web address</span>
          <input
            className="ks-input"
            aria-label="Web address"
            aria-invalid={bad || undefined}
            placeholder={now === "mixed" ? "Mixed" : "https://example.com"}
            value={address}
            onChange={(event) => {
              setAddress(event.target.value);
              setSlide(null);
              setPage(null);
              setBad(false);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                event.preventDefault();
                apply();
              }
            }}
          />
        </label>
        {bad ? (
          <p className="ks-sp-hint is-error" role="alert">
            Use a web address such as https://example.com, or a mail or phone link.
          </p>
        ) : null}
        {!hasWords ? <p className="ks-sp-hint">Select some text or a box first.</p> : null}
        <div className="ks-dg-field">
          <span className="ks-dg-label" id={heading}>
            Link to a slide
          </span>
          <ul className="ks-dg-slides" role="listbox" aria-labelledby={heading} onKeyDown={(event) => walkOptions(event)}>
            {deck.slides.map((s, i) => (
              <li key={s.id} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={slide === s.id}
                  tabIndex={stopAt(i, deck.slides.findIndex((x) => x.id === slide))}
                  className={`ks-btn ks-dg-slide${slide === s.id ? " is-on" : ""}`}
                  onClick={() => {
                    setSlide(slide === s.id ? null : s.id);
                    setPage(null);
                    setBad(false);
                  }}
                >
                  <span className="ks-dg-slide-no">{i + 1}</span>
                  <span className="ks-dg-slide-title">{slideTitle(s)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
        {host.listPages ? (
          <div className="ks-dg-field">
            <span className="ks-dg-label" id={pagesHeading}>
              Link to a page
            </span>
            <input className="ks-input" aria-label="Find a page" placeholder="Find a page" value={find} onChange={(event) => setFind(event.target.value)} />
            <ul className="ks-dg-slides" role="listbox" aria-labelledby={pagesHeading} onKeyDown={(event) => walkOptions(event)}>
              {shownPages.map((entry, i) => (
                <li key={entry.path} role="presentation">
                  <button
                    type="button"
                    role="option"
                    aria-selected={page === entry.path}
                    tabIndex={stopAt(i, shownPages.findIndex((x) => x.path === page))}
                    className={`ks-btn ks-dg-slide${page === entry.path ? " is-on" : ""}`}
                    onClick={() => {
                      setPage(page === entry.path ? null : entry.path);
                      setSlide(null);
                      setBad(false);
                    }}
                  >
                    <span className="ks-dg-slide-no">{entry.icon ?? ""}</span>
                    <span className="ks-dg-slide-title">{entry.title}</span>
                  </button>
                </li>
              ))}
              {pages !== null && shownPages.length === 0 ? <li className="ks-sp-hint">No page matches.</li> : null}
            </ul>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
