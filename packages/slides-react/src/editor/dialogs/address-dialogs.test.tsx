import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { textBox } from "../factory.ts";
import { pageAddress, videoSource } from "./source-address.ts";
import { mountDialogs } from "./test-kit.tsx";

vi.mock("../files.ts", async (original) => ({ ...(await original<typeof import("../files.ts")>()), pickFiles: vi.fn(async () => [new File(["x"], "my talk.mp4")]) }));

afterEach(cleanup);

describe("the address of a web page to embed", () => {
  it("is an ordinary web address as it was typed", () => {
    expect(pageAddress("https://example.com/docs?x=1#top")).toBe("https://example.com/docs?x=1#top");
    expect(pageAddress("  http://example.com  ")).toBe("http://example.com");
  });

  it("gets https:// when it has none, and http:// for a page on this computer", () => {
    expect(pageAddress("example.com/docs")).toBe("https://example.com/docs");
    expect(pageAddress("localhost:3000")).toBe("http://localhost:3000");
    expect(pageAddress("localhost:8080/app")).toBe("http://localhost:8080/app");
    expect(pageAddress("127.0.0.1:5173")).toBe("http://127.0.0.1:5173");
  });

  it("is nothing for what cannot be embedded: mail, phone, scripts, a slide, words", () => {
    for (const bad of ["", "   ", "mailto:a@b.co", "tel:+1", "javascript:alert(1)", "slide:s-1", "not an address", "ftp://example.com"]) {
      expect(pageAddress(bad), bad).toBeNull();
    }
  });
});

describe("the source of a video", () => {
  it("is a web address, or the name of a file as it was typed", () => {
    expect(videoSource("https://example.com/talk.mp4")).toBe("https://example.com/talk.mp4");
    expect(videoSource("  assets/talk.mp4 ")).toBe("assets/talk.mp4");
    expect(videoSource("my talk.mp4")).toBe("my talk.mp4");
    expect(videoSource("cdn.example.com/talk.mp4")).toBe("https://cdn.example.com/talk.mp4");
    expect(videoSource("localhost:8000/talk.mp4")).toBe("http://localhost:8000/talk.mp4");
  });

  it("is nothing for nothing, or for an address that is not a video's to follow", () => {
    for (const bad of ["", "  ", "javascript:alert(1)", "mailto:a@b.co", "data:video/mp4;base64,AAAA", "file:///etc/passwd"]) {
      expect(videoSource(bad), bad).toBeNull();
    }
  });
});

