// Home's capture field: the one control Home leads with. Enter keeps what
// you typed as a card in the Inbox, Shift+Enter starts a new line, and
// Ctrl+Enter keeps it and opens it, to go on writing. A web address is clipped
// as a page. A "/" at the start lists the things Home can start instead.

import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";

import { isAddress } from "../../lib/address";
import { Icon } from "../../ui/Icon";
import { Kbd } from "../../ui/Kbd";
import { editorKeys } from "../shortcuts/catalog";
import { captureThought } from "../workspace/capture";
import { useWorkspace } from "../workspace/store";
import { clipOrKeep } from "../workspace/views/clip";
import { matchingActions, slashActions, type HomeAction } from "./actions";

/** The most lines the field grows to before it scrolls. */
const MAX_ROWS = 6;

export function CaptureBar() {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [asked, setAsked] = useState(0);
  const box = useRef<HTMLTextAreaElement>(null);
  const list = useId();
  const desktop = useWorkspace((s) => s.client?.kind === "vault");
  const clip = desktop && isAddress(text);
  const slash = text.startsWith("/") && !text.includes("\n") ? text.slice(1) : null;
  const options = useMemo(() => (slash === null ? [] : matchingActions(slashActions(), slash)), [slash]);
  const current = Math.max(0, Math.min(asked, options.length - 1));

  // The field grows with its text, up to MAX_ROWS lines.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    const line = parseFloat(getComputedStyle(el).lineHeight) || 20;
    el.style.height = `${Math.min(el.scrollHeight, line * MAX_ROWS)}px`;
  }, [text]);

  const save = (open: boolean) => {
    const markdown = text.trim();
    if (!markdown || busy) return;
    setBusy(true);
    const done = clip ? clipOrKeep(markdown) : captureThought(markdown, { open });
    void Promise.resolve(done)
      .then((kept) => {
        // A thought not kept stays in the field to try again (the notice says why).
        if (kept) setText((now) => (now.trim() === markdown ? "" : now));
      })
      .finally(() => {
        setBusy(false);
        box.current?.focus();
      });
  };

  const run = (action: HomeAction) => {
    setText("");
    setAsked(0);
    action.run();
  };

  return (
    <div className="kasten-home-capture-wrap">
      <form
        className="kasten-home-capture"
        onSubmit={(event) => {
          event.preventDefault();
          save(false);
        }}
      >
        <Icon name="bulb" className="kasten-home-capture-icon size-4" />
        <textarea
          ref={box}
          rows={1}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setAsked(0);
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (options.length > 0) {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                setAsked((current + (event.key === "ArrowDown" ? 1 : options.length - 1)) % options.length);
              } else if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                run(options[current]!);
              } else if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                setText("");
              }
              return;
            }
            if (event.key !== "Enter" || event.shiftKey) return;
            event.preventDefault();
            save(event.ctrlKey || event.metaKey);
          }}
          placeholder="Capture a thought, or type / for actions"
          aria-label="Quick note"
          aria-autocomplete="list"
          aria-controls={options.length > 0 ? list : undefined}
          aria-activedescendant={options.length > 0 ? `${list}-${current}` : undefined}
          data-capture-box=""
          disabled={busy}
          className="kasten-home-capture-text"
        />
        {clip ? (
          <button type="submit" disabled={busy} className="ui-btn is-primary is-sm">
            {busy ? "Clipping…" : "Clip the page"}
          </button>
        ) : (
          text.trim() !== "" &&
          options.length === 0 && (
            <span className="kasten-home-capture-hint" aria-hidden="true">
              <Kbd keys="Enter" /> save
              <Kbd keys={editorKeys("Ctrl+Enter")} /> open
            </span>
          )
        )}
      </form>
      {options.length > 0 && (
        <ul id={list} role="listbox" aria-label="Actions" className="kasten-home-slash">
          {options.map((action, i) => (
            <li
              key={action.id}
              id={`${list}-${i}`}
              role="option"
              aria-selected={i === current}
              // The press, not the click: the field keeps its focus until the action runs.
              onMouseDown={(event) => {
                event.preventDefault();
                run(action);
              }}
              onMouseMove={() => i !== current && setAsked(i)}
              className="kasten-home-slash-item"
            >
              <Icon name={action.icon} className="size-4 text-muted" />
              <span className="min-w-0 flex-1 truncate">{action.label}</span>
              {action.keys && <Kbd keys={action.keys} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
