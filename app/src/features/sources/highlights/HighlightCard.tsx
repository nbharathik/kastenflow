// One highlight in the Highlights view: the quote in its colour, with its
// note, page, card and the card's tags. The quote opens the reader at its
// spot; it drags onto a board as its card; Copy puts it on the clipboard as
// a Markdown quote with where it came from. Its actions show when the card is
// under the pointer or has the focus (always on a touch screen); a card it
// already has is always one click away.

import { useState, type MouseEvent } from "react";

import type { Highlight, NoteMeta } from "../../../lib/vault/types";
import { Icon } from "../../../ui/Icon";
import { dragHighlights } from "../../workspace/drag";
import { titleOf } from "../../workspace/names";
import { howFrom, useWorkspace } from "../../workspace/store";
import { colorOf } from "../colors";
import { showSpot } from "../highlight-request";
import { useSources } from "../store";

import "./cards.css";

interface Props {
  source: string;
  sourceTitle: string;
  highlight: Highlight;
  card: NoteMeta | undefined;
  /** Shows which PDF it is from, in a list of many. */
  showSource?: boolean;
}

export function HighlightCard({ source, sourceTitle, highlight: h, card, showSource = false }: Props) {
  const [copied, setCopied] = useState(false);
  const open = (e: MouseEvent) => showSpot({ source, page: h.page, highlight: h.id }, howFrom(e));
  const copy = () => {
    const quote = h.text.split(/\r?\n/).map((line) => `> ${line}`).join("\n");
    void navigator.clipboard?.writeText(`${quote}\n\n— ${sourceTitle}, p. ${h.page}${h.comment ? `\n\n${h.comment}` : ""}`).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  };
  return (
    <div className={`kasten-hls-row is-${colorOf(h.color)}${h.card ? " has-card" : ""}`} draggable onDragStart={(e) => dragHighlights(e, [{ source, id: h.id }])}>
      <button type="button" className="kasten-hls-quote" onClick={open} title="Open at this spot">
        <span className="kasten-hls-text">{h.text}</span>
        {h.comment && <span className="kasten-hls-comment">{h.comment}</span>}
      </button>
      <div className="kasten-hls-meta">
        <span className="kasten-hls-page">
          <Icon name="page" className="size-3" />
          Page {h.page}
        </span>
        {showSource && (
          <span className="kasten-hls-from" title={sourceTitle}>
            <Icon name="book" className="size-3" />
            {sourceTitle}
          </span>
        )}
        {h.card && (
          <button type="button" className="kasten-hls-cardlink" aria-label="Open card" title={card ? `Open its card: ${titleOf(card)}` : "Open its card"} onClick={(e) => useWorkspace.getState().openPath(h.card!, howFrom(e))}>
            <Icon name="card" className="size-3" />
            <span>{card ? titleOf(card) : "Card"}</span>
            <Icon name="arrow-up-right" className="size-3" />
          </button>
        )}
        {card?.tags.map((t) => (
          <span key={t} className="kasten-hls-tagchip">
            #{t}
          </span>
        ))}
        <span className="kasten-hls-spacer" />
        <div className="kasten-hls-actions">
          <button type="button" onClick={open} aria-label="Open at spot" title="Open the PDF at this spot">
            <Icon name="book" className="size-3.5" />
            Open
          </button>
          <button type="button" onClick={copy} title="Copy as a quote">
            <Icon name={copied ? "check" : "copy"} className="size-3.5" />
            {copied ? "Copied" : "Copy"}
          </button>
          {!h.card && (
            <button type="button" className="is-strong" onClick={() => void useSources.getState().card(source, h.id)}>
              <Icon name="card" className="size-3.5" />
              Make card
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
