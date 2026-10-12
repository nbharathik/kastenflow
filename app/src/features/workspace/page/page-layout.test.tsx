// A page's own font, width and text size: in its frontmatter when it
// differs from the defaults in Settings, chosen from the page menu, and
// shown by the page. A value Kasten does not know stays in the file and
// the default shows.

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AppShell } from "../../../shell/AppShell";
import { useShell } from "../../../lib/store";
import { MemoryVault } from "../preview/memory-vault";
import { usePrefs } from "../prefs";
import { useWorkspace } from "../store";
import { derive } from "../store-layout";
import { initialLayout } from "../tabs";
import { layoutValue, readLayout, shownLayout } from "./page-layout";

const DEFAULTS = { font: "default", textSize: "normal", fullWidth: false } as const;

describe("a page's layout", () => {
  it("reads only the values Kasten knows", () => {
    expect(readLayout("---\ntitle: A\nfont: serif\nwidth: full\ntext: small\n---\n")).toEqual({ font: "serif", width: "full", text: "small" });
    expect(readLayout("---\nfont: comic\nwidth: [wide]\ntext: 'small'\n---\n")).toEqual({ text: "small" });
    expect(readLayout("")).toEqual({});
  });

  it("reads each of the four text sizes, and where links open and how the page is drawn", () => {
    for (const text of ["small", "normal", "large", "xl"] as const) expect(readLayout(`---\ntext: ${text}\n---\n`)).toEqual({ text });
    expect(readLayout("---\ntext: huge\n---\n")).toEqual({});
    expect(readLayout("---\nopens: peek-side\nlayout: sections\n---\n")).toEqual({ opens: "peek-side", layout: "sections" });
    // Another tool's `layout: post` is not Kasten's: it stays in the file and nothing is read.
    expect(readLayout("---\nopens: sideways\nlayout: post\n---\n")).toEqual({});
  });

  it("shows the page's own values over the defaults, and keeps only what differs", () => {
    const serif = { ...DEFAULTS, font: "serif", textSize: "small" } as const;
    expect(shownLayout({}, serif)).toEqual({ font: "serif", text: "small", full: false });
    expect(shownLayout({ font: "sans", text: "normal", width: "full" }, serif)).toEqual({ font: "default", text: "normal", full: true });
    const shown = { font: "default", text: "small", full: true } as const;
    expect(layoutValue("font", shown, serif)).toBe("sans");
    expect(layoutValue("text", shown, serif)).toBeNull();
    expect(layoutValue("width", shown, serif)).toBe("full");
    expect(layoutValue("width", { ...shown, full: false }, { ...DEFAULTS, fullWidth: true })).toBe("normal");
  });

  it("shows and writes each of the four sizes against the default", () => {
    for (const size of ["small", "normal", "large", "xl"] as const) {
      expect(shownLayout({ text: size }, DEFAULTS).text).toBe(size);
      expect(shownLayout({}, { ...DEFAULTS, textSize: size }).text).toBe(size);
      const here = { ...DEFAULTS, textSize: size };
      // The default is never written; every other size is.
      expect(layoutValue("text", { font: "default", text: size, full: false }, here)).toBeNull();
      for (const other of ["small", "normal", "large", "xl"] as const) {
        if (other !== size) expect(layoutValue("text", { font: "default", text: other, full: false }, here)).toBe(other);
      }
    }
  });

  it("is refused by the preview vault for a value Kasten does not know", async () => {
    const vault = new MemoryVault({ "library/a.md": "---\ntitle: A\n---\nA.\n" });
    await expect(vault.setMeta("library/a.md", "font", "comic")).rejects.toThrow("one of: sans, serif, mono");
    expect((await vault.setMeta("library/a.md", "width", "full")).text).toContain("width: full\n");
    await expect(vault.setMeta("library/a.md", "text", "huge")).rejects.toThrow("one of: small, normal, large, xl");
    expect((await vault.setMeta("library/a.md", "text", "xl")).text).toContain("text: xl\n");
    expect((await vault.setMeta("library/a.md", "opens", "right")).text).toContain("opens: right\n");
    await expect(vault.setMeta("library/a.md", "opens", "sideways")).rejects.toThrow("A page's opens is one of: here, tab, right");
    expect((await vault.setMeta("library/a.md", "layout", "sections")).text).toContain("layout: sections\n");
  });
});

