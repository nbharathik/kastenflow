// The files of a smart page's folder, on the left of the code editor: one
// list, folders shown by their indent, the open file marked, a dot on a file
// with changes not saved yet, and "New file" with its name asked right here.

import { type FormEvent, useRef, useState } from "react";

import { Button } from "../../../ui/Button";
import type { FileEntry } from "./backend";
import type { OpenFile } from "./use-code-files";

interface Props {
  files: readonly FileEntry[];
  open: Readonly<Record<string, OpenFile>>;
  current: string | null;
  onOpen(path: string): void;
  /** Makes the file; resolves a sentence when it could not be made. */
  onCreate(name: string): Promise<string | null>;
}

/** `index.html` first, then the rest as a folder tree reads: folders' files together, by name. */
export function ordered(files: readonly FileEntry[]): FileEntry[] {
  return files
    .filter((f) => f.allowed)
    .sort((a, b) => {
      if (a.path === "index.html") return -1;
      if (b.path === "index.html") return 1;
      return a.path.localeCompare(b.path);
    });
}

export function FileTree({ files, open, current, onOpen, onCreate }: Props) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const add = useRef<HTMLButtonElement>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    const said = await onCreate(name);
    setBusy(false);
    if (said === null) {
      setAdding(false);
      setName("");
      setProblem(null);
      add.current?.focus();
    } else {
      setProblem(said);
    }
  };

  return (
    <nav className="kasten-author-tree" aria-label="Files of this page">
      <ul>
        {ordered(files).map((file) => {
          const depth = file.path.split("/").length - 1;
          const name = file.path.split("/").pop() ?? file.path;
          const dir = file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/") + 1) : "";
          const unsaved = open[file.path]?.dirty || open[file.path]?.saving;
          return (
            <li key={file.path} style={{ paddingLeft: `${depth * 12}px` }}>
              <button type="button" className="kasten-author-file" aria-current={file.path === current ? "true" : undefined} onClick={() => onOpen(file.path)}>
                {dir && <span className="kasten-author-dir">{dir}</span>}
                <span>{name}</span>
                {unsaved && <span className="kasten-author-dot" role="img" aria-label="Not saved yet" />}
              </button>
            </li>
          );
        })}
      </ul>
      {adding ? (
        <form onSubmit={(e) => void submit(e)} className="kasten-author-add">
          <input
            className="ui-field"
            autoFocus
            aria-label="File name"
            placeholder="style.css"
            value={name}
            disabled={busy}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                setAdding(false);
                setProblem(null);
                add.current?.focus();
              }
            }}
          />
          {problem && (
            <p role="alert" className="kasten-author-problem">
              {problem}
            </p>
          )}
        </form>
      ) : (
        <Button ref={add} tone="quiet" size="sm" icon="plus" onClick={() => setAdding(true)}>
          New file
        </Button>
      )}
    </nav>
  );
}
