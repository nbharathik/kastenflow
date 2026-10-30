import { describe, expect, it, vi } from "vitest";

import { DOWNLOAD_STEPS, STEP_MS } from "../../demo/clock";
import { fakeClock } from "../../demo/fake-clock";
import type { PayloadEvent } from "../api";
import { PluginsDemo } from "./backend";

function make(changed = vi.fn()) {
  const clock = fakeClock();
  const plugins = new PluginsDemo(clock, { changed });
  const heard: PayloadEvent[] = [];
  return { clock, plugins, heard, changed };
}

describe("the demo's plugins", () => {
  it("lists draw.io, LaTeX and the browser, with draw.io on and ready", async () => {
    const { plugins } = make();
    const list = await plugins.list();
    expect(list.map((p) => [p.id, p.enabled])).toEqual([
      ["diagrams", true],
      ["latex", false],
      ["browser", false],
    ]);
    expect(list.find((p) => p.id === "latex")!.payload).toMatchObject({ label: "Tectonic" });
    expect(list.find((p) => p.id === "browser")!.payload).toBeNull();
    expect(await plugins.status("diagrams")).toMatchObject({ installed: true, state: "ready" });
    expect(await plugins.status("latex")).toMatchObject({ installed: false, state: "idle" });
  });

  it("switches a plugin on and off", async () => {
    const { plugins } = make();
    expect(await plugins.setEnabled("latex", true)).toBe(true);
    expect(await plugins.setEnabled("latex", true)).toBe(false);
    expect((await plugins.list()).find((p) => p.id === "latex")!.enabled).toBe(true);
    await plugins.setEnabled("latex", false);
    expect(plugins.isOn("latex")).toBe(false);
  });

  it("downloads in about two seconds, telling each step, and then is ready", async () => {
    const { plugins, clock, heard, changed } = make();
    await plugins.onPayload((event) => heard.push(event));
    const done = vi.fn();
    const run = plugins.install("latex").then(done);
    clock.advance(STEP_MS * (DOWNLOAD_STEPS - 1));
    expect(done).not.toHaveBeenCalled();
    const percents = heard.map((e) => Math.round((e.done / e.total) * 100));
    expect(heard.every((e) => e.state === "downloading" && e.id === "latex")).toBe(true);
    expect(percents).toEqual([...percents].sort((a, b) => a - b));
    expect(percents.at(-1)).toBe(95);
    clock.advance(STEP_MS);
    await run;
    expect(done).toHaveBeenCalledWith("installed");
    expect(heard.at(-1)).toMatchObject({ state: "ready", done: heard.at(-1)!.total });
    expect(plugins.isInstalled("latex")).toBe(true);
    expect(changed).toHaveBeenCalledWith("latex");
    expect(DOWNLOAD_STEPS * STEP_MS).toBe(2000);
  });

  it("stops a download that is cancelled", async () => {
    const { plugins, clock, heard } = make();
    await plugins.onPayload((event) => heard.push(event));
    const run = plugins.install("latex");
    clock.advance(STEP_MS * 3);
    await plugins.cancel("latex");
    expect(await run).toBe("cancelled");
    expect(heard.at(-1)!.state).toBe("cancelled");
    clock.advance(STEP_MS * 40);
    expect(plugins.isInstalled("latex")).toBe(false);
  });

  it("removes a download and goes back to where a recording starts", async () => {
    const { plugins } = make();
    await plugins.remove("diagrams");
    expect(plugins.isInstalled("diagrams")).toBe(false);
    await plugins.setEnabled("browser", true);
    plugins.reset();
    expect(plugins.isInstalled("diagrams")).toBe(true);
    expect(plugins.isOn("browser")).toBe(false);
  });
});
