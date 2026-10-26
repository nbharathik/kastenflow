import { describe, expect, it, vi } from "vitest";

import { COMMANDS, commandOf, dispatchKey, keysOf } from "./index.ts";
import type { CommandContext } from "./types.ts";

const context = (present: ReturnType<typeof vi.fn>) => ({ session: {}, ui: { actions: { present } } }) as unknown as CommandContext;

describe("the commands for presenting", () => {
  it("are Present and Present from beginning in the View menu's list, and the presenter's view and the page that scrolls", () => {
    for (const id of ["view.present", "view.present-start", "view.presenter", "view.present-scroll"]) expect(COMMANDS.has(id), id).toBe(true);
    expect(keysOf("view.present")).toMatch(/Enter/);
    expect(keysOf("view.present-start")).toMatch(/Shift.*Enter|Enter/);
    expect(keysOf("view.presenter")).toMatch(/Alt.*Enter|Enter/);
  });

  it("answer to the keys of PowerPoint and Google Slides as well as the Ctrl+Enter ones", () => {
    const keys = (id: string) => commandOf(id).keys ?? [];
    expect(keys("view.present-start")).toEqual(expect.arrayContaining(["F5", "Mod+Shift+Enter"]));
    expect(keys("view.present")).toEqual(expect.arrayContaining(["Shift+F5", "Mod+Enter"]));
    expect(keys("view.presenter")).toEqual(expect.arrayContaining(["Alt+F5", "Mod+Alt+Enter"]));
    // The menus keep showing the Ctrl+Enter ones, which every host has.
    expect(keysOf("view.present")).toBe("Ctrl+Enter");
  });

  it("run from the keys: F5 from the start, Shift+F5 from the slide shown, Alt+F5 with the presenter's view, also in a text box or a field", () => {
    const keyEvent = (init: KeyboardEventInit) => new KeyboardEvent("keydown", { cancelable: true, ...init });
    const cases: [KeyboardEventInit, unknown[]][] = [
      [{ key: "F5" }, ["start"]],
      [{ key: "F5", shiftKey: true }, ["current"]],
      [{ key: "F5", altKey: true }, ["current", { presenter: true }]],
    ];
    for (const area of ["stage", "canvas", "text", "field"] as const) {
      for (const [init, expected] of cases) {
        const present = vi.fn();
        const used = dispatchKey(keyEvent(init), context(present), area);
        expect(used, `${area} ${JSON.stringify(init)}`).toBe(true);
        expect(present.mock.calls, `${area} ${JSON.stringify(init)}`).toEqual([expected]);
      }
    }
  });

  it("leave a plain letter alone in a text box", () => {
    const present = vi.fn();
    expect(dispatchKey(new KeyboardEvent("keydown", { key: "f", code: "KeyF" }), context(present), "text")).toBe(false);
    expect(present).not.toHaveBeenCalled();
  });

  it("go through the host's present action", async () => {
    const present = vi.fn();
    await commandOf("view.present").run(context(present));
    await commandOf("view.present-start").run(context(present));
    await commandOf("view.presenter").run(context(present));
    await commandOf("view.present-scroll").run(context(present));
    await commandOf("view.rehearse").run(context(present));
    expect(present.mock.calls).toEqual([["current"], ["start"], ["current", { presenter: true }], ["start", { view: "scroll" }], ["start", { presenter: true, rehearse: true }]]);
  });

  it("has Rehearse, which opens the presenter's view and asks it to time the talk, from the first slide", () => {
    expect(COMMANDS.get("view.rehearse")?.label).toBe("Rehearse");
    expect(keysOf("view.rehearse")).toBeUndefined();
  });

  it("do nothing where the host has no present action", async () => {
    const bare = { session: {}, ui: { actions: {} } } as unknown as CommandContext;
    await expect(Promise.resolve(commandOf("view.presenter").run(bare))).resolves.toBeUndefined();
  });

  it("take no key that another command has", () => {
    const mine = ["view.present", "view.present-start", "view.presenter", "view.present-scroll"];
    const owners = new Map<string, string>();
    for (const command of COMMANDS.values()) {
      for (const key of command.keys ?? []) owners.set(key, `${owners.get(key) ?? ""} ${command.id}`.trim());
    }
    for (const id of mine) {
      for (const key of commandOf(id).keys ?? []) expect(owners.get(key), `${id}: ${key}`).toBe(id);
    }
  });
});
