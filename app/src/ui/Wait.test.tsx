// A wait shows nothing at first, then a skeleton (a whole view) or a spinner
// with its words (a part); screen readers hear the words at once.

import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Wait, WAIT_MS } from "./Wait";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("Wait", () => {
  it("draws nothing for the first second, but announces the words", () => {
    const { container } = render(<Wait label="Opening the board" view />);
    expect(screen.getByRole("status").textContent).toBe("Opening the board…");
    expect(container.querySelector(".ui-bones")).toBeNull();
    act(() => {
      vi.advanceTimersByTime(WAIT_MS - 1);
    });
    expect(container.querySelector(".ui-bones")).toBeNull();
  });

  it("then shows a skeleton for a whole view", () => {
    const { container } = render(<Wait label="Opening the board" view />);
    act(() => {
      vi.advanceTimersByTime(WAIT_MS);
    });
    expect(container.querySelector(".ui-bones")).not.toBeNull();
    expect(container.querySelector(".ui-spinner")).toBeNull();
  });

  it("then shows a spinner and the words for a part of a view", () => {
    const { container } = render(<Wait label="Reading the history" />);
    act(() => {
      vi.advanceTimersByTime(WAIT_MS);
    });
    expect(container.querySelector(".ui-spinner")).not.toBeNull();
    expect(container.querySelector(".ui-bones")).toBeNull();
    expect(container.querySelector(".ui-wait-note")?.textContent).toBe("Reading the history…");
  });

  it("can be told not to wait", () => {
    const { container } = render(<Wait label="x" delay={0} />);
    expect(container.querySelector(".ui-spinner")).not.toBeNull();
  });
});
