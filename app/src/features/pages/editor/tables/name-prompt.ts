// The one question "Turn into database" asks, where the table is: the
// database's name, filled in from the heading above the table. Enter makes
// it, Escape leaves. A refusal is one sentence under the field and the field
// stays, so the name can be fixed in place.

import "./tables.css";

import type { EditorView } from "@milkdown/kit/prose/view";

import { el, type Rect } from "../ui/dom";

/** Resolves to a sentence saying why not, or null when it worked. */
export type Make = (name: string) => Promise<string | null> | string | null;

export class NamePrompt {
  readonly box: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly note: HTMLElement;
  private busy = false;
  private closed = false;

  constructor(
    private readonly view: EditorView,
    anchor: Rect,
    initial: string,
    private readonly make: Make,
  ) {
    this.box = el("div", "kasten-lang-picker kasten-name-prompt");
    this.box.setAttribute("role", "dialog");
    this.box.setAttribute("aria-label", "Turn into database");
    this.input = el("input", "kasten-lang-search", { type: "text", value: initial });
    this.input.setAttribute("aria-label", "Database name");
    this.note = el("div", "kasten-name-note", { textContent: "Name it, then press Enter. Each row becomes a note." });
    this.note.setAttribute("aria-live", "polite");
    this.box.append(this.input, this.note);
    document.body.append(this.box);
    Object.assign(this.box.style, { left: `${Math.max(8, Math.min(anchor.left, window.innerWidth - 248))}px`, top: `${anchor.bottom + 4}px` });
    this.input.addEventListener("keydown", this.onKey);
    document.addEventListener("pointerdown", this.onOutside, true);
    this.input.focus();
    this.input.select();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    document.removeEventListener("pointerdown", this.onOutside, true);
    this.box.remove();
    if (!this.view.isDestroyed) this.view.focus();
  }

  private async submit(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.input.disabled = true;
    this.note.textContent = "Making the database…";
    let problem: string | null;
    try {
      problem = await this.make(this.input.value);
    } catch {
      problem = "The database could not be made. Nothing was changed.";
    }
    if (this.closed) return;
    this.busy = false;
    this.input.disabled = false;
    if (problem === null) return this.close();
    this.note.textContent = problem;
    this.note.setAttribute("role", "alert");
    this.input.focus();
  }

  private readonly onKey = (event: KeyboardEvent) => {
    if (event.key === "Enter" && !event.isComposing) {
      event.preventDefault();
      void this.submit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      this.close();
    }
  };

  private readonly onOutside = (event: PointerEvent) => {
    if (!this.busy && !this.box.contains(event.target as Node)) this.close();
  };
}
