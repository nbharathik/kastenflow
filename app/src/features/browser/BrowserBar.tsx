// The browser tab's bar: back, forward, reload, the address box (which also
// searches), full screen and "open in the system's browser"; and the capture
// buttons, which read the page or the selection and show what would be kept.

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
  onFull(): void;
  onSystem(): void;
  onCapture(kind: "selection" | "page"): void;
  onSendTo(): void;
}

export function BrowserBar({ url, loading, live, fullScreen, address, target, reading, onGo, onNav, onFull, onSystem, onCapture, onSendTo }: Props) {
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
        <IconButton icon="expand" label={fullScreen ? "Leave full screen" : "Full screen"} size="sm" active={fullScreen} onClick={onFull} />
        <IconButton icon="external" label="Open in system browser" size="sm" disabled={!url} onClick={onSystem} />
      </div>
      <div className="kasten-browser-bar" role="toolbar" aria-label="Capture">
        <Button size="sm" icon="bookmark" disabled={!live || reading} onClick={() => onCapture("page")}>
          Capture page
        </Button>
        <Button size="sm" icon="quote" disabled={!live || reading} onClick={() => onCapture("selection")}>
          Capture selection
        </Button>
        <Button size="sm" tone="quiet" icon="send" onClick={onSendTo}>
          Send to: {placeName(target)}
        </Button>
      </div>
      {loading && <div className="kasten-browser-loading" role="progressbar" aria-label="Loading" />}
    </>
  );
}
