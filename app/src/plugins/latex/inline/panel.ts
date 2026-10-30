// Ctrl/Cmd+K in the LaTeX editor: a small panel at the cursor with a box for
// free text and a few presets. The answer is put in the text at once, marked
// as a diff (review.ts), and the panel asks Keep or Undo. Esc closes the panel,
// and undoes an answer that has not been kept. The panel is plain DOM so the
// editor owns its focus and keys.

import { type Extension, Prec, StateEffect, StateField } from "@codemirror/state";
import { EditorView, keymap, showTooltip, type Tooltip, ViewPlugin } from "@codemirror/view";

import { latexChip } from "../../../features/chat/context";
import { runInChat } from "../../../features/chat/run-action";
import { assist } from "../completion/binding";
import { ask, type Running } from "./ask";
import { ACTION_FOR, paragraphAround, type Preset, PRESETS, cleanLatex } from "./presets";
import { applyAnswer, keep, reviewField, reviewOf, undo } from "./review";

const openPanel = StateEffect.define<{ pos: number; dom: HTMLElement }>();
const closePanel = StateEffect.define<null>();

const panelField = StateField.define<Tooltip | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(openPanel)) {
        const { pos, dom } = effect.value;
        return { pos, above: true, strictSide: true, arrow: false, create: () => ({ dom }) };
      }
      if (effect.is(closePanel)) return null;
    }
    return value;
  },
  provide: (field) => showTooltip.from(field),
});

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const sentence = (err: unknown) => (err instanceof Error ? err.message : String(err));
const SHOWN = 600;

/** One open panel. */
class Panel {
  readonly dom = el("div", "cm-ai-panel");
  private readonly input = el("input", "cm-ai-input");
  private readonly list = el("ul", "cm-ai-presets");
  private readonly status = el("div", "cm-ai-status");
  private readonly stream = el("pre", "cm-ai-stream");
  private readonly buttons = el("div", "cm-ai-buttons");
  private running: Running | null = null;
  private waiting: Preset | null = null;
  private gone = false;

  constructor(private readonly view: EditorView) {
    const dom = this.dom;
    dom.setAttribute("role", "dialog");
    dom.setAttribute("aria-label", "Ask AI about this LaTeX");
    this.input.type = "text";
    this.input.setAttribute("aria-label", "Ask for some LaTeX");
    this.input.placeholder = "Ask for some LaTeX, or choose below";
    this.list.setAttribute("role", "menu");
    this.status.setAttribute("role", "status");
    this.status.setAttribute("aria-live", "polite");
    for (const preset of PRESETS) {
      const item = el("li", "");
      const button = el("button", "cm-ai-preset", preset.label);
      button.type = "button";
      button.setAttribute("role", "menuitem");
      button.addEventListener("click", () => this.choose(preset));
      item.append(button);
      this.list.append(item);
    }
    this.stream.hidden = true;
    dom.append(this.input, this.list, this.status, this.stream, this.buttons);
    dom.addEventListener("keydown", (event) => this.keys(event));
    this.say("Replaces the selection, or goes at the cursor. Its answer may be wrong: you keep or undo it.");
  }

  focus(): void {
    this.input.focus();
  }

  private say(text: string): void {
    this.status.textContent = text;
  }

  private show(...buttons: [string, () => void, boolean?][]): void {
    this.buttons.replaceChildren(
      ...buttons.map(([label, run, primary]) => {
        const b = el("button", primary ? "cm-ai-button is-primary" : "cm-ai-button", label);
        b.type = "button";
        b.addEventListener("click", run);
        return b;
      }),
    );
  }

