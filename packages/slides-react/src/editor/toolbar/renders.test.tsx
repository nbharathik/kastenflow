// What draws the toolbar again. It follows only what its buttons show, so a save, a revision counted or a drag that
// has not let go does not draw it, and a change of selection draws only the buttons that show the selection.

import { Profiler } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { shape } from "../factory.ts";
import { openEditor } from "../menus/testing.ts";
import { Toolbar } from "./Toolbar.tsx";

afterEach(cleanup);

async function setup() {
  const editor = await openEditor();
  const draws = { count: 0 };
  render(
    <Profiler id="toolbar" onRender={() => void (draws.count += 1)}>
      <Toolbar session={editor.session} ui={editor.ui} />
    </Profiler>,
  );
  return { ...editor, draws };
}

describe("the toolbar", () => {
  it("is not drawn again when the deck is saved, or for a change of state it shows nothing of", async () => {
    const { session, draws } = await setup();
    const before = draws.count;
    act(() => session.patch({ saving: { status: "saving" } }));
    act(() => session.patch({ saving: { status: "saved" } }));
    act(() => session.patch({ revision: session.state.revision + 1 }));
    expect(draws.count).toBe(before);
  });

  it("is not drawn again when the same selection is made again", async () => {
    const { session, draws } = await setup();
    act(() => void session.elements.insert([shape("rect", { x: 10, y: 10, w: 50, h: 50 })]));
    const before = draws.count;
    act(() => session.select(session.state.selection));
    act(() => session.patch({ saving: { status: "unsaved" } }));
    expect(draws.count).toBe(before);
  });

  it("is drawn again when what is selected changes, which the text and shape tools show", async () => {
    const { session, draws } = await setup();
    let a = "";
    act(() => {
      a = (session.elements.insert([shape("rect", { x: 10, y: 10, w: 50, h: 50 })]) as [string])[0];
      session.select([]);
    });
    const before = draws.count;
    act(() => session.select([a]));
    expect(draws.count).toBeGreaterThan(before);
  });
});
