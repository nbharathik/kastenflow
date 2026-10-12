// What the sections plugin keeps, and the messages it is sent.

import { PluginKey } from "@milkdown/kit/prose/state";
import type { DecorationSet } from "@milkdown/kit/prose/view";
import { $ctx } from "@milkdown/kit/utils";

/** Which page this editor shows, for the folds kept for it: its note id, or
 * its path while it is a draft. None keeps no folds. */
export const foldKeyCtx = $ctx<string | null, "kastenFoldKey">(null, "kastenFoldKey");

/** Whether the page is drawn as slide-like cards (the sections layout) when
 * the editor is made; `setSmart` changes it afterwards. */
export const smartCtx = $ctx<boolean, "kastenSmart">(false, "kastenSmart");

/** Called when "/smart page" turns the sections layout on, so the page can
 * keep it (its `layout: sections` key). The editor draws the layout itself. */
export const smartPageCtx = $ctx<(() => void) | null, "kastenSmartPage">(null, "kastenSmartPage");

/** What a transaction asks of the sections layout and the presentation. */
export const SMART_META = "kasten-sections-smart";

export type SmartMeta =
  /** Draws the sections as cards, or as the plain page. */
  | { smart: boolean }
  /** Shows only the slide at this index (read-only), or null to end. */
  | { present: number | null };

/** The sections layout and the presentation. Both draw from the page's
 * top-level blocks and neither touches the Markdown. */
export interface SmartState {
  /** The sections are drawn as cards, each with a title bar. */
  on: boolean;
  /** The slide shown while presenting, or null. */
  present: number | null;
  /** How many slides there are while presenting; 0 otherwise. */
  slides: number;
  /** The title of the slide shown, for the progress; empty when not presenting. */
  title: string;
  /** The slide shown is the whole page, so nothing is hidden. */
  whole: boolean;
  /** The cards, or the one slide shown. */
  decorations: DecorationSet;
  /** The fold state the cards were drawn for. */
  foldRev: number;
  /** Counts the edits inside one block that left the cards where they were, so the title bar of the section edited reads its title again. */
  typed: number;
  /** Where the last of those edits was. */
  typedAt: number;
}

/** A transaction with this meta replaced the page's whole text, as opening a
 * note does: its folds are read from what was kept. */
export const LOAD_META = "kasten-load";

export type SectionsMeta =
  /** Folds or unfolds the sections with these keys (a divider's position, or START). */
  | { set: readonly number[]; folded: boolean }
  /** Folds every section that holds blocks, or unfolds them all. */
  | { all: boolean };

/** The blocks of a folded section, which are not shown. */
export interface HiddenRange {
  key: number;
  from: number;
  to: number;
}

export interface SectionsState {
  /** The sections folded, each by its divider's position (START for the first). */
  folded: ReadonlySet<number>;
  /** Where the first divider is, or null when the page has none. */
  first: number | null;
  /** The blocks of the folded sections that hold any. */
  hidden: readonly HiddenRange[];
  /** Hides those blocks and shows a row for each folded section. */
  decorations: DecorationSet;
  /** Changes whenever the folded sections change, whatever their positions do. */
  rev: number;
  /** The sections layout and the presentation (smart.ts). */
  smart: SmartState;
}

export const sectionsKey = new PluginKey<SectionsState>("KASTEN_SECTIONS");
