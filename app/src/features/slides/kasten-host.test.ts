import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setDemoForTests } from "../../demo/flag";
import type { VaultClient } from "../../lib/vault/types";
import { fillShowScreen, presentScreens } from "../../lib/present-screen";
import { windowCovered } from "../browser/cover";
import { useOcclusion } from "../browser/occlusion";
import { SHOW_HOLD, showing } from "../browser/show";
import { kastenHost } from "./kasten-host";
import { allowEmbeds } from "./presenter-link";

const desktop = vi.hoisted(() => ({ on: false }));

vi.mock("../../lib/api", async (original) => ({ ...(await original<typeof import("../../lib/api")>()), inTauri: () => desktop.on }));
vi.mock("./presenter-link", () => ({ allowEmbeds: vi.fn(() => Promise.resolve(0)), embeddedPages: () => ["https://example.com/talk"], openTauriPresenter: vi.fn() }));
// The assistant tab is the chat's, and none of what is tested here.
vi.mock("./AiTab", () => ({ AiTab: () => null }));

const DECKS = [
  { path: "decks/a.deck", title: "Alpha", slides: 4, problem: null },
  { path: "decks/broken.deck", title: "Broken", slides: 0, problem: "not a deck" },
  { path: "decks/b.deck", title: "Beta", slides: 9, problem: null },
];

const client = {
  decks: () => Promise.resolve(DECKS),
  deck: (id: string) => Promise.resolve({ path: id, text: `text of ${id}`, hash: "h" }),
} as unknown as VaultClient;

const host = () => kastenHost(client, "decks/a.deck", "h", () => {});

beforeEach(() => {
  desktop.on = false;
  vi.mocked(allowEmbeds).mockClear();
});

afterEach(() => vi.restoreAllMocks());

describe("the other decks, for Import layouts", () => {
  it("lists the decks of the vault that open, as their path, title and size", async () => {
    expect(await host().decks!.list()).toEqual([
      { id: "decks/a.deck", title: "Alpha", slides: 4 },
      { id: "decks/b.deck", title: "Beta", slides: 9 },
    ]);
  });

  it("reads one as the text of its file", async () => {
    expect(await host().decks!.read("decks/b.deck")).toBe("text of decks/b.deck");
  });
});

describe("diagrams on a slide", () => {
  it("tells the version a diagram is at, draws it again without its editor, and hears of changes", async () => {
    const diagrams = { ...client, diagram: (path: string) => (path === "library/Flow.drawio" ? Promise.resolve({ path, xml: "", hash: "v7", modified: 1, preview: "fresh" }) : Promise.reject(new Error("gone"))) } as unknown as VaultClient;
    const h = kastenHost(diagrams, "decks/a.deck", "h", () => {});
    expect(typeof h.pickDiagram).toBe("function");
    expect(typeof h.editDiagram).toBe("function");
    expect(await h.diagramRevision!("library/Flow.drawio")).toBe("v7");
    expect(await h.diagramRevision!("library/Gone.drawio")).toBeUndefined();
    expect(typeof h.drawDiagram).toBe("function");
    expect(typeof h.watchDiagrams!(() => {})).toBe("function");
  });
});

describe("the web preview", () => {
  it("is the browser's native view in the desktop app, and is left out in a browser, where a frame serves", () => {
    expect(host().webPreview).toBeUndefined();
    desktop.on = true;
    const preview = host().webPreview;
    expect(preview).toBeDefined();
    expect(typeof preview!.open).toBe("function");
    expect(typeof preview!.turnOn).toBe("function");
  });

  it("is offered in the promo demo too, where stand-in views serve it", () => {
    setDemoForTests(true);
    try {
      expect(typeof host().webPreview?.open).toBe("function");
    } finally {
      setDemoForTests(null);
    }
  });
});

describe("presenting in the desktop app", () => {
  it("lets the deck's pages load, and keeps a web link from making a browser tab beneath the show", async () => {
    desktop.on = true;
    const finish = await host().willPresent!({} as never);
    expect(allowEmbeds).toHaveBeenLastCalledWith(["https://example.com/talk"]);
    expect(windowCovered()).toBe(true);
    (finish as () => void)();
    expect(allowEmbeds).toHaveBeenLastCalledWith([]);
    expect(windowCovered()).toBe(false);
  });

  it("gives the window back when the pages cannot be allowed", async () => {
    desktop.on = true;
    vi.mocked(allowEmbeds).mockRejectedValueOnce(new Error("no"));
    await expect(host().willPresent!({} as never)).rejects.toThrow("no");
    expect(windowCovered()).toBe(false);
    expect(showing()).toBe(false);
    expect(useOcclusion.getState().holds[SHOW_HOLD]).toBeUndefined();
  });

  it("holds the whole window while the show lasts, so no native web view paints above it, and lets go when it ends", async () => {
    desktop.on = true;
    const finish = await host().willPresent!({} as never);
    expect(showing()).toBe(true);
    expect(useOcclusion.getState().holds[SHOW_HOLD]).toBe("all");
    (finish as () => void)();
    expect(showing()).toBe(false);
    expect(useOcclusion.getState().holds[SHOW_HOLD]).toBeUndefined();
  });

  it("fills the screen through the display choice, and offers the choice of displays", async () => {
    desktop.on = true;
    const h = host();
    expect(h.fillScreen).toBe(fillShowScreen);
    expect(h.screens).toBe(presentScreens);
  });

  it("has no choice of displays in a browser", () => {
    expect(host().screens).toBeUndefined();
  });
});
