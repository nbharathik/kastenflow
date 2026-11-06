import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { newDeck } from "../../test/engine.ts";
import { mountDialogs } from "../dialogs/test-kit.tsx";
import { type BrandKit, applyBrandToNewDeck, brandOperations, brandPalette, emptyKit, kitText, normaliseHex, parseKit } from "./brand.ts";
import type { BrandHost, BrandScope } from "./brand-host.ts";

afterEach(cleanup);

const kitOf = (extra: Partial<BrandKit> = {}): BrandKit => ({ ...emptyKit(), name: "Acme", logo: "assets/logo.png", colors: { accent1: "#0b5cad", bg1: "#ffffff" }, heading: "Lato", body: "Inter", theme: "Modern", ...extra });

describe("the kit as text", () => {
  it("is read back as it was written, with fields this version does not know kept", () => {
    const kit = kitOf({ extra: { "x-newer": { added: "later" } } });
    const text = kitText(kit);
    expect(text.endsWith("}\n")).toBe(true);
    expect(parseKit(text)).toEqual(kit);
    expect(JSON.parse(text)["x-newer"]).toEqual({ added: "later" });
    // Sorted keys, so the file does not change when nothing did.
    expect(Object.keys(JSON.parse(text))).toEqual([...Object.keys(JSON.parse(text))].sort());
    expect(kitText(parseKit(text) as BrandKit)).toBe(text);
  });

  it("leaves out what is not set and what cannot be used", () => {
    expect(parseKit("not json")).toBeNull();
    expect(parseKit(JSON.stringify({ format: "kasten-layout" }))).toBeNull();
    const kit = parseKit(JSON.stringify({ format: "kasten-brand", formatVersion: 1, colors: { accent1: "red", accent2: "#ABC", nonsense: "#000000" }, fonts: { heading: "  " } }));
    expect(kit?.colors).toEqual({ accent2: "#aabbcc" });
    expect(kit?.heading).toBeNull();
    expect(kit?.logo).toBeNull();
    const written = JSON.parse(kitText(emptyKit()));
    expect(written).toEqual({ colors: {}, format: "kasten-brand", formatVersion: 1, name: "Brand" });
  });

  it("reads colours in the usual spellings", () => {
    expect(normaliseHex("#0B5CAD")).toBe("#0b5cad");
    expect(normaliseHex("#abc")).toBe("#aabbcc");
    expect(normaliseHex("#12345680")).toBe("#123456");
    expect(normaliseHex("accent1")).toBeNull();
    expect(brandPalette(kitOf({ colors: { accent1: "#0b5cad", accent2: "#0b5cad", bg1: "#ffffff" } }))).toEqual(["#0b5cad", "#ffffff"]);
  });
});

describe("putting a kit on a deck", () => {
  it("is the theme, one edit of its colours and fonts, and the logo; a new deck keeps its own theme", () => {
    const names = (kit: BrandKit, withTheme?: boolean) => brandOperations(kit, withTheme).map(([name]) => name);
    expect(names(kitOf())).toEqual(["apply_theme", "edit_theme", "set_logo"]);
    expect(names(kitOf(), false)).toEqual(["edit_theme", "set_logo"]);
    expect(names(emptyKit())).toEqual([]);
    const edit = brandOperations(kitOf())[1];
    expect(edit?.[1]).toEqual({ patch: { colors: { accent1: "#0b5cad", bg1: "#ffffff" }, fonts: { heading: { family: "Lato" }, body: { family: "Inter" } } } });
  });

  it("changes the colours and fonts of a deck that is being made, and nothing when the kit says nothing", async () => {
    const engine = await newDeck("Brand", "Light");
    expect(applyBrandToNewDeck(engine, emptyKit())).toBe(false);
    expect(applyBrandToNewDeck(engine, kitOf({ logo: null }))).toBe(true);
    expect(engine.deck.theme.colors.accent1).toBe("#0b5cad");
    expect(engine.deck.theme.fonts.heading.family).toBe("Lato");
  });
});

function brandHost(text: string | null, scope: BrandScope = "vault", project: string | null = null) {
  const save = vi.fn(async (_text: string, _scope: BrandScope) => {});
  const host: BrandHost = { project, read: async () => (text === null ? null : { text, scope }), save };
  return { host, save };
}

