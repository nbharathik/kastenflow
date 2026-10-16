// What every element of a slide is drawn with. It is one object so that the
// views of elements can be skipped, when nothing they draw with has changed,
// by comparing a single reference.

import type { Element, Theme } from "@kasten-slides/wasm";

import type { Box } from "../theme/index.ts";
import type { TextFields } from "../text/TextBlock.tsx";

/**
 * How a slide is drawn. `edit` shows what an editor needs: prompts in empty
 * placeholders, outlines of what a step hides. `present`, `thumbnail` and
 * `export` show the slide as an audience sees it; a thumbnail and an export
 * also take no clicks.
 */
export type SlideMode = "edit" | "present" | "thumbnail" | "export";

/** Turns an image path stored in a deck into a URL the page can load; undefined when there is none yet. */
export type ImageUrl = (src: string) => string | undefined;

export interface RenderCx {
  readonly theme: Theme;
  /** The name of the layout the slide uses, where placeholders are looked up. */
  readonly layout: string;
  readonly mode: SlideMode;
  /** The step being shown; undefined ignores steps and shows everything as it is styled. */
  readonly step: number | undefined;
  readonly imageUrl: ImageUrl | undefined;
  readonly fields: TextFields;
  /** The slide's size in units, for the group frame that holds children in slide coordinates. */
  readonly size: { readonly w: number; readonly h: number };
  /** The colour behind everything on the slide, for what has to blend in with it, such as the chip under a connector's label. */
  readonly paper: string;
  /** Whether the element being drawn comes from the theme's master rather than from the slide. */
  readonly master: boolean;
}

/** The cell of a table whose words an editor draws over the slide: the table, and the first row and column of the cell. */
export interface HiddenCell {
  id: string;
  row: number;
  col: number;
}

/** The view of one element: the element, the box it occupies, and how it is drawn. */
export interface ViewProps<T extends Element["type"]> {
  element: Extract<Element, { type: T }>;
  box: Box;
  cx: RenderCx;
  /** Whether an editor draws this element's text over it, so the view leaves it out. */
  hideText: boolean;
  /** For a table: the cell whose words an editor draws over it, so the view leaves out those alone. */
  hideCell?: Omit<HiddenCell, "id"> | null;
}
