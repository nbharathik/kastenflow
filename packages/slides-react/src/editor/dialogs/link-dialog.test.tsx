import type { Element } from "@kasten-slides/wasm";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PLAIN_FORMAT } from "../../text/handle.ts";
import { shape, textBox } from "../factory.ts";
import type { FormatState } from "../session/text-commands.ts";
import type { TextHandle } from "../text-handle.ts";
import { edit, mountDialogs } from "./test-kit.tsx";

afterEach(cleanup);

const button = (name: string) => screen.getByRole("button", { name });

/** The parts of an open text editor the dialog talks to. */
function fakeEditor(link: string | null = null): TextHandle & { calls: string[] } {
  const calls: string[] = [];
  const format: FormatState = { ...PLAIN_FORMAT, link };
  return { calls, formatState: () => format, setLink: (href: string | null) => calls.push(`link(${href})`), focus: vi.fn() } as unknown as TextHandle & { calls: string[] };
}

describe("Link", () => {
  const boxes = (): Element[] => [
    { ...textBox({ x: 10, y: 10, w: 300, h: 60 }), text: { paragraphs: [{ runs: [{ t: "Hello ", b: true }, { t: "world" }] }] } } as Element,
    shape("rect", { x: 10, y: 100, w: 100, h: 50 }),
  ];
  const runs = (kit: Awaited<ReturnType<typeof mountDialogs>>, at: number) => {
    const e = kit.session.slide.elements.find((x) => x.id === kit.ids[at]) as Extract<Element, { type: "text" | "shape" }>;
    return (e.text?.paragraphs ?? []).flatMap((p) => p.runs);
  };

  it("sets an address on all the words of the selected boxes", async () => {
    const kit = await mountDialogs({ dialog: "link", elements: boxes(), select: [0] });
    fireEvent.change(screen.getByLabelText("Web address"), { target: { value: "https://example.com/a" } });
    fireEvent.click(button("Apply"));
    expect(runs(kit, 0)).toEqual([{ t: "Hello ", b: true, link: "https://example.com/a" }, { t: "world", link: "https://example.com/a" }]);
    expect(kit.ui.state.dialog).toBeNull();
    expect(kit.errors).toEqual([]);
  });

  it("makes a bare address a web address, and says no to one that must not be followed", async () => {
    const kit = await mountDialogs({ dialog: "link", elements: boxes(), select: [0] });
    const address = screen.getByLabelText("Web address");
    fireEvent.change(address, { target: { value: "javascript:alert(1)" } });
    fireEvent.click(button("Apply"));
    expect(screen.getByRole("alert").textContent).toContain("web address");
    expect(runs(kit, 0).every((r) => r.link === undefined)).toBe(true);
    expect(kit.ui.state.dialog).toBe("link");
    fireEvent.change(address, { target: { value: "example.com/docs" } });
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.keyDown(address, { key: "Enter" });
    expect(runs(kit, 0)[0]?.link).toBe("https://example.com/docs");
  });

  it("lists the deck's slides to link to one", async () => {
    const kit = await mountDialogs({
      dialog: "link",
      elements: boxes(),
      select: [0],
      prepare: (engine) => {
        engine.apply("add_slide", { layout: "title-only", content: { title: "The second one" } });
      },
    });
    const slides = within(screen.getByRole("listbox", { name: "Link to a slide" })).getAllByRole("option");
    expect(slides).toHaveLength(kit.session.deck.slides.length);
    // The slide the dialog opens on is added after the first, so the one made here is third.
    expect(slides.map((s) => s.textContent)).toContain("3The second one");
    fireEvent.click(slides.find((s) => s.textContent?.includes("The second one")) as HTMLElement);
    fireEvent.click(button("Apply"));
    const target = kit.session.deck.slides.find((s) => JSON.stringify(s).includes("The second one"));
    expect(runs(kit, 0).map((r) => r.link)).toEqual([`slide:${target?.id}`, `slide:${target?.id}`]);
  });

  it("lists the slides as one stop for Tab, walked with the arrows", async () => {
    await mountDialogs({ dialog: "link", elements: boxes(), select: [0] });
    const slides = within(screen.getByRole("listbox", { name: "Link to a slide" })).getAllByRole("option");
    expect(slides.filter((s) => s.tabIndex === 0)).toHaveLength(1);
    slides[0]?.focus();
    fireEvent.keyDown(slides[0] as HTMLElement, { key: "ArrowDown" });
    expect(document.activeElement).toBe(slides[1]);
    fireEvent.keyDown(slides[1] as HTMLElement, { key: "ArrowRight" });
    expect(document.activeElement).toBe(slides[1]);
  });

  it("prefills from the words that are linked already, and takes the link off", async () => {
    const kit = await mountDialogs({ dialog: "link", elements: boxes(), select: [0] });
    edit(() => kit.session.text.setRun("link", "https://old.example"));
    edit(() => kit.ui.openDialog(null));
    edit(() => kit.ui.openDialog("link"));
    expect((screen.getByLabelText("Web address") as HTMLInputElement).value).toBe("https://old.example");
    fireEvent.click(button("Remove link"));
    expect(runs(kit, 0).every((r) => r.link === undefined)).toBe(true);
    expect(kit.ui.state.dialog).toBeNull();
  });

  it("marks a slide link as the one chosen when the words link to a slide", async () => {
    const kit = await mountDialogs({ dialog: "link", elements: boxes(), select: [0] });
    const first = kit.session.deck.slides[0]!.id;
    edit(() => kit.session.text.setRun("link", `slide:${first}`));
    edit(() => kit.ui.openDialog(null));
    edit(() => kit.ui.openDialog("link"));
    expect((screen.getByLabelText("Web address") as HTMLInputElement).value).toBe("");
    expect(within(screen.getByRole("listbox")).getByRole("option", { selected: true }).textContent).toContain("1");
  });

  it("sets it on the words selected in an open text box, and leaves the deck to that editor", async () => {
    const kit = await mountDialogs({ dialog: null, elements: boxes(), select: [0] });
    const editor = fakeEditor();
    edit(() => {
      kit.ui.setText(editor);
      kit.ui.openDialog("link");
    });
    fireEvent.change(screen.getByLabelText("Web address"), { target: { value: "https://example.com" } });
    fireEvent.click(button("Apply"));
    expect(editor.calls).toEqual(["link(https://example.com)"]);
    expect(runs(kit, 0).every((r) => r.link === undefined)).toBe(true);
  });

  it("removes the link from the words selected in an open text box", async () => {
    const kit = await mountDialogs({ dialog: null, elements: boxes(), select: [0] });
    const editor = fakeEditor("https://old.example");
    edit(() => {
      kit.ui.setText(editor);
      kit.ui.openDialog("link");
    });
    expect((screen.getByLabelText("Web address") as HTMLInputElement).value).toBe("https://old.example");
    fireEvent.click(button("Remove link"));
    expect(editor.calls).toEqual(["link(null)"]);
  });

  it("keeps an open text box open while it is used", async () => {
    await mountDialogs({ dialog: "link", elements: boxes(), select: [0] });
    const body = screen.getByLabelText("Web address").closest("[data-ks-keep-focus]");
    expect(body).not.toBeNull();
  });

  it("has nothing to do with nothing selected", async () => {
    await mountDialogs({ dialog: "link" });
    expect(button("Apply").hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Select some text or a box first.")).toBeTruthy();
  });
});
