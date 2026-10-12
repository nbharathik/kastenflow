// Settings → Whiteboards: the two switches and what a double-click makes.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { BoardsSettings } from "./BoardsSettings";
import { useBoardPrefs } from "./board-prefs";

beforeEach(() => {
  localStorage.clear();
  useBoardPrefs.setState({ alwaysToolbar: false, minimap: false, doubleClick: "card" });
});
afterEach(cleanup);

const saved = () => JSON.parse(localStorage.getItem("kasten.board.prefs") ?? "{}");

describe("Settings → Whiteboards", () => {
  it("starts quiet: the toolbar rests and there is no minimap", () => {
    render(<BoardsSettings />);
    expect((screen.getByRole("switch", { name: "Always show the toolbar" }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole("switch", { name: "Show the minimap" }) as HTMLInputElement).checked).toBe(false);
    expect(screen.getByRole("radio", { name: "A card" }).getAttribute("aria-checked")).toBe("true");
  });

  it("keeps each choice for every board, in this browser", () => {
    render(<BoardsSettings />);
    fireEvent.click(screen.getByRole("switch", { name: "Always show the toolbar" }));
    fireEvent.click(screen.getByRole("switch", { name: "Show the minimap" }));
    fireEvent.click(screen.getByRole("radio", { name: "A sticky" }));
    expect(useBoardPrefs.getState()).toMatchObject({ alwaysToolbar: true, minimap: true, doubleClick: "sticky" });
    expect(saved()).toEqual({ alwaysToolbar: true, minimap: true, doubleClick: "sticky" });
    expect((screen.getByRole("switch", { name: "Show the minimap" }) as HTMLInputElement).checked).toBe(true);
  });

  it("works when the browser keeps nothing", () => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error("blocked");
    };
    try {
      render(<BoardsSettings />);
      fireEvent.click(screen.getByRole("switch", { name: "Show the minimap" }));
      expect(useBoardPrefs.getState().minimap).toBe(true);
    } finally {
      Storage.prototype.setItem = set;
    }
  });
});
