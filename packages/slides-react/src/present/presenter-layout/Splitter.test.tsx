import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Splitter } from "./Splitter.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

const rect = (init: Partial<DOMRect>): DOMRect => ({ left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}), ...init });

async function mount(orientation: "vertical" | "horizontal", onChange = vi.fn(), onReset = vi.fn(), value = 0.5) {
  const container = createRef<HTMLDivElement>();
  await act(async () =>
    root.render(
      <div ref={container}>
        <Splitter orientation={orientation} value={value} min={0.2} max={0.8} container={container} label="Resize" onChange={onChange} onReset={onReset} />
      </div>,
    ),
  );
  const bar = host.querySelector<HTMLElement>('[role="separator"]');
  if (!bar || !container.current) throw new Error("not rendered");
  container.current.getBoundingClientRect = () => rect({ width: 1012, height: 612 });
  bar.getBoundingClientRect = () => rect({ width: 12, height: 12 });
  return bar;
}

const fire = (bar: Element, type: string, init: MouseEventInit = {}) => act(async () => void bar.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...init })));
const key = (bar: Element, k: string, init: KeyboardEventInit = {}) => act(async () => void bar.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init })));

describe("the splitter", () => {
  it("is a focusable separator that says where it is and how far it goes", async () => {
    const bar = await mount("vertical");
    expect(bar.getAttribute("aria-orientation")).toBe("vertical");
    expect(bar.getAttribute("aria-valuenow")).toBe("50");
    expect(bar.getAttribute("aria-valuemin")).toBe("20");
    expect(bar.getAttribute("aria-valuemax")).toBe("80");
    expect(bar.tabIndex).toBe(0);
  });

  it("moves by 2% with the arrows, by 10% with Shift, and to the limits with Home and End", async () => {
    const onChange = vi.fn();
    const bar = await mount("vertical", onChange);
    await key(bar, "ArrowRight");
    expect(onChange).toHaveBeenLastCalledWith(expect.closeTo(0.52, 5));
    await key(bar, "ArrowLeft", { shiftKey: true });
    expect(onChange).toHaveBeenLastCalledWith(expect.closeTo(0.4, 5));
    await key(bar, "Home");
    expect(onChange).toHaveBeenLastCalledWith(0.2);
    await key(bar, "End");
    expect(onChange).toHaveBeenLastCalledWith(0.8);
  });

  it("uses the up and down arrows when it is horizontal, and leaves the other arrows alone", async () => {
    const onChange = vi.fn();
    const bar = await mount("horizontal", onChange);
    await key(bar, "ArrowDown");
    expect(onChange).toHaveBeenLastCalledWith(expect.closeTo(0.52, 5));
    onChange.mockClear();
    const sideways = new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true });
    await act(async () => void bar.dispatchEvent(sideways));
    expect(onChange).not.toHaveBeenCalled();
    expect(sideways.defaultPrevented).toBe(false);
  });

  it("keeps its keys from the view's own keys", async () => {
    const heard = vi.fn();
    window.addEventListener("keydown", heard);
    const bar = await mount("vertical");
    await key(bar, "ArrowRight");
    expect(heard).not.toHaveBeenCalled();
    await key(bar, "ArrowDown");
    expect(heard).toHaveBeenCalled();
    window.removeEventListener("keydown", heard);
  });

  it("follows a drag, from the pointer's place in the box", async () => {
    const onChange = vi.fn();
    const bar = await mount("vertical", onChange);
    await fire(bar, "pointermove", { clientX: 300 });
    expect(onChange).not.toHaveBeenCalled();
    await fire(bar, "pointerdown", { clientX: 506 });
    await fire(bar, "pointermove", { clientX: 256 });
    expect(onChange).toHaveBeenLastCalledWith(0.25);
    await fire(bar, "pointermove", { clientX: 5 });
    expect(onChange).toHaveBeenLastCalledWith(0.2);
    await fire(bar, "pointerup");
    onChange.mockClear();
    await fire(bar, "pointermove", { clientX: 500 });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("drags up and down when it is horizontal", async () => {
    const onChange = vi.fn();
    const bar = await mount("horizontal", onChange);
    await fire(bar, "pointerdown", { clientY: 306 });
    await fire(bar, "pointermove", { clientY: 606 });
    expect(onChange).toHaveBeenLastCalledWith(0.8);
  });

  it("goes back to the default on a double-click", async () => {
    const onReset = vi.fn();
    const bar = await mount("vertical", vi.fn(), onReset);
    await fire(bar, "dblclick");
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});
