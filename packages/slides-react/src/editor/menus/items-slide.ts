// The Slide sub-menus, shared by the menu bar and the right-click menu in the filmstrip.

import type { CommandContext } from "../commands/index.ts";
import { type Row, commandItem } from "./build.ts";

/**
 * What New slide makes: a blank slide or one on the layout of the slide shown (one of the two is checked). In the sub-menu that is
 * already called New slides they are "Blank" and "Same as current"; `long` gives the commands' own names, for a menu of layouts.
 */
export const newSlidesItems = (ctx: CommandContext, names: "short" | "long" = "short"): Row[] => [
  commandItem("slide.new-blank", ctx, names === "short" ? { label: "Blank" } : {}),
  commandItem("slide.new-same", ctx, names === "short" ? { label: "Same as current" } : {}),
  commandItem("slide.new-mine", ctx, names === "short" ? { label: "My default layout" } : {}),
];

/** Move the slide up, down, to the beginning, to the end. */
export const moveSlideItems = (ctx: CommandContext): Row[] => ["slide.up", "slide.down", "slide.to-start", "slide.to-end"].map((id) => commandItem(id, ctx));

/** The Steps sub-menu of the Slide menu: the builds, and stepping through the slide on the canvas. */
export const stepItems = (ctx: CommandContext): Row[] => [
  commandItem("steps.reveal", ctx, { label: "Reveal one by one" }),
  commandItem("steps.walkthrough", ctx, { label: "Walk through" }),
  commandItem("steps.spotlight", ctx, { label: "Spotlight" }),
  commandItem("steps.clear", ctx, { label: "Clear steps" }),
  commandItem("steps.next", ctx),
  commandItem("steps.previous", ctx),
  commandItem("view.steps-panel", ctx),
];
