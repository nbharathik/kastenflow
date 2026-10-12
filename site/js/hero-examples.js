// The guided examples under the live page. Each button does one thing a
// visitor could do by hand, so the page and its Markdown file show what
// happened; nothing here fakes a result. The hint beside the page goes away
// at the first real touch.

const NOTE = "Sample notes, running in your browser. Nothing is saved.";

export function setupHeroExamples(root, demo) {
  const $ = (name) => root.querySelector(`[data-try="${name}"]`);
  const note = root.querySelector("[data-try-note]");
  const claude = $("claude");
  const label = claude.querySelector("[data-try-claude]");
  const glyph = claude.querySelector("use");
  const coach = root.querySelector("[data-coach]");
  const say = (text) => {
    note.textContent = text;
  };

  /** The Claude button asks, or undoes, depending on what is on the page. */
  function drawClaude() {
    const done = demo.hasClaude();
    label.textContent = done ? "Undo Claude’s changes" : "Ask Claude";
    glyph.setAttribute("href", done ? "#i-undo" : "#i-sparkle");
    claude.disabled = demo.busy();
  }

  $("tick").addEventListener("click", () => {
    const index = demo.nextTodo();
    const done = demo.tick(index);
    say(done ? "Ticked a to-do. Its line in the file now reads [x]." : "Unticked it. The file followed.");
  });

  $("status").addEventListener("click", () => {
    say(`Status set to ${demo.cycleStatus()}. Look for it under props in the file.`);
  });

  $("link").addEventListener("click", () => {
    demo.type("Pack light, and see [[");
    demo.focus();
    say("Pick a page to link. It becomes a link on the page and [[…]] in the file.");
  });

  claude.addEventListener("click", async () => {
    if (demo.hasClaude()) {
      demo.undoClaude();
      say("Undone. Only Claude’s lines went; everything you wrote stays.");
      return drawClaude();
    }
    claude.disabled = true;
    if (await demo.askClaude(say)) say("Claude’s lines are marked on the page. Undo takes them out again.");
    drawClaude();
  });

  $("reset").addEventListener("click", () => {
    demo.reset();
    say(NOTE);
    drawClaude();
  });

  const dismiss = () => coach?.classList.add("is-gone");
  for (const type of ["pointerdown", "keydown"]) root.addEventListener(type, dismiss, { once: true });

  say(NOTE);
  drawClaude();
  return { drawClaude };
}
