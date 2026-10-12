import { describe, expect, it } from "vitest";

import { bytesOfDataUri, configure, encode, exportPicture, exportPng, frameUrl, fromFrame, load, outsideLink, pageLink, parseEvent, textOfDataUri } from "./protocol";

describe("the frame's address", () => {
  it("asks for the embed protocol, offline, with no buttons of the editor's own, in the app's theme", () => {
    const url = new URL(frameUrl("http://diagrams.localhost/index.html", { dark: true }));
    expect(url.origin + url.pathname).toBe("http://diagrams.localhost/index.html");
    const q = url.searchParams;
    expect([q.get("embed"), q.get("proto"), q.get("configure"), q.get("offline"), q.get("spin"), q.get("libraries")]).toEqual(["1", "json", "1", "1", "1", "1"]);
    expect([q.get("noSaveBtn"), q.get("noExitBtn"), q.get("saveAndExit")]).toEqual(["1", "1", "0"]);
    expect([q.get("dark"), q.get("ui"), q.get("lang")]).toEqual(["1", "kennedy", "en"]);
    const light = new URL(frameUrl("diagrams://localhost/index.html", { dark: false, ui: "min", lang: "de" }));
    expect([light.searchParams.get("dark"), light.searchParams.get("ui"), light.searchParams.get("lang")]).toEqual(["0", "min", "de"]);
  });
});

