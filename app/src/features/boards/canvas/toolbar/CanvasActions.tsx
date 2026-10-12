// Top right of the board: Present, and a "More" menu for what is not needed
// while working: layout, a mind map, an AI brainstorm, find, focus mode, a
// copy of the board as an outline, the board's keys and its settings.

import { useCallback, useRef, useState } from "react";

import { Icon } from "../../../../ui/Icon";
import { openSettingsAt } from "../../../workspace/views/settings/jump";
import { BrainstormForm } from "../../brainstorm/BrainstormForm";
import { useBrainstorms } from "../../brainstorm/run";
import { useBoard } from "../context";
import { copyOutline } from "../state/export";
import { layout } from "../state/gestures";
import { present } from "../state/present";
import { closeOnEscape, focusBoard, focusFirst, moveAlong, useDismiss } from "./dismiss";
import { ToolIcon, type ToolIconName } from "./icons";
import { LayoutMenu } from "./LayoutMenu";

interface Props {
  /** Shown inside a page, whose own header presents the board. */
  embedded?: boolean;
  onFind: () => void;
  onHelp: () => void;
  onFocus: () => void;
}

type Panel = "menu" | "layout" | "brainstorm";

function Item({ icon, label, hint, onClick }: { icon: ToolIconName; label: string; hint?: string; onClick: () => void }) {
  return (
    <button type="button" role="menuitem" className="kasten-board-menu-item" onClick={onClick}>
      <ToolIcon name={icon} className="size-4" />
      <span className="flex-1">{label}</span>
      {hint && <span className="kasten-board-menu-hint">{hint}</span>}
    </button>
  );
}

export function CanvasActions({ embedded = false, onFind, onHelp, onFocus }: Props) {
  const board = useBoard();
  const thinking = useBrainstorms((s) => Boolean(s.running[board.path]));
  const [panel, setPanel] = useState<Panel | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setPanel(null), []);
  useDismiss(panel !== null, root, close);
  /** Closes the menu, then does what was chosen. */
  const run = (action: () => unknown) => () => {
    focusBoard(root.current);
    close();
    void action();
  };
  return (
    <div ref={root} className="kasten-chrome kasten-actions" role="toolbar" aria-label="Whiteboard actions" onKeyDown={closeOnEscape(panel !== null, close)}>
      {!embedded && (
        <button type="button" className="kasten-action" aria-label="Present" title="Present the sections as slides (P)" onClick={() => present(board)}>
          <ToolIcon name="present" className="size-4" />
          <span>Present</span>
        </button>
      )}
      <span className="relative inline-flex">
        <button type="button" className="kasten-tool" aria-label="More" aria-haspopup="menu" aria-expanded={panel !== null} data-busy={thinking || undefined} title="Layout, brainstorm, find, focus and more" onClick={() => setPanel((p) => (p ? null : "menu"))}>
          <Icon name="more" className="size-4" />
        </button>
        {panel === "menu" && (
          <div ref={focusFirst} className="kasten-pop kasten-below-end kasten-more" role="menu" aria-label="More" onKeyDown={moveAlong}>
            <Item icon="layout" label="Layout…" onClick={() => setPanel("layout")} />
            <Item icon="spark" label="Brainstorm with AI…" hint={thinking ? "thinking…" : undefined} onClick={() => setPanel("brainstorm")} />
            <Item icon="board" label="Mind map" hint="from connected cards" onClick={run(() => layout(board, "mindmap"))} />
            <hr className="kasten-board-menu-divider" />
            <Item icon="search" label="Find on this board" hint="Ctrl+F" onClick={run(onFind)} />
            <Item icon="eye-off" label="Focus mode" hint="\" onClick={run(onFocus)} />
            <Item icon="copy" label="Export as an outline" hint="as Markdown" onClick={run(() => copyOutline(board))} />
            <hr className="kasten-board-menu-divider" />
            <Item icon="keyboard" label="Board keys" hint="?" onClick={run(onHelp)} />
            <Item icon="settings" label="Whiteboard settings" onClick={run(() => openSettingsAt("Whiteboards", "tab"))} />
          </div>
        )}
        {panel === "layout" && (
          <div ref={focusFirst} className="kasten-pop kasten-below-end" onKeyDown={moveAlong}>
            <LayoutMenu onDone={run(() => undefined)} />
          </div>
        )}
        {panel === "brainstorm" && (
          <div role="dialog" aria-label="Brainstorm on this board" className="kasten-pop kasten-below-end">
            <BrainstormForm onClose={() => setPanel((now) => (now === "brainstorm" ? null : now))} />
          </div>
        )}
      </span>
    </div>
  );
}
