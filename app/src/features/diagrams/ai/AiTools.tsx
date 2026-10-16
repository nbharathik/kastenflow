import type { RefObject } from "react";

import { Menu } from "../../../shell/Menu";
import { IconButton } from "../../../ui/Button";
import { Icon } from "../../../ui/Icon";
import { useWorkspace } from "../../workspace/store";
import { LAYOUT_PRESETS, type LayoutPreset } from "../protocol";
import type { DrawioSession } from "../session";
import { checkWithAi, drawWithAi, type Named } from "./actions";

/** The AI tools in the editor's header. "Draw with AI" and "Check diagram" are the chat's and work on the file, so they need no editor;
 * "Tidy" is the editor's own layout, laid over the diagram it holds, so it is offered while the editor is there (`canTidy`). */
export function DiagramAiTools({ diagram, session, canTidy }: { diagram: Named; session: RefObject<DrawioSession | null>; canTidy: boolean }) {
  const tidy = (preset: LayoutPreset) => {
    const open = session.current;
    void (open ? open.tidy(preset) : Promise.resolve(false)).then((done) => {
      if (!done) useWorkspace.getState().toast("The editor is still starting. Try Tidy again in a moment.");
    });
  };
  return (
    <>
      <IconButton icon="sparkle" label="Draw with AI" onClick={() => drawWithAi(diagram)} />
      <IconButton icon="circle-check" label="Check diagram" onClick={() => void checkWithAi(diagram)} />
      {canTidy && (
        <Menu label="Tidy" buttonClass="ui-icon-btn" items={LAYOUT_PRESETS.map((preset) => ({ label: preset.label, ...(preset.hint ? { hint: preset.hint } : {}), onSelect: () => tidy(preset.id) }))}>
          <Icon name="layout" className="size-[17px]" />
        </Menu>
      )}
    </>
  );
}