describe("the embed dialog", () => {
  const address = () => screen.getByLabelText("Web address") as HTMLInputElement;

  it("asks for an address with the box focused, and puts a page on the slide", async () => {
    const kit = await mountDialogs({ dialog: "embed" });
    expect(screen.getByRole("dialog", { name: "Embed a web page" })).toBeTruthy();
    expect(document.activeElement).toBe(address());
    fireEvent.change(address(), { target: { value: "example.com/docs" } });
    fireEvent.change(screen.getByLabelText("Title (optional)"), { target: { value: "  The docs " } });
    fireEvent.click(screen.getByRole("button", { name: "Insert" }));
    expect(kit.ui.state.dialog).toBeNull();
    const [made] = kit.session.slide.elements;
    expect(made).toMatchObject({ type: "embed", url: "https://example.com/docs", title: "The docs" });
    expect(kit.session.state.selection).toEqual([made?.id]);
    kit.session.undo();
    expect(kit.session.slide.elements).toHaveLength(0);
  });

  it("takes Enter in either box", async () => {
    const kit = await mountDialogs({ dialog: "embed" });
    fireEvent.change(address(), { target: { value: "https://example.com" } });
    fireEvent.keyDown(screen.getByLabelText("Title (optional)"), { key: "Enter" });
    expect(kit.session.slide.elements[0]).toMatchObject({ type: "embed", url: "https://example.com/".replace(/\/$/, "") });
    expect(kit.session.slide.elements[0]).not.toHaveProperty("title");
  });

  it("refuses an address that is not a web page, says so, and leaves the slide alone", async () => {
    const kit = await mountDialogs({ dialog: "embed" });
    fireEvent.change(address(), { target: { value: "javascript:alert(1)" } });
    fireEvent.keyDown(address(), { key: "Enter" });
    expect(screen.getByRole("alert").textContent).toMatch(/web address/);
    expect(address().getAttribute("aria-invalid")).toBe("true");
    expect(kit.ui.state.dialog).toBe("embed");
    expect(kit.session.slide.elements).toHaveLength(0);
    // Nothing typed is the same.
    fireEvent.change(address(), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Insert" }));
    expect(kit.session.slide.elements).toHaveLength(0);
  });

  it("makes a 16:9 player of a video site's link, and an ordinary page of the rest", async () => {
    const kit = await mountDialogs({ dialog: "embed" });
    fireEvent.change(address(), { target: { value: "https://vimeo.com/76979871" } });
    fireEvent.click(screen.getByRole("button", { name: "Insert" }));
    expect(kit.session.slide.elements[0]).toMatchObject({ type: "embed", provider: "vimeo", design: { w: 1280, h: 720 } });
    cleanup();
    const page = await mountDialogs({ dialog: "embed" });
    fireEvent.change(address(), { target: { value: "https://example.com/docs" } });
    fireEvent.click(screen.getByRole("button", { name: "Insert" }));
    const [made] = page.session.slide.elements;
    expect(made).toMatchObject({ type: "embed", design: { w: 1280, h: 800 } });
    expect(made).not.toHaveProperty("provider");
  });

  it("puts the page in the free place, and can be left with Cancel or Escape", async () => {
    const kit = await mountDialogs({ dialog: "embed", elements: [textBox({ x: 40, y: 40, w: 880, h: 90 }, "Title")], select: [] });
    fireEvent.change(address(), { target: { value: "https://example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Insert" }));
    expect(kit.session.slide.elements[1]?.y).toBeGreaterThanOrEqual(130);
    cleanup();
    const again = await mountDialogs({ dialog: "embed" });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(again.ui.state.dialog).toBeNull();
    expect(again.session.slide.elements).toHaveLength(0);
  });
});

describe("the video dialog", () => {
  const source = () => screen.getByLabelText("Web address or file name") as HTMLInputElement;

  it("puts a video on the slide from a web address", async () => {
    const kit = await mountDialogs({ dialog: "video" });
    expect(document.activeElement).toBe(source());
    fireEvent.change(source(), { target: { value: "https://example.com/talk.mp4" } });
    fireEvent.keyDown(source(), { key: "Enter" });
    expect(kit.ui.state.dialog).toBeNull();
    expect(kit.session.slide.elements[0]).toMatchObject({ type: "video", src: "https://example.com/talk.mp4" });
  });

  it("keeps the file that is picked with the deck, and uses the path it has there (not the name it had on this computer)", async () => {
    const kit = await mountDialogs({ dialog: "video" });
    fireEvent.click(screen.getByRole("button", { name: "Choose file…" }));
    await waitFor(() => expect(source().value).toBe("assets/my-talk.mp4"));
    fireEvent.click(screen.getByRole("button", { name: "Insert" }));
    expect(kit.session.slide.elements[0]).toMatchObject({ type: "video", src: "assets/my-talk.mp4" });
    expect((await kit.host.images()).map((image) => image.path)).toEqual(["assets/my-talk.mp4"]);
  });

  it("tells the person when the host would not keep the file, and fills nothing in", async () => {
    const kit = await mountDialogs({ dialog: "video" });
    kit.host.addImage = async () => Promise.reject(new Error("That file is too big to keep."));
    fireEvent.click(screen.getByRole("button", { name: "Choose file…" }));
    await waitFor(() => expect(kit.host.notices).toContain("That file is too big to keep."));
    expect(source().value).toBe("");
  });

  it("makes an embedded player of a YouTube or Vimeo link, in a 16:9 box, with the site noted and its picture as the poster", async () => {
    const kit = await mountDialogs({ dialog: "video" });
    const fetchPoster = vi.fn(async () => ({ name: "youtube-dQw4w9WgXcQ.jpg", bytes: new Uint8Array([1, 2, 3]) }));
    Object.assign(kit.host, { fetchPoster });
    fireEvent.change(source(), { target: { value: "https://youtu.be/dQw4w9WgXcQ?t=90" } });
    fireEvent.keyDown(source(), { key: "Enter" });
    const [made] = kit.session.slide.elements;
    expect(made).toMatchObject({ type: "embed", url: "https://youtu.be/dQw4w9WgXcQ?t=90", provider: "youtube", design: { w: 1280, h: 720 } });
    expect(made?.w && made.h ? Math.round((made.w / made.h) * 100) : 0).toBe(178);
    expect(fetchPoster).toHaveBeenCalledWith({ provider: "youtube", id: "dQw4w9WgXcQ", url: "https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg" });
    await waitFor(() => expect(kit.session.slide.elements[0]).toMatchObject({ poster: "assets/youtube-dQw4w9WgXcQ.jpg" }));
  });

  it("leaves a link of another site as a video of that address", async () => {
    const kit = await mountDialogs({ dialog: "video" });
    fireEvent.change(source(), { target: { value: "https://example.com/talk.mp4" } });
    fireEvent.keyDown(source(), { key: "Enter" });
    expect(kit.session.slide.elements[0]).toMatchObject({ type: "video" });
  });

  it("wants something, and refuses a script", async () => {
    const kit = await mountDialogs({ dialog: "video" });
    fireEvent.click(screen.getByRole("button", { name: "Insert" }));
    expect(screen.getByRole("alert")).toBeTruthy();
    fireEvent.change(source(), { target: { value: "javascript:alert(1)" } });
    fireEvent.click(screen.getByRole("button", { name: "Insert" }));
    expect(kit.session.slide.elements).toHaveLength(0);
    expect(kit.ui.state.dialog).toBe("video");
  });
});
