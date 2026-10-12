import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { shape } from "../factory.ts";
import { edit, mountDialogs } from "./test-kit.tsx";

afterEach(cleanup);

const choices = () => within(screen.getByRole("radiogroup", { name: "Slide size" })).getAllByRole("radio");
const choice = (name: string) => choices().find((card) => card.querySelector(".ks-dg-ratio-name")?.textContent === name)!;
const button = (name: string) => screen.getByRole("button", { name });

describe("Page setup", () => {
  it("offers the four sizes and a custom one, and checks the deck's", async () => {
    await mountDialogs({ dialog: "page" });
    expect(choices().map((card) => card.querySelector(".ks-dg-ratio-name")?.textContent)).toEqual(["16:9", "16:10", "4:3", "1:1", "Custom"]);
    expect(choices().map((card) => card.getAttribute("aria-checked"))).toEqual(["true", "false", "false", "false", "false"]);
    // Each says its size in inches.
    expect(choice("16:9").textContent).toContain("10 × 5.63 in");
    expect(choice("4:3").textContent).toContain("10 × 7.5 in");
    expect(choice("1:1").textContent).toContain("7.5 × 7.5 in");
  });

  it("changes every slide to the size picked, as one step that undo takes back", async () => {
    const kit = await mountDialogs({
      dialog: "page",
      elements: [shape("rect", { x: 100, y: 100, w: 200, h: 90 })],
      prepare: (engine) => void engine.apply("add_slide", { layout: "title-body", content: { title: "Two", body: "words" } }),
    });
    const before = kit.session.deck;
    const revision = kit.session.state.revision;
    fireEvent.click(choice("4:3"));
    expect(choice("4:3").getAttribute("aria-checked")).toBe("true");
    fireEvent.click(button("Apply"));
    expect(kit.session.deck.size).toMatchObject({ w: 960, h: 720 });
    expect(kit.session.state.revision).toBe(revision + 1);
    expect(kit.ui.state.dialog).toBeNull();
    // The slides were refitted with the deck: a box on the shown slide is a third taller and further down.
    const moved = kit.session.slide.elements.find((e) => e.type === "shape")!;
    expect([moved.y, moved.h]).toEqual([133.33, 120]);
    edit(() => kit.session.undo());
    expect(kit.session.deck).toEqual(before);
    expect(kit.errors).toEqual([]);
  });

  it("takes a width and a height of one's own, in inches", async () => {
    const kit = await mountDialogs({ dialog: "page" });
    expect(screen.queryByLabelText("Width")).toBeNull();
    fireEvent.click(choice("Custom"));
    const width = screen.getByLabelText("Width") as HTMLInputElement;
    const height = screen.getByLabelText("Height") as HTMLInputElement;
    expect([width.value, height.value]).toEqual(["10", "5.63"]);
    fireEvent.change(width, { target: { value: "12" } });
    fireEvent.blur(width);
    fireEvent.change(height, { target: { value: "6" } });
    fireEvent.blur(height);
    fireEvent.click(button("Apply"));
    expect(kit.session.deck.size).toMatchObject({ w: 1152, h: 576 });
  });

  it("holds a custom side to what a slide can be", async () => {
    const kit = await mountDialogs({ dialog: "page" });
    fireEvent.click(choice("Custom"));
    const width = screen.getByLabelText("Width") as HTMLInputElement;
    fireEvent.change(width, { target: { value: "0.1" } });
    fireEvent.blur(width);
    expect(width.value).toBe("1");
    fireEvent.change(width, { target: { value: "999" } });
    fireEvent.blur(width);
    expect(width.value).toBe("56");
    fireEvent.click(button("Apply"));
    expect(kit.session.deck.size.w).toBe(5376);
  });

  it("changes nothing, and leaves no step, when the size picked is the deck's own", async () => {
    const kit = await mountDialogs({ dialog: "page" });
    const revision = kit.session.state.revision;
    fireEvent.click(button("Apply"));
    expect(kit.session.state.revision).toBe(revision);
    expect(kit.ui.state.dialog).toBeNull();
  });

  it("checks the size a deck has when it is one of the four, and Custom when it is not", async () => {
    await mountDialogs({ dialog: "page", prepare: (engine) => void engine.apply("set_page_size", { preset: "1:1" }), blank: false });
    expect(choice("1:1").getAttribute("aria-checked")).toBe("true");
    cleanup();
    await mountDialogs({ dialog: "page", prepare: (engine) => void engine.apply("set_page_size", { w: 800, h: 500 }), blank: false });
    expect(choice("Custom").getAttribute("aria-checked")).toBe("true");
    expect((screen.getByLabelText("Width") as HTMLInputElement).value).toBe("8.33");
  });

  it("closes without a change on Cancel", async () => {
    const kit = await mountDialogs({ dialog: "page" });
    fireEvent.click(choice("1:1"));
    fireEvent.click(button("Cancel"));
    expect(kit.session.deck.size).toMatchObject({ w: 960, h: 540 });
    expect(kit.ui.state.dialog).toBeNull();
  });
});
