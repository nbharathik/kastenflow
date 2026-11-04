import { type JSX, useState } from "react";

import { PageError, insertPage } from "../../pages/insert.ts";
import { TextButton } from "../ui/Button.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import { type SplitLevel, hasWords, slidesFromMarkdown, titleOfFile } from "./import-markdown.ts";
import type { DialogProps } from "./types.ts";
import "./dialogs.css";
import "./import.css";

const ACCEPT = ".md,.markdown,.txt,text/markdown,text/plain";

const SPLITS: { value: SplitLevel; label: string }[] = [
  { value: 0, label: "Let the Markdown decide" },
  { value: 1, label: "At each heading (#)" },
  { value: 2, label: "At each second-level heading (##)" },
  { value: 3, label: "At each third-level heading (###)" },
];

const messageOf = (thrown: unknown): string => (thrown instanceof Error ? thrown.message : String(thrown));

/**
 * Slides from Markdown: paste it, open a `.md` file, or (where the host has notes) choose a note. The Markdown is cut at its headings into a
 * slide each, and the slides go after the slide shown, as one step to undo. Nothing in the deck is replaced.
 */
export function MarkdownImportDialog({ session, onClose }: DialogProps): JSX.Element {
  const [markdown, setMarkdown] = useState("");
  const [name, setName] = useState("Imported Markdown");
  const [split, setSplit] = useState<SplitLevel>(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { host } = session;
  const canPick = host.pickPage !== undefined && host.readPage !== undefined;

  const readFile = (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    file.text().then(
      (text) => {
        setMarkdown(text);
        setName(titleOfFile(file.name));
        setError(null);
        setBusy(false);
      },
      (thrown: unknown) => {
        setError(messageOf(thrown));
        setBusy(false);
      },
    );
  };

  const done = (made: number) => {
    host.notify?.(`Added ${made === 1 ? "1 slide" : `${made} slides`} from Markdown.`);
    onClose();
  };

  const importPasted = () => {
    if (busy) return;
    try {
      const made = slidesFromMarkdown(session, markdown, name, split);
      if (made === 0) setError("Nothing was made from that. Does it have any words?");
      else done(made);
    } catch (thrown) {
      setError(messageOf(thrown));
    }
  };

  const importNote = async () => {
    if (busy || !host.pickPage) return;
    setBusy(true);
    setError(null);
    try {
      const page = await host.pickPage();
      if (!page) return;
      const first = await insertPage(session, { mode: "slides", page, split });
      if (first === undefined) setError("Nothing was made from that note.");
      else {
        host.notify?.(`Added slides from “${page.title}”.`);
        onClose();
      }
    } catch (thrown) {
      setError(thrown instanceof PageError ? thrown.message : messageOf(thrown));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title="Import Markdown or a note"
      width={540}
      onClose={onClose}
      footer={
        <>
          <TextButton onClick={onClose}>Cancel</TextButton>
          <TextButton primary onClick={importPasted} disabled={busy || !hasWords(markdown)}>
            Make slides
          </TextButton>
        </>
      }
    >
      <div className="ks-dg-form">
        <label className="ks-dg-field">
          <span className="ks-dg-label">Markdown</span>
          <textarea
            className="ks-input ks-im-md"
            aria-label="Markdown"
            placeholder={"# A heading makes a slide\n\nWords under it go on that slide.\n\n- A list works too"}
            spellCheck={false}
            data-autofocus=""
            value={markdown}
            onChange={(event) => {
              setMarkdown(event.target.value);
              setError(null);
            }}
          />
        </label>
        <div className="ks-im-sources">
          <label className="ks-im-pick">
            <input type="file" accept={ACCEPT} aria-label="Markdown file" onChange={(event) => readFile(event.target.files?.[0])} />
            <span>Open a .md file…</span>
          </label>
          {canPick ? (
            <TextButton onClick={() => void importNote()} disabled={busy}>
              Choose a note…
            </TextButton>
          ) : null}
        </div>
        <label className="ks-dg-field">
          <span className="ks-dg-label">Start a slide</span>
          <select className="ks-input" aria-label="Start a slide" value={split} onChange={(event) => setSplit(Number(event.target.value) as SplitLevel)}>
            {SPLITS.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </select>
        </label>
        <p className="ks-sp-hint">The slides go after the slide shown, in this deck's look. One Undo takes them all back.</p>
        {busy ? <p className="ks-sp-hint">Reading…</p> : null}
        {error ? (
          <p role="alert" className="ks-im-error">
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
