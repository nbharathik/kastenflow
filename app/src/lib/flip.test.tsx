// Rows slide from where they were to where they are, new rows fade in, and
// nothing is measured or moved while motion is off.

import { render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { flipMoves, useFlip } from "./flip";

const animate = vi.fn(() => ({ cancel() {} }));
/** Where each row is, by key, as the next layout will say. */
let tops: Record<string, number> = {};

function List({ keys }: { keys: string[] }) {
  const box = useRef<HTMLUListElement>(null);
  useFlip(box, keys.join(","));
  return (
    <ul ref={box}>
      {keys.map((key) => (
        <li key={key} data-flip={key} />
      ))}
    </ul>
  );
}

beforeEach(() => {
  animate.mockClear();
  tops = {};
  (HTMLElement.prototype as unknown as { animate: typeof animate }).animate = animate;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const top = this.dataset.flip ? (tops[this.dataset.flip] ?? 0) : 0;
    return { left: 0, top, right: 0, bottom: top, width: 0, height: 0, x: 0, y: top, toJSON() {} } as DOMRect;
  });
  document.documentElement.dataset.motion = "on";
});
afterEach(() => {
  vi.restoreAllMocks();
  delete (HTMLElement.prototype as unknown as { animate?: typeof animate }).animate;
  delete document.documentElement.dataset.motion;
});

describe("flipMoves", () => {
  it("lists rows that moved by more than a pixel or two, and rows that are new", () => {
    const moves = flipMoves(
      new Map([["a", { x: 0, y: 0 }], ["b", { x: 0, y: 30 }], ["c", { x: 0, y: 60 }]]),
      new Map([["a", { x: 0, y: 1 }], ["b", { x: 0, y: 0 }], ["d", { x: 0, y: 30 }]]),
    );
    expect(moves).toEqual([
      { key: "b", dx: 0, dy: 30, fresh: false },
      { key: "d", dx: 0, dy: 0, fresh: true },
    ]);
  });
});

describe("useFlip", () => {
  it("does not animate the first draw", () => {
    render(<List keys={["a", "b"]} />);
    expect(animate).not.toHaveBeenCalled();
  });

  it("slides the rows below a removed row up from where they were", () => {
    tops = { a: 0, b: 30, c: 60 };
    const view = render(<List keys={["a", "b", "c"]} />);
    tops = { a: 0, c: 30 };
    view.rerender(<List keys={["a", "c"]} />);
    expect(animate).toHaveBeenCalledTimes(1);
    expect(animate).toHaveBeenCalledWith([{ translate: "0px 30px" }, { translate: "0 0" }], expect.objectContaining({ duration: 140 }));
  });

  it("fades a new row in", () => {
    tops = { a: 0 };
    const view = render(<List keys={["a"]} />);
    tops = { a: 0, b: 30 };
    view.rerender(<List keys={["a", "b"]} />);
    expect(animate).toHaveBeenCalledWith([{ opacity: 0, translate: "0 4px" }, { opacity: 1, translate: "0 0" }], expect.anything());
  });

  it("does nothing while motion is off", () => {
    document.documentElement.dataset.motion = "off";
    tops = { a: 0, b: 30 };
    const view = render(<List keys={["a", "b"]} />);
    tops = { b: 0 };
    view.rerender(<List keys={["b"]} />);
    expect(animate).not.toHaveBeenCalled();
  });
});
