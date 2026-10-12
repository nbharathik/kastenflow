import type { AlignMode, Arrange, Axis } from "@kasten-slides/wasm";

import { selectedElements } from "../session/scope.ts";
import type { IconName } from "../ui/icons.ts";
import type { Command } from "./types.ts";

const some = (s: { selection: readonly string[] }) => s.selection.length > 0;
const two = (s: { selection: readonly string[] }) => s.selection.length > 1;
const three = (s: { selection: readonly string[] }) => s.selection.length > 2;

const order = (id: string, label: string, to: Arrange, icon: IconName, keys: string): Command => ({
  id: `arrange.${id}`,
  label,
  icon,
  keys: [keys],
  scope: "canvas",
  enabled: some,
  run: ({ session }) => session.elements.arrange(to),
});

// One element aligns to the slide; two or more align to each other.
const align = (id: string, label: string, mode: AlignMode, icon: IconName): Command => ({
  id: `arrange.align-${id}`,
  label,
  icon,
  enabled: some,
  run: ({ session }) => session.elements.align(mode),
});

const distribute = (id: string, label: string, axis: Axis, icon: IconName): Command => ({
  id: `arrange.distribute-${id}`,
  label,
  icon,
  enabled: three,
  run: ({ session }) => session.elements.distribute(axis),
});

/** Arrange: stacking order, alignment, turning, grouping. */
export const arrangeCommands: Command[] = [
  order("front", "Bring to front", "front", "bring-to-front", "Mod+Shift+Up"),
  order("forward", "Bring forward", "forward", "arrow-up", "Mod+Up"),
  order("backward", "Send backward", "backward", "arrow-down", "Mod+Down"),
  order("back", "Send to back", "back", "send-to-back", "Mod+Shift+Down"),
  align("left", "Align left", "left", "align-start-vertical"),
  align("center", "Align centre", "centerH", "align-center-vertical"),
  align("right", "Align right", "right", "align-end-vertical"),
  align("top", "Align top", "top", "align-start-horizontal"),
  align("middle", "Align middle", "middleV", "align-center-horizontal"),
  align("bottom", "Align bottom", "bottom", "align-end-horizontal"),
  distribute("horizontal", "Distribute horizontally", "horizontal", "align-horizontal-distribute-center"),
  distribute("vertical", "Distribute vertically", "vertical", "align-vertical-distribute-center"),
  {
    id: "arrange.rotate-cw",
    label: "Rotate clockwise 90°",
    icon: "rotate-cw",
    enabled: some,
    run: ({ session }) => session.elements.rotateBy(90),
  },
  {
    id: "arrange.rotate-ccw",
    label: "Rotate counterclockwise 90°",
    icon: "rotate-cw",
    enabled: some,
    run: ({ session }) => session.elements.rotateBy(-90),
  },
  {
    id: "arrange.flip-horizontal",
    label: "Flip horizontally",
    icon: "arrow-left-right",
    enabled: some,
    run: ({ session }) => session.elements.flip("horizontal"),
  },
  {
    id: "arrange.flip-vertical",
    label: "Flip vertically",
    icon: "arrow-up-down",
    enabled: some,
    run: ({ session }) => session.elements.flip("vertical"),
  },
  {
    id: "arrange.group",
    label: "Group",
    icon: "group",
    keys: ["Mod+Alt+G"],
    scope: "canvas",
    enabled: two,
    run: ({ session }) => session.elements.group(),
  },
  {
    id: "arrange.ungroup",
    label: "Ungroup",
    icon: "ungroup",
    keys: ["Mod+Alt+Shift+G"],
    scope: "canvas",
    enabled: (s) => some(s) && selectedElements(s).some((e) => e.type === "group"),
    run: ({ session }) => session.elements.ungroup(),
  },
  {
    id: "arrange.lock",
    label: "Lock",
    icon: "lock",
    enabled: some,
    checked: (s) => some(s) && selectedElements(s).every((e) => e.locked),
    run: ({ session }) => {
      const picked = session.elements.find();
      session.elements.lock(!picked.every((e) => e.locked));
    },
  },
];
