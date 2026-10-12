// A link card: a web address, opened in a new window. Only http and https
// addresses get a link (the core refuses others, and so does this).

import { memo } from "react";

import { tint } from "../colors";
import { useBoard, useBoardState } from "../context";
import { setText } from "../state/gestures";
import { LineEditor } from "./editors";
import { Resizer, SideHandles, sameNode, type BoardNodeProps } from "./parts";

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export const safeUrl = (url: string | undefined) => (url && /^https?:\/\/\S/i.test(url.trim()) ? url.trim() : null);

export const LinkNode = memo(function LinkNode({ id, data, selected }: BoardNodeProps) {
  const board = useBoard();
  const node = data.node;
  const editing = useBoardState((s) => s.editing === id);
  const url = safeUrl(node.url);
  return (
    <div className={`kasten-node kasten-weblink${node.color ? " is-tinted" : ""}`} style={tint(node.color)}>
      <SideHandles id={id} />
      {selected && <Resizer id={id} minWidth={180} minHeight={72} />}
      <div className="kasten-card-head">
        <span className="kasten-weblink-globe" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}>
            <circle cx="12" cy="12" r="8.5" />
            <path d="M3.5 12h17M12 3.5c2.4 2.4 3.5 5.2 3.5 8.5s-1.1 6.1-3.5 8.5c-2.4-2.4-3.5-5.2-3.5-8.5S9.6 5.9 12 3.5z" />
          </svg>
        </span>
        <span className="kasten-card-title">{hostOf(node.url ?? "")}</span>
      </div>
      {editing ? (
        <LineEditor text={node.url ?? ""} label="Web address" placeholder="https://" onDone={(text) => (text === null ? board.store.setState({ editing: null }) : setText(board, id, text))} />
      ) : (
        <p className="kasten-weblink-url">{node.url}</p>
      )}
      {url && (
        <a className="kasten-weblink-open nodrag" href={url} target="_blank" rel="noopener noreferrer">
          Open ↗
        </a>
      )}
    </div>
  );
}, sameNode);
