// A diagram's change in the history, said as what changed to what: how many
// shapes before and after, which were added, removed, renamed or moved. Read
// from the diagram's cells, not from lines of XML.

import { describe, expect, it } from "vitest";

import { diagramChange, diagramChangeWords } from "./change";

/** A diagram file with these cells: [id, label, kind, x, style]. */
function file(cells: [string, string, "vertex" | "edge", number?, string?][], pages = 1): string {
  const body = cells
    .map(([id, label, kind, x = 0, style = "rounded=1"]) =>
      kind === "vertex"
        ? `<mxCell id="${id}" value="${label}" style="${style}" vertex="1" parent="1"><mxGeometry x="${x}" y="0" width="80" height="40" as="geometry"/></mxCell>`
        : `<mxCell id="${id}" value="${label}" style="${style}" edge="1" parent="1" source="a" target="b"><mxGeometry relative="1" as="geometry"/></mxCell>`,
    )
    .join("\n");
  const page = (n: number) => `<diagram name="Page-${n}" id="p${n}"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${n === 1 ? body : ""}</root></mxGraphModel></diagram>`;
  return `<mxfile>${Array.from({ length: pages }, (_, i) => page(i + 1)).join("")}</mxfile>`;
}

describe("a diagram's change", () => {
  it("counts shapes and connectors before and after, and names what was added and removed", () => {
    const before = file([["a", "Login", "vertex"], ["b", "Token", "vertex"], ["e1", "", "edge"]]);
    const after = file([["a", "Login", "vertex"], ["c", "Cache", "vertex"], ["d", "API", "vertex"], ["e1", "", "edge"], ["e2", "", "edge"]]);
    const change = diagramChange(before, after);
    expect(change).toMatchObject({ readable: true, shapes: [2, 3], connectors: [1, 2], added: ["Cache", "API", "a connector"], removed: ["Token"] });
    expect(diagramChangeWords(change)).toEqual(["Shapes: 2 → 3.", "Connectors: 1 → 2.", "Added “Cache”, “API” and a connector.", "Removed “Token”."]);
  });

  it("says a renamed shape as 'from → to', and counts shapes that moved or changed their look", () => {
    const before = file([["a", "Login", "vertex", 0], ["b", "Token", "vertex", 100], ["c", "Cache", "vertex", 200, "rounded=1"]]);
    const after = file([["a", "Sign in", "vertex", 0], ["b", "Token", "vertex", 160], ["c", "Cache", "vertex", 200, "ellipse"]]);
    const change = diagramChange(before, after);
    expect(change).toMatchObject({ renamed: [["Login", "Sign in"]], moved: 1, restyled: 1, added: [], removed: [] });
    expect(diagramChangeWords(change)).toEqual(["Renamed “Login” → “Sign in”.", "Moved or resized 1 shape.", "Changed the look of 1 shape."]);
  });

  it("strips the formatting out of a label, and shortens a long one", () => {
    const html = "&lt;b&gt;Login&lt;/b&gt;&lt;br&gt;service";
    const change = diagramChange(file([]), file([["a", html, "vertex"], ["b", "x".repeat(80), "vertex"]]));
    expect(change.added[0]).toBe("Login service");
    expect(change.added[1]!.length).toBeLessThanOrEqual(41);
    expect(change.added[1]!.endsWith("…")).toBe(true);
  });

  it("counts pages", () => {
    const change = diagramChange(file([["a", "A", "vertex"]], 1), file([["a", "A", "vertex"]], 2));
    expect(change.pages).toEqual([1, 2]);
    expect(diagramChangeWords(change)).toEqual(["Pages: 1 → 2."]);
  });

  it("says a diagram that was made or removed", () => {
    const made = diagramChange(null, file([["a", "A", "vertex"], ["e", "", "edge"]]));
    expect(diagramChangeWords(made)).toEqual(["A new diagram with 1 shape and 1 connector."]);
    const gone = diagramChange(file([["a", "A", "vertex"], ["b", "B", "vertex"]]), null);
    expect(diagramChangeWords(gone)).toEqual(["The diagram was removed. It had 2 shapes and no connectors."]);
  });

  it("says nothing changed in the cells when only something else did", () => {
    const same = file([["a", "A", "vertex"]]);
    expect(diagramChangeWords(diagramChange(same, same.replace("<mxfile>", '<mxfile host="x">')))).toEqual(["No shape, connector or label changed."]);
  });

  it("keeps to the counts and 'could not be read' when the file's cells are not readable", () => {
    const compressed = '<mxfile><diagram id="p">7VhZ</diagram></mxfile>';
    const change = diagramChange(compressed, compressed + " ");
    expect(change.readable).toBe(false);
    expect(diagramChangeWords(change)).toEqual(["The diagram's shapes could not be read to say what changed."]);
    expect(diagramChange("not xml at all", file([["a", "A", "vertex"]])).readable).toBe(false);
  });

  it("reads an object wrapper, whose label and id are on the wrapper", () => {
    const wrapped = (label: string) => `<mxfile><diagram id="p"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><object label="${label}" id="w1"><mxCell style="rounded=1" vertex="1" parent="1"><mxGeometry width="80" height="40" as="geometry"/></mxCell></object></root></mxGraphModel></diagram></mxfile>`;
    const change = diagramChange(wrapped("Login"), wrapped("Sign in"));
    expect(change).toMatchObject({ shapes: [1, 1], renamed: [["Login", "Sign in"]] });
  });
});
