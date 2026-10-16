// A collection's icon as the app draws it: an emoji, one of the line icons
// written "icon:book", or a line icon's bare name as the file may have it
// (`icon: book`).

import { lineIcon, lineIconName } from "../../ui/glyph";
import { ICONS, type IconName } from "../../ui/icons";

/** The icon string `IconOrEmoji` draws for a collection. */
export function collectionIcon(icon: string | null | undefined): string {
  const text = icon?.trim() ?? "";
  if (text === "") return lineIcon("search");
  if (lineIconName(text) !== null) return text;
  return Object.hasOwn(ICONS, text) ? lineIcon(text as IconName) : text;
}
