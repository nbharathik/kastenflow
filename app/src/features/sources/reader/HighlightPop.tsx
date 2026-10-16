// A highlight, clicked: its colour, its comment, and what to do with it:
// make it a card (or open the card it became), copy its text, put it in a page
// as a quotation, or remove it. A new card opens beside the reader, as
// Heptabase opens cards.

import { useState } from "react";

import { pdfLink } from "../../../lib/kasten-links";
import type { Highlight } from "../../../lib/vault/types";
import { runInChat } from "../../chat/run-action";
import { useWorkspace } from "../../workspace/store";
import { COLOR_NAMES, colorOf, HIGHLIGHT_COLORS } from "../colors";
import { InsertHighlight } from "../compare/InsertHighlight";
import { useSources, useSourceTitle } from "../store";
import { pdfChip } from "./ai-context";

interface Props {
  source: string;
  highlight: Highlight;
  at: { left: number; top: number };
  onClose(): void;
}

export function HighlightPop({ source, highlight: h, at, onClose }: Props) {
  const [comment, setComment] = useState(h.comment ?? "");
  const [busy, setBusy] = useState(false);
  const sources = useSources.getState();
  const title = useSourceTitle(source);
  const saveComment = () => {
    if (comment.trim() !== (h.comment ?? "")) void sources.edit(source, h.id, { comment });
  };
  const openCard = (path: string) => useWorkspace.getState().openPath(path, "stack");

  return (
    <div className="kasten-hl-pop" style={{ left: at.left, top: at.top }} role="dialog" aria-label="Highlight" onPointerUp={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div className="kasten-hl-colors" role="radiogroup" aria-label="Colour">
        {HIGHLIGHT_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            role="radio"
            aria-checked={colorOf(h.color) === color}
            aria-label={COLOR_NAMES[color]}
            className={`kasten-hl-swatch is-${color}`}
            onClick={() => color !== h.color && void sources.edit(source, h.id, { color })}
          />
        ))}
      </div>
      <textarea className="kasten-hl-comment" rows={2} value={comment} placeholder="Add a comment…" aria-label="Comment" onChange={(e) => setComment(e.target.value)} onBlur={saveComment} />
      <div className="kasten-hl-actions">
        {h.card ? (
          <button type="button" className="kasten-hl-primary" onClick={() => openCard(h.card!)}>
            Open card
          </button>
        ) : (
          <button
            type="button"
            className="kasten-hl-primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              saveComment();
              const card = await sources.card(source, h.id);
              setBusy(false);
              if (card) {
                onClose();
                openCard(card.meta.path);
              }
            }}
          >
            {busy ? "Making…" : "Make card"}
          </button>
        )}
        <button type="button" onClick={() => void navigator.clipboard?.writeText(h.text).then(() => useWorkspace.getState().toast("Copied the highlight"), () => {})}>
          Copy
        </button>
        <button
          type="button"
          title="Copy a link that opens this PDF at this highlight"
          onClick={() => void navigator.clipboard?.writeText(pdfLink(source, h.page, h.id)).then(() => useWorkspace.getState().toast("Copied the link to this highlight"), () => {})}
        >
          Copy link to this location
        </button>
        <button
          type="button"
          title="Ask AI to explain this highlight, in the chat"
          onClick={() => {
            onClose();
            void runInChat("explain", [pdfChip(source, title, [h.page], [h.id])]);
          }}
        >
          Explain
        </button>
        <InsertHighlight source={source} highlight={{ ...h, comment: comment.trim() || h.comment }} onDone={onClose} />
        <button
          type="button"
          className="is-danger"
          onClick={async () => {
            if (await sources.remove(source, h.id)) onClose();
          }}
        >
          Remove
        </button>
      </div>
      {h.card && <p className="kasten-hl-note">Removing the highlight keeps its card.</p>}
    </div>
  );
}
