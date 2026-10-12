import { describe, expect, it } from "vitest";

import { absoluteAddress, hostName, isAddress, markdownLink } from "./address";

describe("isAddress", () => {
  it("is a web address on its own, with its scheme or www.", () => {
    expect(isAddress("https://example.com/a?b=1")).toBe(true);
    expect(isAddress("http://news.example.org")).toBe(true);
    expect(isAddress(" www.example.org/guide ")).toBe(true);
  });

  it("is not text with an address in it, or a file", () => {
    expect(isAddress("notes.md")).toBe(false);
    expect(isAddress("see https://example.com later")).toBe(false);
    expect(isAddress("Call Ada")).toBe(false);
    expect(isAddress("https://localhost")).toBe(false);
    expect(isAddress("")).toBe(false);
  });
});

describe("absoluteAddress", () => {
  it("adds https to a bare www. address and leaves the rest", () => {
    expect(absoluteAddress("www.example.org/a")).toBe("https://www.example.org/a");
    expect(absoluteAddress(" http://example.com/x ")).toBe("http://example.com/x");
  });
});

describe("hostName", () => {
  it("is the site without www.", () => {
    expect(hostName("https://www.example.org/guide?x=1")).toBe("example.org");
    expect(hostName("www.nytimes.com/section")).toBe("nytimes.com");
    expect(hostName("https://docs.example.org:8080/a")).toBe("docs.example.org");
  });

  it("is the text itself when it is no address", () => {
    expect(hostName("not an address")).toBe("not an address");
  });
});

describe("markdownLink", () => {
  it("writes the title and the address as a link", () => {
    expect(markdownLink("A good read", "https://example.org/a")).toBe("[A good read](https://example.org/a)");
    expect(markdownLink("Guide", "www.example.org/g")).toBe("[Guide](https://www.example.org/g)");
  });

  it("falls back to the host with no title, and keeps brackets and parentheses from ending the link", () => {
    expect(markdownLink("", "https://www.example.org/a")).toBe("[example.org](https://www.example.org/a)");
    expect(markdownLink("   ", "https://example.org/a")).toBe("[example.org](https://example.org/a)");
    expect(markdownLink("Notes [draft]\nline", "https://example.org/a_(b)")).toBe("[Notes \\[draft\\] line](https://example.org/a_%28b%29)");
  });
});
