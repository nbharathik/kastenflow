// The files of the document's folder, on the left. Text files open in the
// editor (a dot marks one with unsaved text); the rest (pictures, a PDF the
// build kept, the settings file) are listed so the folder is easy to read,
// but cannot be opened here.

import type { DocFile } from "./types";

interface Row {
  file: DocFile;
  /** The path from the document's folder. */
  rel: string;
  folder: string;
  name: string;
}

/** The rows in folder order, each folder named once above its files. */
export function rowsOf(files: readonly DocFile[], folder: string): Row[] {
  const prefix = `${folder}/`;
  return files
    .map((file) => {
      const rel = file.path.startsWith(prefix) ? file.path.slice(prefix.length) : file.path;
      const slash = rel.lastIndexOf("/");
      return { file, rel, folder: slash < 0 ? "" : rel.slice(0, slash), name: slash < 0 ? rel : rel.slice(slash + 1) };
    })
    .sort((a, b) => (a.folder === b.folder ? a.name.localeCompare(b.name) : a.folder === "" ? -1 : b.folder === "" ? 1 : a.folder.localeCompare(b.folder)));
}

interface Props {
  files: readonly DocFile[];
  folder: string;
  open: string | null;
  dirty: readonly string[];
  onOpen(path: string): void;
}

export function FileTree({ files, folder, open, dirty, onOpen }: Props) {
  const rows = rowsOf(files, folder);
  let last: string | null = null;
  return (
    <nav className="latex-tree" aria-label="Files in this document">
      {rows.map(({ file, folder: dir, name }) => {
        const heading = dir !== last && dir !== "" ? dir : null;
        last = dir;
        return (
          <div key={file.path}>
            {heading && <div className="latex-tree-folder">{heading}/</div>}
            {file.editable ? (
              <button type="button" className="latex-tree-file" aria-current={file.path === open} onClick={() => onOpen(file.path)} style={dir ? { paddingLeft: 16 } : undefined}>
                <span className="min-w-0 flex-1 truncate">{name}</span>
                {dirty.includes(file.path) && <span className="latex-tree-dot" role="img" aria-label="Not saved yet" />}
              </button>
            ) : (
              <div className="latex-tree-file is-other" title="Cannot be edited here" style={dir ? { paddingLeft: 16 } : undefined}>
                <span className="min-w-0 flex-1 truncate">{name}</span>
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}
