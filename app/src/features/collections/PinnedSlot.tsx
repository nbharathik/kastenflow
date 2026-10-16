// Where Home and a project's overview show their pinned collections. This
// file is all they load at first: the cards, which run the collections, load
// only once something is pinned there.

import { lazy, Suspense } from "react";

import { pinnedIn, usePins, type PinScope } from "./pins";

const Cards = lazy(() => import("./Pinned").then((m) => ({ default: m.PinnedCollections })));

export function PinnedSlot({ scope }: { scope: PinScope }) {
  const any = usePins((s) => pinnedIn(s.pins, scope).length > 0);
  return any ? (
    <Suspense fallback={null}>
      <Cards scope={scope} />
    </Suspense>
  ) : null;
}
