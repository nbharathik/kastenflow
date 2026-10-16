// Asking before an export or a presentation: nothing is asked when there is nothing to look at; when there is, the dialog says what, and the
// person goes on anyway, shows the thing, or cancels.

import type { Element } from "@kasten-slides/wasm";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { defaultActions } from "../actions.ts";
import { type Kit, mountDialogs } from "../dialogs/test-kit.tsx";
import { lintOf } from "../lint/service.ts";
import { askOf, checkThen } from "./gate.ts";

let kit: Kit | null = null;
afterEach(() => {
  cleanup();
  if (kit) lintOf(kit.session).dispose();
  void kit?.session.dispose();
  kit = null;
});

const missing = { type: "image", id: "gone", src: "assets/gone.png", alt: "A picture", x: 100, y: 200, w: 100, h: 100 } as Element;
const fine = { type: "text", id: "t", x: 100, y: 100, w: 300, h: 60, text: { paragraphs: [{ runs: [{ t: "Hello" }] }] } } as Element;

async function open(elements: Element[]): Promise<Kit> {
  kit = await mountDialogs({
    elements,
    prepare: (engine) => {
      const cover = engine.deck.slides[0]!;
      engine.apply("set_text", { slide: cover.id, id: cover.elements.find((e) => e.placeholder === "subtitle")!.id, markdown: "A subtitle" });
    },
  });
  return kit;
}

const dialog = (name: RegExp | string) => screen.findByRole("dialog", { name });

describe("checkThen", () => {
  it("goes on at once, with no dialog, when there is nothing to look at", async () => {
    const here = await open([fine]);
    const go = vi.fn();
    await checkThen(here.session, here.ui, "pptx", "Export", go);
    expect(go).toHaveBeenCalledTimes(1);
    expect(here.ui.state.dialog).toBeNull();
    expect(askOf(here.ui)).toBeUndefined();
  });

  it("asks first when there is something, and does not go on until the person says so", async () => {
    const here = await open([missing]);
    const go = vi.fn();
    await checkThen(here.session, here.ui, "pptx", "Export", go);
    expect(go).not.toHaveBeenCalled();
    expect(here.ui.state.dialog).toBe("preflight");
    const box = await dialog("Before you export");
    expect(within(box).getByText(/gone\.png/)).toBeTruthy();
    fireEvent.click(within(box).getByRole("button", { name: "Export anyway" }));
    expect(go).toHaveBeenCalledTimes(1);
    expect(here.ui.state.dialog).toBeNull();
  });

  it("says Present for a presentation, and Cancel goes nowhere", async () => {
    const here = await open([missing]);
    const go = vi.fn();
    await checkThen(here.session, here.ui, "present", "Present", go);
    const box = await dialog("Before you present");
    expect(within(box).getByRole("button", { name: "Present anyway" })).toBeTruthy();
    fireEvent.click(within(box).getByRole("button", { name: "Cancel" }));
    expect(go).not.toHaveBeenCalled();
    expect(here.ui.state.dialog).toBeNull();
  });

  it("goes on when the check itself cannot be made", async () => {
    const here = await open([fine]);
    const go = vi.fn();
    const broken = Object.create(here.session, { host: { get: () => { throw new Error("no host"); } } });
    await checkThen(broken, here.ui, "pptx", "Export", go);
    expect(go).toHaveBeenCalledTimes(1);
  });
});

describe("the dialog", () => {
  it("lists the problem with a Show that goes to the slide and selects the element, and leaves the export for later", async () => {
    const here = await open([missing]);
    const go = vi.fn();
    const slide = here.session.state.slideId;
    act(() => here.session.goTo(here.session.deck.slides[0]!.id));
    await checkThen(here.session, here.ui, "pdf", "Export", go);
    const box = await dialog("Before you export");
    fireEvent.click(within(box).getByRole("button", { name: /^Show on slide 2/ }));
    expect(here.session.state.slideId).toBe(slide);
    expect(here.session.state.selection).toEqual(["gone"]);
    expect(here.ui.state.dialog).toBeNull();
    expect(go).not.toHaveBeenCalled();
  });

  it("says what the format changes in the file, and what was not looked at, and looks at the web when asked", async () => {
    const embed = { type: "embed", id: "e", url: "https://example.com", poster: "assets/gone.png", x: 100, y: 200, w: 300, h: 200 } as Element;
    const here = await open([embed]);
    await checkThen(here.session, here.ui, "pptx", "Export", vi.fn());
    const box = await dialog("Before you export");
    expect(within(box).getByRole("region", { name: "What changes in the file" }).textContent).toContain("Embedded web pages (1)");
    const notChecked = within(box).getByRole("region", { name: "Not checked" });
    expect(notChecked.textContent).toContain("1 web address");
    expect(within(notChecked).getByRole("button", { name: /Check web addresses/ })).toBeTruthy();
  });
});

describe("the default actions of a window", () => {
  it("export waits for the person when the check finds something, and delivers when they go on", async () => {
    const here = await open([missing]);
    const actions = defaultActions(here.session, here.host, here.ui);
    actions.exportAs?.("markdown");
    const box = await dialog("Before you export");
    expect(here.host.delivered).toHaveLength(0);
    await act(async () => void fireEvent.click(within(box).getByRole("button", { name: "Export anyway" })));
    await waitFor(() => expect(here.host.delivered).toHaveLength(1));
    expect(here.host.delivered[0]?.name).toMatch(/\.md$/);
  });

  it("export delivers at once, with no question, when the check finds nothing", async () => {
    const here = await open([fine]);
    defaultActions(here.session, here.host, here.ui).exportAs?.("markdown");
    await waitFor(() => expect(here.host.delivered).toHaveLength(1));
    expect(here.ui.state.dialog).toBeNull();
  });

  it("export is not asked about where there is no window to ask in", async () => {
    const here = await open([missing]);
    defaultActions(here.session, here.host).exportAs?.("markdown");
    await waitFor(() => expect(here.host.delivered).toHaveLength(1));
  });
});

describe("the Print or save as PDF dialog", () => {
  it("shows the same check for a PDF, with a Show for each problem", async () => {
    const here = await open([missing]);
    act(() => here.ui.openDialog("export"));
    const box = await dialog("Print or save as PDF");
    expect(await within(box).findByText(/gone\.png/)).toBeTruthy();
    expect(within(box).getByRole("button", { name: /^Show on slide 2/ })).toBeTruthy();
    expect(within(box).getByRole("button", { name: "Print…" })).toBeTruthy();
  });
});
