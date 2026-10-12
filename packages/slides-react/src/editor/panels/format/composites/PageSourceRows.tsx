import type { Element } from "@kasten-slides/wasm";

import { breakLink, updatable, updateFromPages } from "../../../../pages/insert.ts";
import { openElementPage, pageOfElement } from "../../../../pages/open.ts";
import { useStanding } from "../../../../pages/useStanding.ts";
import { reportUpdate } from "../../../commands/pages.ts";
import type { EditorSession } from "../../../session/session.ts";
import { TextButton } from "../../../ui/Button.tsx";
import { Row } from "../controls.tsx";

const SAYS = {
  current: "Up to date with the page.",
  changed: "The page has changed since.",
  missing: "The page, or this section of it, cannot be found now.",
} as const;

/**
 * What an element says of the page it came from: which page, whether it has changed since, and what can be done about it: open it,
 * make the element again from it (contents, a section, an embedded page), or cut the tie and keep what is on the slide.
 */
export function PageSourceRows({ session, element }: { session: EditorSession; element: Element }) {
  const { host } = session;
  const source = element.source;
  const standing = useStanding(host, element);
  if (!source) return null;
  const target = pageOfElement(element);
  const name = source.section ? `${source.title ?? source.page} › ${source.section}` : (source.title ?? source.page);
  return (
    <>
      <Row label="Page" wide>
        <span className="ks-sp-value" title={source.page}>
          {name}
        </span>
      </Row>
      {updatable(element) && standing !== null ? (
        <p className={`ks-sp-hint${standing === "missing" ? " is-error" : ""}`} role="status">
          {SAYS[standing]}
        </p>
      ) : null}
      <div className="ks-sp-actions">
        {target && host.openPage ? <TextButton onClick={() => openElementPage(host, element)}>Open</TextButton> : null}
        {updatable(element) ? (
          <TextButton disabled={!host.readPage} onClick={() => void updateFromPages(session, [element.id]).then((done) => reportUpdate(session, done))}>
            Update from page
          </TextButton>
        ) : null}
        <TextButton onClick={() => void breakLink(session, element.id)}>Break link</TextButton>
      </div>
    </>
  );
}
