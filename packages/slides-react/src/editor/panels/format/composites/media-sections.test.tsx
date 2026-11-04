import type { Element } from "@kasten-slides/wasm";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { edit, enter, held, mount, pickColor, section } from "../test-kit.tsx";

// The chooser of files, and the reading of a picture's size, need a browser.
vi.mock("../../../files.ts", async (original) => ({
  ...(await original<typeof import("../../../files.ts")>()),
  pickFiles: vi.fn(async (accept: string) => (accept.startsWith("video") ? [new File(["v"], "my talk.mp4")] : [new File(["p"], "still.png", { type: "image/png" })])),
  readImage: vi.fn(async (file: File) => ({ name: file.name, bytes: new Uint8Array([1, 2]), size: null })),
}));

afterEach(cleanup);

type Kit = Awaited<ReturnType<typeof mount>>;
type Of<K extends Element["type"]> = Extract<Element, { type: K }>;
const at = { x: 64, y: 148, w: 600, h: 260 };
const math = (extra: Partial<Of<"math">> = {}): Element => ({ type: "math", id: "", latex: "E = mc^2", ...at, ...extra }) as Element;
const label = (extra: Partial<Of<"step-label">> = {}): Element => ({ type: "step-label", id: "", ...at, ...extra }) as Element;
const embed = (extra: Partial<Of<"embed">> = {}): Element => ({ type: "embed", id: "", url: "https://example.com", ...at, ...extra }) as Element;
const video = (extra: Partial<Of<"video">> = {}): Element => ({ type: "video", id: "", src: "clip.mp4", ...at, ...extra }) as Element;
const the = <K extends Element["type"]>(kit: Kit, index = 0) => held(kit, kit.ids[index] as string) as Of<K>;

describe("Formula", () => {
  const latex = () => within(section("formula")).getByLabelText("LaTeX") as HTMLTextAreaElement;
  const size = () => within(section("formula")).getByLabelText("Formula size") as HTMLInputElement;

  it("shows the LaTeX in a box that is the field a double click puts the caret in", async () => {
    await mount({ elements: [math()] });
    expect(latex().value).toBe("E = mc^2");
    expect(latex().hasAttribute("data-primary")).toBe(true);
  });

  it("commits the LaTeX when the box is left, and Tab moves on instead of typing a tab", async () => {
    const kit = await mount({ elements: [math()] });
    fireEvent.change(latex(), { target: { value: "\\frac{a}{b}" } });
    fireEvent.blur(latex());
    expect(the<"math">(kit).latex).toBe("\\frac{a}{b}");
    latex().focus();
    const tab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    latex().dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(false);
    edit(() => kit.session.undo());
    expect(latex().value).toBe("E = mc^2");
  });

  it("says what is wrong with LaTeX that cannot be drawn", async () => {
    await mount({ elements: [math({ latex: "\\frac{1}{" })] });
    expect(within(section("formula")).getByRole("status").textContent).toMatch(/This cannot be drawn: /);
    expect(latex().getAttribute("aria-invalid")).toBe("true");
    cleanup();
    await mount({ elements: [math()] });
    expect(within(section("formula")).queryByRole("status")).toBeNull();
    expect(latex().getAttribute("aria-invalid")).toBeNull();
  });

  it("sets inline, and takes it off", async () => {
    const kit = await mount({ elements: [math()] });
    fireEvent.click(within(section("formula")).getByLabelText(/^Inline/));
    expect(the<"math">(kit).inline).toBe(true);
    fireEvent.click(within(section("formula")).getByLabelText(/^Inline/));
    expect(the<"math">(kit).inline).toBeUndefined();
  });

  it("picks a colour from the theme, or the text colour again", async () => {
    const kit = await mount({ elements: [math()] });
    expect(within(section("formula")).getByRole("button", { name: "Formula colour" }).textContent).toContain("Text colour");
    pickColor("Formula colour", "accent2", section("formula"));
    expect(the<"math">(kit).color).toBe("accent2");
    fireEvent.click(within(section("formula")).getByRole("button", { name: "Formula colour" }));
    fireEvent.click(screen.getByRole("button", { name: "Text colour" }));
    expect(the<"math">(kit).color).toBeUndefined();
  });

  it("sets the size in points, 32 when it names none, and goes back to that", async () => {
    const kit = await mount({ elements: [math()] });
    expect(size().value).toBe("32");
    expect(within(section("formula")).getByRole("button", { name: "Reset formula size" }).hasAttribute("disabled")).toBe(true);
    enter(size(), "48");
    expect(the<"math">(kit).fontSize).toBe(48);
    fireEvent.click(within(section("formula")).getByRole("button", { name: "Reset formula size" }));
    expect(the<"math">(kit).fontSize).toBeUndefined();
    enter(size(), "24");
    enter(size(), "32");
    expect(the<"math">(kit).fontSize).toBeUndefined();
  });

  it("shows Mixed for formulas that differ and sets them all", async () => {
    const kit = await mount({ elements: [math(), math({ latex: "x", inline: true, y: 20 })] });
    expect(latex().placeholder).toBe("Mixed");
    expect(within(section("formula")).getByLabelText(/^Inline/).getAttribute("aria-checked")).toBe("mixed");
    fireEvent.click(within(section("formula")).getByLabelText(/^Inline/));
    expect(kit.ids.map((id) => (held(kit, id) as Of<"math">).inline)).toEqual([true, true]);
  });
});

