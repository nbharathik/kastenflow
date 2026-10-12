import { act, cleanup, render } from "@testing-library/react";
import { type JSX, useEffect } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { EditorUi } from "./ui-state.ts";
import { useUiState } from "./useUi.ts";

afterEach(cleanup);

function Probe({ ui, reads, counts, effect }: { ui: EditorUi; reads: (state: ReturnType<typeof useUiState>) => unknown; counts: { n: number }; effect?: () => void }): JSX.Element {
  const state = useUiState(ui);
  counts.n += 1;
  const shown = reads(state);
  useEffect(() => {
    effect?.();
  }, [state]);
  return <span>{String(shown)}</span>;
}

describe("the window state a component follows", () => {
  it("draws a component again only for what it read", () => {
    const ui = new EditorUi();
    const counts = { n: 0 };
    const view = render(<Probe ui={ui} reads={(state) => state.zoom} counts={counts} />);
    expect(view.container.textContent).toBe("fit");
    const first = counts.n;
    act(() => ui.toggleSnap());
    act(() => ui.setView("outline"));
    act(() => ui.toggleNotes());
    expect(counts.n).toBe(first);
    act(() => ui.setZoom(2));
    expect(counts.n).toBe(first + 1);
    expect(view.container.textContent).toBe("2");
  });

  it("follows several things it read, and not the ones it did not", () => {
    const ui = new EditorUi();
    const counts = { n: 0 };
    render(<Probe ui={ui} reads={(state) => `${state.zoom} ${state.view}`} counts={counts} />);
    const first = counts.n;
    act(() => ui.setView("grid"));
    expect(counts.n).toBe(first + 1);
    act(() => ui.toggleSnap());
    expect(counts.n).toBe(first + 1);
  });

  it("is drawn again for every change by a component that read nothing, as it always was", () => {
    const ui = new EditorUi();
    const counts = { n: 0 };
    render(<Probe ui={ui} reads={() => "nothing"} counts={counts} />);
    const first = counts.n;
    act(() => ui.toggleSnap());
    act(() => ui.setZoom(3));
    expect(counts.n).toBe(first + 2);
  });

  it("is drawn again when the host's actions are replaced, which a component reads from the window state's own object", () => {
    const ui = new EditorUi();
    const counts = { n: 0 };
    render(<Probe ui={ui} reads={(state) => state.view} counts={counts} />);
    const first = counts.n;
    act(() => void (ui.actions = { close: () => {} }));
    expect(counts.n).toBe(first + 1);
  });

  it("reads later, in a handler, the state as it is then", () => {
    const ui = new EditorUi();
    const counts = { n: 0 };
    let held: ReturnType<typeof useUiState> | undefined;
    render(
      <Probe
        ui={ui}
        reads={(state) => {
          held = state;
          return state.view;
        }}
        counts={counts}
      />,
    );
    act(() => ui.setZoom(4));
    // The component was not drawn again, and what it holds still tells the truth.
    expect(held!.zoom).toBe(4);
    act(() => ui.toggleSnap());
    expect(held!.snap).toBe(false);
  });

  it("gives the same object while nothing it read has changed, so a list of effect inputs does not change", () => {
    const ui = new EditorUi();
    const counts = { n: 0 };
    let effects = 0;
    render(<Probe ui={ui} reads={(state) => state.view} counts={counts} effect={() => (effects += 1)} />);
    const first = effects;
    act(() => ui.toggleSnap());
    act(() => ui.setZoom(2));
    expect(effects).toBe(first);
    act(() => ui.setView("outline"));
    expect(effects).toBe(first + 1);
  });

  it("works when a component spreads the state, reading all of it", () => {
    const ui = new EditorUi();
    const counts = { n: 0 };
    render(<Probe ui={ui} reads={(state) => Object.keys({ ...state }).length} counts={counts} />);
    const first = counts.n;
    act(() => ui.toggleSnap());
    expect(counts.n).toBe(first + 1);
  });
});