describe("messages from the editor", () => {
  it("are read from the JSON text the editor posts", () => {
    expect(parseEvent('{"event":"configure"}')).toEqual({ event: "configure" });
    expect(parseEvent('{"event":"init"}')).toEqual({ event: "init" });
    expect(parseEvent('{"event":"load","bounds":{"x":0}}')).toEqual({ event: "load" });
    expect(parseEvent('{"event":"autosave","xml":"<mxfile/>","patch":{}}')).toEqual({ event: "autosave", xml: "<mxfile/>" });
    expect(parseEvent('{"event":"save","xml":"<a/>","exit":true}')).toEqual({ event: "save", xml: "<a/>", exit: true });
    expect(parseEvent('{"event":"save","xml":"<a/>"}')).toEqual({ event: "save", xml: "<a/>", exit: false });
    expect(parseEvent('{"event":"exit","modified":true}')).toEqual({ event: "exit", modified: true });
    expect(parseEvent('{"event":"export","format":"xmlsvg","data":"data:image/svg+xml;base64,AAAA","xml":"<a/>"}')).toEqual({ event: "export", format: "xmlsvg", data: "data:image/svg+xml;base64,AAAA", xml: "<a/>" });
    expect(parseEvent('{"event":"openLink","href":"https://example.com","target":"_blank","allowOpener":true}')).toEqual({ event: "openLink", href: "https://example.com", target: "_blank" });
    expect(parseEvent('{"event":"status","message":"Saved","modified":false}')).toEqual({ event: "status", message: "Saved", modified: false });
    expect(parseEvent('{"event":"template","xml":"<a/>","name":"Flow","blank":false}')).toEqual({ event: "template", xml: "<a/>", name: "Flow" });
  });

  it("are dropped when they are not the protocol's", () => {
    for (const bad of [null, undefined, 4, "", "hello", "{nope", "[]", "[1]", '{"event":"unknown"}', '{"action":"load"}', '{"event":"autosave"}', '{"event":"autosave","xml":4}', '{"event":"openLink"}', {}, []]) {
      expect(parseEvent(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("are read from an object too, as a test or another host may hand it over", () => {
    expect(parseEvent({ event: "autosave", xml: "<a/>" })).toEqual({ event: "autosave", xml: "<a/>" });
  });
});

describe("messages to the editor", () => {
  it("answer configure with plain XML and links handed to the app", () => {
    const sent = JSON.parse(encode(configure()));
    expect(sent).toEqual({ action: "configure", config: { compressXml: false, suppressNewWindows: true } });
  });

  it("answer init with the diagram, saved as it changes, in the app's theme", () => {
    expect(JSON.parse(encode(load("<mxfile/>", true)))).toEqual({ action: "load", xml: "<mxfile/>", autosave: 1, dark: 1 });
    expect(JSON.parse(encode(load("<mxfile/>", false, { title: "Flow" })))).toEqual({ action: "load", xml: "<mxfile/>", autosave: 1, dark: 0, title: "Flow" });
    expect(JSON.parse(encode(load("<mxfile/>", false, { autosave: false })))).toEqual({ action: "load", xml: "<mxfile/>", autosave: 0, dark: 0 });
  });

  it("ask for the picture with the diagram inside it, images embedded", () => {
    // The light drawing, whatever the editor's own mood: otherwise its colours follow the viewer's theme.
    expect(JSON.parse(encode(exportPicture()))).toEqual({ action: "export", format: "xmlsvg", embedImages: true, border: 10, background: "#ffffff", theme: "light" });
    expect(JSON.parse(encode(exportPng()))).toEqual({ action: "export", format: "png", scale: 2, border: 10, background: "#ffffff" });
  });
});

describe("what an export holds", () => {
  it("is read from a base64 or a percent-encoded data URI as UTF-8", () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>Grüße 日本</text></svg>';
    const base64 = btoa(String.fromCharCode(...new TextEncoder().encode(svg)));
    expect(textOfDataUri(`data:image/svg+xml;base64,${base64}`)).toBe(svg);
    expect(textOfDataUri(`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`)).toBe(svg);
    expect(textOfDataUri("data:image/svg+xml;base64,!!!")).toBeNull();
    expect(textOfDataUri("<svg/>")).toBeNull();
    expect(textOfDataUri("data:text/plain,%E0%A4%A")).toBeNull();
  });

  it("gives a PNG's bytes", () => {
    expect([...(bytesOfDataUri(`data:image/png;base64,${btoa("\x89PNG")}`) ?? [])]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(bytesOfDataUri("data:image/png,abc")).toBeNull();
    expect(bytesOfDataUri("nope")).toBeNull();
  });
});

describe("where a message came from", () => {
  const frame = {} as Window;
  const other = {} as Window;
  it("is the frame's own window at the origin the editor is served from", () => {
    expect(fromFrame({ source: frame, origin: "http://diagrams.localhost" }, frame, "http://diagrams.localhost")).toBe(true);
    expect(fromFrame({ source: other, origin: "http://diagrams.localhost" }, frame, "http://diagrams.localhost")).toBe(false);
    expect(fromFrame({ source: frame, origin: "http://evil.example" }, frame, "http://diagrams.localhost")).toBe(false);
    expect(fromFrame({ source: frame, origin: "null" }, frame, "http://diagrams.localhost")).toBe(false);
    expect(fromFrame({ source: null, origin: "http://diagrams.localhost" }, frame, "http://diagrams.localhost")).toBe(false);
    expect(fromFrame({ source: frame, origin: "http://diagrams.localhost" }, null, "http://diagrams.localhost")).toBe(false);
  });

  it("may read as null only for the editor's custom scheme", () => {
    expect(fromFrame({ source: frame, origin: "null" }, frame, "diagrams://localhost")).toBe(true);
    expect(fromFrame({ source: frame, origin: "diagrams://localhost" }, frame, "diagrams://localhost")).toBe(true);
    expect(fromFrame({ source: frame, origin: "https://evil.example" }, frame, "diagrams://localhost")).toBe(false);
  });
});

describe("a link in a diagram", () => {
  it("goes to the system's browser only when it is a web or mail address", () => {
    expect(outsideLink("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(outsideLink(" http://example.com ")).toBe("http://example.com/");
    expect(outsideLink("mailto:me@example.com")).toBe("mailto:me@example.com");
    for (const bad of ["javascript:alert(1)", "file:///etc/passwd", "data:text/html,x", "diagrams://localhost/", "tauri://localhost/", "not a link", "[[Page]]", ""]) {
      expect(outsideLink(bad), bad).toBeNull();
    }
  });

  it("names a page when it is written as one", () => {
    expect(pageLink("[[Trip plan]]")).toBe("Trip plan");
    expect(pageLink(" [[Trip plan#Budget|the plan]] ")).toBe("Trip plan");
    expect(pageLink("[[projects/trip/pages/plan|Plan]]")).toBe("projects/trip/pages/plan");
    for (const bad of ["Trip plan", "[[]]", "[[a]] and [[b]]", "https://example.com", "[[a"]) expect(pageLink(bad), bad).toBeNull();
  });
});
