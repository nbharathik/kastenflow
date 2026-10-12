// The page footer (sub-pages, backlinks, Details): after the text and the
// space below it, closed until asked, and at the bottom of the pane when the
// page is short. jsdom lays nothing out, so the placement is checked in the
// markup and in the stylesheet; the layout itself is seen in the browser preview.

import { act, cleanup, render, screen, within } from "@testing-library/react";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AppShell } from "../../../shell/AppShell";
import { useShell } from "../../../lib/store";
import { MemoryVault } from "../preview/memory-vault";
import { useWorkspace } from "../store";
import { derive } from "../store-layout";
import { initialLayout } from "../tabs";

/** The app's sources; the tests run from `app/`. */
const SRC = [join(process.cwd(), "src"), join(process.cwd(), "app", "src")].find((dir) => existsSync(join(dir, "main.tsx")))!;
const css = readFileSync(join(SRC, "features/workspace/page/note-page.css"), "utf8");
/** The declarations of the top-level rule whose selector is `selector`, up to any rule nested in it. */
const rule = (selector: string) => css.match(new RegExp(`^${selector.replace(/[.()[\]:,]/g, "\\$&")}\\s*\\{([^{}]*)`, "m"))?.[1] ?? "";

describe("the footer of a page", () => {
  beforeEach(() => {
    localStorage.clear();
    useWorkspace.setState({ client: null, ready: false, notes: [], ...derive(initialLayout()), recent: [], toasts: [] });
    useShell.setState({ sidebarOpen: true, focusMode: false, paletteOpen: false, panels: [] });
  });
  afterEach(cleanup);

  async function open(text: string) {
    const vault = new MemoryVault({ "library/essay.md": text });
    render(<AppShell connect={async () => ({ client: vault })} />);
    await screen.findByRole("navigation", { name: "Sidebar" });
    act(() => useWorkspace.getState().openPath("library/essay.md"));
    await screen.findByRole("textbox", { name: "Page title" }, { timeout: 20_000 });
    return document.querySelector<HTMLElement>(".kasten-page-body")!;
  }

  it("is the last thing in the page's body, after the editor and the space below the text", async () => {
    const body = await open("---\ntitle: Essay\n---\n");
    const footer = body.lastElementChild as HTMLElement;
    expect(footer.tagName).toBe("FOOTER");
    expect(footer.classList.contains("kasten-page-footer")).toBe(true);
    expect(footer.previousElementSibling?.classList.contains("kasten-page-tail")).toBe(true);
    // The body is the page's own column, directly in the pane that scrolls.
    expect(body.parentElement?.classList.contains("kasten-page-main")).toBe(true);
    expect(body.closest(".kasten-page")?.classList.contains("is-compact")).toBe(false);
  });

  it("keeps Details closed until asked", async () => {
    const body = await open("---\ntitle: Essay\n---\n");
    const details = within(body.querySelector<HTMLElement>(".kasten-page-footer")!).getByRole("button", { name: "Details" });
    expect(details.getAttribute("aria-expanded")).toBe("false");
    expect(body.querySelector(".kasten-page-details")).toBeNull();
  });
});

describe("the footer's styles", () => {
  it("make the pane a column, the body fill what the header leaves, and the footer take the room left over", () => {
    const column = ".kasten-page:not(.is-compact, .is-headless)";
    // Only a page with a pane of its own: not a side stack card or a journal day.
    expect(css).toContain(`${column} {`);
    const block = css.slice(css.indexOf(`${column} {`), css.indexOf("/* Below the page"));
    expect(block).toMatch(/& \.kasten-page-main \{[^}]*display: flex;[^}]*flex-direction: column;/);
    expect(block).toMatch(/& \.kasten-page-main > \.kasten-page-body \{[^}]*flex: 1 0 auto;[^}]*flex-direction: column;/);
    expect(block).toMatch(/& \.kasten-page-footer \{[^}]*margin-top: auto;/);
    // Nothing above or inside the body shrinks to make room.
    expect(block).toMatch(/& \.kasten-page-main > \* \{[^}]*flex-shrink: 0;/);
    expect(block).toMatch(/& \.kasten-page-body > \* \{[^}]*flex-shrink: 0;/);
  });

  it("leave about 48px under the footer rather than a third of the window", () => {
    const footer = rule(".kasten-page-footer");
    expect(footer).toContain("padding: 14px 0 48px;");
    expect(css).not.toContain("30vh");
  });

  it("leave the space below the text as it was", () => {
    expect(rule(".kasten-page-tail")).toMatch(/height: 120px;/);
  });
});
