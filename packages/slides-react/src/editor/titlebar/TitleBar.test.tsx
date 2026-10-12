import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { newDeck } from "../../test/engine.ts";
import { MemoryHost } from "../memory-host.ts";
import { button, click, openEditor } from "../menus/testing.ts";
import type { SaveOutcome } from "../host.ts";
import { EditorSession } from "../session/session.ts";
import { EditorUi } from "../ui-state.ts";
import { ICONS } from "../ui/icons.ts";
import { TitleBar } from "./TitleBar.tsx";

afterEach(cleanup);

const titleBox = () => screen.getByRole("textbox", { name: "Deck title" }) as HTMLInputElement;
/** The person clicks into the name: it has the focus, as a real click would give it. */
const enterTitle = () => act(() => titleBox().focus());

/** A host that can be made to fail, to wait, or to find the file changed, and that remembers how it was asked to save. */
class TestHost extends MemoryHost {
  mode: "ok" | "fail" | "wait" | "conflict" = "ok";
  theirs = "";
  readonly asked: { overwrite?: boolean | undefined }[] = [];
  release: () => void = () => {};

  override async save(text: string, options?: { overwrite?: boolean }): Promise<SaveOutcome> {
    this.asked.push({ overwrite: options?.overwrite });
    if (this.mode === "fail") throw new Error("the disk is full");
    if (this.mode === "wait") await new Promise<void>((resolve) => (this.release = resolve));
    if (this.mode === "conflict" && !options?.overwrite) return { status: "conflict", theirs: this.theirs };
    return super.save(text);
  }
}

async function setup() {
  const host = new TestHost();
  const session = new EditorSession(await newDeck("Talk"), host, { saveDelay: 10_000 });
  const ui = new EditorUi();
  render(<TitleBar session={session} ui={ui} />);
  return { host, session, ui };
}

describe("the deck's name", () => {
  it("is an input that shows the name, and renames the deck on Enter", async () => {
    const { session } = await setup();
    expect(titleBox().value).toBe("Talk");
    enterTitle();
    fireEvent.change(titleBox(), { target: { value: "Tool use" } });
    expect(session.deck.title).toBe("Talk");
    fireEvent.keyDown(titleBox(), { key: "Enter" });
    expect(session.deck.title).toBe("Tool use");
    expect(titleBox().value).toBe("Tool use");
    expect(session.state.undoLabel).toBe("set_title");
  });

  it("renames on leaving the input too", async () => {
    const { session } = await setup();
    enterTitle();
    fireEvent.change(titleBox(), { target: { value: "Renamed" } });
    fireEvent.blur(titleBox());
    expect(session.deck.title).toBe("Renamed");
  });

  it("puts the name back on Escape and takes nothing that is only spaces", async () => {
    const { session } = await setup();
    enterTitle();
    fireEvent.change(titleBox(), { target: { value: "Never mind" } });
    fireEvent.keyDown(titleBox(), { key: "Escape" });
    expect(session.deck.title).toBe("Talk");
    expect(titleBox().value).toBe("Talk");

    enterTitle();
    fireEvent.change(titleBox(), { target: { value: "   " } });
    fireEvent.keyDown(titleBox(), { key: "Enter" });
    expect(session.deck.title).toBe("Talk");
    expect(titleBox().value).toBe("Talk");
    expect(session.state.canUndo).toBe(false);
  });

  it("follows a rename made elsewhere, and grows with its text", async () => {
    const { session } = await setup();
    act(() => session.slides.setTitle("A much longer name for the deck"));
    expect(titleBox().value).toBe("A much longer name for the deck");
    // A copy of the text sizes the input.
    expect(titleBox().parentElement?.getAttribute("data-value")).toBe("A much longer name for the deck");
  });

  it("gives the focus back to where it was", async () => {
    await setup();
    const slide = document.body.appendChild(document.createElement("div"));
    slide.tabIndex = 0;
    slide.focus();
    act(() => titleBox().focus());
    expect(document.activeElement).toBe(titleBox());
    fireEvent.keyDown(titleBox(), { key: "Enter" });
    expect(document.activeElement).toBe(slide);
    slide.remove();
  });
});

