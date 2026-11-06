import { afterEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args), isTauri: () => true }));
// The listening of the link between the windows is not this file's.
vi.mock("@tauri-apps/api/webviewWindow", () => ({ getCurrentWebviewWindow: () => ({ label: "this", listen: async () => () => {} }) }));

const { embedHost } = await import("./embed-host");

afterEach(() => invoke.mockReset());

describe("the core's help with embedded pages and videos", () => {
  it("asks whether a site lets itself be framed, and takes 'unknown' when it cannot be asked", async () => {
    invoke.mockResolvedValueOnce("refused");
    expect(await embedHost().framePolicy("https://example.com/x")).toBe("refused");
    expect(invoke).toHaveBeenLastCalledWith("frame_policy", { url: "https://example.com/x" });
    invoke.mockRejectedValueOnce(new Error("offline"));
    expect(await embedHost().framePolicy("https://example.com/x")).toBe("unknown");
  });

  it("names the picture of a video after the site and the video, with the kind of file it came as", async () => {
    invoke.mockResolvedValueOnce({ ext: "jpg", bytes: [255, 216, 255] });
    const got = await embedHost().fetchPoster({ provider: "youtube", id: "dQw4w9WgXcQ", url: "https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg" });
    expect(invoke).toHaveBeenLastCalledWith("fetch_poster", { provider: "youtube", url: "https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg" });
    expect(got?.name).toBe("youtube-dQw4w9WgXcQ.jpg");
    expect([...(got?.bytes ?? [])]).toEqual([255, 216, 255]);
  });

  it("has no picture when the core has none or fails", async () => {
    invoke.mockResolvedValueOnce(null);
    expect(await embedHost().fetchPoster({ provider: "vimeo", id: "1", url: "https://vimeo.com/api/oembed.json?url=x" })).toBeNull();
    invoke.mockRejectedValueOnce(new Error("no"));
    expect(await embedHost().fetchPoster({ provider: "vimeo", id: "1", url: "https://vimeo.com/api/oembed.json?url=x" })).toBeNull();
  });

  it("lets the pages load while an embed plays, and takes the permission back", async () => {
    invoke.mockResolvedValue(undefined);
    const release = await embedHost().allowFrames(["https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"]);
    expect(invoke).toHaveBeenLastCalledWith("allow_embeds", { urls: ["https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"] });
    if (typeof release === "function") release();
    expect(invoke).toHaveBeenLastCalledWith("allow_embeds", { urls: [] });
  });
});
