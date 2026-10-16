// An editor that is open on a diagram when an agent's change to it is applied
// (the chat's change bar, or a tool that writes at once): the file on disk is
// ahead of what the editor shows. With nothing unsaved in the editor, it loads
// the file. With something unsaved, nothing is loaded over it: the person's next
// save goes to a copy beside the changed file, as it does for any change made
// elsewhere, and they are told.

import { useEffect, useRef, type RefObject } from "react";

import type { VaultClient } from "../../../lib/vault/types";
import type { DrawioSession } from "../session";
import { onDiagramChanged } from "../store";

/** `same`: the file is what the editor has (or its own write is landing). `loaded`: the editor now shows the file. `kept`: the
 * editor has unsaved work, so the file was not loaded; `hash` is the file's version that was passed over. */
export type Reloaded = { outcome: "same" } | { outcome: "loaded"; hash: string } | { outcome: "kept"; hash: string };

/** Compares the file with the editor and loads it into the editor when that loses nothing. Never throws: an unreadable file is "same". */
export async function reloadFromDisk(client: Pick<VaultClient, "diagram">, session: DrawioSession): Promise<Reloaded> {
  let file: Awaited<ReturnType<VaultClient["diagram"]>>;
  try {
    file = await client.diagram(session.path);
  } catch {
    return { outcome: "same" };
  }
  if (file.hash === session.hash) return { outcome: "same" };
  // The session's own write: it tells again when it lands, and then the hashes agree.
  if (session.writing) return { outcome: "same" };
  // Read again here: the person may have drawn while the file was read.
  if (session.unsaved) return { outcome: "kept", hash: file.hash };
  return session.adopt(file.xml, file.hash) ? { outcome: "loaded", hash: file.hash } : { outcome: "kept", hash: file.hash };
}

/** Keeps the open editor in step with its file: whenever the diagram's files change, the file is compared and loaded as above. */
export function useReloadOnChange(options: { client: VaultClient | null; session: RefObject<DrawioSession | null>; onLoaded(): void; onKept(): void }): void {
  const { client, session } = options;
  const say = useRef(options);
  say.current = options;
  // A version of the file that the person was already told about is not told again.
  const told = useRef<string | null>(null);
  useEffect(() => {
    if (!client) return;
    return onDiagramChanged((changed) => {
      const open = session.current;
      if (!open || changed !== open.path) return;
      void reloadFromDisk(client, open).then((result) => {
        if (result.outcome === "loaded") say.current.onLoaded();
        else if (result.outcome === "kept" && told.current !== result.hash) {
          told.current = result.hash;
          say.current.onKept();
        }
      });
    });
  }, [client, session]);
}
