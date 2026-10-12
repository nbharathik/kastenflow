import { useState } from "react";

import { Button } from "../../ui/Button";
import { Modal } from "../../ui/Modal";
import { validTitle } from "./names";

/** Asks for a diagram's new title. The file is named from it, which the core keeps in order (links, cards, both files). */
export function RenameDialog({ title, onRename, onClose }: { title: string; onRename: (title: string) => void; onClose: () => void }) {
  const [text, setText] = useState(title);
  const ok = validTitle(text);
  const submit = () => {
    if (!ok) return;
    onRename(text.trim());
    onClose();
  };
  return (
    <Modal label="Rename diagram" onClose={onClose} className="w-[min(420px,92vw)] p-5">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <h2 className="text-16 font-semibold">Rename diagram</h2>
        <label className="mt-3 block text-13 text-muted">
          Title
          <input
            autoFocus
            value={text}
            onChange={(event) => setText(event.target.value)}
            onFocus={(event) => event.target.select()}
            className="mt-1 h-9 w-full rounded-lg border border-line-strong bg-canvas px-2.5 text-14 text-ink outline-none focus:border-accent/60"
          />
        </label>
        {!ok && text !== "" && <p className="mt-1 text-12 text-danger">A title needs some text and no [ ] or | characters.</p>}
        <div className="mt-4 flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" tone="primary" disabled={!ok}>
            Rename
          </Button>
        </div>
      </form>
    </Modal>
  );
}
