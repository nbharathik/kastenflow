// The sidebar tree's rows for files a plugin owns (diagrams, for one): under
// a project after its decks, and among the Favourites. They come and go with
// the plugin, except that a file stays listed while its plugin is off: its row
// opens the tab that says what to turn on.

import { treeRows } from "../plugins/contributions";
import { pluginOff, usePluginOff } from "../plugins/off";
import { usePluginsVersion } from "../plugins/registry";
import type { PluginTreeRows } from "../plugins/types";
import { FavouriteDiagrams, ProjectDiagrams } from "./DiagramRows";

/** The rows of plugins that are off but whose files are still the person's: listed as plain files. */
const WHILE_OFF: Record<string, PluginTreeRows> = {
  diagrams: { owns: (path) => path.endsWith(".drawio"), ProjectRows: ProjectDiagrams, FavouriteRows: FavouriteDiagrams },
};

/** The trees to draw now: the plugins that are on, then the files of those that are off. */
function trees(): PluginTreeRows[] {
  return [...treeRows(), ...Object.entries(WHILE_OFF).flatMap(([id, tree]) => (pluginOff(id) ? [tree] : []))];
}

/** Draws again when a plugin is turned off or on. */
function useTreesVersion(): void {
  usePluginsVersion();
  usePluginOff("diagrams");
}

/** The favourites a plugin draws, by the order they were starred. Reads the registry, so call it where the sidebar draws. */
export function usePluginFavourites(favourites: readonly string[]): string[] {
  useTreesVersion();
  const all = trees();
  return favourites.filter((path) => all.some((t) => t.owns(path)));
}

/** A project's files that plugins own, listed after its decks. */
export function ProjectPluginRows({ project, depth }: { project: string; depth: number }) {
  useTreesVersion();
  return (
    <>
      {trees().map((tree, i) => (
        <tree.ProjectRows key={i} project={project} depth={depth} />
      ))}
    </>
  );
}

/** Favourites that plugins own. */
export function FavouritePluginRows({ paths }: { paths: readonly string[] }) {
  useTreesVersion();
  return (
    <>
      {trees().map((tree, i) => (
        <tree.FavouriteRows key={i} paths={paths.filter(tree.owns)} />
      ))}
    </>
  );
}
