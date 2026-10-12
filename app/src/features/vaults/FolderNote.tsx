// What the folder in "Open a folder" holds, from kasten-core's survey, said
// before it is opened: a Kasten vault opens as it is; another
// app's folder opens as it is too, its folders kept as folders, or can be
// imported into Kasten's own format instead; an empty folder is better made
// a new vault.

import { useEffect, useState } from "react";

import { surveyFolder, type FolderSurvey } from "../../lib/api";
import { Icon } from "../../ui/Icon";

export type FolderState =
  | { kind: "kasten"; name: string }
  | { kind: "newer"; name: string; format: number }
  | { kind: "notes"; survey: FolderSurvey }
  | { kind: "empty" }
  | { kind: "missing"; message: string };

export function describe(found: FolderSurvey): FolderState {
  if (found.kasten) return found.kasten.readable ? { kind: "kasten", name: found.kasten.name } : { kind: "newer", name: found.kasten.name, format: found.kasten.format };
  return found.notes > 0 ? { kind: "notes", survey: found } : { kind: "empty" };
}

/** The folder's state, a moment after typing stops; null while there is none. */
export function useSurvey(path: string): FolderState | null {
  const [state, setState] = useState<{ path: string; state: FolderState } | null>(null);
  const folder = path.trim();
  useEffect(() => {
    if (!folder) return;
    let live = true;
    const timer = setTimeout(() => {
      surveyFolder(folder).then(
        (found) => live && setState({ path: folder, state: describe(found) }),
        (err: unknown) => live && setState({ path: folder, state: { kind: "missing", message: err instanceof Error ? err.message : String(err) } }),
      );
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [folder]);
  return folder && state?.path === folder ? state.state : null;
}

const count = (n: number, more: boolean, word: string) => `${n.toLocaleString()}${more ? "+" : ""} ${word}${n === 1 && !more ? "" : "s"}`;

export function FolderNote({ survey }: { survey: FolderState | null }) {
  if (!survey) return null;
  if (survey.kind === "kasten") {
    return (
      <p className="kasten-folder-note" role="status">
        <Icon name="cards" className="size-4 shrink-0" />
        <span>
          A KastenFlow vault: <strong>{survey.name}</strong>. It opens as it is.
        </span>
      </p>
    );
  }
  if (survey.kind === "newer") {
    return (
      <p className="kasten-folder-note is-warning" role="status">
        <Icon name="alert" className="size-4 shrink-0" />
        <span>
          <strong>{survey.name}</strong> was made by a newer version of KastenFlow (format {survey.format}). Update KastenFlow to open it; it stays as it is.
        </span>
      </p>
    );
  }
  if (survey.kind === "missing") {
    return (
      <p className="kasten-folder-note is-warning" role="status">
        <Icon name="alert" className="size-4 shrink-0" />
        <span>{survey.message}</span>
      </p>
    );
  }
  if (survey.kind === "empty") {
    return (
      <p className="kasten-folder-note" role="status">
        <Icon name="info" className="size-4 shrink-0" />
        <span>No notes here yet. To start a vault in this folder, create one instead: it gets KastenFlow’s folders and templates.</span>
      </p>
    );
  }
  const { obsidian, notes, more, folders } = survey.survey;
  return (
    <p className="kasten-folder-note" role="status">
      <Icon name="folder" className="size-4 shrink-0" />
      <span>
        {obsidian ? "An Obsidian vault" : "A folder of Markdown notes"}: {count(notes, more, "note")}
        {folders.length > 0 && ` in ${count(folders.length, false, "folder")}`}. It opens as it is: its folders stay folders, and KastenFlow keeps its index in a hidden
        <code>.kasten</code> folder. To bring the notes into KastenFlow’s own format instead, use Import in your KastenFlow vault; the original stays as it is.
      </span>
    </p>
  );
}
