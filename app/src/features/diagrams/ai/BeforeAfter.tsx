import "../../review/review.css";
import "./ai.css";

import { useEffect, useMemo, useState } from "react";

import { Icon } from "../../../ui/Icon";
import type { DiffLine } from "../../review/diff";
import { DiffView } from "../../review/DiffView";
import { diagramChange, diagramChangeWords } from "../change";

/** A picture of SVG text, shown through an `<img>` and nothing else: the SVG is never put into the page, so nothing in it can run. */
function useSvgUrl(svg: string | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!svg) {
      setUrl(null);
      return;
    }
    const made = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    setUrl(made);
    return () => URL.revokeObjectURL(made);
  }, [svg]);
  return url;
}

function Picture({ caption, svg, alt }: { caption: string; svg: string | undefined; alt: string }) {
  const url = useSvgUrl(svg);
  return (
    <figure className="kasten-diagram-shot">
      <figcaption>{caption}</figcaption>
      {url ? <img src={url} alt={alt} draggable={false} /> : <p className="kasten-diagram-shot-missing">{svg ? "Drawing…" : "No picture. The program could not draw this version; the XML shows it."}</p>}
    </figure>
  );
}

export interface DiagramFileChange {
  title: string;
  new: boolean;
  before: string | null;
  after: string;
  beforeSvg?: string;
  afterSvg?: string;
}

/** A staged change to a diagram, looked at as pictures: the diagram before and after as the program draws it (a new diagram, only after),
 * what changed in words, and the file's XML one button away. The editor draws the exact picture once the diagram is applied and opened. */
export function DiagramBeforeAfter({ file, lines, note }: { file: DiagramFileChange; lines: DiffLine[] | null; note?: string }) {
  const [xml, setXml] = useState(false);
  const words = useMemo(() => diagramChangeWords(diagramChange(file.before, file.after)), [file.before, file.after]);
  return (
    <div className="kasten-diagram-change">
      {note && <p className="kasten-diagram-note">{note}</p>}
      <div className="kasten-diagram-pair" role="group" aria-label={`${file.title}: ${file.new ? "the new diagram" : "before and after"}`}>
        {!file.new && <Picture caption="Before" svg={file.beforeSvg} alt={`${file.title}, before the change`} />}
        <Picture caption={file.new ? "New diagram" : "After"} svg={file.afterSvg} alt={`${file.title}, ${file.new ? "as the chat drew it" : "after the change"}`} />
      </div>
      <ul className="kasten-diagram-words" aria-label="What changed">
        {words.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <p className="kasten-diagram-draft">Drawn by KastenFlow as a draft; the diagram editor draws the exact picture when it opens the diagram.</p>
      <button type="button" className="kasten-diagram-xml" aria-expanded={xml} onClick={() => setXml(!xml)}>
        <Icon name={xml ? "chevron-up" : "chevron-down"} className="size-3.5" />
        {xml ? "Hide XML" : "Show XML"}
      </button>
      {xml && lines && <DiffView lines={lines} mode="unified" label={`XML changes to ${file.title}`} />}
    </div>
  );
}
