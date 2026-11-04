// The journal icon at the top right of a project's page. It is all the main
// window holds of the project journal: the peek it opens is its own chunk,
// fetched the first time the button is pressed.

import { lazy, Suspense, useCallback, useState } from "react";

import type { NoteMeta } from "../../../lib/vault/types";
import { IconButton } from "../../../ui/Button";
import { useWorkspace } from "../../workspace/store";

const Peek = lazy(() => import("./ProjectJournalPeek").then((m) => ({ default: m.ProjectJournalPeek })));

export function ProjectJournalButton({ project }: { project: NoteMeta }) {
  const [open, setOpen] = useState(false);
  const client = useWorkspace((s) => s.client);
  const close = useCallback(() => setOpen(false), []);
  if (!project.project) return null;
  return (
    <>
      <IconButton icon="journal" label="Project journal" title="This project's journal, at the side" active={open} onClick={() => setOpen((was) => !was)} />
      {open && client && (
        <Suspense fallback={null}>
          <Peek client={client} project={project} onClose={close} />
        </Suspense>
      )}
    </>
  );
}
