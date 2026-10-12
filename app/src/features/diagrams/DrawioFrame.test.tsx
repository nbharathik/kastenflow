// The editor's frame: sandboxed, on the editor's own page, and only the frame
// itself is listened to. What it says goes to the session, which keeps the
// diagram saved; a link in a diagram goes to the system's browser or a page.

import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryVault } from "../workspace/preview/memory-vault";
import { useWorkspace } from "../workspace/store";
import { DrawioFrame, FRAME_SANDBOX, followLink } from "./DrawioFrame";
import { useDiagramEditor, type EditorInfo } from "./editor";
import { useDiagramHost } from "./host-store";
import { encode, configure, load } from "./protocol";

const INSTALLED: EditorInfo = { version: "32.2.0", bytes: 48_235_802, url: "https://example.test/draw.war", installed: true, busy: false };
const MISSING: EditorInfo = { ...INSTALLED, installed: false };
const PAGE = () => `${window.location.origin}/diagrams-stub/index.html`;

const withBox = (xml: string) => xml.replace("</root>", '<mxCell id="2" value="Box" vertex="1" parent="1"><mxGeometry x="10" y="10" width="80" height="40" as="geometry"/></mxCell></root>');

let vault: MemoryVault;
let path: string;
let file: { path: string; xml: string; hash: string };

async function setup(info: EditorInfo = INSTALLED) {
  vault = new MemoryVault({});
  path = await vault.createDiagram("Flow", null);
  const read = await vault.diagram(path);
  file = { path, xml: read.xml, hash: read.hash };
  useDiagramEditor.setState({ info });
  await useWorkspace.getState().connect({ client: vault });
}

/** Renders the frame and gives the window it holds, with its postMessage recorded. */
function mount(props: Partial<Parameters<typeof DrawioFrame>[0]> = {}) {
  const view = render(<DrawioFrame file={file} title="Flow" {...props} />);
  const frame = view.container.querySelector("iframe");
  const sent: string[] = [];
  if (frame?.contentWindow) vi.spyOn(frame.contentWindow, "postMessage").mockImplementation(((message: unknown) => void sent.push(String(message))) as Window["postMessage"]);
  return { ...view, frame, sent };
}

/** One message as the window hears it, from `source` and `origin`. */
function say(data: unknown, source: unknown, origin = window.location.origin) {
  const event = new MessageEvent("message", { data: typeof data === "string" ? data : JSON.stringify(data), origin });
  Object.defineProperty(event, "source", { value: source });
  act(() => void window.dispatchEvent(event));
}

beforeEach(() => {
  useDiagramHost.setState({ modal: null, queue: [], seen: [], editing: [] });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("the editor's frame", () => {
  it("is a sandboxed frame on the editor's own page, with the embed parameters and no referrer", async () => {
    await setup();
    const { frame } = mount();
    expect(frame).not.toBeNull();
    expect(frame!.getAttribute("sandbox")).toBe(FRAME_SANDBOX);
    expect(FRAME_SANDBOX).not.toMatch(/top-navigation/);
    expect(frame!.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(frame!.getAttribute("title")).toBe("Flow");
    const src = frame!.getAttribute("src")!;
    expect(src.startsWith(`${PAGE()}?embed=1&proto=json&configure=1&offline=1`)).toBe(true);
    expect(src).toContain("noSaveBtn=1");
    expect(src).toContain("ui=kennedy");
  });

  it("is nothing at all while the editor is not installed", async () => {
    await setup(MISSING);
    const { container } = mount();
    expect(container.querySelector("iframe")).toBeNull();
  });

  it("can be kept off screen, out of the tab order and away from screen readers", async () => {
    await setup();
    const { frame } = mount({ hidden: true });
    expect(frame!.getAttribute("aria-hidden")).toBe("true");
    expect(frame!.tabIndex).toBe(-1);
    expect(frame!.className).toBe("kasten-diagram-hidden");
  });

  it("answers configure and init the way the editor asked: plain XML, the diagram, saving as it changes", async () => {
    await setup();
    const { frame, sent } = mount();
    const win = frame!.contentWindow;
    say({ event: "configure" }, win);
    say({ event: "init" }, win);
    expect(sent).toEqual([encode(configure()), encode(load(file.xml, false))]);
    expect(sent[0]).toContain('"compressXml":false');
    expect(useDiagramHost.getState().editing).toEqual([path]);
  });

  it("posts only to the editor's own origin", async () => {
    await setup();
    const { frame } = mount();
    const spy = frame!.contentWindow!.postMessage as unknown as ReturnType<typeof vi.fn>;
    say({ event: "configure" }, frame!.contentWindow);
    expect(spy).toHaveBeenCalledWith(encode(configure()), window.location.origin);
  });

  it("hears nobody but the frame: not another window, not another origin, not what is not the protocol", async () => {
    await setup();
    const { frame, sent } = mount();
    say({ event: "init" }, window);
    say({ event: "init" }, frame!.contentWindow, "https://evil.example");
    say({ event: "init" }, null);
    say("not json", frame!.contentWindow);
    say({ event: "somethingElse" }, frame!.contentWindow);
    expect(sent).toEqual([]);
    say({ event: "init" }, frame!.contentWindow);
    expect(sent).toHaveLength(1);
  });

  it("writes what was drawn when the frame goes away, and stops being the one editing it", async () => {
    await setup();
    const { frame, unmount } = mount();
    const win = frame!.contentWindow;
    say({ event: "init" }, win);
    say({ event: "load" }, win);
    const drawn = withBox(file.xml);
    say({ event: "autosave", xml: drawn }, win);
    unmount();
    await waitFor(async () => expect((await vault.diagram(path)).xml).toContain('value="Box"'));
    expect(useDiagramHost.getState().editing).toEqual([]);
  });

  it("tells a render frame's owner when the picture was drawn", async () => {
    await setup();
    const done = vi.fn();
    const { frame } = mount({ mode: "render", hidden: true, onDone: done });
    const win = frame!.contentWindow;
    say({ event: "init" }, win);
    say({ event: "load" }, win);
    // The editor was asked for the picture; it answers with the SVG as a data URI.
    await waitFor(() => expect((win!.postMessage as unknown as ReturnType<typeof vi.fn>).mock.calls.some((c) => String(c[0]).includes('"export"'))).toBe(true));
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="81px" height="41px"><defs/><g/></svg>';
    say({ event: "export", format: "xmlsvg", data: `data:image/svg+xml;base64,${btoa(svg)}`, xml: file.xml }, win);
    await waitFor(() => expect(done).toHaveBeenCalledWith(true));
    expect((await vault.diagram(path)).preview).toBe("fresh");
    // A render frame is not an editor: nothing marks the diagram as being edited.
    expect(useDiagramHost.getState().editing).toEqual([]);
  });
});

describe("a link in a diagram", () => {
  it("opens a web or mail address outside the app, and nothing else that is not a page", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    followLink("https://example.com/a?b=1");
    followLink("mailto:me@example.com");
    followLink("javascript:alert(1)");
    followLink("file:///etc/passwd");
    followLink("ftp://example.com/");
    followLink("");
    expect(open.mock.calls.map((c) => c[0])).toEqual(["https://example.com/a?b=1", "mailto:me@example.com"]);
    expect(open.mock.calls[0]![2]).toContain("noopener");
  });

  it("opens a [[Page]] link as that page", () => {
    const openTitle = vi.fn();
    useWorkspace.setState({ openTitle } as never);
    followLink("[[Trip plan#Hotels|the hotels]]");
    expect(openTitle).toHaveBeenCalledWith("Trip plan");
  });
});
