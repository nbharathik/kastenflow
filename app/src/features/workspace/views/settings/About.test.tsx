import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { About } from "./About";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Settings: About", () => {
  it("shows the open-source licences the build carries", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("KastenFlow is MIT-licensed. It includes…\n\nRust crates (2)\n", { status: 200 })));
    render(<About />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Show" })));
    expect((await screen.findByLabelText("Open-source licences")).textContent).toContain("Rust crates (2)");
    fireEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(screen.queryByLabelText("Open-source licences")).toBeNull();
  });

  it("finds the list beside the app when a build is served from a folder", async () => {
    // The demo is built with a relative base and served from /<repository>/demo/.
    vi.stubEnv("BASE_URL", "./");
    const fetched = vi.fn(async (_url: string) => new Response("Kasten is MIT-licensed.\n", { status: 200 }));
    vi.stubGlobal("fetch", fetched);
    render(<About />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Show" })));
    expect(fetched).toHaveBeenCalledWith("./third-party-notices.txt");
    vi.unstubAllEnvs();
  });

  it("shows how long this start took, from the page's marks", () => {
    performance.mark("kasten:listed");
    render(<About />);
    expect(screen.getByText(/Startup: \d+ ms/)).toBeTruthy();
    performance.clearMarks();
  });

  it("says so when a build has none", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<!doctype html>", { status: 200 })));
    render(<About />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Show" })));
    expect(await screen.findByText(/This build has no licence list/)).toBeTruthy();
  });
});
