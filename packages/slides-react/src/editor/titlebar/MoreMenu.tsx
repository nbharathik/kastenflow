import { type JSX, useMemo } from "react";

import { commandItem, groups } from "../menus/build.ts";
import { DropMenu } from "../menus/DropMenu.tsx";
import { useDropdown } from "../menus/useDropdown.ts";
import type { EditorSession } from "../session/session.ts";
import type { EditorUi } from "../ui-state.ts";
import { IconButton } from "../ui/Button.tsx";

/**
 * The buttons of the bar's right side that give way in a narrow window (the assistant, full screen) as one More button with a menu,
 * so nothing is clipped. The menu is drawn in the popover layer on the page, like the other menus of the bar. `dot` is what the
 * assistant is doing: it shows on More, and the name says it in words.
 */
export function MoreMenu({ session, ui, dot }: { session: EditorSession; ui: EditorUi; dot?: "working" | "paused" | "failed" }): JSX.Element {
  const dd = useDropdown();
  const ctx = useMemo(() => ({ session, ui }), [session, ui]);
  return (
    <>
      <IconButton
        icon="ellipsis"
        label={dot ? `More, assistant ${dot === "failed" ? "last request failed" : dot}` : "More"}
        {...(dot ? { dot } : {})}
        {...dd.trigger}
      />
      <DropMenu dd={dd} ui={ui} label="More" items={() => groups([commandItem("view.ai-panel", ctx), commandItem("view.full-screen", ctx)])} />
    </>
  );
}
