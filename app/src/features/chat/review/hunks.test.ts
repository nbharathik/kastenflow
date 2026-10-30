import { describe, expect, it } from "vitest";

import { hunksOf, textKeeping } from "./hunks";

const BEFORE = "# Plan\n\nShort.\n\nMiddle one.\nMiddle two.\nMiddle three.\n\nLast line.\n";
const AFTER = "# Plan\n\nShort, rewritten.\n\nMiddle one.\nMiddle two.\nMiddle three.\n\nLast line, changed.\nAnd a new one.\n";

describe("the hunks of a change", () => {
  it("are the runs of changed lines, with a kept line either side", () => {
    const { hunks } = hunksOf(BEFORE, AFTER);
    expect(hunks).toHaveLength(2);
    expect(hunks[0]).toMatchObject({ index: 0, added: 1, removed: 1 });
    expect(hunks[0]!.lines.map((l) => `${l.kind}:${l.text}`)).toEqual(["same:", "del:Short.", "add:Short, rewritten.", "same:"]);
    expect(hunks[1]).toMatchObject({ index: 1, added: 2, removed: 1 });
  });

  it("are none for the same text", () => {
    expect(hunksOf(BEFORE, BEFORE).hunks).toEqual([]);
  });
});

describe("the text that keeps some hunks", () => {
  it("is the proposed text itself, byte for byte, when nothing is undone", () => {
    expect(textKeeping(BEFORE, AFTER, new Set())).toBe(AFTER);
    const crlf = "One\r\nTwo\r\n";
    expect(textKeeping("One\r\n", crlf, new Set())).toBe(crlf);
  });

  it("gives back the old lines of an undone hunk and keeps the others", () => {
    expect(textKeeping(BEFORE, AFTER, new Set([0]))).toBe(AFTER.replace("Short, rewritten.", "Short."));
    expect(textKeeping(BEFORE, AFTER, new Set([1]))).toBe(BEFORE.replace("Short.", "Short, rewritten."));
  });

  it("is the old text when every hunk is undone", () => {
    expect(textKeeping(BEFORE, AFTER, new Set([0, 1]))).toBe(BEFORE);
  });

  it("ends as the text its last line came from does", () => {
    // The new last line has no line end; undone, the old ending comes back.
    expect(textKeeping("A\nB\n", "A\nB\nC", new Set([0]))).toBe("A\nB\n");
    expect(textKeeping("A\nB", "A\nB\nC\n", new Set([0]))).toBe("A\nB");
  });

  it("keeps CRLF line ends", () => {
    const before = "One\r\nTwo\r\nMid\r\nThree\r\n";
    const after = "One\r\nTwo!\r\nMid\r\nThree!\r\n";
    expect(textKeeping(before, after, new Set([0]))).toBe("One\r\nTwo\r\nMid\r\nThree!\r\n");
  });
});
