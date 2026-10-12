import type { Element } from "@kasten-slides/wasm";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { openEditor } from "../menus/testing.ts";
import { Toolbar } from "./Toolbar.tsx";

afterEach(cleanup);

const picture = (extra: object = {}) => ({ type: "image", id: "", src: "assets/x.png", x: 0, y: 0, w: 100, h: 100, ...extra }) as Element;
const edit = () => screen.queryByRole("button", { name: "Edit diagram" });

async function setup(hostHas: boolean) {
  const editor = await openEditor();
  const editDiagram = vi.fn(async () => null);
  if (hostHas) Object.assign(editor.host, { editDiagram });
  render(<Toolbar session={editor.session} ui={editor.ui} />);
  const put = (element: Element) => {
    let id = "";
    act(() => {
      id = editor.session.elements.insert([element])[0]!;
    });
    return id;
  };
  act(() => editor.session.select([]));
  return { ...editor, put, editDiagram };
}

describe("Edit diagram in the toolbar", () => {
  it("is there for a picture that came from a diagram, and for nothing else", async () => {
    const { session, put } = await setup(true);
    expect(edit()).toBeNull();
    const plain = put(picture());
    act(() => session.select([plain]));
    expect(edit()).toBeNull();
    const drawn = put(picture({ "x-diagram": "library/Flow.drawio" }));
    act(() => session.select([drawn]));
    expect(edit()).toBeTruthy();
    act(() => session.select([drawn, plain]));
    expect(edit()).toBeNull();
  });

  it("asks the host to edit the diagram the picture names", async () => {
    const { session, put, editDiagram } = await setup(true);
    const drawn = put(picture({ "x-diagram": "library/Flow.drawio" }));
    act(() => session.select([drawn]));
    await act(async () => fireEvent.click(edit()!));
    expect(editDiagram).toHaveBeenCalledWith("library/Flow.drawio");
  });

  it("is not there where the host has no diagrams, such as the standalone page", async () => {
    const { session, put } = await setup(false);
    const drawn = put(picture({ "x-diagram": "library/Flow.drawio" }));
    act(() => session.select([drawn]));
    expect(edit()).toBeNull();
  });
});
