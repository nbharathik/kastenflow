import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { mountDialogs } from "../dialogs/test-kit.tsx";
import { ICONS } from "../ui/icons.ts";
import { ICON_LIBRARY, findIcons, iconSvg } from "./icon-library.ts";
import { iconColors, insertIcon } from "./insert-icon.ts";

afterEach(cleanup);

const names = (query: string): string[] => findIcons(query).map((icon) => icon.name);

describe("the icons on offer", () => {
  it("are the bundled Lucide icons less the ones that only name a toolbar command", () => {
    const listed = new Set(ICON_LIBRARY.map((icon) => icon.name));
    for (const name of ["star", "house", "chart-line", "users", "globe", "bot", "calendar", "cloud", "lock"]) expect(listed.has(name as never), name).toBe(true);
    for (const name of ["bold", "undo-2", "align-center-vertical", "chevron-down", "text-align-start", "clipboard-paste", "grip-vertical", "x"]) expect(listed.has(name as never), name).toBe(false);
    expect(ICON_LIBRARY.length).toBeGreaterThan(80);
    expect(ICON_LIBRARY.length).toBeLessThan(Object.keys(ICONS).length);
  });

  it("are found by name and by the words people use, every word having to match", () => {
    expect(names("")).toHaveLength(ICON_LIBRARY.length);
    expect(names("graph")).toEqual(expect.arrayContaining(["chart-line", "chart-pie"]));
    expect(names("home")).toEqual(["house"]);
    expect(names("chart pie")).toEqual(["chart-pie"]);
    expect(names("  STAR ")).toContain("star");
    expect(names("zzzz")).toEqual([]);
  });
});

describe("an icon as a picture", () => {
  it("is a self-contained SVG of the icon's own shapes in the colour chosen", () => {
    const svg = iconSvg("star", { color: "#0b5cad" });
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"')).toBe(true);
    expect(svg).toContain('stroke="#0b5cad"');
    expect(svg).toContain('stroke-width="1.75"');
    const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
    expect(parsed.querySelector("parsererror")).toBeNull();
    expect(parsed.documentElement.children).toHaveLength(ICONS.star.length);
  });

  it("is written safely whatever the colour says", () => {
    const svg = iconSvg("circle", { color: '"><script>' });
    expect(svg).not.toContain("<script>");
    expect(new DOMParser().parseFromString(svg, "image/svg+xml").querySelector("parsererror")).toBeNull();
  });

  it("is offered in the theme's colours as hex", async () => {
    const kit = await mountDialogs({ dialog: null });
    const colors = iconColors(kit.session);
    expect(colors.length).toBeGreaterThan(3);
    expect(colors.every((choice) => /^#[0-9a-f]{6}$/.test(choice.hex))).toBe(true);
    expect(colors[0]?.label).toBe("Text");
  });
});

describe("putting an icon on a slide", () => {
  it("adds one named picture of the chosen size in the free place, selected, as one step of undo", async () => {
    const kit = await mountDialogs({});
    const steps = kit.session.stepLog.length;
    const id = await insertIcon(kit.session, "star", { color: "#0b5cad" }, 96);
    expect(id).toBeDefined();
    expect(kit.session.stepLog.length).toBe(steps + 1);
    const [made] = kit.session.slide.elements;
    const side = Math.round((96 * kit.session.deck.size.w) / 960);
    expect(made).toMatchObject({ type: "image", name: "Icon: Star", alt: "Star", w: side, h: side });
    expect(kit.session.state.selection).toEqual([id]);
    const src = made?.type === "image" ? made.src : "";
    expect(src).toMatch(/\.svg$/);
    const bytes = await kit.host.readImage(src);
    expect(new TextDecoder().decode(bytes)).toContain('stroke="#0b5cad"');
    expect(kit.errors).toEqual([]);
    kit.session.undo();
    expect(kit.session.slide.elements).toHaveLength(0);
  });

  it("keeps one file for the same icon in the same colour, and another for another colour", async () => {
    const kit = await mountDialogs({});
    await insertIcon(kit.session, "star", { color: "#0b5cad" }, 48);
    await insertIcon(kit.session, "star", { color: "#0b5cad" }, 48);
    await insertIcon(kit.session, "star", { color: "#aa0000" }, 48);
    const sources = kit.session.slide.elements.map((element) => (element.type === "image" ? element.src : ""));
    expect(sources[0]).toBe(sources[1]);
    expect(sources[2]).not.toBe(sources[0]);
    expect(await kit.host.images()).toHaveLength(2);
  });
});

describe("the icon dialog", () => {
  it("opens with the search box focused and a grid of icons, and finds one by a word", async () => {
    await mountDialogs({ dialog: "icons" });
    const search = screen.getByRole("searchbox", { name: "Search icons" }) as HTMLInputElement;
    expect(document.activeElement).toBe(search);
    expect(screen.getAllByRole("option").length).toBeGreaterThan(80);
    fireEvent.change(search, { target: { value: "home" } });
    expect(screen.getAllByRole("option").map((option) => option.getAttribute("aria-label"))).toEqual(["House"]);
    fireEvent.change(search, { target: { value: "zzzz" } });
    expect(screen.getByText("No icon has that name.")).toBeTruthy();
  });

  it("puts the icon picked on the slide in the colour and size chosen, and closes", async () => {
    const kit = await mountDialogs({ dialog: "icons" });
    fireEvent.change(screen.getByRole("searchbox", { name: "Search icons" }), { target: { value: "star" } });
    const colors = screen.getByRole("radiogroup", { name: "Colour" });
    fireEvent.click(within(colors).getByRole("radio", { name: "Accent 3" }));
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Size" })).getByRole("radio", { name: "Large" }));
    fireEvent.click(screen.getByRole("option", { name: "Star" }));
    await waitFor(() => expect(kit.ui.state.dialog).toBeNull());
    const [made] = kit.session.slide.elements;
    expect(made?.type).toBe("image");
    const accent3 = iconColors(kit.session).find((choice) => choice.label === "Accent 3")?.hex;
    const src = made?.type === "image" ? made.src : "";
    expect(new TextDecoder().decode(await kit.host.readImage(src))).toContain(`stroke="${accent3}"`);
    expect(made).toMatchObject({ w: Math.round((160 * kit.session.deck.size.w) / 960) });
  });

  it("walks the grid with the arrow keys and closes on Escape without adding anything", async () => {
    const kit = await mountDialogs({ dialog: "icons" });
    const [first, second] = screen.getAllByRole("option");
    (first as HTMLElement).focus();
    fireEvent.keyDown(first as HTMLElement, { key: "ArrowRight" });
    expect(document.activeElement).toBe(second);
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Icons" }), { key: "Escape" });
    expect(kit.ui.state.dialog).toBeNull();
    expect(kit.session.slide.elements).toHaveLength(0);
  });
});
