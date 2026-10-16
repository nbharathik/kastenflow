import { useWorkspace } from "../store";

/** The page changed on disk while it was open: the latest edits went to `copy`. */
export function ConflictBanner({ copy, onDismiss }: { copy: string; onDismiss: () => void }) {
  return (
    <div className="kasten-note-banner" role="alert">
      <span>This page changed outside KastenFlow, so your latest edits were kept in a copy.</span>
      <button type="button" onClick={() => useWorkspace.getState().openPath(copy)}>
        Open the copy
      </button>
      <button type="button" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  );
}
