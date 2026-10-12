import { describe, expect, it } from "vitest";

import { interpret, siteOf } from "./address";
import { ENGINES, validEngineUrl } from "./prefs";

const google = ENGINES[0]!;

describe("what the address box makes of what was typed", () => {
  it("goes to an address, adding the scheme where it was left out", () => {
    expect(interpret("https://example.com/a?b=c", google)).toEqual({ url: "https://example.com/a?b=c" });
    expect(interpret("example.com", google)).toEqual({ url: "https://example.com" });
    expect(interpret("  www.example.co.uk/path#x ", google)).toEqual({ url: "https://www.example.co.uk/path#x" });
    expect(interpret("news.example.org:8443/x", google)).toEqual({ url: "https://news.example.org:8443/x" });
  });

  it("goes to a server on this computer or the local network over plain http", () => {
    expect(interpret("localhost:3000", google)).toEqual({ url: "http://localhost:3000" });
    expect(interpret("127.0.0.1:8080/app", google)).toEqual({ url: "http://127.0.0.1:8080/app" });
    expect(interpret("192.168.1.20/admin", google)).toEqual({ url: "http://192.168.1.20/admin" });
    expect(interpret("printer.local", google)).toEqual({ url: "http://printer.local" });
  });

  it("searches for anything else, with the words made safe", () => {
    expect(interpret("how to take smart notes", google)).toEqual({ url: "https://www.google.com/search?q=how%20to%20take%20smart%20notes" });
    expect(interpret("a&b=c d", ENGINES[1]!)).toEqual({ url: "https://duckduckgo.com/?q=a%26b%3Dc%20d" });
    // One word that is no address is a search too.
    expect(interpret("kasten", google)).toEqual({ url: "https://www.google.com/search?q=kasten" });
    expect(interpret("example.com is down", google)).toEqual({ url: "https://www.google.com/search?q=example.com%20is%20down" });
  });

  it("opens web pages only, and nothing with a password in it", () => {
    for (const bad of ["file:///C:/Windows/win.ini", "javascript:alert(1)", "data:text/html,hi", "about:blank", "ftp://example.com", "tauri://localhost/", "asset://localhost/x", "view-source:https://example.com", "https://user:pw@example.com/"]) {
      expect(interpret(bad, google), bad).toHaveProperty("error");
    }
    expect(interpret("   ", google)).toHaveProperty("error");
    expect(interpret("https://exa mple.com", google)).toHaveProperty("error");
  });

  it("names the site a tab shows", () => {
    expect(siteOf("https://www.example.com/a")).toBe("example.com");
    expect(siteOf("http://localhost:3000/")).toBe("localhost");
    expect(siteOf(undefined)).toBe("");
  });

  it("takes a search address with its words marked once", () => {
    expect(validEngineUrl("https://kagi.com/search?q=%s")).toBe(true);
    expect(validEngineUrl("https://kagi.com/search")).toBe(false);
    expect(validEngineUrl("https://a.com/%s/%s")).toBe(false);
    expect(validEngineUrl("javascript:%s")).toBe(false);
    expect(validEngineUrl("https://a.com/ %s")).toBe(false);
  });
});
