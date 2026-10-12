import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NumberField } from "./Fields.tsx";

afterEach(cleanup);

function setup(extra: Partial<Parameters<typeof NumberField>[0]> = {}) {
  const onCommit = vi.fn();
  render(<NumberField label="Width" short="W" value={100} onCommit={onCommit} step={1} min={0} max={500} decimals={1} {...extra} />);
  const box = screen.getByRole("textbox", { name: "Width" }) as HTMLInputElement;
  const handle = screen.getByText("W");
  return { onCommit, box, handle };
}

const down = (el: Element, x: number) => fireEvent.pointerDown(el, { clientX: x, button: 0, buttons: 1, pointerId: 1 });
const move = (el: Element, x: number, extra: object = {}) => fireEvent.pointerMove(el, { clientX: x, buttons: 1, pointerId: 1, ...extra });
const up = (el: Element, x: number) => fireEvent.pointerUp(el, { clientX: x, button: 0, pointerId: 1 });

describe("a number", () => {
  it("shows the short word as its label for the eye and keeps the full name for a screen reader", () => {
    const { box, handle } = setup();
    expect(box.getAttribute("aria-label")).toBe("Width");
    expect(handle.getAttribute("aria-hidden")).toBe("true");
    expect(box.value).toBe("100");
  });

  it("turns as its label is dragged sideways: the box changes under the pointer, the deck once, when it is let go", () => {
    const { box, handle, onCommit } = setup();
    down(handle, 200);
    move(handle, 240);
    expect(box.value).toBe("110");
    move(handle, 280);
    expect(box.value).toBe("120");
    expect(onCommit).not.toHaveBeenCalled();
    up(handle, 280);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(120);
  });

  it("goes down as well as up, stays in its bounds, and goes ten times as fast with Shift", () => {
    const { box, handle, onCommit } = setup();
    down(handle, 200);
    move(handle, 100);
    expect(box.value).toBe("75");
    move(handle, -4000);
    expect(box.value).toBe("0");
    move(handle, 208, { shiftKey: true });
    expect(box.value).toBe("120");
    up(handle, 208);
    expect(onCommit).toHaveBeenLastCalledWith(120);
  });

  it("is not a drag when the pointer hardly moves: nothing is committed", () => {
    const { handle, onCommit } = setup();
    down(handle, 200);
    move(handle, 201);
    up(handle, 201);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("takes Enter for itself: the key does not go on to a text box that gets the focus when the number is committed", () => {
    const { box, onCommit } = setup();
    fireEvent.change(box, { target: { value: "150" } });
    // A key press whose default action is not prevented goes on to type in whatever has the focus by then.
    const notPrevented = fireEvent.keyDown(box, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith(150);
    expect(notPrevented).toBe(false);
  });

  it("does nothing when it is off", () => {
    const { box, handle, onCommit } = setup({ disabled: true });
    down(handle, 200);
    move(handle, 300);
    up(handle, 300);
    expect(box.value).toBe("100");
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("steps with the arrow keys, ten times as far with Shift or Page Up, a tenth as far with Alt", () => {
    const { box, onCommit } = setup();
    // Each step starts from what the box shows now, which a parent that keeps the old value does not change.
    fireEvent.keyDown(box, { key: "ArrowUp" });
    expect(onCommit).toHaveBeenLastCalledWith(101);
    fireEvent.keyDown(box, { key: "ArrowDown", shiftKey: true });
    expect(onCommit).toHaveBeenLastCalledWith(91);
    fireEvent.keyDown(box, { key: "PageUp" });
    expect(onCommit).toHaveBeenLastCalledWith(101);
    fireEvent.keyDown(box, { key: "ArrowUp", altKey: true });
    expect(onCommit).toHaveBeenLastCalledWith(101.1);
  });

  it("commits what is typed on Enter, and puts the old number back on Escape", () => {
    const { box, onCommit } = setup();
    fireEvent.change(box, { target: { value: "42" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onCommit).toHaveBeenLastCalledWith(42);
    fireEvent.change(box, { target: { value: "7" } });
    fireEvent.keyDown(box, { key: "Escape" });
    expect(box.value).toBe("100");
  });
});
