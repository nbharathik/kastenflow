// A card for a note: its icon and title, the first lines of the note, or
// the whole note to edit in place. Titles and first lines come live from
// the notes list, so a note on two boards shows the same on both.

import { useStore } from "@xyflow/react";
import { memo, useRef, type CSSProperties } from "react";

import type { BoardNode, NoteMeta } from "../../../../lib/vault/types";
import { iconOf, titleOf } from "../../../workspace/names";
import { useWorkspace } from "../../../workspace/store";
import { noteAt } from "../../../workspace/tree";
import { tint } from "../colors";
import { isVeryFar, useBoardState } from "../context";
import { TITLE_HEIGHT } from "../model/geometry";
import { ExpandedCard } from "./ExpandedCard";
import { useTurn } from "./turns";
import { Resizer, SideHandles, sameNode, type BoardNodeProps } from "./parts";
import { IconOrEmoji } from "../../../../ui/IconOrEmoji";
import { lineIcon } from "../../../../ui/glyph";
import { Icon } from "../../../../ui/Icon";

/** The note a card shows. While a rename moves the file (the board follows
 * a moment later), the card keeps showing the note it had. */
function useCardNote(node: BoardNode): NoteMeta | undefined {
  const meta = useWorkspace((s) => (node.file ? noteAt(s.notes, node.file) : undefined));
  const last = useRef(meta);
  if (meta) last.current = meta;
  return meta ?? (node.missing ? undefined : last.current);
}

/** How many lines of the note fit under the title. */
const linesFor = (height: number | undefined, tags: boolean) => Math.max(1, Math.floor(((height ?? 180) - 60 - (tags ? 26 : 0)) / 19.5));

/** The title and first lines, and a big title for far out. Both are laid
 * out once, in the same place; the zoom only flips which one is visible
 * (styles/far.css), so crossing it does not lay out 500 cards again. */
function CardFace({ meta, size, height }: { meta: NoteMeta; size: string; height: number | undefined }) {
  const marked = useBoardState((s) => s.marked.has(meta.path));
  return (
    <>
      <div className="kasten-card-far" aria-hidden="true">
        <span>{titleOf(meta)}</span>
      </div>
      <div className="kasten-card-face">
      <div className="kasten-card-head">
        <span className="kasten-card-icon" aria-hidden="true">
          <IconOrEmoji icon={iconOf(meta)} />
        </span>
        <span className="kasten-card-title">{titleOf(meta)}</span>
        {marked && (
          <span className="kasten-card-agent" role="img" aria-label="Agent writing to review" title="An agent wrote some of this, not yet edited or accepted">
            <Icon name="agent" className="size-3" />
          </span>
        )}
      </div>
      {size !== "title" && meta.excerpt && (
        <p className="kasten-card-excerpt" style={{ "--lines": linesFor(height, meta.tags.length > 0) } as CSSProperties}>
          {meta.excerpt}
        </p>
      )}
      {size !== "title" && meta.tags.length > 0 && (
        <div className="kasten-card-tags">
          {meta.tags.slice(0, 4).map((tag) => (
            <span key={tag}>#{tag}</span>
          ))}
        </div>
      )}
      </div>
    </>
  );
}

/** An expanded card: its note's editor, with the big title over it far
 * out (styles/far.css flips which shows). Editors start one at a time
 * (turns.ts) and go only when zoomed right out. */
function Expanded({ id, meta, active, height }: { id: string; meta: NoteMeta; active: boolean; height: number | undefined }) {
  const veryFar = useStore(isVeryFar);
  const viewMoving = useBoardState((s) => s.viewMoving);
  const turn = useTurn(!veryFar, viewMoving);
  if (!turn) return <CardFace meta={meta} size="preview" height={height} />;
  return (
    <>
      <div className="kasten-card-far" aria-hidden="true">
        <span>{titleOf(meta)}</span>
      </div>
      <ExpandedCard id={id} path={meta.path} active={active} />
    </>
  );
}

export const CardNode = memo(function CardNode({ id, data, selected, height }: BoardNodeProps) {
  const node = data.node;
  const meta = useCardNote(node);
  const size = node.size ?? "preview";
  if (!meta) return <MissingCard id={id} node={node} selected={selected} />;
  return (
    <div className={`kasten-node kasten-card is-${size}${node.color ? " is-tinted" : ""}`} style={tint(node.color)} aria-label={titleOf(meta)}>
      <SideHandles id={id} />
      {selected && <Resizer id={id} minWidth={180} minHeight={size === "title" ? TITLE_HEIGHT : 90} widthOnly={size === "title"} />}
      {size === "expanded" ? <Expanded id={id} meta={meta} active={selected} height={height} /> : <CardFace meta={meta} size={size} height={height} />}
    </div>
  );
}, sameNode);

function MissingCard({ id, node, selected }: { id: string; node: BoardNode; selected: boolean }) {
  const name = node.file?.slice(node.file.lastIndexOf("/") + 1) ?? "a file";
  return (
    <div className="kasten-node kasten-card kasten-missing" aria-label={`Missing: ${name}`}>
      <SideHandles id={id} />
      {selected && <Resizer id={id} minWidth={180} minHeight={90} />}
      <div className="kasten-card-face">
        <div className="kasten-card-head">
          <span className="kasten-card-icon" aria-hidden="true">
            <IconOrEmoji icon={lineIcon("alert")} />
          </span>
          <span className="kasten-card-title">{name}</span>
        </div>
        <p className="kasten-card-excerpt">This note is not in the vault any more: it was moved to the trash or renamed elsewhere. Take the card off the board, or restore the note from the Trash.</p>
      </div>
    </div>
  );
}
