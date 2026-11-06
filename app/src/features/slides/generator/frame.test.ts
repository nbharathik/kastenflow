// The frame code runs in: hidden, sandboxed with scripts and nothing else, loaded from the generator folder of the `smart` scheme under
// a secret the app made, heard only for what it posts itself, and taken out of the page (and its secret ended) when it is over.

import { afterEach, describe, expect, it, vi } from "vitest";

import type { GeneratorBackend } from "./backend";
import { GENERATOR_SANDBOX, domFrameHost } from "./frame";

const SECRET = "ab".repeat(32);

function backend(): GeneratorBackend & { closed: string[] } {
  const closed: string[] = [];
  return {
    closed,
    openFrame: async () => SECRET,
    closeFrame: async (frame) => void closed.push(frame),
  };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("the frame for code", () => {
  it("is a hidden iframe that may run its own scripts and do nothing else", async () => {
    expect(GENERATOR_SANDBOX).toBe("allow-scripts");
    const frame = await domFrameHost(backend()).open(() => {});
    const iframe = document.querySelector("iframe");
    expect(iframe).not.toBeNull();
    expect(iframe!.getAttribute("sandbox")).toBe("allow-scripts");
    expect(iframe!.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(iframe!.getAttribute("aria-hidden")).toBe("true");
    expect(iframe!.tabIndex).toBe(-1);
    expect(iframe!.style.visibility).toBe("hidden");
    expect(iframe!.src).toMatch(new RegExp(`/${SECRET}/generator/runner\\.html$`));
    frame.close();
  });

  it("hears the frame it made and no one else, and posts to it", async () => {
    const heard: unknown[] = [];
    const frame = await domFrameHost(backend()).open((data) => heard.push(data));
    const iframe = document.querySelector("iframe")!;
    window.dispatchEvent(new MessageEvent("message", { data: { type: "ready" }, source: iframe.contentWindow }));
    window.dispatchEvent(new MessageEvent("message", { data: { type: "result", id: "x" }, source: window }));
    window.dispatchEvent(new MessageEvent("message", { data: { type: "result", id: "y" } }));
    expect(heard).toEqual([{ type: "ready" }]);
    const post = vi.spyOn(iframe.contentWindow!, "postMessage");
    frame.post({ type: "run", id: "r" });
    expect(post).toHaveBeenCalledWith({ type: "run", id: "r" }, "*");
    frame.close();
  });

  it("is taken out of the page, stops being heard, and has its secret ended when it is closed", async () => {
    const asked = backend();
    const heard: unknown[] = [];
    const frame = await domFrameHost(asked).open((data) => heard.push(data));
    const iframe = document.querySelector("iframe")!;
    const contentWindow = iframe.contentWindow;
    frame.close();
    expect(document.querySelector("iframe")).toBeNull();
    window.dispatchEvent(new MessageEvent("message", { data: { type: "ready" }, source: contentWindow }));
    expect(heard).toEqual([]);
    await Promise.resolve();
    expect(asked.closed).toEqual([SECRET]);
  });

  it("does not make a frame when the app will not give a secret", async () => {
    const refusing: GeneratorBackend = { openFrame: async () => Promise.reject(new Error("no secure number")), closeFrame: async () => {} };
    await expect(domFrameHost(refusing).open(() => {})).rejects.toThrow("no secure number");
    expect(document.querySelector("iframe")).toBeNull();
  });
});
