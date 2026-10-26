// @vitest-environment jsdom
// The link menu keeps its own colours, so it reads on any slide.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { LinkMenu } from "./link-menu.tsx";

describe("the link menu's colours", () => {
  it("sits in a scope of its own that sets the menu's colours", () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() => root.render(<LinkMenu anchor={{ left: 10, top: 10, right: 10, bottom: 10 }} onClose={vi.fn()} onChoose={vi.fn()} />));
    expect(document.querySelector(".ks-link-menu .ks-popover")).not.toBeNull();
    act(() => root.unmount());
    host.remove();
  });

  it("does not take the slide's background or text", () => {
    const css = readFileSync(join(process.cwd(), "src/present/link-menu.css"), "utf8");
    const light = css.slice(0, css.indexOf("[data-theme"));
    for (const name of ["--ks-raised", "--ks-ink", "--ks-hover"]) expect(light).toMatch(new RegExp(`${name}:\\s*[^;]*[#(]`));
    expect(light).not.toMatch(/--ks-(raised|ink):\s*(inherit|currentcolor|var\()/i);
  });
});
