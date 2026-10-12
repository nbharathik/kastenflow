import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { shape } from "../../factory.ts";
import { EditorUi } from "../../ui-state.ts";
import { SidePanel } from "../SidePanel.tsx";
import { mount } from "./test-kit.tsx";

afterEach(cleanup);

const title = (name: string) => screen.getByRole("button", { name });
const expanded = (name: string) => title(name).getAttribute("aria-expanded");

/** The panel again, as a new editor on the same deck would draw it: nothing is kept but what the browser keeps. */
function reopen(kit: Awaited<ReturnType<typeof mount>>) {
  cleanup();
  const ui = new EditorUi();
  ui.openPanel("format");
  render(<SidePanel session={kit.session} ui={ui} />);
}

describe("the sections of the format options", () => {
  it("stay folded when the editor is opened again", async () => {
    const kit = await mount({ elements: [shape("rect", { x: 10, y: 10, w: 100, h: 50 })] });
    fireEvent.click(title("Fill"));
    fireEvent.click(title("Border"));
    expect(expanded("Fill")).toBe("false");
    reopen(kit);
    expect(expanded("Fill")).toBe("false");
    expect(expanded("Border")).toBe("false");
    expect(expanded("Position")).toBe("true");
  });

  it("can be opened again for good, and one that starts folded stays open once it was opened", async () => {
    const kit = await mount({ elements: [shape("rect", { x: 10, y: 10, w: 100, h: 50 })] });
    const access = "Accessibility and layers";
    expect(expanded(access)).toBe("false");
    fireEvent.click(title(access));
    expect(expanded(access)).toBe("true");
    reopen(kit);
    expect(expanded(access)).toBe("true");
    fireEvent.click(title(access));
    reopen(kit);
    expect(expanded(access)).toBe("false");
  });

  it("are folded and opened without losing what is typed in the ones that stay", async () => {
    await mount({ elements: [shape("rect", { x: 10, y: 10, w: 100, h: 50 })] });
    const x = screen.getByLabelText("X") as HTMLInputElement;
    fireEvent.change(x, { target: { value: "55" } });
    fireEvent.click(title("Fill"));
    expect((screen.getByLabelText("X") as HTMLInputElement).value).toBe("55");
  });
});
