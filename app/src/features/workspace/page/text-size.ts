// The sizes of page text: what each is called and how large it draws.

import type { TextSize } from "../prefs";

/** Page text in pixels at the usual 16px root. */
export const TEXT_PX: Record<TextSize, number> = { small: 14, normal: 16, large: 18, xl: 20 };

/** `--page-font-size` for a size. It is in rem, as the type scale is, so it
 * follows the root rather than a fixed pixel. */
export const pageFontSize = (size: TextSize): string => `${TEXT_PX[size] / 16}rem`;

export const TEXT_CHOICES: readonly { id: TextSize; label: string; short: string }[] = [
  { id: "small", label: "Small", short: "Small" },
  { id: "normal", label: "Normal", short: "Normal" },
  { id: "large", label: "Large", short: "Large" },
  { id: "xl", label: "Extra large", short: "XL" },
];
