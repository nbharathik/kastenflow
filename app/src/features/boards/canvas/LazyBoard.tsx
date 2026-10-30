import { lazy, Suspense } from "react";

import { Wait } from "../../../ui/Wait";

// React Flow and the canvas load with the first board, not with the app.
const BoardCanvas = lazy(() => import("./BoardCanvas").then((m) => ({ default: m.BoardCanvas })));

/** A whiteboard, loaded on first use. `embedded`: shown inside a page, its bars away until it is worked on. */
export function LazyBoard({ path, embedded = false }: { path: string; embedded?: boolean }) {
  return (
    <Suspense fallback={<Wait view label="Opening the board" />}>
      <BoardCanvas path={path} embedded={embedded} />
    </Suspense>
  );
}
