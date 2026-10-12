import { describe, expect, it, vi } from "vitest";

import { followLink, kindOfLink, linkAt, linkHint, nameOfPath } from "./follow.ts";
import { makePageLink } from "./links.ts";

describe("what a link is", () => {
  it("is a slide, a page of the host, or the web, and nothing that could run", () => {
    expect(kindOfLink("slide:s-1")).toBe("slide");
    expect(kindOfLink(makePageLink("projects/talk/plan.md", "Risks"))).toBe("page");
    expect(kindOfLink("https://example.com")).toBe("web");
    expect(kindOfLink("mailto:a@b.c")).toBe("web");
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "file:///etc/passwd", "page:", "", null, undefined]) expect(kindOfLink(bad as string)).toBeNull();
  });
});

describe("following a link", () => {
  it("goes where the place it was followed in says, and says whether it went anywhere", () => {
    const ways = { slide: vi.fn(), page: vi.fn(), web: vi.fn() };
    expect(followLink("slide:s-9", ways)).toBe(true);
    expect(ways.slide).toHaveBeenCalledWith("s-9");
    expect(followLink(makePageLink("a b/plan.md", "Next steps"), ways)).toBe(true);
    expect(ways.page).toHaveBeenCalledWith("a b/plan.md", "Next steps");
    expect(followLink("https://example.com/x", ways)).toBe(true);
    expect(ways.web).toHaveBeenCalledWith("https://example.com/x");
  });

  it("does nothing where the place has no way to, and never for what must not be followed", () => {
    expect(followLink(makePageLink("plan.md"), {})).toBe(false);
    expect(followLink("slide:s-1", { page: vi.fn() })).toBe(false);
    const web = vi.fn();
    expect(followLink("javascript:alert(1)", { web })).toBe(false);
    expect(web).not.toHaveBeenCalled();
  });
});

describe("what a link says when the pointer rests on it", () => {
  it("names the page and the heading, or the address", () => {
    expect(linkHint(makePageLink("projects/talk/plan.md", "Risks"))).toBe("Open the page plan, at Risks");
    expect(linkHint("https://example.com")).toBe("https://example.com");
    expect(linkHint("slide:s-1")).toBe("Go to that slide");
    expect(linkHint("javascript:x")).toBe("");
    expect(nameOfPath("a/b/c.md")).toBe("c");
  });
});

describe("the link under an event", () => {
  it("is the nearest words or element that link", () => {
    document.body.innerHTML = '<div data-link="slide:s-2"><a class="w" data-href="https://x.y"><b id="in">go</b></a><i id="out">no</i></div>';
    expect(linkAt(document.getElementById("in"))).toBe("https://x.y");
    expect(linkAt(document.getElementById("out"))).toBe("slide:s-2");
    expect(linkAt(document.body)).toBeNull();
    expect(linkAt(null)).toBeNull();
  });
});
