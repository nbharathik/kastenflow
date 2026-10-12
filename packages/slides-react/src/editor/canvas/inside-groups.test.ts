// Going into a group: a double click, Enter, what is hit and moved among what the group holds, Escape up a level,
// a press outside, and ungrouping several groups as one step.

import { describe, expect, it } from "vitest";

import { shape } from "../factory.ts";
import { newDeck } from "../../test/engine.ts";
import type { SlidesHost } from "../host.ts";
import { findElement } from "../session/scope.ts";
import { EditorSession } from "../session/session.ts";
import { EditorUi } from "../ui-state.ts";
import { CanvasController, type PointerInfo } from "./controller.ts";

const host: SlidesHost = { save: async () => ({ status: "saved" }), imageUrl: () => undefined, addImage: async (n) => n, deliver: async () => {} };

const at = (x: number, y: number, extra: Partial<PointerInfo> = {}): PointerInfo => ({ x, y, shift: false, alt: false, mod: false, button: 0, detail: 1, ...extra });

/** A slide with two groups of two boxes each: `a` and `b` in `first`, `c` and `d` in `second`. */
async function setup() {
  const session = new EditorSession(await newDeck("Talk"), host, { saveDelay: 60_000 });
  const ui = new EditorUi();
  ui.toggleSnap();
  const controller = new CanvasController(session, ui, () => 1);
  session.slides.add({ layout: "blank" });
  const [a, b, c, d] = session.elements.insert([
    shape("rect", { x: 100, y: 100, w: 100, h: 100 }),
    shape("rect", { x: 300, y: 200, w: 100, h: 100 }),
    shape("rect", { x: 600, y: 100, w: 100, h: 100 }),
    shape("rect", { x: 600, y: 300, w: 100, h: 100 }),
  ]) as [string, string, string, string];
  session.select([a, b]);
  session.elements.group();
  const first = session.state.selection[0]!;
  session.select([c, d]);
  session.elements.group();
  const second = session.state.selection[0]!;
  session.select([]);
  return { session, ui, controller, a, b, c, d, first, second };
}

const click = (controller: CanvasController, x: number, y: number) => {
  controller.down(at(x, y), { kind: "surface" });
  controller.up(at(x, y));
};

const rectOf = (session: EditorSession, id: string) => {
  const found = findElement(session.slide.elements, id)!;
  return [found.x, found.y, found.w, found.h];
};

describe("going into a group", () => {
  it("is a double click on it, which takes the child under the pointer", async () => {
    const { session, controller, a, first } = await setup();
    click(controller, 150, 150);
    expect(session.state.selection).toEqual([first]);
    expect(session.state.inside).toEqual([]);
    controller.doubleClick(at(150, 150, { detail: 2 }));
    expect(session.state.inside).toEqual([first]);
    expect(session.state.selection).toEqual([a]);
    // What the editor works among is what the group holds.
    expect(session.scope.map((e) => e.id)).toContain(a);
    expect(session.scope.some((e) => e.type === "group")).toBe(false);
  });

  it("takes nothing when the pointer is over the group between its children", async () => {
    const { session, controller, first } = await setup();
    // The group's box takes in the gap between its two children.
    controller.doubleClick(at(250, 150, { detail: 2 }));
    expect(session.state.inside).toEqual([first]);
    expect(session.state.selection).toEqual([]);
  });

  it("goes in with the first child when asked to, as Enter on a selected group does", async () => {
    const { session, a, first } = await setup();
    session.select([first]);
    const group = session.scope.find((e) => e.id === first);
    expect(group?.type).toBe("group");
    if (group?.type === "group") session.enterGroup(first, group.children[0]?.id);
    expect(session.state.inside).toEqual([first]);
    expect(session.state.selection).toEqual([a]);
  });

  it("is refused for what is not a group", async () => {
    const { session } = await setup();
    const [plain] = session.elements.insert([shape("rect", { x: 10, y: 10, w: 50, h: 50 })]) as [string];
    session.enterGroup(plain);
    expect(session.state.inside).toEqual([]);
    session.enterGroup("e-nothing");
    expect(session.state.inside).toEqual([]);
  });
});

