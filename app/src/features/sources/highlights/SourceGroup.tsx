// One PDF's section of the Highlights view: its heading and its highlights
// in reading order. The section can be folded, and stays folded the next time.

import type { Highlight, NoteMeta, SourceInfo } from "../../../lib/vault/types";
import { useFlag } from "../../workspace/flags";
import { howFrom, useWorkspace } from "../../workspace/store";
import { count } from "./cover";
import { GroupHeader } from "./GroupHeader";
import { HighlightCard } from "./HighlightCard";

interface Props {
  source: SourceInfo;
  /** Every highlight of the PDF, and the ones the filters keep. */
  all: readonly Highlight[];
  shown: readonly Highlight[];
  filtering: boolean;
  cardOf(h: Highlight): NoteMeta | undefined;
}

export function SourceGroup({ source, all, shown, filtering, cardOf }: Props) {
  const [folded, fold] = useFlag(`fold:highlights:${source.path}`);
  return (
    <section className={`kasten-hls-source${folded ? " is-folded" : ""}`} aria-label={source.title}>
      <GroupHeader
        source={source}
        count={filtering ? `${shown.length} of ${all.length}` : count(all.length, "highlight")}
        folded={folded}
        onFold={() => fold()}
        onOpen={(e) => useWorkspace.getState().go({ view: "highlights", path: source.path }, howFrom(e))}
      />
      {!folded &&
        (shown.length === 0 ? (
          <p className="kasten-hls-none">Nothing highlighted yet. Open it to read and highlight.</p>
        ) : (
          <ol>
            {shown.map((h) => (
              <li key={h.id}>
                <HighlightCard source={source.path} sourceTitle={source.title} highlight={h} card={cardOf(h)} />
              </li>
            ))}
          </ol>
        ))}
    </section>
  );
}
