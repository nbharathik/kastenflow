// A link in a table cell: a plain click leaves it to the cell (which picks
// it), Ctrl or Cmd+click and the arrow button open it in the browser.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../../lib/api")>()),
  openUrl: vi.fn(async () => {}),
}));

import * as api from "../../../../../lib/api";
import type { PropDef } from "../../../../../lib/vault/types";
import { TextCell } from "./TextCell";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function draw(onCell = vi.fn()) {
  render(
    <div onClick={onCell}>
      <TextCell
        value="https://example.com/reading"
        def={{ type: "url" } as PropDef}
        editing={false}
        seed={null}
        label="site of Reading list"
        path="inbox/a.md"
        anchor={createRef()}
        save={vi.fn()}
        finish={vi.fn()}
      />
    </div>,
  );
  return onCell;
}

describe("a link cell", () => {
  it("a plain click does not open it and goes on to the cell", () => {
    const onCell = draw();
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    fireEvent(screen.getByRole("link"), click);
    expect(api.openUrl).not.toHaveBeenCalled();
    expect(click.defaultPrevented).toBe(true);
    expect(onCell).toHaveBeenCalled();
  });

  it("Ctrl+click opens it, and the click goes no further", () => {
    const onCell = draw();
    fireEvent.click(screen.getByRole("link"), { ctrlKey: true });
    expect(api.openUrl).toHaveBeenCalledWith("https://example.com/reading");
    expect(onCell).not.toHaveBeenCalled();
  });

  it("the arrow button opens it, and the click goes no further", () => {
    const onCell = draw();
    fireEvent.click(screen.getByRole("button", { name: "Open link of Reading list" }));
    expect(api.openUrl).toHaveBeenCalledWith("https://example.com/reading");
    expect(onCell).not.toHaveBeenCalled();
  });
});
