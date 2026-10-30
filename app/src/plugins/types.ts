// What a plugin is: a manifest the catalogue lists, and the places in the
// window it may add to (its contributions). Everything here is optional, so a
// plugin gives only what it has, and with none turned on the window is the one
// it always was.

import type { ComponentType, LazyExoticComponent } from "react";

import type { IconName } from "../ui/Icon";
import type { Choice } from "../features/pages/editor/menus/catalog";
import type { HomeAction } from "../features/home/actions";
import type { Command } from "../features/workspace/overlays/commands";
import type { Place } from "../features/workspace/tabs";
import type { MenuItem } from "../shell/menu-types";
import type { NavGroup } from "../shell/nav";

/** The id of a view a plugin adds: `plugin:` and the plugin's own name. */
export type PluginViewId = `plugin:${string}`;

/** `vault`: the plugin's files live in the vault; `computer`: it needs a program on this computer. */
export type PluginScope = "vault" | "computer";

/** A download a plugin needs before it works, checked against a fixed checksum. */
export interface PluginPayload {
  url: string;
  sha256: string;
  bytes: number;
}

export interface PluginManifest {
  id: string;
  name: string;
  /** One plain sentence, shown in Settings. */
  summary: string;
  /** How a sentence about turning the plugin on names it, when that differs from `name` ("draw.io"). */
  offName?: string;
  icon: IconName;
  version: string;
  /** On for a vault that has not chosen yet. */
  defaultOn: boolean;
  scope: PluginScope;
  payload?: PluginPayload;
  /** The settings the plugin keeps, with their starting values. */
  settings?: Record<string, string | number | boolean>;
}

/** What a plugin's view is drawn with: the tab's place it was opened at. */
export interface PluginViewProps {
  place: Place;
}

export interface PluginView {
  id: PluginViewId;
  title: string;
  icon: IconName;
  /** Made with `React.lazy`, so the view's code loads when it is first opened. */
  lazy: LazyExoticComponent<ComponentType<PluginViewProps>>;
  /** What a tab at this view is called and drawn with, when the place names a file; null for the view's own face. */
  face?: (place: Place) => { icon: IconName; title: string } | null;
}

/** Opens files whose name ends in one of `ext` (".drawio", or "drawio") in `view`. */
export interface PluginFileHandler {
  ext: string[];
  view: PluginViewId;
  /** Narrows the handler to some files with these extensions (a `.bib` inside a LaTeX folder); without it, every file with the extension. */
  when?(path: string): boolean;
}

/** A row in the sidebar's list of views (shell/nav.ts). */
export interface PluginSidebarRow {
  id: PluginViewId;
  label: string;
  icon: IconName;
  group: NavGroup;
  /** Listed right after the row with this id (an app view or another plugin's); at the end of the list when absent or unknown. */
  after?: string;
  available?: () => boolean;
}

/** What a plugin shows in the sidebar's tree for the files it owns: under a project, and among the Favourites. */
export interface PluginTreeRows {
  /** Whether the file at `path` is one of this plugin's (a favourite of it is drawn by `FavouriteRows`). */
  owns(path: string): boolean;
  ProjectRows: ComponentType<{ project: string; depth: number }>;
  FavouriteRows: ComponentType<{ paths: readonly string[] }>;
}

export interface PluginSettingsSection {
  title: string;
  render: ComponentType;
}

/** A shortcut chip above the chat box. */
export interface PluginChatChip {
  id: string;
  label: string;
  run(): void;
}

/** An action in the AI writing menu. */
export interface PluginAiAction {
  id: string;
  label: string;
  run(): void;
}

/** A button on the toolbar that appears over selected text in a page. */
export interface PluginSelectionTool {
  id: string;
  label: string;
  /** The button's icon as SVG markup (24 by 24, drawn with `currentColor`). */
  icon: string;
  /** Called with the selection written as Markdown. */
  run(markdown: string): void;
}

export interface PluginContributions {
  views?: PluginView[];
  fileHandlers?: PluginFileHandler[];
  commands?: Command[];
  slash?: Choice[];
  newItems?: HomeAction[];
  sidebar?: PluginSidebarRow[];
  /** Rows in the sidebar's tree (under a project, in Favourites). */
  tree?: PluginTreeRows;
  settingsSection?: PluginSettingsSection;
  chatChips?: PluginChatChip[];
  aiActions?: PluginAiAction[];
  /** Items for the page's ••• menu. */
  pageMenu?: MenuItem[];
  /** Buttons for the toolbar over selected text in a page. */
  selectionTools?: PluginSelectionTool[];
}

/** One line of the catalogue: the manifest, and how to get the contributions when the plugin is turned on. */
export interface CatalogEntry {
  manifest: PluginManifest;
  load: () => Promise<PluginContributions>;
}
