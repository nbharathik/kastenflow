// jsdom lacks layout APIs that editor UI plugins (menus, tooltips, drag
// handles) call on creation. Parsing and serializing never depend on them.

const rect = { x: 0, y: 0, top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0, toJSON: () => ({}) };

class NoopObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): [] {
    return [];
  }
}

const g = globalThis as Record<string, unknown>;
g.ResizeObserver ??= NoopObserver;
g.IntersectionObserver ??= NoopObserver;

if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
}
Range.prototype.getBoundingClientRect ??= () => rect as DOMRect;
// Newer engines return a Promise from the scroll methods (Chromium's
// ProgrammaticScrollPromise); the tests do too, so an effect that returns
// what `el.scrollIntoView()` returns fails here as it does in the app.
const scrolled = () => Promise.resolve();
Element.prototype.scrollIntoView = scrolled as unknown as Element["scrollIntoView"];
Element.prototype.scrollTo = scrolled as unknown as Element["scrollTo"];
Element.prototype.scrollBy = scrolled as unknown as Element["scrollBy"];
window.scrollTo = scrolled as unknown as typeof window.scrollTo;
window.scrollBy = scrolled as unknown as typeof window.scrollBy;
document.elementFromPoint ??= () => null;
// jsdom draws no canvas: asking for a context logs "not implemented" and gives
// none. Say so quietly (the graph draws nothing without one, as a window that
// refuses a context would); a test that wants to see drawing stubs its own.
if (typeof HTMLCanvasElement !== "undefined") HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement["getContext"];
window.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener() {},
  removeListener() {},
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;
