// Blocks moved to another place keep their source, as blocks left where they
// were do: a section moved in a page, or a block moved up or down, is written
// back as it was written, not as the editor would write it.

import { describe, expect, it } from "vitest";

import { loadMarkdown, saveMarkdown, type BlockRange, type MarkdownCodec } from "./lossless";

// Paragraphs split by blank lines, and lists of `-` or `*` items, which fuse
// with a list beside them that has the same marker (as in CommonMark). The
// serializer is lossy on purpose: it collapses whitespace and gives lists
// alternating markers, as remark does.
const toy: MarkdownCodec<string> = {
  blockRanges(md) {
    const ranges: (BlockRange & { marker?: string })[] = [];
    let open: (BlockRange & { marker?: string }) | null = null;
    let paragraph: BlockRange | null = null;
    let pos = 0;
    for (const line of md.split(/(?<=\n)/)) {
      const text = line.replace(/\r?\n$/, "");
      const m = /^([-*]) /.exec(text);
      if (text.trim() === "") {
        // A list goes on across blank lines; a paragraph does not.
        paragraph = null;
      } else if (m && open && open.marker === m[1]) {
        open.end = pos + text.length;
      } else if (m) {
        paragraph = null;
        ranges.push((open = { start: pos, end: pos + text.length, marker: m[1] }));
      } else if (paragraph) {
        paragraph.end = pos + text.length;
      } else {
        open = null;
        ranges.push((paragraph = { start: pos, end: pos + text.length }));
      }
      pos += line.length;
    }
    return ranges.map(({ start, end }) => ({ start, end }));
  },
  parse(md) {
    return toy.blockRanges(md).map((r) => {
      const text = md.slice(r.start, r.end);
      if (!/^[-*] /.test(text)) return `P:${text.replace(/\s+/g, " ").trim()}`;
      return `L:${text
        .split(/\r?\n/)
        .map((l) => l.slice(2).trim())
        .join("|")}`;
    });
  },
  serialize(nodes) {
    let marker = "*";
    return nodes
      .map((n) => {
        if (!n.startsWith("L:")) return n.slice(2);
        marker = marker === "-" ? "*" : "-";
        return n
          .slice(2)
          .split("|")
          .map((item) => `${marker} ${item}`)
          .join("\n");
      })
      .join("\n\n");
  },
  eq: (a, b) => a === b,
  typeOf: (n) => n.slice(0, 1),
};

function change(body: string, edit: (nodes: string[]) => string[]): string {
  const { nodes, snapshot } = loadMarkdown(toy, body);
  return saveMarkdown(toy, snapshot, edit([...nodes]));
}

