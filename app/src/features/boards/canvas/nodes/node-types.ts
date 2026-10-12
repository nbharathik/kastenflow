// Which component draws each kind of node (model/flow.ts `flowKind`).

import type { NodeTypes } from "@xyflow/react";

import { CardNode } from "./CardNode";
import { DiagramNode } from "./DiagramNode";
import { DrawingNode } from "./DrawingNode";
import { FileNode, ImageNode, NestedBoardNode } from "./FileNodes";
import { LinkNode } from "./LinkNode";
import { SectionNode } from "./SectionNode";
import { ShapeNode } from "./ShapeNode";
import { StickyNode } from "./StickyNode";

export const NODE_TYPES: NodeTypes = {
  card: CardNode,
  sticky: StickyNode,
  section: SectionNode,
  link: LinkNode,
  image: ImageNode,
  diagram: DiagramNode,
  board: NestedBoardNode,
  file: FileNode,
  shape: ShapeNode,
  drawing: DrawingNode,
} as NodeTypes;