describe("Step label", () => {
  const wording = () => within(section("step-label")).getByLabelText("Step label wording") as HTMLInputElement;

  it("shows the wording it has, or none, and sets it", async () => {
    const kit = await mount({ elements: [label()] });
    expect(wording().value).toBe("");
    expect(wording().placeholder).toBe("Step {n} / {total}");
    enter(wording(), "{n} of {total}");
    expect(the<"step-label">(kit).format).toBe("{n} of {total}");
    enter(wording(), "   ");
    expect(the<"step-label">(kit).format).toBeUndefined();
  });

  it("says that presenting uses the deck's own wording", async () => {
    await mount({ elements: [label()] });
    expect(within(section("step-label")).getByText(/presenting uses the deck's own wording/)).toBeTruthy();
  });
});

describe("Embedded page", () => {
  const address = () => within(section("embed")).getByLabelText("Web address") as HTMLInputElement;

  it("shows the address, and completes what is typed", async () => {
    const kit = await mount({ elements: [embed()] });
    expect(address().value).toBe("https://example.com");
    enter(address(), "example.org/docs");
    expect(the<"embed">(kit).url).toBe("https://example.org/docs");
    expect(address().value).toBe("https://example.org/docs");
  });

  it("refuses what is not a web page, marks the box, and keeps the address it had", async () => {
    const kit = await mount({ elements: [embed()] });
    enter(address(), "javascript:alert(1)");
    expect(the<"embed">(kit).url).toBe("https://example.com");
    expect(address().getAttribute("aria-invalid")).toBe("true");
    expect(within(section("embed")).getByRole("alert").textContent).toMatch(/web address/);
    enter(address(), "https://example.net");
    expect(within(section("embed")).queryByRole("alert")).toBeNull();
    expect(the<"embed">(kit).url).toBe("https://example.net");
  });

  it("notes the site of an address, and drops the note for an address of no known site", async () => {
    const kit = await mount({ elements: [embed()] });
    expect(the<"embed">(kit).provider).toBeUndefined();
    enter(address(), "https://youtu.be/dQw4w9WgXcQ");
    expect(the<"embed">(kit)).toMatchObject({ url: "https://youtu.be/dQw4w9WgXcQ", provider: "youtube" });
    enter(address(), "https://example.net/page");
    expect(the<"embed">(kit).provider).toBeUndefined();
  });

  it("has no playback options for an ordinary page", async () => {
    await mount({ elements: [embed()] });
    expect(within(section("embed")).queryByLabelText("Start at (seconds)")).toBeNull();
  });

  it("sets where a video starts and stops, and how it plays, and clears them again", async () => {
    const kit = await mount({ elements: [embed({ url: "https://youtu.be/dQw4w9WgXcQ" })] });
    const panel = within(section("embed"));
    enter(panel.getByLabelText("Start at (seconds)"), "90");
    enter(panel.getByLabelText("Stop at (seconds)"), "120");
    fireEvent.click(panel.getByLabelText("Play by itself"));
    fireEvent.click(panel.getByLabelText("Without sound"));
    fireEvent.click(panel.getByLabelText("Play again and again"));
    fireEvent.click(panel.getByLabelText("Show the player's controls"));
    expect(the<"embed">(kit)).toMatchObject({ start: 90, end: 120, autoplay: true, muted: true, looped: true, controls: false });
    enter(panel.getByLabelText("Start at (seconds)"), "0");
    fireEvent.click(panel.getByLabelText("Show the player's controls"));
    expect(the<"embed">(kit).start).toBeUndefined();
    expect(the<"embed">(kit).controls).toBeUndefined();
  });

  it("sets a title, and an empty one takes it away", async () => {
    const kit = await mount({ elements: [embed()] });
    enter(within(section("embed")).getByLabelText("Page title"), "The docs");
    expect(the<"embed">(kit).title).toBe("The docs");
    enter(within(section("embed")).getByLabelText("Page title"), "");
    expect(the<"embed">(kit).title).toBeUndefined();
  });
});

describe("The poster of a page or a video", () => {
  it("says there is none, and cannot take away what is not there", async () => {
    await mount({ elements: [embed()] });
    expect(within(section("embed")).getByText("None")).toBeTruthy();
    expect(within(section("embed")).getByRole("button", { name: "Remove" }).hasAttribute("disabled")).toBe(true);
  });

  it("names the picture it has, and takes it away", async () => {
    const kit = await mount({ elements: [embed({ poster: "assets/site.png" })] });
    expect(within(section("embed")).getByText("site.png")).toBeTruthy();
    fireEvent.click(within(section("embed")).getByRole("button", { name: "Remove" }));
    expect(the<"embed">(kit).poster).toBeUndefined();
    edit(() => kit.session.undo());
    expect(the<"embed">(kit).poster).toBe("assets/site.png");
  });

  it("offers the pictures the host holds, and puts the one picked", async () => {
    const kit = await mount({ elements: [video()] });
    kit.host.images = async () => [
      { path: "assets/one.png", name: "one.png" },
      { path: "assets/two.png", name: "two.png" },
    ];
    fireEvent.click(within(section("video")).getByRole("button", { name: "Choose…" }));
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(2));
    fireEvent.click(screen.getByRole("listitem", { name: "two.png" }));
    expect(the<"video">(kit).poster).toBe("assets/two.png");
    expect(screen.queryByRole("dialog", { name: "Pictures" })).toBeNull();
    expect(within(section("video")).getByText("two.png")).toBeTruthy();
  });

  it("says when the host has no pictures yet", async () => {
    await mount({ elements: [video()] });
    fireEvent.click(within(section("video")).getByRole("button", { name: "Choose…" }));
    await waitFor(() => expect(screen.getByText("No pictures have been added yet.")).toBeTruthy());
  });

  it("adds a picture from the computer to the host and uses it", async () => {
    const kit = await mount({ elements: [embed()] });
    // Object URLs need a browser: the host only has to keep the bytes.
    const kept = vi.fn(async (name: string) => `assets/${name}`);
    kit.host.addImage = kept;
    fireEvent.click(within(section("embed")).getByRole("button", { name: "Choose…" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "From the computer…" }));
    });
    await waitFor(() => expect(the<"embed">(kit).poster).toBe("assets/still.png"));
    expect(kept).toHaveBeenCalledWith("still.png", new Uint8Array([1, 2]));
  });

  it("shows Mixed for pages with different posters, and sets or takes them all", async () => {
    const kit = await mount({ elements: [embed({ poster: "assets/a.png" }), embed({ poster: "assets/b.png", y: 20 })] });
    expect(within(section("embed")).getByText("Mixed")).toBeTruthy();
    fireEvent.click(within(section("embed")).getByRole("button", { name: "Remove" }));
    expect(kit.ids.map((id) => (held(kit, id) as Of<"embed">).poster)).toEqual([undefined, undefined]);
  });
});

