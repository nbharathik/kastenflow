import type { Element } from "@kasten-slides/wasm";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { edit, enter, held, mount, section } from "../test-kit.tsx";

afterEach(cleanup);

type Kit = Awaited<ReturnType<typeof mount>>;
type Of<K extends Element["type"]> = Extract<Element, { type: K }>;
const at = { x: 64, y: 148, w: 600, h: 300 };
const chart = (extra: Partial<Of<"chart">> = {}): Element =>
  ({
    type: "chart",
    id: "",
    kind: "bar",
    title: "Sales",
    categories: ["Q1", "Q2", "Q3"],
    series: [{ name: "2025", values: [12, 19, 8] }, { name: "2026", values: [15, 17, 11] }],
    ...at,
    ...extra,
  }) as Element;
const the = (kit: Kit) => held(kit, kit.ids[0] as string) as Of<"chart">;
const chartPart = () => within(section("chart"));
const value = (series: number, category: number) => chartPart().getByLabelText(`Value of series ${series}, category ${category}`) as HTMLInputElement;
const paste = (target: HTMLElement, text: string) => fireEvent.paste(target, { clipboardData: { getData: () => text } });

describe("Chart", () => {
  it("shows the type, the title, the legend and the table of numbers", async () => {
    await mount({ elements: [chart()] });
    expect((chartPart().getByRole("combobox", { name: "Chart type" }) as HTMLSelectElement).value).toBe("bar");
    expect((chartPart().getByLabelText("Chart title") as HTMLInputElement).value).toBe("Sales");
    // Two series: the legend is on unless the chart says otherwise.
    expect((chartPart().getByRole("checkbox", { name: "Legend" }) as HTMLInputElement).checked).toBe(true);
    expect((chartPart().getByRole("checkbox", { name: "Numbers on the chart" }) as HTMLInputElement).checked).toBe(false);
    expect(chartPart().getAllByRole("columnheader")).toHaveLength(2);
    expect([value(1, 1).value, value(2, 1).value, value(1, 3).value]).toEqual(["12", "15", "8"]);
    expect((chartPart().getByLabelText("Name of category 2") as HTMLInputElement).value).toBe("Q2");
    expect((chartPart().getByLabelText("Name of series 2") as HTMLInputElement).value).toBe("2026");
    expect(chartPart().getByLabelText("Chart title").closest("[data-primary]")).not.toBeNull();
  });

  it("switches the type, one step of undo", async () => {
    const kit = await mount({ elements: [chart()] });
    const before = kit.session.state.undoLabel;
    fireEvent.change(chartPart().getByRole("combobox", { name: "Chart type" }), { target: { value: "pie" } });
    expect(the(kit).kind).toBe("pie");
    expect(chartPart().getByText("A pie shows the first column only.")).toBeTruthy();
    edit(() => kit.session.undo());
    expect(the(kit).kind).toBe("bar");
    expect(kit.session.state.undoLabel).toBe(before);
  });

  it("sets and clears the title", async () => {
    const kit = await mount({ elements: [chart()] });
    enter(chartPart().getByLabelText("Chart title"), "Revenue");
    expect(the(kit).title).toBe("Revenue");
    enter(chartPart().getByLabelText("Chart title"), "  ");
    expect(the(kit).title).toBeUndefined();
  });

  it("turns the legend and the numbers on and off", async () => {
    const kit = await mount({ elements: [chart()] });
    fireEvent.click(chartPart().getByRole("checkbox", { name: "Legend" }));
    expect(the(kit).legend).toBe(false);
    fireEvent.click(chartPart().getByRole("checkbox", { name: "Numbers on the chart" }));
    expect(the(kit).labels).toBe(true);
    edit(() => kit.session.undo());
    expect(the(kit).labels).toBeFalsy();
    expect(the(kit).legend).toBe(false);
  });

  it("changes a number, a category and a series name, each one step of undo", async () => {
    const kit = await mount({ elements: [chart()] });
    enter(value(2, 3), "20.5");
    expect(the(kit).series[1]?.values).toEqual([15, 17, 20.5]);
    enter(chartPart().getByLabelText("Name of category 1"), "Jan");
    enter(chartPart().getByLabelText("Name of series 1"), "Last year");
    expect(the(kit).categories[0]).toBe("Jan");
    expect(the(kit).series[0]?.name).toBe("Last year");
    edit(() => kit.session.undo());
    expect(the(kit).series[0]?.name).toBe("2025");
    expect(value(1, 1).value).toBe("12");
  });

  it("adds a row and a column of zeros, and takes them away", async () => {
    const kit = await mount({ elements: [chart()] });
    fireEvent.click(chartPart().getByRole("button", { name: "Add row" }));
    expect(the(kit).categories).toHaveLength(4);
    expect(the(kit).series.map((s) => s.values)).toEqual([[12, 19, 8, 0], [15, 17, 11, 0]]);
    fireEvent.click(chartPart().getByRole("button", { name: "Add column" }));
    expect(the(kit).series).toHaveLength(3);
    expect(the(kit).series[2]?.values).toEqual([0, 0, 0, 0]);
    fireEvent.click(chartPart().getByRole("button", { name: "Remove category 1" }));
    fireEvent.click(chartPart().getByRole("button", { name: "Remove series 1" }));
    expect(the(kit).categories).toEqual(["Q2", "Q3", "Category 4"]);
    expect(the(kit).series.map((s) => s.name)).toEqual(["2026", "Series 3"]);
    edit(() => kit.session.undo());
    expect(the(kit).series).toHaveLength(3);
  });

  it("keeps at least one row and one column", async () => {
    await mount({ elements: [chart({ categories: ["Only"], series: [{ name: "One", values: [1] }] })] });
    expect((chartPart().getByRole("button", { name: "Remove category 1" }) as HTMLButtonElement).disabled).toBe(true);
    expect((chartPart().getByRole("button", { name: "Remove series 1" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("replaces the data with cells pasted from a spreadsheet into any box, as one step of undo", async () => {
    const kit = await mount({ elements: [chart()] });
    const before = kit.session.state.undoLabel;
    paste(value(1, 1), "Month\tVisits\nJan\t100\nFeb\t120\nMar\t90\nApr\t140\n");
    expect(the(kit).categories).toEqual(["Jan", "Feb", "Mar", "Apr"]);
    expect(the(kit).series).toEqual([{ name: "Visits", values: [100, 120, 90, 140] }]);
    expect(value(1, 4).value).toBe("140");
    edit(() => kit.session.undo());
    expect(the(kit).categories).toEqual(["Q1", "Q2", "Q3"]);
    expect(the(kit).series).toHaveLength(2);
    expect(kit.session.state.undoLabel).toBe(before);
  });

  it("leaves a single value pasted into a box to the box", async () => {
    const kit = await mount({ elements: [chart()] });
    paste(value(1, 1), "42\r\n");
    expect(the(kit).series[0]?.values).toEqual([12, 19, 8]);
  });

  it("reads pasted CSV text from its own box when the button is pressed, and says when it finds no table", async () => {
    const kit = await mount({ elements: [chart()] });
    fireEvent.click(chartPart().getByRole("button", { name: "Paste data" }));
    const box = chartPart().getByLabelText("Pasted table") as HTMLTextAreaElement;
    const apply = chartPart().getByRole("button", { name: "Replace the data" }) as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
    fireEvent.change(box, { target: { value: "just words" } });
    // Text pasted into the box is only text; the button reads it.
    fireEvent.click(apply);
    expect(chartPart().getByRole("alert").textContent).toMatch(/No table found/);
    expect(the(kit).categories).toEqual(["Q1", "Q2", "Q3"]);
    fireEvent.change(box, { target: { value: "Team,Wins,Losses\nRed,5,2\nBlue,3,4" } });
    fireEvent.click(apply);
    expect(the(kit).categories).toEqual(["Red", "Blue"]);
    expect(the(kit).series.map((s) => [s.name, s.values])).toEqual([["Wins", [5, 3]], ["Losses", [2, 4]]]);
    expect(chartPart().queryByLabelText("Pasted table")).toBeNull();
  });

  it("does not paste into the box as a table before the button is pressed", async () => {
    const kit = await mount({ elements: [chart()] });
    fireEvent.click(chartPart().getByRole("button", { name: "Paste data" }));
    paste(chartPart().getByLabelText("Pasted table"), "a\t1\nb\t2");
    expect(the(kit).categories).toEqual(["Q1", "Q2", "Q3"]);
  });

  it("says Mixed for charts with different data, and still sets the type of all", async () => {
    const kit = await mount({ elements: [chart(), chart({ categories: ["x"], series: [{ name: "s", values: [1] }], y: 20 })] });
    expect(chartPart().getByText(/Mixed: the selected items have different data/)).toBeTruthy();
    expect(chartPart().queryByRole("button", { name: "Add row" })).toBeNull();
    fireEvent.change(chartPart().getByRole("combobox", { name: "Chart type" }), { target: { value: "line" } });
    expect(kit.ids.map((id) => (held(kit, id) as Of<"chart">).kind)).toEqual(["line", "line"]);
  });

  it("is a section of a chart only", async () => {
    await mount({ elements: [{ type: "shape", id: "", shape: "rect", ...at } as Element] });
    expect(screen.queryByRole("heading", { name: "Chart" })).toBeNull();
  });
});
