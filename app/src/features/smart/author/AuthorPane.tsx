import "./author.css";

import { useCallback, useState } from "react";

import { Button } from "../../../ui/Button";
import { useWorkspace } from "../../workspace/store";
import { tauriSmartBackend, type SmartBackend } from "../backend";
import { ErrorChip } from "../ErrorChip";
import { SmartFrame } from "../SmartFrame";
import { type AuthorBackend, tauriAuthorBackend } from "./backend";
import { CodeEditor } from "./CodeEditor";
import { FileTree } from "./FileTree";
import { useCodeFiles } from "./use-code-files";
import { NO_CODE_LINE } from "./words";

interface Props {
  pagePath: string;
  pageId: string;
  title: string;
  /** How the frame is run; the desktop app's own unless a test gives another. */
  backend?: SmartBackend;
  author?: AuthorBackend;
}

/**
 * "Edit code": the page's files on the left, the open one in a code editor,
 * and the page itself beside it, loaded again after each save. The page's
 * errors are listed under the editor.
 */
export function AuthorPane({ pagePath, pageId, title, backend, author }: Props) {
  const asked = backend ?? tauriSmartBackend;
  const writer = author ?? tauriAuthorBackend;
  const [reload, setReload] = useState(0);
  const [errors, setErrors] = useState(0);
  const onSaved = useCallback(() => setReload((n) => n + 1), []);
  const onErrors = useCallback(() => setErrors((n) => n + 1), []);
  const code = useCodeFiles(pagePath, writer, onSaved);
  const file = code.current === null ? undefined : code.files[code.current];

  if (code.failed !== null) {
    return (
      <div className="kasten-smart-note kasten-smart-empty">
        <p>{code.failed}</p>
        <Button size="sm" onClick={() => void code.refresh()}>
          Try again
        </Button>
      </div>
    );
  }
  if (code.listing === null) {
    return (
      <p className="kasten-smart-wait" role="status">
        Reading the files…
      </p>
    );
  }

  const stuck = Object.values(code.files).some((f) => f.dirty && !f.saving && (f.problem !== null || f.conflict !== null));
  const status = stuck ? "Not saved yet" : code.unsaved ? "Saving…" : "All changes saved";
  const protectedFile = code.current === "index.html" || code.current === "smart.yaml";

  const body = () => {
    if (!code.listing?.exists || code.listing.files.every((f) => !f.allowed)) {
      return (
        <div className="kasten-smart-note kasten-smart-empty">
          <p>{NO_CODE_LINE}</p>
          <Button size="sm" onClick={() => void code.create("index.html")}>
            Add index.html
          </Button>
        </div>
      );
    }
    if (!code.current || !file) {
      return (
        <p className="kasten-smart-wait" role="status">
          Opening the file…
        </p>
      );
    }
    if (file.binary) {
      return <p className="kasten-smart-note">{file.problem ?? "This file is a picture or data that the editor cannot show as text."}</p>;
    }
    return (
      <CodeEditor key={code.current} path={code.current} initial={file.text} revision={file.revision} onChange={(text) => code.edit(file.path, text)} onSave={() => void code.save(file.path)} />
    );
  };

  return (
    <div className="kasten-author">
      <FileTree files={code.listing.files} open={code.files} current={code.current} onOpen={code.open} onCreate={code.create} />
      <section className="kasten-author-code" aria-label="Code">
        <div className="kasten-author-toolbar">
          <span className="kasten-author-name">{code.current ?? "No file open"}</span>
          <span className="kasten-author-status" role="status">
            {status}
          </span>
          {code.current && !protectedFile && (
            <Button
              tone="quiet"
              size="sm"
              icon="trash"
              onClick={() => {
                const gone = code.current;
                if (!gone) return;
                // No "are you sure": the file goes to the trash and the page's History keeps it.
                void code.remove(gone).then((problem) => useWorkspace.getState().toast(problem ?? `“${gone}” is in the trash. The page's History keeps its earlier versions.`));
              }}
            >
              Move to trash
            </Button>
          )}
        </div>
        {file?.conflict && (
          <div className="kasten-author-bar" role="alert">
            <p>{file.conflict.gone ? `“${file.path}” was taken away while you were editing it.` : `“${file.path}” changed on disk while you were editing it.`}</p>
            <Button size="sm" onClick={() => void code.keepMine(file.path)}>
              {file.conflict.gone ? "Keep mine and make the file again" : "Keep mine"}
            </Button>
            {!file.conflict.gone && (
              <Button size="sm" onClick={() => code.takeDisk(file.path)}>
                Use the file on disk
              </Button>
            )}
          </div>
        )}
        {file?.problem && !file.conflict && !file.binary && (
          <div className="kasten-author-bar" role="alert">
            <p>{file.problem}</p>
            <Button size="sm" onClick={() => void code.save(file.path)}>
              Try saving again
            </Button>
          </div>
        )}
        {body()}
        <ErrorChip pagePath={pagePath} backend={asked} version={errors + reload} />
      </section>
      <section className="kasten-author-preview" aria-label="The page">
        <div className="kasten-smart-stage">
          <SmartFrame pagePath={pagePath} pageId={pageId} title={title} backend={asked} fill showErrors={false} reloadKey={`code:${reload}`} onErrors={onErrors} />
        </div>
      </section>
    </div>
  );
}
