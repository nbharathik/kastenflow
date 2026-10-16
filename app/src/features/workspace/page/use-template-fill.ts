// "Template…" in the slash menu of an empty page: the gallery, and filling
// the page from the template picked.

import { useShell } from "../../../lib/store";
import type { NoteMeta, VaultClient } from "../../../lib/vault/types";
import { projectTemplateFor } from "../../projects/page-template";
import { useWorkspace } from "../store";
import { passTyping } from "./open-page";
import type { PageSession } from "./page-session";
import type { useNoteSession } from "./use-note-session";

/** Opens the gallery on the project's own template when it names one;
 * nothing shows until asked. */
export function useTemplateFill(
  client: VaultClient,
  session: PageSession,
  onReload: ReturnType<typeof useNoteSession>["reload"],
  live: NoteMeta,
  notes: NoteMeta[],
): () => void {
  /** Fills the blank page from a template; the page goes on either way. */
  const fillFrom = async (template: string) => {
    passTyping(session);
    await session.close();
    const filled = await useWorkspace.getState().applyTemplate(session.path, template);
    // Refused (toasted): the page goes on with a live session all the same.
    const next = filled ?? (await client.read(session.path).catch(() => null));
    if (next) onReload(next);
  };
  return () => useShell.getState().openGallery({ onPick: (template: string) => void fillFrom(template), select: projectTemplateFor(live, notes) ?? undefined });
}
