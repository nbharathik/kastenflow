import { describe, expect, it } from "vitest";

import { frontUrl, urlKey } from "./url-key";

describe("urlKey", () => {
  it("is one key for every way of writing one page", () => {
    const same = [
      ["https://example.com/guide", "http://example.com/guide", "HTTPS://EXAMPLE.COM/guide", "https://www.example.com/guide", "https://example.com:443/guide", "http://example.com:80/guide", "https://example.com/guide/", "https://example.com/guide#section-2", "https://example.com/guide/?utm_source=news&utm_medium=email", "https://example.com/guide?fbclid=abc&gclid=def&mc_cid=1&mc_eid=2", "  https://example.com/guide  "],
      ["https://example.com/", "https://example.com", "http://www.example.com/#top", "https://example.com/?utm_campaign=x"],
      ["https://example.com/s?b=2&a=1", "https://example.com/s?a=1&b=2", "https://example.com/s/?a=1&b=2&UTM_Source=z#x"],
      ["http://[::1]:8080/x", "https://[::1]:8080/x/"],
    ];
    for (const group of same) {
      const keys = group.map(urlKey);
      expect(keys[0], String(group)).not.toBeNull();
      for (const key of keys) expect(key).toBe(keys[0]);
    }
  });

  it("tells different pages apart", () => {
    const all = ["https://example.com/guide", "https://example.com/Guide", "https://example.com/guide/two", "https://example.org/guide", "https://news.example.com/guide", "https://example.com:8443/guide", "http://example.com:443/guide", "https://example.com/guide?page=2", "https://example.com/guide?page=3", "https://example.com/guide?page", "https://example.com/", "https://example.com/?q=1"];
    expect(new Set(all.map(urlKey)).size).toBe(all.length);
  });

  it("is host, port, path and sorted query", () => {
    expect(urlKey("https://www.Example.com:443/A/b/?z=1&utm_x=2&a=%20&fbclid=q#f")).toBe("example.com/A/b?a=%20&z=1");
    expect(urlKey("http://example.com")).toBe("example.com/");
    expect(urlKey("http://example.com:8080/?")).toBe("example.com:8080/");
    expect(urlKey("https://[::1]:443/x")).toBe("[::1]/x");
  });

  it("has none for what is not a web address", () => {
    for (const bad of ["", "   ", "example.com/x", "mailto:a@b.c", "javascript:alert(1)", "file:///etc/passwd", "ftp://example.com/x", "https://", "https:///x", "https://u:p@example.com/", "https://exa mple.com/", "https://example.com/a b", "https://example.com/\u0007", "https://www./x"]) {
      expect(urlKey(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe("frontUrl", () => {
  const front = (lines: string) => `---\ntitle: T\n${lines}---\n`;
  it("reads the url line at the top of a note's frontmatter", () => {
    expect(frontUrl(front("url: https://a.example/x\n"))).toBe("https://a.example/x");
    expect(frontUrl(front("url:   https://a.example/x  # note\n"))).toBe("https://a.example/x");
    expect(frontUrl(front('url: "https://a.example/x?a=1&b=2"\n'))).toBe("https://a.example/x?a=1&b=2");
    expect(frontUrl(front("url: 'https://a.example/it''s'\n"))).toBe("https://a.example/it's");
    expect(frontUrl(front("url: https://a.example/x#frag\n"))).toBe("https://a.example/x#frag");
    expect(frontUrl("---\r\nurl: https://a.example/x\r\n---\r\nbody")).toBe("https://a.example/x");
  });

  it("finds none in what is nested, written as a block, or not frontmatter", () => {
    for (const lines of ["props:\n  url: https://b.example\n", "url: >\n  https://a.example/x\n", "url:\n", "Url: https://a.example/x\n", "urls: https://a.example/x\n"]) {
      expect(frontUrl(front(lines)), lines).toBeNull();
    }
    expect(frontUrl("no frontmatter")).toBeNull();
    expect(frontUrl("")).toBeNull();
  });
});
