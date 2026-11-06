import { type JSX, useRef } from "react";

import type { EditorSession } from "../session/session.ts";
import type { EditorState } from "../session/types.ts";
import { TextButton } from "../ui/Button.tsx";
import { Icon } from "../ui/Icon.tsx";
import { useEditorValue } from "../useEditor.ts";

/**
 * Where saving stands. Saved, saving and unsaved are a quiet word; an error
 * says why and offers to try again; a conflict, where the file changed under
 * the editor and saving is paused until the person chooses, is a banner that
 * cannot be missed.
 */
export function SaveStatus({ session }: { session: EditorSession }): JSX.Element {
  // A new object for the same words (the status is set again with each change) is not a change of what is shown.
  const last = useRef<EditorState["saving"] | null>(null);
  const saving = useEditorValue(session, (state) => {
    const before = last.current;
    const same = before !== null && Object.keys(state.saving).length === Object.keys(before).length && Object.entries(state.saving).every(([key, value]) => Object.is((before as Record<string, unknown>)[key], value));
    if (!same) last.current = state.saving;
    return same ? before : state.saving;
  });

  if (saving.status === "conflict") {
    return (
      <div className="ks-conflict" role="alert">
        <Icon name="triangle-alert" size={16} />
        <span className="ks-conflict-text">
          <strong>This deck changed on disk.</strong> Saving is paused until you choose.
          {saving.copy ? <span className="ks-conflict-copy"> Your version is kept at {saving.copy}.</span> : null}
        </span>
        <TextButton onClick={() => session.load(saving.theirs)}>Use their version</TextButton>
        <TextButton primary onClick={() => void session.overwrite()}>
          Keep mine
        </TextButton>
      </div>
    );
  }

  if (saving.status === "error") {
    return (
      <div className="ks-save is-error" role="alert">
        <Icon name="circle-x" size={14} />
        <span className="ks-save-text">Could not save: {saving.message}</span>
        <TextButton className="ks-save-retry" onClick={() => void session.flush()}>
          Retry
        </TextButton>
      </div>
    );
  }

  return (
    <span className={`ks-save is-${saving.status}`} role="status">
      {saving.status === "saved" ? <Icon name="check" size={14} /> : null}
      <span className="ks-save-text">{saving.status === "saved" ? "Saved" : saving.status === "saving" ? "Saving…" : "Unsaved changes"}</span>
    </span>
  );
}