describe("where saving stands", () => {
  it("says Saved with a tick when there is nothing to save, and Unsaved changes after an edit", async () => {
    const { session } = await setup();
    const status = screen.getByRole("status");
    expect(status.textContent).toBe("Saved");
    expect(status.querySelector("svg")).toBeTruthy();
    act(() => void session.slides.add());
    expect(screen.getByRole("status").textContent).toBe("Unsaved changes");
    expect(screen.getByRole("status").querySelector("svg")).toBeNull();
    await act(async () => session.flush());
    expect(screen.getByRole("status").textContent).toBe("Saved");
  });

  it("says Saving… while the host writes", async () => {
    const { host, session } = await setup();
    host.mode = "wait";
    act(() => void session.slides.add());
    let done: Promise<void> = Promise.resolve();
    act(() => {
      done = session.flush();
    });
    expect(screen.getByRole("status").textContent).toBe("Saving…");
    await act(async () => {
      host.release();
      await done;
    });
    expect(screen.getByRole("status").textContent).toBe("Saved");
  });

  it("says why it could not save and tries again on Retry", async () => {
    const { host, session } = await setup();
    host.mode = "fail";
    act(() => void session.slides.add());
    await act(async () => session.flush());
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Could not save: the disk is full");
    host.mode = "ok";
    await act(async () => click(button("Retry")));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("Saved");
    expect(host.saved).not.toBeNull();
  });

  it("cannot be missed when the file changed on disk, and lets the person take theirs", async () => {
    const { host, session } = await setup();
    host.mode = "conflict";
    host.theirs = (await newDeck("Their talk")).save();
    act(() => void session.slides.add());
    await act(async () => session.flush());

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("This deck changed on disk.");
    expect(document.querySelector(".ks-titlebar")?.classList.contains("is-conflict")).toBe(true);
    expect(button("Keep mine")).toBeTruthy();
    click(button("Use their version"));
    expect(session.deck.title).toBe("Their talk");
    expect(session.deck.slides).toHaveLength(1);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("Saved");
    expect(document.querySelector(".ks-titlebar")?.classList.contains("is-conflict")).toBe(false);
  });

  it("writes the person's own version over the file on Keep mine", async () => {
    const { host, session } = await setup();
    host.mode = "conflict";
    host.theirs = (await newDeck("Their talk")).save();
    act(() => void session.slides.add());
    await act(async () => session.flush());
    expect(host.asked.at(-1)?.overwrite).toBeFalsy();

    await act(async () => click(button("Keep mine")));
    expect(host.asked.at(-1)?.overwrite).toBe(true);
    expect(session.deck.slides).toHaveLength(2);
    expect(host.saved).toContain('"title": "Talk"');
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("Saved");
  });

  it("says where the host kept the person's version, when it did", async () => {
    const { session } = await setup();
    act(() =>
      session.patch({ saving: { status: "conflict", theirs: "{}", copy: "Talk (conflict copy).deck" } }),
    );
    expect(screen.getByRole("alert").textContent).toContain("Talk (conflict copy).deck");
  });
});

