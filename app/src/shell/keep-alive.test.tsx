// Tabs kept ready: the most recent few stay mounted (hidden) with their state,
// the rest remount; browser tabs are never kept.

import { act, cleanup, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { clampKeep, KEEP_DEFAULT, keptIds, touch } from "./keep-alive";
import { KeepAlive } from "./KeepAlive";

afterEach(cleanup);

const visit = (ids: string[]): readonly string[] => ids.reduce<readonly string[]>((order, id) => touch(order, id), []);
const all = () => true;

describe("kept tab order", () => {
  it("keeps the active tab and the N most recent others (least recently used go first)", () => {
    const order = visit(["a", "b", "c", "d", "e", "f", "g"]);
    expect([...keptIds(order, "g", 4, all)]).toEqual(["g", "f", "e", "d", "c"]);
    // Going back to "c" makes "b" the next to be dropped.
    const back = touch(order, "c");
    expect([...keptIds(back, "c", 4, all)].sort()).toEqual(["c", "d", "e", "f", "g"]);
  });

  it("keeps nothing but the active tab when off, and up to eight at most", () => {
    const order = visit(["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k"]);
    expect([...keptIds(order, "k", 0, all)]).toEqual(["k"]);
    expect(keptIds(order, "k", 8, all).size).toBe(9);
    expect(keptIds(order, "k", 20, all).size).toBe(9);
  });

  it("skips tabs that cannot be kept or no longer exist", () => {
    const order = visit(["a", "web", "c", "gone", "e"]);
    const kept = keptIds(order, "e", 4, (id) => id !== "web" && id !== "gone");
    expect([...kept].sort()).toEqual(["a", "c", "e"]);
  });

  it("clamps the setting to 0 to 8 and falls back to four", () => {
    expect(clampKeep(-3)).toBe(0);
    expect(clampKeep(0)).toBe(0);
    expect(clampKeep(5.4)).toBe(5);
    expect(clampKeep(99)).toBe(8);
    expect(clampKeep("3")).toBe(KEEP_DEFAULT);
    expect(clampKeep(undefined)).toBe(KEEP_DEFAULT);
    expect(clampKeep(Number.NaN)).toBe(KEEP_DEFAULT);
  });
});

let mounts = 0;
function Counter({ id }: { id: string }) {
  const [n, setN] = useState(0);
  return (
    <button type="button" data-testid={id} onClick={() => setN(n + 1)}>
      {id}:{n}
    </button>
  );
}
function Mounted({ id }: { id: string }) {
  useState(() => mounts++);
  return <Counter id={id} />;
}

const tabs = (ids: string[]) => ids.map((id) => ({ id, view: id.startsWith("web") ? "web" : "page" }));

function Harness({ ids, active, keep }: { ids: string[]; active: string; keep: number }) {
  return <KeepAlive items={tabs(ids)} active={active} keep={keep} canKeep={(t) => t.view !== "web"} render={(t) => <Mounted id={t.id} />} />;
}

const text = (id: string) => screen.queryByTestId(id)?.textContent;
const hidden = (id: string) => (screen.queryByTestId(id) as HTMLElement | null)?.style.display === "none";

describe("KeepAlive", () => {
  it("keeps a hidden tab's component state and does not remount it", () => {
    mounts = 0;
    const ids = ["a", "b"];
    const { rerender } = render(<Harness ids={ids} active="a" keep={4} />);
    act(() => screen.getByTestId("a").click());
    act(() => screen.getByTestId("a").click());
    expect(text("a")).toBe("a:2");
    rerender(<Harness ids={ids} active="b" keep={4} />);
    expect(hidden("a")).toBe(true);
    expect(hidden("b")).toBe(false);
    rerender(<Harness ids={ids} active="a" keep={4} />);
    expect(text("a")).toBe("a:2");
    expect(hidden("a")).toBe(false);
    expect(mounts).toBe(2);
  });

  it("remounts a tab that fell beyond N", () => {
    mounts = 0;
    const ids = ["a", "b", "c", "d"];
    const { rerender } = render(<Harness ids={ids} active="a" keep={2} />);
    act(() => screen.getByTestId("a").click());
    for (const id of ["b", "c", "d"]) rerender(<Harness ids={ids} active={id} keep={2} />);
    // a is the least recently used of four: gone; b and c are still ready.
    expect(screen.queryByTestId("a")).toBeNull();
    expect(screen.queryByTestId("b")).not.toBeNull();
    expect(screen.queryByTestId("c")).not.toBeNull();
    rerender(<Harness ids={ids} active="a" keep={2} />);
    expect(text("a")).toBe("a:0");
    expect(mounts).toBe(5);
  });

  it("mounts only the shown tab when off", () => {
    const ids = ["a", "b"];
    const { rerender } = render(<Harness ids={ids} active="a" keep={0} />);
    rerender(<Harness ids={ids} active="b" keep={0} />);
    expect(screen.queryByTestId("a")).toBeNull();
    expect(screen.queryByTestId("b")).not.toBeNull();
  });

  it("never keeps a browser tab", () => {
    const ids = ["a", "web1"];
    const { rerender } = render(<Harness ids={ids} active="web1" keep={4} />);
    rerender(<Harness ids={ids} active="a" keep={4} />);
    expect(screen.queryByTestId("web1")).toBeNull();
    expect(screen.queryByTestId("a")).not.toBeNull();
  });

  it("drops a closed tab", () => {
    const { rerender } = render(<Harness ids={["a", "b"]} active="a" keep={4} />);
    rerender(<Harness ids={["a", "b"]} active="b" keep={4} />);
    rerender(<Harness ids={["b"]} active="b" keep={4} />);
    expect(screen.queryByTestId("a")).toBeNull();
  });
});
