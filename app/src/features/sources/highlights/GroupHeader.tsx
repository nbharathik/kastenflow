// The heading of one PDF's highlights: a small cover, its title, how many,
// "Open", and a fold that hides its highlights (remembered in this window).
// It stays under the toolbar while its highlights scroll.

import type { MouseEvent } from "react";

import type { SourceInfo } from "../../../lib/vault/types";
import { Icon } from "../../../ui/Icon";
import { cover } from "./cover";

interface Props {
  source: SourceInfo;
  /** "3 highlights", or "1 of 3" while filters are on. */
  count: string;
  folded: boolean;
  onFold(): void;
  onOpen(event: MouseEvent): void;
}

export function GroupHeader({ source, count, folded, onFold, onOpen }: Props) {
  return (
    <header className="kasten-hls-grouphead">
      <button type="button" className="kasten-hls-fold" aria-expanded={!folded} aria-label={`${folded ? "Show" : "Hide"} the highlights of ${source.title}`} title={folded ? "Show highlights" : "Hide highlights"} onClick={onFold}>
        <Icon name="chevron" className={`size-4 ${folded ? "" : "rotate-90"}`} />
      </button>
      <span className="kasten-hls-minicover" style={{ background: cover(source.title) }} aria-hidden="true" />
      <button type="button" className="kasten-hls-open" onClick={onOpen}>
        {source.title}
      </button>
      <span className="kasten-hls-count">{count}</span>
      <button type="button" className="kasten-hls-openlink" aria-label={`Open ${source.title}`} title="Open to read and highlight" onClick={onOpen}>
        Open
        <Icon name="arrow-up-right" className="size-3.5" />
      </button>
    </header>
  );
}
