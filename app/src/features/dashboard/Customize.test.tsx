// Customize: a small popover to turn sections on and off, drag them into
// order (or move them with the arrows), and put the usual set back.

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Customize } from "./Customize";
import { sameList, type SectionDef } from "./sections";

type Id = "a" | "b" | "c" | "d";
const DEFS: SectionDef<Id>[] = [
  { id: "a", label: "Alpha", icon: "home", hint: "The first", zone: "main" },
  { id: "b", label: "Beta", icon: "home", hint: "The second", zone: "side" },
  { id: "c", label: "Gamma", icon: "home", hint: "The third", zone: "main" },
  { id: "d", label: "Delta", icon: "home", hint: "The fourth", zone: "side" },
];
const USUAL: Id[] = ["a", "b"];

/** A parent that keeps the choice, as Home's does in its preferences. */
function Host({ start = USUAL, onChange = () => {}, resetLabel }: { start?: Id[]; onChange?: (next: Id[]) => void; resetLabel?: string }) {
  const [sections, set] = useState<Id[]>(start);
  return (
    <>
      <Customize
        label="Home"
        defs={DEFS}
        sections={sections}
        defaults={USUAL}
        resetLabel={resetLabel}
        onChange={(next) => {
          set(next);
          onChange(next);
        }}
      />
      <output aria-label="Choice">{sections.join(",")}</output>
    </>
  );
}

const open = () => {
  fireEvent.click(screen.getByRole("button", { name: "Customize home" }));
  return screen.getByRole("dialog", { name: "Customize home" });
};
const choice = () => screen.getByLabelText("Choice").textContent;
const order = (menu: HTMLElement) => within(menu).getAllByRole("listitem").map((li) => li.textContent?.replace(/Side|Move.*/g, "").trim());
const dragData = () => ({ dataTransfer: { effectAllowed: "", setData: vi.fn() } });

afterEach(cleanup);

describe("Customize", () => {
  it("lists the shown sections first, in their order, then the ones left off", () => {
    render(<Host start={["c", "a"]} />);
    expect(order(open())).toEqual(["Gamma", "Alpha", "Beta", "Delta"]);
  });

  it("turns a section on or off", () => {
    render(<Host />);
    const menu = open();
    fireEvent.click(within(menu).getByRole("checkbox", { name: "Gamma" }));
    expect(choice()).toBe("a,b,c");
    fireEvent.click(within(menu).getByRole("checkbox", { name: "Alpha" }));
    expect(choice()).toBe("b,c");
    expect((within(menu).getByRole("checkbox", { name: "Alpha" }) as HTMLInputElement).checked).toBe(false);
  });

  it("keeps a section's hint for its tooltip and marks the ones that sit at the side", () => {
    render(<Host />);
    const menu = open();
    expect(within(menu).getByRole("checkbox", { name: "Beta" }).closest("label")!.title).toBe("The second");
    expect(within(menu).getAllByText("Side")).toHaveLength(2);
  });

  it("puts a section where another is dropped, and only shown ones can be dragged", () => {
    render(<Host start={["a", "b", "c"]} />);
    const menu = open();
    const items = within(menu).getAllByRole("listitem");
    expect(items.map((li) => li.getAttribute("draggable"))).toEqual(["true", "true", "true", "false"]);
    fireEvent.dragStart(items[2]!, dragData());
    fireEvent.dragOver(items[0]!, dragData());
    expect(items[0]!.className).toContain("is-over");
    fireEvent.drop(items[0]!, dragData());
    expect(choice()).toBe("c,a,b");
    expect(items[0]!.className).not.toContain("is-over");
    // A section that is off is no place to drop on, or to drag from.
    fireEvent.dragStart(items[1]!, dragData());
    fireEvent.drop(items[3]!, dragData());
    expect(choice()).toBe("c,a,b");
  });

  it("moves a section with the arrows too, for the keyboard", () => {
    render(<Host start={["a", "b", "c"]} />);
    const menu = open();
    expect((within(menu).getByRole("button", { name: "Move Alpha up" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(menu).getByRole("button", { name: "Move Gamma down" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(menu).getByRole("button", { name: "Move Gamma up" }));
    expect(choice()).toBe("a,c,b");
    fireEvent.click(within(menu).getByRole("button", { name: "Move Alpha down" }));
    expect(choice()).toBe("c,a,b");
    expect(within(menu).queryByRole("button", { name: "Move Delta up" })).toBeNull();
  });

  it("puts the usual set back with a button that says what it does, and is quiet while it is so", () => {
    render(<Host start={["b", "d"]} resetLabel="Reset to the simple layout" />);
    const menu = open();
    const reset = within(menu).getByRole("button", { name: "Reset to the simple layout" }) as HTMLButtonElement;
    expect(reset.disabled).toBe(false);
    fireEvent.click(reset);
    expect(sameList(choice()!.split(","), USUAL)).toBe(true);
    expect(reset.disabled).toBe(true);
  });

  it("says Reset to the usual unless told otherwise, and closes with Escape", () => {
    render(<Host />);
    const menu = open();
    expect(within(menu).getByRole("button", { name: "Reset to the usual" })).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Customize home" })).toBeNull();
  });
});
