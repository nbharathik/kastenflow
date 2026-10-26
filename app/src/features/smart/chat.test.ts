// The smart page's two chat actions start a chat about that page, and the chat's
// own slash list never offers them (they are for a smart page's header and the palette).

import { beforeEach, describe, expect, it, vi } from "vitest";

import { BUILT_IN_ACTIONS } from "../chat/preview/actions";

const run = vi.hoisted(() => ({ runInChat: vi.fn(async () => true) }));
vi.mock("../chat/run-action", () => run);

import { fixErrors, improveLayout } from "./chat";

beforeEach(() => vi.clearAllMocks());

describe("a smart page's chat actions", () => {
  it("start a chat about the page with the page as its context", async () => {
    await improveLayout("library/t.md", "Tracker");
    expect(run.runInChat).toHaveBeenLastCalledWith("improve-smart-layout", [{ kind: "note", label: "Tracker", ref: ["library/t.md"] }]);
    await fixErrors("library/t.md", "Tracker");
    expect(run.runInChat).toHaveBeenLastCalledWith("fix-smart-errors", [{ kind: "note", label: "Tracker", ref: ["library/t.md"] }]);
  });

  it("are not in the chat's slash list, which shows the actions made for the chat", () => {
    const slash = BUILT_IN_ACTIONS.filter((a) => a.where.includes("chat")).map((a) => a.slug);
    expect(slash).not.toContain("improve-smart-layout");
    expect(slash).not.toContain("fix-smart-errors");
    expect(slash).toContain("make-smart-page");
  });
});