describe("blocks that were moved", () => {
  it("keep their source, whitespace and all, wherever they go", () => {
    const body = "alpha   one\n\nbeta  two\nwrapped\n\ngamma    three\n";
    expect(change(body, (n) => [n[1]!, n[2]!, n[0]!])).toBe("beta  two\nwrapped\n\ngamma    three\n\nalpha   one\n");
    expect(change(body, (n) => [n[2]!, n[0]!, n[1]!])).toBe("gamma    three\n\nalpha   one\n\nbeta  two\nwrapped\n");
    expect(change(body, (n) => [n[2]!, n[1]!, n[0]!])).toBe("gamma    three\n\nbeta  two\nwrapped\n\nalpha   one\n");
  });

  it("get a blank line on each side, whatever gap they stood after", () => {
    // The first block had nothing before it; a heading's line break would not do between paragraphs.
    const body = "first   block\nsecond line\n\nsecond   block\n\nthird\n";
    const out = change(body, (n) => [n[1]!, n[0]!, n[2]!]);
    expect(out).toBe("second   block\n\nfirst   block\nsecond line\n\nthird\n");
    expect(toy.parse(out)).toEqual(["P:second block", "P:first block second line", "P:third"]);
  });

  it("keep a longer gap a block had, when it still follows the block it followed", () => {
    const body = "a   a\n\n\n\nb   b\n\nc   c\n\n\nd   d\n";
    // c and d keep the gap that was between them; b, moved to the front, is the note's first block.
    expect(change(body, (n) => [n[1]!, n[0]!, n[2]!, n[3]!])).toBe("b   b\n\na   a\n\nc   c\n\n\nd   d\n");
  });

  it("are written verbatim next to a block that is edited, and the edit is written afresh", () => {
    const body = "alpha   one\n\nbeta   two\n\ngamma   three\n\ndelta   four\n";
    const out = change(body, (n) => [n[2]!, "P:beta edited", n[0]!, n[3]!]);
    expect(out).toBe("gamma   three\n\nbeta edited\n\nalpha   one\n\ndelta   four\n");
  });

  it("are written afresh, with the blocks they now touch, when they would fuse with them", () => {
    // Two lists that stood apart (a paragraph between them) with the same marker would fuse once they touch.
    const body = "- a   1\n\nmiddle   words\n\n- b   2\n";
    const out = change(body, (n) => [n[0]!, n[2]!, n[1]!]);
    expect(toy.parse(out)).toEqual(["L:a   1", "L:b   2", "P:middle words"]);
    // The paragraph, which fuses with nothing, is as it was written.
    expect(out.endsWith("middle   words\n")).toBe(true);
  });

  it("are not left to fuse either when a block between two such lists is taken away", () => {
    const out = change("* a  1\n\n- b  2\n\n* c  3\n", (n) => [n[0]!, n[2]!]);
    expect(toy.parse(out)).toEqual(["L:a  1", "L:c  3"]);
  });

  it("leave the saver as it was when nothing moved", () => {
    const body = "alpha   one\n\nbeta   two\n\ngamma   three\n";
    expect(change(body, (n) => n)).toBe(body);
    expect(change(body, (n) => [n[0]!, "P:beta edited", n[2]!])).toBe("alpha   one\n\nbeta edited\n\ngamma   three\n");
  });

  it("save exactly what the editor holds, however blocks are moved and edited (seeded)", () => {
    let s = 11;
    const r = (n: number) => ((s = (s * 1664525 + 1013904223) >>> 0), s % n);
    for (let seed = 0; seed < 500; seed++) {
      const blocks: string[] = [];
      let lastMarker = "";
      for (let i = 0, n = 2 + r(6); i < n; i++) {
        if (r(3) === 0) {
          blocks.push(`para   ${r(9)}\nwrapped  ${r(9)}`);
          lastMarker = "";
        } else {
          let marker = r(2) ? "-" : "*";
          if (marker === lastMarker) marker = marker === "-" ? "*" : "-";
          lastMarker = marker;
          blocks.push(Array.from({ length: 1 + r(3) }, () => `${marker} item  ${r(9)}`).join("\n"));
        }
      }
      const gaps = ["\n\n", "\n\n\n", "\n\n"];
      const body = blocks.map((b, i) => (i === 0 ? b : gaps[r(3)] + b)).join("") + "\n";
      const { nodes, snapshot } = loadMarkdown(toy, body);
      const current = [...nodes];
      // Move one or two blocks, and sometimes edit another.
      for (let step = 0, count = 1 + r(2); step < count; step++) current.splice(r(current.length + 1), 0, ...current.splice(r(current.length), 1));
      if (r(3) === 0) {
        // An edited block stays the kind it was, so no two lists are left to touch by a block taken away.
        const i = r(current.length);
        current[i] = current[i]!.startsWith("L:") ? `L:edited ${seed}` : `P:edited ${seed}`;
      }
      const saved = saveMarkdown(toy, snapshot, current);
      expect(toy.parse(saved), `seed ${seed}: ${JSON.stringify(body)} -> ${JSON.stringify(saved)}`).toEqual(current);
    }
  });
});
