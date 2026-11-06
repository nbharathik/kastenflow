// Where a vault day shows its "Today in projects" strip: only for a day of the
// vault's own journal (`journal/<year>/<date>.md`), whose chunk loads then.

import { lazy, Suspense } from "react";

import { vaultDayOf } from "./entry";

const Strip = lazy(() => import("./TodayInProjects"));

export function TodayStrip({ path }: { path: string }) {
  const day = vaultDayOf(path);
  if (!day) return null;
  return (
    <Suspense fallback={null}>
      <Strip day={day} />
    </Suspense>
  );
}
