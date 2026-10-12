import "./extension.css";

import { useEffect, useState } from "react";

import { Button } from "../../ui/Button";
import { Disclosure } from "../../ui/Disclosure";
import { Block, Group, Note, Row, Switch } from "../workspace/views/settings/parts";
import { extensionBackend } from "./backend";
import { PairingRow } from "./PairingRow";
import { useExtension } from "./store";
import { DEFAULT_PORT } from "./types";

/** Whether `text` is a port Settings accepts: a whole number from 1024 up. */
export const validPort = (text: string): boolean => /^\d{4,5}$/.test(text.trim()) && Number(text) >= 1024 && Number(text) <= 65535;

/** Settings → Browser extension: the switch (off until turned on), the port,
 * pairing, the extensions paired, and how to put the extension in Chrome or Edge. */
export function ExtensionSettings({ pollMs = 1500 }: { pollMs?: number }) {
  const status = useExtension((s) => s.status);
  const problem = useExtension((s) => s.problem);
  const available = extensionBackend().available;
  const port = status?.port ?? DEFAULT_PORT;
  const [draft, setDraft] = useState(String(port));

  useEffect(() => {
    void useExtension.getState().refresh();
  }, []);
  // The port the app reports is the one shown, after a change or a refresh.
  useEffect(() => {
    setDraft(String(port));
  }, [port]);

  const change = useExtension.getState().change;
  const trouble = problem ?? status?.problem ?? null;

  return (
    <Group title="Browser extension">
      {available ? (
        <Switch id="extension.enabled" usual={false} checked={status?.enabled ?? false} onChange={(on) => void change((b) => b.setEnabled(on))} />
      ) : (
        <Row id="extension.enabled" help="The extension talks to the desktop app.">
          <span className="text-13 text-muted">Needs the desktop app</span>
        </Row>
      )}
      {trouble && <Note tone="danger">{trouble}</Note>}
      {status?.enabled && <Note>{status.running ? `Open on 127.0.0.1:${status.port}, this computer only.` : "Shut: KastenFlow could not open its port. Pick another one below."}</Note>}
      <Row id="extension.port">
        <input
          type="text"
          inputMode="numeric"
          className="ui-field w-24"
          aria-label="Port"
          value={draft}
          disabled={!available}
          onChange={(event) => setDraft(event.target.value)}
        />
        <Button size="sm" disabled={!available || !validPort(draft) || Number(draft) === port} onClick={() => void change((b) => b.setPort(Number(draft)))}>
          Change
        </Button>
      </Row>
      <PairingRow pollMs={pollMs} />
      <Block id="extension.install" titled>
        <Disclosure id="settings-extension-steps" title="Show the steps">
          <ol className="kasten-extension-steps text-13 text-muted">
            <li>Open chrome://extensions (edge://extensions in Edge) and turn on Developer mode.</li>
            <li>Choose Load unpacked, and pick the browser-extension folder from KastenFlow&rsquo;s source download. Its README has the details.</li>
            <li>Pin the extension, open it, press Pair here and type the code into it.</li>
            <li>Then press its button on a page, or right-click a page, a selection, a link or a picture and choose Send to KastenFlow.</li>
          </ol>
        </Disclosure>
      </Block>
    </Group>
  );
}
