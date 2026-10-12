import { useLayoutEffect, useRef, useState } from "react";

import { isAddress } from "../../../lib/address";
import { useWorkspace } from "../store";
import { captureThought } from "../capture";
import { clipOrKeep } from "./clip";
import { editorKeys } from "../../shortcuts/catalog";
import { Icon } from "../../../ui/Icon";

/** The most lines the box grows to before it scrolls. */
const MAX_ROWS = 10;

/** A box to catch a thought, short or long. Enter keeps it in the
 * Inbox; Shift+Enter starts a new line; Ctrl+Enter keeps it and opens it, to
 * go on writing a page. Its first line becomes the title and the rest the
 * body. A web address is clipped: the page's article becomes the card. */
export function Capture({ autoFocus = false, project = null, label = "Quick note", className = "mt-6" }: { autoFocus?: boolean; project?: string | null; label?: string; className?: string }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  const desktop = useWorkspace((s) => s.client?.kind === "vault");
  const clip = desktop && !project && isAddress(text);
  const long = text.includes("\n");

  // The box grows with its text, up to MAX_ROWS lines.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    const line = parseFloat(getComputedStyle(el).lineHeight) || 22;
    el.style.height = `${Math.min(el.scrollHeight, line * MAX_ROWS)}px`;
  }, [text]);

  const save = (open: boolean) => {
    const markdown = text.trim();
    if (!markdown || busy) return;
    setBusy(true);
    const done = clip ? clipOrKeep(markdown) : captureThought(markdown, { project, open });
    void Promise.resolve(done)
      .then((kept) => {
        // A thought not kept stays in the box to try again (the toast says why).
        if (kept) setText((now) => (now.trim() === markdown ? "" : now));
      })
      .finally(() => {
        setBusy(false);
        box.current?.focus();
      });
  };

  return (
    <form
      className={`kasten-capture ${className} rounded-xl border border-line bg-canvas px-3.5 py-2.5 shadow-card transition-shadow focus-within:border-accent/60 focus-within:shadow-[0_0_0_4px_var(--color-soft)]`}
      onSubmit={(event) => {
        event.preventDefault();
        save(false);
      }}
    >
      <div className="flex items-start gap-2.5">
        <Icon name="bulb" className="mt-[7px] size-4 shrink-0 text-muted" />
        <textarea
          ref={box}
          rows={1}
          autoFocus={autoFocus}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
            e.preventDefault();
            save(e.ctrlKey || e.metaKey);
          }}
          placeholder={desktop && !project ? "Capture a thought, or paste a link to clip the page" : "Capture a thought…"}
          aria-label={label}
          data-capture-box=""
          disabled={busy}
          className="min-h-8 flex-1 resize-none bg-transparent py-[5px] text-14 leading-[22px] outline-none placeholder:text-muted"
        />
        {clip && (
          <button type="submit" disabled={busy} className="mt-0.5 shrink-0 rounded-lg bg-accent px-2.5 py-1 text-13 font-semibold text-on-accent disabled:opacity-60">
            {busy ? "Clipping…" : "Clip the page"}
          </button>
        )}
      </div>
      {text.trim() && !clip && (
        <p className="kasten-capture-hint mt-1.5 flex flex-wrap gap-x-3 pl-[26px] text-12 text-muted">
          <span>
            <kbd>Enter</kbd> save
          </span>
          <span>
            <kbd>Shift+Enter</kbd> new line
          </span>
          <span>
            <kbd>{editorKeys("Ctrl+Enter")}</kbd> save and open{long ? " as a page" : ""}
          </span>
        </p>
      )}
    </form>
  );
}