  private keys(event: KeyboardEvent): void {
    const target = event.target as HTMLElement;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      // Already asking: the key does not open the palette from here.
      event.preventDefault();
      this.input.focus();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      this.close(true);
    } else if (event.key === "Enter" && target === this.input) {
      event.preventDefault();
      this.submit();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const items = [...this.list.querySelectorAll<HTMLElement>("button")];
      const at = items.indexOf(target);
      if (target !== this.input && at < 0) return;
      event.preventDefault();
      if (event.key === "ArrowDown") (items[at + 1] ?? items[0])?.focus();
      else if (at <= 0) this.input.focus();
      else items[at - 1]?.focus();
    }
  }

  /** The box's Enter: the waiting preset gets the words, else the words are the request. */
  private submit(): void {
    const words = this.input.value.trim();
    if (this.waiting) return this.choose(this.waiting, words);
    if (words) void this.run({ kind: "write", words, works: "words" });
    else this.say("Type what you want, or choose a preset.");
  }

  /** A preset chosen; `typed` are the words from the box when it waited for them. */
  private choose(preset: Preset, typed = this.input.value.trim()): void {
    const sel = this.view.state.selection.main;
    const hasSelection = sel.from < sel.to;
    if (preset.works === "selection" && !hasSelection) return this.say("Select the text first, then choose this.");
    if (preset.works === "words" && !typed && !hasSelection) {
      this.waiting = preset;
      this.input.placeholder = preset.ask ?? "Say more…";
      this.say(preset.ask ?? "Say more, then press Enter.");
      this.input.focus();
      return;
    }
    this.waiting = null;
    const words = preset.works === "words" && !typed ? this.view.state.sliceDoc(sel.from, sel.to) : typed;
    void this.run({ kind: preset.kind, words: preset.words(preset.works === "words" ? words : typed), works: preset.works });
  }

  private async run(job: { kind: Preset["kind"]; words: string; works: Preset["works"] }): Promise<void> {
    const path = assist.current?.currentFile();
    if (!path) return this.say("Open a file first.");
    const state = this.view.state;
    const sel = state.selection.main;
    // The text it works on: the selection, else (for a paragraph preset) the paragraph at the caret, else the caret.
    let from = sel.from;
    let to = sel.to;
    if (from === to && job.works === "paragraph") ({ from, to } = paragraphAround(state.doc.toString(), sel.head));
    if (job.works === "paragraph" && from === to) return this.say("Put the caret in a paragraph, or select the text.");
    if (job.kind === "chat") {
      this.close(false);
      void runInChat(ACTION_FOR.chat, [latexChip({ path, title: path.slice(path.lastIndexOf("/") + 1) })], job.words);
      return;
    }
    const doc = state.doc;
    this.stream.hidden = true;
    this.input.disabled = true;
    this.say("Writing…");
    this.show(["Stop", () => this.running?.stop()]);
    try {
      this.running = await ask(
        { action: ACTION_FOR[job.kind], words: job.words, path, selection: state.sliceDoc(from, to), before: state.sliceDoc(0, from), after: state.sliceDoc(to) },
        (text) => {
          if (this.gone) return;
          this.stream.hidden = false;
          this.stream.textContent = text.length > SHOWN ? `…${text.slice(-SHOWN)}` : text;
        },
      );
      const written = await this.running.done;
      this.running = null;
      if (this.gone) return;
      this.stream.hidden = true;
      this.input.disabled = false;
      const text = cleanLatex(written.text);
      if (!text) {
        this.say(written.stopped ? "Stopped before anything was written." : "The model wrote nothing. Try again, or ask another way.");
        this.show();
        this.input.focus();
      } else if (job.kind === "explain") {
        this.stream.hidden = false;
        this.stream.textContent = text;
        this.say(written.note ?? "An explanation, not a change. It may be wrong.");
        this.show(["Close", () => this.close(false), true]);
      } else if (this.view.state.doc !== doc) {
        this.say("The text changed while the answer was written, so it was not put in. Ask again.");
        this.show();
        this.input.focus();
      } else {
        applyAnswer(this.view, from, to, text);
        this.say(`${written.note ?? ""} Green is new, red is what it replaces. It may be wrong. Enter keeps it, Esc undoes it.`.trim());
        this.show(["Keep", () => this.close(false), true], ["Undo", () => this.close(true)]);
        this.dom.querySelector<HTMLElement>(".cm-ai-button.is-primary")?.focus();
      }
    } catch (err) {
      this.running = null;
      if (this.gone) return;
      this.input.disabled = false;
      this.stream.hidden = true;
      this.say(sentence(err));
      this.show();
      this.input.focus();
    }
  }

  /** Closes the panel. `undoing` puts an answer that was not kept back; otherwise it is kept. */
  close(undoing: boolean): void {
    if (this.gone) return;
    this.running?.stop();
    if (reviewOf(this.view.state)) (undoing ? undo : keep)(this.view);
    this.dispose();
    this.view.dispatch({ effects: closePanel.of(null) });
    this.view.focus();
  }

  /** Lets go without touching the editor (it is gone or its state was replaced). */
  dispose(): void {
    this.gone = true;
    this.running?.stop();
    panels.delete(this.view);
  }
}

const panels = new WeakMap<EditorView, Panel>();

/** Opens the panel at the cursor. False when a file is not open or the panel is already there. */
export function openInline(view: EditorView): boolean {
  if (!assist.current?.currentFile()) return false;
  const open = panels.get(view);
  if (open) {
    open.focus();
    return true;
  }
  const panel = new Panel(view);
  panels.set(view, panel);
  view.dispatch({ effects: openPanel.of({ pos: view.state.selection.main.head, dom: panel.dom }) });
  panel.focus();
  return true;
}

/** Lets go of the panel when the editor's state is replaced (another file) or the editor goes. */
const tracker = ViewPlugin.fromClass(
  class {
    constructor(private readonly view: EditorView) {}
    update(): void {
      if (panels.has(this.view) && !this.view.state.field(panelField, false)) panels.get(this.view)?.dispose();
    }
    destroy(): void {
      panels.get(this.view)?.dispose();
    }
  },
);

/** Ctrl/Cmd+K, the panel and the diff marks. */
export const inlineAi: Extension = [
  panelField,
  reviewField,
  tracker,
  Prec.high(keymap.of([{ key: "Mod-k", preventDefault: true, run: openInline }])),
];
