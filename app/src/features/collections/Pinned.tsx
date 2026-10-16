// The collections pinned to Home or to a project's overview, as a card each:
// its name, how many notes it finds now, and the first few. Nothing shows
// until something is pinned, and nothing here loads the collections before.

import "../dashboard/dashboard.css";

import type { Collection } from "../../lib/vault/collection-types";
import { DashCard } from "../dashboard/DashCard";
import { IconOrEmoji } from "../../ui/IconOrEmoji";
import { IconButton } from "../../ui/Button";
import { titleOf } from "../workspace/names";
import { collectionIcon } from "./icon";
import { pinnedIn, usePins, type PinScope } from "./pins";
import { openCollection } from "./requests";
import { collectionAt, useCollections } from "./use-collections";
import { useCollectionRun } from "./use-run";

export function PinnedCollections({ scope }: { scope: PinScope }) {
  const paths = usePins((s) => pinnedIn(s.pins, scope));
  // The collections are not read while nothing is pinned.
  return paths.length > 0 ? <Pinned scope={scope} paths={paths} /> : null;
}

function Pinned({ scope, paths }: { scope: PinScope; paths: string[] }) {
  const { list } = useCollections();
  const shown = paths.map((path) => collectionAt(list, path)).filter((c): c is Collection => c !== undefined && !c.problem);
  if (shown.length === 0) return null;
  return (
    <DashCard title="Collections" icon="filter" count={shown.length}>
      <ul className="space-y-1" aria-label="Pinned collections">
        {shown.map((collection) => (
          <li key={collection.path}>
            <PinnedCard collection={collection} scope={scope} />
          </li>
        ))}
      </ul>
    </DashCard>
  );
}

function PinnedCard({ collection, scope }: { collection: Collection; scope: PinScope }) {
  const { run } = useCollectionRun(collection);
  const first = run?.notes.slice(0, 3) ?? [];
  return (
    <div className="flex items-start gap-1 rounded hover:bg-hover">
      <button type="button" onClick={() => openCollection(collection.path)} className="min-w-0 flex-1 rounded px-2 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent/50">
        <span className="flex items-center gap-2 text-14 font-medium">
          <IconOrEmoji icon={collectionIcon(collection.icon)} />
          <span className="truncate">{collection.name}</span>
          <span className="ml-auto text-12 font-normal tabular-nums text-muted">{run ? run.total.toLocaleString() : "…"}</span>
        </span>
        {first.length > 0 && <span className="mt-0.5 block truncate text-12 text-muted">{first.map((n) => titleOf(n)).join(" · ")}</span>}
      </button>
      <IconButton icon="pin" label={`Unpin ${collection.name}`} size="sm" onClick={() => usePins.getState().unpin(scope, collection.path)} />
    </div>
  );
}