describe("inside a group", () => {
  it("a press picks the child, and a drag moves only that one while its group's box follows", async () => {
    const { session, controller, a, b, first } = await setup();
    controller.doubleClick(at(150, 150, { detail: 2 }));
    click(controller, 350, 250);
    expect(session.state.selection).toEqual([b]);
    controller.down(at(350, 250), { kind: "surface" });
    controller.move(at(450, 350));
    controller.move(at(550, 450));
    controller.up(at(550, 450));
    expect(rectOf(session, b)).toEqual([500, 400, 100, 100]);
    expect(rectOf(session, a)).toEqual([100, 100, 100, 100]);
    expect(rectOf(session, first)).toEqual([100, 100, 500, 400]);
  });

  it("keeps the other groups out of reach: a press on one comes out of this group and picks that one", async () => {
    const { session, controller, a, second } = await setup();
    controller.doubleClick(at(150, 150, { detail: 2 }));
    expect(session.state.selection).toEqual([a]);
    click(controller, 650, 150);
    expect(session.state.inside).toEqual([]);
    expect(session.state.selection).toEqual([second]);
  });

  it("a press on empty canvas comes out of it and clears the selection", async () => {
    const { session, controller } = await setup();
    controller.doubleClick(at(150, 150, { detail: 2 }));
    expect(session.state.inside).toHaveLength(1);
    click(controller, 30, 480);
    expect(session.state.inside).toEqual([]);
    expect(session.state.selection).toEqual([]);
  });

  it("Escape goes up one level and selects the group that was left", async () => {
    const { session, controller, first } = await setup();
    controller.doubleClick(at(150, 150, { detail: 2 }));
    expect(session.leaveGroup()).toBe(true);
    expect(session.state.inside).toEqual([]);
    expect(session.state.selection).toEqual([first]);
    expect(session.leaveGroup()).toBe(false);
  });

  it("goes further in, to a group inside a group, and Escape comes back out one at a time", async () => {
    const { session, a, b, first } = await setup();
    session.enterGroup(first);
    session.select([a, b]);
    session.elements.group();
    const inner = session.state.selection[0]!;
    expect(findElement(session.slide.elements, inner)?.type).toBe("group");
    session.enterGroup(inner, a);
    expect(session.state.inside).toEqual([first, inner]);
    expect(session.state.selection).toEqual([a]);
    expect(session.leaveGroup()).toBe(true);
    expect(session.state.inside).toEqual([first]);
    expect(session.state.selection).toEqual([inner]);
    expect(session.leaveGroup()).toBe(true);
    expect(session.state.inside).toEqual([]);
    expect(session.state.selection).toEqual([first]);
  });

  it("is forgotten when the group is taken apart, and when another slide is shown", async () => {
    const { session, controller, a, b, first } = await setup();
    controller.doubleClick(at(150, 150, { detail: 2 }));
    expect(session.state.inside).toEqual([first]);
    session.elements.ungroup([first]);
    expect(session.state.inside).toEqual([]);
    expect(session.state.selection).toEqual([a, b]);

    const { session: other, first: held } = await setup();
    other.enterGroup(held);
    expect(other.state.inside).toEqual([held]);
    other.slides.add({ layout: "blank" });
    expect(other.state.inside).toEqual([]);
  });

  it("selects, aligns and deletes what is in it, each as one step, and the group follows", async () => {
    const { session, controller, a, b, first } = await setup();
    controller.doubleClick(at(150, 150, { detail: 2 }));
    session.select([a, b]);
    const revision = session.state.revision;
    session.elements.align("top");
    expect(session.state.revision).toBe(revision + 1);
    expect(rectOf(session, b)[1]).toBe(100);
    expect(rectOf(session, first)).toEqual([100, 100, 300, 100]);
    session.select([b]);
    session.elements.remove();
    expect(rectOf(session, first)).toEqual([100, 100, 100, 100]);
    session.undo();
    expect(rectOf(session, first)).toEqual([100, 100, 300, 100]);
  });
});

describe("ungrouping", () => {
  it("several groups is one step of undo", async () => {
    const { session, first, second } = await setup();
    const before = session.slide.elements.length;
    session.select([first, second]);
    const revision = session.state.revision;
    session.elements.ungroup();
    expect(session.state.revision).toBe(revision + 1);
    expect(session.slide.elements.some((e) => e.type === "group")).toBe(false);
    expect(session.state.selection).toHaveLength(4);
    session.undo();
    expect(session.slide.elements).toHaveLength(before);
    expect(session.slide.elements.filter((e) => e.type === "group")).toHaveLength(2);
  });
});
