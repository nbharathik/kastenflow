import { type JSX, useMemo, useRef } from "react";

import { keysOf, runCommand } from "../commands/index.ts";
import { useKeptLibrary } from "../layouts/library-cache.ts";
import { LintCount } from "../lint/LintCount.tsx";
import { CollapsedMenu } from "../menus/CollapsedMenu.tsx";
import { MenuBar } from "../menus/MenuBar.tsx";
import { MenuSearch } from "../menus/MenuSearch.tsx";
import type { EditorSession } from "../session/session.ts";
import type { EditorUi } from "../ui-state.ts";
import { IconButton } from "../ui/Button.tsx";
import { useAiStatus } from "../panels/ai/useAiStatus.ts";
import { useEditorValue } from "../useEditor.ts";
import { useElementSize } from "../useElementSize.ts";
import { useUiState } from "../useUi.ts";
import { DeckTitle } from "./DeckTitle.tsx";
import { FavouriteStar } from "./FavouriteStar.tsx";
import { MoreMenu } from "./MoreMenu.tsx";
import { SaveStatus } from "./SaveStatus.tsx";
import { SlideshowButton } from "./SlideshowButton.tsx";
import "./titlebar.css";

/** What the Assistant button says besides its name when the assistant is not at rest. */
const AI_WORDS = { working: "working", paused: "paused", failed: "last request failed" } as const;

/** Below this width the menus fold into one button: the name, the search and the buttons at the right would otherwise squeeze them. */
const FOLD_MENUS_BELOW = 1060;

/** Below this width the assistant and full screen buttons fold into one More menu: the name, the Menu button and Slideshow need the room. */
const MORE_BELOW = 560;

/**
 * The slim bar at the top, one row: a way back to the library when the host gives one, a Home button when it has a home for decks (a
 * house with "Slides" beside it, the mark alone in a narrow bar), the deck's name (click to rename) with its star
 * and where saving stands, the menus File to Help (one Menu button in a narrow window) and the search over them, and at the right the
 * assistant, full screen and Slideshow. While saving is paused the banner that says so takes a row of its own under these.
 */
export function TitleBar({ session, ui }: { session: EditorSession; ui: EditorUi }): JSX.Element {
  const status = useEditorValue(session, (state) => state.saving.status);
  const conflict = status === "conflict";
  // A message that needs reading (saving paused, or failed) is too long to share the row with the menus.
  const stacked = conflict || status === "error";
  const { panel, fullScreen } = useUiState(ui);
  // What the assistant is doing for this deck shows on its button, so it is seen with the panel closed.
  const aiStatus = useAiStatus(session.host);
  const ctx = useMemo(() => ({ session, ui }), [session, ui]);
  // My layouts are read for as long as the editor is open, so the Layout menu can list them the moment it opens.
  useKeptLibrary(session);

  // The host gives its actions to the editor after the first draw: setting them bumps `actionsRevision`, which `useUiState` follows,
  // so the bar is drawn again with them.
  const bar = useRef<HTMLDivElement>(null);
  const { w } = useElementSize(bar);
  const folded = w > 0 && w < FOLD_MENUS_BELOW;
  const tight = w > 0 && w < MORE_BELOW;

  const { close, home } = ui.actions;
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
      {/* Home is the list of decks, Back the place the person came from: both can be there, and Home says where it goes in words. */}
      {home ? <IconButton icon="house" label="Slides home" keys={keysOf("view.home")} text="Slides" className="ks-home-btn" onClick={() => void runCommand("view.home", ctx)} /> : null}
      <div className="ks-title-block">
        <DeckTitle session={session} ui={ui} />
        <FavouriteStar session={session} />
        <SaveStatus session={session} />
        <LintCount session={session} ui={ui} />
      </div>
      {folded ? <CollapsedMenu session={session} ui={ui} /> : <MenuBar session={session} ui={ui} />}
      <MenuSearch session={session} ui={ui} />
      <span className="ks-title-spacer" />
      {tight ? (
        // Too narrow for the two buttons: they move into one More menu rather than being clipped.
        <MoreMenu session={session} ui={ui} {...(aiStatus === "idle" ? {} : { dot: aiStatus })} />
      ) : (
        <>
          <IconButton
            icon="sparkles"
            label={aiStatus === "idle" ? "Assistant" : `Assistant, ${AI_WORDS[aiStatus]}`}
            on={panel === "ai"}
            {...(aiStatus === "idle" ? {} : { dot: aiStatus })}
            onClick={() => void runCommand("view.ai-panel", ctx)}
          />
          {/* On, it says in words how to get out; the tooltip has the keys either way. */}
          <IconButton
            icon={fullScreen ? "minimize" : "maximize"}
            label={fullScreen ? "Exit full screen" : "Full screen"}
            keys={keysOf("view.full-screen")}
            on={fullScreen}
            {...(fullScreen ? { text: "Exit full screen" } : {})}
            onClick={() => void runCommand("view.full-screen", ctx)}
          />
        </>
      )}
      <SlideshowButton session={session} ui={ui} />
    </div>
  );
}
