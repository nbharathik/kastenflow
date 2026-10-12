// Cards for files that are not notes: a nested board (its title and a
// small map of what is on it; double-click goes in), an image, or any
// other file by name.

import { useStore } from "@xyflow/react";
import { memo, useEffect, useState } from "react";

import { Icon } from "../../../../ui/Icon";
import { fileUrl } from "../../../../lib/vault/file-url";
import { useWorkspace } from "../../../workspace/store";
import { onBoardFiles } from "../../events";
import { cssColor, tint } from "../colors";
import { isFar } from "../context";
import { boardPreview, type Preview } from "./nested-preview";
import { Resizer, SideHandles, sameNode, type BoardNodeProps } from "./parts";
import { IconOrEmoji } from "../../../../ui/IconOrEmoji";
import { lineIcon } from "../../../../ui/glyph";

const nameOf = (file: string | undefined) => (file ? file.slice(file.lastIndexOf("/") + 1) : "");

function usePreview(file: string | undefined, skip: boolean): Preview | null {
  const client = useWorkspace((s) => s.client);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (file) return onBoardFiles((paths) => void (paths.includes(file) && setVersion((v) => v + 1)));
  }, [file]);
  useEffect(() => {
    if (!client || !file || skip) return;
    let live = true;
    boardPreview(client, file).then(
      (found) => live && setPreview(found),
      () => live && setPreview(null),
    );
    return () => {
      live = false;
    };
  }, [client, file, skip, version]);
  return preview;
}

function MiniMap({ preview }: { preview: Preview }) {
  const frame = preview.frame;
  if (!frame) return <p className="kasten-nested-empty">An empty board</p>;
  const pad = Math.max(frame.width, frame.height) * 0.04;
  return (
    <svg className="kasten-nested-map" viewBox={`${frame.x - pad} ${frame.y - pad} ${frame.width + 2 * pad} ${frame.height + 2 * pad}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      {preview.boxes.map((box, i) => (
        <rect
          key={i}
          x={box.x}
          y={box.y}
          width={box.width}
          height={box.height}
          rx={Math.min(box.width, box.height) * 0.06}
          className={box.kind === "group" ? "is-section" : "is-item"}
          style={cssColor(box.color) ? { fill: cssColor(box.color) } : undefined}
        />
      ))}
    </svg>
  );
}

export const NestedBoardNode = memo(function NestedBoardNode({ id, data, selected }: BoardNodeProps) {
  const node = data.node;
  const far = useStore(isFar);
  const preview = usePreview(node.file, far || Boolean(node.missing));
  const title = node.title ?? preview?.title ?? nameOf(node.file).replace(/\.canvas$/, "");
  return (
    <div className={`kasten-node kasten-nested${node.missing ? " kasten-missing" : ""}${node.color ? " is-tinted" : ""}`} style={tint(node.color)} aria-label={`Board: ${title}`}>
      <SideHandles id={id} />
      {selected && <Resizer id={id} minWidth={180} minHeight={100} />}
      <div className="kasten-card-head">
        <span className="kasten-nested-icon" aria-hidden="true">
          <Icon name="board" className="size-4" />
        </span>
        <span className="kasten-card-title">{title}</span>
      </div>
      {node.missing ? <p className="kasten-card-excerpt">This board is not in the vault any more.</p> : !far && preview && <MiniMap preview={preview} />}
      <span className="kasten-nested-hint">Double-click to open</span>
    </div>
  );
}, sameNode);

export const ImageNode = memo(function ImageNode({ id, data, selected }: BoardNodeProps) {
  const node = data.node;
  const url = node.file ? fileUrl(node.file) : null;
  const name = nameOf(node.file);
  return (
    <div className={`kasten-node kasten-image${node.missing ? " kasten-missing" : ""}`} aria-label={`Image: ${name}`}>
      <SideHandles id={id} />
      {selected && <Resizer id={id} minWidth={60} minHeight={60} />}
      {url && !node.missing ? (
        <img src={url} alt={name} draggable={false} loading="lazy" decoding="async" />
      ) : (
        <div className="kasten-image-placeholder">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden="true">
            <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
            <circle cx="9" cy="10" r="1.8" />
            <path d="M20.5 16l-5-5-8 8.5" />
          </svg>
          <span>{name}</span>
        </div>
      )}
    </div>
  );
}, sameNode);

export const FileNode = memo(function FileNode({ id, data, selected }: BoardNodeProps) {
  const node = data.node;
  const name = nameOf(node.file);
  return (
    <div className={`kasten-node kasten-card${node.missing ? " kasten-missing" : ""}${node.color ? " is-tinted" : ""}`} style={tint(node.color)} aria-label={`File: ${name}`}>
      <SideHandles id={id} />
      {selected && <Resizer id={id} minWidth={160} minHeight={60} />}
      <div className="kasten-card-face">
        <div className="kasten-card-head">
          <span className="kasten-card-icon" aria-hidden="true">
            <IconOrEmoji icon={lineIcon("attach")} />
          </span>
          <span className="kasten-card-title">{name}</span>
        </div>
        <p className="kasten-card-excerpt">{node.missing ? "This file is not in the vault any more." : node.file}</p>
      </div>
    </div>
  );
}, sameNode);
