// A plugin that will not load says so on its card; it does not sit there
// "on" and doing nothing.

import { beforeEach, describe, expect, it } from "vitest";

import { usePlugins } from "./registry";
import type { CatalogEntry } from "./types";

const broken: CatalogEntry = {
  manifest: { id: "broken", name: "Broken", summary: "Fails to load.", icon: "plug", version: "1.0.0", defaultOn: false, scope: "vault" },
  load: async () => Promise.reject(new Error("chunk failed")),
};
const fine: CatalogEntry = { manifest: { ...broken.manifest, id: "fine", name: "Fine" }, load: async () => ({}) };

beforeEach(() => usePlugins.setState({ enabled: [], loaded: {}, problem: {}, on: {} }));

describe("turning on a plugin that cannot load", () => {
  it("leaves it off and says why on its card", async () => {
    await usePlugins.getState().setEnabled("broken", true, [broken]);
    expect(usePlugins.getState().enabled).toEqual([]);
    expect(usePlugins.getState().problem["broken"]).toMatch(/could not be loaded/);
  });

  it("clears the word once it loads", async () => {
    await usePlugins.getState().setEnabled("broken", true, [broken]);
    const mended: CatalogEntry = { ...broken, load: async () => ({}) };
    await usePlugins.getState().setEnabled("broken", true, [mended]);
    expect(usePlugins.getState().problem["broken"]).toBe("");
    expect(usePlugins.getState().enabled).toEqual(["broken"]);
  });

  it("says nothing for one that loads", async () => {
    await usePlugins.getState().setEnabled("fine", true, [fine]);
    expect(usePlugins.getState().problem["fine"]).toBe("");
  });
});