async function openDialog(host: BrandHost | undefined) {
  const kit = await mountDialogs({ dialog: null });
  act(() => {
    if (host) kit.host.brand = host;
    kit.ui.openDialog("brand");
  });
  return kit;
}

describe("the brand kit dialog", () => {
  it("says so where the host keeps no kit", async () => {
    await openDialog(undefined);
    expect(await screen.findByText(/needs a place to keep it/)).toBeTruthy();
  });

  it("shows the kit that was kept, and keeps changes to it as text the host can store", async () => {
    const { host, save } = brandHost(kitText(kitOf({ extra: { "x-newer": 1 } })));
    await openDialog(host);
    await waitFor(() => expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Acme"));
    expect((screen.getByLabelText("Accent 1") as HTMLInputElement).value).toBe("#0b5cad");
    fireEvent.change(screen.getByLabelText("Accent 1"), { target: { value: "#112233" } });
    fireEvent.click(screen.getByRole("button", { name: "Save kit" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    const [text, scope] = save.mock.calls[0] as [string, BrandScope];
    expect(scope).toBe("vault");
    expect(parseKit(text)?.colors.accent1).toBe("#112233");
    expect(JSON.parse(text)["x-newer"]).toBe(1);
    expect(await screen.findByText("Saved for the vault.")).toBeTruthy();
  });

  it("starts from how the deck looks now when there is no kit", async () => {
    const { host } = brandHost(null);
    const kit = await openDialog(host);
    await waitFor(() => expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe(kit.session.deck.title));
    expect((screen.getByLabelText("Accent 1") as HTMLInputElement).value).toBe(kit.session.deck.theme.colors.accent1.toLowerCase());
  });

  it("puts the kit on the deck as one step of undo, and saves it first", async () => {
    const { host, save } = brandHost(kitText(kitOf({ theme: null, logo: null })));
    const kit = await openDialog(host);
    await waitFor(() => expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Acme"));
    const steps = kit.session.stepLog.length;
    fireEvent.click(screen.getByRole("button", { name: "Save and use on this deck" }));
    await waitFor(() => expect(screen.getByText(/Undo takes it back/)).toBeTruthy());
    expect(save).toHaveBeenCalledTimes(1);
    expect(kit.session.deck.theme.colors.accent1).toBe("#0b5cad");
    expect(kit.session.deck.theme.fonts.body.family).toBe("Inter");
    expect(kit.session.stepLog.length).toBe(steps + 1);
    act(() => kit.session.undo());
    expect(kit.session.deck.theme.colors.accent1).not.toBe("#0b5cad");
  });

  it("offers a kit for the project when the deck is in one, and keeps it there", async () => {
    const { host, save } = brandHost(kitText(kitOf()), "vault", "Talks");
    await openDialog(host);
    await waitFor(() => expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Acme"));
    fireEvent.click(screen.getByRole("radio", { name: /Decks in the project “Talks”/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save kit" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0]?.[1]).toBe("project");
    expect(await screen.findByText("Saved for this project.")).toBeTruthy();
  });

  it("tells the person when the kit could not be kept", async () => {
    const { host } = brandHost(kitText(kitOf()));
    host.save = async () => {
      throw new Error("The vault is read-only.");
    };
    await openDialog(host);
    await waitFor(() => expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Acme"));
    fireEvent.click(screen.getByRole("button", { name: "Save kit" }));
    expect((await screen.findByRole("alert")).textContent).toBe("The vault is read-only.");
  });

  it("checks the deck against the kit's colours, and asks for colours first when it has none", async () => {
    const { host } = brandHost(kitText(emptyKit()));
    await openDialog(host);
    await waitFor(() => expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Brand"));
    fireEvent.click(screen.getByRole("button", { name: "Check this deck for other colours" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Choose the brand's colours first.");
    fireEvent.change(screen.getByLabelText("Accent 1"), { target: { value: "#0b5cad" } });
    fireEvent.click(screen.getByRole("button", { name: "Check this deck for other colours" }));
    expect(await screen.findByText(/Every colour on the slides is the brand's or the theme's\./)).toBeTruthy();
  });
});
