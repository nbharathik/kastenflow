// Insert → Page…: the host asks which page, then the four ways it goes on the slide.

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { withPages } from "../../pages/fake-pages.ts";
import { parsePageLink } from "../../pages/links.ts";
import { COMMANDS, isEnabled, runCommand } from "../commands/index.ts";
import type { SlidesHost } from "../host.ts";
import { Dialogs } from "./Dialogs.tsx";
import { type Kit, mountDialogs } from "./test-kit.tsx";

afterEach(cleanup);

const PLAN = "---\ntitle: Plan\n---\n# Plan\n\nIntro words.\n\n## Risks\n\n- late\n- over budget\n\n## Next\n\nGo.\n";
const PAGE = { path: "projects/talk/plan.md", title: "Plan", markdown: PLAN, icon: "\u{1F4CB}", project: "talk" };

async function open(pages = [PAGE]) {
  const kit: Kit = await mountDialogs({ dialog: null });
  const fake = withPages(kit.host, pages);
  act(() => kit.ui.openDialog("insert-page"));
  return { kit, fake };
}

const way = (name: RegExp) => screen.getByRole("radio", { name });
const insert = () => fireEvent.click(screen.getByRole("button", { name: "Insert" }));
const onSlide = (kit: Kit) => kit.session.slide.elements;

describe("Insert → Page…", () => {
  it("is offered only where the host has pages", async () => {
    const kit = await mountDialogs({ dialog: null });
    expect(isEnabled(COMMANDS.get("insert.page")!, kit)).toBe(false);
    withPages(kit.host, [PAGE]);
    expect(isEnabled(COMMANDS.get("insert.page")!, kit)).toBe(true);
    await runCommand("insert.page", kit);
    expect(kit.ui.state.dialog).toBe("insert-page");
  });

  it("asks the host which page, and closes when none is chosen", async () => {
    const kit = await mountDialogs({ dialog: null });
    const fake = withPages(kit.host, [PAGE]);
    fake.choose = null;
    act(() => kit.ui.openDialog("insert-page"));
    await waitFor(() => expect(kit.ui.state.dialog).toBeNull());
    expect(onSlide(kit)).toHaveLength(0);
  });

  it("shows the page chosen and the four ways it can go on the slide, the embedded page first", async () => {
    await open();
    await screen.findByText("Plan");
    expect(screen.getAllByRole("radio").map((r) => r.closest("label")?.querySelector(".ks-pg-way-name")?.textContent)).toEqual(["Embed the page", "Insert its contents", "Insert a section", "Link to the page"]);
    expect((way(/Embed the page/) as HTMLInputElement).checked).toBe(true);
  });

  it("embeds the page: a live read-only view with the words it was read with", async () => {
    const { kit } = await open();
    await screen.findByText("Plan");
    insert();
    await waitFor(() => expect(onSlide(kit)).toHaveLength(1));
    const [made] = onSlide(kit);
    expect(made).toMatchObject({ type: "embed", url: "", source: { page: PAGE.path, kind: "embed" } });
    expect(kit.ui.state.dialog).toBeNull();
    expect(kit.session.state.selection).toEqual([made?.id]);
  });

  it("inserts the contents as text, or as a slide for each heading", async () => {
    const { kit } = await open();
    await screen.findByText("Plan");
    fireEvent.click(way(/Insert its contents/));
    insert();
    await waitFor(() => expect(onSlide(kit)).toHaveLength(1));
    expect(onSlide(kit)[0]).toMatchObject({ type: "text", source: { kind: "contents", page: PAGE.path, sync: true } });
    cleanup();

    const again = await open();
    await screen.findByText("Plan");
    const slides = again.kit.session.deck.slides.length;
    fireEvent.click(way(/Insert its contents/));
    fireEvent.click(screen.getByRole("checkbox", { name: /One slide for each heading/ }));
    insert();
    await waitFor(() => expect(again.kit.session.deck.slides.length).toBe(slides + 3));
  });

  it("inserts a section chosen by its heading, which is flagged when the page changes", async () => {
    const { kit } = await open();
    await screen.findByText("Plan");
    fireEvent.click(way(/Insert a section/));
    const select = screen.getByRole("combobox", { name: "Section" }) as HTMLSelectElement;
    await waitFor(() => expect([...select.options].map((o) => o.textContent?.trim())).toEqual(["Plan", "Risks", "Next"]));
    fireEvent.change(select, { target: { value: "Risks" } });
    insert();
    await waitFor(() => expect(onSlide(kit)).toHaveLength(1));
    expect(onSlide(kit)[0]).toMatchObject({ source: { kind: "section", section: "Risks", sync: true } });
  });

  it("makes a link to the page: words, or a card, at a heading when one is named", async () => {
    const { kit } = await open();
    await screen.findByText("Plan");
    fireEvent.click(way(/Link to the page/));
    const heading = screen.getByRole("combobox", { name: /Go to a heading/ }) as HTMLSelectElement;
    // The headings arrive after the page is read: choose one only once it is listed.
    await waitFor(() => expect([...heading.options].some((o) => o.value === "Next")).toBe(true));
    fireEvent.change(heading, { target: { value: "Next" } });
    fireEvent.click(screen.getByRole("radio", { name: /on a card/ }));
    insert();
    await waitFor(() => expect(onSlide(kit)).toHaveLength(1));
    const [made] = onSlide(kit);
    expect(made?.type).toBe("shape");
    expect(parsePageLink(made?.link)).toEqual({ path: PAGE.path, section: "Next" });
  });

  it("says so in the dialog, and keeps it open, when the page cannot be read", async () => {
    const { kit, fake } = await open();
    await screen.findByText("Plan");
    fake.remove(PAGE.path);
    insert();
    expect((await screen.findByRole("alert")).textContent).toMatch(/could not be found/);
    expect(kit.ui.state.dialog).toBe("insert-page");
    expect(onSlide(kit)).toHaveLength(0);
  });

  it("stays open when it is mounted twice in a row, as a development build does, and the host's first ask is given up", async () => {
    const kit = await mountDialogs({ dialog: null });
    cleanup();
    withPages(kit.host, [PAGE]);
    // The host's picker keeps the first ask waiting until the second replaces it, as the app's does.
    let waiting: ((page: typeof PAGE | null) => void) | null = null;
    (kit.host as SlidesHost).pickPage = () =>
      new Promise((resolve) => {
        waiting?.(null);
        waiting = resolve as never;
      });
    act(() => kit.ui.openDialog("insert-page"));
    render(
      <StrictMode>
        <Dialogs session={kit.session} ui={kit.ui} />
      </StrictMode>,
    );
    await act(async () => void (await Promise.resolve()));
    expect(kit.ui.state.dialog).toBe("insert-page");
    await act(async () => void waiting?.(PAGE));
    await screen.findByText("Plan");
    expect(kit.ui.state.dialog).toBe("insert-page");
  });

  it("goes back to the host to choose another page", async () => {
    const { fake } = await open([PAGE, { ...PAGE, path: "other.md", title: "Other", markdown: "# Other\n\nWords.\n" }]);
    await screen.findByText("Plan");
    fake.choose = "other.md";
    fireEvent.click(screen.getByRole("button", { name: /Choose another page/ }));
    await screen.findByText("Other");
  });
});
