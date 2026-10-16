// Following a `kasten:` link (lib/kasten-links.ts). A link only ever opens a
// place: a page at a heading, a PDF at a page and highlight, a board at a
// card or section, a deck. One whose target is missing or in the trash says
// so in a notice. Nothing here runs an op that changes the vault.

import { parseKastenLink, type KastenLink } from "../../lib/kasten-links";
import type { VaultClient } from "../../lib/vault/types";
import { showSpot } from "../sources/highlight-request";
import { openAt } from "./page/jump";
import { requestBoardNode } from "./place-requests";
import { useWorkspace, type OpenHow } from "./store";

const GONE = {
  note: "That page is not in the vault any more. It may be in the trash",
  pdf: "That PDF is not in the vault any more",
  board: "That whiteboard is not in the vault any more. It may be in the trash",
  deck: "That deck is not in the vault any more. It may be in the trash",
} as const;

async function open(link: KastenLink, client: VaultClient, how: OpenHow | undefined): Promise<string | null> {
  const workspace = useWorkspace.getState();
  switch (link.kind) {
    case "note": {
      const note = workspace.notes.find((n) => n.id === link.id);
      if (!note) return GONE.note;
      if (link.heading) openAt(note.path, { heading: link.heading, ...(link.nth ? { nth: link.nth } : {}) }, how);
      else workspace.openPath(note.path, how);
      return null;
    }
    case "pdf": {
      if (!(await client.sources()).some((s) => s.path === link.path)) return GONE.pdf;
      showSpot({ source: link.path, page: link.page, ...(link.highlight ? { highlight: link.highlight } : {}) }, how);
      return null;
    }
    case "board": {
      if (!(await client.boards()).some((b) => b.path === link.path)) return GONE.board;
      if (link.node) requestBoardNode(link.path, link.node);
      workspace.openPath(link.path, how);
      return null;
    }
    case "deck": {
      // A deck is found by its path; its slide is not asked for yet.
      if (!(await client.decks()).some((d) => d.path === link.ref)) return GONE.deck;
      workspace.openPath(link.ref, how);
      return null;
    }
  }
}

/** Opens what the address names, or says why it cannot. Never throws. */
export async function openKastenLink(href: string, how?: OpenHow): Promise<void> {
  const { client, toast } = useWorkspace.getState();
  const link = parseKastenLink(href);
  if (!link) return toast("That link is not one KastenFlow can open");
  if (!client) return;
  try {
    const gone = await open(link, client, how);
    if (gone) toast(gone);
  } catch (err) {
    toast(err instanceof Error ? err.message : String(err));
  }
}
