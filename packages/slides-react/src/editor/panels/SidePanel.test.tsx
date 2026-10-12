import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { shape } from "../factory.ts";
import { edit, mount, sections } from "./format/test-kit.tsx";
import { SidePanel } from "./SidePanel.tsx";

afterEach(cleanup);

const tab = (name: string) => screen.getByRole("tab", { name });

describe("SidePanel", () => {
  it("has a tab for format options, themes, transitions, steps and the assistant, and shows the one that is open", async () => {
    const kit = await mount({ panel: "format" });
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Format options", "Themes", "Transitions", "Steps", "Assistant"]);
    expect(tab("Format options").getAttribute("aria-selected")).toBe("true");
    fireEvent.click(tab("Steps"));
    expect(kit.ui.state.panel).toBe("steps");
    expect(tab("Steps").getAttribute("aria-selected")).toBe("true");
    expect(tab("Format options").getAttribute("aria-selected")).toBe("false");
    fireEvent.click(tab("Assistant"));
    expect(kit.ui.state.panel).toBe("ai");
    fireEvent.click(tab("Format options"));
    expect(kit.ui.state.panel).toBe("format");
  });

  it("closes with its button", async () => {
    const kit = await mount({ panel: "format" });
    fireEvent.click(screen.getByRole("button", { name: "Close panel" }));
    expect(kit.ui.state.panel).toBeNull();
  });

  it("moves between the tabs with the arrow keys", async () => {
    const kit = await mount({ panel: "format" });
    fireEvent.keyDown(tab("Format options"), { key: "ArrowRight" });
    expect(kit.ui.state.panel).toBe("themes");
    fireEvent.keyDown(tab("Themes"), { key: "ArrowRight" });
    expect(kit.ui.state.panel).toBe("transitions");
    fireEvent.keyDown(tab("Transitions"), { key: "ArrowRight" });
    expect(kit.ui.state.panel).toBe("steps");
    fireEvent.keyDown(tab("Steps"), { key: "ArrowRight" });
    expect(kit.ui.state.panel).toBe("ai");
    fireEvent.keyDown(tab("Assistant"), { key: "ArrowRight" });
    expect(kit.ui.state.panel).toBe("format");
    fireEvent.keyDown(tab("Format options"), { key: "ArrowLeft" });
    expect(kit.ui.state.panel).toBe("ai");
  });

  it("shows the steps tab: the builds on top and the grid of the slide's elements under them", async () => {
    await mount({ panel: "steps", elements: [shape("rect", { x: 10, y: 10, w: 100, h: 50 })] });
    const panel = screen.getByRole("tabpanel");
    for (const name of ["Reveal one by one", "Walk through", "Spotlight", "Clear steps"]) expect(within(panel).getByRole("button", { name })).toBeTruthy();
    expect(within(panel).getByRole("grid", { name: "Steps of this slide" })).toBeTruthy();
    expect(sections(), "the folding sections belong to Format options").toEqual([]);
  });

  it("says the assistant is available in KastenFlow where the host has none of its own", async () => {
    await mount({ panel: "ai" });
    const panel = screen.getByRole("tabpanel");
    expect(within(panel).getByRole("heading", { name: "Assistant" })).toBeTruthy();
    expect(panel.textContent).toContain("Available in KastenFlow");
    expect(panel.querySelector("input, textarea, button")).toBeNull();
  });

  it("says something quiet about a panel it has no tab for", async () => {
    await mount({ panel: "comments" });
    expect(screen.getByRole("tabpanel").textContent).toContain("Comments");
    expect(screen.getAllByRole("tab").every((t) => t.getAttribute("aria-selected") === "false")).toBe(true);
  });

  it("follows the selection: the slide's options, then an element's, and back", async () => {
    const kit = await mount({ elements: [shape("rect", { x: 10, y: 10, w: 100, h: 50 })], select: [] });
    expect(sections()).toEqual(["background", "layout", "transition", "numbers", "theme"]);
    edit(() => kit.session.select(kit.ids));
    expect(sections()[0]).toBe("size");
    edit(() => kit.session.select([]));
    expect(sections()[0]).toBe("background");
  });
});

