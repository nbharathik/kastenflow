// A deck's saved versions for the editor's Deck → History…: the commits of the vault that changed the deck's file, and the file's text at one.
// Nothing here writes: restoring is the editor's, which puts the old version in as an ordinary change that is saved as a new version.

import type { DeckHistoryHost } from "@kasten-slides/react";

import type { CommitInfo, VaultClient } from "../../lib/vault/types";

/** The most versions listed. */
const MOST = 200;

/** Who made a commit, in words for a person: an assistant by its session's name, anyone else as "You". */
export function whoMade(commit: Pick<CommitInfo, "agent" | "author">): string {
  if (!commit.agent) return "You";
  const name = commit.author.replace(/^agent:/, "").trim();
  return name === "" ? "Assistant" : `Assistant (${name})`;
}

export function deckHistory(client: Pick<VaultClient, "history" | "version">, path: string): DeckHistoryHost {
  return {
    async versions() {
      const log = await client.history(path, MOST);
      return log
        .filter((commit) => commit.merge !== true)
        .map((commit) => ({ id: commit.id, time: commit.time, author: whoMade(commit), summary: commit.summary }));
    },
    async read(id) {
      return (await client.version(id, path)) ?? undefined;
    },
  };
}
