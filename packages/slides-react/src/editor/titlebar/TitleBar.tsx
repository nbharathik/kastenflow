import { type JSX, useEffect, useMemo, useRef, useState } from "react";

import { keysOf, runCommand } from "../commands/index.ts";
import { CollapsedMenu } from "../menus/CollapsedMenu.tsx";
import { MenuBar } from "../menus/MenuBar.tsx";
import { MenuSearch } from "../menus/MenuSearch.tsx";
import type { EditorSession } from "../session/session.ts";
import type { EditorUi } from "../ui-state.ts";
import { IconButton } from "../ui/Button.tsx";
import { useEditorValue } from "../useEditor.ts";
import { useElementSize } from "../useElementSize.ts";
import { useUiState } from "../useUi.ts";
import { DeckTitle } from "./DeckTitle.tsx";
import { FavouriteStar } from "./FavouriteStar.tsx";
import { SaveStatus } from "./SaveStatus.tsx";
import { SlideshowButton } from "./SlideshowButton.tsx";
import "./titlebar.css";

/** Below this width the menus fold into one button: the name, the search and the buttons at the right would otherwise squeeze them. */
const FOLD_MENUS_BELOW = 1060;

/**
 * The slim bar at the top, one row: a way back to the library when the host gives one, the deck's name (click to rename) with its star
 * and where saving stands, the menus File to Help (one Menu button in a narrow window) and the search over them, and at the right the
 * assistant, full screen and Slideshow. While saving is paused the banner that says so takes a row of its own under these.
 */
export function TitleBar({ session, ui }: { session: EditorSession; ui: EditorUi }): JSX.Element {
  const status = useEditorValue(session, (state) => state.saving.status);
  const conflict = status === "conflict";
  // A message that needs reading (saving paused, or failed) is too long to share the row with the menus.
  const stacked = conflict || status === "error";
  const { panel, fullScreen } = useUiState(ui);
  const ctx = useMemo(() => ({ session, ui }), [session, ui]);

  // The host gives its actions to the editor after the first draw, and has no way to say when it changes them:
  // read them once more when the drawing is done, and again at every draw.
  const [, again] = useState(0);
  useEffect(() => {
    queueMicrotask(() => again((n) => n + 1));
  }, []);

  const bar = useRef<HTMLDivElement>(null);
  const { w } = useElementSize(bar);
  const folded = w > 0 && w < FOLD_MENUS_BELOW;

  const { close } = ui.actions;
  return (
    <div ref={bar} className={`ks-titlebar${conflict ? " is-conflict" : ""}${stacked ? " is-stacked" : ""}`}>
      {/* Full screen is left first, so the window is given back before the deck is closed. */}
      {close ? (
        <IconButton
          icon="arrow-left"
          label="Back"
          onClick={() => {
            ui.setFullScreen(false);
            close();
          }}
        />
      ) : null}
      <div className="ks-title-block">
        <DeckTitle session={session} ui={ui} />
        <FavouriteStar session={session} />
        <SaveStatus session={session} />
      </div>
      {folded ? <CollapsedMenu session={session} ui={ui} /> : <MenuBar session={session} ui={ui} />}
      <MenuSearch session={session} ui={ui} />
      <span className="ks-title-spacer" />
      <IconButton icon="sparkles" label="Assistant" on={panel === "ai"} onClick={() => void runCommand("view.ai-panel", ctx)} />
      {/* On, it says in words how to get out; the tooltip has the keys either way. */}
      <IconButton
        icon={fullScreen ? "minimize" : "maximize"}
        label={fullScreen ? "Exit full screen" : "Full screen"}
        keys={keysOf("view.full-screen")}
        on={fullScreen}
        {...(fullScreen ? { text: "Exit full screen" } : {})}
        onClick={() => void runCommand("view.full-screen", ctx)}
      />
      <SlideshowButton session={session} ui={ui} />
    </div>
  );
}
