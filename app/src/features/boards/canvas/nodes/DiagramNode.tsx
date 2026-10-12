// A card for a diagram (a `file` card on a `.drawio` file): the picture kept
// beside it, drawn like any image on the board. A double click edits the
// diagram over the board (see hooks/useFlowHandlers.ts); the card needs no
// editor to be seen.

import { memo } from "react";

import { DiagramImage } from "../../../diagrams/DiagramImage";
import { titleOfPath } from "../../../diagrams/names";
import { Icon } from "../../../../ui/Icon";
import { Resizer, SideHandles, sameNode, type BoardNodeProps } from "./parts";

export const DiagramNode = memo(function DiagramNode({ id, data, selected }: BoardNodeProps) {
  const node = data.node;
  const file = node.file ?? "";
  const title = file ? titleOfPath(file) : "";
  return (
    <div className={`kasten-node kasten-image${node.missing ? " kasten-missing" : ""}`} aria-label={`Diagram: ${title}`}>
      <SideHandles id={id} />
      {selected && <Resizer id={id} minWidth={60} minHeight={60} />}
      {node.missing ? (
        <div className="kasten-image-placeholder">
          <Icon name="diagram" />
          <span>This diagram is not in the vault any more.</span>
        </div>
      ) : (
        <DiagramImage
          path={file}
          alt={title}
          fallback={
            <div className="kasten-image-placeholder">
              <Icon name="diagram" />
              <span>{title}</span>
            </div>
          }
        />
      )}
    </div>
  );
}, sameNode);
