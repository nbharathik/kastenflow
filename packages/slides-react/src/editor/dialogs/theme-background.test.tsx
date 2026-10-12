import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as files from "../files.ts";
import { COMMON_FAMILIES } from "./ThemeFonts.tsx";
import { edit, mountDialogs } from "./test-kit.tsx";

vi.mock("../files.ts", () => ({ pickFiles: vi.fn(), readImage: vi.fn() }));
const pickFiles = vi.mocked(files.pickFiles);
const readImage = vi.mocked(files.readImage);

beforeEach(() => {
  pickFiles.mockReset();
  readImage.mockReset();
  // The host makes a URL for a picture it keeps; the test page has no real blobs to make one of.
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:picture");
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const button = (name: string) => screen.getByRole("button", { name });
const chosen = () => {
  pickFiles.mockResolvedValue([new File([new Uint8Array([1, 2])], "logo.png")]);
  readImage.mockResolvedValue({ name: "logo.png", bytes: new Uint8Array([1, 2]), size: { w: 20, h: 10 } });
};

describe("Theme", () => {
  it("lists every built-in theme as a card with its first example slide and its colours, and applies one", async () => {
    const kit = await mountDialogs({ dialog: "theme" });
    const cards = within(screen.getByRole("listbox", { name: "Built-in themes" })).getAllByRole("option");
    // The name is on the card's own line; the slide drawn small above it has words of its own.
    expect(cards.map((c) => c.querySelector(".ks-dg-theme-line")?.textContent)).toEqual([
      "Light",
      "Dark",
      "Serif",
      "Lecture",
      "Minimal",
      "Bold",
      "Modern",
      "Academic",
      "Pitch",
      "Dark Studio",
      "Warm Paper",
    ]);
    expect(cards[0]?.getAttribute("aria-selected")).toBe("true");
    expect(cards.every((c) => c.querySelectorAll(".ks-sp-strip > span").length === 6)).toBe(true);
    expect(cards.every((c) => c.querySelector(".ks-dg-theme-thumb .ks-slide") !== null)).toBe(true);
    fireEvent.click(cards[2] as HTMLElement);
    expect(kit.session.deck.theme.name).toBe("Serif");
    expect(kit.session.deck.theme.fonts.heading.family).toBe("Cambria");
  });

  it("shows the ten colours as hex values", async () => {
    const kit = await mountDialogs({ dialog: "theme" });
    const colors = kit.session.deck.theme.colors;
    expect(button("Accent 1").textContent).toContain(colors.accent1);
    expect(button("Background 2").textContent).toContain(colors.bg2);
    expect(["Text 1", "Text 2", "Background 1", "Background 2", "Accent 1", "Accent 2", "Accent 3", "Accent 4", "Accent 5", "Accent 6"].every((n) => screen.queryByRole("button", { name: n }))).toBe(true);
  });

  it("changes a colour to one picked or typed, each as one step, and the slide follows", async () => {
    const kit = await mountDialogs({ dialog: "theme" });
    const before = kit.session.state.revision;
    fireEvent.click(button("Accent 1"));
    fireEvent.click(screen.getByLabelText("#ff0000"));
    expect(kit.session.deck.theme.colors.accent1).toBe("#ff0000");
    expect(button("Accent 1").textContent).toContain("#ff0000");
    expect(kit.session.state.revision).toBe(before + 1);
    // A colour of the theme stands for its own value.
    fireEvent.click(button("Accent 3"));
    fireEvent.click(screen.getByLabelText("accent2"));
    expect(kit.session.deck.theme.colors.accent3).toBe(kit.session.deck.theme.colors.accent2);
    // A value typed in.
    fireEvent.click(button("Text 1"));
    fireEvent.change(screen.getByLabelText("Colour as hex"), { target: { value: "0a0b0c" } });
    fireEvent.click(screen.getByRole("button", { name: "Use" }));
    expect(kit.session.deck.theme.colors.text1).toBe("#0a0b0c");
    edit(() => kit.session.undo());
    expect(kit.session.deck.theme.colors.text1).toBe("#202124");
    expect(kit.errors).toEqual([]);
  });

  it("leaves a colour alone when the palette is left with nothing picked", async () => {
    const kit = await mountDialogs({ dialog: "theme" });
    const before = kit.session.state.revision;
    fireEvent.click(button("Accent 2"));
    fireEvent.click(screen.getByRole("button", { name: "Keep this colour" }));
    expect(kit.session.state.revision).toBe(before);
  });

  it("edits the three typefaces by name or from a menu of common ones", async () => {
    const kit = await mountDialogs({ dialog: "theme" });
    const heading = screen.getByLabelText("Heading font") as HTMLInputElement;
    expect(heading.value).toBe("Inter");
    fireEvent.change(heading, { target: { value: "Lato" } });
    fireEvent.keyDown(heading, { key: "Enter" });
    expect(kit.session.deck.theme.fonts.heading.family).toBe("Lato");
    // The fallbacks stay.
    expect(kit.session.deck.theme.fonts.heading.fallback).toEqual(["Helvetica Neue", "Arial", "sans-serif"]);
    const menu = screen.getByLabelText("Code font, common families") as HTMLSelectElement;
    expect([...menu.options].map((o) => o.value)).toEqual(["", ...COMMON_FAMILIES]);
    // It shows the typeface when it is one of them, and asks to choose when it is another.
    expect(menu.value).toBe("Roboto Mono");
    expect((screen.getByLabelText("Heading font, common families") as HTMLSelectElement).value).toBe("Lato");
    fireEvent.change(screen.getByLabelText("Body font"), { target: { value: "Papyrus" } });
    fireEvent.keyDown(screen.getByLabelText("Body font"), { key: "Enter" });
    expect(kit.session.deck.theme.fonts.body.family).toBe("Papyrus");
    expect((screen.getByLabelText("Body font, common families") as HTMLSelectElement).value).toBe("");
    fireEvent.change(menu, { target: { value: "Consolas" } });
    expect(kit.session.deck.theme.fonts.code.family).toBe("Consolas");
    expect((screen.getByLabelText("Code font") as HTMLInputElement).value).toBe("Consolas");
    // A blank name changes nothing.
    fireEvent.change(screen.getByLabelText("Body font"), { target: { value: "  " } });
    fireEvent.blur(screen.getByLabelText("Body font"));
    expect(kit.session.deck.theme.fonts.body.family).toBe("Papyrus");
    expect(kit.errors).toEqual([]);
  });

  it("sets a logo from a picture and takes it away, and cannot take away one that is not there", async () => {
    const kit = await mountDialogs({ dialog: "theme" });
    expect(button("Remove logo").hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("No logo")).toBeTruthy();
    chosen();
    fireEvent.click(button("Choose image…"));
    await waitFor(() => expect(kit.session.deck.theme.master?.some((e) => e.type === "image" && e.src === "assets/logo.png")).toBe(true));
    expect(screen.getByText("assets/logo.png")).toBeTruthy();
    expect(button("Remove logo").hasAttribute("disabled")).toBe(false);
    fireEvent.click(button("Remove logo"));
    expect(kit.session.deck.theme.master?.some((e) => e.type === "image" && e.src === "assets/logo.png")).toBe(false);
    expect(screen.getByText("No logo")).toBeTruthy();
    // Nothing chosen, nothing done.
    pickFiles.mockResolvedValue([]);
    const before = kit.session.state.revision;
    fireEvent.click(button("Choose image…"));
    await waitFor(() => expect(pickFiles).toHaveBeenCalledTimes(2));
    expect(kit.session.state.revision).toBe(before);
    expect(kit.errors).toEqual([]);
  });

  it("shows the logo a theme has", async () => {
    const kit = await mountDialogs({ dialog: "theme", theme: "Lecture" });
    expect(kit.session.deck.theme.master?.some((e) => e.id === "master-logo")).toBeDefined();
    const kitLogo = await mountDialogs({
      dialog: "theme",
      prepare: (engine) => {
        engine.apply("set_logo", { src: "assets/uni.png" });
      },
    });
    expect(screen.getAllByText("assets/uni.png").length).toBeGreaterThan(0);
    expect(kitLogo.errors).toEqual([]);
  });
});

describe("Background", () => {
  it("sets a colour, an image and puts the theme's back, on the slide shown", async () => {
    const kit = await mountDialogs({ dialog: "background" });
    fireEvent.click(button("Background colour"));
    fireEvent.click(screen.getByLabelText("accent4"));
    expect(kit.session.slide.background).toEqual({ color: "accent4" });
    chosen();
    fireEvent.click(button("Choose image…"));
    await waitFor(() => expect(kit.session.slide.background).toEqual({ image: "assets/logo.png" }));
    expect(screen.getByText("assets/logo.png")).toBeTruthy();
    fireEvent.click(button("Use the theme's background"));
    expect(kit.session.slide.background).toBeUndefined();
    expect(button("Use the theme's background").hasAttribute("disabled")).toBe(true);
  });

  it("shows a preview of the background", async () => {
    await mountDialogs({ dialog: "background" });
    const preview = document.querySelector<HTMLElement>(".ks-dg-bg-preview");
    expect(preview?.style.backgroundColor).toBe("rgb(255, 255, 255)");
    fireEvent.click(button("Background colour"));
    fireEvent.click(screen.getByLabelText("accent1"));
    expect(document.querySelector<HTMLElement>(".ks-dg-bg-preview")?.style.backgroundColor).toBe("rgb(26, 115, 232)");
  });

  it("shows the picture in the preview", async () => {
    const kit = await mountDialogs({ dialog: "background" });
    chosen();
    fireEvent.click(button("Choose image…"));
    await waitFor(() => expect(kit.session.slide.background).toEqual({ image: "assets/logo.png" }));
    const preview = document.querySelector<HTMLElement>(".ks-dg-bg-preview");
    expect(preview?.style.backgroundImage).toBe('url("blob:picture")');
    expect(preview?.style.backgroundSize).toBe("cover");
  });

  it("copies the background to every slide in one step, and undo takes it back", async () => {
    const kit = await mountDialogs({
      dialog: "background",
      prepare: (engine) => {
        engine.apply("add_slide", { layout: "title-body" });
        engine.apply("add_slide", { layout: "title-only" });
      },
    });
    fireEvent.click(button("Background colour"));
    fireEvent.click(screen.getByLabelText("bg2"));
    const before = kit.session.state.revision;
    fireEvent.click(button("Apply to all slides"));
    expect(kit.session.deck.slides.map((s) => s.background)).toEqual(kit.session.deck.slides.map(() => ({ color: "bg2" })));
    expect(kit.session.state.revision).toBe(before + 1);
    edit(() => kit.session.undo());
    expect(kit.session.deck.slides.filter((s) => s.background).length).toBe(1);
  });

  it("copies the theme's background to every slide when the slide has none", async () => {
    const kit = await mountDialogs({
      dialog: "background",
      prepare: (engine) => {
        const [first] = engine.deck.slides;
        engine.apply("set_background", { slide: first!.id, background: { color: "accent1" } });
        engine.apply("add_slide", { layout: "blank" });
      },
      blank: false,
    });
    edit(() => kit.session.goTo(kit.session.deck.slides[1]!.id));
    fireEvent.click(button("Apply to all slides"));
    expect(kit.session.deck.slides.every((s) => s.background === undefined)).toBe(true);
  });
});
