import { SlidesEditor, type EditorSession, type EditorUi } from "@kasten-slides/react";
import { useEffect, useRef, useState } from "react";

import { Icon } from "../../ui/Icon";
import { useWorkspace } from "../workspace/store";
import { onDeckFiles } from "./events";
import { type KastenHost, kastenHost } from "./kasten-host";
import { PagePickerHost } from "./PagePicker";
import "./slides.css";

type Loaded = { status: "loading" } | { status: "failed"; message: string } | { status: "ready"; text: string; host: KastenHost };

/** A deck open in a tab: the editor on the file, saving through the vault. */
export function DeckView({ path }: { path: string }) {
  const client = useWorkspace((s) => s.client)!;
  const toast = useWorkspace((s) => s.toast);
  const [loaded, setLoaded] = useState<Loaded>({ status: "loading" });
  const editing = useRef<{ session: EditorSession; ui: EditorUi } | null>(null);

  useEffect(() => {
    let live = true;
    setLoaded({ status: "loading" });
    client.deck(path).then(
      (file) => live && setLoaded({ status: "ready", text: file.text, host: kastenHost(client, path, file.hash, (message) => toast(message)) }),
      (err: unknown) => live && setLoaded({ status: "failed", message: err instanceof Error ? err.message : String(err) }),
    );
    return () => {
      live = false;
    };
  }, [client, path, toast]);

  // The file changed outside the editor: an agent, another window, a sync.
  useEffect(() => {
    return onDeckFiles((paths) => {
      if (!paths.includes(path)) return;
      void client.deck(path).then(
        (file) => editing.current?.session.receive(file.text),
        () => {},
      );
    });
  }, [client, path]);

  if (loaded.status === "loading") return <div className="grid h-full place-items-center text-14 text-muted">Opening the deck…</div>;
  if (loaded.status === "failed") {
    return (
      <div role="alert" className="mx-auto mt-24 max-w-[420px] text-center">
        <Icon name="alert" className="mx-auto size-7 text-danger" />
        <p className="mt-3 text-14">This deck could not be opened.</p>
        <p className="mt-1 text-13 text-muted">{loaded.message}</p>
      </div>
    );
  }
  return (
    <div className="ks-host h-full">
      <SlidesEditor
        key={path}
        text={loaded.text}
        host={loaded.host}
        onError={(message) => toast(message)}
        onSession={(session, ui) => {
          editing.current = session && ui ? { session, ui } : null;
          // Browser checks and scripts reach the editor through this, in development builds and in the preview with sample data.
          if (import.meta.env.DEV || new URLSearchParams(location.search).has("samples")) Object.assign(window, { __ks: session && ui ? { session, ui, host: loaded.host } : undefined });
        }}
      />
      {/* Insert → Page…: the editor asks the host which page, and this is where the person answers. */}
      <PagePickerHost />
    </div>
  );
}
