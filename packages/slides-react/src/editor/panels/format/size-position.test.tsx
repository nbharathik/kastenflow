import type { Element } from "@kasten-slides/wasm";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { line, shape, textBox } from "../../factory.ts";
import { edit, enter, held, mount, sections } from "./test-kit.tsx";

afterEach(cleanup);

const rect = (x: number, y: number, w: number, h: number, extra: Record<string, unknown> = {}): Element => ({ ...shape("rect", { x, y, w, h }), ...extra }) as Element;
const input = (name: string) => screen.getByLabelText(name) as HTMLInputElement;
const boxOf = (kit: Awaited<ReturnType<typeof mount>>, id: string) => {
  const e = held(kit, id);
  return { x: e.x, y: e.y, w: e.w, h: e.h };
};

describe("Size and rotation", () => {
  it("shows the box of one element in pixels, one decimal", async () => {
    await mount({ elements: [rect(100.25, 50, 300, 120.04)] });
    expect(input("X").value).toBe("100.3");
    expect(input("Y").value).toBe("50");
    expect(input("W").value).toBe("300");
    expect(input("H").value).toBe("120");
    expect(input("Rotation").value).toBe("0");
  });

  it("moves an element when X or Y is entered, as one step", async () => {
    const kit = await mount({ elements: [rect(100, 50, 300, 120)] });
    const [id] = kit.ids as [string];
    enter(input("X"), "40");
    expect(boxOf(kit, id)).toEqual({ x: 40, y: 50, w: 300, h: 120 });
    enter(input("Y"), "0.5");
    expect(boxOf(kit, id)).toEqual({ x: 40, y: 0.5, w: 300, h: 120 });
    // Two entries are two steps, and undo takes them back one at a time and puts the numbers back too.
    edit(() => kit.session.undo());
    expect(boxOf(kit, id)).toEqual({ x: 40, y: 50, w: 300, h: 120 });
    expect(input("Y").value).toBe("50");
    edit(() => kit.session.undo());
    expect(input("X").value).toBe("100");
    expect(kit.errors).toEqual([]);
  });

  it("commits when the field is left, not for every key", async () => {
    const kit = await mount({ elements: [rect(100, 50, 300, 120)] });
    const [id] = kit.ids as [string];
    const before = kit.session.state.revision;
    fireEvent.change(input("W"), { target: { value: "2" } });
    fireEvent.change(input("W"), { target: { value: "25" } });
    fireEvent.change(input("W"), { target: { value: "250" } });
    expect(kit.session.state.revision).toBe(before);
    fireEvent.blur(input("W"));
    expect(boxOf(kit, id).w).toBe(250);
    expect(kit.session.state.revision).toBe(before + 1);
    // Leaving a field alone changes nothing and makes no step.
    fireEvent.blur(input("W"));
    fireEvent.blur(input("X"));
    expect(kit.session.state.revision).toBe(before + 1);
  });

  it("resizes from the top left, and keeps the ratio when asked", async () => {
    const kit = await mount({ elements: [rect(100, 50, 300, 120)] });
    const [id] = kit.ids as [string];
    enter(input("W"), "150");
    expect(boxOf(kit, id)).toEqual({ x: 100, y: 50, w: 150, h: 120 });
    fireEvent.click(screen.getByLabelText("Lock aspect ratio"));
    enter(input("H"), "60");
    expect(boxOf(kit, id)).toEqual({ x: 100, y: 50, w: 75, h: 60 });
    enter(input("W"), "300");
    expect(boxOf(kit, id)).toEqual({ x: 100, y: 50, w: 300, h: 240 });
  });

  it("works on a selection as a whole: the fields show the box around it", async () => {
    const kit = await mount({ elements: [rect(100, 100, 100, 100), rect(300, 200, 100, 100)] });
    const [a, b] = kit.ids as [string, string];
    expect([input("X").value, input("Y").value, input("W").value, input("H").value]).toEqual(["100", "100", "300", "200"]);
    // Moving the whole moves each by the same amount.
    enter(input("X"), "0");
    expect(boxOf(kit, a)).toMatchObject({ x: 0, y: 100 });
    expect(boxOf(kit, b)).toMatchObject({ x: 200, y: 200 });
    // Scaling the whole scales positions and sizes from its top left.
    enter(input("W"), "150");
    expect(boxOf(kit, a)).toEqual({ x: 0, y: 100, w: 50, h: 100 });
    expect(boxOf(kit, b)).toEqual({ x: 100, y: 200, w: 50, h: 100 });
    enter(input("H"), "100");
    expect(boxOf(kit, a)).toEqual({ x: 0, y: 100, w: 50, h: 50 });
    expect(boxOf(kit, b)).toEqual({ x: 100, y: 150, w: 50, h: 50 });
    expect(kit.errors).toEqual([]);
  });

  it("turns elements to an angle, showing mixed when they differ, and still works then", async () => {
    const kit = await mount({ elements: [rect(10, 10, 100, 100, { rotation: 30 }), rect(200, 10, 100, 100)] });
    const [a, b] = kit.ids as [string, string];
    const turn = input("Rotation");
    expect(turn.value).toBe("");
    expect(turn.placeholder).toBe("—");
    enter(turn, "90");
    expect(held(kit, a).rotation).toBe(90);
    expect(held(kit, b).rotation).toBe(90);
    expect(input("Rotation").value).toBe("90");
    // An angle is kept between 0 and 360.
    enter(input("Rotation"), "-45");
    expect(held(kit, a).rotation).toBe(315);
  });

  it("flips both ways, and flips a mixed selection to flipped", async () => {
    const kit = await mount({ elements: [rect(10, 10, 100, 100, { flipH: true }), rect(200, 10, 100, 100)] });
    const [a, b] = kit.ids as [string, string];
    const horizontal = screen.getByRole("button", { name: "Flip horizontally" });
    expect(horizontal.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(horizontal);
    expect([held(kit, a).flipH, held(kit, b).flipH]).toEqual([true, true]);
    expect(screen.getByRole("button", { name: "Flip horizontally" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Flip horizontally" }));
    // A flag that is off is not written at all.
    expect([held(kit, a).flipH, held(kit, b).flipH].map(Boolean)).toEqual([false, false]);
    fireEvent.click(screen.getByRole("button", { name: "Flip vertically" }));
    expect([held(kit, a).flipV, held(kit, b).flipV]).toEqual([true, true]);
  });

  it("leaves a locked element where it is", async () => {
    const kit = await mount({ elements: [rect(100, 100, 100, 100, { locked: true }), rect(300, 100, 100, 100)] });
    const [a, b] = kit.ids as [string, string];
    // Only the element that can move is what the fields describe.
    expect(input("X").value).toBe("300");
    enter(input("X"), "350");
    expect(boxOf(kit, a).x).toBe(100);
    expect(boxOf(kit, b).x).toBe(350);
  });

  it("is off for a selection that is all locked", async () => {
    await mount({ elements: [rect(100, 100, 100, 100, { locked: true })] });
    expect(input("X").disabled).toBe(true);
    expect(input("Rotation").disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Flip horizontally" }).hasAttribute("disabled")).toBe(true);
  });

  it("lets a flat line be resized in one direction", async () => {
    const kit = await mount({ elements: [line("straight", false, { x: 100, y: 200 }, { x: 300, y: 200 })] });
    const [id] = kit.ids as [string];
    expect(input("H").value).toBe("0");
    enter(input("H"), "40");
    expect(held(kit, id).h).toBe(40);
    enter(input("W"), "0");
    expect(held(kit, id).w).toBe(0);
  });

  it("scales a group, and its children with it", async () => {
    const kit = await mount({ elements: [rect(100, 100, 100, 100), rect(300, 100, 100, 100)] });
    edit(() => kit.session.elements.group());
    expect(input("W").value).toBe("300");
    enter(input("W"), "600");
    const [group] = kit.session.slide.elements.filter((e) => e.type === "group");
    expect(group).toMatchObject({ x: 100, w: 600 });
    expect(kit.errors).toEqual([]);
  });
});

describe("Size and rotation: more kinds of element", () => {
  it("works on an element whose place comes from its layout", async () => {
    const kit = await mount({ elements: [], select: [] });
    // The title slide a new deck starts with: its title has no box of its own, the layout says where it goes.
    const first = kit.session.deck.slides[0]!;
    edit(() => kit.session.goTo(first.id));
    const title = first.elements.find((e) => e.placeholder === "title")!;
    expect(title.x).toBeUndefined();
    edit(() => kit.session.select([title.id]));
    expect(input("X").value).toBe("64");
    expect(input("W").value).toBe("832");
    enter(input("X"), "100");
    const moved = kit.session.deck.slides[0]!.elements.find((e) => e.id === title.id)!;
    expect([moved.x, moved.y, moved.w, moved.h]).toEqual([100, 140, 832, 148]);
    expect(kit.errors).toEqual([]);
  });

  it("turns a group by the angle asked for", async () => {
    const kit = await mount({ elements: [rect(100, 100, 100, 100), rect(300, 100, 100, 100)] });
    edit(() => kit.session.elements.group());
    enter(input("Rotation"), "90");
    const group = kit.session.slide.elements.find((e) => e.type === "group") as Extract<Element, { type: "group" }>;
    expect(group.children.map((c) => c.rotation)).toEqual([90, 90]);
    expect(kit.errors).toEqual([]);
  });

  it("changes a text box, a line and a picture in one selection as a whole", async () => {
    const kit = await mount({
      elements: [textBox({ x: 10, y: 10, w: 100, h: 50 }, "Hi"), line("straight", true, { x: 200, y: 10 }, { x: 300, y: 60 }), { type: "image", id: "", src: "assets/x.png", x: 400, y: 10, w: 100, h: 50 } as Element],
    });
    expect([input("X").value, input("W").value, input("H").value]).toEqual(["10", "490", "50"]);
    enter(input("Y"), "200");
    expect(kit.session.slide.elements.map((e) => e.y)).toEqual([200, 200, 200]);
    expect(kit.errors).toEqual([]);
  });
});

describe("Position", () => {
  it("enables aligning for one element (to the slide), distributing for three, and stacking for any", async () => {
    await mount({ elements: [rect(10, 10, 50, 50)] });
    const disabled = (name: string) => screen.getByRole("button", { name }).hasAttribute("disabled");
    expect(disabled("Align left")).toBe(false);
    expect(screen.getByText("Align to slide")).toBeTruthy();
    expect(disabled("Distribute horizontally")).toBe(true);
    expect(disabled("Bring to front")).toBe(false);
    cleanup();

    await mount({ elements: [rect(10, 10, 50, 50), rect(200, 60, 50, 50)] });
    expect(disabled("Align left")).toBe(false);
    expect(screen.queryByText("Align to slide")).toBeNull();
    expect(disabled("Distribute horizontally")).toBe(true);
    cleanup();

    await mount({ elements: [rect(10, 10, 50, 50), rect(200, 60, 50, 50), rect(120, 90, 50, 50)] });
    expect(disabled("Distribute vertically")).toBe(false);
  });

  it("aligns, distributes and orders the selection", async () => {
    const kit = await mount({ elements: [rect(10, 10, 50, 50), rect(200, 60, 50, 50), rect(70, 120, 50, 50)] });
    const [a, b, c] = kit.ids as [string, string, string];
    fireEvent.click(screen.getByRole("button", { name: "Align left" }));
    expect([held(kit, a).x, held(kit, b).x, held(kit, c).x]).toEqual([10, 10, 10]);
    fireEvent.click(screen.getByRole("button", { name: "Align bottom" }));
    expect([held(kit, a).y, held(kit, b).y, held(kit, c).y]).toEqual([120, 120, 120]);
    fireEvent.click(screen.getByRole("button", { name: "Send to back" }));
    expect(kit.session.slide.elements.map((e) => e.id)).toEqual([a, b, c]);
    edit(() => kit.session.select([a]));
    fireEvent.click(screen.getByRole("button", { name: "Bring to front" }));
    expect(kit.session.slide.elements.map((e) => e.id)).toEqual([b, c, a]);
    fireEvent.click(screen.getByRole("button", { name: "Send backward" }));
    expect(kit.session.slide.elements.map((e) => e.id)).toEqual([b, a, c]);
  });

  it("aligns one element to the slide, and still aligns two to each other", async () => {
    const kit = await mount({ elements: [rect(10, 10, 50, 50)] });
    const [a] = kit.ids as [string];
    fireEvent.click(screen.getByRole("button", { name: "Align right" }));
    expect(held(kit, a).x).toBe(910);
    fireEvent.click(screen.getByRole("button", { name: "Align middle" }));
    expect(held(kit, a).y).toBe(245);
    fireEvent.click(screen.getByRole("button", { name: "Align left" }));
    expect(held(kit, a).x).toBe(0);
    expect(kit.errors).toEqual([]);
  });

  it("spreads three elements evenly", async () => {
    const kit = await mount({ elements: [rect(0, 0, 50, 50), rect(60, 0, 50, 50), rect(300, 0, 50, 50)] });
    const [, b] = kit.ids as [string, string, string];
    fireEvent.click(screen.getByRole("button", { name: "Distribute horizontally" }));
    expect(held(kit, b).x).toBe(150);
  });

  it("carries the keys in its tooltips, from the command list", async () => {
    await mount({ elements: [rect(0, 0, 50, 50)] });
    const tip = screen.getByRole("button", { name: "Bring to front" }).getAttribute("data-tip");
    expect(tip).toMatch(/^Bring to front \((Ctrl\+Shift\+Up|⌘⇧Up)\)$/);
  });
});

describe("Which sections show", () => {
  it("shows a section only for the elements it is for", async () => {
    const kit = await mount({ elements: [rect(0, 0, 50, 50, { shape: "roundRect" })] });
    expect(sections()).toEqual(["size", "position", "fill", "border", "radius", "shadow", "text", "access"]);
    edit(() => kit.session.select([]));
    expect(sections()).toEqual(["background", "layout", "transition", "numbers", "theme"]);
  });
});

describe("a text box", () => {
  it("takes size and position like any element", async () => {
    const kit = await mount({ elements: [textBox({ x: 40, y: 40, w: 200, h: 60 }, "Words")] });
    const [id] = kit.ids as [string];
    enter(input("H"), "90");
    expect(held(kit, id).h).toBe(90);
  });
});
