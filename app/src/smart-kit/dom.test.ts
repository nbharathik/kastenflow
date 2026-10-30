import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeHost, flush, loadKit, mountPoint, type Kit } from "./test-support/env";

let kit: Kit;
let app: HTMLElement;
beforeEach(() => {
  kit = loadKit(["kit.js", "lib/dom.js", "lib/keys.js"]);
  app = mountPoint();
});

/** Records every change made to the container's subtree. */
function watchChanges(el: HTMLElement) {
  const mo = new MutationObserver(() => {});
  mo.observe(el, { subtree: true, childList: true, attributes: true, characterData: true });
  return { take: () => mo.takeRecords() };
}

describe("h", () => {
  it("reads tag shorthand and flattens children", () => {
    const v = kit.h("ul.a.b#list", { role: "list" }, [kit.h("li", {}, "x"), null, false, [kit.h("li", {}, 3)]]);
    expect(v.tag).toBe("ul");
    expect(v.props).toEqual({ role: "list", id: "list", class: "a b" });
    expect(v.children).toHaveLength(2);
    expect(v.children[1].children).toEqual(["3"]);
  });
});

describe("render", () => {
  it("builds elements, attributes, styles and svg in the right namespace", () => {
    kit.render(app, [kit.h("p.note", { "aria-label": "n", style: { "--x": "1", fontSize: "12px" } }, "hi"), kit.h("svg", { viewBox: "0 0 1 1" }, kit.h("circle", { r: 1 }))]);
    const p = app.querySelector("p")!;
    expect(p.className).toBe("note");
    expect(p.getAttribute("aria-label")).toBe("n");
    expect(p.getAttribute("style")).toBe("--x:1;font-size:12px");
    expect(app.querySelector("circle")!.namespaceURI).toBe("http://www.w3.org/2000/svg");
    expect(app.querySelector("svg")!.getAttribute("viewBox")).toBe("0 0 1 1");
  });

  it("updates only the nodes that changed", () => {
    const list = (items: string[]) => kit.h("ul", {}, items.map((t) => kit.h("li", { class: "i" }, t)));
    kit.render(app, list(["a", "b", "c"]));
    const [li0, li1, li2] = Array.from(app.querySelectorAll("li"));
    const spy = watchChanges(app);
    kit.render(app, list(["a", "B", "c"]));
    const changes = spy.take();
    expect(changes).toHaveLength(1);
    expect(changes[0]!.type).toBe("characterData");
    expect(Array.from(app.querySelectorAll("li"))).toEqual([li0, li1, li2]);
    expect(li1!.textContent).toBe("B");
    kit.render(app, list(["a", "B", "c"]));
    expect(spy.take()).toHaveLength(0);
  });

  it("adds, removes and replaces nodes, and drops props that went away", () => {
    kit.render(app, kit.h("div", { title: "t", "data-x": "1" }, kit.h("b", {}, "1"), kit.h("i", {}, "2")));
    const div = app.firstElementChild!;
    kit.render(app, kit.h("div", { title: "t" }, kit.h("b", {}, "1")));
    expect(app.firstElementChild).toBe(div);
    expect(div.hasAttribute("data-x")).toBe(false);
    expect(div.children).toHaveLength(1);
    kit.render(app, kit.h("section", {}, "x"));
    expect(app.firstElementChild!.localName).toBe("section");
  });

  it("keeps focus on a control that is redrawn in place", () => {
    kit.render(app, kit.h("button", { type: "button" }, "one"));
    const b = app.querySelector("button")!;
    b.focus();
    kit.render(app, kit.h("button", { type: "button" }, "two"));
    expect(document.activeElement).toBe(b);
    expect(b.textContent).toBe("two");
  });

  it("wires one listener per event and always calls the latest handler", () => {
    const first = vi.fn();
    const second = vi.fn();
    kit.render(app, kit.h("button", { onClick: first }, "go"));
    kit.render(app, kit.h("button", { onClick: second }, "go"));
    app.querySelector("button")!.click();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("never turns text into markup", () => {
    kit.render(app, kit.h("p", {}, "<img src=x onerror=alert(1)>"));
    expect(app.querySelector("img")).toBeNull();
    expect(app.textContent).toBe("<img src=x onerror=alert(1)>");
  });

  it("a keyed node is replaced when its key changes", () => {
    kit.render(app, kit.h("ul", {}, kit.h("li", { key: "a" }, "a")));
    const a = app.querySelector("li");
    kit.render(app, kit.h("ul", {}, kit.h("li", { key: "b" }, "b")));
    expect(app.querySelector("li")).not.toBe(a);
  });
});

describe("mount", () => {
  it("redraws once for several sets in a row", async () => {
    const view = vi.fn((s: { n: number }) => kit.h("p", {}, "n=" + s.n));
    const m = kit.mount(app, view, { n: 0 });
    expect(app.textContent).toBe("n=0");
    m.set({ n: 1 });
    m.set((s: { n: number }) => ({ n: s.n + 1 }));
    expect(app.textContent).toBe("n=0");
    await flush();
    expect(app.textContent).toBe("n=2");
    expect(view).toHaveBeenCalledTimes(2);
    m.destroy();
    m.set({ n: 9 });
    await flush();
    expect(app.textContent).toBe("");
  });
});

describe("defineComponent", () => {
  function define() {
    return kit.defineComponent("demo", { view: (data: string[]) => (data.length ? kit.h("ul", { role: "list" }, data.map((d) => kit.h("li", {}, d))) : kit.emptyView("Nothing here.")) });
  }

  it("registers in kit.components and renders plain data, then updates", () => {
    define();
    const c = kit.components.demo(app, { data: ["a"] });
    expect(app.classList.contains("kit-demo")).toBe(true);
    expect(app.querySelectorAll("li")).toHaveLength(1);
    c.update(["a", "b"]);
    expect(app.querySelectorAll("li")).toHaveLength(2);
    c.update([]);
    expect(app.querySelector('[role="status"]')!.textContent).toBe("Nothing here.");
    c.destroy();
    expect(app.textContent).toBe("");
    expect(app.classList.contains("kit-demo")).toBe(false);
  });

  it("takes a selector and refuses a missing target", () => {
    define();
    expect(kit.components.demo("#app", { data: [] }).el).toBe(app);
    expect(() => kit.components.demo("#nope", { data: [] })).toThrow(/no element/);
  });

  it("follows a watch query: loading, then data, then each change; stops on destroy", async () => {
    define();
    const host = fakeHost({ watch: ["x"] });
    const bridge = kit.createBridge({ transport: host.transport });
    const c = kit.components.demo(app, { watch: { tag: "t" }, kasten: bridge, map: (v: string[]) => v.map((s) => s.toUpperCase()) });
    expect(app.getAttribute("aria-busy")).toBe("true");
    expect(app.querySelector('[role="status"]')!.textContent).toContain("Loading");
    await flush();
    expect(app.getAttribute("aria-busy")).toBe("false");
    expect(app.querySelector("li")!.textContent).toBe("X");
    host.emit({ event: "watch", watchId: host.ofKind("watch")[0].args.watchId, value: ["y", "z"] });
    expect(Array.from(app.querySelectorAll("li")).map((l) => l.textContent)).toEqual(["Y", "Z"]);
    c.destroy();
    expect(host.ofKind("unwatch")).toHaveLength(1);
  });

  it("shows one plain sentence and a Try again button when the query fails, and recovers", async () => {
    define();
    let fail = true;
    const host = fakeHost({
      watch: () => {
        if (fail) throw { code: "rate_limited", message: "Too many requests." };
        return ["ok"];
      },
    });
    const bridge = kit.createBridge({ transport: host.transport });
    kit.components.demo(app, { watch: { tag: "t" }, kasten: bridge });
    await flush();
    const alert = app.querySelector('[role="alert"]')!;
    expect(alert.textContent).toContain("Too many requests.");
    fail = false;
    alert.querySelector("button")!.click();
    await flush();
    expect(app.querySelector("li")!.textContent).toBe("ok");
    expect(app.querySelector('[role="alert"]')).toBeNull();
  });

  it("says so when there is no bridge", () => {
    define();
    kit.components.demo(app, { watch: { tag: "t" } });
    expect(app.querySelector('[role="alert"]')!.textContent).toContain("not connected");
  });

  it("redraws on a clock tick and stops after destroy", () => {
    vi.useFakeTimers();
    try {
      const view = vi.fn(() => kit.h("p", {}, "x"));
      kit.defineComponent("clocked", { view, tick: 1000 });
      const c = kit.components.clocked(app, { data: [] });
      expect(view).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(3000);
      expect(view).toHaveBeenCalledTimes(4);
      c.destroy();
      vi.advanceTimersByTime(3000);
      expect(view).toHaveBeenCalledTimes(4);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("keys", () => {
  function group() {
    app.innerHTML = '<div id="g"><button data-roving>a</button><button data-roving>b</button><button data-roving disabled>x</button><button data-roving>c</button></div>';
    const g = document.getElementById("g")!;
    const r = kit.keys.roving(g, { orientation: "horizontal" });
    return { g, r, btns: Array.from(g.querySelectorAll("button")) as HTMLButtonElement[] };
  }
  const press = (el: Element, key: string) => el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));

  it("makes one tab stop and moves with arrows, Home and End, wrapping and skipping disabled", () => {
    const { btns } = group();
    expect(btns.map((b) => b.getAttribute("tabindex"))).toEqual(["0", "-1", null, "-1"]);
    btns[0]!.focus();
    press(btns[0]!, "ArrowRight");
    expect(document.activeElement).toBe(btns[1]);
    press(btns[1]!, "ArrowRight");
    expect(document.activeElement).toBe(btns[3]);
    press(btns[3]!, "ArrowRight");
    expect(document.activeElement).toBe(btns[0]);
    press(btns[0]!, "End");
    expect(document.activeElement).toBe(btns[3]);
    press(btns[3]!, "Home");
    expect(document.activeElement).toBe(btns[0]);
    expect(btns[0]!.getAttribute("tabindex")).toBe("0");
    expect(btns[3]!.getAttribute("tabindex")).toBe("-1");
  });

  it("ignores keys of the other direction", () => {
    const { btns } = group();
    btns[0]!.focus();
    const e = new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true });
    btns[0]!.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
  });

  it("keeps its place across a redraw and stops on destroy", () => {
    const { g, r, btns } = group();
    btns[0]!.focus();
    press(btns[0]!, "ArrowRight");
    r.refresh();
    expect(btns[1]!.getAttribute("tabindex")).toBe("0");
    r.destroy();
    press(btns[1]!, "ArrowRight");
    expect(document.activeElement).toBe(btns[1]);
    expect(g).toBeTruthy();
  });

  it("traps Tab inside a dialog and gives focus back", () => {
    app.innerHTML = '<button id="before">o</button><div id="d"><button id="one">1</button><button id="two">2</button></div>';
    const before = document.getElementById("before")!;
    before.focus();
    const release = kit.keys.trapFocus(document.getElementById("d"));
    const one = document.getElementById("one")!;
    const two = document.getElementById("two")!;
    expect(document.activeElement).toBe(one);
    two.focus();
    two.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(one);
    one.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(two);
    release();
    expect(document.activeElement).toBe(before);
  });

  it("announces to a polite live region", () => {
    kit.keys.announce("Saved");
    kit.keys.announce("Saved again");
    const live = document.getElementById("kit-live")!;
    expect(live.getAttribute("aria-live")).toBe("polite");
    expect(live.textContent).toBe("Saved again");
    expect(document.querySelectorAll("#kit-live")).toHaveLength(1);
  });

  it("onKeys runs handlers by key and can be removed", () => {
    const esc = vi.fn();
    const off = kit.keys.onKeys(app, { Escape: esc });
    press(app, "Escape");
    off();
    press(app, "Escape");
    expect(esc).toHaveBeenCalledTimes(1);
  });

  it("reducedMotion follows the media query", () => {
    const spy = vi.spyOn(window, "matchMedia").mockReturnValue({ matches: true } as MediaQueryList);
    expect(kit.reducedMotion()).toBe(true);
    spy.mockReturnValue({ matches: false } as MediaQueryList);
    expect(kit.reducedMotion()).toBe(false);
    spy.mockRestore();
  });
});