describe("Video", () => {
  const source = () => within(section("video")).getByLabelText("Video source") as HTMLInputElement;

  it("shows where the video comes from, and sets it from an address or a file name", async () => {
    const kit = await mount({ elements: [video()] });
    expect(source().value).toBe("clip.mp4");
    enter(source(), "https://example.com/talk.mp4");
    expect(the<"video">(kit).src).toBe("https://example.com/talk.mp4");
    enter(source(), "assets/other.mp4");
    expect(the<"video">(kit).src).toBe("assets/other.mp4");
  });

  it("refuses an empty source or a script", async () => {
    const kit = await mount({ elements: [video()] });
    enter(source(), "javascript:alert(1)");
    expect(the<"video">(kit).src).toBe("clip.mp4");
    expect(within(section("video")).getByRole("alert")).toBeTruthy();
    enter(source(), "");
    expect(the<"video">(kit).src).toBe("clip.mp4");
  });

  it("keeps the file that is chosen with the deck, and takes the path it has there", async () => {
    const kit = await mount({ elements: [video()] });
    await act(async () => {
      fireEvent.click(within(section("video")).getByRole("button", { name: "Choose file…" }));
    });
    await waitFor(() => expect(the<"video">(kit).src).toBe("assets/my-talk.mp4"));
  });

  it("plays by itself and again and again when asked to", async () => {
    const kit = await mount({ elements: [video()] });
    fireEvent.click(within(section("video")).getByLabelText("Play by itself"));
    fireEvent.click(within(section("video")).getByLabelText("Play again and again"));
    expect(the<"video">(kit)).toMatchObject({ autoplay: true, looped: true });
    fireEvent.click(within(section("video")).getByLabelText("Play by itself"));
    expect(the<"video">(kit).autoplay).toBeUndefined();
    edit(() => kit.session.undo());
    expect(the<"video">(kit).autoplay).toBe(true);
  });
});
