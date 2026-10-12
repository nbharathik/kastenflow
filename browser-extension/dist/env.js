// What the extension needs from the browser, as small interfaces. The entry
// files (`background-main.ts`, `popup-main.ts`) fit Chrome's and Edge's own
// objects to these; everything else is written against them, so it runs with a
// stand-in for the browser in tests.
export {};
