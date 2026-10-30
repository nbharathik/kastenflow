// What a page's editor knows about smart pages, for `![[Conference tracker]]`
// and `![[Conference tracker#deadlines]]` embeds: drawing the live view of the
// page inside this one. The block loads when it first scrolls into view; this
// page's path says which page it sits in, so at most four blocks run at once
// in one page.

import { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";

import { ViewBoundary } from "../../../ui/ViewBoundary";
import type { LinkProvider } from "../../pages/editor/links";

type SmartLinks = Required<Pick<LinkProvider, "mountSmart">>;

/** The block's code loads when the first smart page is shown. */
const LazySmartBlock = lazy(() => import("../../smart/SmartBlock").then((m) => ({ default: m.SmartBlock })));

/** `page` gives the path of the page the editor is showing. */
export function smartLinks(page: () => string): SmartLinks {
  return {
    mountSmart: (host, spec) => {
      const root = createRoot(host);
      root.render(
        <ViewBoundary place={spec.path}>
          <Suspense fallback={<p className="px-3 py-6 text-center text-13 text-muted">Opening the smart page…</p>}>
            <LazySmartBlock pagePath={spec.path} pageId={spec.id} title={spec.title} view={spec.view} scope={page()} />
          </Suspense>
        </ViewBoundary>,
      );
      return () => root.unmount();
    },
  };
}
