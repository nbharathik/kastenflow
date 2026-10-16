// "Add a paper": paste a DOI, an arXiv number, a link, BibTeX or a citation, or
// start from a page, a PDF or the extension; check what was read; save it to
// the managed bibliography. Nothing is looked up: this reads what you give it,
// on this computer, and leaves the rest for you to fill in.

import { useId } from "react";

import { Button } from "../../ui/Button";
import { Modal } from "../../ui/Modal";
import type { AddRequest } from "./add-state";
import { ReviewStep } from "./ReviewStep";
import { useAddPaper } from "./use-add-paper";

export function AddPaperDialog({ request, onClose }: { request: AddRequest; onClose(): void }) {
  const add = useAddPaper(request, onClose);
  const titleId = useId();
  const pasteId = useId();
  return (
    <Modal labelledBy={titleId} onClose={onClose} className="ui-dialog w-[min(100%,640px)]">
      <h2 id={titleId} className="ui-dialog-title">
        Add a paper
      </h2>
      {add.stage === "paste" ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            add.read();
          }}
        >
          <label htmlFor={pasteId} className="text-13 text-muted">
            Paste a DOI, an arXiv number, a link, BibTeX or a citation.
          </label>
          <textarea
            id={pasteId}
            autoFocus
            rows={7}
            className="ui-field h-auto resize-y py-2 font-mono"
            spellCheck={false}
            placeholder={"10.1000/xyz123\nhttps://arxiv.org/abs/1706.03762\n@article{key, title = {…}}\nVaswani, A. (2017). Attention is all you need. NeurIPS."}
            value={add.text}
            onChange={(event) => add.setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                add.read();
              }
            }}
          />
          <p className="text-12 text-muted">It is read on this computer and nothing is looked up. A DOI or an arXiv number fills only its own field: details are not fetched, so fill them in or paste BibTeX.</p>
          {add.error && (
            <p role="alert" className="text-13 text-danger">
              {add.error}
            </p>
          )}
          <footer className="ui-dialog-foot">
            <Button tone="quiet" onClick={add.byHand}>
              Enter by hand
            </Button>
            <Button onClick={onClose}>Cancel</Button>
            <Button type="submit" tone="primary" disabled={add.text.trim() === ""}>
              Read it
            </Button>
          </footer>
        </form>
      ) : (
        <ReviewStep add={add} close={onClose} />
      )}
    </Modal>
  );
}
