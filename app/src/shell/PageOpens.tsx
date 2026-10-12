// "Open links from this page in…": the page's own choice of where a plain
// click on its links and sub-pages opens, kept in its `opens` key. A page that
// makes no choice follows Settings → Pages.

import type { RefObject } from "react";

import { pageFor } from "../features/workspace/page/open-page";
import { setLayout, usePageLayouts } from "../features/workspace/page/page-layout";
import { OPENS, OPENS_LABEL, type Opens } from "../features/workspace/opens";
import { usePrefs } from "../features/workspace/prefs";
import { PointMenu } from "./PointMenu";

/** The menu of choices, under the button it belongs to (`anchor`), ticking the
 * page's own choice, or the one that follows Settings. Choosing writes the page. */
export function PageOpensMenu({ path, anchor, onClose }: { path: string; anchor: RefObject<HTMLElement | null>; onClose: () => void }) {
  const session = pageFor(path);
  const own = usePageLayouts((s) => (session ? s.of.get(session)?.opens : undefined));
  const followed = usePrefs((s) => s.pageLinksOpen);
  if (!session) return null;
  const choose = (value: Opens | null) => setLayout(session, "opens", value);
  const box = anchor.current?.getBoundingClientRect();
  return (
    <PointMenu
      x={(box?.right ?? 0) - 224}
      y={(box?.bottom ?? 0) + 4}
      label="Open links from this page in"
      onClose={onClose}
      items={[
        { label: `As Settings say: ${OPENS_LABEL[followed].toLowerCase()}`, checked: own === undefined, onSelect: () => choose(null) },
        "divider",
        ...OPENS.map((value) => ({ label: OPENS_LABEL[value], checked: own === value, onSelect: () => choose(value) })),
      ]}
    />
  );
}
