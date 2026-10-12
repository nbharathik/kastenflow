import { useEffect, useState } from "react";

import { useShell } from "../../../lib/store";
import type { VaultClient } from "../../../lib/vault/types";
import { Icon } from "../../../ui/Icon";
import type { PageSession } from "./page-session";

/** The Markdown file as it is on disk, for the curious. */
export function SourcePanel({ session, client, body }: { session: PageSession; client: VaultClient; body: string }) {
  const [text, setText] = useState("");
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      void session.flush().then(() => client.read(session.path)).then((note) => !cancelled && setText(note.text));
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [session, client, body]);
  return (
    <aside className="kasten-page-source" aria-label="Markdown on disk">
      <div className="kasten-page-source-bar">
        <span>Markdown file</span>
        <button type="button" onClick={() => useShell.getState().toggleSource()} aria-label="Close Markdown">
          <Icon name="close" className="size-4" />
        </button>
      </div>
      <pre>{text}</pre>
    </aside>
  );
}