describe("Back", () => {
  it("is there only when the host can close the editor", async () => {
    const { ui } = await setup();
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
    const close = vi.fn();
    // The host gives its actions to the editor once it is drawn.
    ui.actions = { close };
    cleanup();
    const session = new EditorSession(await newDeck("Talk"), new MemoryHost(), { saveDelay: 10_000 });
    render(<TitleBar session={session} ui={ui} />);
    click(button("Back"));
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("shows up when the host's actions arrive just after the first drawing", async () => {
    const editor = await openEditor();
    render(<TitleBar session={editor.session} ui={editor.ui} />);
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
    editor.ui.actions = { close: () => {} };
    await act(async () => {});
    expect(screen.getByRole("button", { name: "Back" })).toBeTruthy();
  });
});

describe("Slideshow and the assistant", () => {
  it("presents from the current slide, or any other way from the caret's menu", async () => {
    const { ui } = await setup();
    const present = vi.fn();
    ui.actions = { present };
    await act(async () => {});
    click(button("Slideshow"));
    expect(present).toHaveBeenLastCalledWith("current");
    click(button("Slideshow options"));
    click(screen.getByRole("menuitem", { name: /^Present from beginning/ }));
    expect(present).toHaveBeenLastCalledWith("start");
    click(button("Slideshow options"));
    click(screen.getByRole("menuitem", { name: /^Present from current slide/ }));
    expect(present).toHaveBeenLastCalledWith("current");
    click(button("Slideshow options"));
    click(screen.getByRole("menuitem", { name: /^Presenter view/ }));
    expect(present).toHaveBeenLastCalledWith("current", { presenter: true });
    click(button("Slideshow options"));
    click(screen.getByRole("menuitem", { name: /^Scroll view/ }));
    expect(present).toHaveBeenLastCalledWith("start", { view: "scroll" });
    expect(present).toHaveBeenCalledTimes(5);
  });

  it("is off where the host cannot present", async () => {
    await setup();
    expect((button("Slideshow") as HTMLButtonElement).disabled).toBe(true);
    expect((button("Slideshow options") as HTMLButtonElement).disabled).toBe(true);
  });

  it("toggle the assistant panel", async () => {
    const { ui } = await setup();
    expect(button("Assistant").getAttribute("aria-pressed")).toBe("false");
    click(button("Assistant"));
    expect(ui.state.panel).toBe("ai");
    expect(button("Assistant").getAttribute("aria-pressed")).toBe("true");
    click(button("Assistant"));
    expect(ui.state.panel).toBeNull();
  });
});

describe("Full screen", () => {
  const iconOf = (name: string) => button(name).querySelector("path")?.getAttribute("d");

  it("is a button between the assistant and Slideshow", async () => {
    await setup();
    const names = [...document.querySelectorAll<HTMLElement>(".ks-titlebar button")].map((b) => b.getAttribute("aria-label") ?? b.textContent?.trim());
    const at = names.indexOf("Full screen");
    expect(at).toBeGreaterThan(0);
    expect(names[at - 1]).toBe("Assistant");
    expect(names[at + 1]).toBe("Slideshow");
  });

  it("switches the mode, and shows it: pressed, another icon, and in words how to get out", async () => {
    const { ui } = await setup();
    expect(button("Full screen").getAttribute("aria-pressed")).toBe("false");
    expect(button("Full screen").getAttribute("data-tip")).toBe("Full screen (Ctrl+Shift+F)");
    expect(button("Full screen").textContent).toBe("");
    expect(iconOf("Full screen")).toBe(ICONS.maximize[0][1].d);

    click(button("Full screen"));
    expect(ui.state.fullScreen).toBe(true);
    const off = button("Exit full screen");
    expect(off.getAttribute("aria-pressed")).toBe("true");
    expect(off.getAttribute("data-tip")).toBe("Exit full screen (Ctrl+Shift+F)");
    expect(off.textContent).toBe("Exit full screen");
    expect(iconOf("Exit full screen")).toBe(ICONS.minimize[0][1].d);

    click(off);
    expect(ui.state.fullScreen).toBe(false);
    expect(button("Full screen").getAttribute("aria-pressed")).toBe("false");
  });

  it("follows the mode when it is switched from elsewhere (a key, the menu, Esc)", async () => {
    const { ui } = await setup();
    act(() => ui.setFullScreen(true));
    expect(button("Exit full screen").getAttribute("aria-pressed")).toBe("true");
    act(() => ui.setFullScreen(false));
    expect(button("Full screen").getAttribute("aria-pressed")).toBe("false");
  });

  it("is left before Back closes the deck", async () => {
    const { ui } = await setup();
    const inside: boolean[] = [];
    ui.actions = { close: () => void inside.push(ui.state.fullScreen) };
    await act(async () => {});
    act(() => ui.setFullScreen(true));
    click(button("Back"));
    expect(inside).toEqual([false]);
  });
});
