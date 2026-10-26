// The browser plugin's two backends for the demo, over the same frames: the
// tab's (many views, each with an id) and the Slides preview beside a slide or
// opened from a link's menu (one view). The switch is the plugin's, shared with
// Settings → Plugins. Capturing a page is not part of the demo.

import type { PreviewBackend } from "../preview-backend";
import type { BrowserBackend } from "../types";
import type { DemoViews } from "./views";

export interface BrowserSwitch {
  get(): boolean;
  set(on: boolean): void;
}

const NOT_DEMO = "Keeping a page is not part of the demo";
const PREVIEW = "preview";

export function demoBrowser(views: DemoViews, on: BrowserSwitch): BrowserBackend {
  const refused = () => Promise.reject(new Error(NOT_DEMO));
  return {
    available: true,
    enabled: async () => on.get(),
    setEnabled: async (value) => {
      on.set(value);
      return value;
    },
    open: (id, url, bounds) => views.open(id, url, bounds),
    bounds: (id, bounds) => views.bounds(id, bounds),
    hide: (id) => views.hide(id),
    show: (id) => views.show(id),
    close: (id) => views.close(id),
    nav: (id, nav) => views.nav(id, nav),
    capture: refused,
    confirm: refused,
    discard: async () => {},
    clearData: async () => {},
    onEvent: async (listener) => views.onEvent(listener),
  };
}

export function demoPreview(views: DemoViews): PreviewBackend {
  return {
    available: true,
    open: (url, bounds) => views.open(PREVIEW, url, bounds),
    bounds: (bounds) => views.bounds(PREVIEW, bounds),
    nav: (nav) => views.nav(PREVIEW, nav),
    hide: () => views.hide(PREVIEW),
    show: () => views.show(PREVIEW),
    close: () => views.close(PREVIEW),
    childFocus: async () => {},
    onChildKey: async () => () => {},
  };
}
