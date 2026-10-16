// Settings → Browser extension → Extension folder: where the app carries the
// extension's files (Chrome and Edge "Load unpacked" from there), and a button
// that shows that folder in the file manager. Nothing here changes a file.

import { useEffect, useState } from "react";

import { Button } from "../../ui/Button";
import { Note, Row } from "../workspace/views/settings/parts";
import { extensionBackend } from "./backend";

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function FolderRow() {
  const [folder, setFolder] = useState<string | null>(null);
  const [missing, setMissing] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    extensionBackend()
      .folder()
      .then(
        (path) => live && setFolder(path),
        (err: unknown) => live && setMissing(message(err)),
      );
    return () => {
      live = false;
    };
  }, []);

  const show = () => {
    setProblem(null);
    extensionBackend()
      .showFolder()
      .catch((err: unknown) => setProblem(message(err)));
  };

  return (
    <>
      <Row id="extension.folder" detail={missing ?? undefined}>
        {folder && (
          <code className="kasten-set-path" title={folder}>
            {folder}
          </code>
        )}
        <Button size="sm" icon="folder-open" disabled={!folder} onClick={show}>
          Show extension folder
        </Button>
      </Row>
      {problem && <Note tone="danger">{problem}</Note>}
    </>
  );
}
