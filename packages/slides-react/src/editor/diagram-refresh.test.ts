// A picture of a diagram that changed since the picture was drawn: the editor
// finds it (the host knows the diagram's revision), and Refresh swaps in a new
// picture, one step of undo. A picture the person worked on (cropped, described)
// is not overwritten without asking: Refresh can keep their work.

import { describe, expect, it, vi } from "vitest";

import { newDeck } from "../test/engine.ts";
import { DIAGRAM_KEY, REVISION_KEY, diagramOf, editedLocally, insertDiagram, pictureName, revisionOf } from "./diagrams.ts";
import { refreshDiagram, staleDiagrams } from "./diagram-refresh.ts";
import type { DiagramPicture, SlidesHost } from "./host.ts";
import { EditorSession } from "./session/session.ts";

/** The part of the picture that shows: a tenth cut from each edge. */
const CROP = { left: 0.1, top: 0.1, right: 0.1, bottom: 0.1 };
const OLD: DiagramPicture = { path: "assets/flow.png", source: "library/Flow.drawio", name: "Flow", width: 1200, height: 800, rev: "r1" };
const NEW: DiagramPicture = { path: "assets/flow-2.png", source: "library/Flow.drawio", name: "Flow", width: 1200, height: 1200, rev: "r2" };

function hostWith(extra: Partial<SlidesHost>): SlidesHost & { notices: string[] } {
  const notices: string[] = [];
  return { save: async () => ({ status: "saved" }), imageUrl: () => undefined, addImage: async (name) => `assets/${name}`, deliver: async () => {}, notify: (message) => void notices.push(message), notices, ...extra };
}

async function open(extra: Partial<SlidesHost> = {}) {
  const host = hostWith(extra);
  const session = new EditorSession(await newDeck("Talk"), host, { saveDelay: 10_000 });
  return { host, session };
}

/** A slide with one picture of the diagram, drawn at revision r1. */
async function withPicture(extra: Partial<SlidesHost> = {}, picture: DiagramPicture = OLD) {
  const opened = await open(extra);
  const id = (await insertDiagram(opened.session, picture))!;
  return { ...opened, id };
}

const element = (session: EditorSession, id: string) => session.slide.elements.find((e) => e.id === id)!;

describe("a picture knows which version of its diagram it shows", () => {
  it("keeps the revision with the picture, in the deck's text, and not when the host gave none", async () => {
    const { session, id } = await withPicture();
    expect(revisionOf(element(session, id))).toBe("r1");
    expect(session.core.save()).toMatch(/"x-diagram-rev": ?"r1"/);
    const plain = await open();
    const bare = (await insertDiagram(plain.session, { ...OLD, rev: undefined }))!;
    expect(revisionOf(plain.session.slide.elements.find((e) => e.id === bare))).toBeUndefined();
    expect(REVISION_KEY).toBe("x-diagram-rev");
  });

  it("is edited locally when it is cropped or its description was written by hand", async () => {
    const { session, id } = await withPicture();
    expect(editedLocally(element(session, id))).toBe(false);
    session.elements.patch({ alt: "The login flow, with the token step highlighted" }, [id]);
    expect(editedLocally(element(session, id))).toBe(true);
    session.elements.patch({ alt: "Diagram: Flow", crop: CROP }, [id]);
    expect(editedLocally(element(session, id))).toBe(true);
    // The name comes from the generated description, else from the diagram's file.
    expect(pictureName(element(session, id), OLD.source)).toBe("Flow");
    session.elements.patch({ alt: "My words" }, [id]);
    expect(pictureName(element(session, id), "library/Login-flow.drawio")).toBe("Login-flow");
  });
});

describe("finding the pictures that are out of date", () => {
  it("lists a picture whose diagram has another revision now, saying whether the person worked on it", async () => {
    const { session, id } = await withPicture({ diagramRevision: async () => "r2" });
    expect(await staleDiagrams(session)).toEqual([{ id, source: OLD.source, name: "Flow", edited: false }]);
    session.elements.patch({ crop: CROP }, [id]);
    expect((await staleDiagrams(session))[0]).toMatchObject({ id, edited: true });
  });

  it("lists nothing when the revision is the same, when the host does not know it, or when the picture has no revision", async () => {
    const same = await withPicture({ diagramRevision: async () => "r1" });
    expect(await staleDiagrams(same.session)).toEqual([]);
    const unknown = await withPicture({ diagramRevision: async () => undefined });
    expect(await staleDiagrams(unknown.session)).toEqual([]);
    const noRev = await withPicture({ diagramRevision: async () => "r2" }, { ...OLD, rev: undefined });
    expect(await staleDiagrams(noRev.session)).toEqual([]);
    const noHook = await withPicture({});
    expect(await staleDiagrams(noHook.session)).toEqual([]);
  });

  it("asks the host once for each diagram, and says nothing of a picture whose revision cannot be read", async () => {
    const asked = vi.fn(async (source: string) => {
      if (source === "library/Gone.drawio") throw new Error("gone");
      return "r2";
    });
    const { session, id } = await withPicture({ diagramRevision: asked });
    const twin = (await insertDiagram(session, OLD))!;
    const gone = (await insertDiagram(session, { ...OLD, source: "library/Gone.drawio" }))!;
    const stale = await staleDiagrams(session);
    expect(stale.map((s) => s.id).sort()).toEqual([id, twin].sort());
    expect(stale.some((s) => s.id === gone)).toBe(false);
    expect(asked.mock.calls.map((c) => c[0]).sort()).toEqual(["library/Flow.drawio", "library/Gone.drawio"]);
  });
});

