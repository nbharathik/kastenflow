import { useEffect, useMemo, useState } from "react";

import type { Proposal } from "../../../lib/vault/types";
import { diffLines } from "../../review/diff";
import { descriptionOf } from "../../review/words";
import { useWorkspace } from "../../workspace/store";
import { DiagramBeforeAfter } from "./BeforeAfter";

const DIAGRAM_OPS = new Set(["create_diagram", "update_diagram", "edit_diagram"]);

/** Whether the review draws this proposal as two pictures: a diagram made or changed, with its text after the change. */
export const isDiagramProposal = (proposal: Proposal): boolean => DIAGRAM_OPS.has(proposal.op.kind) && typeof proposal.after === "string";

/** A diagram proposal in the review queue: the diagram before and after as the program draws them (the proposal's text is not in the
 * vault, so the pictures are drawn from it), what changed in words, and the XML one button away. */
export function DiagramProposalChange({ proposal }: { proposal: Proposal }) {
  const client = useWorkspace((s) => s.client);
  const [drawn, setDrawn] = useState<{ before?: string; after?: string }>({});
  const { before, after } = proposal;
  const title = proposal.target?.title ?? "the diagram";

  useEffect(() => {
    if (!client) return;
    let live = true;
    const draw = (xml: string | null) => (xml ? client.diagramDraftSvg(xml).catch(() => null) : Promise.resolve(null));
    void Promise.all([draw(before), draw(after)]).then(([b, a]) => live && setDrawn({ ...(b ? { before: b } : {}), ...(a ? { after: a } : {}) }));
    return () => {
      live = false;
    };
  }, [client, before, after]);

  const lines = useMemo(() => diffLines(before ?? "", after ?? ""), [before, after]);
  // The core's words for the change ("Edit the diagram “T”: add 2 nodes, …" and the steps), apart from the diff that may follow them.
  const note = descriptionOf(proposal.diff);
  return <DiagramBeforeAfter file={{ title, new: before === null, before, after: after ?? "", ...(drawn.before ? { beforeSvg: drawn.before } : {}), ...(drawn.after ? { afterSvg: drawn.after } : {}) }} lines={lines} {...(note ? { note } : {})} />;
}
