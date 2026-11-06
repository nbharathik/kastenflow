// Putting an icon on the slide: the SVG picture is kept in the host's image store (the same bytes are the same picture, so an icon
// of one colour used ten times is one file), and the picture element goes in the largest free place as one step of undo.

import type { Element } from "@kasten-slides/wasm";

import { insertPlaced } from "../insert-composite.ts";
import type { EditorSession } from "../session/session.ts";
import { type IconName } from "../ui/icons.ts";
import { ICON_LIBRARY, type IconLook, iconSvg } from "./icon-library.ts";

/** The theme colours an icon is offered in, as `#rrggbb`, with the names a person knows them by. */
export function iconColors(session: EditorSession): { label: string; hex: string }[] {
  const { colors } = session.deck.theme;
  const choices: [string, string][] = [
    ["Text", colors.text1],
    ["Accent 1", colors.accent1],
    ["Accent 2", colors.accent2],
    ["Accent 3", colors.accent3],
    ["Accent 4", colors.accent4],
    ["Accent 5", colors.accent5],
    ["Accent 6", colors.accent6],
    ["Background", colors.bg1],
  ];
  return choices.flatMap(([label, value]) => (/^#[0-9a-f]{6}$/i.test(value) ? [{ label, hex: value.toLowerCase() }] : []));
}

/**
 * Adds the icon as a square picture `units` wide on a 960-wide slide (scaled to the deck's width), named and described for people who
 * cannot see it. Resolves to the new element's id, or undefined when the picture could not be kept.
 */
export async function insertIcon(session: EditorSession, name: IconName, look: IconLook, units: number): Promise<string | undefined> {
  const label = ICON_LIBRARY.find((icon) => icon.name === name)?.label ?? name;
  const bytes = new TextEncoder().encode(iconSvg(name, look));
  const path = await session.host.addImage(`icon-${name}-${look.color.replace("#", "")}.svg`, bytes, { source: "file" });
  const side = Math.round((units * session.deck.size.w) / 960);
  const element = { type: "image", id: "", src: path, name: `Icon: ${label}`, alt: label } as Element;
  return insertPlaced(session, element, { w: side, h: side });
}
