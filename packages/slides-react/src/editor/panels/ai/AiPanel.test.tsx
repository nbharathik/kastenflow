import type { Element } from "@kasten-slides/wasm";
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { shape } from "../../factory.ts";
import type { AiPanelProps } from "../../host.ts";
import { edit, mount } from "../format/test-kit.tsx";
import { Fragment } from "react";

afterEach(cleanup);

const box = (x: number): Element => shape("rect", { x, y: 10, w: 100, h: 50 });

/** What the host's panel was given, each time it was drawn. */
function probe(seen: AiPanelProps[]) {
  return function Probe(props: AiPanelProps) {
    seen.push(props);
    return (
      <Fragment>
        <p data-testid="where">{`Slide ${props.slideNumber} of ${props.slideCount}: ${props.slideTitle} in ${props.deckTitle} (${props.theme}), ${props.elementIds.length} selected, ${props.pending} pending, ${props.deckPath ?? "no path"}`}</p>
        <button type="button" onClick={props.acceptAll}>
          Accept all now
        </button>
      </Fragment>
    );
  };
}

describe("the assistant tab", () => {
  it("says it is available in KastenFlow when the host has no panel of its own", async () => {
    await mount({ panel: "ai" });
    const panel = screen.getByRole("tabpanel");
    expect(within(panel).getByRole("heading", { name: "Assistant" })).toBeTruthy();
    expect(panel.textContent).toContain("Available in KastenFlow");
    expect(panel.querySelector("input, textarea")).toBeNull();
  });

  it("gives the host's panel the deck, the slide and the selection, and again when they change", async () => {
    const kit = await mount({ panel: "ai", elements: [box(10), box(200)], select: [0] });
    const seen: AiPanelProps[] = [];
    kit.host.aiPanel = probe(seen);
    // The panel is drawn again when the host gains one: open another tab and come back.
    edit(() => kit.ui.openPanel("format"));
    edit(() => kit.ui.openPanel("ai"));
    const where = () => screen.getByTestId("where").textContent;
    expect(where()).toBe("Slide 2 of 2: Untitled slide in Panels (Light), 1 selected, 0 pending, no path");
    const first = seen.at(-1)!;
    expect(first.elementIds).toEqual([kit.ids[0]]);
    edit(() => kit.session.select(kit.ids));
    expect(where()).toContain("2 selected");
    edit(() => kit.session.select([]));
    expect(where()).toContain("0 selected");
    edit(() => kit.session.goTo(kit.session.deck.slides[0]!.id));
    expect(where()).toContain("Slide 1 of 2");
  });

  it("counts the elements an assistant made that nobody accepted, and accepting them all is one step of undo", async () => {
    const kit = await mount({ panel: "format", elements: [box(10), box(200)] });
    kit.host.aiPanel = probe([]);
    // A deck as an assistant's tools leave it: the slide names the elements they made.
    const marked = JSON.parse(kit.engine.save());
    marked.slides[1]["x-agent"] = [{ at: 1_000, by: "claude-code", ids: kit.ids, session: "s1" }];
    edit(() => kit.session.load(JSON.stringify(marked)));
    edit(() => kit.ui.openPanel("ai"));
    expect(screen.getByTestId("where").textContent).toContain("2 pending");
    edit(() => void screen.getByRole("button", { name: "Accept all now" }).click());
    expect(screen.getByTestId("where").textContent).toContain("0 pending");
    expect(kit.session.state.undoLabel).toBe("accept_marks");
    edit(() => kit.session.undo());
    expect(screen.getByTestId("where").textContent).toContain("2 pending");
  });
});
