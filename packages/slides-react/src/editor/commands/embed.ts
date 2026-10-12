import { zoomSelectedEmbed } from "../../embed/zoom.ts";
import { selectedElements } from "../session/scope.ts";
import type { Command } from "./types.ts";

/**
 * The page of the selected embed: Ctrl plus, minus and zero zoom it, as they zoom a web page, and are the editor's own zoom of the slide
 * only when no embed is selected. They come before the view's zoom commands in the list of every command, which is how a key that two
 * commands have goes to the first one that can be done.
 */
const enabled: Command["enabled"] = (state) => {
  const chosen = selectedElements(state);
  return chosen.length === 1 && chosen[0]?.type === "embed" && !chosen[0].locked;
};

export const embedCommands: Command[] = [
  {
    id: "embed.zoom-in",
    label: "Zoom the page in",
    icon: "zoom-in",
    keys: ["Mod+=", "Mod+Plus"],
    scope: "canvas",
    enabled,
    run: ({ session }) => void zoomSelectedEmbed(session, "in"),
  },
  {
    id: "embed.zoom-out",
    label: "Zoom the page out",
    icon: "zoom-out",
    keys: ["Mod+-"],
    scope: "canvas",
    enabled,
    run: ({ session }) => void zoomSelectedEmbed(session, "out"),
  },
  {
    id: "embed.zoom-fit",
    label: "Fit the page to its box",
    icon: "maximize",
    keys: ["Mod+0"],
    scope: "canvas",
    enabled,
    run: ({ session }) => void zoomSelectedEmbed(session, "fit"),
  },
];
