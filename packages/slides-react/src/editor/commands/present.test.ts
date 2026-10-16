import { describe, expect, it, vi } from "vitest";

import { COMMANDS, commandOf, keysOf } from "./index.ts";
import type { CommandContext } from "./types.ts";

const context = (present: ReturnType<typeof vi.fn>) => ({ session: {}, ui: { actions: { present } } }) as unknown as CommandContext;

describe("the commands for presenting", () => {
  it("are Present and Present from beginning in the View menu's list, and the presenter's view and the page that scrolls", () => {
    for (const id of ["view.present", "view.present-start", "view.presenter", "view.present-scroll"]) expect(COMMANDS.has(id), id).toBe(true);
    expect(keysOf("view.present")).toMatch(/Enter/);
    expect(keysOf("view.present-start")).toMatch(/Shift.*Enter|Enter/);
    expect(keysOf("view.presenter")).toMatch(/Alt.*Enter|Enter/);
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
