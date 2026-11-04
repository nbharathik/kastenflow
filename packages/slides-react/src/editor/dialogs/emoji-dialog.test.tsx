import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { TextHandle } from "../text-handle.ts";
import { mountDialogs } from "./test-kit.tsx";

afterEach(cleanup);

const search = () => screen.getByRole("searchbox", { name: "Search emoji" }) as HTMLInputElement;
const cells = () => within(screen.getByRole("dialog", { name: "Emoji" })).getAllByRole("button").filter((b) => b.classList.contains("ks-em-cell"));

describe("the emoji picker", () => {
  it("opens with the search box focused and a grid of pictures under their categories", async () => {
    await mountDialogs({ dialog: "emoji" });
    expect(document.activeElement).toBe(search());
    for (const group of ["Faces", "Hands & people", "Symbols", "Objects & food"]) expect(screen.getByRole("group", { name: group })).toBeTruthy();
    expect(cells().length).toBeGreaterThan(40);
    expect(screen.getByRole("button", { name: "rocket" }).textContent).toBe("🚀");
  });

  it("finds pictures by name, and says when there are none", async () => {
    await mountDialogs({ dialog: "emoji" });
    fireEvent.change(search(), { target: { value: "fire" } });
    expect(cells().map((b) => b.textContent)).toEqual(["🔥"]);
    fireEvent.change(search(), { target: { value: "zzz" } });
    expect(screen.getByText("No emoji has that name.")).toBeTruthy();
    expect(cells()).toHaveLength(0);
  });

  it("puts a picture on the slide as a large text box in the free place when no words are being typed, as one step of undo", async () => {
    const kit = await mountDialogs({ dialog: "emoji" });
    const before = kit.session.state.undoLabel;
    fireEvent.click(screen.getByRole("button", { name: "tada" }));
    expect(kit.ui.state.dialog).toBeNull();
    const [made] = kit.session.slide.elements;
    expect(made?.type).toBe("text");
    expect(made?.type === "text" && made.text.paragraphs[0]?.runs[0]?.t).toBe("🎉");
    expect(made?.type === "text" && made.text.paragraphs[0]?.runs[0]?.size).toBeGreaterThan(30);
    expect(kit.session.state.selection).toEqual([made?.id]);
    expect(kit.errors).toEqual([]);
    kit.session.undo();
    expect(kit.session.slide.elements).toHaveLength(0);
    expect(kit.session.state.undoLabel).toBe(before);
  });

  it("types the picture into the words being edited instead, and adds no text box", async () => {
    const kit = await mountDialogs({ dialog: null });
    const insertText = vi.fn();
    act(() => kit.ui.setText({ insertText } as unknown as TextHandle));
    act(() => kit.ui.openDialog("emoji"));
    expect(screen.getByText("It goes in at the caret.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "wave" }));
    expect(insertText).toHaveBeenCalledWith("👋");
    expect(kit.session.slide.elements).toHaveLength(0);
    expect(kit.ui.state.dialog).toBeNull();
  });

  it("moves between the pictures with the arrow keys, and closes on Escape without adding anything", async () => {
    const kit = await mountDialogs({ dialog: "emoji" });
    fireEvent.keyDown(search(), { key: "ArrowDown" });
    const [first, second] = cells();
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first as HTMLElement, { key: "ArrowRight" });
    expect(document.activeElement).toBe(second);
    fireEvent.keyDown(second as HTMLElement, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Emoji" }), { key: "Escape" });
    expect(kit.ui.state.dialog).toBeNull();
    expect(kit.session.slide.elements).toHaveLength(0);
  });
});
