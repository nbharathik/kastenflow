import { type JSX, useEffect, useMemo, useState } from "react";

import { MATTES, readMatte, writeMatte } from "../../present/matte.ts";
import { readControls, readKeepInk, readToolbar, writeControls, writeKeepInk, writeToolbar } from "../../present/options.ts";
import type { ScreenInfo } from "../host.ts";
import { keysOf, runCommand } from "../commands/index.ts";
import { SEPARATOR, commandItem, groups, plainItem, submenu } from "../menus/build.ts";
import type { MenuItem } from "../ui/Menu.tsx";
import { INTERVALS, intervalName, intervalOf, isLooping, setAutoAdvance, setLoop, showsOf } from "./present-settings.ts";
import { DropMenu } from "../menus/DropMenu.tsx";
import { useDropdown } from "../menus/useDropdown.ts";
import type { EditorSession } from "../session/session.ts";
import type { EditorUi } from "../ui-state.ts";
import { Icon } from "../ui/Icon.tsx";
import { loadScreens, presentOnRows } from "./present-on.ts";

/**
 * Slideshow: the button that presents from the slide shown, and a caret beside it with the other ways to start: from the beginning, in
 * the presenter's view, as a page to scroll. It is the one filled button of the bar.
 */
export function SlideshowButton({ session, ui }: { session: EditorSession; ui: EditorUi }): JSX.Element {
  const dd = useDropdown();
  const ctx = useMemo(() => ({ session, ui }), [session, ui]);
  const can = ui.actions.present !== undefined;
  // The displays attached are asked for when the options open: one may have been plugged in since.
  const screens = session.host.screens;
  const [displays, setDisplays] = useState<string[]>([]);
  const [info, setInfo] = useState<ScreenInfo[]>([]);
  const opened = dd.anchor !== null;
  useEffect(() => {
    if (!screens || !opened) return;
    let current = true;
    void loadScreens(screens).then((found) => {
      if (!current) return;
      setDisplays(found.names);
      setInfo(found.info);
    });
    return () => {
      current = false;
    };
  }, [screens, opened]);
  return (
    <div className="ks-present">
      <button
        type="button"
        className="ks-btn ks-text-btn is-primary ks-present-main"
        aria-label="Slideshow"
        disabled={!can}
        data-tip={can ? `Slideshow from this slide (${keysOf("view.present") ?? "Ctrl+Enter"})` : "Presenting is not available here"}
        onClick={() => void runCommand("view.present", ctx)}
      >
        <Icon name="play" size={14} />
        <span className="ks-present-label">Slideshow</span>
      </button>
      <button type="button" className="ks-btn ks-text-btn is-primary ks-present-caret" aria-label="Slideshow options" data-tip="Slideshow options" disabled={!can} {...dd.trigger}>
        <Icon name="chevron-down" size={14} />
      </button>
      <DropMenu
        dd={dd}
        ui={ui}
        label="Slideshow options"
        items={() => {
          const matte = readMatte();
          const controls = readControls();
          const toolbar = readToolbar();
          const on = presentOnRows(screens, displays, info);
          const deck = session.deck;
          const shows = showsOf(deck);
          const looping = isLooping(deck);
          const interval = intervalOf(deck);
          const ink = readKeepInk();
          return groups(
            [
              commandItem("view.present-start", ctx, { label: "Present from beginning" }),
              commandItem("view.present", ctx, { label: "Present from current slide" }),
              commandItem("view.presenter", ctx),
              commandItem("view.rehearse", ctx),
              commandItem("view.rehearsals", ctx),
              commandItem("view.present-scroll", ctx),
            ],
            // The keys of a show on a card; the show lists the same ones with "?".
            [commandItem("view.presenting-help", ctx)],
            // Where people look for it: with the ways to start, not among the options (it appears with two or more displays).
            on.length > 0 && [submenu("present-on", "Present on", on, "monitor-play")],
            // How the deck is shown: just some of its slides, round and round, on its own, and whether the pen's ink stays on its slide.
            [
              submenu("custom-show", "Custom show", [
                ...shows.map((show) => plainItem(`show-${show.id}`, show.name, () => ui.actions.present?.("start", { show: show.id }))),
                shows.length > 0 && SEPARATOR,
                plainItem("shows-edit", shows.length > 0 ? "Edit custom shows…" : "New custom show…", () => ui.openDialog("custom-shows")),
              ].filter((item): item is MenuItem => item !== false)),
              plainItem("loop", "Loop until Esc", () => setLoop(session, !looping), { checked: looping }),
              submenu(
                "auto-advance",
                "Move on by itself",
                INTERVALS.map((seconds) => plainItem(`auto-${seconds}`, intervalName(seconds), () => setAutoAdvance(session, seconds), { checked: seconds === interval })),
              ),
              plainItem("keep-ink", "Keep pen ink on its slide", () => writeKeepInk(!ink), { checked: ink }),
            ],
            [
              // A slide is shown whole and centred at its own proportions, never cropped or scrolled; the matte is what shows round it on a screen of another shape.
              plainItem("fit", "Fit slide to window", () => {}, { checked: true, disabled: true }),
              submenu(
                "matte",
                "Colour round the slide",
                MATTES.map((choice) => plainItem(`matte-${choice.value}`, choice.label, () => writeMatte(choice.value), { checked: choice.value === matte })),
                "palette",
              ),
              // The arrows and the progress bar of the show: off, so a talk is the slide and nothing else.
              plainItem("controls", "Arrows and progress bar", () => writeControls(!controls), { checked: controls }),
              // The mouse tools at the bottom left of the show; off for a screen with nothing on it but the slide.
              plainItem("toolbar", "Show the toolbar while presenting", () => writeToolbar(!toolbar), { checked: toolbar }),
            ],
          );
        }}
      />
    </div>
  );
}
