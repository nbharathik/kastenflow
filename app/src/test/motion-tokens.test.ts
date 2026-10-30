// Motion comes from three lengths and one easing (styles.css), so the
// motion setting can turn all of it off at once. Nothing that shows typing
// ever animates: a keystroke must land at once.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/** The app's sources; the tests run from `app/`. */
const SRC = [join(process.cwd(), "src"), join(process.cwd(), "app", "src")].find((dir) => existsSync(join(dir, "main.tsx")))!;

function files(dir: string, pattern: RegExp): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path, pattern);
    return pattern.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

const STYLES = files(SRC, /\.css$/);
const SCRIPTS = files(SRC, /\.tsx$/);
const where = (path: string, text: string, index: number) => `${relative(SRC, path).replaceAll("\\", "/")}:${text.slice(0, index).split("\n").length}`;

/** Rules as written: the selector just before a block and the block's own declarations. */
function rules(text: string): { selector: string; body: string; index: number }[] {
  // Comments become spaces, keeping every index where it was.
  const bare = text.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "));
  return [...bare.matchAll(/([^{};]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1]!.trim(), body: m[2]!, index: m.index! }));
}

describe("motion tokens", () => {
  it("time every short transition and animation with the motion tokens", () => {
    const literal = STYLES.flatMap((path) => {
      const text = readFileSync(path, "utf8");
      return [...text.matchAll(/(?<![\w-])(?:transition|animation)(?:-duration)?\s*:([^;{}]+);/g)]
        .filter((m) =>
          // Under a millisecond is the off switch itself.
          [...m[1]!.matchAll(/(?<![\w.-])(\d+(?:\.\d+)?)(ms|s)\b/g)].some(([, n, unit]) => {
            const ms = unit === "s" ? Number(n) * 1000 : Number(n);
            return ms >= 1 && ms <= 300;
          }),
        )
        .map((m) => `${where(path, text, m.index!)} ${m[0].replace(/\s+/g, " ")}`);
    });
    expect(literal).toEqual([]);
  });

  it("drop every length to nothing when motion is off, and keep spinners and progress running", () => {
    const motion = readFileSync(join(SRC, "motion.css"), "utf8");
    const off = rules(motion).find((r) => r.selector === ':root[data-motion="off"]');
    expect(off?.body).toMatch(/--motion-fast:\s*0ms/);
    expect(off?.body).toMatch(/--motion-base:\s*0ms/);
    expect(off?.body).toMatch(/--motion-slow:\s*0ms/);
    // Only the setting being Off does so: the computer's request has its own rules below.
    const stopAll = rules(motion).find((r) => r.selector.startsWith(':root[data-motion="off"]:not([data-motion-reduced]) *:not('));
    expect(stopAll?.body).toMatch(/transition-duration:\s*0\.01ms !important/);
    expect(stopAll?.selector).toContain("::before");
    expect(stopAll?.selector).toContain("::after");
    for (const spinner of [".ui-spinner", ".kasten-chat-spinner", ".kasten-browser-loading", ".latex-progress", "progress"]) expect(stopAll?.selector).toContain(spinner);
  });

  it("turns movement into short fades, not nothing, when the computer asks for less", () => {
    const motion = readFileSync(join(SRC, "motion.css"), "utf8");
    const still = rules(motion).filter((r) => r.selector.startsWith(':root[data-motion="off"][data-motion-reduced]'));
    const lengths = still.find((r) => r.selector === ':root[data-motion="off"][data-motion-reduced]');
    // The lengths stay (short), and nothing is asked to move.
    expect(lengths?.body).toMatch(/--motion-base:\s*\d+ms/);
    expect(lengths?.body).not.toMatch(/--motion-base:\s*0ms/);
    for (const distance of ["nudge", "side", "rise"]) expect(lengths?.body).toMatch(new RegExp(`--motion-${distance}:\\s*0px`));
    expect(lengths?.body).toMatch(/--motion-pop-from:\s*1\b/);
    // No rule of its own cuts transitions or animations to a hair.
    expect(still.map((r) => r.body).join("\n")).not.toMatch(/0\.01ms/);
    // Looping decoration stops; the exempt spinners are the same as for Off.
    expect(still.some((r) => /animation-iteration-count:\s*1 !important/.test(r.body) && r.selector.includes(".kasten-chat-spinner"))).toBe(true);
  });

  it("never animates width, height, top or left", () => {
    const LAYOUT = /(?<![\w-])(?:width|height|top|left)(?![\w-])/;
    const found: string[] = [];
    for (const path of STYLES) {
      const text = readFileSync(path, "utf8");
      const bare = text.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "));
      for (const m of bare.matchAll(/(?<![\w-])transition(?:-property)?\s*:([^;{}]+);/g)) {
        // Only the property names: not the lengths, nor var() arguments.
        const names = m[1]!.replace(/var\([^)]*\)|cubic-bezier\([^)]*\)|[\d.]+m?s/g, " ");
        if (LAYOUT.test(names)) found.push(`${where(path, text, m.index!)} ${m[0].replace(/\s+/g, " ")}`);
      }
      // Keyframes: a body with a layout property in it.
      for (const m of bare.matchAll(/@keyframes\s+([\w-]+)\s*\{/g)) {
        let depth = 1;
        let i = m.index! + m[0].length;
        while (depth > 0 && i < bare.length) {
          if (bare[i] === "{") depth++;
          else if (bare[i] === "}") depth--;
          i++;
        }
        const body = bare.slice(m.index! + m[0].length, i);
        if (/(?:^|[;{\s])(?:width|height|top|left)\s*:/.test(body)) found.push(`${where(path, text, m.index!)} @keyframes ${m[1]}`);
      }
    }
    // Utility classes in the views.
    for (const path of SCRIPTS) {
      const text = readFileSync(path, "utf8");
      for (const m of text.matchAll(/(?<![\w-])transition-(?:\[([^\]]*)\]|(all|width|height|top|left))(?![\w-])/g)) {
        if (m[2] || LAYOUT.test(m[1] ?? "")) found.push(`${where(path, text, m.index!)} ${m[0]}`);
      }
    }
    expect(found).toEqual([]);
  });

  it("lets a grid fold animate its rows only in the two places that fold", () => {
    // The one named exception to "no layout animation": a fold grows from
    // 0fr to 1fr, which only a grid does without measuring.
    const users = STYLES.filter((path) => /transition[^;]*grid-template-rows/s.test(readFileSync(path, "utf8"))).map((path) => relative(SRC, path).replaceAll("\\", "/"));
    expect(users.sort()).toEqual(["features/home/cards.css", "features/review/review.css"]);
  });

  /** Every rule that opens something with a fade or a rise, with the last compound of its selector. */
  function entrances(): { path: string; file: string; selector: string; classes: string[] }[] {
    return STYLES.flatMap((path) => {
      const text = readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "));
      return [...text.matchAll(/(?<![\w-])animation(?:-name)?\s*:\s*kasten-(?:fade|enter|enter-side|rise|pop-in)\b/g)].map((m) => {
        // The selector of the block the declaration is in: back to its unmatched "{".
        let depth = 0;
        let at = m.index!;
        while (at > 0) {
          at--;
          if (text[at] === "}") depth++;
          else if (text[at] === "{" && depth-- === 0) break;
        }
        const head = text.slice(Math.max(text.lastIndexOf("}", at), text.lastIndexOf(";", at), -1) + 1, at).trim();
        // Each selector of a list, its last compound (`.a .b.c` is `.b.c`).
        const lasts = head.split(",").map((one) => one.trim().split(/[\s>+~]+/).filter(Boolean).pop() ?? "");
        return { path, file: relative(SRC, path).replaceAll("\\", "/"), selector: head, classes: lasts.flatMap((last) => [...last.matchAll(/\.([A-Za-z][\w-]*)/g)].map((c) => c[1]!)) };
      });
    });
  }

  const SURFACE = /(?:^|-)(?:overlay|modal|menu|pop|popup|popover|palette|peek|tip|toast|sheet|gallery|whatsnew|shortcuts|dialog)(?:-|$)/;
  /** Panels inside a `.ui-overlay` (ui/Modal.tsx): they leave with it. */
  const IN_OVERLAY = new Set(["ui-modal", "kasten-palette", "kasten-shortcuts", "kasten-gallery", "kasten-whatsnew"]);
  /** Surfaces with an enter and no exit yet, and why. Each must still be one: the list shrinks as they are wired. */
  const NO_EXIT_YET: Record<string, string> = {
    "kasten-pop": "the whiteboard bars' panels open in place from the bars (not through Popup)",
  };

  it("gives every overlay and menu class an enter rule and an exit rule", () => {
    const sheets = STYLES.map((path) => readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, ""));
    const closing = sheets.flatMap((text) => [...text.matchAll(/([^{};]+)\{/g)].map((m) => m[1]!.trim())).filter((selector) => selector.includes('[data-state="closing"]'));
    const toastLeaves = sheets.some((text) => /\.kasten-toast\s*\{[\s\S]*&\.is-leaving/.test(text));

    const surfaces = new Set(entrances().flatMap((e) => e.classes.filter((c) => SURFACE.test(c))));
    // The classes known to be surfaces are really found, so the scan is not blind.
    for (const name of ["ui-overlay", "ui-modal", "kasten-popup", "kasten-peek-side", "kasten-tip", "kasten-toast", "kasten-palette", "kasten-pop"]) expect(surfaces).toContain(name);

    // `.kasten-pop` is not `.kasten-popup`.
    const names = (name: string) => closing.some((selector) => new RegExp(`\\.${name}(?![\\w-])`).test(selector));
    const missing = [...surfaces].filter((name) => {
      if (IN_OVERLAY.has(name) || name in NO_EXIT_YET) return false;
      if (name === "kasten-toast") return !toastLeaves;
      return !names(name);
    });
    expect(missing).toEqual([]);

    // Panels in an overlay leave with it, so the overlay must.
    expect(names("ui-overlay")).toBe(true);
    // The gaps are real: a surface with an exit comes off the list.
    for (const name of Object.keys(NO_EXIT_YET)) expect(names(name)).toBe(false);
  });

  it("holds each surface for its exit with usePresence or a ghost", () => {
    const source = (path: string) => readFileSync(join(SRC, path), "utf8");
    expect(source("ui/Modal.tsx")).toContain("useLeaveGhost");
    expect(source("features/pages/page/Popup.tsx")).toContain("useLeaveGhost");
    expect(source("shell/peek/PagePeek.tsx")).toContain("usePresence");
    expect(source("ui/Tooltips.tsx")).toContain("usePresence");
  });

  it("never animate text as it is typed", () => {
    // The editor's text, the page title and the capture boxes.
    const typing = /\.ProseMirror(?:\s+(?:p|h[1-6]|li|ul|ol|blockquote|pre|code|span|strong|em|a)\b[^,]*)?\s*(?:,|$)|\.kasten-page-title\b|\.kasten-capture-text\b/;
    const moving = STYLES.flatMap((path) => {
      const text = readFileSync(path, "utf8");
      return rules(text)
        .filter((r) => typing.test(r.selector) && /(?:^|;|\s)(?:transition|animation)\s*:/.test(r.body))
        .map((r) => `${where(path, text, r.index)} ${r.selector}`);
    });
    expect(moving).toEqual([]);

    // Text fields in the views: no transition or animation classes.
    const fields = SCRIPTS.flatMap((path) => {
      const text = readFileSync(path, "utf8");
      return [...text.matchAll(/<(?:textarea|input)\b(?:(?!<)[\s\S]){0,800}?className=(?:"([^"]*)"|\{`([^`]*)`\})/g)]
        .filter((m) => /(?:^|\s)(?:transition(?:-[\w[\],-]+)?|animate-[\w-]+)(?=\s|$)/.test(m[1] ?? m[2] ?? ""))
        .map((m) => where(path, text, m.index!));
    });
    expect(fields).toEqual([]);
  });
});
