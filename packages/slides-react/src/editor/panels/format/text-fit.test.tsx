import type { Element } from "@kasten-slides/wasm";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { textBox } from "../../factory.ts";
import { held, mount } from "./test-kit.tsx";

afterEach(cleanup);

const textOf = (element: Element) => (element.type === "text" || element.type === "shape" ? element.text : undefined);

describe("the text section of the format options", () => {
  it("says what the box does when its words do not fit, and changes it from a list", async () => {
    const kit = await mount({ elements: [textBox({ x: 10, y: 10, w: 200, h: 60 }, "Words")] });
    const fit = screen.getByRole("combobox", { name: "Text fitting" }) as HTMLSelectElement;
    expect(fit.value).toBe("none");
    expect([...fit.options].map((o) => o.textContent)).toEqual(["Do not autofit", "Shrink text on overflow", "Resize shape to fit text"]);
    await act(async () => fireEvent.change(fit, { target: { value: "shrink" } }));
    expect(textOf(held(kit, kit.ids[0]!))?.fit).toBe("shrink");
    expect((screen.getByRole("combobox", { name: "Text fitting" }) as HTMLSelectElement).value).toBe("shrink");
  });

  it("has a switch for wrapping lines, on at first", async () => {
    const kit = await mount({ elements: [textBox({ x: 10, y: 10, w: 200, h: 60 }, "Words")] });
    const wrap = screen.getByRole("checkbox", { name: "Wrap text" }) as HTMLInputElement;
    expect(wrap.checked).toBe(true);
    fireEvent.click(wrap);
    expect(textOf(held(kit, kit.ids[0]!))?.wrap).toBe(false);
    expect((screen.getByRole("checkbox", { name: "Wrap text" }) as HTMLInputElement).checked).toBe(false);
  });

  it("has the indents of the words, with a way back to the list's own", async () => {
    await mount({ elements: [textBox({ x: 10, y: 10, w: 200, h: 60 }, "Words")] });
    expect(screen.getByRole("group", { name: "Indentation" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Left indent" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "First line indent" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Back to the list's own" })).toBeTruthy();
  });

  it("sets the left indent typed in", async () => {
    const kit = await mount({ elements: [textBox({ x: 10, y: 10, w: 200, h: 60 }, "Words")] });
    const left = screen.getByRole("textbox", { name: "Left indent" });
    fireEvent.change(left, { target: { value: "24" } });
    fireEvent.keyDown(left, { key: "Enter" });
    expect(textOf(held(kit, kit.ids[0]!))?.paragraphs[0]?.marginLeft).toBe(24);
  });
});
