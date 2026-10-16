// The browser tab's bar: back, forward, reload, the address box (which also
// searches), a "+" for a new browser tab, full screen and "open in the system's
// browser"; and the capture buttons, which read the page or the selection and
// show what would be kept.

import { useEffect, useState, type RefObject } from "react";

import { placeName, type Target } from "../../capture/targets";
import { Button, IconButton } from "../../ui/Button";

interface Props {
  /** The address the tab is at; none is its start page. */
  url: string | undefined;
  loading: boolean;
  /** A page is showing, so there is something to go back from, reload and capture. */
  live: boolean;
  fullScreen: boolean;
  address: RefObject<HTMLInputElement | null>;
  target: Target;
  reading: boolean;
  onGo(text: string): void;
  onNav(action: "back" | "forward" | "reload"): void;
  /** A new browser tab, on its start page. */
  onNewTab(): void;
  onFull(): void;
  onSystem(): void;
  onCapture(kind: "selection" | "page"): void;
  /** Makes a reference of the page's own tags, to review before it is added; without it the bar has no such button. */
  onSavePaper?(): void;
  onSendTo(): void;
}

export function BrowserBar({ url, loading, live, fullScreen, address, target, reading, onGo, onNav, onNewTab, onFull, onSystem, onCapture, onSavePaper, onSendTo }: Props) {
  const [draft, setDraft] = useState<string | null>(null);
  // What the box shows: what is being typed, else where the page is.
  const shown = draft ?? url ?? "";
  useEffect(() => {
    setDraft(null);
  }, [url]);

  return (
    <>
      <div className="kasten-browser-bar" role="toolbar" aria-label="Browser">
        <IconButton icon="back" label="Back" size="sm" disabled={!live} onClick={() => onNav("back")} />
        <IconButton icon="forward" label="Forward" size="sm" disabled={!live} onClick={() => onNav("forward")} />
        <IconButton icon="refresh" label="Reload" size="sm" disabled={!live} onClick={() => onNav("reload")} />
        <input
          ref={address}
          className="kasten-browser-address"
          type="text"
          inputMode="url"
          spellCheck={false}
          autoComplete="off"
          aria-label="Address or search"
          placeholder="Search or type an address"
          value={shown}
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing) {
              event.preventDefault();
              onGo(shown);
              setDraft(null);
              event.currentTarget.blur();
            } else if (event.key === "Escape") {
              event.preventDefault();
              setDraft(null);
              event.currentTarget.blur();
            }
          }}
        />
        <IconButton icon="plus" label="New web tab" size="sm" onClick={onNewTab} />
        <IconButton icon="expand" label={fullScreen ? "Leave full screen" : "Full screen"} size="sm" active={fullScreen} onClick={onFull} />
        <IconButton icon="external" label="Open in system browser" size="sm" disabled={!url} onClick={onSystem} />
      </div>
      <div className="kasten-browser-bar" role="toolbar" aria-label="Capture">
        {/* The two captures are icons: their words are their names and tooltips. */}
        <IconButton icon="bookmark" label="Capture page" title="Capture page: keep this page" disabled={!live || reading} onClick={() => onCapture("page")} />
        <IconButton icon="quote" label="Capture selection" title="Capture selection: keep what you selected" disabled={!live || reading} onClick={() => onCapture("selection")} />
        {onSavePaper && (
          <Button size="sm" icon="book" disabled={!live || reading} title="Read the page's own citation tags and make a reference of them, to check before it is added" onClick={onSavePaper}>
            Save as paper
          </Button>
        )}
        <Button size="sm" tone="quiet" icon="send" onClick={onSendTo}>
          Send to: {placeName(target)}
        </Button>
      </div>
      {loading && <div className="kasten-browser-loading" role="progressbar" aria-label="Loading" />}
    </>
  );
}