describe("the page menu's style", () => {
  let vault: MemoryVault;

  beforeEach(() => {
    localStorage.clear();
    usePrefs.setState({ font: "default", textSize: "normal", fullWidth: false });
    useWorkspace.setState({ client: null, ready: false, notes: [], ...derive(initialLayout()), recent: [], toasts: [] });
    useShell.setState({ sidebarOpen: true, focusMode: false, paletteOpen: false, panels: [] });
  });
  afterEach(cleanup);

  async function open(text: string) {
    vault = new MemoryVault({ "library/essay.md": text });
    render(<AppShell connect={async () => ({ client: vault })} />);
    await screen.findByRole("navigation", { name: "Sidebar" });
    act(() => useWorkspace.getState().openPath("library/essay.md"));
    await screen.findByRole("textbox", { name: "Page title" }, { timeout: 20_000 });
    const page = () => document.querySelector<HTMLElement>(".kasten-page")!;
    // The menu stays open while its style is changed.
    const menu = async () => {
      const shown = screen.queryByRole("group", { name: "Style of this page" });
      if (shown) return shown;
      await act(async () => fireEvent.click(screen.getByRole("button", { name: "Page options" })));
      return screen.getByRole("group", { name: "Style of this page" });
    };
    const file = async () => (await vault.read("library/essay.md")).text;
    return { page, menu, file };
  }

  it("keeps a font and full width in the page, and clears them back to the defaults", async () => {
    const { page, menu, file } = await open("---\ntitle: Essay\n---\nWords.\n");
    await act(async () => fireEvent.click(within(await menu()).getByRole("button", { name: /Serif/ })));
    await waitFor(async () => expect(await file()).toContain("font: serif\n"));
    expect(page().style.getPropertyValue("--page-font")).toContain("serif");

    await act(async () => fireEvent.click(within(await menu()).getByRole("checkbox", { name: "Full width" })));
    await waitFor(async () => expect(await file()).toContain("width: full\n"));
    expect(page().classList.contains("is-full-width")).toBe(true);

    await act(async () => fireEvent.click(within(await menu()).getByRole("button", { name: "Use the default style" })));
    await waitFor(async () => expect(await file()).not.toMatch(/font:|width:/));
    expect(page().classList.contains("is-full-width")).toBe(false);
  }, 30_000);

  it("writes what differs from Settings, and nothing when a choice is the default", async () => {
    usePrefs.setState({ font: "serif", textSize: "small" });
    const { page, menu, file } = await open("---\ntitle: Essay\n---\nWords.\n");
    expect(page().style.getPropertyValue("--page-font-size")).toBe("0.875rem");
    await act(async () => fireEvent.click(within(await menu()).getByRole("button", { name: "Normal text" })));
    await waitFor(async () => expect(await file()).toContain("text: normal\n"));
    expect(page().style.getPropertyValue("--page-font-size")).toBe("1rem");
    // Serif is already the default: picking it adds nothing.
    await act(async () => fireEvent.click(within(await menu()).getByRole("button", { name: /Serif/ })));
    await act(async () => void (await new Promise((r) => setTimeout(r, 50))));
    expect(await file()).not.toContain("font:");
  }, 30_000);

  it("offers four text sizes, shows the page's own, and clears the key when the default is picked", async () => {
    const { page, menu, file } = await open("---\ntitle: Essay\ntext: large\n---\nWords.\n");
    expect(page().style.getPropertyValue("--page-font-size")).toBe("1.125rem");
    const sizes = async () => within(within(await menu()).getByRole("group", { name: "Text size" })).getAllByRole("button");
    expect((await sizes()).map((b) => [b.getAttribute("aria-label"), b.getAttribute("aria-pressed")])).toEqual([
      ["Small text", "false"],
      ["Normal text", "false"],
      ["Large text", "true"],
      ["XL text", "false"],
    ]);

    await act(async () => fireEvent.click(within(await menu()).getByRole("button", { name: "XL text" })));
    await waitFor(async () => expect(await file()).toContain("text: xl\n"));
    expect(page().style.getPropertyValue("--page-font-size")).toBe("1.25rem");

    // Normal is Settings' text size here, so the page carries no `text` key.
    await act(async () => fireEvent.click(within(await menu()).getByRole("button", { name: "Normal text" })));
    await waitFor(async () => expect(await file()).not.toContain("text:"));
    expect(page().style.getPropertyValue("--page-font-size")).toBe("1rem");
  }, 30_000);

  it("takes Large text from Settings for a page that sets none", async () => {
    usePrefs.setState({ textSize: "large" });
    const { page, menu, file } = await open("---\ntitle: Essay\n---\nWords.\n");
    expect(page().style.getPropertyValue("--page-font-size")).toBe("1.125rem");
    expect(within(await menu()).getByRole("button", { name: "Large text" }).getAttribute("aria-pressed")).toBe("true");
    await act(async () => fireEvent.click(within(await menu()).getByRole("button", { name: "Small text" })));
    await waitFor(async () => expect(await file()).toContain("text: small\n"));
    expect(page().style.getPropertyValue("--page-font-size")).toBe("0.875rem");
  }, 30_000);

  it("clears only the style with 'Use the default style', not where links open or how the page is drawn", async () => {
    const { menu, file } = await open("---\ntitle: Essay\nopens: right\nlayout: sections\n---\nWords.\n");
    // Nothing of the style is set yet, so there is nothing to reset.
    expect(within(await menu()).queryByRole("button", { name: "Use the default style" })).toBeNull();
    await act(async () => fireEvent.click(within(await menu()).getByRole("button", { name: "XL text" })));
    await waitFor(async () => expect(await file()).toContain("text: xl\n"));
    await act(async () => fireEvent.click(within(await menu()).getByRole("button", { name: "Use the default style" })));
    await waitFor(async () => expect(await file()).not.toContain("text:"));
    expect(await file()).toContain("opens: right\n");
    expect(await file()).toContain("layout: sections\n");
  }, 30_000);

  it("shows the default for a value it does not know, and leaves that value in the file", async () => {
    const { page, menu, file } = await open("---\ntitle: Essay\nfont: comic   # mine\n---\nWords.\n");
    expect(page().style.getPropertyValue("--page-font")).not.toContain("serif");
    expect(within(await menu()).getByRole("button", { name: /Default/ }).getAttribute("aria-pressed")).toBe("true");
    await act(async () => fireEvent.click(within(await menu()).getByRole("checkbox", { name: "Full width" })));
    await waitFor(async () => expect(await file()).toContain("width: full\n"));
    expect(await file()).toContain("font: comic   # mine\n");
  }, 30_000);
});
