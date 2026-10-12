// Find on a board (Mod+F): everything on it by its words, a card by its
// note's title, a sticky or shape by its text, a section by its label;
// picking one selects it and brings it to the middle of the view.

import { useReactFlow } from "@xyflow/react";
import { useRef } from "react";

import { motionMs } from "../../../../lib/motion";
import type { BoardNode } from "../../../../lib/vault/types";
import { lineIcon } from "../../../../ui/glyph";
import { titleOfPath } from "../../../diagrams/names";
import { Picker, type PickerOption } from "../../../library/Picker";
import { useBoard } from "../context";
import { select } from "../state/store";

/** What a thing on the board is called in the finder, and what it is. */
function named(node: BoardNode): { label: string; detail: string; icon: string } | null {
  const first = (text: string | undefined) => (text ?? "").split("\n").map((l) => l.replace(/^#+\s*/, "").trim()).find(Boolean) ?? "";
  if (node.kind === "file") {
    const board = node.file?.endsWith(".canvas");
    const diagram = node.file?.endsWith(".drawio");
    const name = node.title || node.file?.split("/").pop()?.replace(/\.(md|canvas)$/, "") || "Card";
    return { label: diagram ? titleOfPath(node.file!) : name, detail: board ? "Board" : diagram ? "Diagram" : "Card", icon: lineIcon(board ? "board" : diagram ? "diagram" : "page") };
  }
  if (node.kind === "group") return { label: node.label || "Section", detail: "Section", icon: lineIcon("section") };
  if (node.kind === "link") return { label: node.url ?? "Link", detail: "Link", icon: lineIcon("link") };
  if (node.draw) return null;
  const text = first(node.text);
  return text ? { label: text, detail: node.shape ? "Shape" : "Sticky", icon: lineIcon(node.shape ? "size" : "sticky") } : null;
}

export function FindOnBoard({ onClose }: { onClose(): void }) {
  const board = useBoard();
  const flow = useReactFlow();
  const within = useRef<HTMLDivElement>(null);
  const options: PickerOption[] = board.doc.nodes.flatMap((node) => {
    const name = named(node);
    return name ? [{ key: node.id, ...name }] : [];
  });

  const go = (id: string) => {
    onClose();
    const node = board.node(id);
    if (!node) return;
    select(board.store, [id]);
    const zoom = Math.max(flow.getZoom(), 0.6);
    void flow.setCenter(node.x + node.width / 2, node.y + node.height / 2, { zoom, duration: motionMs(240) });
  };

  return (
    <div ref={within} className="kasten-board-find">
      <Picker label="Find on this board" placeholder="Find a card, sticky or section…" options={options} empty="Nothing on this board matches" within={within} onPick={go} onClose={onClose} />
    </div>
  );
}
