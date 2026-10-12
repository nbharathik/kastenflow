// The window's title names what the focused pane shows.

import { describe, expect, it } from "vitest";

import type { BoardInfo, NoteMeta } from "../lib/vault/types";
import { titleFor } from "./window-title";

const notes = [{ path: "library/trip.md", title: "Trip plan", kind: "page" } as NoteMeta];
const boards = [{ path: "boards/ideas.canvas", title: "Ideas" } as BoardInfo];

describe("window title", () => {
  it("names the page, board or view open", () => {
    expect(titleFor({ view: "page", path: "library/trip.md" }, notes, boards)).toBe("Trip plan · KastenFlow");
    expect(titleFor({ view: "boards", path: "boards/ideas.canvas" }, notes, boards)).toBe("Ideas · KastenFlow");
    expect(titleFor({ view: "journal" }, notes, boards)).toBe("Journal · KastenFlow");
    expect(titleFor({ view: "home" }, notes, boards)).toBe("Home · KastenFlow");
    expect(titleFor({ view: "page", path: "library/gone.md" }, notes, boards)).toBe("KastenFlow");
  });
});
