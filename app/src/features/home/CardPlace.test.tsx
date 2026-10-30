// A card's place while it loads: the frame at once, the lines only after a second.

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CardPlace, LOADER_DELAY_MS } from "./CardPlace";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("CardPlace", () => {
  it("holds the card's frame and title, with the lines hidden for the first second", () => {
    render(<CardPlace id="week" />);
    const card = screen.getByRole("region", { name: "This week" });
    const bones = card.querySelector(".kasten-card-place")!;
    expect(bones.querySelectorAll(".kasten-todo-bone")).toHaveLength(3);
    expect(bones.getAttribute("data-late")).toBe("false");
    act(() => void vi.advanceTimersByTime(LOADER_DELAY_MS - 1));
    expect(bones.getAttribute("data-late")).toBe("false");
    act(() => void vi.advanceTimersByTime(2));
    expect(bones.getAttribute("data-late")).toBe("true");
  });

  it("is about as tall as the card it stands for", () => {
    render(<CardPlace id="boards" />);
    expect(screen.getByRole("region", { name: "Whiteboards" }).querySelectorAll(".kasten-todo-bone")).toHaveLength(5);
  });
});