describe("Refresh", () => {
  it("draws the diagram again and swaps the picture in place, width kept, as one step of undo", async () => {
    const draw = vi.fn(async () => NEW);
    const { session, id } = await withPicture({ drawDiagram: draw });
    const slideId = session.state.slideId;
    const before = element(session, id);
    expect(await refreshDiagram(session, slideId, id, "replace")).toBe(true);
    expect(draw).toHaveBeenCalledWith("library/Flow.drawio");
    const after = element(session, id);
    expect(after).toMatchObject({ src: "assets/flow-2.png", x: before.x, y: before.y, w: before.w, [DIAGRAM_KEY]: "library/Flow.drawio", [REVISION_KEY]: "r2" });
    expect(after.h).toBeCloseTo(before.w!, 0);
    session.undo();
    expect(element(session, id)).toMatchObject({ src: "assets/flow.png", [REVISION_KEY]: "r1" });
  });

  it("replaces the crop and the description too when asked to replace, and keeps them when asked to keep", async () => {
    const crop = CROP;
    const mine = async () => {
      const opened = await withPicture({ drawDiagram: async () => NEW });
      opened.session.elements.patch({ crop, alt: "My own words" }, [opened.id]);
      return opened;
    };
    const replaced = await mine();
    await refreshDiagram(replaced.session, replaced.session.state.slideId, replaced.id, "replace");
    expect(element(replaced.session, replaced.id)).toMatchObject({ src: "assets/flow-2.png", alt: "Diagram: Flow" });
    expect((element(replaced.session, replaced.id) as { crop?: unknown }).crop ?? null).toBeNull();
    const kept = await mine();
    const width = element(kept.session, kept.id).w;
    await refreshDiagram(kept.session, kept.session.state.slideId, kept.id, "keep");
    expect(element(kept.session, kept.id)).toMatchObject({ src: "assets/flow-2.png", alt: "My own words", crop, w: width, [REVISION_KEY]: "r2" });
  });

  it("does nothing, and says why, when the host cannot draw it", async () => {
    const { session, id, host } = await withPicture({
      drawDiagram: async () => {
        throw new Error("Install the diagram editor to draw it");
      },
    });
    expect(await refreshDiagram(session, session.state.slideId, id, "replace")).toBe(false);
    expect(host.notices).toEqual(["Install the diagram editor to draw it"]);
    expect(element(session, id)).toMatchObject({ src: "assets/flow.png" });
  });

  it("does not put the picture on a slide the person moved to meanwhile", async () => {
    let finish: (picture: DiagramPicture | null) => void = () => {};
    const { session, id, host } = await withPicture({ drawDiagram: () => new Promise<DiagramPicture | null>((resolve) => (finish = resolve)) });
    const slideId = session.state.slideId;
    const refreshing = refreshDiagram(session, slideId, id, "replace");
    session.slides.add({ layout: "blank" });
    finish(NEW);
    expect(await refreshing).toBe(false);
    expect(host.notices.at(-1)).toMatch(/slide changed/);
    expect(session.deck.slides[0]!.elements.find((e) => e.id === id)).toMatchObject({ src: "assets/flow.png" });
  });

  it("is a picture of a diagram only: a plain picture is not touched", async () => {
    const { session, host } = await open({ drawDiagram: async () => NEW });
    const [plain] = session.elements.insert([{ type: "image", id: "", src: "assets/x.png", x: 0, y: 0, w: 10, h: 10 } as never]) as [string];
    expect(diagramOf(element(session, plain))).toBeUndefined();
    expect(await refreshDiagram(session, session.state.slideId, plain, "replace")).toBe(false);
    expect(host.notices).toEqual([]);
  });
});
