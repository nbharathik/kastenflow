// The layout library in Kasten: layouts kept for every deck as small files in the vault's `templates/layouts/`, written by the core's
// ops. The editor knows an entry by the id inside its file; the core knows it by its path, so the path is looked up from the id each
// time. A file that cannot be used is left out of the list, and a save of an id that is there replaces that file (history keeps the old
// text). Removing moves the file to the trash.

import type { SlidesHost } from "@kasten-slides/react";

import type { VaultClient } from "../../lib/vault/types";

/** Everyone who listens for a change of the library: every editor open in the window hears a save made in any of them. */
const listeners = new Set<() => void>();
const changed = () => {
  for (const listener of [...listeners]) listener();
};

/** The `layoutLibrary` of the host for a vault, or nothing where the client keeps none (the browser preview). */
export function layoutLibraryHost(client: VaultClient): Pick<SlidesHost, "layoutLibrary"> {
  const list = client.layoutLibrary?.bind(client);
  const read = client.libraryLayout?.bind(client);
  const save = client.saveLibraryLayout?.bind(client);
  const take = client.removeLibraryLayout?.bind(client);
  if (!list || !read || !save) return {};

  const usable = async () => (await list()).filter((layout) => layout.problem === null && layout.id !== "");
  const pathOf = async (id: string): Promise<string> => {
    const found = (await usable()).find((layout) => layout.id === id);
    if (!found) throw new Error("That layout is no longer in My layouts.");
    return found.path;
  };

  return {
    layoutLibrary: {
      async list() {
        return (await usable()).map((layout) => ({ id: layout.id, label: layout.label, slots: layout.slots, modified: layout.modified }));
      },
      async read(id) {
        return (await read(await pathOf(id))).text;
      },
      async save(text) {
        await save(text);
        changed();
      },
      ...(take
        ? {
            async remove(id: string) {
              await take(await pathOf(id));
              changed();
            },
          }
        : {}),
      watch(onChange) {
        listeners.add(onChange);
        return () => void listeners.delete(onChange);
      },
    },
  };
}
