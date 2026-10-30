// The page editor's code loads on demand, so the shell paints first. Once
// loaded (the shell preloads it while idle), pages render it directly:
// suspending again would make React hold the reveal for up to 300 ms.

import { lazy, Suspense, useState, type ComponentProps } from "react";

import { Wait } from "../../../ui/Wait";
import type { NotePage as NotePageType } from "./NotePage";

type Props = ComponentProps<typeof NotePageType>;

let loaded: typeof NotePageType | null = null;
let loading: Promise<typeof NotePageType> | null = null;

/** Loads the page editor's code once. */
export function loadNotePage(): Promise<typeof NotePageType> {
  loading ??= import("./NotePage").then(
    (m) => (loaded = m.NotePage),
    (err: unknown) => {
      // Let the next try load it again.
      loading = null;
      throw err;
    },
  );
  return loading;
}

const Lazy = lazy(() => loadNotePage().then((component) => ({ default: component })));

export function LazyNotePage(props: Props) {
  // Chosen once per mount: switching trees later would remount the editor.
  const [Page] = useState(() => loaded);
  if (Page) return <Page {...props} />;
  return (
    <Suspense fallback={<Wait view label="Opening the page" />}>
      <Lazy {...props} />
    </Suspense>
  );
}
