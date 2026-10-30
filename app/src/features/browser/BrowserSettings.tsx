import { useState } from "react";

import { reflectBrowser } from "../../plugins/browser/link";
import { Button } from "../../ui/Button";
import { Block, Group, Note, resetOf, Row, Segmented, Switch } from "../workspace/views/settings/parts";
import { browserBackend } from "./backend";
import { enginesOf, useBrowserPrefs, validEngineUrl, type WebLinks } from "./prefs";

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Settings → Browser: the switch (off until turned on), the search engine,
 * favourite sites, where web links in pages open, and the browser's own data. */
export function BrowserSettings() {
  const prefs = useBrowserPrefs();
  const available = browserBackend().available;
  const [problem, setProblem] = useState<string | null>(null);
  const [cleared, setCleared] = useState(false);
  const engines = enginesOf(prefs.custom);

  const turn = (on: boolean) => {
    setProblem(null);
    // The app's switch is the computer's; the Plugins page and the palette read the same one, so tell them.
    prefs
      .turn(on)
      .then((now) => reflectBrowser(now))
      .catch((err: unknown) => setProblem(message(err)));
  };

  return (
    <Group title="Browser">
      {available ? (
        <Switch id="browser.enabled" usual={false} checked={prefs.enabled} onChange={turn} />
      ) : (
        <Row id="browser.enabled" help="Web pages are shown by the app's own web view.">
          <span className="text-13 text-muted">Needs the desktop app</span>
        </Row>
      )}
      {problem && <Note tone="danger">{problem}</Note>}
      <Row id="browser.engine">
        <select
          aria-label="Search engine"
          value={engines.some((e) => e.name === prefs.engine) ? prefs.engine : engines[0]!.name}
          onChange={(event) => prefs.set({ engine: event.target.value })}
          className="ui-field kasten-set-select"
        >
          {engines.map((engine) => (
            <option key={engine.name} value={engine.name}>
              {engine.name}
            </option>
          ))}
        </select>
      </Row>
      <AddEngine />
      <Favourites />
      <Row id="browser.webLinks" {...resetOf(prefs.webLinks, "system", (webLinks: WebLinks) => prefs.set({ webLinks }))}>
        <Segmented<WebLinks>
          label="Open web links in"
          value={prefs.webLinks}
          options={[
            { id: "system", label: "The system browser" },
            { id: "tab", label: "A KastenFlow browser tab to the right" },
          ]}
          onChange={(webLinks) => prefs.set({ webLinks })}
        />
      </Row>
      <Row id="browser.clear">
        {cleared && <span className="text-13 text-muted">Cleared</span>}
        <Button
          size="sm"
          icon="trash"
          disabled={!available || !prefs.enabled}
          onClick={() => {
            setProblem(null);
            browserBackend()
              .clearData()
              .then(() => setCleared(true))
              .catch((err: unknown) => setProblem(message(err)));
          }}
        >
          Clear browsing data
        </Button>
      </Row>
      <Row id="browser.signin" detail="Some sites refuse sign-in in an embedded browser" />
    </Group>
  );
}

/** Adds a search engine of the person's own: a name and an address with `%s` where the words go. */
function AddEngine() {
  const { custom, set } = useBrowserPrefs();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const ok = name.trim() !== "" && validEngineUrl(url);
  return (
    <Block id="browser.addEngine" titled>
      <div className="kasten-set-form">
        <div className="flex flex-wrap items-center gap-2">
          <input className="ui-field w-36" aria-label="Engine name" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <input className="ui-field min-w-0 flex-1" aria-label="Engine address" placeholder="https://example.com/search?q=%s" value={url} onChange={(e) => setUrl(e.target.value)} />
          <Button
            size="sm"
            icon="plus"
            disabled={!ok}
            onClick={() => {
              set({ custom: [...custom.filter((c) => c.name !== name.trim()), { name: name.trim(), url: url.trim() }] });
              setName("");
              setUrl("");
            }}
          >
            Add
          </Button>
        </div>
        {custom.length > 0 && (
          <ul className="mt-2 text-13">
            {custom.map((engine) => (
              <li key={engine.name} className="flex items-center gap-2 py-0.5">
                <span className="font-medium">{engine.name}</span>
                <span className="min-w-0 flex-1 truncate text-muted">{engine.url}</span>
                <Button size="sm" tone="quiet" aria-label={`Remove ${engine.name}`} onClick={() => set({ custom: custom.filter((c) => c.name !== engine.name) })}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Block>
  );
}

/** Favourite sites, shown on a browser tab's start page. */
function Favourites() {
  const { favourites, set } = useBrowserPrefs();
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const ok = /^https?:\/\/[^\s/]+\S*$/i.test(url.trim());
  return (
    <Block id="browser.favourites" titled>
      <div className="kasten-set-form">
        <div className="flex flex-wrap items-center gap-2">
          <input className="ui-field w-36" aria-label="Favourite name" placeholder="Name" value={title} onChange={(e) => setTitle(e.target.value)} />
          <input className="ui-field min-w-0 flex-1" aria-label="Favourite address" placeholder="https://example.com" value={url} onChange={(e) => setUrl(e.target.value)} />
          <Button
            size="sm"
            icon="plus"
            disabled={!ok}
            onClick={() => {
              const address = url.trim();
              set({ favourites: [...favourites.filter((f) => f.url !== address), { title: title.trim() || address.replace(/^https?:\/\/(www\.)?/i, ""), url: address }] });
              setTitle("");
              setUrl("");
            }}
          >
            Add
          </Button>
        </div>
        {favourites.length > 0 && (
          <ul className="mt-2 text-13">
            {favourites.map((fav) => (
              <li key={fav.url} className="flex items-center gap-2 py-0.5">
                <span className="font-medium">{fav.title}</span>
                <span className="min-w-0 flex-1 truncate text-muted">{fav.url}</span>
                <Button size="sm" tone="quiet" aria-label={`Remove ${fav.title}`} onClick={() => set({ favourites: favourites.filter((f) => f.url !== fav.url) })}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Block>
  );
}
