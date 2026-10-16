// Collections: searches kept under a name. A list of them on the left and the
// one that is open on the right, with a way to start a new one or begin from
// an example. A collection is a file in the vault's views folder; this view
// only reads them and asks the core to change them.

import "../dashboard/dashboard.css";

import { useState } from "react";

import type { Collection } from "../../lib/vault/collection-types";
import { Button } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import { IconOrEmoji } from "../../ui/IconOrEmoji";
import { useWorkspace } from "../workspace/store";
import { CollectionPane } from "./CollectionPane";
import { EXAMPLES, missingExamples, type CollectionExample } from "./examples";
import { collectionIcon } from "./icon";
import { openCollection, useCollectionRequests } from "./requests";
import { SaveCollectionDialog } from "./SaveDialog";
import { collectionAt, useCollections } from "./use-collections";

const BLANK = { edits: { query: "" }, name: "", dropped: [] as string[] };

export function CollectionsView({ path }: { path?: string }) {
  const { list, error } = useCollections();
  const pending = useCollectionRequests((s) => s.pending);
  const [creating, setCreating] = useState(false);
  const found = collectionAt(list, path);
  const open = found ?? (path ? undefined : list?.[0]);

  const start = async (example: CollectionExample) => {
    const { client, toast } = useWorkspace.getState();
    if (!client) return;
    try {
      openCollection((await client.createCollection(example.name, example.edits)).path);
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err));
    }
  };

  const examples = list ? missingExamples(list) : [];
  return (
    <div className="flex h-full min-h-0">
      <nav aria-label="Collections" className="flex w-64 shrink-0 flex-col gap-3 overflow-y-auto border-r border-line bg-panel p-3">
        <div className="flex items-center gap-2">
          <h1 className="flex-1 px-1 text-16 font-semibold">Collections</h1>
          <Button size="sm" icon="plus" onClick={() => setCreating(true)}>
            New
          </Button>
        </div>
        {list === null && <p className="px-1 text-13 text-muted">Loading…</p>}
        {error && (
          <p role="alert" className="px-1 text-13 text-danger">
            {error}
          </p>
        )}
        <ul className="space-y-0.5">
          {list?.map((c) => (
            <li key={c.path}>
              <ListEntry collection={c} current={open?.path === c.path} />
            </li>
          ))}
        </ul>
        {list && list.length === 0 && !error && <p className="px-1 text-13 text-muted">None yet. Search for something, then keep the search here.</p>}
        {examples.length > 0 && (
          <section aria-label="Start from an example" className="border-t border-line pt-3">
            <h2 className="px-1 text-12 font-medium text-muted">Start from an example</h2>
            <ul className="mt-1 space-y-0.5">
              {examples.map((example) => (
                <li key={example.id}>
                  <button type="button" onClick={() => void start(example)} className="w-full rounded px-2 py-1.5 text-left hover:bg-hover" title={example.about}>
                    <span className="block text-13 font-medium">{example.name}</span>
                    <span className="block text-12 text-muted">{example.about}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </nav>

      <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-canvas">
        {open ? (
          <CollectionPane key={open.path} collection={open} />
        ) : path && list ? (
          <div className="m-auto max-w-sm text-center">
            <p className="text-16 font-medium">That collection is not here any more.</p>
            <p className="mt-1 text-14 text-muted">It may have been renamed or moved to the trash.</p>
            <Button className="mt-4" onClick={() => useWorkspace.getState().go({ view: "collections" })}>
              See the collections
            </Button>
          </div>
        ) : list ? (
          <Empty onNew={() => setCreating(true)} onStart={(example) => void start(example)} />
        ) : null}
      </main>

      {(creating || pending) && (
        <SaveCollectionDialog
          saved={pending ?? BLANK}
          onClose={() => {
            setCreating(false);
            useCollectionRequests.getState().clear();
          }}
          onSaved={(made) => openCollection(made.path)}
        />
      )}
    </div>
  );
}

function ListEntry({ collection, current }: { collection: Collection; current: boolean }) {
  return (
    <button
      type="button"
      aria-current={current ? "page" : undefined}
      title={collection.problem ?? collection.query}
      onClick={() => openCollection(collection.path)}
      className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-14 hover:bg-hover ${current ? "bg-hover font-medium" : ""}`}
    >
      <IconOrEmoji icon={collectionIcon(collection.icon)} />
      <span className="min-w-0 flex-1 truncate">{collection.name}</span>
      {collection.problem && (
        <span title={collection.problem} className="text-muted">
          <Icon name="alert" className="size-4" />
          <span className="sr-only">Cannot be used</span>
        </span>
      )}
    </button>
  );
}

function Empty({ onNew, onStart }: { onNew(): void; onStart(example: CollectionExample): void }) {
  return (
    <div className="m-auto max-w-md px-6 text-center">
      <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-well text-muted" aria-hidden="true">
        <Icon name="search" className="size-7" />
      </div>
      <h2 className="mt-3 text-16 font-semibold">Keep a search</h2>
      <p className="mt-1.5 text-14 leading-relaxed text-muted">A collection remembers a search and looks it up again each time you open it, so it follows your notes. Search in the Card Library, then choose “Save as collection”, or start here.</p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <Button tone="primary" onClick={onNew}>
          New collection
        </Button>
        {EXAMPLES.map((example) => (
          <Button key={example.id} onClick={() => onStart(example)} title={example.about}>
            {example.name}
          </Button>
        ))}
      </div>
    </div>
  );
}
