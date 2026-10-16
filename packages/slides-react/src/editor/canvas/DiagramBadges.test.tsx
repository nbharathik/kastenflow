// "Diagram changed — Refresh" on a picture of a diagram that changed after the
// picture was drawn: found through the host, drawn over the slide, and a
// picture the person worked on is offered two ways to refresh.

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { insertDiagram } from "../diagrams.ts";
import type { DiagramPicture, SlidesHost } from "../host.ts";
import { openEditor } from "../menus/testing.ts";
import { DiagramBadges } from "./DiagramBadges.tsx";

afterEach(cleanup);

const OLD: DiagramPicture = { path: "assets/flow.png", source: "library/Flow.drawio", name: "Flow", width: 1200, height: 800, rev: "r1" };
const NEW: DiagramPicture = { path: "assets/flow-2.png", source: "library/Flow.drawio", name: "Flow", width: 1200, height: 800, rev: "r2" };

async function setup(host: Partial<SlidesHost>, picture: DiagramPicture = OLD) {
  const editor = await openEditor();
  Object.assign(editor.host, host);
  const id = (await insertDiagram(editor.session, picture))!;
  const view = render(<DiagramBadges session={editor.session} zoom={1} />);
  return { ...editor, id, view };
}

const badge = () => document.querySelector<HTMLElement>("[data-diagram-badge]");

describe("the badge on a picture of a diagram", () => {
  it("appears once the host says the diagram has another version, and says what it offers", async () => {
    await setup({ diagramRevision: async () => "r2", drawDiagram: async () => NEW });
    await waitFor(() => expect(badge()).not.toBeNull());
    expect(badge()!.textContent).toContain("Diagram changed");
    expect(screen.getByRole("group", { name: "Flow: the diagram changed" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Refresh Flow" })).toBeTruthy();
    // It is a control of the editor, not part of a gesture on the slide.
    expect(badge()!.closest("[data-selbar]")).not.toBeNull();
  });

  it("is not there while the picture is current, or where the host cannot tell", async () => {
    const current = await setup({ diagramRevision: async () => "r1" });
    await act(async () => {});
    expect(badge()).toBeNull();
    cleanup();
    const unable = await setup({});
    await act(async () => {});
    expect(badge()).toBeNull();
    expect(unable.id).toBeTruthy();
    expect(current.id).toBeTruthy();
  });

  it("refreshes the picture on a click, and goes away when it is current", async () => {
    const draw = vi.fn(async () => NEW);
    const { session, id } = await setup({ diagramRevision: async () => "r2", drawDiagram: draw });
    await waitFor(() => expect(badge()).not.toBeNull());
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Refresh Flow" })));
    expect(draw).toHaveBeenCalledWith("library/Flow.drawio");
    expect(session.slide.elements.find((e) => e.id === id)).toMatchObject({ src: "assets/flow-2.png", "x-diagram-rev": "r2" });
    await waitFor(() => expect(badge()).toBeNull());
  });

  it("offers a picture the person worked on two ways: keep their crop and description, or start over", async () => {
    const draw = vi.fn(async () => NEW);
    const editor = await setup({ diagramRevision: async () => "r2", drawDiagram: draw });
    editor.session.elements.patch({ alt: "My own words", crop: { left: 0.1, top: 0.1, right: 0.1, bottom: 0.1 } }, [editor.id]);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Refresh Flow" })).toBeNull());
    expect(screen.getByRole("button", { name: "Refresh Flow and drop my crop and description" })).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Refresh Flow and keep my crop and description" })));
    expect(editor.session.slide.elements.find((e) => e.id === editor.id)).toMatchObject({ src: "assets/flow-2.png", alt: "My own words", crop: { left: 0.1, top: 0.1, right: 0.1, bottom: 0.1 } });
  });

  it("asks again when the host says a diagram changed", async () => {
    let now = "r1";
    let changed: () => void = () => {};
    await setup({
      diagramRevision: async () => now,
      watchDiagrams: (onChange) => {
        changed = onChange;
        return () => {};
      },
    });
    await act(async () => {});
    expect(badge()).toBeNull();
    now = "r2";
    await act(async () => changed());
    await waitFor(() => expect(badge()).not.toBeNull());
  });

  it("says why through the host when the picture could not be drawn, and keeps the badge", async () => {
    const { host } = await setup({
      diagramRevision: async () => "r2",
      drawDiagram: async () => {
        throw new Error("Install the diagram editor to draw it");
      },
      notify: vi.fn(),
    });
    await waitFor(() => expect(badge()).not.toBeNull());
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Refresh Flow" })));
    expect(host.notify).toHaveBeenCalledWith("Install the diagram editor to draw it");
    expect(badge()).not.toBeNull();
  });

  it("is hidden while a block is dragged", async () => {
    const editor = await setup({ diagramRevision: async () => "r2" });
    await waitFor(() => expect(badge()).not.toBeNull());
    editor.view.rerender(<DiagramBadges session={editor.session} zoom={1} hidden />);
    expect(badge()).toBeNull();
  });
});
