import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { isPresetShape, presetShapeNames } from "../../render/shapes/index.ts";
import { button, click, openEditor } from "../menus/testing.ts";
import { SHAPE_GROUPS, findShapes } from "../shapes.ts";
import { Toolbar } from "./Toolbar.tsx";

afterEach(cleanup);

async function setup() {
  const editor = await openEditor();
  render(<Toolbar session={editor.session} ui={editor.ui} />);
  return editor;
}

const offered = SHAPE_GROUPS.flatMap((group) => group.shapes.map((shape) => shape.preset));

describe("the shapes on offer", () => {
  it("are every preset the renderer draws, each once, and nothing it cannot draw", () => {
    expect([...offered].sort()).toEqual([...presetShapeNames()].sort());
    expect(new Set(offered).size).toBe(offered.length);
    for (const preset of offered) expect(isPresetShape(preset), preset).toBe(true);
  });

  it("are grouped: shapes, stars, arrows, callouts, flowchart", () => {
    expect(SHAPE_GROUPS.map((g) => g.title)).toEqual(["Shapes", "Stars", "Arrows", "Callouts", "Flowchart"]);
  });

  it("are found by their name, their preset name or their group, with every word typed", () => {
    expect(findShapes("")).toBe(SHAPE_GROUPS);
    expect(findShapes("star").map((g) => g.title)).toEqual(["Stars"]);
    expect(findShapes("STAR").flatMap((g) => g.shapes.map((s) => s.preset))).toEqual(["star4", "star5", "star6", "star8"]);
    expect(findShapes("6 point").flatMap((g) => g.shapes.map((s) => s.preset))).toEqual(["star6"]);
    expect(findShapes("flowchart decision").flatMap((g) => g.shapes.map((s) => s.preset))).toEqual(["flowChartDecision"]);
    expect(findShapes("roundRect").flatMap((g) => g.shapes.map((s) => s.preset))).toContain("roundRect");
    expect(findShapes("nothing like this")).toEqual([]);
  });
});

describe("the shape menu of the toolbar", () => {
  it("shows all of the shapes, and finds them with the search box", async () => {
    const { session } = await setup();
    click(button("Shape"));
    const dialog = screen.getByRole("dialog", { name: "Shapes" });
    expect(within(dialog).getAllByRole("button").length).toBe(offered.length);
    const search = within(dialog).getByRole("searchbox", { name: "Search shapes" });
    fireEvent.change(search, { target: { value: "star" } });
    expect(within(dialog).getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual(["4-point star", "5-point star", "6-point star", "8-point star"]);
    expect(within(dialog).queryByRole("group", { name: "Arrows" })).toBeNull();
    click(within(dialog).getByRole("button", { name: "6-point star" }));
    expect(session.state.tool).toBe("shape:star6");
  });

  it("says when no shape has the name, and starts again with the whole list the next time it opens", async () => {
    await setup();
    click(button("Shape"));
    fireEvent.change(screen.getByRole("searchbox", { name: "Search shapes" }), { target: { value: "zzz" } });
    expect(screen.getByText("No shape has that name.")).toBeTruthy();
    fireEvent.keyDown(document.body, { key: "Escape" });
    click(button("Shape"));
    expect((screen.getByRole("searchbox", { name: "Search shapes" }) as HTMLInputElement).value).toBe("");
    expect(within(screen.getByRole("dialog", { name: "Shapes" })).getAllByRole("button").length).toBe(offered.length);
  });
});
