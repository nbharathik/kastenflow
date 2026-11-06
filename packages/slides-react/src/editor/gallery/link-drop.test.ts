import { describe, expect, it } from "vitest";

import { droppedLink, hasLinkDrag } from "./link-drop.ts";

/** What a drag carries: its types, and the data of each. */
function drag(data: Record<string, string>) {
  return { dataTransfer: { types: Object.keys(data), getData: (type: string) => data[type] ?? "" } } as unknown as Parameters<typeof hasLinkDrag>[0];
}

describe("a link dragged onto the slide", () => {
  it("is known while it is over the slide by its type, and words are not", () => {
    expect(hasLinkDrag(drag({ "text/uri-list": "https://example.com/", "text/plain": "https://example.com/" }))).toBe(true);
    expect(hasLinkDrag(drag({ "text/plain": "some words" }))).toBe(false);
    expect(hasLinkDrag(drag({ Files: "" }))).toBe(false);
  });

  it("is the first address of the list, past its comments and blank lines", () => {
    expect(droppedLink(drag({ "text/uri-list": "# a comment\r\n\r\nhttps://youtu.be/dQw4w9WgXcQ\r\nhttps://example.com/" }))).toBe("https://youtu.be/dQw4w9WgXcQ");
  });

  it("is the words when they are only an address and the list has none", () => {
    expect(droppedLink(drag({ "text/uri-list": "", "text/plain": " https://example.com/x " }))).toBe("https://example.com/x");
  });

  it("is nothing for an address that is not a web page, or for words", () => {
    expect(droppedLink(drag({ "text/uri-list": "javascript:alert(1)" }))).toBeNull();
    expect(droppedLink(drag({ "text/uri-list": "file:///etc/passwd", "text/plain": "file:///etc/passwd" }))).toBeNull();
    expect(droppedLink(drag({ "text/plain": "see https://example.com" }))).toBeNull();
  });
});