describe("folding sections", () => {
  const title = (name: string) => screen.getByRole("button", { name });

  it("folds a section away with its title and opens it again", async () => {
    await mount({ elements: [shape("rect", { x: 10, y: 10, w: 100, h: 50 })] });
    expect(title("Fill").getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(title("Fill"));
    expect(title("Fill").getAttribute("aria-expanded")).toBe("false");
    // What is folded is out of reach.
    expect(screen.queryByRole("button", { name: "Fill colour" })).toBeNull();
    fireEvent.click(title("Fill"));
    expect(screen.getByRole("button", { name: "Fill colour" })).toBeTruthy();
  });

  it("keeps a folded section folded when the selection changes and comes back", async () => {
    const kit = await mount({ elements: [shape("rect", { x: 10, y: 10, w: 100, h: 50 })] });
    fireEvent.click(title("Border"));
    edit(() => kit.session.select([]));
    expect(sections()).not.toContain("border");
    edit(() => kit.session.select(kit.ids));
    expect(title("Border").getAttribute("aria-expanded")).toBe("false");
    expect(title("Fill").getAttribute("aria-expanded")).toBe("true");
  });

  it("keeps them while another tab is shown", async () => {
    const kit = await mount({ elements: [shape("rect", { x: 10, y: 10, w: 100, h: 50 })] });
    fireEvent.click(title("Position"));
    edit(() => kit.ui.openPanel("steps"));
    edit(() => kit.ui.openPanel("format"));
    expect(title("Position").getAttribute("aria-expanded")).toBe("false");
  });

  it("starts with only the accessibility section folded", async () => {
    await mount({ elements: [shape("rect", { x: 10, y: 10, w: 100, h: 50 })] });
    const folded = [...document.querySelectorAll("[data-section]")].filter((s) => s.querySelector(".ks-sp-section-toggle[aria-expanded='false']")).map((s) => (s as HTMLElement).dataset.section);
    expect(folded).toEqual(["access"]);
  });
});

describe("handing the keys back to the slide", () => {
  /** The panel beside a slide stand-in that can take the focus, as it is in the editor. */
  async function beside() {
    const kit = await mount({ elements: [shape("rect", { x: 100, y: 100, w: 200, h: 100 })] });
    cleanup();
    render(
      <div className="ks-editor">
        <div className="ks-stage" tabIndex={0} data-testid="stage" />
        <SidePanel session={kit.session} ui={kit.ui} />
      </div>,
    );
    return kit;
  }
  const flush = () => Promise.resolve();

  it("puts the change in with Enter, once, and gives the keys to the slide so undo works on it", async () => {
    const kit = await beside();
    const before = kit.session.state.revision;
    const x = screen.getByLabelText("X");
    x.focus();
    fireEvent.change(x, { target: { value: "333" } });
    fireEvent.keyDown(x, { key: "Enter" });
    await flush();
    expect(document.activeElement).toBe(screen.getByTestId("stage"));
    // Leaving the box did not put it in a second time.
    expect(kit.session.state.revision).toBe(before + 1);
    expect(kit.session.slide.elements[0]?.x).toBe(333);
  });

  it("gives the old number back and the keys to the slide with Escape", async () => {
    const kit = await beside();
    const before = kit.session.state.revision;
    const h = screen.getByLabelText("H") as HTMLInputElement;
    h.focus();
    fireEvent.change(h, { target: { value: "999" } });
    fireEvent.keyDown(h, { key: "Escape" });
    await flush();
    expect(document.activeElement).toBe(screen.getByTestId("stage"));
    expect(kit.session.state.revision).toBe(before);
    expect((screen.getByLabelText("H") as HTMLInputElement).value).toBe("100");
  });

  it("leaves the keys where they are for a box that is not typed in, and for other keys", async () => {
    await beside();
    const x = screen.getByLabelText("X");
    x.focus();
    fireEvent.keyDown(x, { key: "a" });
    fireEvent.keyDown(x, { key: "ArrowUp" });
    await flush();
    expect(document.activeElement).toBe(x);
    const lock = screen.getByLabelText("Lock aspect ratio");
    lock.focus();
    fireEvent.keyDown(lock, { key: "Enter" });
    await flush();
    expect(document.activeElement).toBe(lock);
  });
});

describe("keys in the panel", () => {
  it("does not hand Delete and Backspace to the editor, so a focused button never deletes what is selected", async () => {
    const kit = await mount({ elements: [shape("rect", { x: 10, y: 10, w: 100, h: 50 })] });
    const seen = vi.fn();
    cleanup();
    render(
      <div onKeyDown={(event) => seen(event.key)}>
        <SidePanel session={kit.session} ui={kit.ui} />
      </div>,
    );
    const title = screen.getByRole("button", { name: "Fill" });
    fireEvent.keyDown(title, { key: "Delete" });
    fireEvent.keyDown(title, { key: "Backspace" });
    expect(seen).not.toHaveBeenCalled();
    // Other keys still reach the editor's shortcuts.
    fireEvent.keyDown(title, { key: "z", ctrlKey: true });
    expect(seen).toHaveBeenCalledWith("z");
  });
});
