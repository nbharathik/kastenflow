import { type JSX, useEffect, useRef, useState } from "react";

import { linkFromInput, safeLink } from "../../text/links.ts";
import type { TextEditorHandle } from "../../text/index.ts";
import { swallowKeys } from "../menus/focus.ts";
import { keepFocusExceptFields } from "../toolbar/ColorButton.tsx";
import { Popover, type Anchor } from "../ui/Popover.tsx";
import "./text-ui.css";

export interface LinkPopoverProps {
  handle: TextEditorHandle;
  /** `edit` asks for the address; `card` shows the one the caret is in, with what can be done with it. */
  mode: "edit" | "card";
  /** The address of the link the selection is in, or null. */
  href: string | null;
  /** Where the caret is, for the card to open beside. */
  anchor: Anchor;
  /** Whether words are selected: without them, and without a link, a link needs words of its own. */
  hasSelection: boolean;
  onClose(): void;
  /** The card asks for the address to be changed. */
  onEdit(): void;
}

/** A link that a click can follow: a web address, mail or phone, never a link to a slide or something the page must not open. */
const followable = (href: string): boolean => /^(https?:|mailto:|tel:)/i.test(href) && safeLink(href) !== null;

/**
 * The link card of Google Slides, next to the caret and not over the slide: Mod-K opens it to type an address (and the
 * words, when none are selected), and a caret inside a link shows the address with Open, Change and Remove. Enter applies,
 * Escape closes, and the words keep the caret.
 */
export function LinkPopover({ handle, mode, href, anchor, hasSelection, onClose, onEdit }: LinkPopoverProps): JSX.Element {
  const [address, setAddress] = useState(href ?? "");
  const [words, setWords] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const wordsField = useRef<HTMLInputElement>(null);
  // A link needs words of its own where there are none to put it on.
  const needsWords = href === null && !hasSelection;

  useEffect(() => {
    if (mode === "edit") (needsWords ? wordsField.current : field.current)?.focus({ preventScroll: true });
  }, [mode, needsWords]);

  const apply = (): void => {
    const target = linkFromInput(address);
    if (target === null) {
      setProblem(address.trim() === "" ? "Type an address." : "That is not a web address a slide can follow.");
      return;
    }
    if (needsWords) {
      if (words.trim() === "") {
        setProblem("Type the words the link is on.");
        return;
      }
      handle.insertLink(words, target);
    } else handle.setLink(target);
    onClose();
    handle.focus();
  };

  return (
    <Popover anchor={anchor} onClose={onClose} label={mode === "edit" ? "Link" : "Link address"}>
      <div className="ks-tui ks-tui-link" data-ks-keep-focus="" onMouseDown={keepFocusExceptFields} onKeyDown={swallowKeys}>
        {mode === "card" && href !== null ? (
          <>
            <div className="ks-tui-link-address">
              <span className="ks-tui-link-label">Link</span>
              {followable(href) ? (
                <a href={href} target="_blank" rel="noopener noreferrer" className="ks-tui-link-open">
                  {href}
                </a>
              ) : (
                <span>{href}</span>
              )}
            </div>
            <div className="ks-tui-link-actions">
              {followable(href) ? (
                <a className="ks-btn ks-text-btn" href={href} target="_blank" rel="noopener noreferrer" onClick={onClose}>
                  Open
                </a>
              ) : null}
              <button type="button" className="ks-btn ks-text-btn" onClick={onEdit}>
                Change
              </button>
              <button
                type="button"
                className="ks-btn ks-text-btn"
                onClick={() => {
                  handle.setLink(null);
                  onClose();
                  handle.focus();
                }}
              >
                Remove
              </button>
            </div>
          </>
        ) : (
          <>
            {needsWords ? (
              <label className="ks-tui-link-address">
                <span className="ks-tui-link-label">Text</span>
                <input ref={wordsField} className="ks-input" value={words} aria-label="Link text" onChange={(event) => setWords(event.target.value)} onKeyDown={(event) => event.key === "Enter" && apply()} />
              </label>
            ) : null}
            <label className="ks-tui-link-address">
              <span className="ks-tui-link-label">Link</span>
              <input
                ref={field}
                className="ks-input"
                value={address}
                placeholder="Paste or type a web address"
                aria-label="Link address"
                aria-invalid={problem !== null}
                onChange={(event) => {
                  setAddress(event.target.value);
                  setProblem(null);
                }}
                onKeyDown={(event) => event.key === "Enter" && apply()}
              />
            </label>
            {problem ? (
              <div className="ks-tui-link-error" role="alert">
                {problem}
              </div>
            ) : null}
            <div className="ks-tui-link-actions">
              {href !== null ? (
                <button
                  type="button"
                  className="ks-btn ks-text-btn"
                  onClick={() => {
                    handle.setLink(null);
                    onClose();
                    handle.focus();
                  }}
                >
                  Remove link
                </button>
              ) : null}
              <button type="button" className="ks-btn ks-text-btn is-primary" onClick={apply}>
                Apply
              </button>
            </div>
          </>
        )}
      </div>
    </Popover>
  );
}
