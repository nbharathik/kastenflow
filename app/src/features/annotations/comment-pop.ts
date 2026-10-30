// The small card under the selection bar's Comment item: a field for why the
// words matter, saved with the highlight. Escape or a click away puts it away.

import { el } from "../pages/editor/ui/dom";

let open: (() => void) | null = null;

/** Opens the card under `anchor`; `onSave` gets the comment (never empty). */
export function openCommentPop(anchor: { left: number; bottom: number }, onSave: (comment: string) => void): void {
  open?.();
  const card = el("form", "kasten-sel-bar kasten-sel-pop");
  card.style.left = `${anchor.left}px`;
  card.style.top = `${anchor.bottom + 6}px`;
  const field = el("textarea", "", { rows: 3, placeholder: "Why this passage matters…" });
  field.setAttribute("aria-label", "Comment");
  const save = el("button", "kasten-sel-save", { type: "submit", textContent: "Highlight with comment" });
  const note = el("div", "kasten-sel-note");
  note.append(field, save);
  card.append(note);

  const close = () => {
    document.removeEventListener("pointerdown", away, true);
    card.remove();
    if (open === close) open = null;
  };
  const away = (event: Event) => {
    if (!card.contains(event.target as Node)) close();
  };
  const submit = () => {
    const text = field.value.trim();
    close();
    if (text) onSave(text);
  };
  card.addEventListener("submit", (event) => {
    event.preventDefault();
    submit();
  });
  field.addEventListener("keydown", (event) => {
    if (event.key === "Escape") close();
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) submit();
  });
  document.body.append(card);
  document.addEventListener("pointerdown", away, true);
  open = close;
  field.focus();
}
