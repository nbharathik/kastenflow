// Where a plain click on a link or a sub-page opens. In order: the place it
// is clicked in (a peek or the side stack keeps its own), then the `opens`
// key of the page the link is in, then the default in Settings → Pages,
// then the same tab. Clicks with keys keep their own ways (`howFrom`).

import { isOpens, type Opens } from "./opens";
import { pageFor } from "./page/open-page";
import { usePageLayouts } from "./page/page-layout";
import { usePrefs } from "./prefs";
import { howFrom, howFromName, type OpenHow } from "./store-layout";

/** The way a plain click opens, from what asks, in order: `context` (a
 * peek or the stack asking for its own way; `here` is no ask), the page's
 * `opens`, the default. */
export function opensPrecedence(context: OpenHow | undefined, own: Opens | null | undefined, preferred: Opens): OpenHow {
  if (context && context !== "here") return context;
  return howFromName(own ?? preferred);
}

/** The `opens` key of the page open at `path`, when it says one. */
export function pageOpens(path: string | undefined): Opens | null {
  const session = path ? pageFor(path) : undefined;
  const value = session ? usePageLayouts.getState().of.get(session)?.opens : undefined;
  return isOpens(value) ? value : null;
}

/** Where a plain click opens a link or sub-page in the page at `from` (or
 * from the sidebar, with no `from`): that page's `opens`, else Settings'. */
export function linkOpens(from?: string, context?: OpenHow): OpenHow {
  return opensPrecedence(context, pageOpens(from), usePrefs.getState().pageLinksOpen);
}

/** As `howFrom`, for a link or sub-page in the page at `from` or in the
 * sidebar: a plain click follows the page's `opens` or Settings, a click with
 * a key means what the key says. */
export function howFromPage(event: Parameters<typeof howFrom>[0], from?: string): OpenHow {
  const how = howFrom(event);
  return how === "here" ? linkOpens(from) : how;
}
