// The window's code for code pictures stays on its side of the wall: it never imports the kit that runs inside the frame, never builds a
// page or runs code from text (no innerHTML, srcdoc, eval, Function or document.write), and only one file makes the frame, with the
// sandbox that gives it scripts and nothing else.

import { describe, expect, it } from "vitest";

const sources = import.meta.glob("./*.{ts,tsx}", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

/** The window's own files: not the tests. */
const host = Object.entries(sources).filter(([name]) => !/\.test\./.test(name));

const withoutComments = (text: string) => text.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

describe("the window's code for code pictures", () => {
  it("is there to be checked", () => {
    const names = host.map(([name]) => name.replace(/^.*\//, ""));
    for (const file of ["frame.ts", "sandbox.ts", "answer.ts", "editor-host.ts", "listener.ts", "backend.ts", "AllowDialog.tsx"]) expect(names, file).toContain(file);
  });

  it("imports nothing of the kit that runs inside the frame", () => {
    for (const [name, text] of host) {
      expect(/from\s+["'][^"']*(generator-kit|\/kit\.js|runner\.js)/.test(text), name).toBe(false);
      expect(/import\(\s*["'][^"']*generator-kit/.test(text), name).toBe(false);
    }
  });

  it("builds no page and runs no code from text", () => {
    for (const [name, text] of host) {
      const code = withoutComments(text);
      expect(/innerHTML|outerHTML|dangerouslySetInnerHTML|srcdoc|insertAdjacentHTML|document\.write|\beval\(|new Function\(|importScripts|new Worker/.test(code), name).toBe(false);
    }
  });

  it("makes the frame in one file, with the sandbox of scripts and nothing a frame could use to leave it", () => {
    const frame = sources["./frame.ts"]!;
    expect(frame).toContain('setAttribute("sandbox", GENERATOR_SANDBOX)');
    expect(frame).toContain('GENERATOR_SANDBOX = "allow-scripts"');
    expect(frame).not.toMatch(/allow-same-origin|allow-top-navigation|allow-popups|allow-forms|allow-modals|allow-downloads/);
    for (const [name, text] of host) if (!name.endsWith("frame.ts")) expect(/<iframe|createElement\(["']iframe/.test(text), name).toBe(false);
  });

  it("calls only commands that are the window's own, and never one a frame could name", () => {
    const backend = sources["./backend.ts"]!;
    const commands = [...backend.matchAll(/invoke(?:<[^>]*>)?\(\s*"([a-z_]+)"/g)].map((match) => match[1]);
    expect(commands.sort()).toEqual(
      ["diagram_png_answer", "generator_allow", "generator_allowed", "generator_frame_open", "generator_library", "generator_library_read", "generator_library_save", "generator_text_asset", "smart_frame_close"].sort(),
    );
  });
});
