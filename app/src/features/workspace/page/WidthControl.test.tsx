// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PageWidth } from "../prefs";
import { WidthControl } from "./WidthControl";

function setup(value: PageWidth) {
  const onChange = vi.fn();
  render(<WidthControl value={value} onChange={onChange} />);
  return onChange;
}

afterEach(cleanup);

describe("WidthControl", () => {
  it("marks the current choice and makes only it a tab stop", () => {
    setup("wide");
    expect(screen.getByRole("radio", { name: "Wide" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: "Wide" }).getAttribute("tabindex")).toBe("0");
    expect(screen.getByRole("radio", { name: "Normal width" }).getAttribute("tabindex")).toBe("-1");
  });

  it("moves with the arrow keys and focus follows", () => {
    const onChange = setup("normal");
    const normal = screen.getByRole("radio", { name: "Normal width" });
    normal.focus();
    fireEvent.keyDown(normal, { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith("wide");
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: "Wide" }));
  });

  it("wraps around at both ends", () => {
    const onChange = setup("normal");
    fireEvent.keyDown(screen.getByRole("radio", { name: "Normal width" }), { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith("full");
    fireEvent.keyDown(screen.getByRole("radio", { name: "Full width" }), { key: "ArrowDown" });
    expect(onChange).toHaveBeenLastCalledWith("normal");
  });

  it("ignores other keys and clicks choose", () => {
    const onChange = setup("normal");
    fireEvent.keyDown(screen.getByRole("radio", { name: "Normal width" }), { key: "a" });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("radio", { name: "Full width" }));
    expect(onChange).toHaveBeenCalledWith("full");
  });

  it("leaves Up and Down to the menu when inside one", () => {
    const onChange = vi.fn();
    render(
      <div role="menu">
        <WidthControl value="normal" onChange={onChange} />
      </div>,
    );
    fireEvent.keyDown(screen.getByRole("radio", { name: "Normal width" }), { key: "ArrowDown" });
    expect(onChange).not.toHaveBeenCalled();
  });
});
