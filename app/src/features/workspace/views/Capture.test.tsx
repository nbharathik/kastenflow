import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isAddress } from "../../../lib/address";
import type { NoteFile } from "../../../lib/vault/types";
import { MemoryVault } from "../preview/memory-vault";
import { useWorkspace } from "../store";
import { Capture } from "./Capture";

/** The preview vault as the desktop app, clipping pages it is given. */
class ClippingVault extends MemoryVault {
  pages = new Map<string, string>();

  override async clipUrl(url: string): Promise<NoteFile> {
    const title = this.pages.get(url);
    if (!title) throw new Error(`${url} answered 404 Not Found`);
    return this.create({ kind: "card", title, date: "2026-09-25" });
  }
}

let vault: ClippingVault;

async function open(desktop = true) {
  vault = new ClippingVault({});
  if (desktop) Object.defineProperty(vault, "kind", { value: "vault" });
  useWorkspace.setState({ toasts: [] });
  await useWorkspace.getState().connect({ client: vault });
  render(<Capture />);
  return screen.getByRole("textbox", { name: "Quick note" });
}

const titles = () => useWorkspace.getState().notes.map((n) => n.title);
const lastToast = () => useWorkspace.getState().toasts.at(-1)?.text;

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("quick capture", () => {
  it("tells web addresses from thoughts", () => {
    expect(isAddress("https://example.com/a?b=1")).toBe(true);
    expect(isAddress(" www.example.org/guide ")).toBe(true);
    expect(isAddress("notes.md")).toBe(false);
    expect(isAddress("see https://example.com later")).toBe(false);
    expect(isAddress("Call Ada")).toBe(false);
  });

  it("clips a pasted page in the desktop app", async () => {
    const input = await open();
    vault.pages.set("https://example.com/slip-box", "Slip-box basics");
    fireEvent.change(input, { target: { value: "https://example.com/slip-box" } });
    const button = screen.getByRole("button", { name: "Clip the page" });
    await act(async () => fireEvent.click(button));
    expect(titles()).toContain("Slip-box basics");
    expect(lastToast()).toBe("Clipped “Slip-box basics” to the Inbox");
    expect((input as HTMLInputElement).value).toBe("");
  });

  it("keeps the link when the page will not come", async () => {
    const input = await open();
    fireEvent.change(input, { target: { value: "https://example.com/gone" } });
    await act(async () => fireEvent.submit(input.closest("form")!));
    expect(titles()).toContain("https://example.com/gone");
    expect(lastToast()).toBe("Kept the link: the page could not be clipped (https://example.com/gone answered 404 Not Found)");
  });

  it("keeps a thought as it always did, and offers no clipping in the preview", async () => {
    const input = await open(false);
    fireEvent.change(input, { target: { value: "https://example.com/a" } });
    expect(screen.queryByRole("button", { name: "Clip the page" })).toBeNull();
    fireEvent.change(input, { target: { value: "Call Ada" } });
    await act(async () => fireEvent.submit(input.closest("form")!));
    expect(titles()).toContain("Call Ada");
    expect(lastToast()).toBe("Saved “Call Ada” to the Inbox");
    expect((input as HTMLTextAreaElement).value).toBe("");
  });

  it("keeps the thought in the box when it could not be saved", async () => {
    const input = await open(false);
    vi.spyOn(vault, "capture").mockRejectedValueOnce(new Error("The vault is read-only"));
    fireEvent.change(input, { target: { value: "Call Ada\nAbout the kiln" } });
    await act(async () => fireEvent.submit(input.closest("form")!));
    expect(lastToast()).toBe("The vault is read-only");
    expect((input as HTMLTextAreaElement).value).toBe("Call Ada\nAbout the kiln");
    vi.restoreAllMocks();
  });
});
