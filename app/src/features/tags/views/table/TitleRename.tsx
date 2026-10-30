// The title of a row, renamed in place: Enter or leaving the field renames
// the note through the workspace (the core's rename), Escape and an empty
// or unchanged title leave it as it was.

import { useLayoutEffect, useRef, useState } from "react";

import { useWorkspace } from "../../../workspace/store";

interface TitleRenameProps {
  path: string;
  title: string;
  /** Closes the field; keys go back to the grid unless `refocus` is false. */
  done(refocus: boolean): void;
}

export function TitleRename({ path, title, done }: TitleRenameProps) {
  const [draft, setDraft] = useState(title);
  const input = useRef<HTMLInputElement>(null);
  const closed = useRef(false);

  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.select();
  }, []);

  const close = (commit: boolean, refocus: boolean) => {
    if (closed.current) return;
    closed.current = true;
    const next = draft.trim();
    // The grid takes the keys back first, so the field going away does not lose them.
    if (refocus) input.current?.closest<HTMLElement>(".kasten-table-scroll")?.focus({ preventScroll: true });
    if (commit && next && next !== title) void useWorkspace.getState().rename(path, next);
    done(refocus);
  };

  return (
    <input
      ref={input}
      className="kasten-table-title-input"
      aria-label={`Title of ${title}`}
      value={draft}
      spellCheck
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => close(true, false)}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing) return;
        if (e.key === "Enter") {
          e.preventDefault();
          close(true, true);
        } else if (e.key === "Escape") {
          e.preventDefault();
          close(false, true);
        }
      }}
    />
  );
}
